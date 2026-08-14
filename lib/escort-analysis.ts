/**
 * lib/escort-analysis.ts
 *
 * Per-state escort requirement analysis using state_permit_rules + baseline thresholds.
 *
 * Output distinguishes:
 * - requirementLevel: may_require vs required (hard)
 * - count + positions (lead / chase)
 * - escort types (civilian vs law enforcement)
 * - height pole: none | recommended | required
 * - road-class / local-road caveats
 *
 * Backward compatible: escortCount, warning, heightPoleRecommended remain populated.
 */

import { formatDimensionDisplay } from '@/lib/parse-dimension'
import type { StatePermitRule } from '@/types/permit'

/** Baseline thresholds when a state rule omits escort columns. */
export const BASELINE_ONE_ESCORT_WIDTH_FT = 12.0 // 12'0"
export const BASELINE_TWO_ESCORT_WIDTH_FT = 14.0 // 14'0"
export const BASELINE_TWO_ESCORT_LENGTH_FT = 110.0
export const BASELINE_HEIGHT_POLE_FT = 14.5 // 14'6"
export const BASELINE_HEIGHT_POLE_STRONG_FT = 15.5 // 15'6"

export type EscortRequirementLevel = 'none' | 'may_require' | 'required'
export type EscortPosition = 'lead' | 'chase'
export type EscortVehicleType = 'civilian' | 'law_enforcement'
export type HeightPoleLevel = 'none' | 'recommended' | 'required'
export type RoadClassHint = 'interstate' | 'us_highway' | 'state_highway' | 'local' | 'mixed'

/**
 * Optional structured band stored in state_permit_rules.escort_rules (jsonb).
 * When present, bands are evaluated in order; strongest match wins.
 */
export interface EscortRuleBand {
  when: {
    minWidthFt?: number
    minHeightFt?: number
    minLengthFt?: number
    minWeightLbs?: number
  }
  requirement: 'may_require' | 'required'
  count: number
  positions?: EscortPosition[]
  types?: EscortVehicleType[]
  heightPole?: Exclude<HeightPoleLevel, 'none'>
  roadClasses?: RoadClassHint[]
  notes?: string
}

export interface StructuredEscortRules {
  bands?: EscortRuleBand[]
  defaultNote?: string
  source?: string
  lastVerified?: string
}

export interface EscortLoadDimensions {
  width: number
  length: number
  height: number
  weight: number
}

export interface StateEscortDetail {
  stateCode: string
  /** 2 means "2+ escorts". Kept for existing UI. */
  escortCount: 0 | 1 | 2
  /** @deprecated Prefer heightPoleLevel — still set for older callers. */
  heightPoleRecommended: boolean
  heightPoleLevel: HeightPoleLevel
  requirementLevel: EscortRequirementLevel
  positions: EscortPosition[]
  escortTypes: EscortVehicleType[]
  roadClassHint?: RoadClassHint
  highwayContext?: string
  warning: string
  triggers: string[]
  notes?: string
}

export interface EscortAnalysisInput {
  routeCorridor: string[]
  load: EscortLoadDimensions
  ruleMap: Map<string, StatePermitRule>
  highways?: string[]
}

export interface EscortAnalysisResult {
  escortRequiredStates: string[]
  escortWarnings: string[]
  escortDetails: StateEscortDetail[]
}

const EMPTY_RESULT: EscortAnalysisResult = {
  escortRequiredStates: [],
  escortWarnings: [],
  escortDetails: [],
}

export function hasValidEscortLoadDimensions(load: EscortLoadDimensions): boolean {
  return (
    Number.isFinite(load.width) &&
    Number.isFinite(load.length) &&
    Number.isFinite(load.height) &&
    Number.isFinite(load.weight) &&
    load.width > 0 &&
    load.length > 0 &&
    load.height > 0 &&
    load.weight > 0
  )
}

function effectiveThreshold(
  ruleValue: number | null | undefined,
  baseline: number
): number {
  if (ruleValue == null || ruleValue <= 0 || Number.isNaN(ruleValue)) {
    return baseline
  }
  return ruleValue
}

function effectiveTier2Threshold(
  ruleValue: number | null | undefined,
  baseline: number
): number {
  if (ruleValue == null || ruleValue <= 0 || Number.isNaN(ruleValue)) {
    return baseline
  }
  return Math.max(ruleValue, baseline)
}

