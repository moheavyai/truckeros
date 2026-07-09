import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  GEOCODE_BUSY_USER_MESSAGE,
  LruGeocodeCache,
  TokenBucketRateLimiter,
  buildCacheKey,
  rankResults,
  stripNominatimResults,
  validateGeocodeInput,
  type GeocodeDto,
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

type NominatimStrategy = 'structured' | 'freetext'

type GeocodeAttemptOpts = {
  query: string
  city: string
  street: string
  stateParam: string | null
  limit: string
  strategies: NominatimStrategy[]
}

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

function clientIp(request: NextRequest): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'
  )
}

/** Exported for tests */
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

  if (!validated.ok) {
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

  const rankingContext = searchParams.get('q')
    ? parseNaturalLanguageQuery(searchParams.get('q') || query)
    : parseNaturalLanguageQuery(query)

  const variants = buildGeocodeSearchVariants({
    q: searchParams.get('q') || query,
    city,
    street,
    zip,
    state: stateParam,
  })

  let data: Record<string, unknown>[] | null = null
  let lastStatus = 502

  for (const variant of variants) {
    const attempt = await geocodeWithRetry({
      query: variant.query,
      city: variant.city || city || '',
      street: variant.street || street || '',
      stateParam: variant.state ?? stateParam ?? null,
      limit,
      strategies: [...variant.strategies],
    })

    lastStatus = attempt.lastStatus
    if (attempt.data && attempt.data.length > 0) {
      data = attempt.data
      Object.assign(rankingContext, variant.context)
      break
    }

    if (lastStatus === 429) break
  }

  if (!data || data.length === 0) {
    const userMessage =
      lastStatus === 429 || lastStatus >= 500
        ? GEOCODE_BUSY_USER_MESSAGE
        : 'No location found. Try again or enter coordinates manually.'

    return NextResponse.json(
      { error: userMessage, userMessage },
      { status: lastStatus === 429 ? 429 : 404 }
    )
  }

  const dtos = stripNominatimResults(data).map((dto, i) => ({
    ...dto,
    importance: data[i]?.importance as number | undefined,
  }))

  let ranked = rankResults(dtos, stateParam ?? rankingContext.state ?? null, rankingContext)
  if (limit === '1' && ranked.length > 1) {
    ranked = [ranked[0]]
  }

  const response = ranked.map(({ importance: _i, ...dto }) => dto)

  geocodeCache.set(cacheKey, response)
  return NextResponse.json(response)
}

export async function GET(request: NextRequest) {
  return handleGeocodeGet(request)
}

/** Test helpers */
export function __testResetGeocodeState() {
  geocodeCache.clear()
  rateLimiter.reset()
}