/** Shared Nominatim client configuration (forward + reverse geocode). */

export const NOMINATIM_USER_AGENT = 'TruckerOS Permit Agent (support@truckeros.app)'
export const NOMINATIM_CONTACT_EMAIL = 'support@truckeros.app'
export const NOMINATIM_BASE_URL = 'https://nominatim.openstreetmap.org'

export function nominatimHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    'User-Agent': NOMINATIM_USER_AGENT,
    'Accept-Language': 'en',
    ...extra,
  }
}