/**
 * Flexible location stop model for natural-language geocoding (pickup + drops).
 * Supports full addresses, business names, and zip codes.
 */

import { normalizeGeocodeQuery, parseNaturalLanguageQuery } from '@/lib/geocode-query'
import { US_STATE_CODES, US_STATE_NAME_TO_CODE } from '@/lib/us-states'

export const MAX_DROPS = 10

export type LocationStop = {
  /** Stable id for React keys and geocode state (survives reorder/remove). */
  id: string
  /** Primary natural-language input (address, business name, or zip). */
  query: string
  street: string
  city: string
  state: string
  zip: string
}

export type GeocodedStopFields = {
  street: string
  city: string
  state: string
  zip: string
  lat: number
  lon: number
  displayName?: string
}

export type StopWithCoords = LocationStop & { lat?: number; lon?: number }

export { US_STATE_NAME_TO_CODE } from '@/lib/us-states'

const ZIP_RE = /\b(\d{5})(?:-\d{4})?\b/
const ZIP_ONLY_RE = /^\d{5}(?:-\d{4})?(\s*,\s*United States)?$/i

function newStopId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  return `stop-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export function createEmptyStop(): LocationStop {
  return { id: newStopId(), query: '', street: '', city: '', state: '', zip: '' }
}

/** True when coordinates are present and finite. */
export function hasValidCoords(lat?: number | null, lon?: number | null): boolean {
  return Number.isFinite(lat) && Number.isFinite(lon)
}

/** Extract a 5-digit US zip from free text. */
export function extractZipFromText(text: string): string | null {
  const m = text.trim().match(ZIP_RE)
  return m ? m[1] : null
}

/** Extract trailing 2-letter state code from natural-language query. */
export function extractStateCodeFromText(text: string): string | null {
  const trimmed = text.trim()
  if (!trimmed) return null

  const commaParts = trimmed.split(',').map((p) => p.trim()).filter(Boolean)
  if (commaParts.length >= 2) {
    const last = commaParts[commaParts.length - 1].toUpperCase()
    if (US_STATE_CODES.has(last)) return last
    const nameKey = commaParts[commaParts.length - 1].toLowerCase()
    if (US_STATE_NAME_TO_CODE[nameKey]) return US_STATE_NAME_TO_CODE[nameKey]
  }

  const tokens = trimmed.split(/\s+/)
  const lastToken = tokens[tokens.length - 1]?.toUpperCase()
  if (lastToken && US_STATE_CODES.has(lastToken)) return lastToken

  return null
}

/**
 * Build the best geocode query string from a stop's fields.
 * Prefers explicit query, then composes from structured parts.
 */
export function buildGeocodeQuery(stop: LocationStop): string {
  const q = stop.query?.trim()
  if (q && q.length >= 3) {
    if (/^\d{5}(?:-\d{4})?$/.test(q)) return `${q}, United States`
    return normalizeGeocodeQuery(q)
  }

  const zip = stop.zip?.trim() || extractZipFromText(q || '')
  if (zip && !stop.city?.trim() && !stop.state?.trim()) {
    return `${zip}, United States`
  }

  const parts: string[] = []
  if (stop.street?.trim()) parts.push(stop.street.trim())
  if (stop.city?.trim()) parts.push(stop.city.trim())
  if (stop.state?.trim()) parts.push(stop.state.trim().toUpperCase())
  if (stop.zip?.trim()) parts.push(stop.zip.trim())
  if (parts.length === 0) return ''
  return `${parts.join(', ')}, United States`
}

/** True when natural-language query is the primary input (not structured-only). */
export function usesPrimaryQueryInput(stop: LocationStop): boolean {
  return !!stop.query?.trim() && stop.query.trim().length >= 3
}

const HIGHWAY_PATTERN =
  /\b(?:I[-\s]?\d{1,3}|Interstate\s+\d{1,3}|US[-\s]?\d{1,3}|US Highway \d{1,3})(?:\s+Business\s+Loop)?/i

/** True when we have enough info to attempt geocoding. */
export function isStopReadyForGeocode(stop: LocationStop): boolean {
  const query = buildGeocodeQuery(stop)
  if (!query) return false

  if (ZIP_ONLY_RE.test(query.trim())) return true

  if (extractZipFromText(query)) return true
  if (extractStateCodeFromText(query)) return true
  if (query.includes(',')) return true

  const parsed = parseNaturalLanguageQuery(stop.query || query)
  if (parsed.city && (parsed.street || parsed.businessName)) return true
  if (parsed.street && parsed.city) return true
  if (HIGHWAY_PATTERN.test(query) && query.split(/\s+/).length >= 4) return true

  const state = stop.state?.trim().toUpperCase() || parsed.state || ''
  if (state && state.length === 2 && US_STATE_CODES.has(state)) {
    if (stop.city?.trim() && stop.city.trim().length >= 2) return true
    if (stop.street?.trim() && stop.street.trim().length >= 3) return true
    if (parsed.city && parsed.city.length >= 2) return true
  }

  return false
}

export type NormalizeDropsResult =
  | { ok: true; drops: StopWithCoords[] }
  | { ok: false; message: string }

/** Normalize raw drop payloads to numeric lat/lon. Returns 400-ready errors when invalid. */
export function normalizeDrops(raw: unknown): NormalizeDropsResult {
  if (raw == null) return { ok: true, drops: [] }
  if (!Array.isArray(raw)) {
    return { ok: false, message: 'drops must be an array' }
  }
  if (raw.length > MAX_DROPS) {
    return { ok: false, message: `Too many drops (maximum ${MAX_DROPS})` }
  }

  const out: StopWithCoords[] = []
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i]
    if (!item || typeof item !== 'object') {
      return { ok: false, message: `drops[${i}] must be an object with coordinates` }
    }
    const d = item as Record<string, unknown>
    const lat = d.lat != null ? Number(d.lat) : undefined
    const lon = d.lon != null ? Number(d.lon) : undefined
    if (!hasValidCoords(lat, lon)) {
      return { ok: false, message: `drops[${i}] missing valid lat/lon coordinates` }
    }
    out.push({
      id: typeof d.id === 'string' ? d.id : newStopId(),
      query: String(d.query || ''),
      street: String(d.street || ''),
      city: String(d.city || ''),
      state: String(d.state || ''),
      zip: String(d.zip || ''),
      lat,
      lon,
    })
  }
  return { ok: true, drops: out }
}

/** Normalize Nominatim address object to our stop fields. */
export function extractAddressFromGeocodeResult(result: {
  lat?: string | number
  lon?: string | number
  display_name?: string
  address?: Record<string, string | undefined>
}): GeocodedStopFields | null {
  const lat = parseFloat(String(result.lat ?? ''))
  const lon = parseFloat(String(result.lon ?? ''))
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null

  const addr = result.address || {}
  let state = ''

  const iso = String(addr['ISO3166-2-lvl4'] || '').toUpperCase()
  if (iso.startsWith('US-') && iso.length === 5) {
    state = iso.slice(3)
  }
  if (!state) {
    const short = String(addr.state_code || '').toUpperCase()
    if (short.length === 2 && US_STATE_CODES.has(short)) state = short
  }
  if (!state) {
    const stateName = String(addr.state || '').toLowerCase()
    state = US_STATE_NAME_TO_CODE[stateName] || ''
  }

  const house = addr.house_number ? `${addr.house_number} ` : ''
  const road = addr.road || addr.street || ''
  const street = `${house}${road}`.trim()

  const city =
    addr.city ||
    addr.town ||
    addr.village ||
    addr.hamlet ||
    addr.municipality ||
    ''

  const zip = String(addr.postcode || '').trim()

  return {
    street,
    city,
    state,
    zip,
    lat,
    lon,
    displayName: result.display_name,
  }
}

/** Merge geocoded fields back into a stop (keeps user query text). */
export function applyGeocodeToStop(stop: LocationStop, geocoded: GeocodedStopFields): LocationStop {
  return {
    ...stop,
    street: geocoded.street || stop.street,
    city: geocoded.city || stop.city,
    state: geocoded.state || stop.state,
    zip: geocoded.zip || stop.zip,
  }
}

/** Sync destination from the last drop for backward-compatible APIs. */
export function syncDestinationFromDrops<T extends {
  drops: StopWithCoords[]
  destination: LocationStop
  destinationLat?: number
  destinationLon?: number
}>(data: T): T {
  const last = data.drops[data.drops.length - 1]
  if (!last) return data
  return {
    ...data,
    destination: {
      id: last.id,
      query: last.query,
      street: last.street,
      city: last.city,
      state: last.state,
      zip: last.zip,
    },
    destinationLat: last.lat,
    destinationLon: last.lon,
  }
}