/**
 * Pure mapper: OR-Tools / agent option (+ optional form coords) → RouteMapViewModel.
 * No DOM / MapLibre dependency — unit-test friendly.
 *
 * Line geometry (v1): sequential stop coordinates as LatLon [lat, lon].
 * Extension: if legs later expose shape/geometry polylines, prefer those here.
 */

import type {
  BuildRouteMapModelInput,
  LatLon,
  OptimizeRouteOptionLike,
  OptimizeRouteStopLike,
  RouteMapChip,
  RouteMapStop,
  RouteMapStopRole,
  RouteMapViewModel,
} from './types'

function toFiniteNumber(value: unknown): number | null {
  if (value == null || value === '') return null
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

function stopName(raw: OptimizeRouteStopLike | { name?: string | null }, fallback: string): string {
  const n = (raw?.name || '').toString().trim()
  return n || fallback
}

/**
 * Role from original list index/flags (before coord filter).
 * Prevents mislabeling origin/dest when an intermediate stop lacks coords.
 * Single-element list → destination (last-index semantics).
 */
export function roleForOriginalIndex(
  stop: OptimizeRouteStopLike,
  index: number,
  originalTotal: number
): RouteMapStopRole {
  if (originalTotal === 1) return 'destination'
  if (index === 0) return 'origin'
  if (originalTotal > 0 && index === originalTotal - 1) return 'destination'
  if (stop.is_via || stop.is_via_stop) return 'via'
  if (stop.is_drop) return 'drop'
  return 'via'
}

function mapOptimizeStops(rawStops: OptimizeRouteStopLike[]): RouteMapStop[] {
  const originalTotal = rawStops.length
  let dropCount = 0
  let viaCount = 0
  const out: RouteMapStop[] = []

  for (let i = 0; i < rawStops.length; i++) {
    const raw = rawStops[i]
    const lat = toFiniteNumber(raw.lat)
    const lon = toFiniteNumber(raw.lon)
    if (lat == null || lon == null) continue

    const role = roleForOriginalIndex(raw, i, originalTotal)
    let fallback = 'Stop'
    if (role === 'origin') fallback = 'Origin'
    else if (role === 'destination') fallback = 'Destination'
    else if (role === 'drop') {
      dropCount += 1
      fallback = `Drop ${dropCount}`
    } else {
      viaCount += 1
      fallback = `Via ${viaCount}`
    }

    out.push({
      id: `stop-${i}`,
      name: stopName(raw, fallback),
      lat,
      lon,
      role,
    })
  }

  return out
}

function mapFormStops(form: NonNullable<BuildRouteMapModelInput['formStops']>): RouteMapStop[] {
  const out: RouteMapStop[] = []
  const oLat = toFiniteNumber(form.origin?.lat)
  const oLon = toFiniteNumber(form.origin?.lon)
  if (oLat != null && oLon != null) {
    out.push({
      id: 'form-origin',
      name: stopName(form.origin || {}, 'Origin'),
      lat: oLat,
      lon: oLon,
      role: 'origin',
    })
  }

  const drops = Array.isArray(form.drops) ? form.drops : []
  let dropOrdinal = 0
  drops.forEach((d, i) => {
    const lat = toFiniteNumber(d?.lat)
    const lon = toFiniteNumber(d?.lon)
    if (lat == null || lon == null) return
    dropOrdinal += 1
    out.push({
      id: `form-drop-${i}`,
      name: stopName(d || {}, drops.length === 1 ? 'Destination' : `Drop ${dropOrdinal}`),
      lat,
      lon,
      role: 'drop',
    })
  })

  const dLat = toFiniteNumber(form.destination?.lat)
  const dLon = toFiniteNumber(form.destination?.lon)
  if (dLat != null && dLon != null) {
    const last = out[out.length - 1]
    const sameAsLast =
      last && Math.abs(last.lat - dLat) < 1e-5 && Math.abs(last.lon - dLon) < 1e-5
    if (sameAsLast && last.role !== 'origin') {
      last.role = 'destination'
      last.name = stopName(form.destination || {}, last.name || 'Destination')
      last.id = 'form-destination'
    } else if (!sameAsLast) {
      out.push({
        id: 'form-destination',
        name: stopName(form.destination || {}, 'Destination'),
        lat: dLat,
        lon: dLon,
        role: 'destination',
      })
    }
  } else if (out.length > 1) {
    const last = out[out.length - 1]
    if (last.role === 'drop') last.role = 'destination'
  }

  return out
}

/**
 * Prefer full leg geometry when present; otherwise sequential stop coords.
 * Extension point for Map v2 / richer OSRM polylines.
 */
export function buildLinePositions(
  stops: RouteMapStop[],
  option?: OptimizeRouteOptionLike | null
): LatLon[] {
  const fromLegs: LatLon[] = []
  const legs = option?.legs
  if (Array.isArray(legs) && legs.length > 0) {
    for (const leg of legs) {
      const shape = extractLatLonPairs(leg?.shape ?? leg?.geometry)
      if (shape.length > 0) {
        if (fromLegs.length > 0) {
          const last = fromLegs[fromLegs.length - 1]
          const first = shape[0]
          if (Math.abs(last[0] - first[0]) < 1e-7 && Math.abs(last[1] - first[1]) < 1e-7) {
            fromLegs.push(...shape.slice(1))
          } else {
            fromLegs.push(...shape)
          }
        } else {
          fromLegs.push(...shape)
        }
      }
    }
  }
  if (fromLegs.length >= 2) return fromLegs
  return stops.map((s) => [s.lat, s.lon] as LatLon)
}

/** Best-effort parse of GeoJSON LineString / coordinate arrays → LatLon[]. */
function extractLatLonPairs(raw: unknown): LatLon[] {
  if (!raw) return []
  // GeoJSON geometry object: always [lon, lat] per RFC 7946
  if (typeof raw === 'object' && raw !== null && 'coordinates' in (raw as object)) {
    const coords = (raw as { type?: string; coordinates: unknown }).coordinates
    return coordsAsGeoJsonLonLat(coords)
  }
  // Bare arrays: heuristic (legacy / non-GeoJSON shapes)
  if (Array.isArray(raw)) {
    return coordsToLatLonHeuristic(raw)
  }
  return []
}

/** Explicit GeoJSON order [lon, lat] → LatLon [lat, lon]. */
function coordsAsGeoJsonLonLat(coords: unknown): LatLon[] {
  if (!Array.isArray(coords) || coords.length === 0) return []
  if (Array.isArray(coords[0]) && Array.isArray((coords[0] as unknown[])[0])) {
    const out: LatLon[] = []
    for (const part of coords as unknown[]) {
      out.push(...coordsAsGeoJsonLonLat(part))
    }
    return out
  }
  const out: LatLon[] = []
  for (const pair of coords as unknown[]) {
    if (!Array.isArray(pair) || pair.length < 2) continue
    const lon = toFiniteNumber(pair[0])
    const lat = toFiniteNumber(pair[1])
    if (lat == null || lon == null) continue
    out.push([lat, lon])
  }
  return out
}

/**
 * Heuristic for bare coordinate arrays only (not GeoJSON objects).
 * Prefer [lon, lat] when first component looks like longitude.
 */
function coordsToLatLonHeuristic(coords: unknown): LatLon[] {
  if (!Array.isArray(coords) || coords.length === 0) return []
  if (Array.isArray(coords[0]) && Array.isArray((coords[0] as unknown[])[0])) {
    const out: LatLon[] = []
    for (const part of coords as unknown[]) {
      out.push(...coordsToLatLonHeuristic(part))
    }
    return out
  }
  const out: LatLon[] = []
  for (const pair of coords as unknown[]) {
    if (!Array.isArray(pair) || pair.length < 2) continue
    const a = toFiniteNumber(pair[0])
    const b = toFiniteNumber(pair[1])
    if (a == null || b == null) continue
    const looksLikeLonLat = Math.abs(a) > 90 || (Math.abs(a) > 30 && Math.abs(b) <= 90)
    if (looksLikeLonLat) {
      out.push([b, a])
    } else {
      out.push([a, b])
    }
  }
  return out
}

function buildChips(option?: OptimizeRouteOptionLike | null): RouteMapChip[] {
  if (!option) return []
  const chips: RouteMapChip[] = []

  const corridor = Array.isArray(option.routeCorridor)
    ? option.routeCorridor.filter(Boolean)
    : []
  if (corridor.length > 0) {
    chips.push({ label: corridor.join(' → '), tone: 'info' })
  }

  const miles = toFiniteNumber(option.distanceMiles)
  if (miles != null && miles > 0) {
    chips.push({
      label: `${Math.round(miles).toLocaleString()} mi`,
      tone: 'neutral',
    })
  }

  const hours = toFiniteNumber(option.durationHours)
  if (hours != null && hours > 0) {
    chips.push({
      label: `~${hours % 1 === 0 ? hours : hours.toFixed(1)} hrs`,
      tone: 'neutral',
    })
  }

  const avoided = Array.isArray(option.avoidedStates)
    ? option.avoidedStates.filter(Boolean)
    : []
  if (avoided.length > 0) {
    chips.push({
      label: `Avoids ${avoided.join(', ')}`,
      tone: option.specialInstructionsEnforced ? 'success' : 'warning',
    })
  }

  if (option.specialInstructionsEnforced === true) {
    chips.push({ label: 'Prefs enforced', tone: 'success' })
  } else if (
    option.specialInstructionsEnforced === false &&
    (avoided.length > 0 || option.chosenCorridorRationale)
  ) {
    chips.push({ label: 'Prefs partial', tone: 'warning' })
  }

  return chips
}

/**
 * Chip policy:
 * - ready: full honesty chips from option
 * - calculating / error / idle: no chips (avoids stale success chrome)
 */
function resolveChips(
  status: BuildRouteMapModelInput['status'],
  option?: OptimizeRouteOptionLike | null
): RouteMapChip[] {
  if (status !== 'ready') return []
  return buildChips(option)
}

/**
 * Build a presentational view model from optimize option and/or form geocodes.
 *
 * Stop source policy:
 * - ready: prefer option.stops
 * - idle / error: prefer formStops (avoid sticky optimized markers when incomplete)
 * - calculating: form first, then previous option stops as fallback
 */
export function buildRouteMapModel(input: BuildRouteMapModelInput): RouteMapViewModel {
  const { status, message, option, formStops, pendingWaypoints } = input

  let stops: RouteMapStop[] = []
  const optionStops =
    option?.stops && Array.isArray(option.stops) && option.stops.length > 0
      ? mapOptimizeStops(option.stops)
      : []
  const formMapped = formStops ? mapFormStops(formStops) : []

  if (status === 'ready' && optionStops.length > 0) {
    stops = optionStops
  } else if (formMapped.length > 0) {
    stops = formMapped
  } else if (optionStops.length > 0) {
    stops = optionStops
  }

  const linePositions: LatLon[] =
    status === 'ready' || stops.length >= 2
      ? buildLinePositions(stops, status === 'ready' ? option : null)
      : stops.map((s) => [s.lat, s.lon] as LatLon)

  const resolvedChips = resolveChips(status, option)

  let resolvedMessage = message
  if (!resolvedMessage) {
    if (status === 'idle' && stops.length === 0) {
      resolvedMessage = 'Enter origin and destination to preview the route map'
    } else if (status === 'calculating') {
      resolvedMessage = 'Calculating best route…'
    } else if (status === 'error') {
      resolvedMessage = 'Route calculation failed'
    }
  }

  // Empty idle only: message for single empty channel (overlay). No double footer.
  if (status === 'idle' && stops.length > 0) {
    resolvedMessage = undefined
  }

  return {
    stops,
    linePositions:
      status === 'error' && optionStops.length === 0
        ? stops.map((s) => [s.lat, s.lon] as LatLon)
        : linePositions,
    chips: resolvedChips,
    status,
    message: resolvedMessage,
    pendingWaypoints: pendingWaypoints?.length ? pendingWaypoints : undefined,
  }
}
