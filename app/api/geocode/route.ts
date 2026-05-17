import { NextRequest, NextResponse } from 'next/server'

/**
 * Simple in-memory cache to reduce pressure on Nominatim.
 * Keyed by the search query.
 */
const geocodeCache = new Map<string, { data: any; timestamp: number }>()
const CACHE_TTL_MS = 60 * 1000 // 60 seconds

/**
 * Server-side proxy for Nominatim forward geocoding (city/state → lat/lon).
 * Includes caching + proper rate limit handling.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const q = searchParams.get('q') || ''
  const limit = searchParams.get('limit') || '1'

  if (!q) {
    return NextResponse.json({ error: 'Missing query parameter "q"' }, { status: 400 })
  }

  // Check cache first
  const cached = geocodeCache.get(q)
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return NextResponse.json(cached.data)
  }

  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=${limit}&countrycodes=us&addressdetails=1&email=support@truckeros.app`

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'TruckerOS Permit Agent (support@truckeros.app)',
        'Accept-Language': 'en',
      },
    })

    if (!res.ok) {
      console.error(`Nominatim returned ${res.status} for query: ${q}`)

      if (res.status === 429) {
        return NextResponse.json(
          { error: 'Geocoding rate limit reached. Please wait a few seconds and try again.' },
          { status: 429 }
        )
      }

      return NextResponse.json(
        { error: `Geocoding service temporarily unavailable (${res.status})` },
        { status: 502 }
      )
    }

    const data = await res.json()

    // Store in cache
    geocodeCache.set(q, { data, timestamp: Date.now() })

    return NextResponse.json(data)

  } catch (error: any) {
    console.error('Error reaching Nominatim:', error.message || error)
    return NextResponse.json(
      { error: 'Failed to reach geocoding service. Please try again in a moment.' },
      { status: 502 }
    )
  }
}
