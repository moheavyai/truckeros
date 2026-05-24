'use client'

import React from 'react'
import type { Tractor } from '@/types/equipment'
import { computeRigDimensions } from '@/types/equipment'

export interface TractorGraphicProps {
  tractor?: Partial<Tractor> | null
  height?: number
  className?: string
  // Embedded mode: render bare <g> for use inside a parent <svg> (e.g. VehicleDiagram)
  // Parent supplies positioning computed from its scale/BASE_Y/dims
  embedded?: boolean
  x?: number
  y?: number
  w?: number
  fifthX?: number
  scale?: number
  compact?: boolean
}

const NOMINAL_SCALE = 19.5

function TractorBody({
  effTractorX,
  effTractorW,
  effBaseY,
  effFifthX,
  vFactor,
  showLabel = false,
}: {
  effTractorX: number
  effTractorW: number
  effBaseY: number
  effFifthX: number
  vFactor: number
  showLabel?: boolean
}) {
  // Standard proportions from the full/Saved Rig reference (y = BASE_Y -32 for sleeper top)
  // 5th wheel cy placed exactly at sleeper rect top for accurate "on the frame" placement
  const hoodY = effBaseY - 42 * vFactor
  const hoodH = 36 * vFactor
  const hoodW = effTractorW * 0.22

  const cabY = effBaseY - 58 * vFactor
  const cabH = 52 * vFactor
  const cabW = effTractorW * 0.38
  const cabX = effTractorX + effTractorW * 0.18
  const cabRx = Math.max(1, 4 * vFactor)

  const sleeperY = effBaseY - 32 * vFactor
  const sleeperH = 26 * vFactor
  const sleeperW = effTractorW * 0.48
  const sleeperX = effTractorX + effTractorW * 0.55
  const sleeperRx = Math.max(1, 2 * vFactor)

  // 5th wheel dot/circle sits with center at the TOP of the sleeper/frame rect
  const fifthCy = sleeperY
  const fifthR = Math.max(1.2, 7 * vFactor)
  const fifthStroke = Math.max(0.5, 2 * vFactor)

  const labelY = effBaseY + 18 * vFactor
  const labelSize = Math.max(5, 9 * vFactor)

  return (
    <>
      {/* Hood / engine area */}
      <rect
        x={effTractorX}
        y={hoodY}
        width={hoodW}
        height={hoodH}
        fill="#1f2937"
      />
      {/* Cab */}
      <rect
        x={cabX}
        y={cabY}
        width={cabW}
        height={cabH}
        rx={cabRx}
        fill="#111827"
      />
      {/* Sleeper / frame extension to 5th wheel (reference for placement) */}
      <rect
        x={sleeperX}
        y={sleeperY}
        width={sleeperW}
        height={sleeperH}
        rx={sleeperRx}
        fill="#334155"
      />
      {/* 5th wheel marker - center on top of frame rect (fixed) */}
      <circle
        cx={effFifthX}
        cy={fifthCy}
        r={fifthR}
        fill="#0ea5e9"
        stroke="#0369a1"
        strokeWidth={fifthStroke}
      />
      {showLabel && vFactor > 0.45 && (
        <text
          x={effFifthX}
          y={labelY}
          fontSize={labelSize}
          textAnchor="middle"
          fill="#0c4a6e"
          fontWeight="600"
        >
          5th
        </text>
      )}
    </>
  )
}

