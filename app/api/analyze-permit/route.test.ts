import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from './route'

const mockProcessPermitRequest = vi.fn()

vi.mock('@/agents/permit-agent', () => ({
  processPermitRequest: (...args: unknown[]) => mockProcessPermitRequest(...args),
}))

describe('POST /api/analyze-permit', () => {
  beforeEach(() => {
    mockProcessPermitRequest.mockReset()
    mockProcessPermitRequest.mockResolvedValue({
      status: 'pending_review',
      options: [{ routeCorridor: ['NE', 'ND'], permitRequiredStates: [], reasons: [], notes: [] }],
    })
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
})