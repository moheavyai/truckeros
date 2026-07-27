'use client'

/**
 * Route card chrome: title, slim progress, chips, empty/error, MapLibre canvas.
 * Map canvas is dynamically imported with ssr:false so WebGL never hits SSR.
 */

import dynamic from 'next/dynamic'
import type { RouteMapChip, RouteMapViewModel } from './types'

const RouteMap = dynamic(() => import('./RouteMap'), {
  ssr: false,
  loading: () => (
    <div
      className="w-full min-h-[280px] md:min-h-[360px] rounded-xl bg-slate-100 flex items-center justify-center text-sm text-gray-500"
      aria-hidden
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

export interface RouteMapCardProps {
  model: RouteMapViewModel
  /** Optional extra actions (e.g. Map v2 edit mode toggle). */
  actions?: React.ReactNode
  className?: string
  /** Map v2 reserved: map click → add waypoint. */
  onMapClick?: (coords: { lat: number; lon: number }) => void
}

export default function RouteMapCard({ model, actions, className, onMapClick }: RouteMapCardProps) {
  const isCalculating = model.status === 'calculating'
  const isError = model.status === 'error'
  const showLineLegend = model.linePositions.length >= 2 && model.status === 'ready'

  return (
    <section
      className={
        className ||
        'rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden'
      }
      aria-labelledby="route-map-card-title"
    >
      <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-gray-100">
        <h2 id="route-map-card-title" className="text-base font-semibold text-gray-900">
          Route
        </h2>
        {isCalculating && (
          <span
            className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-800 bg-blue-50 border border-blue-100 px-2 py-0.5 rounded-full"
            aria-live="polite"
          >
            <span
              className="w-3 h-3 border-2 border-blue-600 border-t-transparent rounded-full motion-safe:animate-spin"
              aria-hidden
            />
            Calculating…
          </span>
        )}
        {model.status === 'ready' && (
          <span className="text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-100 px-2 py-0.5 rounded-full">
            Ready
          </span>
        )}
        {isError && (
          <span className="text-xs font-medium text-red-700 bg-red-50 border border-red-100 px-2 py-0.5 rounded-full">
            Error
          </span>
        )}
        {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
      </div>

      {/* Slim non-blocking progress bar on the map frame (not a tall hero). */}
      {isCalculating && (
        <div
          className="h-1 w-full bg-blue-100 overflow-hidden"
          role="progressbar"
          aria-valuetext={model.message || 'Calculating route'}
          aria-live="polite"
        >
          <div className="h-full w-1/3 bg-blue-500 motion-safe:animate-pulse" />
        </div>
      )}

      <div className="relative">
        <RouteMap model={model} onMapClick={onMapClick} />

        {/* Empty / idle hint overlaid lightly when no stops */}
        {model.stops.length === 0 && model.status === 'idle' && (
          <div className="absolute inset-0 flex items-end justify-center pointer-events-none p-4">
            <p className="text-sm text-gray-600 bg-white/90 border border-gray-200 rounded-lg px-3 py-1.5 shadow-sm">
              {model.message || 'Enter origin and destination to preview the route map'}
            </p>
          </div>
        )}
      </div>

      {/* Chips: corridor / distance / duration / prefer-avoid honesty */}
      {(model.chips.length > 0 || model.message) && (
        <div className="px-4 py-3 space-y-2 border-t border-gray-100">
          {model.chips.length > 0 && (
            <div className="flex flex-wrap gap-1.5" data-testid="route-map-chips">
              {model.chips.map((chip, i) => (
                <span
                  key={`${chip.label}-${i}`}
                  className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border ${
                    CHIP_TONE_CLASS[chip.tone || 'neutral']
                  }`}
                >
                  {chip.label}
                </span>
              ))}
            </div>
          )}

          {model.status !== 'ready' && model.message && (
            <p
              className={`text-xs ${isError ? 'text-red-700' : 'text-gray-500'}`}
              aria-live={isCalculating || isError ? 'polite' : undefined}
            >
              {model.message}
            </p>
          )}

          {/* Compact legend */}
          {model.stops.length > 0 && (
            <div className="flex flex-wrap gap-3 text-[10px] text-gray-500" aria-hidden>
              <span className="inline-flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded bg-blue-600" /> Origin
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-full bg-violet-600" /> Via
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-600" /> Drop
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded bg-emerald-600" /> Destination
              </span>
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