function parseStructuredRules(rule: StatePermitRule | undefined): StructuredEscortRules | null {
  const raw = (rule as StatePermitRule & { escort_rules?: unknown })?.escort_rules
  if (raw == null) return null
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as StructuredEscortRules
  }
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object') return parsed as StructuredEscortRules
    } catch {
      return null
    }
  }
  return null
}

function bandMatches(band: EscortRuleBand, load: EscortLoadDimensions): boolean {
  const { when } = band
  const checks: boolean[] = []
  if (when.minWidthFt != null) checks.push(load.width >= when.minWidthFt)
  if (when.minHeightFt != null) checks.push(load.height >= when.minHeightFt)
  if (when.minLengthFt != null) checks.push(load.length >= when.minLengthFt)
  if (when.minWeightLbs != null) checks.push(load.weight >= when.minWeightLbs)
  return checks.length > 0 && checks.some(Boolean)
}

function formatHighwayContext(highways?: string[]): {
  text?: string
  roadClassHint: RoadClassHint
} {
  if (!highways || highways.length === 0) {
    return {
      text: 'local/non-interstate segments — confirm escorts with state DOT',
      roadClassHint: 'local',
    }
  }

  const majors = highways
    .map((h) => h.split(' (')[0].trim())
    .filter((h) => /^I-|^US /i.test(h))
    .slice(0, 3)

  if (majors.length === 0) {
    return {
      text: 'may include local roads — confirm escorts with state DOT',
      roadClassHint: 'local',
    }
  }

  const hasInterstate = majors.some((h) => /^I-/i.test(h))
  const hasUs = majors.some((h) => /^US /i.test(h))
  const roadClassHint: RoadClassHint =
    hasInterstate && hasUs ? 'mixed' : hasInterstate ? 'interstate' : hasUs ? 'us_highway' : 'mixed'

  return {
    text: `on ${majors.join(', ')}`,
    roadClassHint,
  }
}

function clampCount(n: number): 0 | 1 | 2 {
  if (n <= 0) return 0
  if (n === 1) return 1
  return 2
}

function defaultPositions(count: 0 | 1 | 2): EscortPosition[] {
  if (count >= 2) return ['lead', 'chase']
  if (count === 1) return ['chase']
  return []
}

function buildWarning(detail: {
  stateCode: string
  requirementLevel: EscortRequirementLevel
  escortCount: 0 | 1 | 2
  heightPoleLevel: HeightPoleLevel
  positions: EscortPosition[]
  escortTypes: EscortVehicleType[]
  highwayContext?: string
}): string {
  const parts: string[] = []

  if (detail.escortCount >= 2) {
    const level =
      detail.requirementLevel === 'required' ? 'required' : 'typically required'
    parts.push(`2+ escorts ${level}`)
  } else if (detail.escortCount === 1) {
    const level =
      detail.requirementLevel === 'required' ? 'required' : 'recommended / may be required'
    parts.push(`1 escort ${level}`)
  }

  if (detail.positions.length > 0) {
    parts.push(`position: ${detail.positions.join(' + ')}`)
  }

  if (detail.escortTypes.length > 0) {
    const label = detail.escortTypes
      .map((t) => (t === 'law_enforcement' ? 'LE' : 'civilian'))
      .join(' / ')
    parts.push(label)
  }

  if (detail.heightPoleLevel === 'required') {
    parts.push('height pole required')
  } else if (detail.heightPoleLevel === 'recommended') {
    parts.push('height pole recommended')
  }

  let warning = `${detail.stateCode}: ${parts.join(' · ')}`
  if (detail.highwayContext) {
    warning += ` (${detail.highwayContext})`
  }
  return warning
}

