'use client'

import type { ReactNode } from 'react'
import type { LocationStop } from '@/lib/location-stop'
import { MAX_Q_LEN } from '@/lib/geocode-server'

type LocationStopInputProps = {
  label: string
  stop: LocationStop
  lat?: number
  lon?: number
  isGeocoding: boolean
  showManualCoords: boolean
  errorKey?: string
  errors: Record<string, string>
  placeholder?: string
  onQueryChange: (query: string) => void
  onCoordsChange: (lat?: number, lon?: number) => void
  onBlurGeocode: () => void
  onToggleManual: () => void
  voiceButton?: ReactNode
}

function parseCoord(value: string): number | undefined {
  if (value === '') return undefined
  const n = parseFloat(value)
  return Number.isFinite(n) ? n : undefined
}

export default function LocationStopInput({
  label,
  stop,
  lat,
  lon,
  isGeocoding,
  showManualCoords,
  errorKey,
  errors,
  placeholder = 'Address or business + city (e.g. Case IH plant Grand Island)',
  onQueryChange,
  onCoordsChange,
  onBlurGeocode,
  onToggleManual,
  voiceButton,
}: LocationStopInputProps) {
  const geocoded = lat != null && lon != null
  const resolved = stop.city || stop.state

  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <h2 className="font-semibold flex items-center gap-2">
          {label}
          {voiceButton}
        </h2>
        {geocoded ? (
          <span className="text-xs px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700 font-medium">
            ✓ Geocoded{stop.state ? ` (${stop.state})` : ''}
          </span>
        ) : isGeocoding ? (
          <span className="text-xs px-2.5 py-1 rounded-full bg-yellow-100 text-yellow-700 font-medium">
            Geocoding...
          </span>
        ) : stop.query?.trim() ? (
          <span className="text-xs px-2.5 py-1 rounded-full bg-gray-100 text-gray-600 font-medium">
            Tap outside field to geocode
          </span>
        ) : null}
      </div>

      <input
        type="text"
        inputMode="text"
        autoComplete="street-address"
        placeholder={placeholder}
        value={stop.query}
        maxLength={MAX_Q_LEN}
        onChange={(e) => onQueryChange(e.target.value)}
        onBlur={onBlurGeocode}
        className={`border p-4 min-h-[48px] rounded-lg w-full text-base touch-manipulation ${errorKey && errors[errorKey] ? 'border-red-500' : 'border-gray-300'}`}
      />
      {errorKey && errors[errorKey] && (
        <p className="text-red-500 text-xs mt-1">{errors[errorKey]}</p>
      )}

      {resolved && (
        <div className="text-xs text-gray-600 mt-1.5">
          Resolved: {[stop.street, stop.city, stop.state, stop.zip].filter(Boolean).join(', ')}
        </div>
      )}

      {geocoded && (
        <div className="text-[10px] text-gray-500 mt-1 font-mono">
          {lat.toFixed(5)}, {lon.toFixed(5)}
        </div>
      )}

      {showManualCoords && (
        <div className="mt-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
          <p className="text-xs font-medium text-amber-900 mb-1">Geocoding failed — enter coordinates manually</p>
          <p className="text-xs text-amber-800 mb-2">
            Paste latitude and longitude (e.g. from Google Maps). You can still submit the load with manual coords.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <input
              type="number"
              step="any"
              placeholder="Latitude"
              value={lat ?? ''}
              onChange={(e) => onCoordsChange(parseCoord(e.target.value), lon)}
              className="border p-3 min-h-[44px] rounded-lg text-base touch-manipulation"
            />
            <input
              type="number"
              step="any"
              placeholder="Longitude"
              value={lon ?? ''}
              onChange={(e) => onCoordsChange(lat, parseCoord(e.target.value))}
              className="border p-3 min-h-[44px] rounded-lg text-base touch-manipulation"
            />
          </div>
          <button
            type="button"
            className="text-xs text-blue-700 underline mt-2"
            onClick={onToggleManual}
          >
            Hide manual coordinates
          </button>
        </div>
      )}

      {!showManualCoords && !geocoded && stop.query?.trim() && !isGeocoding && (
        <button
          type="button"
          className="text-sm text-blue-700 underline mt-2 py-2 touch-manipulation"
          onClick={onToggleManual}
        >
          Enter coordinates manually
        </button>
      )}
    </div>
  )
}