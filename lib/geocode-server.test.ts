import { describe, expect, it } from 'vitest'
import {
  LruGeocodeCache,
  TokenBucketRateLimiter,
  clampLimit,
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