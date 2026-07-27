'use client'

/**
 * Presentational MapLibre canvas for route stops + line.
 *
 * Why MapLibre (not Leaflet): vector-ready, active OSS fork of Mapbox GL JS,
 * free styles (OpenFreeMap) with no paid API key, good fitBounds + GeoJSON layers.
 * CSS is imported here once; parent uses dynamic(..., { ssr: false }) so WebGL
 * never runs during Next SSR.
 *
 * Runtime: maplibre-gl is loaded via dynamic import() inside useEffect so webpack/Next
 * interop cannot leave the default export undefined (top-level default import → Map crash).
 * Worker: configureMaplibreWorker() sets setWorkerUrl to a real JS asset (bundler ?url or
 * public/maplibre-gl-worker.mjs) BEFORE new Map — avoids MIME text/html worker failures.
 * Style URL: NEXT_PUBLIC_MAP_STYLE_URL (trimmed) or demotiles default (reliable local).
 * If primary style errors before first load, fall back once to OpenFreeMap liberty.
 * Residual primary-style errors during the fallback switch are ignored; permanent fail only if
 * the fallback style also errors after the transition settles.
 * After construct + style load: immediate map.resize() + two rAF follow-up resizes for late layout.
 * onMapClick is optional Map v2 hook (unused in v1 UI). Drag-edit is not wired in v1.
 * LatLon [lat,lon] is converted to GeoJSON [lon,lat] only at this MapLibre boundary.
 */

import { useEffect, useRef, useState } from 'react'
import type {
  GeoJSONSource,
  LngLatBounds,
  Map as MaplibreMap,
  Marker as MaplibreMarker,
  NavigationControl,
  Popup,
} from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { LatLon, RouteMapStop, RouteMapViewModel } from './types'
import {
  ROUTE_MAP_MARKER_GLYPH,
  ROUTE_MAP_ROLE_HEX,
} from './roleStyles'
import {
  configureMaplibreWorker,
  FALLBACK_MAP_STYLE,
  resolveMapStyle,
} from './configureMaplibreWorker'
import {
  resolveMaplibreModule,
  type MaplibreRuntime,
} from './resolveMaplibreModule'

export { resolveMaplibreModule } from './resolveMaplibreModule'
export type { MaplibreRuntime } from './resolveMaplibreModule'
export {
  configureMaplibreWorker,
  DEFAULT_MAP_STYLE,
  FALLBACK_MAP_STYLE,
  PUBLIC_MAPLIBRE_WORKER_PATH,
  resolveMapStyle,
} from './configureMaplibreWorker'

/** CONUS-ish default when no stops. */
const DEFAULT_CENTER: [number, number] = [-98.5, 39.8]
const DEFAULT_ZOOM = 3.2
/** Bounds span below this (degrees) treated as coincident → single-stop zoom. */
const NEAR_ZERO_BOUNDS_DEG = 1e-5

const LOAD_ERROR_MESSAGE = 'Map failed to load'
const TILES_LOADING_MESSAGE = 'Loading map tiles…'

function isCoarsePointer(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(pointer: coarse)').matches
}

function safeRemoveMap(map: MaplibreMap | null | undefined) {
  if (!map) return
  try {
    map.remove()
  } catch {
    // ignore double-remove / already-destroyed
  }
}

function cancelRafIds(rafIds: number[]) {
  if (typeof cancelAnimationFrame === 'undefined') {
    rafIds.length = 0
    return
  }
  for (const id of rafIds) {
    cancelAnimationFrame(id)
  }
  rafIds.length = 0
}

/**
 * Immediate resize + two requestAnimationFrame follow-ups (three resizes total)
 * so late flex/grid layout does not leave a blank canvas. Optional rafIds tracks
 * rAF handles for cancelAnimationFrame on unmount.
 */
