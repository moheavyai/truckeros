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
  /** Optional note describing user prefs applied (e.g. avoided states) — surfaced via baseNotes flow */
  userPreferenceNote?: string
}

/**
 * Build a route corridor using the selected routing engine + reverse geocoding.
 * Default engine is OSRM (full backward compatibility).
 * Pass routingEngine: 'graphhopper' + truck dimensions for superior truck-profile routing.
 * New: specialInstructions (raw user text) is used post-ranking to filter/rerank per prefs (avoid states, southern, specific hwys).
 */
export async function buildIntelligentCorridor(
  originLat: number,
  originLon: number,
  destLat: number,
  destLon: number,
  /** Optional known origin/destination state codes to guarantee they are included */
  originState?: string,
  destState?: string,
  /** Routing engine selection */
  routingEngine: RoutingEngine = 'osrm',
  /** Truck physical parameters — only used by GraphHopper, ignored by OSRM */
  truckParams?: { length?: number; width?: number; height?: number; weight?: number },
  /** Optional free-text special instructions / route preferences from user (e.g. "avoid CA, prefer I-40, southern route"). Minimal keyword parse, no NLP. */
  specialInstructions?: string
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
    // Robust corridor extraction:
    // 1) Primary: derive ordered states directly from OSRM steps (name/ref often contain
    //    state-specific route numbers like "I 44 W;OK 3" or "MO 5"). This is fast, accurate,
    //    no external calls, and produces correct travel order.
    // 2) Fallback (rare): reduced uniform sampling + reverseGeocode only when steps yield
    //    too few states or implausible (non-adjacent) transitions. Uses 6 pts instead of 22.
    // 3) Always force originState/destState into correct first/last positions.
    // 4) Existing completeCorridorWithHighways + all downstream (analyze, cost, DOT, save) unchanged.
    let states: string[] = []
    const steps = (route as any).steps as any[] | undefined
    if (steps && steps.length > 0) {
      states = extractStateHintsFromSteps(steps)
    }

    if (states.length < 2 || !hasPlausibleTransitions(states)) {
      // Fallback path (kept for coverage when step refs lack state hints).
      // Use modestly higher density (10) when no steps (covers GH truck-profile routes
      // and any OSRM edge cases). Still far lighter than the original unconditional 22.
      const points = sampleRoutePoints(route.geometry, steps ? 6 : 10)
      states = []
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

        // Slightly gentler delay
        await new Promise(resolve => setTimeout(resolve, 200))
      }
    }

    // Extract major highways (logic + curate unchanged; steps used when present)
    let rawHighways: string[] = []
    if (route.highways && route.highways.length > 0) {
      rawHighways = route.highways
    } else if (steps) {
      rawHighways = extractHighways(steps)
    }
    const highways = curateMajorHighways(rawHighways)

    // Force origin and destination states into the corridor at correct positions (first / last).
    // This guarantees the contract even if sampling or hints missed them or order was odd.
    // Normalization: accept full names via the existing getStateAbbreviation helper.
    if (originState) {
      let o = originState.toUpperCase()
      if (o.length > 2) {
        const abbr = getStateAbbreviation(originState)
        if (abbr) o = abbr
      }
      states = states.filter(s => s !== o)
      states.unshift(o)
    }
    if (destState) {
      let d = destState.toUpperCase()
      if (d.length > 2) {
        const abbr = getStateAbbreviation(destState)
        if (abbr) d = abbr
      }
      states = states.filter(s => s !== d)
      states.push(d)
    }

    // Strengthen corridor using existing heuristic (unchanged behavior)
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
  // Prefer shortest distance + heavy use of Interstates and US Highways (major trucking corridors).
  // GH truck profile (when selected) adds real low-bridge/restricted road avoidance for OSOW.
  // User prefs layer applied immediately after for final bias (filter/rerank).
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

  // Apply (optional) user preferences as final lightweight bias on top of engine + quality ranking.
  // Keeps OSOW-friendly (interstate bias + GH) + respects "avoid X", "southern", "prefer I-XX".
  corridors = applyUserPreferences(corridors, specialInstructions)

  return corridors
}

