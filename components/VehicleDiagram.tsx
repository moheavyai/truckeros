'use client'

import React from 'react'
import type { Tractor, Trailer } from '@/types/equipment'
import { computeRigDimensions } from '@/types/equipment'
import TractorGraphic from '@/components/TractorGraphic'

interface VehicleDiagramProps {
  tractor: Partial<Tractor> | null | undefined
  trailers: (Partial<Trailer> | null | undefined)[]
  showDimensions?: boolean
  className?: string
  height?: number // px
  compact?: boolean
}

/**
 * VehicleDiagram
 * Clean SVG side-view of tractor + one-or-more trailers.
 * - Axles as vertical ticks + circles
 * - 5th wheel and kingpins marked
 * - Overall length callout
 * - Responsive, printable, no external deps
 */
export default function VehicleDiagram({
  tractor,
  trailers,
  showDimensions = true,
  className = '',
  height = 220,
  compact = false,
}: VehicleDiagramProps) {
  const dims = computeRigDimensions(tractor, trailers)

  const isCompact = !!compact

  const tractorLen = Number(tractor?.overall_length_ft) || 0
  const isTrailerOnly = tractorLen < 5 && trailers && trailers.length > 0
  const isTractorOnly = tractorLen >= 5 && (!trailers || trailers.length === 0)

  // Scale: fit ~80 ft into ~920 px viewBox width (generous for labels)
  let VIEW_WIDTH = 960
  let VIEW_HEIGHT = 240
  let SCALE = (VIEW_WIDTH - 80) / Math.max(dims.totalLengthFt, 45) // px per ft
  let BASE_Y = 130 // road / frame line

  if (isCompact) {
    VIEW_WIDTH = 240
    VIEW_HEIGHT = 52
    SCALE = (VIEW_WIDTH - 16) / Math.max(dims.totalLengthFt, 18)
    BASE_Y = 32  // moved lower inside preview box
  }

  const toX = (ft: number) => (isCompact ? 6 : 40) + ft * SCALE

  // Colors (Tailwind-friendly but inline for SVG)
  const TRACTOR_COLOR = '#111827' // near black
  const TRAILER_COLOR = '#374151'
  const AXLE_COLOR = '#1f2937'
  const ACCENT = '#0ea5e9' // sky-500 for highlights
  const LIGHT = '#f3f4f6'

  const tractorX = toX(0)
  const tractorW = Math.max( isCompact ? 30 : 60 , (dims.tractorLength || 28) * SCALE )

  if (isCompact) {
    // Reverted to previous clean, simple basic compact preview
    // Basic tractor body + trailers + axle circles + length label. Core functionality preserved.
    return (
      <svg
        viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
        width="100%"
        height={height}
        className={`block mx-auto ${className}`}
        style={{ maxWidth: '100%', height: 'auto' }}
        aria-label="Compact equipment preview"
      >
        {/* Light bg */}
        <rect x="0" y="0" width={VIEW_WIDTH} height={VIEW_HEIGHT} fill="#f8fafc" rx="2" />

        {/* Tractor body - now rendered via shared TractorGraphic (standard proportions + fixed 5th on frame top) */}
        {!isTrailerOnly && (
          <TractorGraphic
            embedded
            x={tractorX}
            y={BASE_Y}
            w={tractorW}
            fifthX={toX(dims.fifthWheelPositionFt)}
            scale={SCALE}
            compact
          />
        )}

        {/* Trailers (basic clean version from previous working state) */}
        {dims.trailerStartPositionsFt.map((startFt, i) => {
          const trLen = dims.trailerLengths[i] || 40
          const startX = toX(startFt)
          const w = Math.max(18, trLen * SCALE)
          return (
            <g key={i}>
              <rect x={startX} y={BASE_Y - 8} width={w} height="7" rx="1" fill={i === 0 ? '#475569' : '#374151'} />
              <rect x={startX + w - 2} y={BASE_Y - 9} width="2" height="9" fill="#1e2937" />
              {/* Kingpin */}
              {dims.kingpinPositionsFt[i] !== undefined && (
                <circle cx={toX(dims.kingpinPositionsFt[i])} cy={BASE_Y - 1} r="1.8" fill="#f59e0b" />
              )}
            </g>
          )
        })}

        {/* Axle circles (core functionality kept intact) */}
        {dims.axlePositionsFt.map((axleFt, idx) => {
          const ax = toX(axleFt)
          return <circle key={idx} cx={ax} cy={BASE_Y + 3} r="2" fill="#111827" stroke="#4b5563" strokeWidth="0.5" />
        })}

        {/* Small overall length label */}
        <text
          x={VIEW_WIDTH / 2}
          y="7"
          fontSize="6.5"
          textAnchor="middle"
          fill="#475569"
          fontWeight="600"
        >
          {dims.totalLengthFt.toFixed(0)} ft
        </text>
      </svg>
    )
  }

  return (
    <div className={`bg-white border border-gray-200 rounded-2xl p-4 overflow-hidden ${className}`}>
      <svg
        viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
        width="100%"
        height={height}
        className="block mx-auto"
        aria-label="Rig diagram showing tractor, trailers, axles and overall length"
      >
        {/* Sky / ground hint */}
        <rect x="0" y="0" width={VIEW_WIDTH} height={BASE_Y + 60} fill="#f8fafc" />
        <line x1="0" y1={BASE_Y + 8} x2={VIEW_WIDTH} y2={BASE_Y + 8} stroke="#e5e7eb" strokeWidth="2" />

        {/* Tractor body (cab + frame) - now rendered via shared TractorGraphic (standard proportions from Saved Rig reference + 5th fixed on top of frame rect) */}
        {!isTrailerOnly && (
          <TractorGraphic
            embedded
            x={tractorX}
            y={BASE_Y}
            w={tractorW}
            fifthX={toX(dims.fifthWheelPositionFt)}
            scale={SCALE}
            compact={false}
          />
        )}

        {/* Trailers */}
        {dims.trailerStartPositionsFt.map((startFt, i) => {
          const trLen = dims.trailerLengths[i] || 53
          const startX = toX(startFt)
          const w = Math.max(40, trLen * SCALE)
          const isLast = i === dims.trailerStartPositionsFt.length - 1

          return (
            <g key={i}>
              {/* Trailer deck */}
              <rect
                x={startX}
                y={BASE_Y - 28}
                width={w}
                height="22"
                rx="2"
                fill={i === 0 ? '#475569' : TRAILER_COLOR}
                stroke={isLast ? '#1e2937' : '#334155'}
                strokeWidth="1"
              />
              {/* Rear bumper / tail */}
              <rect
                x={startX + w - 8}
                y={BASE_Y - 30}
                width="8"
                height="26"
                fill="#1e2937"
              />
              {/* Kingpin indicator (on first trailer only, or each) */}
              {dims.kingpinPositionsFt[i] !== undefined && (
                <g>
                  <circle
                    cx={toX(dims.kingpinPositionsFt[i])}
                    cy={BASE_Y - 6}
                    r="5"
                    fill="#f59e0b"
                    stroke="#b45309"
                    strokeWidth="1.5"
                  />
                  <text x={toX(dims.kingpinPositionsFt[i])} y={BASE_Y - 18} fontSize="8" textAnchor="middle" fill="#92400e">
                    KP
                  </text>
                </g>
              )}
              {/* Label */}
              <text x={startX + w / 2} y={BASE_Y - 38} fontSize="10" textAnchor="middle" fill="#64748b" fontWeight="500">
                Trailer {i + 1}
              </text>
            </g>
          )
        })}

        {/* Axles (all) */}
        {dims.axlePositionsFt.map((axleFt, idx) => {
          const ax = toX(axleFt)
          const isSteer = idx === 0
          return (
            <g key={idx}>
              {/* Tire / wheel */}
              <circle cx={ax} cy={BASE_Y + 4} r="9" fill="#111827" stroke="#374151" strokeWidth="2" />
              <circle cx={ax} cy={BASE_Y + 4} r="4" fill="#4b5563" />
              {/* Axle vertical line (suspension) */}
              <line x1={ax} y1={BASE_Y - 6} x2={ax} y2={BASE_Y + 12} stroke={AXLE_COLOR} strokeWidth="2.5" />
              {/* Axle number label */}
              <text x={ax} y={BASE_Y + 28} fontSize="8" textAnchor="middle" fill="#475569">
                {idx + 1}
              </text>
              {isSteer && (
                <text x={ax} y={BASE_Y - 14} fontSize="7" textAnchor="middle" fill="#0ea5e9">STEER</text>
              )}
            </g>
          )
        })}

        {/* Road line */}
        <line x1="20" y1={BASE_Y + 14} x2={VIEW_WIDTH - 20} y2={BASE_Y + 14} stroke="#cbd5e1" strokeWidth="3" strokeDasharray="4 3" />

        {/* Dimension callouts (top) */}
        {showDimensions && (
          <>
            {/* Overall length */}
            <g>
              <line
                x1={toX(0)}
                y1="26"
                x2={toX(dims.totalLengthFt)}
                y2="26"
                stroke={ACCENT}
                strokeWidth="2"
                markerStart="url(#arrow)"
                markerEnd="url(#arrow)"
              />
              <rect x={(toX(0) + toX(dims.totalLengthFt)) / 2 - 42} y="8" width="84" height="18" rx="3" fill="#0ea5e9" />
              <text
                x={(toX(0) + toX(dims.totalLengthFt)) / 2}
                y="22"
                fontSize="11"
                textAnchor="middle"
                fill="white"
                fontWeight="700"
              >
                {dims.totalLengthFt.toFixed(1)} ft
              </text>
              <text x={(toX(0) + toX(dims.totalLengthFt)) / 2} y="38" fontSize="9" textAnchor="middle" fill="#0369a1">
                OVERALL
              </text>
            </g>

            {/* Tractor length hint */}
            <text x={toX(dims.tractorLength / 2)} y={BASE_Y - 68} fontSize="9" textAnchor="middle" fill="#64748b">
              Tractor {dims.tractorLength.toFixed(0)} ft
            </text>
          </>
        )}

        {/* Axle count badge */}
        <g>
          <rect x={VIEW_WIDTH - 118} y="12" width="100" height="22" rx="999" fill="#f1f5f9" stroke="#e2e8f0" />
          <text x={VIEW_WIDTH - 68} y="28" fontSize="11" textAnchor="middle" fill="#334155" fontWeight="600">
            {dims.totalAxles} axles total
          </text>
        </g>

        {/* Legend */}
        <g transform="translate(40, 210)">
          <circle cx="0" cy="0" r="5" fill={TRACTOR_COLOR} />
          <text x="12" y="4" fontSize="9" fill="#475569">Tractor</text>

          <rect x="70" y="-5" width="18" height="10" rx="1" fill={TRAILER_COLOR} />
          <text x="94" y="4" fontSize="9" fill="#475569">Trailer</text>

          <circle cx="150" cy="0" r="4" fill="#0ea5e9" />
          <text x="160" y="4" fontSize="9" fill="#475569">5th / Kingpin</text>
        </g>

        {/* Scale reference */}
        <text x={VIEW_WIDTH - 60} y={VIEW_HEIGHT - 8} fontSize="8" fill="#94a3b8" textAnchor="end">
          scale ≈ {SCALE.toFixed(1)} px/ft
        </text>
      </svg>

      {/* Numeric summary row */}
      {showDimensions && (
        <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs text-gray-600">
          <div className="bg-gray-50 rounded px-3 py-1.5">
            <span className="font-medium text-gray-800">Overall Length</span><br />
            <span className="font-mono text-base text-black">{dims.totalLengthFt.toFixed(1)}</span> ft
          </div>
          <div className="bg-gray-50 rounded px-3 py-1.5">
            <span className="font-medium text-gray-800">Total Axles</span><br />
            <span className="font-mono text-base text-black">{dims.totalAxles}</span>
          </div>
          <div className="bg-gray-50 rounded px-3 py-1.5">
            <span className="font-medium text-gray-800">5th Wheel @</span><br />
            <span className="font-mono text-base text-black">{dims.fifthWheelPositionFt.toFixed(1)}</span> ft from front
          </div>
          <div className="bg-gray-50 rounded px-3 py-1.5">
            <span className="font-medium text-gray-800">Trailers</span><br />
            {dims.trailerLengths.length} × {dims.trailerLengths.map((l, i) => `${l}ft`).join(' + ')}
          </div>
        </div>
      )}
    </div>
  )
}
