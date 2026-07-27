/**
 * types/equipment.ts
 *
 * Types for the Smart Rig Builder (Tractors, Trailers, Rig Configurations).
 * Used by /equipment management page, Rig Selector in /permit-test, and VehicleDiagram.
 */

/**
 * Inter-axle spacings in inches.
 * Prefer `number[]` (e.g. [40, 48, 48]). `string` is legacy CSV / JSON text from DB meta.
 */
export type AxleSpacingsField = number[] | string | null

export interface Tractor {
  id: string
  user_id: string
  profile_name: string

  overall_length_ft: number | null
  num_axles: number | null
  steer_axle_setback_in: number | null
  wheelbase_in: number | null
  axle_spacings: AxleSpacingsField
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
  axle_spacings: AxleSpacingsField
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
  /**
   * Role-based axle groups (steer/drives/jeep/trailer/flip/stinger) + spacing/lift
   * geometry for portal/history/prefill. Built via lib/axle-groups buildRigAxleSnapshot.
   */
  axleGroups?: {
    groups: Array<{
      type: string
      axleIndexes: number[]
      axleCount: number
      label: string
      source: string
      trailerIndex?: number
    }>
    totalAxles: number
    capped: boolean
    axleTypes: string[]
  } | null
  axleGroupSummary?: string | null
  /** Tractor inter-axle spacings (inches). */
  tractorSpacingsIn?: number[] | null
  /** Per-trailer inter-axle spacings (inches). */
  trailerSpacingsIn?: number[][] | null
  /** Per-trailer kingpin/pin → first axle (inches). */
  kingpinToFirstAxleIn?: (number | null)[] | null
  /** Per-trailer lift-axle flags. */
  trailerHasLiftAxle?: boolean[] | null
}

// --- Core calculation logic (pure, reusable) ---

/**
 * Parse axle spacings preserving index slots (1-2, 2-3, …).
 * Supports number[] or legacy string. Cleared / invalid slots become 0 — never compact
 * middle zeros (that shifts later gap labels and breaks diagram alignment).
 * When expectedLength is set, pad/truncate to that slot count.
 */
/** True when spacings are present as a non-empty array or non-blank legacy string. */
export function hasDeclaredAxleSpacings(
  spacings: AxleSpacingsField | undefined
): boolean {
  if (Array.isArray(spacings)) return spacings.length > 0
  if (typeof spacings === 'string') return spacings.trim().length > 0
  return false
}

export function parseAxleSpacings(
  input: AxleSpacingsField | undefined,
  expectedLength?: number | null
): number[] {
  if (input == null || input === '') {
    if (expectedLength != null && expectedLength > 0) {
      return Array.from({ length: Math.floor(expectedLength) }, () => 0)
    }
    return []
  }

  let raw: number[] = []
  if (Array.isArray(input)) {
    raw = input.map((x) => {
      const n = Number(x)
      return Number.isFinite(n) && n > 0 ? n : 0
    })
  } else if (typeof input === 'string') {
    // Prefer comma-separated slots so empties keep index; fall back to digit scan for
    // legacy prose like "6 ft, 4 ft 10 in".
    if (input.includes(',')) {
      raw = input.split(',').map((s) => {
        const n = parseFloat(s.trim())
        return Number.isFinite(n) && n > 0 ? n : 0
      })
    } else {
      const nums = input.match(/\d+(\.\d+)?/g)
      raw = nums ? nums.map(Number).filter((n) => Number.isFinite(n) && n > 0) : []
    }
  }

  if (expectedLength != null && Number.isFinite(expectedLength) && expectedLength > 0) {
    const n = Math.floor(expectedLength)
    const out = raw.slice(0, n)
    while (out.length < n) out.push(0)
    return out
  }

  // Free-length: drop only trailing empties so middle zeros keep their index.
  let end = raw.length
  while (end > 0 && !(raw[end - 1] > 0)) end -= 1
  return raw.slice(0, end)
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

    const targetTractorAxles = Math.max(2, Number(t.num_axles) || 3)
    const numDriveGaps = targetTractorAxles - 1
    // Slot-preserving parse (middle zeros keep index). Empty slots use geometry defaults.
    const tSpacings = parseAxleSpacings(t.axle_spacings, numDriveGaps > 0 ? numDriveGaps : null)
    const hasDeclaredTractorSpacings = hasDeclaredAxleSpacings(t.axle_spacings)

    // Prefer full individual axle spacings [1-2, 2-3, 3-4, …]. Falls back to legacy wheelbase.
    if (hasDeclaredTractorSpacings && numDriveGaps > 0) {
      let pos = steerSetbackFt
      for (let i = 0; i < numDriveGaps; i++) {
        const raw = tSpacings[i] || 0
        const spIn = raw > 0 ? raw : i === 0 ? 220 : 48
        pos += spIn / 12
        axlePositionsFt.push(pos)
      }
    } else {
      // Legacy / partial data: wheelbase for first drive gap, remaining spacings for additional drives
      let driveX = steerSetbackFt + (Number(t.wheelbase_in) || 220) / 12
      axlePositionsFt.push(driveX)
      const additionalDrives = Math.max(0, targetTractorAxles - 2)
      for (let i = 0; i < additionalDrives; i++) {
        const raw = tSpacings[i] || 0
        const spIn = raw > 0 ? raw : 48
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

    const trGaps = Math.max(0, trAxleCount - 1)
    const trSpacings = parseAxleSpacings(trl.axle_spacings, trGaps > 0 ? trGaps : null)
    for (let a = 0; a < trAxleCount; a++) {
      axlePositionsFt.push(axleX)
      if (a < trAxleCount - 1) {
        const raw = trSpacings[a] || 0
        // Default ~49" (≈4.08 ft) between trailer axles when slot empty
        axleX += (raw > 0 ? raw : 49) / 12
      }
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
 * axleGroupCount is a light heuristic (steer+drives on tractor + one group per trailer unit),
 * not a full assignAxleGroups() call — use lib/axle-groups for permitting groups.
 */
export function computeOverallDimensions(tractor: Partial<Tractor> | null, trailers: (Partial<Trailer> | null)[]) {
  const dims = computeRigDimensions(tractor, trailers)
  let axleGroupCount = 0
  const tAxles =
    tractor == null
      ? 0
      : tractor.num_axles == null
        ? 3
        : Math.max(0, Math.floor(Number(tractor.num_axles)) || 0)
  if (tAxles > 0) axleGroupCount += tAxles === 1 ? 1 : 2 // steer + drives (or steer only)
  for (const tr of trailers || []) {
    if (!tr) continue
    const n =
      tr.num_axles == null
        ? 2
        : Math.max(0, Math.floor(Number(tr.num_axles)) || 0)
    if (n > 0) axleGroupCount += 1
  }
  // Do not invent groups when callers declared zero axles; only fall back when
  // no equipment was supplied at all but geometry still reports axles.
  if (
    axleGroupCount === 0 &&
    dims.totalAxles > 0 &&
    tractor == null &&
    (!trailers || trailers.length === 0)
  ) {
    axleGroupCount = Math.ceil(dims.totalAxles / 2)
  }
  return {
    totalLengthFt: dims.totalLengthFt,
    totalAxles: dims.totalAxles,
    axleGroupCount,
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
