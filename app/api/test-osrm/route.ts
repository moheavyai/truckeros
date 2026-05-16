import { NextResponse } from 'next/server'
import { getRoute } from '@/lib/osrm'

export async function GET() {
  // Test coordinates: Calvert, AL → Lincoln, NE (approximate)
  const originLat = 31.85
  const originLon = -86.85
  const destLat = 40.81
  const destLon = -96.68

  const response = await getRoute(originLat, originLon, destLat, destLon)

  if (!response || !response.routes || response.routes.length === 0) {
    return NextResponse.json({ error: 'Failed to get route from OSRM' }, { status: 500 })
  }

  const route = response.routes[0]

  return NextResponse.json({
    success: true,
    distanceMeters: route.distance,
    durationSeconds: route.duration,
    message: 'OSRM route fetched successfully',
    alternatives: response.routes.length,
  })
}