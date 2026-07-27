'use client'

/**
 * Presentational MapLibre canvas for route stops + line.
 *
 * Why MapLibre (not Leaflet): vector-ready, active OSS fork of Mapbox GL JS,
 * free styles (OpenFreeMap) with no paid API key, good fitBounds + GeoJSON layers.
 * CSS is imported here once; parent uses dynamic(..., { ssr: false }) so WebGL
 * never runs during Next SSR.
 */

import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { RouteMapStop, RouteMapViewModel } from './types'

/** Free MapLibre vector style — no Google/Mapbox paid key. */
const MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty'

const MARKER_COLORS: Record<RouteMapStop['role'], string> = {
  origin: '#2563eb', // blue
  via: '#7c3aed', // violet
  drop: '#d97706', // amber
  destination: '#059669', // emerald
}

const MARKER_LABEL: Record<RouteMapStop['role'], string> = {
  origin: 'A',
  via: '•',
  drop: 'D',
  destination: 'B',
}

export interface RouteMapProps {
  model: RouteMapViewModel
  className?: string
  /** Map v2: reserved click handler for adding waypoints (unused in v1 UI). */
  onMapClick?: (coords: { lat: number; lon: number }) => void
  /** Map v2: reserved drag end for pending/manual waypoints. */
  onWaypointDragEnd?: (id: string, coords: { lat: number; lon: number }) => void
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
    `background:${MARKER_COLORS[stop.role]}`,
    'color:#fff',
    'font:700 12px/1 system-ui,sans-serif',
    isRound ? 'border-radius:9999px' : 'border-radius:6px',
    'border:2px solid #fff',
    'box-shadow:0 1px 4px rgba(0,0,0,.35)',
    'cursor:default',
    'user-select:none',
  ].join(';')
  el.textContent = MARKER_LABEL[stop.role]
  return el
}

export default function RouteMap({ model, className, onMapClick }: RouteMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const markersRef = useRef<maplibregl.Marker[]>([])
  const onMapClickRef = useRef(onMapClick)
  onMapClickRef.current = onMapClick

  // Init map once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_STYLE,
      center: [-98.5, 39.8],
      zoom: 3.2,
      attributionControl: { compact: true },
    })
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
    mapRef.current = map

    map.on('click', (e) => {
      // v1: no-op unless parent wires Map v2 handler
      onMapClickRef.current?.({ lat: e.lngLat.lat, lon: e.lngLat.lng })
    })

    return () => {
      markersRef.current.forEach((m) => m.remove())
      markersRef.current = []
      map.remove()
      mapRef.current = null
    }
  }, [])

  // Sync markers + line + bounds when model changes
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const apply = () => {
      // Clear prior markers
      markersRef.current.forEach((m) => m.remove())
      markersRef.current = []

      for (const stop of model.stops) {
        const marker = new maplibregl.Marker({ element: buildMarkerElement(stop) })
          .setLngLat([stop.lon, stop.lat])
          .setPopup(
            new maplibregl.Popup({ offset: 16, closeButton: false }).setText(
              `${stop.role}: ${stop.name}`
            )
          )
          .addTo(map)
        markersRef.current.push(marker)
      }

      const line = model.linePositions
      const geojson: GeoJSON.Feature<GeoJSON.LineString> = {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'LineString',
          // MapLibre expects [lon, lat]
          coordinates: line.map(([lat, lon]) => [lon, lat]),
        },
      }

      if (map.getSource('route-line')) {
        ;(map.getSource('route-line') as maplibregl.GeoJSONSource).setData(geojson)
      } else if (line.length >= 2) {
        map.addSource('route-line', { type: 'geojson', data: geojson })
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

      if (line.length < 2 && map.getLayer('route-line-layer')) {
        map.removeLayer('route-line-layer')
        if (map.getSource('route-line')) map.removeSource('route-line')
      }

      // fitBounds to stops
      if (model.stops.length === 1) {
        map.easeTo({
          center: [model.stops[0].lon, model.stops[0].lat],
          zoom: 8,
          duration: prefersReducedMotion() ? 0 : 400,
        })
      } else if (model.stops.length >= 2) {
        const bounds = new maplibregl.LngLatBounds()
        for (const s of model.stops) bounds.extend([s.lon, s.lat])
        map.fitBounds(bounds, {
          padding: { top: 48, bottom: 48, left: 48, right: 48 },
          maxZoom: 10,
          duration: prefersReducedMotion() ? 0 : 500,
        })
      }
    }

    if (map.isStyleLoaded()) {
      apply()
    } else {
      map.once('load', apply)
    }
  }, [model.stops, model.linePositions])

  return (
    <div
      ref={containerRef}
      className={
        className ||
        'w-full min-h-[280px] md:min-h-[360px] rounded-xl overflow-hidden bg-slate-100'
      }
      role="img"
      aria-label="Route map"
    />
  )
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}
