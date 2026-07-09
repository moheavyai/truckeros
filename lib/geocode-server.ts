/**
 * Server-side geocode helpers (extracted for testing + route handler).
 */

import {
  normalizeRoadName,
  resultCityName,
  roadNamesMatch,
  tokenizeForMatch,
  type ParsedGeocodeQuery,
} from '@/lib/geocode-query'
import { extractAddressFromGeocodeResult } from '@/lib/location-stop'
import { STATE_CODE_TO_NAME } from '@/lib/us-states'

export const GEOCODE_BUSY_USER_MESSAGE =
  'Geocoding service is busy — try again or enter coordinates manually'

export const MAX_Q_LEN = 500
export const MAX_FIELD_LEN = 200
export const MAX_CACHE_ENTRIES = 500
export const CACHE_TTL_MS = 60 * 1000

export { STATE_CODE_TO_NAME } from '@/lib/us-states'

const ZIP_RE = /^\d{5}(?:-\d{4})?$/

export type GeocodeInput = {
  q?: string
  city?: string
  street?: string
  zip?: string
  state?: string | null
  limit?: string
}

export type GeocodeDto = {
  lat: string
  lon: string
  display_name?: string
  address?: {
    house_number?: string
    road?: string
    street?: string
    city?: string
    town?: string
    village?: string
    hamlet?: string
    municipality?: string
    state?: string
    state_code?: string
    postcode?: string
    'ISO3166-2-lvl4'?: string
  }
}

export function normalizeStateCode(raw: string | null | undefined): string | null {
  if (!raw) return null
  const code = raw.trim().toUpperCase()
  return code.length === 2 && STATE_CODE_TO_NAME[code] ? code : null
}

export function clampLimit(raw: string | null | undefined): string {
  const n = Number(raw || '1')
  if (!Number.isFinite(n)) return '1'
  return String(Math.min(5, Math.max(1, Math.floor(n))))
}

export function validateGeocodeInput(input: GeocodeInput): { ok: true; value: Required<Pick<GeocodeInput, 'limit'>> & GeocodeInput } | { ok: false; userMessage: string } {
  const city = (input.city || '').trim().slice(0, MAX_FIELD_LEN)
  const street = (input.street || '').trim().slice(0, MAX_FIELD_LEN)
  const zip = (input.zip || '').trim().slice(0, MAX_FIELD_LEN)
  const stateParam = normalizeStateCode(input.state ?? null)
  const limit = clampLimit(input.limit)

  let query = (input.q || '').trim().slice(0, MAX_Q_LEN)

  if (zip && !ZIP_RE.test(zip)) {
    return { ok: false, userMessage: 'Invalid zip code. Use 5 digits (e.g. 58601).' }
  }

  if (!query && zip && ZIP_RE.test(zip)) {
    query = `${zip}, United States`
  }
  if (!query && city && stateParam) {
    const stateName = STATE_CODE_TO_NAME[stateParam]
    query = street
      ? `${street}, ${city}, ${stateName}, United States`
      : `${city}, ${stateName}, United States`
  }
  if (!query && street && !city && !stateParam) {
    query = `${street}, United States`
  }

  if (!query && !(city && stateParam) && !zip) {
    return { ok: false, userMessage: 'Enter an address, business name, or zip to geocode.' }
  }

  if (!query) {
    return { ok: false, userMessage: 'Could not build a geocode query from the provided input.' }
  }

  return { ok: true, value: { q: query, city, street, zip, state: stateParam, limit } }
}

export function buildCacheKey(value: GeocodeInput & { q: string; limit: string }): string {
  return `${value.q}|city=${value.city || ''}|street=${value.street || ''}|zip=${value.zip || ''}|state=${value.state || ''}|limit=${value.limit}`
}

export function resultMatchesState(result: GeocodeDto, stateCode: string): boolean {
  const addr = result?.address || {}
  const iso = String(addr['ISO3166-2-lvl4'] || '').toUpperCase()
  if (iso === `US-${stateCode}`) return true

  const expectedName = STATE_CODE_TO_NAME[stateCode]?.toLowerCase()
  const resultState = String(addr.state || '').toLowerCase()
  if (expectedName && resultState === expectedName) return true

  const short = String(addr.state_code || '').toUpperCase()
  if (short === stateCode) return true

  return false
}

export type GeocodeRankingContext = Partial<ParsedGeocodeQuery>

function cityMatchesResult(city: string, addr: GeocodeDto['address']): boolean {
  if (!city || !addr) return false
  const target = city.trim().toLowerCase()
  const resultCity = resultCityName(addr).trim().toLowerCase()
  return resultCity === target || resultCity.includes(target) || target.includes(resultCity)
}

