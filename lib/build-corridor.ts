// lib/build-corridor.ts

import { getRoute, type RoutingEngine } from './routing'
import { sampleRoutePoints } from './route-utils'
import { reverseGeocode } from './geocoding'

export interface CorridorResult {
  routeCorridor: string[]          // List of states (e.g. ["AL", "TN", "AR"])
  highways?: string[]              // List of major highways (e.g. ["I-40", "US 64"])
  distanceMeters?: number
  durationSeconds?: number
  /** Which routing engine produced this corridor (for UI labeling + debugging) */
  engine?: RoutingEngine
  /** Optional note when fallback occurred (e.g. GraphHopper key missing) */
  engineNote?: string
}

/**
 * Build a route corridor using the selected routing engine + reverse geocoding.
 * Default engine is OSRM (full backward compatibility).
 * Pass routingEngine: 'graphhopper' + truck dimensions for superior truck-profile routing.
 */
export async function buildIntelligentCorridor(
  originLat: number,
  originLon: number,
  destLat: number,
  destLon: number,
  /** Optional known origin/destination state codes to guarantee they are included */
  originState?: string,
  destState?: string,
  /** Routing engine selection (new in 2026-05) */
  routingEngine: RoutingEngine = 'osrm',
  /** Truck physical parameters — only used by GraphHopper, ignored by OSRM */
  truckParams?: { length?: number; width?: number; height?: number; weight?: number }
): Promise<CorridorResult[]> {
  // 1. Get real route(s) from the selected engine (OSRM default, GraphHopper for truck profiles)
  const response = await getRoute(
    originLat,
    originLon,
    destLat,
    destLon,
    routingEngine,
    {
      truckLength: truckParams?.length,
      truckWidth: truckParams?.width,
      truckHeight: truckParams?.height,
      truckWeight: truckParams?.weight,
    }
  )

  if (!response || response.routes.length === 0) {
    return []
  }

  const usedEngine = response.engine
  const engineNote = response.note

  let corridors: CorridorResult[] = []

  // 2. Process each route returned by the chosen engine (OSRM or GraphHopper)
  for (const route of response.routes) {
    // Higher sampling for better state coverage (especially on long routes)
    const points = sampleRoutePoints(route.geometry, 22)

    // Reverse geocode points to get states
    let states: string[] = []

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
      await new Promise(resolve => setTimeout(resolve, 250))
    }

    // Extract major highways.
    // GraphHopper already provides cleaned highways on the route object.
    // OSRM routes still carry raw `steps` (from the original OSRM response shape).
    let rawHighways: string[] = []
    if (route.highways && route.highways.length > 0) {
      rawHighways = route.highways
    } else if ((route as any).steps) {
      rawHighways = extractHighways((route as any).steps)
    }
    const highways = curateMajorHighways(rawHighways)

    // Force origin and destination states into the corridor
    if (originState && !states.includes(originState.toUpperCase())) {
      states.unshift(originState.toUpperCase())
    }
    if (destState && !states.includes(destState.toUpperCase())) {
      states.push(destState.toUpperCase())
    }

    // Strengthen corridor: insert common connecting states based on major highways present
    // (temporary until better mapping data)
    states = completeCorridorWithHighways(states, highways)

    corridors.push({
      routeCorridor: states,
      highways,
      distanceMeters: route.distance,
      durationSeconds: route.duration,
      engine: usedEngine,
      engineNote,
    })
  }

  // === Intelligent Route Ranking ===
  // Prefer shortest distance + heavy use of Interstates and US Highways (major trucking corridors)
  if (corridors.length > 1) {
    const shortestDistance = Math.min(...corridors.map(c => c.distanceMeters || Infinity))

    corridors = corridors
      .map(corridor => ({
        corridor,
        score: calculateRouteQualityScore(corridor, shortestDistance),
      }))
      .sort((a, b) => a.score - b.score)           // lower score = better
      .map(item => item.corridor)

    // Filter out absurdly long detours (more than ~45% longer than best)
    const bestDistance = corridors[0]?.distanceMeters || shortestDistance
    corridors = corridors.filter(c =>
      (c.distanceMeters || 0) <= bestDistance * 1.45
    )
  }

  return corridors
}

/**
 * Scores a route for "major trucking route" quality.
 * Lower score = better (shorter + more Interstates/US Highways)
 */
