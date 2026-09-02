/**
 * Geocode API route implementation (extracted so route.ts only exports GET).
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  GEOCODE_BUSY_USER_MESSAGE,
  LruGeocodeCache,
  TokenBucketRateLimiter,
  buildCacheKey,
  isStrongGeocodeMatch,
  rankResults,
  toGeocodeDto,
  validateGeocodeInput,
  type GeocodeDto,
  type GeocodeRankingContext,
} from '@/lib/geocode-server'
import { buildGeocodeSearchVariants, parseNaturalLanguageQuery } from '@/lib/geocode-query'
import {
  NOMINATIM_BASE_URL,
  NOMINATIM_CONTACT_EMAIL,
  nominatimHeaders,
} from '@/lib/nominatim-config'
import { STATE_CODE_TO_NAME } from '@/lib/us-states'

const geocodeCache = new LruGeocodeCache()
const rateLimiter = new TokenBucketRateLimiter(3, 1000)

const SERVER_MAX_ATTEMPTS = 2
const SERVER_BACKOFF_MS = [400, 900]
const NOMINATIM_SEARCH_LIMIT = '5'
const COORD_DEDUP_DECIMALS = 5

type NominatimStrategy = 'structured' | 'freetext'

type GeocodeAttemptOpts = {
  query: string
  city: string
  street: string
  stateParam: string | null
  limit: string
  strategies: NominatimStrategy[]
}

type RankableGeocodeDto = GeocodeDto & { importance?: number }

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
  }
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

async function fetchNominatimOnce(url: string): Promise<{ ok: boolean; status: number; data: Record<string, unknown>[] | null }> {
  const res = await fetch(url, {
    headers: nominatimHeaders(),
  })

  if (!res.ok) {
    return { ok: false, status: res.status, data: null }
  }

  const data = await res.json()
  return { ok: true, status: res.status, data: Array.isArray(data) ? data : [] }
}

async function geocodeWithRetry(
  opts: GeocodeAttemptOpts,
): Promise<{ data: Record<string, unknown>[] | null; lastStatus: number }> {
  let lastStatus = 502

  for (const strategy of opts.strategies) {
    const url = buildNominatimUrl(strategy, opts)

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

function resultCoordKey(dto: GeocodeDto): string {
  const lat = Number(dto.lat)
  const lon = Number(dto.lon)
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return `${dto.lat}|${dto.lon}`
  return `${lat.toFixed(COORD_DEDUP_DECIMALS)}|${lon.toFixed(COORD_DEDUP_DECIMALS)}`
}

function toRankableDtos(rows: Record<string, unknown>[]): RankableGeocodeDto[] {
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

function clientIp(request: NextRequest): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'
  )
}

export async function handleGeocodeGet(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json(
      { error: 'Unauthorized', userMessage: 'You must be logged in to geocode addresses.' },
      { status: 401 }
    )
  }

  const ip = clientIp(request)
  const rate = rateLimiter.tryConsume(ip)
  if (!rate.allowed) {
    return NextResponse.json(
      { error: GEOCODE_BUSY_USER_MESSAGE, userMessage: GEOCODE_BUSY_USER_MESSAGE },
      { status: 429, headers: { 'Retry-After': String(rate.retryAfterSec ?? 1) } }
    )
  }

  const { searchParams } = new URL(request.url)
  const validated = validateGeocodeInput({
    q: searchParams.get('q') || undefined,
    city: searchParams.get('city') || undefined,
    street: searchParams.get('street') || undefined,
    zip: searchParams.get('zip') || undefined,
    state: searchParams.get('state'),
    limit: searchParams.get('limit') || undefined,
  })

  if (validated.ok === false) {
    return NextResponse.json(
      { error: validated.userMessage, userMessage: validated.userMessage },
      { status: 400 }
    )
  }

  const { q: query, city, street, zip, state: stateParam, limit } = validated.value
  const cacheKey = buildCacheKey({ q: query, city, street, zip, state: stateParam, limit })
  const cached = geocodeCache.get(cacheKey)
  if (cached) {
    return NextResponse.json(cached)
  }

  const rankingContext: GeocodeRankingContext = searchParams.get('q')
    ? parseNaturalLanguageQuery(searchParams.get('q') || query)
    : parseNaturalLanguageQuery(query)

  const variants = buildGeocodeSearchVariants({
    q: searchParams.get('q') || query,
    city,
    street,
    zip,
    state: stateParam,
  })

  const seenCoords = new Set<string>()
  const union: RankableGeocodeDto[] = []
  let lastStatus = 502

  for (const variant of variants) {
    const attempt = await geocodeWithRetry({
      query: variant.query,
      city: variant.city,
      street: variant.street || street || '',
      stateParam: variant.state ?? stateParam ?? null,
      limit: NOMINATIM_SEARCH_LIMIT,
      strategies: [...variant.strategies],
    })

    lastStatus = attempt.lastStatus
    if (attempt.data && attempt.data.length > 0) {
      for (const dto of toRankableDtos(attempt.data)) {
        const key = resultCoordKey(dto)
        if (seenCoords.has(key)) continue
        seenCoords.add(key)
        union.push(dto)
      }
      if (union.some((dto) => isStrongGeocodeMatch(dto, rankingContext))) {
        break
      }
    }

    if (lastStatus === 429) break
  }

  if (union.length === 0) {
    const userMessage =
      lastStatus === 429 || lastStatus >= 500
        ? GEOCODE_BUSY_USER_MESSAGE
        : 'No location found. Try again or enter coordinates manually.'

    return NextResponse.json(
      { error: userMessage, userMessage },
      { status: lastStatus === 429 ? 429 : 404 }
    )
  }

  let ranked: RankableGeocodeDto[] = rankResults(
    union,
    stateParam ?? rankingContext.state ?? null,
    rankingContext,
  ) as RankableGeocodeDto[]

  if (ranked.length === 0) {
    return NextResponse.json(
      {
        error: 'No location found. Try again or enter coordinates manually.',
        userMessage: 'No location found. Try again or enter coordinates manually.',
      },
      { status: 404 }
    )
  }

  const maxResults = Number(limit) || 1
  if (ranked.length > maxResults) {
    ranked = ranked.slice(0, maxResults)
  }

  const response: GeocodeDto[] = ranked.map(({ importance: _i, ...dto }) => dto)

  geocodeCache.set(cacheKey, response)
  return NextResponse.json(response)
}

/** Test helper: clear cache + rate limiter between cases */
export function __testResetGeocodeState() {
  geocodeCache.clear()
  rateLimiter.reset()
}
