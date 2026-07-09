import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GET } from './route'

describe('GET /api/ortools-health', () => {
  const originalEnv = process.env.ORTOOLS_SERVICE_URL

  beforeEach(() => {
    vi.restoreAllMocks()
    process.env.ORTOOLS_SERVICE_URL = 'http://127.0.0.1:8000/optimize-route'
  })

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.ORTOOLS_SERVICE_URL
    } else {
      process.env.ORTOOLS_SERVICE_URL = originalEnv
    }
  })

  it('returns connected when upstream health is ok', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ status: 'ok', service: 'or-tools', version: '1.0.0', buildId: 'abc123def456' }),
      })
    )

    const res = await GET()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({
      connected: true,
      status: 'connected',
      message: 'Service healthy',
      version: '1.0.0',
      buildId: 'abc123def456',
    })
    expect(fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:8000/health',
      expect.objectContaining({
        method: 'GET',
        cache: 'no-store',
        signal: expect.any(AbortSignal),
      })
    )
  })

  it('returns unreachable on non-ok HTTP status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
      })
    )

    const res = await GET()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.connected).toBe(false)
    expect(body.status).toBe('unreachable')
    expect(body.message).toBe('OR-Tools service unreachable')
    expect(fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    )
  })

  it('returns unreachable when body status is not ok', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ status: 'degraded' }),
      })
    )

    const res = await GET()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.connected).toBe(false)
    expect(body.status).toBe('unreachable')
    expect(body.message).toContain('unexpected health response')
  })

  it('returns unreachable on connection refused', async () => {
    const err = Object.assign(new Error('fetch failed'), { code: 'ECONNREFUSED' })
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(err))

    const res = await GET()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.connected).toBe(false)
    expect(body.status).toBe('unreachable')
    expect(body.message).toBe('OR-Tools service unreachable — check that the service is running')
  })

  it('returns unreachable on timeout', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }))
    )

    const res = await GET()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.connected).toBe(false)
    expect(body.status).toBe('unreachable')
    expect(body.message).toBe('Health check timed out (5s)')
    expect(fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    )
  })
})