function calculateRouteQualityScore(
  corridor: CorridorResult,
  shortestDistance: number
): number {
  const distance = corridor.distanceMeters || Infinity
  const distanceRatio = distance / shortestDistance

  const highways = corridor.highways || []

  // Count high-quality trucking highways
  const interstateCount = highways.filter(h => /^I-/.test(h)).length
  const usHighwayCount = highways.filter(h => /^US /.test(h)).length

  // Penalize routes with almost no major highways
  const majorHwyCount = interstateCount + usHighwayCount

  let score = distanceRatio * 100

  // Strong preference for Interstates (trucking backbone)
  score -= interstateCount * 12

  // Good preference for US Highways
  score -= usHighwayCount * 5

  // Penalty if the route barely uses any major highways
  if (majorHwyCount === 0) score += 30
  if (majorHwyCount === 1) score += 15

  return score
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
 * Extract *major* highway names from OSRM route steps.
 * We are intentionally strict: only Interstates (I-xxx) and US Highways (US xxx).
 * All state routes (IA 2, N-2, KS 4, OK 66, etc.) are deliberately dropped.
 */
function extractHighways(steps: any[]): string[] {
  const highways: string[] = []

  for (const step of steps) {
    const ref = step.ref || step.name || ''
    if (!ref) continue

    // Split on common separators (including cases that produce "I 45;NE")
    const parts = ref.split(/[;,\|]/).map(p => p.trim()).filter(Boolean)

    for (let raw of parts) {
      // Heavy cleanup to remove leaked state codes and junk
      let h = raw
        .replace(/^Interstate\s*/i, 'I-')
        .replace(/^U\.?S\.?\s*Highway\s*/i, 'US ')
        .replace(/[A-Z]{2,}$/i, '')           // strip trailing "NE", "TX", etc.
        .replace(/\s+/g, ' ')
        .trim()

      // Normalize to clean formats
      h = h
        .replace(/^I[ -]?(\d+)/i, 'I-$1')
        .replace(/^US[ -]?(\d+)/i, 'US $1')

      const isInterstate = /^I-\d+$/i.test(h)
      const isUSHighway = /^US \d+$/i.test(h)

      if ((isInterstate || isUSHighway) && !highways.includes(h)) {
        highways.push(h)
      }
    }
  }

  return highways
}
/**
 * Curate the list of major highways for display.
 * Goal: Show a clean "primary trucking corridor" view instead of every US highway touched.
 *
 * Strategy:
 * - Always keep all Interstates (they are the trucking backbone)
 * - Keep only the most important US Highways for long-haul trucking
 * - Limit total length so the string stays readable in the UI
 */
function curateMajorHighways(highways: string[]): string[] {
  if (!highways || highways.length === 0) return []

  const interstates: string[] = []
  const keyUSHighways: string[] = []
  const otherUSHighways: string[] = []

  // Known important long-haul US highways (expandable over time)
  const importantUSHwys = new Set([
    'US 71', 'US 59', 'US 169', 'US 67', 'US 79',
    'US 259', 'US 90', 'US 49', 'US 77', 'US 75',
    'US 6', 'US 40', 'US 24'
  ])

  for (const h of highways) {
    if (/^I-/.test(h)) {
      interstates.push(h)
    } else if (importantUSHwys.has(h)) {
      keyUSHighways.push(h)
    } else if (/^US /.test(h)) {
      otherUSHighways.push(h)
    }
  }

  // Build final list: All Interstates first, then key US highways
  let result = [...interstates, ...keyUSHighways]

  // Only add lesser US highways if we have very few major ones
  if (result.length < 6) {
    result = result.concat(otherUSHighways.slice(0, 4))
  }

  // Hard cap for clean UI display
  if (result.length > 10) {
    result = result.slice(0, 10)
  }

  return result
}

/**
 * Temporary helper to fill common missing states based on major highways.
 * This bridges gaps until we have better mapping data.
 */
function completeCorridorWithHighways(states: string[], highways: string[]): string[] {
  const result = [...states]
  const hwySet = new Set(highways)

  // Common patterns for US long-haul trucking
  // If we have I-35 + I-40 going south from MO/KS area → strongly consider OK
  if ((hwySet.has('I-35') || hwySet.has('I-40')) && result.includes('MO') && !result.includes('OK')) {
    // Insert OK after MO if I-40 or I-35 is prominent
    const moIndex = result.indexOf('MO')
    if (moIndex !== -1) {
      result.splice(moIndex + 1, 0, 'OK')
    }
  }

  // If going south through Arkansas area toward Texas on I-49/I-40, make sure OK is considered
  if (result.includes('AR') && result.includes('TX') && !result.includes('OK')) {
    const arIndex = result.indexOf('AR')
    if (arIndex !== -1) {
      result.splice(arIndex + 1, 0, 'OK')
    }
  }

  // If I-35 is dominant from KS/MO area south, ensure KS is present when logical
  if (hwySet.has('I-35') && result.includes('MO') && !result.includes('KS')) {
    const moIndex = result.indexOf('MO')
    if (moIndex > 0) {
      // Insert before MO if coming from north
      result.splice(moIndex, 0, 'KS')
    }
  }

  // Deduplicate while preserving order
  const seen = new Set<string>()
  return result.filter(s => {
    if (seen.has(s)) return false
    seen.add(s)
    return true
  })
}
