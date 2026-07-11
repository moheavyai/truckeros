/**
 * types/equipment.ts
 *
 * Types for the Smart Rig Builder (Tractors, Trailers, Rig Configurations).
 * Used by /equipment management page, Rig Selector in /permit-test, and VehicleDiagram.
 */

export interface Tractor {
  id: string
  user_id: string
  profile_name: string

  overall_length_ft: number | null
  num_axles: number | null
  steer_axle_setback_in: number | null
  wheelbase_in: number | null
  axle_spacings: number[] | null          // inches, e.g. [40, 48, 48]
  fifth_wheel_from_rear_in: number | null

  unit_number?: string | null
  license_plate?: string | null
  license_plate_state?: string | null   // 2-letter US state code (e.g. TX)
  vin?: string | null
  empty_weight_lbs?: number | null
  year?: number | null
  make?: string | null
  model?: string | null
  notes?: string | null

  created_at?: string
  updated_at?: string
}

export interface Trailer {
  id: string
  user_id: string
  profile_name: string

  overall_length_ft: number | null
  kingpin_distance_from_front_in: number | null
  num_axles: number | null
  axle_spacings: number[] | null
  kingpin_to_first_axle_in: number | null

  has_lift_axle: boolean | null
  is_extendable: boolean | null
  extendable_extra_ft: number | null

  trailer_type?: string | null
  license_plate?: string | null
  license_plate_state?: string | null   // 2-letter US state code (e.g. TX)
  vin?: string | null
  empty_weight_lbs?: number | null
  width_ft?: number | null
  deck_height_ft?: number | null
  make?: string | null
  model?: string | null
  year?: number | null
  notes?: string | null

  created_at?: string
  updated_at?: string
}

export interface RigConfiguration {
  id: string
  user_id: string
  rig_name: string

  tractor_id: string
  trailer_ids: string[]                  // ordered list of trailer IDs (1 or more supported)

  // Cached computed values (populated on save in /equipment)
  computed_total_length_ft: number | null
  computed_total_axles: number | null
  computed_kingpin_to_last_axle_ft: number | null

  notes?: string | null
  /** When true, auto-selected in Permit Agent. At most one per user. */
  is_default?: boolean | null
  /** Whether this row lives in rig_configurations (vs legacy equipment_profiles payload). */
  source?: 'rig_configurations' | 'legacy'
  created_at?: string
  updated_at?: string

  // Joined data (optional, when we .select('*, tractor:tractors(*), trailers:trailers(*)') or hydrate client-side)
  tractor?: Tractor
  trailers?: Trailer[]
}

// Snapshot stored inside permit_requests.equipment JSONB for auditability
export interface RigSnapshot {
  rigId?: string | null
  rigName?: string | null
  tractor: Partial<Tractor> & { profile_name?: string }
  trailers: (Partial<Trailer> & { profile_name?: string })[]
  overallLengthFt?: number | null
  totalAxles?: number | null
}

// --- Core calculation logic (pure, reusable) ---

/**
 * Parse axle spacings safely (supports number[] or legacy string "6 ft, 4 ft 10 in")
 */
export function parseAxleSpacings(input: number[] | string | null | undefined): number[] {
  if (!input) return []
  if (Array.isArray(input)) return input.filter((n) => Number.isFinite(n) && n > 0)
  if (typeof input === 'string') {
    // Very tolerant legacy parser for old "axleSpacing" text fields
    const nums = input.match(/\d+(\.\d+)?/g)
    return nums ? nums.map(Number).filter((n) => n > 0) : []
  }
  return []
}

/**
 * Compute full rig geometry for graphical display + auto length.
 * Rules (real-world carrier approximations for OSOW):
 * - Tractor length is bumper-to-rear.
 * - 5th wheel sits `fifth_wheel_from_rear_in` forward from tractor rear.
 * - Trailer starts its kingpin at that point; kingpin is `kingpin_distance_from_front_in` behind trailer nose.
 *   → Effective addition per trailer = trailer.overall_length_ft - (kingpin setback effect)
 * - Subsequent trailers are assumed close-coupled or drawbar (simple + full length for MVP).
 * - Load overhangs are applied in the intake form, not here (rig = vehicle only).
 */
