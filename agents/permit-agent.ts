// agents/permit-agent.ts

import { buildIntelligentCorridor, type CorridorResult } from '@/lib/build-corridor'
import { hasValidCoords } from '@/lib/location-stop'
import { snapToStateHighway } from '@/lib/snap-highway'
import type { RoutingEngine } from '@/lib/routing'
import { supabase } from '@/lib/supabase'
import type { StatePermitRule } from '@/types/permit'
import { calculateEstimatedCost, type CostBreakdown } from '@/lib/cost-engine'
import {
  effectiveEnvelopeLengthThreshold,
  needsLengthPermit,
} from '@/lib/permit-length'
import {
  analyzeEscortRequirements,
  type StateEscortDetail,
} from '@/lib/escort-analysis'

// NEW: Open State DOT corridor restrictions (priority 12 states)
import {
  getRestrictionsForCorridor,
  formatRestrictionNote,
  type CorridorRestriction,
} from '@/lib/dot-corridor-restrictions'

// Helper: does this load exceed a specific corridor restriction value?
function exceedsCorridorRestriction(load: LoadDetails, r: CorridorRestriction): boolean {
  if (!r.value) return false
  if ((r.type === 'height' || r.type === 'bridge_clearance' || r.type === 'tunnel') && r.unit === 'ft') {
    return load.height > r.value
  }
  if (r.type === 'weight' && r.unit === 'lbs') {
    return load.weight > r.value
  }
  if (r.type === 'width' && r.unit === 'ft') {
    return load.width > r.value
  }
  return false
}

export interface Address {
  query?: string
  street?: string
  city: string
  state: string
  zip?: string
}

export type DropStop = Address & {
  lat?: number
  lon?: number
}

export interface LoadDetails {
  origin: Address
  destination: Address
  /** Ordered delivery stops (pickup is origin; last drop syncs to destination). */
  drops?: DropStop[]
  weight: number
  length: number
  width: number
  height: number
  mcNumber?: string
  dotNumber?: string
  vehicleInfo?: string

  originLat?: number
  originLon?: number
  destinationLat?: number
  destinationLon?: number

  // Used for the "Change Route" manual override feature
  manualRoute?: string[]

  // Routing engine selection (GraphHopper truck profile or OSRM baseline)
  routingEngine?: RoutingEngine

  // NEW: Optional raw special instructions / route preferences (e.g. "avoid CA, prefer southern route, I-40").
  // Threaded to buildIntelligentCorridor for filtering/reranking. Override (manualRoute array) takes precedence.
  specialInstructions?: string

  // Trailer/rig length (ft), separate from routing envelope `length`.
  trailerLengthFt?: number
}

export interface AnalyzedRouteOption {
  routeCorridor: string[]
  highways?: string[]

  // Core permit decision
  permitRequiredStates: string[]

  // Richer intelligence from state_permit_rules + DOT corridor data
  escortRequiredStates: string[]
  escortWarnings?: string[]
  escortDetails?: StateEscortDetail[]
  curfewNotes: string[]
  specialNotes: string[]
  seasonalWeightRestrictions?: string[]
  stateRules?: StatePermitRule[]

  // NEW: Real-world restrictions pulled from open State DOT data (bridges, weight posts, curfews, etc.)
  dotRestrictions?: string[]

  reasons: string[]
  notes: string[]

  distanceMiles?: number
  durationHours?: number
  estimatedCost?: number

  // Cost breakdown object returned by cost-engine (used for auto-save and UI)
  costBreakdown?: any

  // NEW: Which engine + any fallback note (for UI labeling)
  routingEngine?: RoutingEngine
  routingEngineNote?: string
}

// Canadian province/territory codes for terminology and logic
const CANADIAN_CODES = new Set([
  'AB', 'BC', 'SK', 'MB', 'ON', 'QC', 'NB', 'NS', 'PE', 'NL', 'NT', 'NU', 'YT'
])

function isCanadian(code: string): boolean {
  return CANADIAN_CODES.has(code.toUpperCase())
}

function getJurisdictionLabel(code: string): string {
  return isCanadian(code) ? 'Province' : 'State'
}

