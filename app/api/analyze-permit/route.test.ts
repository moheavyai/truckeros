import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from './route'

const mockProcessPermitRequest = vi.fn()
const mockSavePermitRequestForUser = vi.fn()

vi.mock('@/agents/permit-agent', () => ({
  processPermitRequest: (...args: unknown[]) => mockProcessPermitRequest(...args),
}))

vi.mock('@/lib/permit-requests', () => ({
  savePermitRequestForUser: (...args: unknown[]) => mockSavePermitRequestForUser(...args),
}))

describe('POST /api/analyze-permit', () => {
  beforeEach(() => {
    mockProcessPermitRequest.mockReset()
    mockSavePermitRequestForUser.mockReset()
    mockProcessPermitRequest.mockResolvedValue({
      status: 'pending_review',
      options: [{ routeCorridor: ['NE', 'ND'], permitRequiredStates: [], reasons: [], notes: [] }],
    })
    mockSavePermitRequestForUser.mockResolvedValue({ id: 'saved-1', user_id: 'u1', created_at: '2026-01-01' })
  })

  it('passes normalized string lat/lon drops to the agent', async () => {
    const req = new NextRequest('http://localhost/api/analyze-permit', {
      method: 'POST',
      body: JSON.stringify({
        origin: { city: 'Grand Island', state: 'NE' },
        destination: { city: 'Dickinson', state: 'ND' },
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
    expect(res.status).toBe(200)
    expect(mockProcessPermitRequest).toHaveBeenCalledTimes(1)

    const loadArg = mockProcessPermitRequest.mock.calls[0][0]
    expect(loadArg.drops).toHaveLength(1)
    expect(loadArg.drops[0].lat).toBe(48.232)
    expect(loadArg.drops[0].lon).toBe(-101.296)
  })

  it('passes axle, equipment, and grossLoadedWeight through to the agent', async () => {
    const req = new NextRequest('http://localhost/api/analyze-permit', {
      method: 'POST',
      body: JSON.stringify({
        origin: { city: 'Grand Island', state: 'NE' },
        destination: { city: 'Dickinson', state: 'ND' },
        weight: 70_000,
        grossLoadedWeight: 95_000,
        length: 74,
        width: 8.5,
        height: 13.5,
        axles: 5,
        axleWeights: [12_000, 20_000, 20_000, 21_500, 21_500],
        equipment: {
          tractor: { num_axles: 3 },
          trailers: [{ num_axles: 2, trailer_type: 'RGN' }],
        },
        originLat: 40.9,
        originLon: -98.3,
        destinationLat: 46.9,
        destinationLon: -102.8,
      }),
    })

    const res = await POST(req)
    expect(res.status).toBe(200)
    const loadArg = mockProcessPermitRequest.mock.calls[0][0]
    expect(loadArg.weight).toBe(95_000)
    expect(loadArg.axles).toBe(5)
    expect(loadArg.axleWeights).toEqual([12_000, 20_000, 20_000, 21_500, 21_500])
    expect(loadArg.equipment?.tractor?.num_axles).toBe(3)
    expect(loadArg.equipment?.trailers?.[0]?.trailer_type).toBe('RGN')
  })

  it('returns 400 when drops lack coordinates', async () => {
    const req = new NextRequest('http://localhost/api/analyze-permit', {
      method: 'POST',
      body: JSON.stringify({
        origin: { city: 'A', state: 'NE' },
        destination: { city: 'B', state: 'ND' },
        drops: [{ query: 'bad' }],
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

  it('autoSave forwards border_crossings and highways from primary option', async () => {
    const crossings = [
      {
        fromState: 'NE',
        toState: 'SD',
        entry: { lat: 42.99, lon: -98.52, highway: 'US-281' },
        exit: { lat: 45.91, lon: -100.05, highway: 'US-83' },
      },
    ]
    mockProcessPermitRequest.mockResolvedValue({
      status: 'pending_review',
      options: [
        {
          routeCorridor: ['NE', 'SD', 'ND'],
          permitRequiredStates: ['NE', 'ND'],
          reasons: ['oversize'],
          notes: [],
          borderCrossings: crossings,
          highways: ['US-281', 'I-94'],
          estimatedCost: 120,
          costBreakdown: null,
          distanceMiles: 500,
          durationHours: 9,
        },
      ],
    })

    const req = new NextRequest('http://localhost/api/analyze-permit', {
      method: 'POST',
      headers: { Authorization: 'Bearer test-token' },
      body: JSON.stringify({
        autoSave: true,
        origin: { city: 'Grand Island', state: 'NE' },
        destination: { city: 'Dickinson', state: 'ND' },
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
    expect(body.saved).toBe(true)
    expect(mockSavePermitRequestForUser).toHaveBeenCalledTimes(1)
    const savePayload = mockSavePermitRequestForUser.mock.calls[0][0]
    expect(savePayload.border_crossings).toEqual(crossings)
    expect(savePayload.highways).toEqual(['US-281', 'I-94'])
    expect(savePayload.route_corridor).toEqual(['NE', 'SD', 'ND'])
    expect(mockSavePermitRequestForUser.mock.calls[0][1]).toBe('test-token')
  })

  it('autoSave defaults border_crossings and highways to [] when primary omits them', async () => {
    mockProcessPermitRequest.mockResolvedValue({
      status: 'pending_review',
      options: [
        {
          routeCorridor: ['NE', 'ND'],
          permitRequiredStates: [],
          reasons: [],
          notes: [],
          // borderCrossings / highways intentionally omitted
        },
      ],
    })

    const req = new NextRequest('http://localhost/api/analyze-permit', {
      method: 'POST',
      headers: { Authorization: 'Bearer tok' },
      body: JSON.stringify({
        autoSave: true,
        origin: { city: 'A', state: 'NE' },
        destination: { city: 'B', state: 'ND' },
        weight: 1,
        length: 1,
        width: 1,
        height: 1,
        originLat: 40.9,
        originLon: -98.3,
        destinationLat: 46.9,
        destinationLon: -102.8,
      }),
    })

    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(mockSavePermitRequestForUser).toHaveBeenCalledTimes(1)
    const savePayload = mockSavePermitRequestForUser.mock.calls[0][0]
    expect(savePayload.border_crossings).toEqual([])
    expect(savePayload.highways).toEqual([])
  })
})