export interface RigDimensions {
  totalLengthFt: number
  totalAxles: number
  tractorLength: number
  trailerLengths: number[]
  axlePositionsFt: number[]   // cumulative positions from front bumper (for diagram)
  fifthWheelPositionFt: number
  kingpinPositionsFt: number[] // one per trailer
  trailerStartPositionsFt: number[]
}

export function computeRigDimensions(
  tractor: Partial<Tractor> | null | undefined,
  trailers: (Partial<Trailer> | null | undefined)[]
): RigDimensions {
  const t = tractor || {}
  const tractorLen = Number(t.overall_length_ft) || 0
  const hasTractor = tractorLen > 0

  const fifthFromRearIn = hasTractor ? (Number(t.fifth_wheel_from_rear_in) || 24) : 0
  const fifthFromRearFt = fifthFromRearIn / 12

  // Effective tractor "tail" behind 5th wheel for overlap math
  const tractorTailBehindFifth = hasTractor ? Math.max(0, tractorLen * 0.15) : 0

  let currentX = hasTractor ? tractorLen - fifthFromRearFt : 0
  const fifthWheelPositionFt = hasTractor ? currentX : 0

  const axlePositionsFt: number[] = []
  const kingpinPositionsFt: number[] = []
  const trailerStartPositionsFt: number[] = []
  const trailerLengths: number[] = []

  let totalAxles = hasTractor ? (Number(t.num_axles) || 3) : 0

  if (hasTractor) {
    // Seed rough tractor axle positions (steer at ~steer_setback, drives spread by spacings).
    // Use declared num_axles as source of truth for count so total (tractor + trailers) is accurate
    // and the number of drawn axle positions matches the sum (prevents overcount e.g. 3+2 showing 6).
    const steerSetbackFt = (Number(t.steer_axle_setback_in) || 36) / 12
    axlePositionsFt.push(steerSetbackFt)

    const tSpacings = parseAxleSpacings(t.axle_spacings)
    const targetTractorAxles = Math.max(2, Number(t.num_axles) || 3)
    const numDriveGaps = targetTractorAxles - 1

    // Prefer new full individual axle spacings array [1-2 (steer→1st drive), 2-3, 3-4, ...]
    // (length == numDriveGaps). Falls back to legacy wheelbase + post-first-drive spacings for old data.
    if (tSpacings.length >= numDriveGaps && numDriveGaps > 0) {
      // New detailed data from improved Tractor Profile form
      let pos = steerSetbackFt
      for (let i = 0; i < numDriveGaps; i++) {
        const spIn = tSpacings[i] ?? (i === 0 ? 220 : 48)
        pos += spIn / 12
        axlePositionsFt.push(pos)
      }
    } else {
      // Legacy / partial data: wheelbase for first drive gap, remaining spacings for additional drives
      let driveX = steerSetbackFt + (Number(t.wheelbase_in) || 220) / 12
      axlePositionsFt.push(driveX)
      const additionalDrives = Math.max(0, targetTractorAxles - 2)
      for (let i = 0; i < additionalDrives; i++) {
        const spIn = i < tSpacings.length ? tSpacings[i] : 48
        driveX += spIn / 12
        axlePositionsFt.push(driveX)
      }
    }
  } else {
    // Trailer-only mode: no tractor axles, everything starts from the trailer's own nose at 0
  }

  // For pure trailer previews, set the virtual coupling point so the *first* trailer's nose lands at 0
  // (its kingpin will be at its own kingpin_distance_from_front_in)
  if (!hasTractor && trailers.length > 0) {
    const firstTrl = trailers[0] || {}
    const kpFromFrontFt = (Number(firstTrl.kingpin_distance_from_front_in) || 36) / 12
    currentX = kpFromFrontFt
  }

  // Trailers
  trailers.forEach((tr, idx) => {
    const trl = tr || {}
    const trLen = Number(trl.overall_length_ft) || 53
    const kpFromFrontIn = Number(trl.kingpin_distance_from_front_in) || 36
    const kpFromFrontFt = kpFromFrontIn / 12

    // Kingpin lands at current 5th/coupling X
    const kingpinX = currentX
    kingpinPositionsFt.push(kingpinX)

    // Trailer nose is forward of kingpin by kpFromFrontFt
    const trailerNoseX = kingpinX - kpFromFrontFt
    trailerStartPositionsFt.push(Math.max(0, trailerNoseX))

    // Trailer extends rearward from nose
    const trailerRearX = trailerNoseX + trLen
    trailerLengths.push(trLen)

    // Axles on this trailer
    const firstAxleFromKpIn = Number(trl.kingpin_to_first_axle_in) || 480 // ~40 ft typical for 53'
    let axleX = kingpinX + firstAxleFromKpIn / 12
    const trAxleCount = Number(trl.num_axles) || 2
    totalAxles += trAxleCount

    const trSpacings = parseAxleSpacings(trl.axle_spacings)
    for (let a = 0; a < trAxleCount; a++) {
      axlePositionsFt.push(axleX)
      if (a < trSpacings.length) axleX += trSpacings[a] / 12
      else axleX += 4 // default 4 ft spread
    }

    // For next trailer (if any), assume close couple at rear of previous
    // (real doubles use drawbar or B-train 5th; simple model: start next at previous rear - small gap)
    const gapFt = idx === 0 ? 2.5 : 3.0 // typical
    currentX = trailerRearX + gapFt
  })

  // Overall length is max of last axle or last trailer rear (plus any default overhang buffer)
  const lastTrailerRear = trailerStartPositionsFt.length > 0
    ? trailerStartPositionsFt[trailerStartPositionsFt.length - 1] + trailerLengths[trailerLengths.length - 1]
    : tractorLen

  const totalLengthFt = Math.max(
    lastTrailerRear,
    Math.max(...axlePositionsFt, 0) + 2 // last axle + 2 ft rear overhang typical
  )

  return {
    totalLengthFt: Math.round(totalLengthFt * 10) / 10,
    totalAxles,
    tractorLength: Math.round(tractorLen * 10) / 10,
    trailerLengths: trailerLengths.map((l) => Math.round(l * 10) / 10),
    axlePositionsFt: axlePositionsFt.sort((a, b) => a - b),
    fifthWheelPositionFt: Math.round(fifthWheelPositionFt * 10) / 10,
    kingpinPositionsFt: kingpinPositionsFt.map((x) => Math.round(x * 10) / 10),
    trailerStartPositionsFt: trailerStartPositionsFt.map((x) => Math.round(x * 10) / 10),
  }
}

