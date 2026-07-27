/**
 * Shared marker/legend colors so MapLibre markers and card legend stay in sync.
 */
import type { RouteMapStopRole } from './types'

export const ROUTE_MAP_ROLE_HEX: Record<RouteMapStopRole, string> = {
  origin: '#2563eb', // blue-600
  via: '#7c3aed', // violet-600
  drop: '#d97706', // amber-600
  destination: '#059669', // emerald-600
}

/** Tailwind bg classes matching ROUTE_MAP_ROLE_HEX (legend swatches). */
export const ROUTE_MAP_ROLE_SWATCH: Record<RouteMapStopRole, string> = {
  origin: 'bg-blue-600',
  via: 'bg-violet-600',
  drop: 'bg-amber-600',
  destination: 'bg-emerald-600',
}

export const ROUTE_MAP_ROLE_LABEL: Record<RouteMapStopRole, string> = {
  origin: 'Origin',
  via: 'Via',
  drop: 'Drop',
  destination: 'Destination',
}

export const ROUTE_MAP_MARKER_GLYPH: Record<RouteMapStopRole, string> = {
  origin: 'A',
  via: '•',
  drop: 'D',
  destination: 'B',
}
