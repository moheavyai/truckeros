import { NextResponse } from 'next/server'

/**
 * GET /api/routing/status
 * Lightweight endpoint so the frontend can know at runtime
 * whether real GraphHopper (truck profile) is available.
 */
export async function GET() {
  const hasGraphHopperKey = !!process.env.GRAPHHOPPER_API_KEY

  return NextResponse.json({
    graphhopper: {
      enabled: hasGraphHopperKey,
      label: hasGraphHopperKey 
        ? 'Live (truck profile + bridge/weight awareness)' 
        : 'Not configured (falls back to OSRM)',
    },
    osrm: {
      enabled: true,
      label: 'Always available (baseline)',
    },
    default: 'osrm',
  })
}
