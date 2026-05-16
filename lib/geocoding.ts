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
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=5&addressdetails=1`

    const res = await fetch(url, {
      headers: {
        'User-Agent': 'TruckerOS/1.0 (andrehampton1@outlook.com)',
      },
    })

    if (!res.ok) {
      console.error('Nominatim request failed:', res.status)
      return null
    }

    const data = await res.json()
    const address = data.address || {}

    return {
      state: address.state,
      country: address.country,
    }
  } catch (error) {
    console.error('Reverse geocoding error:', error)
    return null
  }
}