export interface PermitAgentResult {
  status: 'valid' | 'invalid' | 'pending_review'
  message: string
  loadDetails: LoadDetails
  options: AnalyzedRouteOption[]
  missingFields: string[]
}

/**
 * Layer 1: Input Validation
 */
function validateLoadDetails(details: LoadDetails): string[] {
  const missing: string[] = []
  if (!details.origin?.city) missing.push('origin.city')
  if (!details.origin?.state) missing.push('origin.state')
  if (!details.destination?.city) missing.push('destination.city')
  if (!details.destination?.state) missing.push('destination.state')
  if (!Number.isFinite(details.weight) || details.weight <= 0) missing.push('weight')
  if (!Number.isFinite(details.length) || details.length <= 0) missing.push('length')
  if (!Number.isFinite(details.width) || details.width <= 0) missing.push('width')
  if (!Number.isFinite(details.height) || details.height <= 0) missing.push('height')
  return missing
}

type RoutedStop = { lat: number; lon: number; state?: string }

function getOrderedStops(load: LoadDetails): RoutedStop[] {
  const stops: RoutedStop[] = []
  if (hasValidCoords(load.originLat, load.originLon)) {
    stops.push({
      lat: load.originLat!,
      lon: load.originLon!,
      state: load.origin?.state,
    })
  }
  if (load.drops && load.drops.length > 0) {
    for (const d of load.drops) {
      if (hasValidCoords(d.lat, d.lon)) {
        stops.push({ lat: d.lat!, lon: d.lon!, state: d.state })
      }
    }
  } else if (hasValidCoords(load.destinationLat, load.destinationLon)) {
    stops.push({
      lat: load.destinationLat!,
      lon: load.destinationLon!,
      state: load.destination?.state,
    })
  }
  return stops
}

function mergeCorridorLegs(legs: CorridorResult[]): CorridorResult {
  const merged: CorridorResult = {
    routeCorridor: [],
    highways: [],
    distanceMeters: 0,
    durationSeconds: 0,
    engine: legs[0]?.engine,
    engineNote: legs.map((l) => l.engineNote).filter(Boolean).join('; ') || undefined,
    userPreferenceNote: legs.map((l) => l.userPreferenceNote).filter(Boolean).join('; ') || undefined,
  }

  for (const leg of legs) {
    for (const st of leg.routeCorridor) {
      const last = merged.routeCorridor[merged.routeCorridor.length - 1]
      if (last !== st) merged.routeCorridor.push(st)
    }
    if (leg.highways?.length) {
      merged.highways = [...(merged.highways || []), ...leg.highways]
    }
    merged.distanceMeters = (merged.distanceMeters || 0) + (leg.distanceMeters || 0)
    merged.durationSeconds = (merged.durationSeconds || 0) + (leg.durationSeconds || 0)
    if (leg.permitReady) merged.permitReady = true
    if (leg.permitWarnings?.length) {
      merged.permitWarnings = [...(merged.permitWarnings || []), ...leg.permitWarnings]
    }
  }

  return merged
}

async function buildMultiLegCorridor(load: LoadDetails): Promise<CorridorResult[]> {
  const stops = getOrderedStops(load)
  if (stops.length < 2) return []

  const routingEngine: RoutingEngine = load.routingEngine || 'osrm'
  const legs: CorridorResult[] = []

  for (let i = 0; i < stops.length - 1; i++) {
    const from = stops[i]
    const to = stops[i + 1]
    const oSnap = await snapToStateHighway(from.lat, from.lon)
    const dSnap = await snapToStateHighway(to.lat, to.lon)
    const corridors = await buildIntelligentCorridor(
      oSnap.lat,
      oSnap.lon,
      dSnap.lat,
      dSnap.lon,
      from.state,
      to.state,
      routingEngine,
      {
        length: load.length,
        width: load.width,
        height: load.height,
        weight: load.weight,
      },
      load.specialInstructions
    )
    if (corridors.length === 0) return []
    legs.push(corridors[0])
  }

  return [mergeCorridorLegs(legs)]
}

