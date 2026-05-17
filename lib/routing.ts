// lib/routing.ts
//
// Unified Routing Engine Facade
// Provides a single interface to swap between OSRM (default) and GraphHopper (truck-aware).
//
// Benefits:
// - GraphHopper has far better native truck profile support (dimensions + weight + bridge/road class awareness)
// - OSRM remains the reliable, no-key-required baseline for "driving" profile
// - Easy A/B testing and graceful degradation
//
// Default engine: 'osrm' (preserves all existing behavior 100%)
//
// To use GraphHopper:
//   1. Sign up at https://graphhopper.com (free tier available)
//   2. Set GRAPHHOPPER_API_KEY in .env.local
//   3. Pass routingEngine: 'graphhopper' from the UI / agent call

import { getRoute as getOsrmRoute, type OSRMRouteResponse } from './osrm'
import { getGraphHopperRoute, type TruckProfileParams, type GraphHopperRouteResponse } from './graphhopper'

export type RoutingEngine = 'osrm' | 'graphhopper'

export interface UnifiedRoute {
  distance: number      // meters
  duration: number      // seconds
  geometry: any         // GeoJSON LineString
  highways?: string[]
}

export interface UnifiedRouteResponse {
  routes: UnifiedRoute[]
  engine: RoutingEngine
  note?: string         // e.g. "GraphHopper key missing — fell back to OSRM"
}

/**
 * Main entry point used by build-corridor.ts and the Permit Agent.
 *
 * @param originLat, originLon, destLat, destLon — WGS84 coordinates
 * @param engine — 'osrm' (default, always works) or 'graphhopper' (truck profile)
 * @param truckParams — optional physical dimensions for GraphHopper (ignored by OSRM)
 */
export async function getRoute(
  originLat: number,
  originLon: number,
  destLat: number,
  destLon: number,
  engine: RoutingEngine = 'osrm',
  truckParams: TruckProfileParams = {}
): Promise<UnifiedRouteResponse | null> {
  if (engine === 'graphhopper') {
    const gh = await getGraphHopperRoute(originLat, originLon, destLat, destLon, truckParams)

    if (gh && gh.routes.length > 0) {
      return {
        routes: gh.routes.map(r => ({
          distance: r.distance,
          duration: r.duration,
          geometry: r.geometry,
          highways: r.highways,
        })),
        engine: 'graphhopper',
      }
    }

    // Graceful fallback
    console.warn('[Routing] GraphHopper unavailable or returned no route — falling back to OSRM')
    const osrm = await getOsrmRoute(originLat, originLon, destLat, destLon)
    if (osrm) {
      return {
        ...osrm,
        engine: 'osrm',
        note: 'GraphHopper key missing or route failed — used OSRM fallback',
      }
    }
    return null
  }

  // Default: OSRM (existing behavior, fully backward compatible)
  const osrm = await getOsrmRoute(originLat, originLon, destLat, destLon)
  if (osrm) {
    return {
      ...osrm,
      engine: 'osrm',
    }
  }
  return null
}
