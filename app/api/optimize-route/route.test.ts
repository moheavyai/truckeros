import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { buildLoadDetails, POST } from './route'

const mockProcessPermitRequest = vi.fn()
const mockEnrichOrToolsResponseWithEscorts = vi.fn()

vi.mock('@/agents/permit-agent', () => ({
  processPermitRequest: (...args: unknown[]) => mockProcessPermitRequest(...args),
}))

vi.mock('@/lib/enrich-route-escorts', () => ({
  enrichOrToolsResponseWithEscorts: (...args: unknown[]) =>
    mockEnrichOrToolsResponseWithEscorts(...args),
}))

describe('buildLoadDetails', () => {
  it('maps origin/destination query and coerces string drop coordinates', () => {
    const load = buildLoadDetails({
      origin: { query: 'Grand Island, NE', city: 'Grand Island', state: 'NE' },
      destination: { query: 'Dickinson, ND', city: 'Dickinson', state: 'ND' },
      drops: [{ query: 'Minot', lat: '48.232', lon: '-101.296', city: 'Minot', state: 'ND' }],
      weight: 80000,
      length: 74,
      width: 8.5,
      height: 13.5,
      originLat: 40.9,
      originLon: -98.3,
      destinationLat: 46.9,
      destinationLon: -102.8,
    })

    expect(load.origin.query).toBe('Grand Island, NE')
    expect(load.destination.query).toBe('Dickinson, ND')
    expect(load.drops).toHaveLength(1)
    expect(load.drops?.[0].lat).toBe(48.232)
    expect(load.drops?.[0].lon).toBe(-101.296)
  })

  it('throws when drops lack coordinates', () => {
    expect(() =>
      buildLoadDetails({
        origin: { city: 'A', state: 'NE' },
        destination: { city: 'B', state: 'ND' },
        drops: [{ query: 'bad' }],
        weight: 1,
        length: 1,
        width: 1,
        height: 1,
      })
    ).toThrow(/missing valid lat\/lon/)
  })
})

describe('POST /api/optimize-route', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    mockProcessPermitRequest.mockReset()
    mockEnrichOrToolsResponseWithEscorts.mockReset()
    mockEnrichOrToolsResponseWithEscorts.mockImplementation(async (data) => data)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('falls back to OSRM with query and normalized drops when OR-Tools is unreachable', async () => {
    mockProcessPermitRequest.mockResolvedValue({
      status: 'pending_review',
      options: [
        {
          routeCorridor: ['NE', 'ND'],
          permitRequiredStates: [],
          reasons: [],
          notes: ['OSRM leg'],
          estimatedCost: 0,
        },
      ],
      loadDetails: {},
    })

    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('ECONNREFUSED 127.0.0.1:8000'))
    )

    const req = new NextRequest('http://localhost/api/optimize-route', {
      method: 'POST',
      body: JSON.stringify({
        origin: { query: 'Grand Island, NE', city: 'Grand Island', state: 'NE' },
        destination: { query: 'Dickinson, ND', city: 'Dickinson', state: 'ND' },
        drops: [{ query: 'Minot', lat: '48.232', lon: '-101.296', city: 'Minot', state: 'ND' }],
        weight: 80000,
        length: 74,
        width: 8.5,
        height: 13.5,
        originLat: 40.9,
        originLon: -98.3,
        destinationLat: 46.9,
        destinationLon: -102.8,
      }),
    })

    const res = await POST(req)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.fallback).toBe(true)
    expect(mockProcessPermitRequest).toHaveBeenCalledTimes(1)

    const loadArg = mockProcessPermitRequest.mock.calls[0][0]
    expect(loadArg.origin.query).toBe('Grand Island, NE')
    expect(loadArg.drops).toHaveLength(1)
    expect(loadArg.drops[0].lat).toBe(48.232)
  })

  it('returns 400 for invalid drops payload', async () => {
    const req = new NextRequest('http://localhost/api/optimize-route', {
      method: 'POST',
      body: JSON.stringify({
        origin: { city: 'A', state: 'NE' },
        destination: { city: 'B', state: 'ND' },
        drops: [{ query: 'missing coords' }],
        weight: 1,
        length: 1,
        width: 1,
        height: 1,
      }),
    })

    const res = await POST(req)
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toContain('missing valid lat/lon')
    expect(mockProcessPermitRequest).not.toHaveBeenCalled()
  })

  it('post-processes successful OR-Tools response with escort enrichment', async () => {
    const ortoolsPayload = {
      status: 'ok',
      primary: { routeCorridor: ['NE', 'ND'], permitReady: true },
      alternatives: [],
    }

    const enrichedPayload = {
      ...ortoolsPayload,
      primary: {
        ...ortoolsPayload.primary,
        escortRequiredStates: ['NE'],
        escortWarnings: ['NE: 1 escort recommended'],
      },
    }

    mockEnrichOrToolsResponseWithEscorts.mockResolvedValue(enrichedPayload)

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ortoolsPayload,
      })
    )

    const req = new NextRequest('http://localhost/api/optimize-route', {
      method: 'POST',
      body: JSON.stringify({
        origin: { city: 'Grand Island', state: 'NE' },
        destination: { city: 'Dickinson', state: 'ND' },
        weight: 80000,
        length: 74,
        width: 12.58,
        height: 13.5,
      }),
    })

    const res = await POST(req)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(mockEnrichOrToolsResponseWithEscorts).toHaveBeenCalledTimes(1)
    expect(body.primary.escortRequiredStates).toEqual(['NE'])
    expect(body.primary.escortWarnings).toContain('NE: 1 escort recommended')
    expect(mockProcessPermitRequest).not.toHaveBeenCalled()
  })
})