function scheduleMapResize(
  map: MaplibreMap | null | undefined,
  rafIds?: number[]
) {
  if (!map) return
  try {
    map.resize()
  } catch {
    // map may already be removed
  }
  if (typeof requestAnimationFrame === 'undefined') return
  const id1 = requestAnimationFrame(() => {
    try {
      map.resize()
    } catch {
      // ignore
    }
    const id2 = requestAnimationFrame(() => {
      try {
        map.resize()
      } catch {
        // ignore
      }
    })
    rafIds?.push(id2)
  })
  rafIds?.push(id1)
}

export interface RouteMapProps {
  model: RouteMapViewModel
  className?: string
  /** Map v2 reserved: click handler for adding waypoints (not used in v1 UI). */
  onMapClick?: (coords: { lat: number; lon: number }) => void
  /** Fires when canvas fails to load (null when cleared on remount success path). */
  onLoadError?: (message: string | null) => void
  /** True after style `load` (primary or demotiles fallback); false on cleanup / fail. */
  onStyleLoaded?: (loaded: boolean) => void
}

function buildMarkerElement(stop: RouteMapStop): HTMLDivElement {
  const el = document.createElement('div')
  el.setAttribute('role', 'img')
  el.setAttribute('aria-label', `${stop.role}: ${stop.name}`)
  const isRound = stop.role === 'via' || stop.role === 'drop'
  el.style.cssText = [
    'width:28px',
    'height:28px',
    'display:flex',
    'align-items:center',
    'justify-content:center',
    `background:${ROUTE_MAP_ROLE_HEX[stop.role]}`,
    'color:#fff',
    'font:700 12px/1 system-ui,sans-serif',
    isRound ? 'border-radius:9999px' : 'border-radius:6px',
    'border:2px solid #fff',
    'box-shadow:0 1px 4px rgba(0,0,0,.35)',
    'cursor:default',
    'user-select:none',
  ].join(';')
  el.textContent = ROUTE_MAP_MARKER_GLYPH[stop.role]
  return el
}

function removeRouteLine(map: MaplibreMap) {
  if (map.getLayer('route-line-layer')) {
    map.removeLayer('route-line-layer')
  }
  if (map.getSource('route-line')) {
    map.removeSource('route-line')
  }
}

/** LatLon [lat,lon] → MapLibre GeoJSON position [lon,lat]. */
function latLonToLngLat(pair: LatLon): [number, number] {
  return [pair[1], pair[0]]
}

function fitToStops(map: MaplibreMap, stops: RouteMapStop[], ml: MaplibreRuntime) {
  const duration = prefersReducedMotion() ? 0 : 400

  if (stops.length === 0) {
    map.easeTo({
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      duration: prefersReducedMotion() ? 0 : 300,
    })
    return
  }

  if (stops.length === 1) {
    map.easeTo({
      center: [stops[0].lon, stops[0].lat],
      zoom: 8,
      duration,
    })
    return
  }

  const bounds = new ml.LngLatBounds() as LngLatBounds
  for (const s of stops) bounds.extend([s.lon, s.lat])
  const ne = bounds.getNorthEast()
  const sw = bounds.getSouthWest()
  const span = Math.max(Math.abs(ne.lat - sw.lat), Math.abs(ne.lng - sw.lng))

  // Coincident / near-zero bounds → single-stop zoom path (avoids fitBounds collapse)
  if (span < NEAR_ZERO_BOUNDS_DEG) {
    map.easeTo({
      center: [stops[0].lon, stops[0].lat],
      zoom: 8,
      duration,
    })
    return
  }

  map.fitBounds(bounds, {
    padding: { top: 48, bottom: 48, left: 48, right: 48 },
    maxZoom: 10,
    duration: prefersReducedMotion() ? 0 : 500,
  })
}

