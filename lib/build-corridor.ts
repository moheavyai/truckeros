// lib/build-corridor.ts

import { getRoute } from './osrm'
import { sampleRoutePoints } from './route-utils'
import { reverseGeocode } from './geocoding'

export interface CorridorResult {
  routeCorridor: string[]          // List of states (e.g. ["AL", "TN", "AR"])
  highways?: string[]              // List of major highways (e.g. ["I-40", "US 64"])
  distanceMeters?: number
  durationSeconds?: number
}

/**
 * Build a route corridor using real OSRM data + reverse geocoding
 */
export async function buildIntelligentCorridor(
  originLat: number,
  originLon: number,
  destLat: number,
  destLon: number
): Promise<CorridorResult[]> {
  // 1. Get real route(s) from OSRM (now supports alternatives)
  const response = await getRoute(originLat, originLon, destLat, destLon)

  if (!response || response.routes.length === 0) {
    return []
  }

  const corridors: CorridorResult[] = []

  // 2. Process each route returned by OSRM
  for (const route of response.routes) {
    // Sample points along the route
    const points = sampleRoutePoints(route.geometry, 6)

    // Reverse geocode points to get states
    const states: string[] = []

    for (const point of points) {
      const result = await reverseGeocode(point.lat, point.lon)

      if (result?.state) {
        const stateCode = result.state.length > 2 
          ? getStateAbbreviation(result.state) 
          : result.state.toUpperCase()

        if (stateCode && !states.includes(stateCode)) {
          states.push(stateCode)
        }
      }

      // Small delay to be nice to Nominatim
      await new Promise(resolve => setTimeout(resolve, 300))
    }

    // Extract major highways from OSRM steps
    const highways = route.steps ? extractHighways(route.steps) : []

    corridors.push({
      routeCorridor: states,
      highways,
      distanceMeters: route.distance,
      durationSeconds: route.duration,
    })
  }

  return corridors
}

/**
 * Simple helper to convert full state name to abbreviation
 * (We can improve this later with a proper map)
 */
function getStateAbbreviation(stateName: string): string | null {
  const map: Record<string, string> = {
    'Alabama': 'AL',
    'Alaska': 'AK',
    'Arizona': 'AZ',
    'Arkansas': 'AR',
    'California': 'CA',
    'Colorado': 'CO',
    'Connecticut': 'CT',
    'Delaware': 'DE',
    'Florida': 'FL',
    'Georgia': 'GA',
    'Hawaii': 'HI',
    'Idaho': 'ID',
    'Illinois': 'IL',
    'Indiana': 'IN',
    'Iowa': 'IA',
    'Kansas': 'KS',
    'Kentucky': 'KY',
    'Louisiana': 'LA',
    'Maine': 'ME',
    'Maryland': 'MD',
    'Massachusetts': 'MA',
    'Michigan': 'MI',
    'Minnesota': 'MN',
    'Mississippi': 'MS',
    'Missouri': 'MO',
    'Montana': 'MT',
    'Nebraska': 'NE',
    'Nevada': 'NV',
    'New Hampshire': 'NH',
    'New Jersey': 'NJ',
    'New Mexico': 'NM',
    'New York': 'NY',
    'North Carolina': 'NC',
    'North Dakota': 'ND',
    'Ohio': 'OH',
    'Oklahoma': 'OK',
    'Oregon': 'OR',
    'Pennsylvania': 'PA',
    'Rhode Island': 'RI',
    'South Carolina': 'SC',
    'South Dakota': 'SD',
    'Tennessee': 'TN',
    'Texas': 'TX',
    'Utah': 'UT',
    'Vermont': 'VT',
    'Virginia': 'VA',
    'Washington': 'WA',
    'West Virginia': 'WV',
    'Wisconsin': 'WI',
    'Wyoming': 'WY',
  }

  return map[stateName] || null
}

/**
 * Extract major highway names from OSRM route steps.
 * Prefers `ref` (e.g. "I 40") over `name`, and normalizes common formats.
 */
function extractHighways(steps: any[]): string[] {
  const highways: string[] = []

  for (const step of steps) {
    const ref = step.ref || step.name || ''
    if (!ref) continue

    // Split combined values like "US 62; US 412"
    const parts = ref.split(';').map(p => p.trim()).filter(Boolean)

    for (let highway of parts) {
      // Normalize common highway naming
      highway = highway
        .replace(/^Interstate\s*/i, 'I-')
        .replace(/^U\.?S\.?\s*Highway\s*/i, 'US ')
        .replace(/^State\s*Route\s*/i, 'SR ')
        .replace(/^Farm to Market\s*/i, 'FM ')
        .trim()

      // Keep only major highways (Interstates, US Highways, and State Routes)
      if (/^(I[ -]\d|US[ -]?\d|[A-Z]{1,2}[ -]?\d)/i.test(highway)) {
        if (!highways.includes(highway)) {
          highways.push(highway)
        }
      }
    }
  }

  return highways
}