/**
 * Convenience: compute just the numbers needed for quick display / prefill.
 */
export function computeOverallDimensions(tractor: Partial<Tractor> | null, trailers: (Partial<Trailer> | null)[]) {
  const dims = computeRigDimensions(tractor, trailers)
  return {
    totalLengthFt: dims.totalLengthFt,
    totalAxles: dims.totalAxles,
    axleGroupCount: Math.ceil(dims.totalAxles / 2), // rough for future bridge
  }
}

/** Sum tractor + trailer empty weights when both are known. */
export function computeRigEmptyWeightLbs(
  tractor: Partial<Tractor> | null | undefined,
  trailers: (Partial<Trailer> | null | undefined)[]
): number | null {
  const tractorWt = Number(tractor?.empty_weight_lbs) || 0
  const trailerWt = trailers.reduce((sum, tr) => sum + (Number(tr?.empty_weight_lbs) || 0), 0)
  if (tractorWt > 0 && trailerWt > 0) return tractorWt + trailerWt
  if (tractorWt > 0) return tractorWt
  if (trailerWt > 0) return trailerWt
  return null
}

/** Inputs for routing envelope (rig base + load overhangs / dimensions). */
export interface RoutingEnvelopeInput {
  rigLengthFt?: number | null
  loadOverhangFrontFt?: number | null
  loadOverhangRearFt?: number | null
  trailerWidthFt?: number | null
  loadWidthFt?: number | null
  deckHeightFt?: number | null
  loadHeightFt?: number | null
  rigEmptyWeightLbs?: number | null
  loadWeightLbs?: number | null
}

