'use client'

/**
 * Route card chrome: title, slim progress, chips, empty/error, Leaflet canvas.
 * Map canvas is dynamically imported with ssr:false so Leaflet never hits SSR.
 */

import dynamic from 'next/dynamic'
import { useState, type ReactNode } from 'react'
import type { RouteMapChip, RouteMapStopRole, RouteMapViewModel } from './types'
import {
  ROUTE_MAP_ROLE_LABEL,
  ROUTE_MAP_ROLE_SWATCH,
} from './roleStyles'

const RouteMap = dynamic(() => import('./RouteMap'), {
  ssr: false,
  loading: () => (
    <div
      className="w-full min-h-[280px] md:min-h-[360px] rounded-xl bg-slate-100 flex items-center justify-center text-sm text-gray-500"
      role="status"
    >
      Loading map…
    </div>
  ),
})

const CHIP_TONE_CLASS: Record<NonNullable<RouteMapChip['tone']>, string> = {
  neutral: 'bg-gray-100 text-gray-800 border-gray-200',
  info: 'bg-blue-50 text-blue-900 border-blue-200',
  success: 'bg-emerald-50 text-emerald-900 border-emerald-200',
  warning: 'bg-amber-50 text-amber-900 border-amber-200',
  danger: 'bg-red-50 text-red-900 border-red-200',
}

const ROLE_ORDER: RouteMapStopRole[] = ['origin', 'via', 'drop', 'destination']

/** Default standalone card chrome. Embed flatter via className from parent. */
export const ROUTE_MAP_CARD_DEFAULT_CLASS =
  'rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden'

/** Flatter chrome when nested inside another card (e.g. permit form). */
export const ROUTE_MAP_CARD_EMBED_CLASS =
  'rounded-xl border-0 border-t border-gray-100 shadow-none bg-transparent overflow-hidden'

export interface RouteMapCardProps {
  model: RouteMapViewModel
  /** Optional extra actions (e.g. Map v2 edit mode toggle). */
  actions?: ReactNode
  className?: string
  /** Map v2 reserved: map click → add waypoint (not wired in v1). */
  onMapClick?: (coords: { lat: number; lon: number }) => void
}

/** Short badge label for progress — distinct geocoding vs calculating. */
function progressBadgeLabel(message?: string): string {
  const m = (message || '').toLowerCase()
  if (m.includes('resolv') || m.includes('geocod') || m.includes('address')) {
    return 'Resolving…'
  }
  return 'Calculating…'
}

function truncateChipLabel(label: string, max = 42): string {
  if (label.length <= max) return label
  return `${label.slice(0, max - 1)}…`
}

