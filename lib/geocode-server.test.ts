import { describe, expect, it } from 'vitest'
import {
  LruGeocodeCache,
  TokenBucketRateLimiter,
  clampLimit,
  isStrongGeocodeMatch,
  rankResults,
  scoreGeocodeResult,
  validateGeocodeInput,
  type GeocodeDto,
} from './geocode-server'

describe('validateGeocodeInput', () => {
  it('rejects invalid zip', () => {
    const result = validateGeocodeInput({ zip: 'abcde' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.userMessage).toContain('Invalid zip')
  })

  it('accepts zip-only query', () => {
    const result = validateGeocodeInput({ zip: '58601' })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.q).toBe('58601, United States')
  })

  it('rejects empty input', () => {
    const result = validateGeocodeInput({})
    expect(result.ok).toBe(false)
  })

  it('clamps limit to 1..5', () => {
    expect(clampLimit('99')).toBe('5')
    expect(clampLimit('0')).toBe('1')
  })
})

describe('LruGeocodeCache', () => {
  it('evicts oldest entries beyond max size', () => {
    const cache = new LruGeocodeCache()
    const dto = [{ lat: '1', lon: '2' }]
    for (let i = 0; i < 510; i++) {
      cache.set(`k${i}`, dto)
    }
    expect(cache.get('k0')).toBeNull()
    expect(cache.get('k509')).toEqual(dto)
  })
})

describe('rankResults / scoreGeocodeResult', () => {
  const dickinsonLoop: GeocodeDto = {
    lat: '46.8798699',
    lon: '-102.7580113',
    display_name: 'Interstate 94 Business Loop East, Dickinson, ND',
    address: {
      road: 'Interstate 94 Business Loop East',
      city: 'Dickinson',
      state: 'North Dakota',
      'ISO3166-2-lvl4': 'US-ND',
    },
  }

  const dickinsonHwy10: GeocodeDto = {
    lat: '46.8879607',
    lon: '-102.7275527',
    display_name: 'West Plains, Highway 10, Dickinson, ND',
    address: {
      road: 'Highway 10',
      city: 'Dickinson',
      state: 'North Dakota',
      'ISO3166-2-lvl4': 'US-ND',
    },
  }

  it('prefers interstate loop when street mentions I-94', () => {
    const ranked = rankResults([dickinsonHwy10, dickinsonLoop], 'ND', {
      street: 'I-94 Business Loop East',
      city: 'Dickinson',
      state: 'ND',
    })
    expect(ranked[0].address?.road).toMatch(/Interstate 94 Business Loop East/i)
  })

  it('scores state and road matches higher', () => {
    const loopScore = scoreGeocodeResult(dickinsonLoop, {
      street: '3484 I-94 Business Loop East',
      city: 'Dickinson',
      state: 'ND',
    })
    const hwyScore = scoreGeocodeResult(dickinsonHwy10, {
      street: '3484 I-94 Business Loop East',
      city: 'Dickinson',
      state: 'ND',
    })
    expect(loopScore).toBeGreaterThan(hwyScore)
  })
})

describe('Kansas City metro ranking', () => {
  const moWestportRoad: GeocodeDto = {
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
  } as GeocodeDto & { importance: number }

  const ksForterraBuilding: GeocodeDto = {
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
  } as GeocodeDto & { importance: number }

  const kcContext = {
    street: '23600 W 40th St',
    city: 'Kansas City',
    state: 'KS' as const,
    zip: '66226',
  }

  it('prefers the KS house-numbered building over the MO Westport road', () => {
    const ranked = rankResults([moWestportRoad, ksForterraBuilding], 'KS', kcContext)
    expect(ranked.length).toBeGreaterThan(0)
    expect(Number(ranked[0].lat)).toBeCloseTo(39.05726, 4)
    expect(ranked[0].address?.house_number).toBe('23600')
    expect(ranked[0].address?.['ISO3166-2-lvl4']).toBe('US-KS')
    expect(ranked.some((r) => r.address?.['ISO3166-2-lvl4'] === 'US-MO')).toBe(false)
  })

  it('still picks the KS building when zip is omitted', () => {
    const ranked = rankResults([moWestportRoad, ksForterraBuilding], 'KS', {
      street: '23600 W 40th St',
      city: 'Kansas City',
      state: 'KS',
    })
    expect(ranked[0].address?.house_number).toBe('23600')
    expect(Number(ranked[0].lon)).toBeCloseTo(-94.86007, 4)
  })

  it('returns empty when the batch is only the other Kansas City', () => {
    const ranked = rankResults([moWestportRoad], 'KS', {
      street: '23600 W 40th St',
      city: 'Kansas City',
      state: 'KS',
    })
    expect(ranked).toEqual([])
  })

  it('prefers the KS building over an in-state road-only West 40th with matching city+zip', () => {
    const ksWest40thRoad: GeocodeDto = {
      lat: '39.0571',
      lon: '-94.86',
      display_name: 'West 40th Street, Kansas City, Kansas, 66226, United States',
      address: {
        road: 'West 40th Street',
        city: 'Kansas City',
        state: 'Kansas',
        'ISO3166-2-lvl4': 'US-KS',
        postcode: '66226',
      },
      importance: 0.72,
    } as GeocodeDto & { importance: number }

    const ranked = rankResults([ksWest40thRoad, ksForterraBuilding], 'KS', kcContext)
    expect(ranked[0].address?.house_number).toBe('23600')
    expect(Number(ranked[0].lat)).toBeCloseTo(39.05726, 4)
  })

  it('does not treat a MO house+street hit as strong when state is KS', () => {
    const moHouseHit: GeocodeDto = {
      ...moWestportRoad,
      address: {
        ...moWestportRoad.address,
        house_number: '23600',
      },
      display_name: '23600 West 40th Street, Kansas City, Missouri, United States',
    }
    expect(
      isStrongGeocodeMatch(moHouseHit, {
        street: '23600 W 40th St',
        city: 'Kansas City',
        state: 'KS',
      }),
    ).toBe(false)
    expect(
      isStrongGeocodeMatch(ksForterraBuilding, {
        street: '23600 W 40th St',
        city: 'Kansas City',
        state: 'KS',
      }),
    ).toBe(true)
  })
})

describe('TokenBucketRateLimiter', () => {
  it('blocks after burst exhausted', () => {
    const limiter = new TokenBucketRateLimiter(2, 1000)
    expect(limiter.tryConsume('ip').allowed).toBe(true)
    expect(limiter.tryConsume('ip').allowed).toBe(true)
    const blocked = limiter.tryConsume('ip')
    expect(blocked.allowed).toBe(false)
    expect(blocked.retryAfterSec).toBeGreaterThan(0)
  })

  it('evicts stale bucket entries by TTL', () => {
    const limiter = new TokenBucketRateLimiter(1, 1000, 100, 50)
    expect(limiter.tryConsume('stale-ip').allowed).toBe(true)

    const buckets = (limiter as unknown as { buckets: Map<string, { lastAccess: number }> }).buckets
    const entry = buckets.get('stale-ip')
    expect(entry).toBeTruthy()
    entry!.lastAccess = Date.now() - 100

    expect(limiter.tryConsume('fresh-ip').allowed).toBe(true)
    expect(buckets.has('stale-ip')).toBe(false)
  })
})