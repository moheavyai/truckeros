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
  mergeGeocodeRankingContext,
  validateGeocodeInput,
  type GeocodeDto,
} from '@/lib/geocode-server'
import { buildGeocodeSearchVariants, parseNaturalLanguageQuery } from '@/lib/geocode-query'
import {
  GEOCODE_NO_LOCATION_MESSAGE,
  geocodeFailureStatus,
  searchGeocodeWithVariants,
} from '@/lib/geocode-search'

const geocodeCache = new LruGeocodeCache()
const rateLimiter = new TokenBucketRateLimiter(3, 1000)

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

  const parsed = searchParams.get('q')
    ? parseNaturalLanguageQuery(searchParams.get('q') || query)
    : parseNaturalLanguageQuery(query)

  const rankingContext = mergeGeocodeRankingContext(parsed, {
    state: stateParam,
    zip,
    city,
    street,
  })

  const variants = buildGeocodeSearchVariants({
    q: searchParams.get('q') || query,
    city,
    street,
    zip,
    state: stateParam,
  })

  const { ranked: rankedAll, lastStatus } = await searchGeocodeWithVariants({
    variants,
    rankingContext,
    stateParam: stateParam ?? rankingContext.state ?? null,
    streetFallback: street,
  })

  if (rankedAll.length === 0) {
    const status = geocodeFailureStatus(lastStatus)
    const userMessage = status === 404 ? GEOCODE_NO_LOCATION_MESSAGE : GEOCODE_BUSY_USER_MESSAGE
    return NextResponse.json(
      { error: userMessage, userMessage },
      { status, headers: status === 429 ? { 'Retry-After': '1' } : undefined },
    )
  }

  const maxResults = Number(limit) || 1
  const ranked = rankedAll.length > maxResults ? rankedAll.slice(0, maxResults) : rankedAll
  const response: GeocodeDto[] = ranked.map(({ importance: _i, ...dto }) => dto)

  geocodeCache.set(cacheKey, response)
  return NextResponse.json(response)
}

/** Test helper: clear cache + rate limiter between cases */
export function __testResetGeocodeState() {
  geocodeCache.clear()
  rateLimiter.reset()
}
