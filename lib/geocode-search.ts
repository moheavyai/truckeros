/**
 * Shared Nominatim variant walk + ranking for /api/geocode and the agent.
 */

import {
  isStrongGeocodeMatch,
  queryHouseNumber,
  rankResults,
  resultHasHouseNumber,
  scoreGeocodeResult,
  toGeocodeDto,
  type GeocodeDto,
  type GeocodeRankingContext,
} from '@/lib/geocode-server'
import type { GeocodeSearchVariant } from '@/lib/geocode-query'
import {
  NOMINATIM_BASE_URL,
  NOMINATIM_CONTACT_EMAIL,
  nominatimHeaders,
} from '@/lib/nominatim-config'
import { STATE_CODE_TO_NAME } from '@/lib/us-states'

export const NOMINATIM_SEARCH_LIMIT = '5'
export const GEOCODE_NO_LOCATION_MESSAGE =
  'No location found. Try again or enter coordinates manually.'

const SERVER_MAX_ATTEMPTS = 2
const SERVER_BACKOFF_MS = [400, 900]
const COORD_DEDUP_DECIMALS = 5

type NominatimStrategy = 'structured' | 'freetext'

export type RankableGeocodeDto = GeocodeDto & { importance?: number }

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function buildNominatimUrl(
  strategy: NominatimStrategy,
  opts: {
    query: string
    city: string
    street: string
    stateParam: string | null
    limit: string
  },
): string {
  const base = new URLSearchParams({
    format: 'json',
    limit: opts.limit,
    countrycodes: 'us',
    addressdetails: '1',
    email: NOMINATIM_CONTACT_EMAIL,
  })

  if (strategy === 'structured' && opts.city && opts.stateParam) {
    base.set('city', opts.city.trim())
    base.set('state', STATE_CODE_TO_NAME[opts.stateParam])
    base.set('country', 'United States')
    if (opts.street.trim()) {
      base.set('street', opts.street.trim())
    }
  } else {
    base.set('q', opts.query)
    if (opts.stateParam) {
      base.set('state', STATE_CODE_TO_NAME[opts.stateParam])
    }
  }

  return `${NOMINATIM_BASE_URL}/search?${base.toString()}`
}

async function fetchNominatimOnce(
  url: string,
): Promise<{ ok: boolean; status: number; data: Record<string, unknown>[] | null }> {
  const res = await fetch(url, {
    headers: nominatimHeaders(),
  })

  if (!res.ok) {
    return { ok: false, status: res.status, data: null }
  }

  const data = await res.json()
  return { ok: true, status: res.status, data: Array.isArray(data) ? data : [] }
}

async function geocodeWithRetry(opts: {
  query: string
  city: string
  street: string
  stateParam: string | null
  strategies: NominatimStrategy[]
}): Promise<{ data: Record<string, unknown>[] | null; lastStatus: number }> {
  let lastStatus = 502

  for (const strategy of opts.strategies) {
    const url = buildNominatimUrl(strategy, { ...opts, limit: NOMINATIM_SEARCH_LIMIT })

    for (let attempt = 0; attempt < SERVER_MAX_ATTEMPTS; attempt++) {
      if (attempt > 0) {
        await sleep(SERVER_BACKOFF_MS[attempt - 1] ?? 900)
      }

      try {
        const result = await fetchNominatimOnce(url)
        lastStatus = result.status

        if (result.ok) {
          const rows = result.data || []
          if (rows.length > 0) {
            return { data: rows, lastStatus: 200 }
          }
          break
        }

        if (result.status === 429 || result.status >= 500) {
          continue
        }

        if (result.status === 400) {
          console.warn(`Nominatim 400 for strategy=${strategy}`)
          break
        }

        break
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error)
        console.error(`Nominatim fetch error (attempt ${attempt + 1}):`, msg)
        lastStatus = 502
      }
    }
  }

  return { data: null, lastStatus }
}

export function resultCoordKey(dto: GeocodeDto): string {
  const lat = Number(dto.lat)
  const lon = Number(dto.lon)
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return `${dto.lat}|${dto.lon}`
  return `${lat.toFixed(COORD_DEDUP_DECIMALS)}|${lon.toFixed(COORD_DEDUP_DECIMALS)}`
}

function geocodeDtoPreference(dto: GeocodeDto, context: GeocodeRankingContext): number {
  const house = queryHouseNumber(context.street)
  let n = 0
  if (isStrongGeocodeMatch(dto, context)) n += 1000
  if (house && resultHasHouseNumber(dto, house)) n += 100
  if (dto.address?.house_number) n += 10
  n += scoreGeocodeResult(dto, context)
  return n
}

export function toRankableDtos(rows: Record<string, unknown>[]): RankableGeocodeDto[] {
  const out: RankableGeocodeDto[] = []
  for (const row of rows) {
    const dto = toGeocodeDto(row)
    if (!dto) continue
    out.push({
      ...dto,
      importance: typeof row.importance === 'number' ? row.importance : undefined,
    })
  }
  return out
}

function mergeDtoIntoUnion(
  union: RankableGeocodeDto[],
  byCoord: Map<string, number>,
  dto: RankableGeocodeDto,
  context: GeocodeRankingContext,
) {
  const key = resultCoordKey(dto)
  const existingIdx = byCoord.get(key)
  if (existingIdx == null) {
    byCoord.set(key, union.length)
    union.push(dto)
    return
  }
  if (geocodeDtoPreference(dto, context) > geocodeDtoPreference(union[existingIdx], context)) {
    union[existingIdx] = dto
  }
}

export function geocodeFailureStatus(lastStatus: number): 429 | 502 | 404 {
  if (lastStatus === 429) return 429
  if (lastStatus >= 500) return 502
  return 404
}

export async function searchGeocodeWithVariants(opts: {
  variants: GeocodeSearchVariant[]
  rankingContext: GeocodeRankingContext
  stateParam: string | null
  streetFallback?: string
}): Promise<{ ranked: RankableGeocodeDto[]; lastStatus: number }> {
  const byCoord = new Map<string, number>()
  const union: RankableGeocodeDto[] = []
  let lastStatus = 502

  for (const variant of opts.variants) {
    const attempt = await geocodeWithRetry({
      query: variant.query,
      city: variant.city,
      street: variant.street || opts.streetFallback || '',
      stateParam: variant.state ?? opts.stateParam ?? null,
      strategies: [...variant.strategies],
    })

    lastStatus = attempt.lastStatus
    if (attempt.data && attempt.data.length > 0) {
      for (const dto of toRankableDtos(attempt.data)) {
        mergeDtoIntoUnion(union, byCoord, dto, opts.rankingContext)
      }
      if (union.some((dto) => isStrongGeocodeMatch(dto, opts.rankingContext))) {
        break
      }
    }

    if (lastStatus === 429) break
  }

  const ranked = rankResults(
    union,
    opts.stateParam ?? opts.rankingContext.state ?? null,
    opts.rankingContext,
  ) as RankableGeocodeDto[]

  return { ranked, lastStatus }
}
