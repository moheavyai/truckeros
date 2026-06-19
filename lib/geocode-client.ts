/**
 * Client-side geocode fetch with retry + friendly error messages.
 */

export const GEOCODE_BUSY_MESSAGE =
  'Geocoding service is busy — try again or enter coordinates manually'

const MAX_ATTEMPTS = 3
const BACKOFF_MS = [500, 1000, 2000]

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export type GeocodeAddress = { street?: string; city?: string; state?: string }

export function buildGeocodeParams(address: GeocodeAddress): URLSearchParams {
  const city = address.city?.trim() || ''
  const state = address.state?.trim().toUpperCase() || ''
  const street = address.street?.trim() || ''
  const params = new URLSearchParams({ limit: '1', city, state })
  if (street) {
    params.set('street', street)
  }
  return params
}

export function isAddressReadyForGeocode(address: GeocodeAddress): boolean {
  const state = address.state?.trim().toUpperCase()
  if (!state || state.length !== 2) return false
  const street = address.street?.trim()
  if (street && street.length >= 3 && address.city?.trim()) return true
  const city = address.city?.trim()
  return !!city && city.length >= 2
}

export type GeocodeSuccess = { ok: true; lat: number; lon: number }
export type GeocodeFailure = { ok: false; userMessage: string; retryable: boolean }
export type GeocodeResult = GeocodeSuccess | GeocodeFailure

export function isGeocodeFailure(result: GeocodeResult): result is GeocodeFailure {
  return result.ok === false
}

export async function fetchGeocodeWithRetry(address: GeocodeAddress): Promise<GeocodeResult> {
  const params = buildGeocodeParams(address)
  let lastUserMessage = GEOCODE_BUSY_MESSAGE

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      await sleep(BACKOFF_MS[attempt - 1] ?? 2000)
    }

    try {
      const res = await fetch(`/api/geocode?${params.toString()}`)
      const body = await res.json().catch(() => ({}))

      if (res.ok) {
        if (Array.isArray(body) && body.length > 0) {
          const lat = parseFloat(body[0].lat)
          const lon = parseFloat(body[0].lon)
          if (Number.isFinite(lat) && Number.isFinite(lon)) {
            return { ok: true, lat, lon }
          }
        }
        return {
          ok: false,
          userMessage: `No location found for ${address.city}, ${address.state}`,
          retryable: false,
        }
      }

      lastUserMessage = body?.userMessage || body?.error || GEOCODE_BUSY_MESSAGE

      if (res.status === 400 || res.status === 404) {
        return { ok: false, userMessage: lastUserMessage, retryable: true }
      }
      if (res.status === 429) {
        lastUserMessage = GEOCODE_BUSY_MESSAGE
        continue
      }
      if (res.status >= 500) {
        continue
      }
      return { ok: false, userMessage: lastUserMessage, retryable: true }
    } catch {
      lastUserMessage = GEOCODE_BUSY_MESSAGE
      if (attempt === MAX_ATTEMPTS - 1) {
        return { ok: false, userMessage: lastUserMessage, retryable: true }
      }
    }
  }

  return { ok: false, userMessage: lastUserMessage, retryable: true }
}