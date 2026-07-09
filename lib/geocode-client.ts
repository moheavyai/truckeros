/**
 * Client-side geocode fetch with retry + friendly error messages.
 */

import { parseNaturalLanguageQuery } from '@/lib/geocode-query'
import {
  buildGeocodeQuery,
  extractAddressFromGeocodeResult,
  extractStateCodeFromText,
  isStopReadyForGeocode,
  usesPrimaryQueryInput,
  type LocationStop,
} from '@/lib/location-stop'

export const GEOCODE_BUSY_MESSAGE =
  'Geocoding service is busy — try again or enter coordinates manually'

const MAX_ATTEMPTS = 2
const BACKOFF_MS = [500, 1000]

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** @deprecated Use LocationStop — kept for backward compatibility. */
export type GeocodeAddress = LocationStop

export function buildGeocodeParams(address: LocationStop): URLSearchParams {
  const query = buildGeocodeQuery(address)
  const params = new URLSearchParams({ limit: '1' })

  if (query) {
    params.set('q', query)
  }

  // When user typed natural-language query, send parsed hints for server fallbacks.
  if (usesPrimaryQueryInput(address)) {
    const parsed = parseNaturalLanguageQuery(address.query)
    const hintState =
      address.state?.trim().toUpperCase() ||
      parsed.state ||
      extractStateCodeFromText(address.query)

    if (hintState) params.set('state', hintState)
    if (parsed.city && !address.city?.trim()) params.set('city', parsed.city)
    if (parsed.street && !address.street?.trim()) params.set('street', parsed.street)
    if (parsed.zip && !address.zip?.trim()) params.set('zip', parsed.zip)

    return params
  }

  const city = address.city?.trim() || ''
  const state = address.state?.trim().toUpperCase() || ''
  const street = address.street?.trim() || ''
  const zip = address.zip?.trim() || ''

  if (city) params.set('city', city)
  if (state) params.set('state', state)
  if (street) params.set('street', street)
  if (zip) params.set('zip', zip)

  return params
}

export function isAddressReadyForGeocode(address: LocationStop): boolean {
  return isStopReadyForGeocode(address)
}

export type GeocodeSuccess = {
  ok: true
  lat: number
  lon: number
  street: string
  city: string
  state: string
  zip: string
  displayName?: string
}

export type GeocodeFailure = { ok: false; userMessage: string; retryable: boolean }
export type GeocodeResult = GeocodeSuccess | GeocodeFailure

export function isGeocodeFailure(result: GeocodeResult): result is GeocodeFailure {
  return result.ok === false
}

export async function fetchGeocodeWithRetry(address: LocationStop): Promise<GeocodeResult> {
  const params = buildGeocodeParams(address)
  const queryLabel = buildGeocodeQuery(address) || address.city || 'location'
  let lastUserMessage = GEOCODE_BUSY_MESSAGE

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      await sleep(BACKOFF_MS[attempt - 1] ?? 1000)
    }

    try {
      const res = await fetch(`/api/geocode?${params.toString()}`, { credentials: 'include' })
      const body = await res.json().catch(() => ({}))

      if (res.ok) {
        if (Array.isArray(body) && body.length > 0) {
          const parsed = extractAddressFromGeocodeResult(body[0])
          if (parsed) {
            return {
              ok: true,
              lat: parsed.lat,
              lon: parsed.lon,
              street: parsed.street,
              city: parsed.city,
              state: parsed.state,
              zip: parsed.zip,
              displayName: parsed.displayName,
            }
          }
          const lat = parseFloat(body[0].lat)
          const lon = parseFloat(body[0].lon)
          if (Number.isFinite(lat) && Number.isFinite(lon)) {
            return {
              ok: true,
              lat,
              lon,
              street: address.street || '',
              city: address.city || '',
              state: address.state || '',
              zip: address.zip || '',
            }
          }
        }
        return {
          ok: false,
          userMessage: `No location found for ${queryLabel}`,
          retryable: false,
        }
      }

      lastUserMessage = body?.userMessage || body?.error || GEOCODE_BUSY_MESSAGE

      if (res.status === 400 || res.status === 404) {
        return { ok: false, userMessage: lastUserMessage, retryable: false }
      }
      if (res.status === 429) {
        lastUserMessage = GEOCODE_BUSY_MESSAGE
        continue
      }
      if (res.status === 401 || res.status === 403) {
        return { ok: false, userMessage: 'You must be logged in to geocode addresses.', retryable: false }
      }
      if (res.status >= 500) {
        continue
      }
      return { ok: false, userMessage: lastUserMessage, retryable: false }
    } catch {
      lastUserMessage = GEOCODE_BUSY_MESSAGE
      if (attempt === MAX_ATTEMPTS - 1) {
        return { ok: false, userMessage: lastUserMessage, retryable: true }
      }
    }
  }

  return { ok: false, userMessage: lastUserMessage, retryable: true }
}