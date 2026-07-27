'use client'

/**
 * Presentational Leaflet canvas for route stops + polyline.
 *
 * Why Leaflet (v1): no Web Worker / WebGL — reliable under Next.js on Windows.
 * Vector GL engines can return later for rich styles; v1 only needs markers +
 * polyline + fitBounds over OSM raster tiles.
 *
 * Runtime: leaflet is loaded via dynamic import() inside useEffect (client only).
 * CSS is imported once here; parent uses dynamic(..., { ssr: false }).
 * After construct + ready: map.invalidateSize() + two rAF follow-ups + ResizeObserver.
 * If the first fit ran at 0×0, re-fit once when the container becomes non-zero.
 * onMapClick is optional Map v2 hook (unused in v1 UI). Drag-edit is not wired in v1.
 * LatLon is [lat, lon] — Leaflet-native order (no GeoJSON swap at this boundary).
 */

import { useEffect, useRef, useState } from 'react'
import type {
  LatLngBoundsExpression,
  Map as LeafletMap,
  Marker as LeafletMarker,
  Polyline as LeafletPolyline,
} from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { LatLon, RouteMapStop, RouteMapViewModel } from './types'
import {
  ROUTE_MAP_MARKER_GLYPH,
  ROUTE_MAP_ROLE_HEX,
} from './roleStyles'

/** Leaflet runtime namespace after dynamic import interop. */
type LeafletNS = typeof import('leaflet')

function resolveLeaflet(mod: unknown): LeafletNS {
  if (!mod || typeof mod !== 'object') {
    throw new Error('leaflet module missing')
  }
  const m = mod as { default?: LeafletNS } & LeafletNS
  // CJS/ESM interop: prefer default when it exposes map/tileLayer
  if (m.default && typeof m.default.map === 'function') return m.default
  if (typeof m.map === 'function') return m
  throw new Error('leaflet constructors missing after import interop')
}

/** CONUS-ish default when no stops — Leaflet [lat, lon]. */
const DEFAULT_CENTER: [number, number] = [39.8, -98.5]
const DEFAULT_ZOOM = 3.2
/** Bounds span below this (degrees) treated as coincident → single-stop zoom. */
const NEAR_ZERO_BOUNDS_DEG = 1e-5
/** Min client size (px) treated as a laid-out map container. */
const MIN_SIZED_PX = 2

const OSM_TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'

const LOAD_ERROR_MESSAGE = 'Map failed to load'
/** Clears on whenReady (map init), not full tile paint — keep copy accurate. */
const MAP_LOADING_MESSAGE = 'Loading map…'

const LINE_COLOR = '#2563eb'
const LINE_WEIGHT = 4
const LINE_OPACITY = 0.85

