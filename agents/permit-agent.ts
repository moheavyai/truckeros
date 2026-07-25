// agents/permit-agent.ts

import { buildIntelligentCorridor, type BorderCrossing, type CorridorResult } from '@/lib/build-corridor'
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
import {
  attachScaleFieldsToOption,
  formatAxleGroupSummaryLine,
  resolveAxleGroupsFromConfig,
  type AxleGroupSummary,
  type ScaleFinding,
} from '@/lib/axle-groups'
import type { Tractor, Trailer } from '@/types/equipment'

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

  /** Total axles on the combination (for scale / axle-group checks). */
  axles?: number
  /** Per-axle weights (lbs), front → rear. */
  axleWeights?: number[]
  /**
   * Optional equipment snapshot for axle-group assignment
   * (tractor + trailers with trailer_type / num_axles).
   * When axleGroups is provided and consistent with equipment, agent uses it
   * so jeep/flip/stinger roles survive incomplete recompute.
   */
  equipment?: {
    tractor?: Partial<Tractor> | null
    trailers?: (Partial<Trailer> | null)[]
    axleGroups?: AxleGroupSummary | null
  } | null
}

export interface AnalyzedRouteOption {
  routeCorridor: string[]
  highways?: string[]
  /** Geometry-aligned state border entry/exit points for portal forms (empty for single-state). */
  borderCrossings?: BorderCrossing[]

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

  /** Axle group summary for overweight / scale guidance (steer/drives/jeep/trailer/flip/stinger). */
  axleGroupSummary?: string
  axleGroups?: AxleGroupSummary
  /** Structured scale + corridor findings (also mirrored into reasons/notes). */
  scaleFindings?: ScaleFinding[]
  /** States where the combination fails weight/scale under state laws. */
  corridorScaleFailedStates?: string[]
  /** True when the rig cannot scale the proposed load under simple group limits. */
  unableToScale?: boolean
}
