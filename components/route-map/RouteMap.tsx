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
 * Style URL: NEXT_PUBLIC_MAP_STYLE_URL or OpenFreeMap liberty default.
 * onMapClick is optional Map v2 hook (unused in v1 UI). Drag-edit is not wired in v1.
 * LatLon [lat,lon] is converted to GeoJSON [lon,lat] only at this MapLibre boundary.
 */

import { useEffect, useRef, useState } from 'react'
import type {
  GeoJSONSource,
  Map as MaplibreMap,
  Marker as MaplibreMarker,
} from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { LatLon, RouteMapStop, RouteMapViewModel } from './types'
import {
  ROUTE_MAP_MARKER_GLYPH,
  ROUTE_MAP_ROLE_HEX,
} from './roleStyles'
import {
  resolveMaplibreModule,
  type MaplibreRuntime,
} from './resolveMaplibreModule'

export { resolveMaplibreModule } from './resolveMaplibreModule'
export type { MaplibreRuntime } from './resolveMaplibreModule'

const DEFAULT_MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty'
/** CONUS-ish default when no stops. */
const DEFAULT_CENTER: [number, number] = [-98.5, 39.8]
const DEFAULT_ZOOM = 3.2
/** Bounds span below this (degrees) treated as coincident → single-stop zoom. */
const NEAR_ZERO_BOUNDS_DEG = 1e-5

function resolveMapStyle(): string {
  if (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_MAP_STYLE_URL) {
    return process.env.NEXT_PUBLIC_MAP_STYLE_URL
  }
  return DEFAULT_MAP_STYLE
}

function isCoarsePointer(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(pointer: coarse)').matches
}

export interface RouteMapProps {
  model: RouteMapViewModel
  className?: string
  /** Map v2 reserved: click handler for adding waypoints (not used in v1 UI). */
  onMapClick?: (coords: { lat: number; lon: number }) => void
  /** Fires when canvas fails to load (null when cleared on remount success path). */
  onLoadError?: (message: string | null) => void
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

  const bounds = new ml.LngLatBounds()
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
}: RouteMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<MaplibreMap | null>(null)
  const markersRef = useRef<MaplibreMarker[]>([])
  const mlRef = useRef<MaplibreRuntime | null>(null)
  const onMapClickRef = useRef(onMapClick)
  onMapClickRef.current = onMapClick
  const onLoadErrorRef = useRef(onLoadError)
  onLoadErrorRef.current = onLoadError
  const styleReadyRef = useRef(false)
  /** Bumps when map instance is ready so marker/line sync re-runs after async import. */
  const [mapReady, setMapReady] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  const failLoad = (reason: string, err?: unknown) => {
    if (err !== undefined) {
      console.error(reason, err)
    } else {
      console.error(reason)
    }
    setLoadError('Map failed to load')
    onLoadErrorRef.current?.('Map failed to load')
  }

  // Init map once via dynamic import (webpack default interop safe)
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    let cancelled = false
    let createdMap: MaplibreMap | null = null

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

      try {
        mlRef.current = ml
        const map = new ml.Map({
          container: containerRef.current,
          style: resolveMapStyle(),
          center: DEFAULT_CENTER,
          zoom: DEFAULT_ZOOM,
          attributionControl: { compact: true },
          // Prefer page scroll on touch devices only; desktop keeps free wheel zoom
          cooperativeGestures: isCoarsePointer(),
        })
        createdMap = map
        map.addControl(new ml.NavigationControl({ showCompass: false }), 'top-right')
        mapRef.current = map
        styleReadyRef.current = false

        const onLoad = () => {
          styleReadyRef.current = true
        }
        map.on('load', onLoad)

        map.on('click', (e: { lngLat: { lat: number; lng: number } }) => {
          onMapClickRef.current?.({ lat: e.lngLat.lat, lon: e.lngLat.lng })
        })

        // Cheap diagnostics only — do not flip loadError (tile/style noise is common)
        map.on('error', (e: { error?: Error; message?: string }) => {
          console.error('[RouteMap] map error', e?.error || e?.message || e)
        })

        if (cancelled) {
          map.remove()
          createdMap = null
          mapRef.current = null
          mlRef.current = null
          return
        }

        onLoadErrorRef.current?.(null)
        setMapReady(true)
      } catch (err) {
        if (cancelled) return
        createdMap = null
        mapRef.current = null
        mlRef.current = null
        failLoad('[RouteMap] Map construct / addControl failed', err)
      }
    })()

    return () => {
      cancelled = true
      markersRef.current.forEach((m) => m.remove())
      markersRef.current = []
      styleReadyRef.current = false
      const map = createdMap ?? mapRef.current
      if (map) {
        map.remove()
      }
      mapRef.current = null
      mlRef.current = null
      // Strict Mode: setup→cleanup→setup must clear mapReady so second setMapReady(true) retriggers sync
      setMapReady(false)
    }
  }, [])

  // ResizeObserver: map.resize only — do not re-fit (preserves user pan/zoom)
  useEffect(() => {
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
  }, [])

  // Sync markers + line + bounds when model changes (with load listener cleanup)
  useEffect(() => {
    const map = mapRef.current
    const ml = mlRef.current
    if (!map || !ml || !mapReady) return

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
        const marker = new ml.Marker({ element: buildMarkerElement(stop) })
          .setLngLat([stop.lon, stop.lat])
          .setPopup(
            new ml.Popup({ offset: 16, closeButton: false }).setText(
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
  }, [model.stops, model.linePositions, mapReady])

  const containerClass =
    className ||
    'w-full min-h-[280px] md:min-h-[360px] rounded-xl overflow-hidden bg-slate-100'

  if (loadError) {
    return (
      <div
        className={`${containerClass} relative z-10 flex items-center justify-center px-4 text-sm font-medium text-red-800 bg-red-50 border border-red-200`}
        role="alert"
        data-testid="route-map-load-error"
      >
        {loadError}
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className={containerClass}
      aria-hidden="true"
    />
  )
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}