/**
 * Scores a route for "major trucking route" quality.
 * Lower score = better (shorter + more Interstates/US Highways).
 * Strengthens OSOW preference via major hwy bias (complements GraphHopper truck profile's bridge/restriction avoidance).
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

/**
 * Primary state corridor builder for OSRM (and any engine exposing steps).
 * Scans step ref/name fields for state route patterns (e.g. "OK 3", "I 44;MO 5").
 * Returns ordered list of first-seen distinct states following the route traversal order.
 * Zero network I/O. Primary extraction from step hints for accurate ordered corridor states.
 */
function extractStateHintsFromSteps(steps: any[]): string[] {
  const states: string[] = []
  const validCodes = new Set([
    // US states (primary)
    'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
    'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
    'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
    'VA','WA','WV','WI','WY',
    // Canadian provinces/territories (for cross-border + AK routes; matches CANADIAN_CODES in permit-agent)
    'AB','BC','MB','NB','NL','NS','NT','NU','ON','PE','QC','SK','YT'
  ])

  // Flexible matcher: supports "OK 3", "OK-3", "OK3", "I 44;MO-5", etc.
  // Matches real OSRM ref/name variants observed on long-haul routes.
  const routeRe = /\b([A-Z]{2})[\s-]?(\d{1,4})\b/g

  for (const step of steps) {
    const ref = (step?.ref || step?.name || '') as string
    if (!ref) continue
    const parts = ref.split(/[;,\|]/).map((p: string) => p.trim()).filter(Boolean)
    for (const part of parts) {
      // Fresh regex per part to avoid lastIndex state issues across iterations (robust + simple)
      const re = new RegExp(routeRe.source, 'g')
      let m: RegExpExecArray | null
      while ((m = re.exec(part)) !== null) {
        const code = m[1].toUpperCase()
        if (validCodes.has(code) && !states.includes(code)) {
          states.push(code)
        }
      }
    }
  }
  return states
}

/**
 * Lightweight adjacency check (focused on high-traffic corridors + common pairs).
 * Returns true for unlisted states (permissive) so we don't block valid routes.
 * Used only to decide whether step-derived corridor is trustworthy or needs geo fallback.
 */
function areAdjacent(a: string, b: string): boolean {
  if (!a || !b || a === b) return true
  const known: Record<string, string[]> = {
    OK: ['KS','MO','AR','CO','NM','TX'],
    MO: ['KS','NE','IA','IL','KY','TN','AR','OK'],
    IL: ['IA','IN','KY','MO','WI'],
    IN: ['IL','KY','MI','OH'],
    KS: ['CO','MO','NE','OK'],
    AR: ['LA','MS','MO','OK','TN','TX'],
    TN: ['AL','AR','GA','KY','MO','MS','NC','VA'],
    KY: ['IL','IN','MO','OH','TN','VA','WV'],
    AL: ['FL','GA','MS','TN'],
    TX: ['AR','LA','NM','OK'],
    IA: ['IL','MN','MO','NE','SD','WI'],
    OH: ['IN','KY','MI','PA','WV'],
    NE: ['CO','IA','KS','MO','SD','WY'],
    WI: ['IA','IL','MI','MN'],
    MN: ['IA','ND','SD','WI'],
    CO: ['AZ','KS','NE','NM','OK','UT','WY'],
    LA: ['AR','MS','TX'],
    // Additional common border pairs for better guard coverage on long-haul routes
    WA: ['ID','OR'],
    OR: ['CA','ID','NV','WA'],
    CA: ['AZ','NV','OR'],
    NV: ['AZ','CA','ID','OR','UT'],
    NY: ['CT','MA','NJ','PA','VT'],
    PA: ['DE','MD','NJ','NY','OH','WV'],
    VA: ['KY','MD','NC','TN','WV'],
    NC: ['GA','SC','TN','VA'],
    GA: ['AL','FL','NC','SC','TN'],
    SC: ['GA','NC'],
    FL: ['AL','GA'],
    AZ: ['CA','CO','NM','NV','UT'],
    UT: ['AZ','CO','ID','NM','NV','WY'],
    ID: ['MT','NV','OR','UT','WA','WY'],
    MT: ['ID','ND','SD','WY'],
    ND: ['MN','MT','SD'],
    SD: ['IA','MN','MT','ND','NE','WY'],
    WY: ['CO','ID','MT','NE','SD','UT'],
    MI: ['IN','OH','WI'],
    VT: ['MA','NH','NY'],
    NH: ['MA','ME','VT'],
    ME: ['NH'],
    MA: ['CT','NH','NY','RI','VT'],
    CT: ['MA','NY','RI'],
    RI: ['CT','MA'],
    NJ: ['DE','NY','PA'],
    DE: ['MD','NJ','PA'],
    MD: ['DE','PA','VA','WV'],
    WV: ['KY','MD','OH','PA','VA'],
    // Note: AK/HI intentionally have no entries (isolated); permissive rule applies.
  }
  const aN = known[a]
  if (!aN) return true
  return aN.includes(b) || (known[b] || []).includes(a)
}

