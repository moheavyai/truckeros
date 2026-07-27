/**
 * Pure mapper: OR-Tools / agent option (+ optional form coords) → RouteMapViewModel.
 * No DOM / MapLibre dependency — unit-test friendly.
 *
 * Line geometry (v1): sequential stop coordinates.
 * Extension: if legs later expose shape/geometry polylines, prefer those here.
 */

import type {
  BuildRouteMapModelInput,
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

function roleForIndexedStop(
  stop: OptimizeRouteStopLike,
  index: number,
  total: number
): RouteMapStopRole {
  if (index === 0) return 'origin'
  if (index === total - 1) return 'destination'
  if (stop.is_via || stop.is_via_stop) return 'via'
  if (stop.is_drop) return 'drop'
  return 'via'
}

function mapOptimizeStops(rawStops: OptimizeRouteStopLike[]): RouteMapStop[] {
  const withCoords = rawStops
    .map((s, i) => {
      const lat = toFiniteNumber(s.lat)
      const lon = toFiniteNumber(s.lon)
      if (lat == null || lon == null) return null
      return { raw: s, lat, lon, index: i }
    })
    .filter(Boolean) as Array<{ raw: OptimizeRouteStopLike; lat: number; lon: number; index: number }>

  const total = withCoords.length
  return withCoords.map((item, mappedIndex) => {
    const role = roleForIndexedStop(item.raw, mappedIndex, total)
    const fallback =
      role === 'origin'
        ? 'Origin'
        : role === 'destination'
          ? 'Destination'
          : role === 'drop'
            ? `Drop ${mappedIndex}`
            : `Via ${mappedIndex}`
    return {
      id: `stop-${mappedIndex}`,
      name: stopName(item.raw, fallback),
      lat: item.lat,
      lon: item.lon,
      role,
    }
  })
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
  drops.forEach((d, i) => {
    const lat = toFiniteNumber(d?.lat)
    const lon = toFiniteNumber(d?.lon)
    if (lat == null || lon == null) return
    // Intermediate drops stay "drop"; last form stop reclassified below if it is the destination.
    out.push({
      id: `form-drop-${i}`,
      name: stopName(d || {}, drops.length === 1 ? 'Destination' : `Drop ${i + 1}`),
      lat,
      lon,
      role: 'drop',
    })
  })

  // If destination differs from last drop (or no drops), add destination marker.
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
    // Multi-stop form without explicit dest: last drop is destination.
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
): [number, number][] {
  const fromLegs: [number, number][] = []
  const legs = option?.legs
  if (Array.isArray(legs) && legs.length > 0) {
    for (const leg of legs) {
      const shape = extractLatLonPairs(leg?.shape ?? leg?.geometry)
      if (shape.length > 0) {
        // Avoid duplicating shared vertices between consecutive legs.
        if (fromLegs.length > 0 && shape.length > 0) {
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
  return stops.map((s) => [s.lat, s.lon] as [number, number])
}

/** Best-effort parse of GeoJSON LineString / coordinate arrays → [lat, lon][]. */
function extractLatLonPairs(raw: unknown): [number, number][] {
  if (!raw) return []
  // GeoJSON geometry { type, coordinates: [lon, lat][] }
  if (typeof raw === 'object' && raw !== null && 'coordinates' in (raw as object)) {
    const coords = (raw as { coordinates: unknown }).coordinates
    return coordsToLatLon(coords)
  }
  if (Array.isArray(raw)) {
    return coordsToLatLon(raw)
  }
  return []
}

function coordsToLatLon(coords: unknown): [number, number][] {
  if (!Array.isArray(coords) || coords.length === 0) return []
  // Nested MultiLineString
  if (Array.isArray(coords[0]) && Array.isArray((coords[0] as unknown[])[0])) {
    const out: [number, number][] = []
    for (const part of coords as unknown[]) {
      out.push(...coordsToLatLon(part))
    }
    return out
  }
  // [lon, lat] pairs (GeoJSON) or [lat, lon] if first component looks like lat
  const out: [number, number][] = []
  for (const pair of coords as unknown[]) {
    if (!Array.isArray(pair) || pair.length < 2) continue
    const a = toFiniteNumber(pair[0])
    const b = toFiniteNumber(pair[1])
    if (a == null || b == null) continue
    // Heuristic: lon is typically outside [-90,90] more often, but US lon is ~-70..-125.
    // Prefer GeoJSON order [lon, lat] when |a| > 90 or |b| <= 90 && |a| > 40 with negative a (US).
    const looksLikeLonLat = Math.abs(a) > 90 || (Math.abs(a) > 30 && Math.abs(b) <= 90)
    if (looksLikeLonLat) {
      out.push([b, a]) // lat, lon
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
  } else if (option.specialInstructionsEnforced === false && (avoided.length > 0 || option.chosenCorridorRationale)) {
    chips.push({ label: 'Prefs partial', tone: 'warning' })
  }

  return chips
}

/**
 * Build a presentational view model from optimize option and/or form geocodes.
 */
export function buildRouteMapModel(input: BuildRouteMapModelInput): RouteMapViewModel {
  const { status, message, option, formStops, pendingWaypoints } = input

  let stops: RouteMapStop[] = []
  if (option?.stops && Array.isArray(option.stops) && option.stops.length > 0) {
    stops = mapOptimizeStops(option.stops)
  }
  if (stops.length === 0 && formStops) {
    stops = mapFormStops(formStops)
  }

  const linePositions =
    status === 'ready' || stops.length >= 2
      ? buildLinePositions(stops, option)
      : stops.map((s) => [s.lat, s.lon] as [number, number])

  const chips = status === 'ready' || status === 'calculating' ? buildChips(option) : buildChips(option)
  // Idle: only show chips when option already ready (e.g. sticky results); form-only idle has no chips.
  const resolvedChips =
    status === 'idle' && !(option?.routeCorridor?.length || option?.distanceMiles)
      ? []
      : chips

  let resolvedMessage = message
  if (!resolvedMessage) {
    if (status === 'idle' && stops.length === 0) {
      resolvedMessage = 'Enter origin and destination to preview the route map'
    } else if (status === 'idle' && stops.length > 0) {
      resolvedMessage = 'Route map ready — analysis runs when load details are complete'
    } else if (status === 'calculating') {
      resolvedMessage = 'Calculating best route…'
    } else if (status === 'error') {
      resolvedMessage = 'Route calculation failed'
    }
  }

  return {
    stops,
    linePositions: status === 'error' && !option?.stops ? stops.map((s) => [s.lat, s.lon] as [number, number]) : linePositions,
    chips: resolvedChips,
    status,
    message: resolvedMessage,
    pendingWaypoints: pendingWaypoints?.length ? pendingWaypoints : undefined,
  }
}
