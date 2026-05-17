// lib/geocoding.ts

export interface ReverseGeocodeResult {
  state?: string
  country?: string
}

/**
 * Reverse geocode coordinates using Nominatim (OpenStreetMap)
 */
export async function reverseGeocode(lat: number, lon: number): Promise<ReverseGeocodeResult | null> {
  try {
    // Higher zoom = much better state accuracy (old zoom=5 was too coarse)
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=10&addressdetails=1`

    const res = await fetch(url, {
      headers: {
        'User-Agent': 'TruckerOS/1.0 (andrehampton1@outlook.com)',
      },
    })

    if (!res.ok) {
      console.warn(`Nominatim attempt failed: ${res.status}`)
      return null
    }

    const data = await res.json()
    const address = data.address || {}

    // Prefer short state code (more reliable) when available
    const state = address.state_code?.toUpperCase() || address.state

    return {
      state,
      country: address.country,
    }
  } catch (error) {
    console.warn('Reverse geocoding error:', error)
    return null
  }
}