export default function TractorGraphic({
  tractor,
  height = 80,
  className = '',
  embedded = false,
  x = 0,
  y = 130,
  w = 60,
  fifthX,
  scale = 19.5,
  compact = false,
}: TractorGraphicProps) {
  const tractorLen = Number(tractor?.overall_length_ft) || 28
  const dims = computeRigDimensions(tractor || undefined, [])

  if (embedded) {
    const vFactor = Math.max(0.08, (scale || 19.5) / NOMINAL_SCALE)
    const effBaseY = y
    const effTractorX = x
    const effTractorW = w
    const effFifthX = fifthX ?? (x + 0.75 * w) // fallback near rear

    return (
      <g>
        <TractorBody
          effTractorX={effTractorX}
          effTractorW={effTractorW}
          effBaseY={effBaseY}
          effFifthX={effFifthX}
          vFactor={vFactor}
          showLabel={!compact}
        />
      </g>
    )
  }

  // Standalone mode: self-contained svg for Tractor cards + Rig Builder tractor-only
  // Uses the exact same body proportions (scaled uniformly via vFactor for visual consistency)
  const s_VIEW_WIDTH = 220
  const s_VIEW_HEIGHT = 68
  const s_BASE_Y = 42
  const s_SCALE = (s_VIEW_WIDTH - 22) / Math.max(tractorLen, 15)
  const s_tractorX = 12
  const s_tractorW = Math.max(42, tractorLen * s_SCALE)
  const s_fifthX = s_tractorX + dims.fifthWheelPositionFt * s_SCALE

  const vFactor = Math.max(0.12, s_SCALE / NOMINAL_SCALE)

  const effBaseY = s_BASE_Y
  const effTractorX = s_tractorX
  const effTractorW = s_tractorW
  const effFifthX = s_fifthX

  // Axle rendering (scaled for consistency with body)
  const axleR = Math.max(1.3, 8 * vFactor)
  const axleLineLen = 8 * vFactor
  const axleFont = Math.max(4.5, 7 * vFactor)

  return (
    <svg
      viewBox={`0 0 ${s_VIEW_WIDTH} ${s_VIEW_HEIGHT}`}
      width="100%"
      height={height}
      className={`block mx-auto ${className}`}
      style={{ maxWidth: '100%', height: 'auto' }}
      aria-label="Tractor graphic"
    >
      {/* Light bg */}
      <rect x="0" y="0" width={s_VIEW_WIDTH} height={s_VIEW_HEIGHT} fill="#f8fafc" rx="3" />

      {/* Tractor body (standard proportions, 5th on frame top) */}
      <TractorBody
        effTractorX={effTractorX}
        effTractorW={effTractorW}
        effBaseY={effBaseY}
        effFifthX={effFifthX}
        vFactor={vFactor}
        showLabel={vFactor > 0.5}
      />

      {/* Axles (tractor only) */}
      {dims.axlePositionsFt.map((axleFt, idx) => {
        const ax = s_tractorX + axleFt * s_SCALE
        const isSteer = idx === 0
        return (
          <g key={idx}>
            <circle cx={ax} cy={effBaseY + 3 * vFactor} r={axleR} fill="#111827" stroke="#4b5563" strokeWidth={0.6 * vFactor} />
            <circle cx={ax} cy={effBaseY + 3 * vFactor} r={axleR * 0.45} fill="#4b5563" />
            <line
              x1={ax}
              y1={effBaseY - 2 * vFactor}
              x2={ax}
              y2={effBaseY + (3 + axleLineLen) * vFactor}
              stroke="#1f2937"
              strokeWidth={1.2 * vFactor}
            />
            {vFactor > 0.42 && (
              <>
                <text x={ax} y={effBaseY + 14 * vFactor} fontSize={axleFont} textAnchor="middle" fill="#475569">
                  {idx + 1}
                </text>
                {isSteer && (
                  <text x={ax} y={effBaseY - 5 * vFactor} fontSize={Math.max(4, 6 * vFactor)} textAnchor="middle" fill="#0ea5e9">
                    STEER
                  </text>
                )}
              </>
            )}
          </g>
        )
      })}

      {/* Small length label (top) */}
      <text
        x={s_VIEW_WIDTH / 2}
        y="7"
        fontSize={Math.max(5.5, 6.5 * vFactor)}
        textAnchor="middle"
        fill="#475569"
        fontWeight="600"
      >
        {tractorLen.toFixed(0)} ft
      </text>
    </svg>
  )
}
