import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildGeocodeParams,
  fetchGeocodeWithRetry,
  isAddressReadyForGeocode,
  isGeocodeFailure,
} from './geocode-client'

describe('geocode-client params', () => {
  it('sends freetext q for business-name pickup', () => {
    const params = buildGeocodeParams({
      id: '1',
      query: 'Case IH plant, Grand Island, NE',
      street: 'resolved street',
      city: 'Grand Island',
      state: 'NE',
      zip: '',
    })
    expect(params.get('q')).toBe('Case IH plant, Grand Island, NE')
    expect(params.get('city')).toBeNull()
    expect(params.get('state')).toBe('NE')
  })

  it('sends state hint from query when structured state absent', () => {
    const params = buildGeocodeParams({
      id: '1',
      query: 'Northern Plains Equipment, Minot, ND',
      street: '',
      city: '',
      state: '',
      zip: '',
    })
    expect(params.get('state')).toBe('ND')
  })

  it('marks test addresses ready for geocode', () => {
    const addresses = [
      'Case IH plant, Grand Island, NE',
      'Northern Plains Equipment, 1915 US-2, Minot, ND',
      'West Plains, 3484 I94 Business Loop E, Dickinson, ND',
      'West Plains Dickinson I94 Business Loop E',
    ]
    for (const query of addresses) {
      expect(
        isAddressReadyForGeocode({ id: '1', query, street: '', city: '', state: '', zip: '' })
      ).toBe(true)
    }
  })
})

describe('fetchGeocodeWithRetry', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns success with parsed address', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => [
          {
            lat: '48.232',
            lon: '-101.296',
            display_name: 'Minot',
            address: { city: 'Minot', state_code: 'ND', postcode: '58701' },
          },
        ],
      })
    )

    const result = await fetchGeocodeWithRetry({
      id: '1',
      query: 'Minot, ND',
      street: '',
      city: '',
      state: '',
      zip: '',
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.state).toBe('ND')
      expect(result.city).toBe('Minot')
    }
  })

  it('does not retry 404', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ userMessage: 'No location found' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchGeocodeWithRetry({
      id: '1',
      query: 'nowhere',
      street: '',
      city: '',
      state: '',
      zip: '',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.retryable).toBe(false)
      expect(isGeocodeFailure(result)).toBe(true)
    }
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('returns 400 without retry', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ userMessage: 'Invalid zip code' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchGeocodeWithRetry({
      id: '1',
      query: 'bad',
      street: '',
      city: '',
      state: '',
      zip: '',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.userMessage).toContain('Invalid zip')
      expect(result.retryable).toBe(false)
    }
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('returns 401 without retry', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ userMessage: 'Unauthorized' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchGeocodeWithRetry({
      id: '1',
      query: 'Minot, ND',
      street: '',
      city: '',
      state: '',
      zip: '',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.userMessage).toContain('logged in')
      expect(result.retryable).toBe(false)
    }
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('fails on empty array without retry', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [],
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchGeocodeWithRetry({
      id: '1',
      query: 'Minot, ND',
      street: '',
      city: '',
      state: '',
      zip: '',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.userMessage).toContain('No location found')
      expect(result.retryable).toBe(false)
    }
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('retries 429 then succeeds', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 429, json: async () => ({}) })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [{ lat: '46.9', lon: '-102.8', address: { city: 'Dickinson', state_code: 'ND' } }],
      })
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchGeocodeWithRetry({
      id: '1',
      query: 'Dickinson, ND',
      street: '',
      city: '',
      state: '',
      zip: '',
    })
    expect(result.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('retries 500 then fails', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ userMessage: 'Server error' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchGeocodeWithRetry({
      id: '1',
      query: 'Minot, ND',
      street: '',
      city: '',
      state: '',
      zip: '',
    })
    expect(result.ok).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('retries network throw then fails retryable', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('network down'))
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchGeocodeWithRetry({
      id: '1',
      query: 'Minot, ND',
      street: '',
      city: '',
      state: '',
      zip: '',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.retryable).toBe(true)
    }
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})