function analyzeFromThresholds(
  stateCode: string,
  load: EscortLoadDimensions,
  rule: StatePermitRule | undefined,
  highwayContext: string | undefined,
  roadClassHint: RoadClassHint
): StateEscortDetail | null {
  const width1 = effectiveThreshold(
    rule?.escort_threshold_width_ft,
    BASELINE_ONE_ESCORT_WIDTH_FT
  )
  const width2 = effectiveTier2Threshold(
    rule?.escort_threshold_width_ft,
    BASELINE_TWO_ESCORT_WIDTH_FT
  )
  const length2 = effectiveTier2Threshold(
    rule?.escort_threshold_length_ft,
    BASELINE_TWO_ESCORT_LENGTH_FT
  )
  const heightPole = effectiveThreshold(
    rule?.escort_threshold_height_ft,
    BASELINE_HEIGHT_POLE_FT
  )
  const heightPoleStrong = effectiveTier2Threshold(
    rule?.escort_threshold_height_ft,
    BASELINE_HEIGHT_POLE_STRONG_FT
  )
  const weightThreshold = rule?.escort_threshold_weight_lbs

  const triggers: string[] = []
  let escortCount: 0 | 1 | 2 = 0
  let heightPoleLevel: HeightPoleLevel = 'none'
  let requirementLevel: EscortRequirementLevel = 'none'

  if (load.width >= width1) {
    triggers.push(`width ${formatDimensionDisplay(load.width)} ≥ ${formatDimensionDisplay(width1)}`)
    escortCount = Math.max(escortCount, 1) as 0 | 1 | 2
    requirementLevel = 'may_require'
  }

  if (load.width >= width2) {
    triggers.push(
      `width ${formatDimensionDisplay(load.width)} ≥ ${formatDimensionDisplay(width2)}`
    )
    escortCount = 2
    requirementLevel = 'required'
  }

  if (load.length >= length2) {
    triggers.push(`length ${formatDimensionDisplay(load.length)} ≥ ${formatDimensionDisplay(length2)}`)
    escortCount = 2
    requirementLevel = 'required'
  }

  if (load.height >= heightPole) {
    triggers.push(`height ${formatDimensionDisplay(load.height)} ≥ ${formatDimensionDisplay(heightPole)}`)
    heightPoleLevel = 'recommended'
    escortCount = Math.max(escortCount, 1) as 0 | 1 | 2
    if (requirementLevel === 'none') requirementLevel = 'may_require'
  }

  if (load.height >= heightPoleStrong) {
    triggers.push(
      `height ${formatDimensionDisplay(load.height)} ≥ ${formatDimensionDisplay(heightPoleStrong)}`
    )
    heightPoleLevel = 'required'
    escortCount = Math.max(escortCount, 1) as 0 | 1 | 2
    // Tall loads (≥ ~15'6") typically need hard escort + height pole, not soft "may".
    requirementLevel = 'required'
  }

  if (weightThreshold != null && weightThreshold > 0 && load.weight > weightThreshold) {
    triggers.push(
      `weight ${load.weight.toLocaleString()} lbs > ${weightThreshold.toLocaleString()} lbs`
    )
    escortCount = Math.max(escortCount, 1) as 0 | 1 | 2
    if (requirementLevel === 'none') requirementLevel = 'may_require'
  }

  if (roadClassHint === 'local' && requirementLevel === 'required' && escortCount < 2) {
    requirementLevel = 'may_require'
  }

  if (escortCount === 0 && heightPoleLevel === 'none') {
    return null
  }

  const positions = defaultPositions(escortCount)
  const escortTypes: EscortVehicleType[] =
    escortCount > 0 ? ['civilian'] : []

  const detailBase = {
    stateCode,
    requirementLevel,
    escortCount,
    heightPoleLevel,
    positions,
    escortTypes,
    highwayContext,
  }

  return {
    stateCode,
    escortCount,
    heightPoleRecommended: heightPoleLevel !== 'none',
    heightPoleLevel,
    requirementLevel,
    positions,
    escortTypes,
    roadClassHint,
    highwayContext,
    warning: buildWarning(detailBase),
    triggers,
    notes:
      roadClassHint === 'local'
        ? 'City/county segments often differ from state highway rules — confirm with the issuing authority.'
        : undefined,
  }
}