/**
 * Layer 2: Intelligent Corridor (permanent default) + Data-Driven Flagging
 *
 * Intelligent routing via OSRM/GraphHopper + Nominatim is the ONLY way corridors
 * are built. There is no naive state-pair fallback. Manual route override is the
 * sole exception (for the "Change Route" feature).
 * specialInstructions on LoadDetails (if present) is passed through to enable preference-biased corridor selection.
 */
async function buildRouteCorridor(load: LoadDetails): Promise<Array<{
  routeCorridor: string[]
  highways?: string[]
  permitRequiredStates: string[]
  escortRequiredStates?: string[]
  escortWarnings?: string[]
  escortDetails?: StateEscortDetail[]
  curfewNotes?: string[]
  specialNotes?: string[]
  seasonalWeightRestrictions?: string[]
  stateRules?: StatePermitRule[]
  dotRestrictions?: string[]
  reasons: string[]
  notes: string[]
  distanceMiles?: number
  durationHours?: number
  routingEngine?: RoutingEngine
  routingEngineNote?: string
}>> {
  const analyzedOptions: Array<any> = []

  // Support manual route override (for "Change Route" feature)
  if (load.manualRoute && Array.isArray(load.manualRoute) && load.manualRoute.length > 0) {
    const routeCorridor = load.manualRoute.map((s: string) => s.toUpperCase().trim()).filter(Boolean)
    const notes = [`Manual route used: ${routeCorridor.join(' → ')}`]

    const option = await analyzeCorridor(load, { routeCorridor, highways: [], distanceMeters: undefined, durationSeconds: undefined }, notes)
    analyzedOptions.push(option)

    return analyzedOptions
  }

  // Multi-stop: build sequential legs when explicit drops are present
  if (load.drops && load.drops.length > 0) {
    const multiCorridors = await buildMultiLegCorridor(load)
    if (multiCorridors.length === 0) return analyzedOptions

    for (const corridor of multiCorridors) {
      const notes: string[] = []
      if (corridor.distanceMeters) {
        const miles = (corridor.distanceMeters / 1609.34).toFixed(1)
        const engineLabel = corridor.engine === 'graphhopper' ? 'GraphHopper (truck profile)' : 'OSRM'
        notes.push(`Used multi-stop intelligent routing (${engineLabel}). Distance: ${miles} miles across ${load.drops.length + 1} stops`)
      }
      if (corridor.engineNote) notes.push(corridor.engineNote)
      if (corridor.userPreferenceNote) notes.push(corridor.userPreferenceNote)

      const option = await analyzeCorridor(load, corridor, notes)
      ;(option as any).routingEngine = corridor.engine
      ;(option as any).routingEngineNote = corridor.engineNote
      analyzedOptions.push(option)
    }
    return analyzedOptions
  }

  // Determine routing engine (defaults to OSRM for full backward compatibility)
  const routingEngine: RoutingEngine = load.routingEngine || 'osrm'

  // Snap origin/destination to nearest state highway (avoids local/county permits by default)
  const oSnap = await snapToStateHighway(load.originLat!, load.originLon!)
  const dSnap = await snapToStateHighway(load.destinationLat!, load.destinationLon!)

  // Get multiple route options from selected engine (OSRM or GraphHopper truck profile)
  const corridors: CorridorResult[] = await buildIntelligentCorridor(
    oSnap.lat,
    oSnap.lon,
    dSnap.lat,
    dSnap.lon,
    load.origin?.state,
    load.destination?.state,
    routingEngine,
    // Pass load dimensions so GraphHopper can apply real truck profile constraints
    {
      length: load.length,
      width: load.width,
      height: load.height,
      weight: load.weight,
    },
    load.specialInstructions
  )

  if (corridors.length === 0) {
    // Intelligent routing (OSRM or GraphHopper + Nominatim reverse geocoding) is the
    // permanent and only default. There is no naive origin/destination state-pair fallback.
    // If we cannot build a real corridor, we return empty so the UI surfaces a clear error.
    return analyzedOptions
  }

  // Analyze each corridor option
  for (const corridor of corridors) {
    const notes: string[] = []
    if (corridor.distanceMeters) {
      const miles = (corridor.distanceMeters / 1609.34).toFixed(1)
      const engineLabel = corridor.engine === 'graphhopper' ? 'GraphHopper (truck profile)' : 'OSRM'
      notes.push(`Used intelligent routing (${engineLabel}). Distance: ${miles} miles`)
    }
    if (corridor.engineNote) {
      notes.push(corridor.engineNote)
    }
    // Surface any user pref note (typed via imported CorridorResult; no any cast needed for new field)
    if (corridor.userPreferenceNote) {
      notes.push(corridor.userPreferenceNote)
    }

    const option = await analyzeCorridor(load, corridor, notes)
    // Attach engine metadata to the final option for UI display (pre-existing casts on local anonymous shape from analyzeCorridor return; our new field no longer requires any)
    ;(option as any).routingEngine = corridor.engine
    ;(option as any).routingEngineNote = corridor.engineNote
    analyzedOptions.push(option)
  }

  return analyzedOptions
}

