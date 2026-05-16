import { NextResponse } from 'next/server'
import { buildIntelligentCorridor } from '@/lib/build-corridor'

export async function GET() {
  // Approximate coordinates for testing:
  // Calvert, AL → Lincoln, NE
  const originLat = 31.85
  const originLon = -86.85
  const destLat = 40.81
  const destLon = -96.68

  try {
    const results = await buildIntelligentCorridor(
      originLat,
      originLon,
      destLat,
      destLon
    )

    if (!results || results.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No corridor data returned' },
        { status: 404 }
      )
    }

    const result = results[0]

    return NextResponse.json({
      success: true,
      routeCorridor: result.routeCorridor,
      distanceKm: result.distanceMeters ? (result.distanceMeters / 1000).toFixed(1) : null,
      durationHours: result.durationSeconds ? (result.durationSeconds / 3600).toFixed(1) : null,
      alternatives: results.length,
    })
  } catch (error) {
    console.error('Corridor test error:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to build corridor' },
      { status: 500 }
    )
  }
}