export default function RouteMap({
  model,
  className,
  onMapClick,
  onLoadError,
  onStyleLoaded,
}: RouteMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<MaplibreMap | null>(null)
  const markersRef = useRef<MaplibreMarker[]>([])
  const mlRef = useRef<MaplibreRuntime | null>(null)
  const onMapClickRef = useRef(onMapClick)
  onMapClickRef.current = onMapClick
  const onLoadErrorRef = useRef(onLoadError)
  onLoadErrorRef.current = onLoadError
  const onStyleLoadedRef = useRef(onStyleLoaded)
  onStyleLoadedRef.current = onStyleLoaded
  const styleReadyRef = useRef(false)
  /** One secondary setStyle attempt per map instance (primary style error before load). */
  const styleFallbackTriedRef = useRef(false)
  /**
   * True while switching secondary style: residual aborted-primary errors must not failLoad/teardown.
   * Cleared after two rAF frames once setStyle has been issued.
   */
  const styleFallbackTransitionRef = useRef(false)
  /** Prevents duplicate loadError from construct + style error paths. */
  const loadErrorOnceRef = useRef(false)
  /** Bumps when map instance is ready so marker/line sync re-runs after async import. */
  const [mapReady, setMapReady] = useState(false)
  /** True after style `load` (primary or fallback) so tiles overlay can hide. */
  const [styleLoaded, setStyleLoaded] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  const failLoad = (reason: string, err?: unknown) => {
    if (loadErrorOnceRef.current) return
    loadErrorOnceRef.current = true
    if (err !== undefined) {
      console.error(reason, err)
    } else {
      console.error(reason)
    }
    setLoadError(LOAD_ERROR_MESSAGE)
    onLoadErrorRef.current?.(LOAD_ERROR_MESSAGE)
    setStyleLoaded(false)
    onStyleLoadedRef.current?.(false)
  }

  // Init map once via dynamic import (webpack default interop safe)
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    let cancelled = false
    let createdMap: MaplibreMap | null = null
    const resizeRafIds: number[] = []
    const fallbackTransitionRafIds: number[] = []

    ;(async () => {
      let mod: unknown
      try {
        mod = await import('maplibre-gl')
      } catch (err) {
        if (cancelled) return
        failLoad('[RouteMap] maplibre-gl import failed', err)
        return
      }

      if (cancelled) return

      const ml = resolveMaplibreModule(mod)
      if (!ml) {
        if (cancelled) return
        failLoad(
          '[RouteMap] maplibre-gl constructors missing after import interop resolve'
        )
        return
      }

      if (!containerRef.current || cancelled) return

      // Worker URL must be real JS (not Next HTML) before Map construct
      try {
        await configureMaplibreWorker(mod)
      } catch (workerErr) {
        console.warn('[RouteMap] configureMaplibreWorker failed; Map may hang on tiles', workerErr)
      }
      if (cancelled || !containerRef.current) return

      try {
        mlRef.current = ml
        const primaryStyle = resolveMapStyle()
        console.info('[RouteMap] using map style', primaryStyle)
        const map = new ml.Map({
          container: containerRef.current,
          style: primaryStyle,
          center: DEFAULT_CENTER,
          zoom: DEFAULT_ZOOM,
          attributionControl: { compact: true },
          // Prefer page scroll on touch devices only; desktop keeps free wheel zoom
          cooperativeGestures: isCoarsePointer(),
        }) as MaplibreMap
        createdMap = map
        map.addControl(
          new ml.NavigationControl({ showCompass: false }) as NavigationControl,
          'top-right'
        )
        mapRef.current = map
        styleReadyRef.current = false
        styleFallbackTriedRef.current = false
        styleFallbackTransitionRef.current = false
        setStyleLoaded(false)
        onStyleLoadedRef.current?.(false)

        const onLoad = () => {
          if (cancelled || mapRef.current !== map) return
          styleReadyRef.current = true
          styleFallbackTransitionRef.current = false
          setStyleLoaded(true)
          onStyleLoadedRef.current?.(true)
          // Style paint often needs an explicit resize after flex layout settles
          scheduleMapResize(map, resizeRafIds)
        }
        map.on('load', onLoad)

        map.on('click', (e: { lngLat: { lat: number; lng: number } }) => {
          onMapClickRef.current?.({ lat: e.lngLat.lat, lon: e.lngLat.lng })
        })

        // Style/init failures: one OpenFreeMap fallback before permanent fail; post-load tile noise only logs.
        // Residual primary errors during the setStyle transition must not tear down a healthy fallback.
        map.on('error', (e: { error?: Error; message?: string }) => {
          console.error('[RouteMap] map error', e?.error || e?.message || e)
          if (cancelled || loadErrorOnceRef.current) return
          if (styleReadyRef.current) return

          if (!styleFallbackTriedRef.current) {
            styleFallbackTriedRef.current = true
            styleFallbackTransitionRef.current = true
            console.warn(
              '[RouteMap] primary style failed; falling back to OpenFreeMap liberty',
              FALLBACK_MAP_STYLE
            )
            console.info('[RouteMap] using map style', FALLBACK_MAP_STYLE)
            try {
              map.setStyle(FALLBACK_MAP_STYLE)
              // Ignore aborted-primary residuals through two frames; then arm permanent-fail path
              if (typeof requestAnimationFrame !== 'undefined') {
                const t1 = requestAnimationFrame(() => {
                  const t2 = requestAnimationFrame(() => {
                    if (!cancelled) styleFallbackTransitionRef.current = false
                  })
                  fallbackTransitionRafIds.push(t2)
                })
                fallbackTransitionRafIds.push(t1)
              } else {
                styleFallbackTransitionRef.current = false
              }
              return
            } catch (setErr) {
              console.error('[RouteMap] fallback setStyle failed', setErr)
              styleFallbackTransitionRef.current = false
              // fall through to permanent fail (setStyle threw synchronously)
            }
          }

          // Still switching styles — residual primary/abort noise only
          if (styleFallbackTransitionRef.current) {
            return
          }

          // Fallback style also failed (pre-load error after transition settled)
          failLoad('[RouteMap] map style failed to load', e?.error || e)
          safeRemoveMap(map)
          if (mapRef.current === map) mapRef.current = null
          createdMap = null
          mlRef.current = null
          setMapReady(false)
          setStyleLoaded(false)
          onStyleLoadedRef.current?.(false)
        })

        if (cancelled) {
          safeRemoveMap(map)
          createdMap = null
          mapRef.current = null
          mlRef.current = null
          return
        }

        onLoadErrorRef.current?.(null)
        setMapReady(true)
      } catch (err) {
        // Always tear down partial Map (new Map succeeded, addControl/listener failed)
        safeRemoveMap(createdMap)
        createdMap = null
        mapRef.current = null
        mlRef.current = null
        if (cancelled) return
        failLoad('[RouteMap] Map construct / addControl failed', err)
      }
    })()

    return () => {
      cancelled = true
      cancelRafIds(resizeRafIds)
      cancelRafIds(fallbackTransitionRafIds)
      markersRef.current.forEach((m) => m.remove())
      markersRef.current = []
      styleReadyRef.current = false
      styleFallbackTriedRef.current = false
      styleFallbackTransitionRef.current = false
      // Strict Mode: clear sticky load-error so re-init is not stuck on the error overlay
      loadErrorOnceRef.current = false
      setLoadError(null)
      onLoadErrorRef.current?.(null)
      const map = createdMap ?? mapRef.current
      safeRemoveMap(map)
      mapRef.current = null
      mlRef.current = null
      // Strict Mode: setup→cleanup→setup must clear mapReady so second setMapReady(true) retriggers sync
      setMapReady(false)
      setStyleLoaded(false)
      onStyleLoadedRef.current?.(false)
    }
  }, [])

  // Once after mapReady: immediate + two rAF resizes (container may have been 0×0 at construct)
  useEffect(() => {
    if (!mapReady || loadError) return
    const rafIds: number[] = []
    scheduleMapResize(mapRef.current, rafIds)
    return () => {
      cancelRafIds(rafIds)
    }
  }, [mapReady, loadError])

  // ResizeObserver: map.resize only — do not re-fit (preserves user pan/zoom).
  // Skip / disconnect when loadError so we never observe a detached-only error surface.
  useEffect(() => {
    if (loadError) return
    const el = containerRef.current
    if (!el || typeof ResizeObserver === 'undefined') return

    let timer: ReturnType<typeof setTimeout> | null = null
    const ro = new ResizeObserver(() => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        mapRef.current?.resize()
      }, 100)
    })
    ro.observe(el)
    return () => {
      if (timer) clearTimeout(timer)
      ro.disconnect()
    }
  }, [loadError])

  // Sync markers + line + bounds when model changes (with load listener cleanup).
  // Also re-runs after fallback style load via map.once('load') / styleReadyRef.
  useEffect(() => {
    const map = mapRef.current
    const ml = mlRef.current
    if (!map || !ml || !mapReady || loadError) return

    let cancelled = false

    const apply = () => {
      if (cancelled || mapRef.current !== map || mlRef.current !== ml) return
      try {
        if (!map.getStyle()) return
      } catch {
        return
      }

      markersRef.current.forEach((m) => m.remove())
      markersRef.current = []

      for (const stop of model.stops) {
        const marker = new ml.Marker({ element: buildMarkerElement(stop) }) as MaplibreMarker
        marker
          .setLngLat([stop.lon, stop.lat])
          .setPopup(
            (new ml.Popup({ offset: 16, closeButton: false }) as Popup).setText(
              `${stop.role}: ${stop.name}`
            )
          )
          .addTo(map)
        markersRef.current.push(marker)
      }

      const line = model.linePositions

      if (line.length < 2) {
        removeRouteLine(map)
      } else {
        const geojson: GeoJSON.Feature<GeoJSON.LineString> = {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'LineString',
            coordinates: line.map(latLonToLngLat),
          },
        }

        const existing = map.getSource('route-line') as GeoJSONSource | undefined
        if (existing) {
          existing.setData(geojson)
        } else {
          map.addSource('route-line', { type: 'geojson', data: geojson })
          if (!map.getLayer('route-line-layer')) {
            map.addLayer({
              id: 'route-line-layer',
              type: 'line',
              source: 'route-line',
              layout: { 'line-join': 'round', 'line-cap': 'round' },
              paint: {
                'line-color': '#2563eb',
                'line-width': 4,
                'line-opacity': 0.85,
              },
            })
          }
        }
      }

      // Re-fit only on model stop/line identity change (not on resize)
      fitToStops(map, model.stops, ml)
    }

    if (map.isStyleLoaded() || styleReadyRef.current) {
      apply()
    } else {
      map.once('load', apply)
    }

    return () => {
      cancelled = true
      map.off('load', apply)
    }
  }, [model.stops, model.linePositions, mapReady, loadError])

  const containerClass =
    className ||
    'w-full min-h-[280px] md:min-h-[360px] rounded-xl overflow-hidden bg-slate-100'

  // Keep map container mounted (ref stable); show error as overlay so RO can disconnect cleanly
  return (
    <div className={`relative ${containerClass}`}>
      <div ref={containerRef} className="absolute inset-0" aria-hidden="true" />
      {!loadError && !styleLoaded && (
        <div
          className="absolute inset-0 z-10 flex items-center justify-center px-4 text-sm text-slate-500 bg-slate-100/80 pointer-events-none"
          role="status"
          aria-live="polite"
          data-testid="route-map-tiles-loading"
        >
          {TILES_LOADING_MESSAGE}
        </div>
      )}
      {loadError && (
        <div
          className="absolute inset-0 z-10 flex items-center justify-center px-4 text-sm font-medium text-red-800 bg-red-50 border border-red-200"
          role="alert"
          data-testid="route-map-load-error"
        >
          {loadError}
        </div>
      )}
    </div>
  )
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}
