import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from './route'
import { __testResetGeocodeState } from '@/lib/geocode-route-handler'

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: vi.fn(async () => ({ data: { user: { id: 'user-1' } }, error: null })),
    },
  })),
}))

describe('GET /api/geocode', () => {
  beforeEach(() => {
    __testResetGeocodeState()
    vi.restoreAllMocks()
  })

  afterEach(() => {
    __testResetGeocodeState()
  })

  it('returns 401 when unauthenticated', async () => {
    const { createClient } = await import('@/lib/supabase/server')
    vi.mocked(createClient).mockResolvedValueOnce({
      auth: {
        getUser: vi.fn(async () => ({ data: { user: null }, error: null })),
      },
    } as never)

    const req = new NextRequest('http://localhost/api/geocode?q=Chicago,IL')
    const res = await GET(req)
    expect(res.status).toBe(401)
  })

  it('returns 400 for invalid zip', async () => {
    const req = new NextRequest('http://localhost/api/geocode?zip=abcde')
    const res = await GET(req)
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.userMessage).toContain('Invalid zip')
  })

  it('returns 400 when query missing', async () => {
    const req = new NextRequest('http://localhost/api/geocode')
    const res = await GET(req)
    expect(res.status).toBe(400)
  })

  it('returns stripped DTO on success and caches', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => [
          {
            lat: '40.9264',
            lon: '-98.3420',
            display_name: 'Grand Island, NE',
            address: {
              city: 'Grand Island',
              state: 'Nebraska',
              'ISO3166-2-lvl4': 'US-NE',
              postcode: '68801',
              road: 'Stolley Park Road',
            },
            extraneous: 'field',
          },
        ],
      })
    )

    const req = new NextRequest('http://localhost/api/geocode?q=Case%20IH%20plant,%20Grand%20Island,%20NE')
    const res1 = await GET(req)
    const body1 = await res1.json()
    expect(res1.status).toBe(200)
    expect(body1[0]).toMatchObject({ lat: '40.9264', lon: '-98.342' })
    expect(body1[0].extraneous).toBeUndefined()

    const res2 = await GET(req)
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1)
    expect(res2.status).toBe(200)
  })

  it('returns 404 for empty nominatim result', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => [] })
    )

    const req = new NextRequest('http://localhost/api/geocode?q=nowhereville,ZZ')
    const res = await GET(req)
    expect(res.status).toBe(404)
  })

  it('returns generic 404 message without reflecting user input', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => [] })
    )

    const req = new NextRequest('http://localhost/api/geocode?q=secret-evil-input')
    const res = await GET(req)
    const body = await res.json()

    expect(res.status).toBe(404)
    expect(body.userMessage).not.toContain('secret-evil-input')
    expect(body.userMessage).toContain('No location found')
  })

  it('ranks the KS building after a weak MO first hit', async () => {
    const moRoad = {
      lat: '39.05524',
      lon: '-94.60311',
      display_name: 'West 40th Street, Kansas City, Missouri, United States',
      address: {
        road: 'West 40th Street',
        city: 'Kansas City',
        state: 'Missouri',
        'ISO3166-2-lvl4': 'US-MO',
        postcode: '64111',
      },
      importance: 0.72,
    }
    const ksBuilding = {
      lat: '39.0572565',
      lon: '-94.8600719',
      display_name:
        'Forterra Pipe & Precast, 23600 West 40th Street, Bonner Springs, Johnson County, Kansas, 66012, United States',
      address: {
        house_number: '23600',
        road: 'West 40th Street',
        city: 'Bonner Springs',
        state: 'Kansas',
        'ISO3166-2-lvl4': 'US-KS',
        postcode: '66012',
      },
      importance: 0.31,
    }

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo) => {
        const href = String(input)
        const hasKansasCity = /kansas(\+|%20|\s)+city/i.test(href)
        const has23600 = /23600/.test(href)
        const body = has23600 && !hasKansasCity ? [ksBuilding] : [moRoad]
        return { ok: true, status: 200, json: async () => body }
      })
    )

    const req = new NextRequest(
      'http://localhost/api/geocode?q=23600%20w%2040th%20st,%20kansas%20city,%20ks&state=KS&limit=1'
    )
    const res = await GET(req)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(Number(body[0].lat)).toBeCloseTo(39.05726, 4)
    expect(Number(body[0].lon)).toBeCloseTo(-94.86007, 4)
    expect(body[0].address?.house_number).toBe('23600')
    expect(body[0].address?.['ISO3166-2-lvl4']).toBe('US-KS')
    expect(body).toHaveLength(1)
    const fetchMock = vi.mocked(fetch)
    expect(fetchMock.mock.calls.length).toBeGreaterThan(0)
    for (const call of fetchMock.mock.calls) {
      expect(String(call[0])).toContain('limit=5')
    }
  })

  it('returns 429 not 404 when Nominatim 429s after a weak MO batch', async () => {
    const moRoad = {
      lat: '39.05524',
      lon: '-94.60311',
      display_name: 'West 40th Street, Kansas City, Missouri, United States',
      address: {
        road: 'West 40th Street',
        city: 'Kansas City',
        state: 'Missouri',
        'ISO3166-2-lvl4': 'US-MO',
        postcode: '64111',
      },
    }

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo) => {
        const href = String(input)
        if (/kansas(\+|%20|\s)+city/i.test(href)) {
          return { ok: true, status: 200, json: async () => [moRoad] }
        }
        return { ok: false, status: 429, json: async () => ({}) }
      })
    )

    const req = new NextRequest(
      'http://localhost/api/geocode?q=23600%20w%2040th%20st,%20kansas%20city,%20ks&state=KS&limit=1'
    )
    const res = await GET(req)
    const body = await res.json()
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBeTruthy()
    expect(body.userMessage).toMatch(/busy/i)
  })

  it('does not treat a MO house+street hit as strong when only state=KS is on the query param', async () => {
    const moHouse = {
      lat: '39.05524',
      lon: '-94.60311',
      display_name: '23600 West 40th Street, Kansas City, Missouri, United States',
      address: {
        house_number: '23600',
        road: 'West 40th Street',
        city: 'Kansas City',
        state: 'Missouri',
        'ISO3166-2-lvl4': 'US-MO',
      },
    }
    const ksBuilding = {
      lat: '39.0572565',
      lon: '-94.8600719',
      display_name:
        'Forterra Pipe & Precast, 23600 West 40th Street, Bonner Springs, Johnson County, Kansas, 66012, United States',
      address: {
        house_number: '23600',
        road: 'West 40th Street',
        city: 'Bonner Springs',
        state: 'Kansas',
        'ISO3166-2-lvl4': 'US-KS',
        postcode: '66012',
      },
    }

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo) => {
        const href = String(input)
        const hasKansasCity = /kansas(\+|%20|\s)+city/i.test(href)
        return {
          ok: true,
          status: 200,
          json: async () => (hasKansasCity ? [moHouse] : [ksBuilding]),
        }
      })
    )

    const req = new NextRequest(
      'http://localhost/api/geocode?q=23600%20w%2040th%20st,%20kansas%20city&state=KS&limit=1'
    )
    const res = await GET(req)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(Number(body[0].lat)).toBeCloseTo(39.05726, 4)
    expect(body[0].address?.['ISO3166-2-lvl4']).toBe('US-KS')
  })

  it('returns 429 when rate limited', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => [] })
    )

    const makeReq = () =>
      new NextRequest('http://localhost/api/geocode?q=Minot,ND', {
        headers: { 'x-forwarded-for': '1.2.3.4' },
      })

    await GET(makeReq())
    await GET(makeReq())
    await GET(makeReq())
    const res = await GET(makeReq())
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBeTruthy()
  })
})