/** Fuzzy score for ranking Nominatim candidates (higher is better). */
export function scoreGeocodeResult(result: GeocodeDto, context: GeocodeRankingContext): number {
  let score = 0
  const addr = result.address || {}
  const display = String(result.display_name || '').toLowerCase()

  if (context.state && resultMatchesState(result, context.state)) score += 100

  if (context.city && cityMatchesResult(context.city, addr)) score += 50

  if (context.zip) {
    const postcode = String(addr.postcode || '').trim()
    if (postcode.startsWith(context.zip)) score += 80
  }

  if (context.businessName) {
    const tokens = tokenizeForMatch(context.businessName)
    if (tokens.length > 0) {
      const matched = tokens.filter((t) => display.includes(t)).length
      score += (matched / tokens.length) * 40
    }
  }

  if (context.street) {
    const road = addr.road || addr.street || ''
    if (roadNamesMatch(context.street, road)) score += 60

    const houseMatch = context.street.match(/^(\d{1,6})\b/)
    const resultHouse = String(addr.house_number || '')
    if (houseMatch && resultHouse && houseMatch[1] === resultHouse) score += 30
  } else if (context.normalized) {
    const norm = normalizeRoadName(context.normalized)
    const road = normalizeRoadName(addr.road || addr.street || '')
    if (norm && road && (norm.includes(road) || road.includes(norm))) score += 20
  }

  const importance = Number((result as GeocodeDto & { importance?: number }).importance)
  if (Number.isFinite(importance)) score += importance * 10

  return score
}

export function rankResults(
  data: GeocodeDto[],
  stateCode: string | null,
  context: GeocodeRankingContext = {},
): GeocodeDto[] {
  if (!Array.isArray(data) || data.length === 0) return []

  const ctx: GeocodeRankingContext = {
    ...context,
    state: context.state ?? stateCode ?? null,
  }

  let pool = data
  if (ctx.state) {
    const inState = data.filter((r) => resultMatchesState(r, ctx.state!))
    if (inState.length > 0) pool = inState
  }

  return [...pool].sort((a, b) => scoreGeocodeResult(b, ctx) - scoreGeocodeResult(a, ctx))
}

export function toGeocodeDto(result: Record<string, unknown>): GeocodeDto | null {
  const parsed = extractAddressFromGeocodeResult({
    lat: result.lat as string | number,
    lon: result.lon as string | number,
    display_name: result.display_name as string | undefined,
    address: result.address as Record<string, string | undefined> | undefined,
  })
  if (!parsed) return null
  return {
    lat: String(parsed.lat),
    lon: String(parsed.lon),
    display_name: parsed.displayName,
    address: {
      road: parsed.street,
      city: parsed.city,
      state_code: parsed.state,
      postcode: parsed.zip,
      'ISO3166-2-lvl4': parsed.state ? `US-${parsed.state}` : undefined,
    },
  }
}

export function stripNominatimResults(rows: Record<string, unknown>[]): GeocodeDto[] {
  return rows.map((r) => toGeocodeDto(r)).filter((r): r is GeocodeDto => r != null)
}

/** Simple LRU cache */
export class LruGeocodeCache {
  private map = new Map<string, { data: GeocodeDto[]; timestamp: number }>()

  get(key: string): GeocodeDto[] | null {
    const entry = this.map.get(key)
    if (!entry) return null
    if (Date.now() - entry.timestamp >= CACHE_TTL_MS) {
      this.map.delete(key)
      return null
    }
    this.map.delete(key)
    this.map.set(key, entry)
    return entry.data
  }

  set(key: string, data: GeocodeDto[]) {
    if (this.map.has(key)) this.map.delete(key)
    this.map.set(key, { data, timestamp: Date.now() })
    while (this.map.size > MAX_CACHE_ENTRIES) {
      const oldest = this.map.keys().next().value
      if (oldest) this.map.delete(oldest)
    }
  }

  clear() {
    this.map.clear()
  }
}

/** Token bucket rate limiter per IP with TTL + max-bucket eviction */
export class TokenBucketRateLimiter {
  private buckets = new Map<string, { tokens: number; lastRefill: number; lastAccess: number }>()

  constructor(
    private readonly maxTokens = 3,
    private readonly refillMs = 1000,
    private readonly maxBuckets = 10_000,
    private readonly bucketTtlMs = 60 * 60 * 1000,
  ) {}

  private evictStale(now: number) {
    for (const [key, bucket] of this.buckets) {
      if (now - bucket.lastAccess > this.bucketTtlMs) {
        this.buckets.delete(key)
      }
    }
    while (this.buckets.size > this.maxBuckets) {
      let oldestKey: string | null = null
      let oldestAccess = Infinity
      for (const [key, bucket] of this.buckets) {
        if (bucket.lastAccess < oldestAccess) {
          oldestAccess = bucket.lastAccess
          oldestKey = key
        }
      }
      if (!oldestKey) break
      this.buckets.delete(oldestKey)
    }
  }

  tryConsume(key: string): { allowed: boolean; retryAfterSec?: number } {
    const now = Date.now()
    this.evictStale(now)

    let bucket = this.buckets.get(key)
    if (!bucket) {
      bucket = { tokens: this.maxTokens - 1, lastRefill: now, lastAccess: now }
      this.buckets.set(key, bucket)
      return { allowed: true }
    }

    bucket.lastAccess = now
    const elapsed = now - bucket.lastRefill
    const refill = Math.floor(elapsed / this.refillMs)
    if (refill > 0) {
      bucket.tokens = Math.min(this.maxTokens, bucket.tokens + refill)
      bucket.lastRefill = now
    }

    if (bucket.tokens <= 0) {
      const retryAfterSec = Math.ceil((this.refillMs - (now - bucket.lastRefill)) / 1000)
      return { allowed: false, retryAfterSec: Math.max(1, retryAfterSec) }
    }

    bucket.tokens -= 1
    return { allowed: true }
  }

  reset() {
    this.buckets.clear()
  }
}