export default function RouteMapCard({ model, actions, className, onMapClick }: RouteMapCardProps) {
  const [mapLoadFailed, setMapLoadFailed] = useState(false)
  /** Idle empty: no route work and no geometry yet. */
  const isIdleEmpty =
    model.status === 'idle' && model.stops.length === 0 && !model.geometry
  const isError = model.status === 'error'
  const showCalculating =
    model.status === 'geocoding' || model.status === 'calculating'
  const showMap =
    !mapLoadFailed &&
    model.status === 'ready' &&
    (model.stops.length > 0 || !!model.geometry)

  const legendRoles = ROLE_ORDER.filter((role) =>
    model.stops.some((s) => s.role === role)
  )
  const showLineLegend = !!model.geometry && model.geometry.coordinates.length >= 2

  return (
    <section
      className={className ?? ROUTE_MAP_CARD_DEFAULT_CLASS}
      aria-label="Route map"
      data-testid="route-map-card"
    >
      <div className="flex items-center justify-between gap-2 px-4 pt-3 pb-2">
        <h2 className="text-sm font-semibold text-gray-900 tracking-tight">
          Route
        </h2>
        {showCalculating && (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-800 bg-blue-50 border border-blue-100 px-2.5 py-0.5 rounded-full">
            <span>{progressBadgeLabel(model.message).replace('…', '')}</span>
            <span className="inline-flex gap-0.5" aria-hidden>
              <span className="h-1 w-1 rounded-full bg-blue-600 motion-safe:animate-pulse" />
              <span className="h-1 w-1 rounded-full bg-blue-600 motion-safe:animate-pulse [animation-delay:150ms]" />
              <span className="h-1 w-1 rounded-full bg-blue-600 motion-safe:animate-pulse [animation-delay:300ms]" />
            </span>
          </span>
        )}
        {model.status === 'ready' && !mapLoadFailed && (
          <span className="text-[10px] font-medium uppercase tracking-wide text-emerald-700 bg-emerald-50 border border-emerald-100 px-2 py-0.5 rounded-full">
            Ready
          </span>
        )}
        {actions}
      </div>

      <div className="relative px-3 pb-3">
        {showMap ? (
          <div className="rounded-xl overflow-hidden border border-gray-200">
            <RouteMap
              model={model}
              onMapClick={onMapClick}
              onLoadError={() => setMapLoadFailed(true)}
            />
          </div>
        ) : isError || mapLoadFailed ? (
          <div
            className="w-full min-h-[200px] rounded-xl bg-red-50 border border-red-100 flex flex-col items-center justify-center px-4 py-8"
            role="alert"
          >
            <p className="text-sm font-medium text-red-800 text-center">
              {mapLoadFailed
                ? 'Map failed to load'
                : model.message || 'Could not build route'}
            </p>
            <p className="text-xs text-red-700/80 mt-1 text-center max-w-sm">
              Check addresses or try again. Manual coordinates are available above when geocoding fails.
            </p>
          </div>
        ) : (
          <div className="w-full min-h-[200px] rounded-xl bg-slate-50 border border-dashed border-gray-200 flex flex-col items-center justify-center px-4 py-8">
            <p className="text-sm text-gray-600 mb-1 max-w-[min(100%,28rem)] text-center">
              {model.message || 'Enter origin and destination to preview the route map'}
            </p>
          </div>
        )}
      </div>

      {model.stops.length > 0 && (
        <ul className="sr-only" data-testid="route-map-stop-list">
          {model.stops.map((s) => (
            <li key={s.id}>
              {ROUTE_MAP_ROLE_LABEL[s.role]}: {s.name}
            </li>
          ))}
        </ul>
      )}

      {(model.chips.length > 0 ||
        (model.message && !isIdleEmpty && model.status !== 'ready' && !mapLoadFailed) ||
        legendRoles.length > 0) && (
        <div className="px-4 py-3 space-y-2 border-t border-gray-100">
          {model.chips.length > 0 && (
            <div className="flex flex-wrap gap-1.5" data-testid="route-map-chips">
              {model.chips.map((chip, i) => {
                const display = truncateChipLabel(chip.label)
                return (
                  <span
                    key={`${chip.label}-${i}`}
                    title={chip.label}
                    className={`inline-flex items-center max-w-full px-2.5 py-1 rounded-full text-xs font-medium border truncate ${
                      CHIP_TONE_CLASS[chip.tone || 'neutral']
                    }`}
                  >
                    {display}
                  </span>
                )
              })}
            </div>
          )}

          {model.status !== 'ready' && !isIdleEmpty && !mapLoadFailed && model.message && (
            <p className={`text-xs ${isError ? 'text-red-700' : 'text-gray-500'}`}>{model.message}</p>
          )}

          {legendRoles.length > 0 && (
            <div className="flex flex-wrap gap-3 text-[10px] text-gray-500" aria-hidden>
              {legendRoles.map((role) => (
                <span key={role} className="inline-flex items-center gap-1">
                  <span
                    className={`w-2.5 h-2.5 ${
                      role === 'via' || role === 'drop' ? 'rounded-full' : 'rounded'
                    } ${ROUTE_MAP_ROLE_SWATCH[role]}`}
                  />
                  {ROUTE_MAP_ROLE_LABEL[role]}
                </span>
              ))}
              {showLineLegend && (
                <span className="inline-flex items-center gap-1">
                  <span className="w-4 h-0.5 bg-blue-600 rounded" /> Route
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  )
}
