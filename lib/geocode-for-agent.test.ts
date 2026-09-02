import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveLocationToCoords } from './geocode-for-agent'

describe('resolveLocationToCoords', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('walks past a weak MO first hit to the KS building', async () => {
    const moRoad = {
      lat: '39.05524',
      lon: '-94.60311',
      display_name: 'West 40th Street, Kansas City, Missouri, United States',
      address: {
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
          json: async () => (hasKansasCity ? [moRoad] : [ksBuilding]),
        }
      }),
    )

    const result = await resolveLocationToCoords({
      query: '23600 w 40th st, kansas city, ks',
      state: 'KS',
    })
    expect(result).not.toBeNull()
    expect(result?.lat).toBeCloseTo(39.05726, 4)
    expect(result?.source).toBe('geocoded')
  })
})