export interface RoutingEnvelope {
  lengthFt: number
  widthFt: number
  heightFt: number
  weightLbs: number
}

/**
 * Compute routing envelope sent to OR-Tools / permit agent.
 * - Length = rig length + front overhang + rear overhang
 * - Width = max(trailer width, load width). Absent/zero load width does not inflate
 *   width — envelope uses trailer/rig width only (typically legal 8.5 ft / 8'6").
 * - Height = deck height + load height
 * - Weight = rig empty + load weight
 */
export function computeRoutingEnvelope(input: RoutingEnvelopeInput): RoutingEnvelope {
  const rigLen = Number(input.rigLengthFt) || 0
  const frontOh = Number(input.loadOverhangFrontFt) || 0
  const rearOh = Number(input.loadOverhangRearFt) || 0
  const trailerW = Number(input.trailerWidthFt) || 0
  // Treat missing/blank/NaN load width as absent — do not invent a default load width.
  const loadW = Number(input.loadWidthFt) || 0
  const deckH = Number(input.deckHeightFt) || 0
  const loadH = Number(input.loadHeightFt) || 0
  const rigEmpty = Number(input.rigEmptyWeightLbs) || 0
  const loadWt = Number(input.loadWeightLbs) || 0

  const lengthFt =
    rigLen > 0 || frontOh > 0 || rearOh > 0 ? rigLen + frontOh + rearOh : 0
  // Absent load details (loadW === 0): trailer/rig width only. Wider load still wins via max.
  const widthFt =
    trailerW > 0 && loadW > 0
      ? Math.max(trailerW, loadW)
      : trailerW > 0
        ? trailerW
        : loadW > 0
          ? loadW
          : 0
  const heightFt = deckH > 0 || loadH > 0 ? deckH + loadH : 0
  const weightLbs = rigEmpty > 0 || loadWt > 0 ? rigEmpty + loadWt : 0

  return { lengthFt, widthFt, heightFt, weightLbs }
}

/** Primary trailer dimensions for display / permit prefill (first trailer in combination). */
export function primaryTrailerDimensions(trailers: (Partial<Trailer> | null | undefined)[]) {
  const primary = trailers.find(Boolean) as Partial<Trailer> | undefined
  return {
    vin: primary?.vin ?? null,
    licensePlate: primary?.license_plate ?? null,
    licensePlateState: primary?.license_plate_state ?? null,
    emptyWeightLbs: primary?.empty_weight_lbs ?? null,
    widthFt: primary?.width_ft ?? null,
    deckHeightFt: primary?.deck_height_ft ?? null,
    lengthFt: primary?.overall_length_ft ?? null,
  }
}

/** Sort saved rigs for display: default first, then name (A–Z), then newest created_at. */
export function sortRigsForDisplay(rigs: RigConfiguration[]): RigConfiguration[] {
  return [...rigs].sort((a, b) => {
    const aDefault = a.is_default ? 1 : 0
    const bDefault = b.is_default ? 1 : 0
    if (bDefault !== aDefault) return bDefault - aDefault
    const nameA = (a.rig_name || '').toLowerCase()
    const nameB = (b.rig_name || '').toLowerCase()
    const byName = nameA.localeCompare(nameB)
    if (byName !== 0) return byName
    return (b.created_at || '').localeCompare(a.created_at || '')
  })
}

// Placeholder helpers for future features (VIN decoder, photo upload, BOL parse)
export const FUTURE_FEATURES = {
  vinDecoder: 'VIN Decoder (coming soon — decodes make/model/year + axle data)',
  photos: 'Upload rig photos (coming soon)',
  bolImport: 'Import from BOL / Voice / PDF (coming soon)',
} as const