function safeRemoveMap(map: LeafletMap | null | undefined) {
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

function isContainerSized(el: HTMLElement | null | undefined): boolean {
  if (!el) return false
  return el.clientWidth >= MIN_SIZED_PX && el.clientHeight >= MIN_SIZED_PX
}

/**
 * Immediate invalidateSize + two requestAnimationFrame follow-ups (three total)
 * so late flex/grid layout does not leave a blank/wrong-size canvas.
 * Optional onAfter runs after the last invalidate (for one-shot re-fit when sized).
 */
function scheduleMapInvalidate(
  map: LeafletMap | null | undefined,
  rafIds?: number[],
  onAfter?: () => void
) {
  if (!map) return
  const runInvalidate = () => {
    try {
      map.invalidateSize()
    } catch {
      // map may already be removed
    }
  }
  runInvalidate()
  if (typeof requestAnimationFrame === 'undefined') {
    onAfter?.()
    return
  }
  const id1 = requestAnimationFrame(() => {
    runInvalidate()
    const id2 = requestAnimationFrame(() => {
      runInvalidate()
      onAfter?.()
    })
    rafIds?.push(id2)
  })
  rafIds?.push(id1)
}

/**
 * Stable fingerprint so parent-rebuilt stop/line arrays with same coords do not
 * thrash markers + re-fit during calculating.
 */
export function routeMapGeometryFingerprint(
  stops: RouteMapStop[],
  linePositions: LatLon[]
): string {
  const stopPart = stops
    .map((s) => `${s.id}\t${s.lat}\t${s.lon}\t${s.role}\t${s.name}`)
    .join('|')
  const linePart = linePositions.map((p) => `${p[0]},${p[1]}`).join(';')
  return `${stopPart}#${linePart}`
}

export interface RouteMapProps {
  model: RouteMapViewModel
  className?: string
  /** Map v2 reserved: click handler for adding waypoints (not used in v1 UI). */
  onMapClick?: (coords: { lat: number; lon: number }) => void
  /** Fires when canvas fails to load (null when cleared on remount success path). */
  onLoadError?: (message: string | null) => void
  /** True after map is ready (whenReady); false on cleanup / fail. */
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

/** Text-only popup body — never pass untrusted names as HTML. */
function buildPopupContent(stop: RouteMapStop): HTMLDivElement {
  const el = document.createElement('div')
  el.textContent = `${stop.role}: ${stop.name}`
  return el
}

/** LatLon [lat,lon] → Leaflet LatLngExpression [lat, lng]. */
function latLonToLatLng(pair: LatLon): [number, number] {
  return [pair[0], pair[1]]
}

function fitToStops(map: LeafletMap, stops: RouteMapStop[], L: LeafletNS) {
  const animate = !prefersReducedMotion()

  if (stops.length === 0) {
    map.setView(DEFAULT_CENTER, DEFAULT_ZOOM, { animate, duration: 0.3 })
    return
  }

  if (stops.length === 1) {
    map.setView([stops[0].lat, stops[0].lon], 8, {
      animate,
      duration: 0.4,
    })
    return
  }

  const bounds = L.latLngBounds(
    stops.map((s) => [s.lat, s.lon] as [number, number])
  )
  const ne = bounds.getNorthEast()
  const sw = bounds.getSouthWest()
  const span = Math.max(Math.abs(ne.lat - sw.lat), Math.abs(ne.lng - sw.lng))

  // Coincident / near-zero bounds → single-stop zoom path (avoids fitBounds collapse)
  if (span < NEAR_ZERO_BOUNDS_DEG) {
    map.setView([stops[0].lat, stops[0].lon], 8, {
      animate,
      duration: 0.4,
    })
    return
  }

  map.fitBounds(bounds as LatLngBoundsExpression, {
    padding: [48, 48],
    maxZoom: 10,
    animate,
    duration: prefersReducedMotion() ? 0 : 0.5,
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
  const mapRef = useRef<LeafletMap | null>(null)
  const leafletRef = useRef<LeafletNS | null>(null)
  const markersRef = useRef<LeafletMarker[]>([])
  const polylineRef = useRef<LeafletPolyline | null>(null)
  const onMapClickRef = useRef(onMapClick)
  onMapClickRef.current = onMapClick
  const onLoadErrorRef = useRef(onLoadError)
  onLoadErrorRef.current = onLoadError
  const onStyleLoadedRef = useRef(onStyleLoaded)
  onStyleLoadedRef.current = onStyleLoaded
  /** Latest stops for one-shot re-fit after container sizes (avoids stale closure). */
  const stopsRef = useRef(model.stops)
  stopsRef.current = model.stops
  /**
   * True when the last fitToStops ran while the container was still ~0×0.
   * Cleared after a successful re-fit once the container is sized.
   * ResizeObserver must not re-fit on every resize (preserves user pan/zoom).
   */
  const fitPendingUntilSizedRef = useRef(false)
  /** Prevents duplicate loadError from construct paths. */
  const loadErrorOnceRef = useRef(false)
  /** Bumps when map instance is ready so marker/line sync re-runs after async import. */
  const [mapReady, setMapReady] = useState(false)
  /** True after map whenReady (style-loaded contract for card idle hint). */
  const [styleLoaded, setStyleLoaded] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  const geometryKey = routeMapGeometryFingerprint(model.stops, model.linePositions)

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

  /** Fit camera; if container not sized yet, arm one-shot re-fit for ResizeObserver / rAF. */
  const applyCamera = (map: LeafletMap, L: LeafletNS, stops: RouteMapStop[]) => {
    fitToStops(map, stops, L)
    fitPendingUntilSizedRef.current = !isContainerSized(containerRef.current)
  }

  /** If a zero-size fit is pending and container is now sized, invalidate + re-fit once. */
  const tryFitPendingIfSized = () => {
    if (!fitPendingUntilSizedRef.current) return
    const map = mapRef.current
    const L = leafletRef.current
    if (!map || !L || !isContainerSized(containerRef.current)) return
    try {
      map.invalidateSize()
    } catch {
      // ignore
    }
    fitToStops(map, stopsRef.current, L)
    fitPendingUntilSizedRef.current = false
  }

  // Init map once via dynamic import (client only; no SSR / worker)
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    let cancelled = false
    let createdMap: LeafletMap | null = null
    const resizeRafIds: number[] = []

    ;(async () => {
      let mod: unknown
      try {
        mod = await import('leaflet')
      } catch (err) {
        if (cancelled) return
        failLoad('[RouteMap] leaflet import failed', err)
        return
      }

      if (cancelled || !containerRef.current) return

      let L: LeafletNS
      try {
        L = resolveLeaflet(mod)
      } catch (err) {
        if (cancelled) return
        failLoad('[RouteMap] leaflet constructors missing after import interop', err)
        return
      }

      try {
        leafletRef.current = L

        const map = L.map(containerRef.current, {
          center: DEFAULT_CENTER,
          zoom: DEFAULT_ZOOM,
          zoomControl: false,
          attributionControl: true,
        })
        createdMap = map

        L.control.zoom({ position: 'topright' }).addTo(map)

        L.tileLayer(OSM_TILE_URL, {
          attribution: OSM_ATTRIBUTION,
          maxZoom: 19,
        }).addTo(map)

        map.on('click', (e: { latlng: { lat: number; lng: number } }) => {
          onMapClickRef.current?.({ lat: e.latlng.lat, lon: e.latlng.lng })
        })

        mapRef.current = map
        setStyleLoaded(false)
        onStyleLoadedRef.current?.(false)

        const onReady = () => {
          if (cancelled || mapRef.current !== map) return
          setStyleLoaded(true)
          onStyleLoadedRef.current?.(true)
          scheduleMapInvalidate(map, resizeRafIds, () => {
            if (cancelled || mapRef.current !== map) return
            tryFitPendingIfSized()
          })
        }
        map.whenReady(onReady)

        if (cancelled) {
          safeRemoveMap(map)
          createdMap = null
          mapRef.current = null
          leafletRef.current = null
          return
        }

        onLoadErrorRef.current?.(null)
        setMapReady(true)
      } catch (err) {
        safeRemoveMap(createdMap)
        createdMap = null
        mapRef.current = null
        leafletRef.current = null
        if (cancelled) return
        failLoad('[RouteMap] Map construct failed', err)
      }
    })()

    return () => {
      cancelled = true
      cancelRafIds(resizeRafIds)
      markersRef.current.forEach((m) => m.remove())
      markersRef.current = []
      if (polylineRef.current) {
        try {
          polylineRef.current.remove()
        } catch {
          // ignore
        }
        polylineRef.current = null
      }
      fitPendingUntilSizedRef.current = false
      // Strict Mode: clear sticky load-error so re-init is not stuck on the error overlay
      loadErrorOnceRef.current = false
      setLoadError(null)
      onLoadErrorRef.current?.(null)
      const map = createdMap ?? mapRef.current
      safeRemoveMap(map)
      mapRef.current = null
      leafletRef.current = null
      // Strict Mode: setup→cleanup→setup must clear mapReady so second setMapReady(true) retriggers sync
      setMapReady(false)
      setStyleLoaded(false)
      onStyleLoadedRef.current?.(false)
    }
  }, [])

  // Once after mapReady: immediate + two rAF invalidates; re-fit if still pending
  useEffect(() => {
    if (!mapReady || loadError) return
    const rafIds: number[] = []
    scheduleMapInvalidate(mapRef.current, rafIds, () => {
      tryFitPendingIfSized()
    })
    return () => {
      cancelRafIds(rafIds)
    }
  }, [mapReady, loadError])

  // ResizeObserver: always invalidateSize; re-fit only when fitPendingUntilSized (0×0 → sized).
  // Skip / disconnect when loadError so we never observe a detached-only error surface.
  useEffect(() => {
    if (loadError) return
    const el = containerRef.current
    if (!el || typeof ResizeObserver === 'undefined') return

    let timer: ReturnType<typeof setTimeout> | null = null
    const ro = new ResizeObserver(() => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        mapRef.current?.invalidateSize()
        // One-shot re-fit only — not on every user resize (preserves pan/zoom)
        if (fitPendingUntilSizedRef.current) {
          tryFitPendingIfSized()
        }
      }, 100)
    })
    ro.observe(el)
    return () => {
      if (timer) clearTimeout(timer)
      ro.disconnect()
    }
  }, [loadError])

  // Sync markers + polyline + bounds when geometry fingerprint changes.
  useEffect(() => {
    const map = mapRef.current
    const L = leafletRef.current
    if (!map || !L || !mapReady || loadError) return

    markersRef.current.forEach((m) => m.remove())
    markersRef.current = []

    for (const stop of model.stops) {
      const el = buildMarkerElement(stop)
      const icon = L.divIcon({
        className: 'route-map-div-icon',
        html: el.outerHTML,
        iconSize: [28, 28],
        iconAnchor: [14, 14],
        popupAnchor: [0, -14],
      })
      const marker = L.marker([stop.lat, stop.lon], { icon })
        .bindPopup(buildPopupContent(stop), { closeButton: false, offset: [0, -8] })
        .addTo(map)
      markersRef.current.push(marker)
    }

    const line = model.linePositions

    if (polylineRef.current) {
      polylineRef.current.remove()
      polylineRef.current = null
    }

    if (line.length >= 2) {
      const latlngs = line.map(latLonToLatLng)
      polylineRef.current = L.polyline(latlngs, {
        color: LINE_COLOR,
        weight: LINE_WEIGHT,
        opacity: LINE_OPACITY,
        lineJoin: 'round',
        lineCap: 'round',
      }).addTo(map)
    }

    // Re-fit on geometry change; arm pending re-fit if container still 0×0
    applyCamera(map, L, model.stops)
    // geometryKey is the stable dep; model.stops/line used for latest values at same key
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fingerprint gates identity thrash
  }, [geometryKey, mapReady, loadError])

  const containerClass =
    className ||
    'w-full min-h-[280px] md:min-h-[360px] rounded-xl overflow-hidden bg-slate-100'

  // Keep map container mounted (ref stable); show error as overlay so RO can disconnect cleanly
  return (
    <div className={`relative ${containerClass}`}>
      <div ref={containerRef} className="absolute inset-0 z-0" aria-hidden="true" />
      {!loadError && !styleLoaded && (
        <div
          className="absolute inset-0 z-10 flex items-center justify-center px-4 text-sm text-slate-500 bg-slate-100/80 pointer-events-none"
          role="status"
          aria-live="polite"
          data-testid="route-map-tiles-loading"
        >
          {MAP_LOADING_MESSAGE}
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
