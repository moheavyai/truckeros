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
import { mergeGeocodeRankingContext, type GeocodeDto } from '@/lib/geocode-server'
import { searchGeocodeWithVariants } from '@/lib/geocode-search'
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

  if (!query && !(city && stateCode)) {
    return null
  }

  const parsed = parseNaturalLanguageQuery(
    query || [street, city, stateCode, zip].filter(Boolean).join(', ')
  )
  const rankingContext = mergeGeocodeRankingContext(parsed, {
    state: stateCode,
    zip,
    city,
    street,
  })

  const variants = buildGeocodeSearchVariants({
    q: query || undefined,
    city: city || undefined,
    street: street || undefined,
    zip: zip || undefined,
    state: stateCode,
  })

  const { ranked } = await searchGeocodeWithVariants({
    variants,
    rankingContext,
    stateParam: stateCode ?? rankingContext.state ?? null,
    streetFallback: street,
  })

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
