/**
 * lib/escort-analysis.ts
 *
 * Per-state escort requirement analysis using state_permit_rules + baseline thresholds.
 */

import { formatDimensionDisplay } from '@/lib/parse-dimension'
import type { StatePermitRule } from '@/types/permit'

/** Baseline thresholds when a state rule omits escort columns. */
export const BASELINE_ONE_ESCORT_WIDTH_FT = 12.0 // 12'0"
export const BASELINE_TWO_ESCORT_WIDTH_FT = 14.0 // 14'0"
export const BASELINE_TWO_ESCORT_LENGTH_FT = 110.0
export const BASELINE_HEIGHT_POLE_FT = 14.5 // 14'6"
export const BASELINE_HEIGHT_POLE_STRONG_FT = 15.5 // 15'6"

export interface EscortLoadDimensions {
  width: number
  length: number
  height: number
  weight: number
}

export interface StateEscortDetail {
  stateCode: string
  /** 2 means "2+ escorts". */
  escortCount: 0 | 1 | 2
  heightPoleRecommended: boolean
  highwayContext?: string
  warning: string
  triggers: string[]
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

/** True when all load dimensions are finite positive numbers. */
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

/** Tier-2 / strong checks: use baseline when state column is null; otherwise max(state, baseline). */
function effectiveTier2Threshold(
  ruleValue: number | null | undefined,
  baseline: number
): number {
  if (ruleValue == null || ruleValue <= 0 || Number.isNaN(ruleValue)) {
    return baseline
  }
  return Math.max(ruleValue, baseline)
}

function formatHighwayContext(highways?: string[]): string | undefined {
  if (!highways || highways.length === 0) {
    return 'local/non-interstate segments — confirm escorts with state DOT'
  }

  const majors = highways
    .map((h) => h.split(' (')[0].trim())
    .filter((h) => /^I-|^US /i.test(h))
    .slice(0, 3)

  if (majors.length === 0) {
    return 'may include local roads — confirm escorts with state DOT'
  }

  return `on ${majors.join(', ')}`
}

function analyzeStateEscort(
  stateCode: string,
  load: EscortLoadDimensions,
  rule: StatePermitRule | undefined,
  highwayContext?: string
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
  let heightPoleRecommended = false

  if (load.width >= width1) {
    triggers.push(`width ${formatDimensionDisplay(load.width)} ≥ ${formatDimensionDisplay(width1)}`)
    escortCount = Math.max(escortCount, 1) as 0 | 1 | 2
  }

  if (load.width >= width2) {
    triggers.push(
      `width ${formatDimensionDisplay(load.width)} ≥ ${formatDimensionDisplay(width2)}`
    )
    escortCount = 2
  }

  if (load.length >= length2) {
    triggers.push(`length ${formatDimensionDisplay(load.length)} ≥ ${formatDimensionDisplay(length2)}`)
    escortCount = 2
  }

  if (load.height >= heightPole) {
    triggers.push(`height ${formatDimensionDisplay(load.height)} ≥ ${formatDimensionDisplay(heightPole)}`)
    heightPoleRecommended = true
    escortCount = Math.max(escortCount, 1) as 0 | 1 | 2
  }

  if (load.height >= heightPoleStrong) {
    triggers.push(
      `height ${formatDimensionDisplay(load.height)} ≥ ${formatDimensionDisplay(heightPoleStrong)}`
    )
    heightPoleRecommended = true
    escortCount = Math.max(escortCount, 1) as 0 | 1 | 2
  }

  if (weightThreshold != null && weightThreshold > 0 && load.weight > weightThreshold) {
    triggers.push(
      `weight ${load.weight.toLocaleString()} lbs > ${weightThreshold.toLocaleString()} lbs`
    )
    escortCount = Math.max(escortCount, 1) as 0 | 1 | 2
  }

  if (escortCount === 0 && !heightPoleRecommended) {
    return null
  }

  const parts: string[] = []
  if (escortCount === 2) {
    parts.push('2+ escorts required')
  } else if (escortCount === 1) {
    parts.push('1 escort recommended')
  }
  if (heightPoleRecommended) {
    parts.push('height pole recommended')
  }

  let warning = `${stateCode}: ${parts.join(' + ')}`
  if (highwayContext) {
    warning += ` (${highwayContext})`
  }

  return {
    stateCode,
    escortCount,
    heightPoleRecommended,
    highwayContext,
    warning,
    triggers,
  }
}

/**
 * Evaluate escort requirements for every state in the route corridor.
 */
export function analyzeEscortRequirements(input: EscortAnalysisInput): EscortAnalysisResult {
  if (!hasValidEscortLoadDimensions(input.load)) {
    return EMPTY_RESULT
  }

  // Route-wide highway suffix is misleading on multi-state corridors; omit unless single-state.
  const highwayCtx =
    input.routeCorridor.length === 1
      ? formatHighwayContext(input.highways)
      : undefined

  const escortDetails: StateEscortDetail[] = []

  for (const stateCode of input.routeCorridor) {
    const rule = input.ruleMap.get(stateCode)
    const detail = analyzeStateEscort(stateCode, input.load, rule, highwayCtx)
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