/**
 * Server-side forward geocode for the Agent API.
 *
 * Used when a bot sends city/state (and optional street/zip/query) without
 * lat/lon. Explicit coordinates always win — bots targeting a highway
 * waypoint should keep sending originLat/Lon.
 *
 * Reuses the same Nominatim + ranking stack as /api/geocode, without
 * requiring a browser JWT (the agent request is already authenticated).
 */

import {
  buildGeocodeSearchVariants,
  parseNaturalLanguageQuery,
} from '@/lib/geocode-query'
import {
  rankResults,
  stripNominatimResults,
  type GeocodeDto,
} from '@/lib/geocode-server'
import {
  NOMINATIM_BASE_URL,
  NOMINATIM_CONTACT_EMAIL,
  nominatimHeaders,
} from '@/lib/nominatim-config'
import { STATE_CODE_TO_NAME } from '@/lib/us-states'

export type AgentLocationInput = {
  query?: string
  street?: string
  city?: string
  state?: string
  zip?: string
  lat?: number
  lon?: number
}

export type ResolvedCoords = {
  lat: number
  lon: number
  source: 'provided' | 'geocoded'
  displayName?: string
}

function hasValidCoords(lat?: number, lon?: number): boolean {
  return (
    lat != null &&
    lon != null &&
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lon) <= 180 &&
    !(lat === 0 && lon === 0)
  )
}

/** GeocodeDto stores lat/lon as strings from Nominatim. */
function parseDtoCoords(dto: GeocodeDto): { lat: number; lon: number } | null {
  const lat = Number(dto.lat)
  const lon = Number(dto.lon)
  if (!hasValidCoords(lat, lon)) return null
  return { lat, lon }
}

function normalizeState(raw?: string): string | null {
  if (!raw) return null
  const t = raw.trim().toUpperCase()
  if (t.length === 2 && STATE_CODE_TO_NAME[t]) return t
  return null
}

async function fetchNominatim(url: string): Promise<Record<string, unknown>[]> {
  const res = await fetch(url, { headers: nominatimHeaders() })
  if (!res.ok) return []
  const data = await res.json()
  return Array.isArray(data) ? data : []
}

function buildStructuredUrl(opts: {
  city: string
  stateCode: string
  street?: string
  zip?: string
}): string {
  const params = new URLSearchParams({
    format: 'json',
    limit: '5',
    countrycodes: 'us',
    addressdetails: '1',
    email: NOMINATIM_CONTACT_EMAIL,
    city: opts.city.trim(),
    state: STATE_CODE_TO_NAME[opts.stateCode],
    country: 'United States',
  })
  if (opts.street?.trim()) params.set('street', opts.street.trim())
  if (opts.zip?.trim()) params.set('postalcode', opts.zip.trim())
  return `${NOMINATIM_BASE_URL}/search?${params.toString()}`
}

function buildFreetextUrl(query: string, stateCode?: string | null): string {
  const params = new URLSearchParams({
    format: 'json',
    limit: '5',
    countrycodes: 'us',
    addressdetails: '1',
    email: NOMINATIM_CONTACT_EMAIL,
    q: query,
  })
  if (stateCode && STATE_CODE_TO_NAME[stateCode]) {
    params.set('state', STATE_CODE_TO_NAME[stateCode])
  }
  return `${NOMINATIM_BASE_URL}/search?${params.toString()}`
}

/**
 * Resolve a location to coordinates.
 * Prefers explicit lat/lon; otherwise geocodes city/state/street/zip/query.
 */
export async function resolveLocationToCoords(
  loc: AgentLocationInput
): Promise<ResolvedCoords | null> {
  if (hasValidCoords(loc.lat, loc.lon)) {
    return { lat: loc.lat!, lon: loc.lon!, source: 'provided' }
  }

  const city = (loc.city || '').trim()
  const street = (loc.street || '').trim()
  const zip = (loc.zip || '').trim()
  const query = (loc.query || '').trim()
  const stateCode = normalizeState(loc.state)

  // Need at least city+state, or a free-text query
  if (!query && !(city && stateCode)) {
    return null
  }

  const rankingContext = parseNaturalLanguageQuery(
    query || [street, city, stateCode, zip].filter(Boolean).join(', ')
  )

  const variants = buildGeocodeSearchVariants({
    q: query || undefined,
    city: city || undefined,
    street: street || undefined,
    zip: zip || undefined,
    state: stateCode,
  })

  let rows: Record<string, unknown>[] = []

  // Prefer structured city/state when available
  if (city && stateCode) {
    rows = await fetchNominatim(
      buildStructuredUrl({ city, stateCode, street: street || undefined, zip: zip || undefined })
    )
  }

  if (rows.length === 0) {
    for (const variant of variants) {
      const q =
        variant.query ||
        [variant.street || street, variant.city || city, variant.state || stateCode, zip]
          .filter(Boolean)
          .join(', ')
      if (!q.trim()) continue
      rows = await fetchNominatim(
        buildFreetextUrl(q, variant.state ?? stateCode)
      )
      if (rows.length > 0) {
        Object.assign(rankingContext, variant.context)
        break
      }
    }
  }

  // Last resort: simple "City, ST" string
  if (rows.length === 0 && city && stateCode) {
    rows = await fetchNominatim(buildFreetextUrl(`${city}, ${stateCode}`, stateCode))
  }

  if (rows.length === 0) return null

  const dtos = stripNominatimResults(rows).map((dto, i) => {
    const rawImportance = rows[i]?.importance
    return {
      ...dto,
      importance: typeof rawImportance === 'number' ? rawImportance : undefined,
    }
  }) as Array<GeocodeDto & { importance?: number }>

  const ranked = rankResults(dtos, stateCode ?? rankingContext.state ?? null, rankingContext)
  const best = ranked[0]
  if (!best) return null

  const coords = parseDtoCoords(best)
  if (!coords) return null

  return {
    lat: coords.lat,
    lon: coords.lon,
    source: 'geocoded',
    displayName: best.display_name,
  }
}