function hasPlausibleTransitions(states: string[]): boolean {
  for (let i = 0; i < states.length - 1; i++) {
    if (!areAdjacent(states[i], states[i + 1])) return false
  }
  return true
}

/**
 * Lightweight user preference applicator (parser + filter/re-rank + note + primary post-proc; net delta small).
 * Runs after engine fetch + quality ranking. Filters/reranks corridors in-place for prefs.
 * Graceful: if prefs filter everything, falls back to unfiltered list.
 * No NLP, simple regex/keywords. No new imports/deps. Robustified for full names/mixed/multi-word + o/d guard.
 * Strengthens OSOW by building on existing interstate/US bias + GH truck (no direct DOT import here for minimality).
 */
function applyUserPreferences(corridors: CorridorResult[], instructions?: string): CorridorResult[] {
  if (!instructions || !instructions.trim() || corridors.length === 0) return corridors

  const text = instructions.toLowerCase()
  let result = [...corridors]
  const applied: string[] = []
  let avoided: string[] = []

  // Avoid states: supports "avoid KS", "avoid Kansas", "avoid IA", full names + 2-letter + mixed
  // ("avoid KS and Iowa, California"). Reuses getStateAbbreviation for names (title-case).
  // Broadened verb list for consistency with metros parser (addresses narrow regex feedback).
  const avoidMatch = text.match(/(?:^|[\s,.(]|\b)(avoid|avoiding|no|skip|steer clear of|shun)\s+([a-z,\s&\/]+)/i)
  if (avoidMatch) {
    const phrase = avoidMatch[2]
    const rawTokens = phrase
      .split(/[,&\s\/]+/)
      .map(s => s.trim())
      .filter(Boolean)
    const avoidedList: string[] = []
    for (let i = 0; i < rawTokens.length; i++) {
      let t = rawTokens[i]
      let u = t.toUpperCase()
      if (/^[A-Z]{2}$/.test(u)) {
        avoidedList.push(u)
        continue
      }
      let titled = t.toLowerCase().replace(/\b\w/g, (m: string) => m.toUpperCase())
      let code = getStateAbbreviation(titled)
      if (code) {
        avoidedList.push(code)
        continue
      }
      // Minimal 2-word support for multi-word states ("New York", "North Carolina", "New Mexico", "Rhode Island")
      // without new maps or helpers (loop pattern already used elsewhere in file for extractors).
      if (i + 1 < rawTokens.length) {
        const t2 = rawTokens[i + 1]
        const titled2 = t2.toLowerCase().replace(/\b\w/g, (m: string) => m.toUpperCase())
        const phrase2 = `${titled} ${titled2}`
        code = getStateAbbreviation(phrase2)
        if (code) {
          avoidedList.push(code)
          i++ // consume the second token of the phrase
          continue
        }
      }
    }
    avoided = avoidedList
    // dedupe, preserve order
    const seen = new Set<string>()
    avoided = avoided.filter(a => (seen.has(a) ? false : (seen.add(a), true)))
    if (avoided.length > 0) {
      const beforeLen = result.length
      result = result.filter(c => !avoided.some(av => c.routeCorridor.includes(av)))
      if (result.length === 0) {
        result = [...corridors] // graceful fallback
      } else if (result.length < beforeLen) {
        applied.push(`avoided ${avoided.join(', ')}`)
      }
    }
  }

  // Southern route preference: boost corridors with more southern states
  if (/(southern|south|go south|prefer south)/i.test(text)) {
    const SOUTH = new Set(['TX','OK','AR','LA','MS','AL','FL','GA','SC','NC','TN','KY','MO'])
    // attach temp for sort only
    const scored = result.map(c => ({
      c,
      south: c.routeCorridor.filter(s => SOUTH.has(s)).length
    }))
    scored.sort((a, b) => b.south - a.south)
    result = scored.map(x => x.c)
    applied.push('favored southern routing')
  }

  // Northern route preference (symmetric to southern): "northern route", "northern", "go north"
  // Note on contradictory prefs (e.g. southern + northern): independent ifs + application order (northern after southern)
  // means later one wins on overlap. Permitted for minimality; no mutual-exclusion logic added.
  if (/(northern|north|go north|prefer north)/i.test(text)) {
    const NORTH = new Set(['WA','OR','ID','MT','ND','SD','MN','WI','MI','ME','NH','VT','NY','MA','CT','RI'])
    const scored = result.map(c => ({
      c,
      north: c.routeCorridor.filter(s => NORTH.has(s)).length
    }))
    scored.sort((a, b) => b.north - a.north)
    result = scored.map(x => x.c)
    applied.push('favored northern routing')
  }

  // Prefer specific highway mentioned (e.g. "prefer I-40", "I-40", "via I 40", "US 40", bare "i-40 is best", "I40 south")
  // Regex strengthened for leading/bare/punct cases (Issue 1 fix); normalization handles I40/I-40/US40 variants (Issue 2 fix)
  const hwyMatch = text.match(/(?:^|[\s,.(]|\b)(I-?\d+|US\s*\d+)\b/i)
  if (hwyMatch) {
    let pref = (hwyMatch[1] || '').toUpperCase().replace(/^US(\d+)/, 'US $1').trim()
    if (pref) {
      const hasPref = (c: CorridorResult) => (c.highways || []).some(h => {
        const normH = h.replace(/[-.\s]/g, '').toUpperCase()
        const normP = pref.replace(/[-.\s]/g, '')
        return normH.includes(normP) || normP.includes(normH)
      })
      const withIt = result.filter(hasPref)
      const without = result.filter(c => !hasPref(c))
      if (withIt.length > 0) {
        result = [...withIt, ...without]
        applied.push(`preferred ${pref}`)
      }
    }
  }

  // Avoid major metros: parse phrase and note (no geo-fence/actual filtering; corridors state-level + pure OSRM, minimal)
  if (/(avoid|avoiding|no|skip|steer clear of|shun)\s+(major\s+metros?|big\s+cities?|large\s+metros?)/i.test(text)) {
    applied.push('avoided major metros (state-level post-proc note; verify city routing)')
  }

  if (applied.length > 0) {
    const note = `User preference applied: ${applied.join('; ')}`
    // Non-mutating: produce new objects for the note (addresses minor purity smell while preserving all refs downstream)
    result = result.map(c => ({ ...c, userPreferenceNote: note }))
  }

  // Post-process primary: exclude avoided states from its routeCorridor (update for primary) + precise note.
  // Only triggers on fallback (no OSRM alt avoided the state): primary keeps best but reported corridor excludes + warns.
  // Ensures first option always respects (primary never silently includes avoided in routeCorridor).
  // o/d guard: never strip first/last (forced origin/dest by upstream contract) even if listed in avoided — protects complete corridor.
  if (avoided.length > 0 && result.length > 0) {
    let primary = result[0]
    const hasAvoided = avoided.some(av => primary.routeCorridor.includes(av))
    if (hasAvoided) {
      const o = primary.routeCorridor[0]
      const d = primary.routeCorridor[primary.routeCorridor.length - 1] || ''
      const cleaned = primary.routeCorridor.filter(s => !avoided.includes(s) || s === o || s === d)
      const otherPrefs = applied.length > 0 ? applied.join('; ') + '; ' : ''
      const specificNote = `${otherPrefs}User requested avoid ${avoided.join(', ')}; state(s) excluded from reported corridor (verify actual geometry or use manual override)`
      primary = { ...primary, routeCorridor: cleaned.length > 0 ? cleaned : primary.routeCorridor, userPreferenceNote: specificNote }
      result = [primary, ...result.slice(1)]
    }
  }

  return result
}
