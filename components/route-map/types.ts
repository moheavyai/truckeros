/**
 * Route map view-model types (Map v1).
 *
 * Extension points for Map v2 (manualWaypoints click/drag editor):
 * - `pendingWaypoints` is reserved on the view model (typed only; unused in UI v1).
 * - `RouteMapStop.role` covers origin/via/drop/destination so v2 can re-order vias.
 * - `RouteMapLeg.shape` is reserved for full geometry polylines when legs expose them later.
 * - Drag-edit handlers are intentionally not part of the v1 public component API.
 */

export type RouteMapStopRole = 'origin' | 'via' | 'drop' | 'destination'

export type RouteMapStopState = 'default' | 'selected' | 'pending'

export type RouteMapStatus = 'idle' | 'calculating' | 'ready' | 'error'

export type RouteMapChipTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger'

/** Named [lat, lon] tuple — Leaflet-native order; use as-is for markers/polyline. */
export type LatLon = [lat: number, lon: number]

export interface RouteMapStop {
  id: string
  name: string
  lat: number
  lon: number
  role: RouteMapStopRole
  state?: RouteMapStopState
}

/** Optional per-leg geometry extension (v1 uses stop-to-stop linePositions). */
export interface RouteMapLeg {
  fromId?: string
  toId?: string
  /** Full geometry as LatLon[] when available from engine legs later. */
  shape?: LatLon[]
}

export interface RouteMapChip {
  label: string
  tone?: RouteMapChipTone
}

/** Map v2 hook: click/drag waypoints not yet rendered in v1. */
export interface PendingWaypoint {
  /** Stable id for future drag-edit (Map v2). */
  id?: string
  lat: number
  lon: number
  name?: string
}

export interface RouteMapViewModel {
  stops: RouteMapStop[]
  /** Sequential LatLon for a simple route line (stop order in v1). */
  linePositions: LatLon[]
  chips: RouteMapChip[]
  status: RouteMapStatus
  message?: string
  /** Reserved for Map v2 waypoint editor — typed, unused in UI v1. */
  pendingWaypoints?: PendingWaypoint[]
}

/** Minimal stop shape from OR-Tools / optimize-route option.stops. */
export interface OptimizeRouteStopLike {
  name?: string | null
  lat?: number | string | null
  lon?: number | string | null
  is_via?: boolean | null
  is_via_stop?: boolean | null
  is_drop?: boolean | null
  state?: string | null
}

/** Minimal option shape from agent / OR-Tools primary. */
export interface OptimizeRouteOptionLike {
  stops?: OptimizeRouteStopLike[] | null
  legs?: Array<{
    geometry?: unknown
    shape?: unknown
    from?: { lat?: number; lon?: number; name?: string } | null
    to?: { lat?: number; lon?: number; name?: string } | null
  }> | null
  routeCorridor?: string[] | null
  distanceMiles?: number | null
  durationHours?: number | null
  avoidedStates?: string[] | null
  specialInstructionsEnforced?: boolean | null
  chosenCorridorRationale?: string | null
  notes?: string[] | null
}

/** Form-side coords when option.stops are not yet available (idle / calculating). */
export interface FormRouteStopsLike {
  origin?: { name?: string; lat?: number | null; lon?: number | null } | null
  drops?: Array<{ name?: string; lat?: number | null; lon?: number | null }> | null
  destination?: { name?: string; lat?: number | null; lon?: number | null } | null
}

export interface BuildRouteMapModelInput {
  status: RouteMapStatus
  message?: string
  option?: OptimizeRouteOptionLike | null
  formStops?: FormRouteStopsLike | null
  /** Reserved for Map v2 — passed through to view model only. */
  pendingWaypoints?: PendingWaypoint[]
}
