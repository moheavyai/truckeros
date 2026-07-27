/**
 * Pure adapter: Permit Test page state → BuildRouteMapModelInput.
 * Keeps the mega-page thin; unit-testable without React.
 */

import type {
  BuildRouteMapModelInput,
  FormRouteStopsLike,
  OptimizeRouteOptionLike,
  RouteMapStatus,
} from './types'

export type PermitRouteProgress = 'idle' | 'geocoding' | 'calculating' | 'ready' | 'error'

export interface PermitFormSyncedLike {
  origin: { city?: string; state?: string; query?: string }
  destination: { city?: string; state?: string; query?: string }
  drops?: Array<{
    city?: string
    state?: string
    query?: string
    lat?: number | null
    lon?: number | null
  }>
  originLat?: number | null
  originLon?: number | null
  destinationLat?: number | null
  destinationLon?: number | null
}

export interface ToRouteMapBuildInputArgs {
  routeProgress: PermitRouteProgress
  routeProgressDetail?: string
  /** Primary optimize option (agentResult.options[0] etc.). */
  primary?: OptimizeRouteOptionLike | null
  formSynced: PermitFormSyncedLike
  /** Origin + all drops have valid coords. */
  coordsReady: boolean
  /** weight/length/width/height all > 0. */
  dimsReady: boolean
}

function stopLabel(
  parts: { city?: string; state?: string; query?: string },
  fallback: string
): string {
  const joined = [parts.city, parts.state].filter(Boolean).join(', ')
  return joined || parts.query || fallback
}

function mapStatusFromProgress(
  routeProgress: PermitRouteProgress,
  coordsReady: boolean,
  dimsReady: boolean
): RouteMapStatus {
  if (routeProgress === 'error') return 'error'
  if (routeProgress === 'calculating' || routeProgress === 'geocoding') return 'calculating'
  // Demote sticky Ready when addresses/dims no longer complete (honesty).
  if (routeProgress === 'ready') {
    if (!coordsReady || !dimsReady) return 'idle'
    return 'ready'
  }
  return 'idle'
}

function messageForProgress(
  routeProgress: PermitRouteProgress,
  detail?: string
): string | undefined {
  if (routeProgress === 'error') return detail || 'Route calculation failed'
  if (routeProgress === 'geocoding') return detail || 'Resolving addresses…'
  if (routeProgress === 'calculating') return detail || 'Calculating best route…'
  return undefined
}

function formStopsFromSynced(formSynced: PermitFormSyncedLike): FormRouteStopsLike {
  return {
    origin: {
      name: stopLabel(formSynced.origin, 'Origin'),
      lat: formSynced.originLat ?? null,
      lon: formSynced.originLon ?? null,
    },
    drops: (formSynced.drops || []).map((d, i) => ({
      name: stopLabel(d, `Drop ${i + 1}`),
      lat: d.lat ?? null,
      lon: d.lon ?? null,
    })),
    destination: {
      name: stopLabel(formSynced.destination, 'Destination'),
      lat: formSynced.destinationLat ?? null,
      lon: formSynced.destinationLon ?? null,
    },
  }
}

/**
 * Build pure BuildRouteMapModelInput from permit-test routing state.
 */
export function toRouteMapBuildInput(args: ToRouteMapBuildInputArgs): BuildRouteMapModelInput {
  const { routeProgress, routeProgressDetail, primary, formSynced, coordsReady, dimsReady } =
    args

  const status = mapStatusFromProgress(routeProgress, coordsReady, dimsReady)

  // Pass option only while actively calculating or honestly ready (chips only when ready).
  const optionForMap: OptimizeRouteOptionLike | null =
    status === 'ready' || status === 'calculating' ? primary || null : null

  return {
    status,
    message: messageForProgress(routeProgress, routeProgressDetail),
    option: optionForMap,
    formStops: formStopsFromSynced(formSynced),
  }
}