// Helper to analyze a single corridor against state permit rules + real DOT corridor restrictions
async function analyzeCorridor(
  load: LoadDetails,
  corridor: {
    routeCorridor: string[]
    highways?: string[]
    distanceMeters?: number
    durationSeconds?: number
    engine?: RoutingEngine
    engineNote?: string
  },
  baseNotes: string[]
) {
  const permitRequiredStates = new Set<string>()
  const curfewNotes: string[] = []
  const specialNotes: string[] = []
  const seasonalNotes: string[] = []
  const reasons: string[] = []
  const notes = [...baseNotes]

  let distanceMiles: number | undefined
  let durationHours: number | undefined

  if (corridor.distanceMeters) {
    distanceMiles = parseFloat((corridor.distanceMeters / 1609.34).toFixed(1))
  }
  if (corridor.durationSeconds) {
    durationHours = parseFloat((corridor.durationSeconds / 3600).toFixed(1))
  }

  const routeCorridor = corridor.routeCorridor
  let rules: StatePermitRule[] | null = null
  let escortAnalysis: {
    escortRequiredStates: string[]
    escortWarnings: string[]
    escortDetails: StateEscortDetail[]
  } = {
    escortRequiredStates: [],
    escortWarnings: [],
    escortDetails: [],
  }

  // Declare at function scope so the return statement can always reference it
  let dotNotes: string[] = []

  if (routeCorridor.length > 0) {
    const { data: fetchedRules, error: rulesError } = await supabase
      .from('state_permit_rules')
      .select('*')
      .in('state_code', routeCorridor) as { data: StatePermitRule[] | null; error: any }

    rules = fetchedRules

    if (rulesError) {
      notes.push(`Warning: Could not load state permit rules (${rulesError.message}). Using conservative defaults for missing states.`)
      console.warn('state_permit_rules query failed:', rulesError)
    }

    const ruleMap = new Map(rules?.map(r => [r.state_code, r]) || [])

    escortAnalysis = analyzeEscortRequirements({
      routeCorridor,
      load: {
        width: load.width,
        length: load.length,
        height: load.height,
        weight: load.weight,
      },
      ruleMap,
      highways: corridor.highways || [],
    })
    const escortStateSet = new Set(escortAnalysis.escortRequiredStates)

    // Per-state evaluation (much more accurate than global checks)
    routeCorridor.forEach(state => {
      const rule = ruleMap.get(state)

      if (!rule) {
        // No rule in state_permit_rules table — apply conservative default (require permit)
        permitRequiredStates.add(state)
        const label = getJurisdictionLabel(state)
        reasons.push(`${state} (${label}): Requires permit (no rule in database — conservative default)`)
        return
      }

      const needsEscort = escortStateSet.has(state)

      // Determine effective thresholds (fall back to legal_*)
      let permitWidth  = rule.permit_threshold_width_ft  ?? rule.legal_width_ft
      let permitHeight = rule.permit_threshold_height_ft ?? rule.legal_height_ft
      let permitLengthRaw = rule.permit_threshold_length_ft ?? rule.legal_length_ft
      let permitWeight = rule.permit_threshold_weight_lbs ?? rule.legal_weight_lbs

      // Fallback to standard US oversize thresholds when the DB effective value
      // (after ??) is null/undefined/<=0 (or NaN). This handles seeded state_permit_rules
      // rows that only populate curfews/notes/pricing but leave dimension columns
      // NULL or 0 (causing 11.5 > null === false etc.). Respects explicit positive
      // per-state DB values when present.
      if (permitWidth  == null || permitWidth  <= 0 || (typeof permitWidth === 'number' && Number.isNaN(permitWidth))) permitWidth  = 8.5
      if (permitHeight == null || permitHeight <= 0 || (typeof permitHeight === 'number' && Number.isNaN(permitHeight))) permitHeight = 13.5
      if (permitWeight == null || permitWeight <= 0 || (typeof permitWeight === 'number' && Number.isNaN(permitWeight))) permitWeight = 80000

      const permitLengthRawForCheck =
        permitLengthRaw == null || permitLengthRaw <= 0 || Number.isNaN(permitLengthRaw)
          ? null
          : permitLengthRaw
      const needsLength = needsLengthPermit(
        load.length,
        load.trailerLengthFt,
        permitLengthRawForCheck
      )
      const permitLengthThreshold = effectiveEnvelopeLengthThreshold(permitLengthRawForCheck)

      // === Permit Required? ===
      const needsPermit =
        load.width  > permitWidth ||
        load.height > permitHeight ||
        needsLength ||
        load.weight > permitWeight

      if (needsPermit) {
        permitRequiredStates.add(state)

        // Build a specific, useful reason
        const exceeded: string[] = []
        if (load.width  > permitWidth)  exceeded.push(`width ${load.width} > ${permitWidth}`)
        if (load.height > permitHeight) exceeded.push(`height ${load.height} > ${permitHeight}`)
        if (needsLength) {
          exceeded.push(`envelope length ${load.length} > ${permitLengthThreshold}`)
        }
        if (load.weight > permitWeight) exceeded.push(`weight ${load.weight} > ${permitWeight}`)

        const label = getJurisdictionLabel(state)
        reasons.push(`${state} (${label}): Permit required — exceeds ${exceeded.join(', ')}`)
      }

      // === Collect rich contextual notes ===
      if (needsPermit || needsEscort) {
        if (rule.curfew_restrictions) {
          curfewNotes.push(`${state}: ${rule.curfew_restrictions}`)
        }
        if (rule.special_notes) {
          specialNotes.push(`${state}: ${rule.special_notes}`)
        }
        if (rule.seasonal_weight_restrictions) {
          seasonalNotes.push(`${state}: ${rule.seasonal_weight_restrictions}`)
        }
      } else if (rule.seasonal_weight_restrictions) {
        // Still surface seasonal info even if no permit is triggered (useful for planning)
        seasonalNotes.push(`${state}: ${rule.seasonal_weight_restrictions}`)
      }
    })

    // Summary notes (Canadian-aware)
    const permitCount = permitRequiredStates.size
    const escortCount = escortAnalysis.escortRequiredStates.length

    if (permitCount > 0) {
      const hasCanadian = Array.from(permitRequiredStates).some(isCanadian)
      const term = hasCanadian ? 'jurisdiction(s)' : 'state(s)'
      notes.push(`Permit required in ${permitCount} ${term} along this route.`)
    }
    if (escortCount > 0) {
      notes.push(`Escort(s) likely required in ${escortCount} jurisdiction(s).`)
    }

    // ============================================================
    // Layer real State DOT corridor restrictions (data-driven flagging)
    // ============================================================
    // This is the core enhancement: we now use actual posted restrictions
    // (low bridges, weight postings, curfews, etc.) to drive permit decisions
    // and produce far more accurate, corridor-specific reasons.
    const dotRestrictionsRaw = getRestrictionsForCorridor(routeCorridor, corridor.highways || [])
    dotNotes = dotRestrictionsRaw.map(formatRestrictionNote)

    // Merge DOT notes into specialNotes (for the "Route Restrictions" UI section)
    for (const dn of dotNotes) {
      if (!specialNotes.includes(dn)) {
        specialNotes.push(dn)
      }
    }

    // === Corridor-specific intelligent flagging (the real value) ===
    // For any height/weight/width/bridge/tunnel restriction on a highway in this corridor,
    // if the load actually exceeds the posted value, we force a permit requirement
    // and generate a much more precise reason than the generic state threshold.
    for (const r of dotRestrictionsRaw) {
      if (exceedsCorridorRestriction(load, r)) {
        permitRequiredStates.add(r.state)

        const label = getJurisdictionLabel(r.state)
        const restrictionDesc = `${r.highway}${r.mileMarker ? ' ' + r.mileMarker : ''} (${r.value}${r.unit || ''})`

        reasons.push(
          `${r.state} (${label}): Permit required — load exceeds specific DOT-posted restriction on ${restrictionDesc}. ${r.description.slice(0, 120)}${r.description.length > 120 ? '...' : ''}`
        )
      }
    }

    if (dotRestrictionsRaw.length > 0) {
      notes.push(`Loaded ${dotRestrictionsRaw.length} real-world restriction(s) from State DOT open data for this corridor.`)
    }
  }

  return {
    routeCorridor,
    highways: corridor.highways || [],
    permitRequiredStates: Array.from(permitRequiredStates).sort(),
    escortRequiredStates: escortAnalysis.escortRequiredStates,
    escortWarnings: escortAnalysis.escortWarnings,
    escortDetails: escortAnalysis.escortDetails,
    curfewNotes: Array.from(new Set(curfewNotes)),
    specialNotes: Array.from(new Set(specialNotes)),
    seasonalWeightRestrictions: Array.from(new Set(seasonalNotes)),
    stateRules: (rules as StatePermitRule[]) || [],
    // NEW: Pass through the actual DOT restriction objects (or formatted strings) for rich UI
    dotRestrictions: Array.from(new Set(dotNotes)),
    reasons,
    notes,
    distanceMiles,
    durationHours,
    routingEngine: corridor.engine,
    routingEngineNote: corridor.engineNote,
  }
}