function analyzeFromStructuredBands(
  stateCode: string,
  load: EscortLoadDimensions,
  structured: StructuredEscortRules,
  highwayContext: string | undefined,
  roadClassHint: RoadClassHint
): StateEscortDetail | null {
  const bands = structured.bands || []
  if (bands.length === 0) return null

  const triggers: string[] = []
  let escortCount: 0 | 1 | 2 = 0
  let requirementLevel: EscortRequirementLevel = 'none'
  let heightPoleLevel: HeightPoleLevel = 'none'
  const positionsSet = new Set<EscortPosition>()
  const typesSet = new Set<EscortVehicleType>()
  const notes: string[] = []
  let matched = false

  for (const band of bands) {
    if (!bandMatches(band, load)) continue
    matched = true
    const { when } = band
    if (when.minWidthFt != null && load.width >= when.minWidthFt) {
      triggers.push(
        `width ${formatDimensionDisplay(load.width)} ≥ ${formatDimensionDisplay(when.minWidthFt)}`
      )
    }
    if (when.minHeightFt != null && load.height >= when.minHeightFt) {
      triggers.push(
        `height ${formatDimensionDisplay(load.height)} ≥ ${formatDimensionDisplay(when.minHeightFt)}`
      )
    }
    if (when.minLengthFt != null && load.length >= when.minLengthFt) {
      triggers.push(
        `length ${formatDimensionDisplay(load.length)} ≥ ${formatDimensionDisplay(when.minLengthFt)}`
      )
    }
    if (when.minWeightLbs != null && load.weight >= when.minWeightLbs) {
      triggers.push(
        `weight ${load.weight.toLocaleString()} lbs ≥ ${when.minWeightLbs.toLocaleString()} lbs`
      )
    }

    escortCount = clampCount(Math.max(escortCount, band.count || 0))
    if (band.requirement === 'required') {
      requirementLevel = 'required'
    } else if (requirementLevel === 'none') {
      requirementLevel = 'may_require'
    }

    if (band.heightPole === 'required') {
      heightPoleLevel = 'required'
    } else if (band.heightPole === 'recommended' && heightPoleLevel === 'none') {
      heightPoleLevel = 'recommended'
    }

    for (const pos of band.positions || []) positionsSet.add(pos)
    for (const typ of band.types || []) typesSet.add(typ)
    if (band.notes) notes.push(band.notes)
  }

  if (!matched) return null

  // Tall + height-pole-required bands elevate to hard required.
  if (heightPoleLevel === 'required' && requirementLevel === 'may_require') {
    requirementLevel = 'required'
  }

  if (
    roadClassHint === 'local' &&
    requirementLevel === 'required' &&
    escortCount < 2
  ) {
    requirementLevel = 'may_require'
  }

  const positions =
    positionsSet.size > 0
      ? (Array.from(positionsSet) as EscortPosition[])
      : defaultPositions(escortCount)
  const escortTypes =
    typesSet.size > 0
      ? (Array.from(typesSet) as EscortVehicleType[])
      : escortCount > 0
        ? (['civilian'] as EscortVehicleType[])
        : []

  const detailBase = {
    stateCode,
    requirementLevel,
    escortCount,
    heightPoleLevel,
    positions,
    escortTypes,
    highwayContext,
  }

  return {
    stateCode,
    escortCount,
    heightPoleRecommended: heightPoleLevel !== 'none',
    heightPoleLevel,
    requirementLevel,
    positions,
    escortTypes,
    roadClassHint,
    highwayContext,
    warning: buildWarning(detailBase),
    triggers: [...new Set(triggers)],
    notes: notes[0] || structured.defaultNote,
  }
}

function analyzeStateEscort(
  stateCode: string,
  load: EscortLoadDimensions,
  rule: StatePermitRule | undefined,
  highwayContext: string | undefined,
  roadClassHint: RoadClassHint
): StateEscortDetail | null {
  const structured = parseStructuredRules(rule)
  if (structured?.bands && structured.bands.length > 0) {
    const fromBands = analyzeFromStructuredBands(
      stateCode,
      load,
      structured,
      highwayContext,
      roadClassHint
    )
    if (fromBands) return fromBands
  }
  return analyzeFromThresholds(stateCode, load, rule, highwayContext, roadClassHint)
}

/**
 * Evaluate escort requirements for every state in the route corridor.
 */
export function analyzeEscortRequirements(input: EscortAnalysisInput): EscortAnalysisResult {
  if (!hasValidEscortLoadDimensions(input.load)) {
    return EMPTY_RESULT
  }

  const singleState = input.routeCorridor.length === 1
  const hwy = formatHighwayContext(input.highways)
  const highwayCtx = singleState ? hwy.text : undefined
  const roadClassHint: RoadClassHint = singleState
    ? hwy.roadClassHint
    : input.highways && input.highways.length > 0
      ? formatHighwayContext(input.highways).roadClassHint
      : 'mixed'

  const escortDetails: StateEscortDetail[] = []

  for (const stateCode of input.routeCorridor) {
    const rule = input.ruleMap.get(stateCode)
    const detail = analyzeStateEscort(
      stateCode,
      input.load,
      rule,
      highwayCtx,
      singleState ? roadClassHint : 'mixed'
    )
    if (detail) {
      escortDetails.push(detail)
    }
  }

  const escortRequiredStates = escortDetails.map((d) => d.stateCode).sort()
  const escortWarnings = escortDetails.map((d) => d.warning)

  return {
    escortRequiredStates,
    escortWarnings,
    escortDetails,
  }
}
