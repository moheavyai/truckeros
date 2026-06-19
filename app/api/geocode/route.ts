import { NextRequest, NextResponse } from 'next/server'

/**
 * Simple in-memory cache to reduce pressure on Nominatim.
 * Keyed by the search query + optional state filter.
 */
const geocodeCache = new Map<string, { data: any; timestamp: number }>()
const CACHE_TTL_MS = 60 * 1000 // 60 seconds

const MAX_ATTEMPTS = 3
const BACKOFF_MS = [400, 900, 1800]

const GEOCODE_BUSY_USER_MESSAGE =
  'Geocoding service is busy — try again or enter coordinates manually'

/** 2-letter code -> full state name for Nominatim structured queries */
const STATE_CODE_TO_NAME: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia',
  HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa',
  KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
  MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri',
  MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey',
  NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio',
  OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina',
  SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont',
  VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
}

function normalizeStateCode(raw: string | null): string | null {
  if (!raw) return null
  const code = raw.trim().toUpperCase()
  return code.length === 2 && STATE_CODE_TO_NAME[code] ? code : null
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** True when Nominatim result belongs to the requested US state (e.g. Enid, OK not Enid, MS). */
function resultMatchesState(result: any, stateCode: string): boolean {
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

function rankResults(data: any[], stateCode: string | null): any[] {
  if (!stateCode || !Array.isArray(data)) return data || []
  const inState = data.filter((r) => resultMatchesState(r, stateCode))
  if (inState.length > 0) return inState
  return data
}

type NominatimStrategy = 'structured' | 'freetext'

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
    email: 'support@truckeros.app',
  })

  if (strategy === 'structured' && opts.city && opts.stateParam) {
    // Nominatim rejects mixing structured fields with free-text `q` (returns 400).
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

  return `https://nominatim.openstreetmap.org/search?${base.toString()}`
}

async function fetchNominatimOnce(url: string): Promise<{ ok: boolean; status: number; data: any }> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'TruckerOS Permit Agent (support@truckeros.app)',
      'Accept-Language': 'en',
    },
  })

  if (!res.ok) {
    return { ok: false, status: res.status, data: null }
  }

  const data = await res.json()
  return { ok: true, status: res.status, data }
}

async function geocodeWithRetry(
  strategies: NominatimStrategy[],
  opts: {
    query: string
    city: string
    street: string
    stateParam: string | null
    limit: string
  }
): Promise<{ data: any[] | null; lastStatus: number }> {
  let lastStatus = 502

  for (const strategy of strategies) {
    const url = buildNominatimUrl(strategy, opts)

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      if (attempt > 0) {
        await sleep(BACKOFF_MS[attempt - 1] ?? 1800)
      }

      try {
        const result = await fetchNominatimOnce(url)
        lastStatus = result.status

        if (result.ok) {
          const rows = Array.isArray(result.data) ? result.data : []
          if (rows.length > 0) {
            return { data: rows, lastStatus: 200 }
          }
          // Empty result — try next strategy without more retries on this one
          break
        }

        // Retry transient / rate-limit errors
        if (result.status === 429 || result.status >= 500) {
          continue
        }

        // 400 from bad param combo — break to next strategy immediately
        if (result.status === 400) {
          console.warn(`Nominatim 400 for strategy=${strategy} query=${opts.query}`)
          break
        }

        break
      } catch (error: any) {
        console.error(`Nominatim fetch error (attempt ${attempt + 1}):`, error?.message || error)
        lastStatus = 502
      }
    }
  }

  return { data: null, lastStatus }
}

/**
 * Server-side proxy for Nominatim forward geocoding (city/state → lat/lon).
 * State-aware with retry, structured-then-freetext fallback, friendly user messages.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const city = (searchParams.get('city') || '').trim()
  const street = (searchParams.get('street') || '').trim()
  const stateParam = normalizeStateCode(searchParams.get('state'))
  const limit = searchParams.get('limit') || '3'

  let query = (searchParams.get('q') || '').trim()
  if (!query && city && stateParam) {
    const stateName = STATE_CODE_TO_NAME[stateParam]
    if (street) {
      query = `${street}, ${city}, ${stateName}, United States`
    } else {
      query = `${city}, ${stateName}, United States`
    }
  }

  if (!query && !(city && stateParam)) {
    return NextResponse.json(
      { error: 'Missing query parameter "q" (or city+state)', userMessage: 'Enter a city and state to geocode.' },
      { status: 400 }
    )
  }

  const cacheKey = `${query}|city=${city}|street=${street}|state=${stateParam || ''}|limit=${limit}`
  const cached = geocodeCache.get(cacheKey)
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return NextResponse.json(cached.data)
  }

  const strategies: NominatimStrategy[] =
    city && stateParam ? ['structured', 'freetext'] : ['freetext']

  const { data, lastStatus } = await geocodeWithRetry(strategies, {
    query,
    city,
    street,
    stateParam,
    limit,
  })

  if (!data || data.length === 0) {
    const userMessage =
      lastStatus === 429 || lastStatus >= 500
        ? GEOCODE_BUSY_USER_MESSAGE
        : `No location found for ${city || query}${stateParam ? `, ${stateParam}` : ''}. Try again or enter coordinates manually.`

    return NextResponse.json(
      { error: userMessage, userMessage },
      { status: lastStatus === 429 ? 429 : 404 }
    )
  }

  let ranked = rankResults(data, stateParam)
  if (limit === '1' && ranked.length > 1) {
    ranked = [ranked[0]]
  }

  geocodeCache.set(cacheKey, { data: ranked, timestamp: Date.now() })
  return NextResponse.json(ranked)
}