/**
 * Main Permit Agent Function
 *
 * Intelligent routing is permanent. Expanded State DOT data (all 50 states,
 * heavily seeded on 12 high-traffic corridors) is used for accurate flagging.
 */
export async function processPermitRequest(loadDetails: LoadDetails): Promise<PermitAgentResult> {
  const missingFields = validateLoadDetails(loadDetails)

  if (missingFields.length > 0) {
    return {
      status: 'invalid',
      message: `Missing required fields: ${missingFields.join(', ')}`,
      loadDetails,
      options: [],
      missingFields,
    }
  }

  const analyzedOptions = await buildRouteCorridor(loadDetails)

  // If intelligent routing failed to produce any corridors, return a clear error
  if (analyzedOptions.length === 0) {
    return {
      status: 'invalid',
      message: 'Could not generate an intelligent route. Please ensure both origin and destination have valid coordinates (geocoding succeeded).',
      loadDetails,
      options: [],
      missingFields: [],
    }
  }

  // Convert analyzed corridors into the new option format (now with richer data)
  const options: AnalyzedRouteOption[] = analyzedOptions.map(option => {
    const cost = calculateEstimatedCost(option.permitRequiredStates, loadDetails, option.stateRules || [], option.notes)
    return {
      routeCorridor: option.routeCorridor,
      highways: option.highways,
      permitRequiredStates: option.permitRequiredStates,
      escortRequiredStates: option.escortRequiredStates || [],
      escortWarnings: option.escortWarnings || [],
      escortDetails: option.escortDetails || [],
      curfewNotes: option.curfewNotes || [],
      specialNotes: option.specialNotes || [],
      seasonalWeightRestrictions: option.seasonalWeightRestrictions || [],
      stateRules: option.stateRules || [],
      // DOT real-world restrictions (new data layer)
      dotRestrictions: option.dotRestrictions || [],
      reasons: option.reasons,
      notes: cost.notes,
      distanceMiles: option.distanceMiles,
      durationHours: option.durationHours,
      estimatedCost: cost.total,
      costBreakdown: cost,
      // Engine provenance
      routingEngine: option.routingEngine,
      routingEngineNote: option.routingEngineNote,
    }
  })

  const requiresPermit = options.some(o => o.permitRequiredStates.length > 0)

  return {
    status: 'pending_review',
    message: requiresPermit
      ? `Permit requirements detected across multiple route options.`
      : 'No permit requirements flagged on the current route options.',
    loadDetails,
    options,
    missingFields: [],
  }
}
