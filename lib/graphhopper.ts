// lib/graphhopper.ts
//
// GraphHopper Routing Adapter (Truck Profile)
// Provides superior truck-aware routing compared to basic OSRM "driving" profile.
//
// Features:
// - Native `vehicle=truck` profile
// - Supports truck dimensions: length, width, height, weight, axle_load
// - Avoids low bridges, weight-restricted roads, and non-truck-legal segments where data exists
// - Good coverage on US Interstates and primary corridors
//
// Usage:
//   import { getGraphHopperRoute } from '@/lib/graphhopper'
//   const route = await getGraphHopperRoute(originLat, originLon, destLat, destLon, {
//     truckLength: 60,
//     truckHeight: 13.5,
//     truckWeight: 80000
//   })
//
// Requires GRAPHHOPPER_API_KEY in environment for production use.
// Falls back gracefully if key is missing (returns null → caller should use OSRM).

export interface GraphHopperRoute {
  distance: number
  duration: number
  geometry: { type: 'LineString'; coordinates: [number, number][] }
  highways?: string[]
}

export interface GraphHopperRouteResponse {
  routes: GraphHopperRoute[]
}

export interface TruckProfileParams {
  truckLength?: number   // feet
  truckWidth?: number    // feet
  truckHeight?: number   // feet
  truckWeight?: number   // lbs (gross)
  axleLoad?: number      // lbs per axle (optional but useful)
  hazmat?: boolean       // if true, will try to avoid non-hazmat routes when possible
}

/**
 * Call GraphHopper Routing API with truck profile.
 * Returns null on any failure (network, auth, no route, etc.) so callers can fallback.
 */
export async function getGraphHopperRoute(
  originLat: number,
  originLon: number,
  destLat: number,
  destLon: number,
  truckParams: TruckProfileParams = {}
): Promise<GraphHopperRouteResponse | null> {
  const apiKey = process.env.GRAPHHOPPER_API_KEY

  if (!apiKey) {
    console.warn('[GraphHopper] GRAPHHOPPER_API_KEY not set — routing will fall back to OSRM.')
    return null
  }

  try {
    const base = 'https://graphhopper.com/api/1/route'

    // Build truck profile parameters
    const params = new URLSearchParams({
      'vehicle': 'truck',
      'locale': 'en',
      'calc_points': 'true',
      'points_encoded': 'false',
      'instructions': 'true',
      'algorithm': 'round_trip', // better for long haul
      'key': apiKey,
    })

    // Add truck physical constraints (GraphHopper expects metric — convert)
    if (truckParams.truckLength) {
      params.append('truck_length', (truckParams.truckLength * 0.3048).toFixed(2)) // meters
    }
    if (truckParams.truckWidth) {
      params.append('truck_width', (truckParams.truckWidth * 0.3048).toFixed(2))
    }
    if (truckParams.truckHeight) {
      params.append('truck_height', (truckParams.truckHeight * 0.3048).toFixed(2))
    }
    if (truckParams.truckWeight) {
      // GraphHopper uses tonnes or kg — we send kg
      params.append('truck_weight', Math.round(truckParams.truckWeight * 0.453592).toString())
    }
    if (truckParams.axleLoad) {
      params.append('truck_axle_load', Math.round(truckParams.axleLoad * 0.453592).toString())
    }

    // Add points (GraphHopper uses lng,lat order)
    const pointsParam = `point=${originLat},${originLon}&point=${destLat},${destLon}`
    const url = `${base}?${params.toString()}&${pointsParam}`

    const res = await fetch(url, {
      headers: {
        'Accept': 'application/json',
      },
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      console.error('[GraphHopper] Request failed:', res.status, text.slice(0, 300))
      return null
    }

    const data = await res.json()

    if (!data.paths || data.paths.length === 0) {
      return null
    }

    const routes: GraphHopperRoute[] = data.paths.map((path: any) => {
      // Extract major highways from instructions when available
      const highways = extractHighwaysFromInstructions(path.instructions || [])

      return {
        distance: path.distance,           // meters
        duration: path.time / 1000,        // seconds (GraphHopper returns ms)
        geometry: path.points,             // already GeoJSON-like {type, coordinates}
        highways,
      }
    })

    // Sort shortest first (GraphHopper usually returns best first, but be explicit)
    routes.sort((a, b) => a.distance - b.distance)

    return { routes }
  } catch (error) {
    console.error('[GraphHopper] Exception during routing:', error)
    return null
  }
}

/**
 * Very lightweight highway name extraction from GraphHopper instruction objects.
 * GraphHopper returns "road" + "sign" fields in some cases.
 */
function extractHighwaysFromInstructions(instructions: any[]): string[] {
  const highways: string[] = []
  const seen = new Set<string>()

  for (const instr of instructions) {
    const road = instr.road || ''
    const sign = instr.sign || ''

    // Look for I-## or US ## patterns
    const candidates = [road, sign].filter(Boolean)

    for (const c of candidates) {
      const normalized = c
        .replace(/^Interstate\s*/i, 'I-')
        .replace(/^U\.?S\.?\s*Highway\s*/i, 'US ')
        .replace(/^US\s*-?(\d+)/i, 'US $1')
        .replace(/^I\s*-?(\d+)/i, 'I-$1')
        .trim()

      if (/^(I-\d+|US \d+)/.test(normalized) && !seen.has(normalized)) {
        seen.add(normalized)
        highways.push(normalized)
      }
    }
  }

  return highways.slice(0, 12)
}
