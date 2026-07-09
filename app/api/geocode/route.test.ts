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
