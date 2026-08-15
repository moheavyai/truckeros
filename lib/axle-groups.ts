/**
 * lib/axle-groups.ts
 *
 * Pure axle-group assignment and scale/corridor checks for OSOW permitting.
 * Groups: steer, drives, jeep, trailer, flip, stinger.
 * Cap: 13 axles total across the combination (v1).
 */

import type { Tractor, Trailer } from '@/types/equipment'
import type { StatePermitRule } from '@/types/permit'
import { classifyTrailerRole, type TrailerRole } from '@/lib/trailer-types'

/** Max axles considered for grouping + scale checks (v1). */
export const MAX_TOTAL_AXLES = 13

export type AxleGroupType = 'steer' | 'drives' | 'jeep' | 'trailer' | 'flip' | 'stinger'

export const AXLE_GROUP_LABELS: Record<AxleGroupType, string> = {
  steer: 'Steer',
  drives: 'Drives',
  jeep: 'Jeep',
  trailer: 'Trailer',
  flip: 'Flip',
  stinger: 'Stinger',
}

export const AXLE_GROUP_ORDER: AxleGroupType[] = [
  'steer',
  'drives',
  'jeep',
  'trailer',
  'flip',
  'stinger',
]

/** Simple legal-ish defaults (lbs) by group type + axle count. Hook for state rules. */
export const DEFAULT_SINGLE_AXLE_LBS = 20_000
export const DEFAULT_STEER_AXLE_LBS = 12_000
export const DEFAULT_TANDEM_LBS = 34_000
export const DEFAULT_TRIDEM_LBS = 42_000
export const DEFAULT_QUAD_LBS = 50_000
/** Rough federal gross for 5-axle combination when no state rule present. */
export const DEFAULT_GROSS_LEGAL_LBS = 80_000
/**
 * Typical OSOW *permit* group ceilings (lbs) — not legal non-permit limits.
 * Distinguishes "needs overweight permit" from "cannot scale even under permit."
 */
export const DEFAULT_PERMIT_STEER_LBS = 18_000
export const DEFAULT_PERMIT_SINGLE_LBS = 25_000
export const DEFAULT_PERMIT_TANDEM_LBS = 46_000
export const DEFAULT_PERMIT_TRIDEM_LBS = 60_000
export const DEFAULT_PERMIT_QUAD_LBS = 72_000
/**
 * Federal tandem adjacent-spacing ceiling (inches). Adjacent axles ≤ this form a
 * tandem / close multi-axle group; any gap > this is a spread (weight-win singles).
 * Mirrors lib/axleGroupCalculator TANDEM_MAX_IN.
 */
export const TANDEM_MAX_SPACING_IN = 96

export interface AxleGroup {
  type: AxleGroupType
  /** 0-based axle indexes in the combination (front → rear). */
  axleIndexes: number[]
  axleCount: number
  label: string
  /** Equipment unit this group came from (tractor | trailer index). */
  source: 'tractor' | 'trailer'
  trailerIndex?: number
}

export interface AxleGroupSummary {
  groups: AxleGroup[]
  totalAxles: number
  capped: boolean
  /** Per-axle group type (length = totalAxles, max 13). */
  axleTypes: AxleGroupType[]
}

export type ScaleFindingSeverity = 'warning' | 'failure'

export interface ScaleFinding {
  severity: ScaleFindingSeverity
  code:
    | 'group_over'
    | 'gross_over'
    | 'unable_to_scale'
    | 'corridor_weight'
    | 'axle_cap'
    | 'info'
    | 'incomplete_weights'
  message: string
  groupType?: AxleGroupType
  stateCode?: string
}

export interface GroupWeightCheck {
  group: AxleGroup
  weightLbs: number
  limitLbs: number
  overByLbs: number
  ok: boolean
  /** False when one or more axles in the group lack usable weight data. */
  complete: boolean
}

export interface ScaleCheckInput {
  groups: AxleGroup[]
  /** Per-axle weights (lbs), front → rear. */
  axleWeights?: number[] | null
  /** Gross combination weight (lbs). */
  totalWeightLbs?: number | null
  /** Optional per-state legal/permit gross (lbs). */
  legalGrossLbs?: number | null
  stateCode?: string
}

export interface ScaleCheckResult {
  ableToScale: boolean
  groupChecks: GroupWeightCheck[]
  findings: ScaleFinding[]
  totalWeightLbs: number
  totalGroupLimitLbs: number
}

export interface CorridorScaleInput {
  groups: AxleGroup[]
  axleWeights?: number[] | null
  totalWeightLbs: number
  routeCorridor: string[]
  ruleMap: Map<string, StatePermitRule>
}

export interface CorridorScaleResult {
  /** True when every state in the corridor can carry the load under simple legal + group checks. */
  corridorOk: boolean
  /** States that fail legal gross and/or cannot scale under group limits. */
  failedStates: string[]
  findings: ScaleFinding[]
}

export interface ResolveAxleGroupsInput {
  tractor?: Partial<Tractor> | null
  trailers?: (Partial<Trailer> | null)[] | null
  /** Declared total axles when no equipment snapshot is available. */
  axles?: number | null
}

/**
 * Default group weight limit (lbs) by type + axle count.
 * Steer is tighter; multi-axle groups use tandem/tridem/quad ladders.
 */
export function defaultGroupWeightLimitLbs(
  type: AxleGroupType,
  axleCount: number
): number {
  const n = Math.max(1, Math.floor(axleCount) || 1)
  if (type === 'steer') {
    return DEFAULT_STEER_AXLE_LBS * n
  }
  if (n === 1) return DEFAULT_SINGLE_AXLE_LBS
  if (n === 2) return DEFAULT_TANDEM_LBS
  if (n === 3) return DEFAULT_TRIDEM_LBS
  if (n === 4) return DEFAULT_QUAD_LBS
  return Math.min(n * 16_000, 80_000)
}

/** Typical OSOW permit group ceiling — above legal, below structural hard-fail. */
export function defaultGroupPermitLimitLbs(
  type: AxleGroupType,
  axleCount: number
): number {
  const n = Math.max(1, Math.floor(axleCount) || 1)
  if (type === 'steer') {
    return DEFAULT_PERMIT_STEER_LBS * n
  }
  if (n === 1) return DEFAULT_PERMIT_SINGLE_LBS
  if (n === 2) return DEFAULT_PERMIT_TANDEM_LBS
  if (n === 3) return DEFAULT_PERMIT_TRIDEM_LBS
  if (n === 4) return DEFAULT_PERMIT_QUAD_LBS
  return Math.min(n * 20_000, 100_000)
}

function roleToGroupType(role: TrailerRole): AxleGroupType {
  if (role === 'jeep') return 'jeep'
  if (role === 'flip') return 'flip'
  if (role === 'stinger') return 'stinger'
  return 'trailer'
}

/**
 * Resolve axle count: missing → default; explicit 0 stays 0 (do not coerce to 2/3).
 */
export function resolveDeclaredAxleCount(
  value: unknown,
  defaultWhenMissing: number
): number {
  if (value == null || value === '') return defaultWhenMissing
  const n = Number(value)
  if (!Number.isFinite(n)) return defaultWhenMissing
  return Math.max(0, Math.floor(n))
}

/**
 * Merge consecutive groups of the same type (capacity is more conservative:
 * one 4-axle trailer group ≠ two separate tandem 34k buckets).
 */
export function mergeConsecutiveSameTypeGroups(groups: AxleGroup[]): AxleGroup[] {
  if (groups.length === 0) return []
  const merged: AxleGroup[] = []
  for (const g of groups) {
    const prev = merged[merged.length - 1]
    if (prev && prev.type === g.type) {
      prev.axleIndexes = [...prev.axleIndexes, ...g.axleIndexes]
      prev.axleCount = prev.axleIndexes.length
      // Keep first source; drop multi trailerIndex ambiguity
    } else {
      merged.push({
        ...g,
        axleIndexes: [...g.axleIndexes],
      })
    }
  }
  return merged
}

function rebuildAxleTypes(groups: AxleGroup[]): AxleGroupType[] {
  const types: AxleGroupType[] = []
  for (const g of groups) {
    for (let i = 0; i < g.axleCount; i++) types.push(g.type)
  }
  return types
}

/**
 * Assign combination axles into permitting groups from tractor + ordered trailers.
 * Caps total axles at MAX_TOTAL_AXLES (13). Merges consecutive same-type groups.
 */
export function assignAxleGroups(
  tractor: Partial<Tractor> | null | undefined,
  trailers: (Partial<Trailer> | null | undefined)[] = []
): AxleGroupSummary {
  const rawGroups: AxleGroup[] = []
  const axleTypes: AxleGroupType[] = []
  let nextIndex = 0
  let capped = false

  const pushGroup = (
    type: AxleGroupType,
    count: number,
    source: 'tractor' | 'trailer',
    trailerIndex?: number
  ) => {
    const remaining = MAX_TOTAL_AXLES - nextIndex
    if (remaining <= 0) {
      capped = true
      return
    }
    const use = Math.min(Math.max(0, Math.floor(count) || 0), remaining)
    if (use <= 0) return
    if (use < count) capped = true
    const axleIndexes: number[] = []
    for (let i = 0; i < use; i++) {
      axleIndexes.push(nextIndex)
      axleTypes.push(type)
      nextIndex += 1
    }
    rawGroups.push({
      type,
      axleIndexes,
      axleCount: use,
      label: AXLE_GROUP_LABELS[type],
      source,
      trailerIndex,
    })
  }

  // Explicit 0 must not become default 3
  const hasTractorObj = tractor != null && typeof tractor === 'object'
  const tractorAxles = hasTractorObj
    ? resolveDeclaredAxleCount(tractor?.num_axles, 3)
    : 0

  if (tractorAxles > 0) {
    pushGroup('steer', 1, 'tractor')
    if (tractorAxles > 1) {
      pushGroup('drives', tractorAxles - 1, 'tractor')
    }
  }

  const list = Array.isArray(trailers) ? trailers : []
  list.forEach((tr, trailerIndex) => {
    if (!tr) return
    const n = resolveDeclaredAxleCount(tr.num_axles, 2)
    if (n <= 0) return
    const role = classifyTrailerRole(tr.trailer_type)
    const type = roleToGroupType(role)
    pushGroup(type, n, 'trailer', trailerIndex)
  })

  const groups = mergeConsecutiveSameTypeGroups(rawGroups)
  for (const g of groups) {
    g.label = AXLE_GROUP_LABELS[g.type]
  }

  return {
    groups,
    totalAxles: nextIndex,
    capped,
    axleTypes: rebuildAxleTypes(groups),
  }
}

/**
 * Resolve groups from equipment snapshot or synthetic layout from total axle count.
 * Aligns with permit-test UI fallback: 4 axles → 3 tractor + 1 trailer; 5+ → 3 + (n-3).
 * axles <= 0 or missing → empty (no phantom 2/3-axle groups).
 */
export function resolveAxleGroupsFromConfig(input: ResolveAxleGroupsInput): AxleGroupSummary {
  const tractor = input.tractor
  const trailers = input.trailers
  if (tractor || (trailers && trailers.length > 0)) {
    return assignAxleGroups(tractor, trailers || [])
  }

  const raw = Number(input.axles)
  if (!Number.isFinite(raw) || raw <= 0) {
    return assignAxleGroups(null, [])
  }
  const n = Math.min(MAX_TOTAL_AXLES, Math.floor(raw))

  if (n === 1) return assignAxleGroups({ num_axles: 1 }, [])
  if (n === 2) return assignAxleGroups({ num_axles: 2 }, [])
  if (n === 3) return assignAxleGroups({ num_axles: 3 }, [])
  // 4+ : tractor 3 + trailer remainder (matches permit-test UI synthetic fallback)
  const tractorAxles = 3
  const trailerAxles = n - tractorAxles
  return assignAxleGroups(
    { num_axles: tractorAxles },
    [{ num_axles: trailerAxles, trailer_type: 'Flatbed' }]
  )
}

/** Lookup group type for a 0-based axle index. */
export function groupTypeForAxleIndex(
  summary: AxleGroupSummary,
  axleIndex: number
): AxleGroupType | null {
  if (axleIndex < 0 || axleIndex >= summary.axleTypes.length) return null
  return summary.axleTypes[axleIndex] ?? null
}

/**
 * Sum weights for a group's axle indexes.
 * Includes zeros and negatives so UI group totals match entered fields;
 * non-finite / missing slots count as 0.
 * (Completeness for scale checks still uses groupHasCompleteWeights — positive only.)
 */
export function sumGroupWeightLbs(
  group: AxleGroup,
  axleWeights?: number[] | null
): number {
  if (!axleWeights || axleWeights.length === 0) return 0
  let sum = 0
  for (const i of group.axleIndexes) {
    const w = Number(axleWeights[i])
    sum += Number.isFinite(w) ? w : 0
  }
  return sum
}

/**
 * Apply a group combined weight by even-split across that group's axles.
 * Remainder lbs go front→rear so the group sum matches exactly.
 * Axles outside the group are left unchanged.
 *
 * UX: always even-split (not ratio-preserving) so editing a group total is
 * predictable — "set drives to 34k" → each drive gets ~17k regardless of prior values.
 */
export function distributeWeightToGroup(
  axleWeights: number[] | null | undefined,
  group: AxleGroup,
  groupTotalLbs: number,
  totalAxles: number
): number[] {
  const n = Math.max(0, Math.floor(Number(totalAxles)) || 0)
  const arr = Array.from({ length: n }, (_, i) => {
    const w = Number(axleWeights?.[i])
    return Number.isFinite(w) ? w : 0
  })
  if (n <= 0) return arr

  const indexes = (group.axleIndexes || []).filter((i) => i >= 0 && i < n)
  if (indexes.length === 0) return arr

  const total = Math.max(0, Math.round(Number(groupTotalLbs) || 0))
  const per = Math.floor(total / indexes.length)
  let rem = total - per * indexes.length
  indexes.forEach((idx, j) => {
    arr[idx] = per + (j < rem ? 1 : 0)
  })
  return arr
}

export type GroupAxleConfigKind =
  | 'single'
  | 'tandem'
  | 'tridem'
  | 'quad'
  | 'spread'
  | 'multi'
  | 'unknown'

export interface GroupAxleConfig {
  kind: GroupAxleConfigKind
  /** Short UI phrase, e.g. "Tandem", "Spread", "Single", "Tridem". */
  label: string
  /** Longer line for hints, e.g. "Tandem drives (≤96\")". */
  detail: string
}

/**
 * Classify a role group's physical layout from adjacent within-group spacings.
 * - 1 axle → Single
 * - any known adjacent gap > 96" → Spread (partial vector OK once a spread gap is known)
 * - close multi (Tandem/Tridem/Quad/multi) only when the full gap vector is known
 *   (length === axleCount-1 and every gap > 0 and ≤ 96"). Zeros / missing = unknown —
 *   never false-label Tandem/Tridem/Quad from partial data or cross-unit 0 gaps in merged groups.
 * - 96" is still tandem (federal ≤ 96"); 96"+ε is spread
 */
export function classifyGroupAxleConfig(
  group: AxleGroup,
  withinGroupSpacingsIn?: number[] | null
): GroupAxleConfig {
  const count = Math.max(0, Math.floor(group.axleCount) || group.axleIndexes?.length || 0)
  const typeLabel = (group.label || AXLE_GROUP_LABELS[group.type] || group.type).toLowerCase()

  if (count <= 1) {
    return {
      kind: 'single',
      label: 'Single',
      detail: `Single ${typeLabel}`,
    }
  }

  const expected = count - 1
  // Preserve zeros/unknown slots — do NOT filter them out (that caused false tandem/tridem).
  const raw = Array.isArray(withinGroupSpacingsIn) ? withinGroupSpacingsIn : []
  const gaps = Array.from({ length: expected }, (_, i) => {
    const n = Number(raw[i])
    return Number.isFinite(n) && n > 0 ? n : 0
  })

  // Confident spread as soon as any known gap exceeds the tandem ceiling.
  if (gaps.some((g) => g > TANDEM_MAX_SPACING_IN)) {
    return {
      kind: 'spread',
      label: 'Spread',
      detail: `Spread ${typeLabel} axles (>${TANDEM_MAX_SPACING_IN}")`,
    }
  }

  // Close multi labels require a complete known gap vector (no zeros / missing).
  const fullyKnown = gaps.length === expected && gaps.every((g) => g > 0)
  if (!fullyKnown) {
    return {
      kind: 'unknown',
      label: `${count}-axle`,
      detail: `${count}-axle ${typeLabel} (spacing unknown)`,
    }
  }

  // All gaps known and ≤ 96"
  if (count === 2) {
    return {
      kind: 'tandem',
      label: 'Tandem',
      detail: `Tandem ${typeLabel} (≤${TANDEM_MAX_SPACING_IN}")`,
    }
  }
  if (count === 3) {
    return {
      kind: 'tridem',
      label: 'Tridem',
      detail: `Tridem ${typeLabel} (≤${TANDEM_MAX_SPACING_IN}" adjacent)`,
    }
  }
  if (count === 4) {
    return {
      kind: 'quad',
      label: 'Quad',
      detail: `Quad ${typeLabel} (≤${TANDEM_MAX_SPACING_IN}" adjacent)`,
    }
  }
  return {
    kind: 'multi',
    label: `${count}-axle close`,
    detail: `${count}-axle close ${typeLabel} (≤${TANDEM_MAX_SPACING_IN}" adjacent)`,
  }
}

/**
 * UI/display legal limit for a role group.
 * Spread configs use single×axleCount (20k×n weight-win) instead of tandem/tridem ladder.
 */
export function displayGroupWeightLimitLbs(
  group: AxleGroup,
  config?: Pick<GroupAxleConfig, 'kind'> | null
): number {
  const n = Math.max(1, Math.floor(group.axleCount) || 1)
  if (config?.kind === 'spread') {
    return DEFAULT_SINGLE_AXLE_LBS * n
  }
  return defaultGroupWeightLimitLbs(group.type, group.axleCount)
}

/**
 * Build combination-wide adjacent spacings (length totalAxles-1).
 * Cross-unit gaps (tractor→trailer, trailer→trailer) are 0 (unknown / not within-group).
 * Within-unit gaps come from tractorSpacingsIn / trailerSpacingsIn.
 */
export function buildCombinationAdjacentSpacingsIn(input: {
  totalAxles: number
  tractorAxleCount?: number | null
  tractorSpacingsIn?: number[] | null
  trailerAxleCounts?: number[] | null
  trailerSpacingsIn?: number[][] | null
}): number[] {
  const n = Math.max(0, Math.floor(Number(input.totalAxles)) || 0)
  if (n <= 1) return []

  const gaps = Array.from({ length: n - 1 }, () => 0)
  let cursor = 0

  const tractorN = Math.max(0, Math.floor(Number(input.tractorAxleCount)) || 0)
  const tSp = Array.isArray(input.tractorSpacingsIn) ? input.tractorSpacingsIn : []
  if (tractorN > 0) {
    for (let i = 0; i < tractorN - 1; i++) {
      const comboGap = cursor + i
      if (comboGap >= 0 && comboGap < gaps.length) {
        const s = Number(tSp[i])
        gaps[comboGap] = Number.isFinite(s) && s > 0 ? s : 0
      }
    }
    cursor += tractorN
  }

  const trailerCounts = Array.isArray(input.trailerAxleCounts) ? input.trailerAxleCounts : []
  const trSpAll = Array.isArray(input.trailerSpacingsIn) ? input.trailerSpacingsIn : []
  for (let ti = 0; ti < trailerCounts.length; ti++) {
    const trN = Math.max(0, Math.floor(Number(trailerCounts[ti])) || 0)
    if (trN <= 0) continue
    // Cross-unit gap at cursor-1 (if any) stays 0
    const trSp = Array.isArray(trSpAll[ti]) ? trSpAll[ti]! : []
    for (let i = 0; i < trN - 1; i++) {
      const comboGap = cursor + i
      if (comboGap >= 0 && comboGap < gaps.length) {
        const s = Number(trSp[i])
        gaps[comboGap] = Number.isFinite(s) && s > 0 ? s : 0
      }
    }
    cursor += trN
  }

  return gaps
}

/**
 * Adjacent spacings strictly inside a role group (length axleCount-1), using
 * combination-wide gap array. Non-consecutive indexes yield 0 for that pair.
 */
export function withinGroupSpacingsFromCombination(
  group: AxleGroup,
  combinationAdjacentSpacingsIn?: number[] | null
): number[] {
  const indexes = [...(group.axleIndexes || [])].filter((i) => i >= 0).sort((a, b) => a - b)
  if (indexes.length <= 1) return []
  const comb = Array.isArray(combinationAdjacentSpacingsIn)
    ? combinationAdjacentSpacingsIn
    : []
  const out: number[] = []
  for (let k = 0; k < indexes.length - 1; k++) {
    const a = indexes[k]
    const b = indexes[k + 1]
    if (b === a + 1 && a < comb.length) {
      const s = Number(comb[a])
      out.push(Number.isFinite(s) && s > 0 ? s : 0)
    } else {
      out.push(0)
    }
  }
  return out
}

/** True when every axle index in the group has a positive finite weight. */
export function groupHasCompleteWeights(
  group: AxleGroup,
  axleWeights?: number[] | null
): boolean {
  if (!axleWeights || axleWeights.length === 0) return false
  return group.axleIndexes.every((i) => {
    const w = Number(axleWeights[i])
    return Number.isFinite(w) && w > 0
  })
}

/**
 * Distribute total weight across axles proportional to each group's legal capacity.
 * Avoids flat even-split overloading steer (12k) on a legal 80k 5-axle load.
 * Used for synthetic scale estimates when no axle weights are entered.
 */
export function distributeWeightByGroupLimits(
  groups: AxleGroup[],
  totalWeightLbs: number
): number[] {
  const totalAxles = groups.reduce((s, g) => s + g.axleCount, 0)
  if (totalAxles <= 0 || !(totalWeightLbs > 0)) {
    return Array.from({ length: Math.max(0, totalAxles) }, () => 0)
  }

  const limits = groups.map((g) => defaultGroupWeightLimitLbs(g.type, g.axleCount))
  const capacity = limits.reduce((a, b) => a + b, 0) || 1

  const weights: number[] = Array.from({ length: totalAxles }, () => 0)
  let assigned = 0

  groups.forEach((group, gi) => {
    const share =
      gi === groups.length - 1
        ? Math.max(0, Math.round(totalWeightLbs) - assigned)
        : Math.round((limits[gi] / capacity) * totalWeightLbs)
    assigned += share
    // Split group share evenly across axles in the group
    const perAxle = Math.floor(share / group.axleCount)
    let rem = share - perAxle * group.axleCount
    group.axleIndexes.forEach((idx, j) => {
      weights[idx] = perAxle + (j < rem ? 1 : 0)
    })
  })

  // Fix rounding drift on last axle
  const sum = weights.reduce((a, b) => a + b, 0)
  const drift = Math.round(totalWeightLbs) - sum
  if (drift !== 0 && weights.length > 0) {
    weights[weights.length - 1] = Math.max(0, weights[weights.length - 1] + drift)
  }

  return weights
}

/**
 * Default form / "Distribute Evenly" distribution:
 * fix steer at DEFAULT_STEER_AXLE_LBS (12,000) combined, then even-split the
 * remainder over all non-steer axles.
 *
 * Example: gross 80,000, 5 axles → [12_000, 17_000, 17_000, 17_000, 17_000].
 *
 * Multiple steer axles (rare): 12k combined is split evenly across the steer
 * group, not 12k per steer axle.
 *
 * Edge cases (never negative):
 * - totalAxles ≤ 0 or weight ≤ 0 → empty / zeros
 * - total under 12k → all weight on steer; non-steer 0
 * - only steer axles (no remainder slots) → all weight on steer
 * - no steer group (e.g. trailer-only) → even-split across all axles
 * - when `groups` is omitted, axle 0 is treated as the sole steer axle
 */
export function distributeWeightSteerFirst(
  totalAxles: number,
  totalWeightLbs: number,
  groups?: AxleGroup[] | null
): number[] {
  const n = Math.max(0, Math.floor(Number(totalAxles)) || 0)
  if (n <= 0) return []

  const total = Math.max(0, Math.round(Number(totalWeightLbs) || 0))
  if (!(total > 0)) return Array.from({ length: n }, () => 0)

  let steerIndexes: number[] = []
  if (groups && groups.length > 0) {
    const steer = groups.find((g) => g.type === 'steer')
    if (steer) {
      steerIndexes = steer.axleIndexes.filter((i) => i >= 0 && i < n)
    }
  } else {
    // No group layout: assume first axle is steer (standard tractor layout).
    steerIndexes = [0]
  }

  const weights: number[] = Array.from({ length: n }, () => 0)
  const restIndexes = Array.from({ length: n }, (_, i) => i).filter(
    (i) => !steerIndexes.includes(i)
  )

  const splitEven = (indexes: number[], amount: number) => {
    if (indexes.length === 0 || amount <= 0) return
    const per = Math.floor(amount / indexes.length)
    let rem = amount - per * indexes.length
    indexes.forEach((idx, j) => {
      weights[idx] = per + (j < rem ? 1 : 0)
    })
  }

  // No steer group (trailer-only etc.) → even-split all axles.
  if (steerIndexes.length === 0) {
    splitEven(
      Array.from({ length: n }, (_, i) => i),
      total
    )
    return weights
  }

  // Only steer axles → put entire gross on steer group.
  if (restIndexes.length === 0) {
    splitEven(steerIndexes, total)
    return weights
  }

  const steerTarget = Math.min(DEFAULT_STEER_AXLE_LBS, total)
  const remaining = total - steerTarget
  splitEven(steerIndexes, steerTarget)
  splitEven(restIndexes, remaining)

  // Fix rounding drift on last non-steer axle.
  const sum = weights.reduce((a, b) => a + b, 0)
  const drift = total - sum
  if (drift !== 0 && restIndexes.length > 0) {
    const last = restIndexes[restIndexes.length - 1]
    weights[last] = Math.max(0, weights[last] + drift)
  }

  return weights
}

/**
 * Check whether the rig can scale the proposed load under simple group limits.
 *
 * Weight resolution:
 * - No usable per-axle weights → group-capacity-proportional distribute of total (not flat even).
 * - Partial weights → only enforce group_over on groups with complete axle data; warn incomplete.
 * - Full weights → check all groups as provided.
 */
export function checkScaleAbility(input: ScaleCheckInput): ScaleCheckResult {
  const { groups } = input
  const findings: ScaleFinding[] = []
  const totalAxles = groups.reduce((s, g) => s + g.axleCount, 0)

  const rawWeights = Array.isArray(input.axleWeights)
    ? input.axleWeights.map((w) => (Number.isFinite(Number(w)) ? Number(w) : 0))
    : []

  const usableCount = rawWeights
    .slice(0, totalAxles)
    .filter((w) => Number.isFinite(w) && w > 0).length
  const weightFromAxles = rawWeights.slice(0, totalAxles).reduce((a, b) => a + (b > 0 ? b : 0), 0)

  const totalWeightLbs =
    Number(input.totalWeightLbs) > 0
      ? Number(input.totalWeightLbs)
      : weightFromAxles

  let axleWeights: number[] = rawWeights.slice(0, Math.max(totalAxles, rawWeights.length))
  let usedSynthetic = false
  let incomplete = false

  if (totalAxles > 0 && totalWeightLbs > 0) {
    if (usableCount === 0) {
      // No usable axle weights → capacity-proportional distribute (avoids steer false fail)
      axleWeights = distributeWeightByGroupLimits(groups, totalWeightLbs)
      usedSynthetic = true
    } else if (usableCount < totalAxles) {
      // Partial: do not invent weights for missing slots for group_over;
      // leave zeros so incomplete groups skip hard group checks.
      incomplete = true
      while (axleWeights.length < totalAxles) axleWeights.push(0)
    } else {
      // Full set present — use as-is (pad if needed)
      while (axleWeights.length < totalAxles) axleWeights.push(0)
    }
  }

  if (incomplete) {
    findings.push({
      severity: 'warning',
      code: 'incomplete_weights',
      stateCode: input.stateCode,
      message:
        'Incomplete axle weight data — only groups with all axle weights entered are checked for group overloads. Enter all axle weights or clear them to use a capacity-proportional estimate.',
    })
  }

  const groupChecks: GroupWeightCheck[] = groups.map((group) => {
    const complete = usedSynthetic || groupHasCompleteWeights(group, axleWeights)
    const weightLbs = sumGroupWeightLbs(group, axleWeights)
    const limitLbs = defaultGroupWeightLimitLbs(group.type, group.axleCount)
    const overByLbs = complete ? Math.max(0, weightLbs - limitLbs) : 0
    return {
      group,
      weightLbs,
      limitLbs,
      overByLbs,
      ok: !complete || overByLbs <= 0,
      complete,
    }
  })

  const totalGroupLimitLbs = groupChecks.reduce((s, c) => s + c.limitLbs, 0)

  const totalPermitLimitLbs = groups.reduce(
    (s, g) => s + defaultGroupPermitLimitLbs(g.type, g.axleCount),
    0
  )

  for (const check of groupChecks) {
    if (!(check.complete && check.weightLbs > 0 && !check.ok)) continue

    const permitLimit = defaultGroupPermitLimitLbs(
      check.group.type,
      check.group.axleCount
    )
    const overLegal = Math.round(check.overByLbs)
    const label = `${check.group.label} group (${check.group.axleCount} axle${
      check.group.axleCount === 1 ? '' : 's'
    }) at ${Math.round(check.weightLbs).toLocaleString()} lbs`

    if (check.weightLbs > permitLimit) {
      findings.push({
        severity: 'failure',
        code: 'group_over',
        groupType: check.group.type,
        stateCode: input.stateCode,
        message: `${label} exceeds typical OSOW permit group ceiling of ${permitLimit.toLocaleString()} lbs by ${Math.round(check.weightLbs - permitLimit).toLocaleString()} lbs — add axles (jeep / flip / stinger) or reduce group load.`,
      })
    } else {
      findings.push({
        severity: 'warning',
        code: 'group_over',
        groupType: check.group.type,
        stateCode: input.stateCode,
        message: `${label} exceeds non-permit legal limit of ${check.limitLbs.toLocaleString()} lbs by ${overLegal.toLocaleString()} lbs — overweight permit path (typical permit ceiling ≈ ${permitLimit.toLocaleString()} lbs). Confirm axle spacing / bridge formula with the issuing state.`,
      })
    }
  }

  const legalGross =
    input.legalGrossLbs != null && Number(input.legalGrossLbs) > 0
      ? Number(input.legalGrossLbs)
      : null

  if (legalGross != null && totalWeightLbs > legalGross) {
    findings.push({
      severity: 'warning',
      code: 'gross_over',
      stateCode: input.stateCode,
      message: `Gross weight ${Math.round(totalWeightLbs).toLocaleString()} lbs exceeds non-permit legal/threshold ${legalGross.toLocaleString()} lbs${input.stateCode ? ` (${input.stateCode})` : ''} — overweight permit required; verify group distribution and bridge formula.`,
    })
  }

  if (totalWeightLbs > 0 && totalPermitLimitLbs > 0 && totalWeightLbs > totalPermitLimitLbs) {
    if (!findings.some((f) => f.code === 'unable_to_scale')) {
      findings.push({
        severity: 'failure',
        code: 'unable_to_scale',
        stateCode: input.stateCode,
        message: `Rig cannot scale ${Math.round(totalWeightLbs).toLocaleString()} lbs — combined typical OSOW permit group capacity ≈ ${totalPermitLimitLbs.toLocaleString()} lbs. Add axles (jeep / flip / stinger) or reduce load weight.`,
      })
    }
  } else if (
    totalWeightLbs > 0 &&
    totalGroupLimitLbs > 0 &&
    totalWeightLbs > totalGroupLimitLbs &&
    !findings.some((f) => f.code === 'unable_to_scale' || f.code === 'gross_over')
  ) {
    findings.push({
      severity: 'warning',
      code: 'corridor_weight',
      stateCode: input.stateCode,
      message: `Gross ${Math.round(totalWeightLbs).toLocaleString()} lbs exceeds combined non-permit group capacity ≈ ${totalGroupLimitLbs.toLocaleString()} lbs — overweight permit path on this axle configuration (permit capacity ≈ ${totalPermitLimitLbs.toLocaleString()} lbs).`,
    })
  }

  if (totalAxles >= MAX_TOTAL_AXLES) {
    findings.push({
      severity: 'warning',
      code: 'axle_cap',
      message: `Combination is at the v1 axle cap (${MAX_TOTAL_AXLES}). Additional axles are not modeled for grouping.`,
    })
  }

  const hardFails = findings.filter((f) => f.severity === 'failure')
  return {
    ableToScale: hardFails.length === 0,
    groupChecks,
    findings,
    totalWeightLbs,
    totalGroupLimitLbs,
  }
}

/** Normalize rule map keys to uppercase for consistent corridor lookups. */
export function normalizeRuleMapKeys(
  ruleMap: Map<string, StatePermitRule>
): Map<string, StatePermitRule> {
  const out = new Map<string, StatePermitRule>()
  for (const [k, v] of ruleMap.entries()) {
    out.set(String(k).toUpperCase().trim(), v)
  }
  return out
}

/**
 * Per-state corridor scale check using state_permit_rules legal/permit weight
 * plus group-level simple limits (v1 — not full state axle charts).
 *
 * Config-level failures (group_over / unable_to_scale) are reported once from the
 * base check, not re-listed identically for every corridor state. States still land
 * in failedStates so permit flags can fire. OR-Tools enrich attaches fields but does
 * not recalculate cost (intentional v1).
 */
export function checkCorridorScale(input: CorridorScaleInput): CorridorScaleResult {
  const findings: ScaleFinding[] = []
  const failedStates: string[] = []
  const corridor = (input.routeCorridor || [])
    .map((s) => String(s).toUpperCase().trim())
    .filter(Boolean)
  const ruleMap = normalizeRuleMapKeys(input.ruleMap)

  const base = checkScaleAbility({
    groups: input.groups,
    axleWeights: input.axleWeights,
    totalWeightLbs: input.totalWeightLbs,
  })
  for (const f of base.findings) {
    if (f.code !== 'gross_over') findings.push(f)
  }

  const baseConfigFail = base.findings.some(
    (f) => f.severity === 'failure' && (f.code === 'unable_to_scale' || f.code === 'group_over')
  )
  const configFailStates: string[] = []

  for (const state of corridor) {
    const rule = ruleMap.get(state)
    let legalGross =
      rule?.permit_threshold_weight_lbs ??
      rule?.legal_weight_lbs ??
      DEFAULT_GROSS_LEGAL_LBS
    if (legalGross == null || legalGross <= 0 || Number.isNaN(legalGross)) {
      legalGross = DEFAULT_GROSS_LEGAL_LBS
    }

    const stateCheck = checkScaleAbility({
      groups: input.groups,
      axleWeights: input.axleWeights,
      totalWeightLbs: input.totalWeightLbs,
      legalGrossLbs: legalGross,
      stateCode: state,
    })

    const grossFail = stateCheck.findings.find((f) => f.code === 'gross_over')
    const unable = stateCheck.findings.find(
      (f) => f.code === 'unable_to_scale' && f.severity === 'failure'
    )
    const groupHardFail = stateCheck.findings.find(
      (f) => f.code === 'group_over' && f.severity === 'failure'
    )
    const groupSoft = stateCheck.findings.find(
      (f) => f.code === 'group_over' && f.severity === 'warning'
    )

    if (unable || groupHardFail) {
      if (!failedStates.includes(state)) failedStates.push(state)
      if (!configFailStates.includes(state)) configFailStates.push(state)
    } else if (grossFail || groupSoft) {
      findings.push({
        severity: 'warning',
        code: 'corridor_weight',
        stateCode: state,
        message: `${state}: exceeds non-permit legal weight limits — overweight permit path; verify axle-group distribution and bridge formula (not a hard scale fail under typical OSOW ceilings).`,
      })
    }
  }

  if (configFailStates.length > 0) {
    findings.push({
      severity: 'failure',
      code: 'corridor_weight',
      message: baseConfigFail
        ? `Corridor states with hard scale limits exceeded: ${configFailStates.join(', ')}. See scale findings above (typical OSOW permit ceilings — not full state axle-law charts).`
        : `Corridor states with hard scale limits exceeded: ${configFailStates.join(', ')}.`,
    })
  }

  const seen = new Set<string>()
  const deduped = findings.filter((f) => {
    const key = `${f.code}|${f.stateCode || ''}|${f.message}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  return {
    corridorOk: failedStates.length === 0 && base.ableToScale,
    failedStates,
    findings: deduped,
  }
}

/** Compact one-line summary for UI / agent notes. */
export function formatAxleGroupSummaryLine(summary: AxleGroupSummary): string {
  if (summary.groups.length === 0) return 'No axles configured'
  const parts = summary.groups.map((g) => `${g.label}×${g.axleCount}`)
  return `${summary.totalAxles} axles: ${parts.join(' · ')}${summary.capped ? ` (capped at ${MAX_TOTAL_AXLES})` : ''}`
}

/**
 * Compact axle geometry + role groups for permit equipment snapshots / prefill.
 * Role groups come from assignAxleGroups; spacings + lift flags come from equipment.
 */
export interface RigAxleSnapshotData {
  groups: AxleGroupSummary
  groupLine: string
  totalAxles: number
  /** Tractor inter-axle spacings (inches), 1-2, 2-3, … */
  tractorSpacingsIn: number[]
  /** Per-trailer inter-axle spacings (inches). */
  trailerSpacingsIn: number[][]
  /** Per-trailer kingpin (or rear pin) → first axle (inches). */
  kingpinToFirstAxleIn: (number | null)[]
  /** Per-trailer has_lift_axle flags. */
  trailerHasLiftAxle: boolean[]
}

/**
 * Parse axle spacing arrays preserving index slots (1-2, 2-3, …).
 * - Non-positive / NaN slots become 0 (empty), not dropped.
 * - Never compact middle zeros (that would shift later gap labels).
 * - Trailing zeros are stripped unless `expectedLength` is provided (then pad/truncate).
 */
export function normalizeAxleSpacingSlots(
  input: unknown,
  expectedLength?: number | null
): number[] {
  let raw: number[] = []
  if (input == null || input === '') {
    raw = []
  } else if (typeof input === 'string') {
    raw = input.split(',').map((s) => {
      const n = parseFloat(s.trim())
      return Number.isFinite(n) && n > 0 ? n : 0
    })
  } else if (Array.isArray(input)) {
    raw = input.map((x) => {
      const n = Number(x)
      if (Number.isFinite(n) && n > 0) return n
      // Legacy string entries inside arrays
      const p = parseFloat(String(x ?? '').trim())
      return Number.isFinite(p) && p > 0 ? p : 0
    })
  } else {
    return []
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
 * Build axle-group + spacing snapshot from a selected tractor/trailer combination.
 * Safe for partial equipment (missing spacings → empty arrays).
 * Spacings preserve index slots (zeros for cleared gaps).
 */
export function buildRigAxleSnapshot(
  tractor?: Partial<Tractor> | null,
  trailers?: (Partial<Trailer> | null | undefined)[] | null
): RigAxleSnapshotData {
  const list = Array.isArray(trailers) ? trailers.filter(Boolean) as Partial<Trailer>[] : []
  const groups = assignAxleGroups(tractor, list)
  const tractorGaps =
    tractor?.num_axles != null
      ? Math.max(0, Math.floor(Number(tractor.num_axles)) - 1)
      : null
  return {
    groups,
    groupLine: formatAxleGroupSummaryLine(groups),
    totalAxles: groups.totalAxles,
    tractorSpacingsIn: normalizeAxleSpacingSlots(tractor?.axle_spacings, tractorGaps),
    trailerSpacingsIn: list.map((tr) => {
      const gaps =
        tr.num_axles != null ? Math.max(0, Math.floor(Number(tr.num_axles)) - 1) : null
      return normalizeAxleSpacingSlots(tr.axle_spacings, gaps)
    }),
    kingpinToFirstAxleIn: list.map((tr) => {
      const n = Number(tr.kingpin_to_first_axle_in)
      return Number.isFinite(n) && n > 0 ? n : null
    }),
    trailerHasLiftAxle: list.map((tr) => !!tr.has_lift_axle),
  }
}

/**
 * Build scale findings text lines for agent reasons/notes.
 * State-scoped failures are prefixed `${state}:` so per-state permit cards pick them up.
 */
export function formatScaleFindingsForAgent(findings: ScaleFinding[]): {
  reasons: string[]
  notes: string[]
} {
  const reasons: string[] = []
  const notes: string[] = []
  for (const f of findings) {
    const statePrefix =
      f.stateCode && !f.message.startsWith(`${f.stateCode}:`)
        ? `${f.stateCode}: `
        : ''
    if (f.severity === 'failure') {
      // Prefer state-prefixed form for UI card matching (`r.startsWith(`${state}:`)`)
      if (f.stateCode) {
        reasons.push(`${f.stateCode}: SCALE HARD LIMIT: ${f.message.replace(new RegExp(`^${f.stateCode}:\\s*`), '')}`)
      } else {
        reasons.push(`SCALE HARD LIMIT: ${f.message}`)
      }
    } else {
      notes.push(`${statePrefix}OVERWEIGHT PERMIT: ${f.message.replace(new RegExp(`^${f.stateCode}:\\s*`), '')}`)
    }
  }
  return { reasons, notes }
}

/**
 * Attach scale / axle-group fields onto a route option (analyze-permit + OR-Tools enrich).
 */
export function attachScaleFieldsToOption<T extends Record<string, unknown>>(
  option: T,
  input: {
    groups: AxleGroup[]
    axleWeights?: number[] | null
    totalWeightLbs: number
    routeCorridor?: string[]
    ruleMap?: Map<string, StatePermitRule>
    summary?: AxleGroupSummary
  }
): T & {
  axleGroupSummary: string
  axleGroups: AxleGroupSummary
  scaleFindings: ScaleFinding[]
  corridorScaleFailedStates: string[]
  unableToScale: boolean
} {
  const summary: AxleGroupSummary =
    input.summary ||
    ({
      groups: input.groups,
      totalAxles: input.groups.reduce((s, g) => s + g.axleCount, 0),
      capped: false,
      axleTypes: rebuildAxleTypes(input.groups),
    } as AxleGroupSummary)

  const corridorScale = checkCorridorScale({
    groups: input.groups,
    axleWeights: input.axleWeights,
    totalWeightLbs: input.totalWeightLbs,
    routeCorridor: input.routeCorridor || (option.routeCorridor as string[]) || [],
    ruleMap: input.ruleMap || new Map(),
  })

  const unableToScale = corridorScale.findings.some(
    (f) => f.severity === 'failure' && (f.code === 'unable_to_scale' || f.code === 'group_over')
  )

  const existingNotes = Array.isArray(option.notes) ? ([...option.notes] as string[]) : []
  const existingReasons = Array.isArray(option.reasons) ? ([...option.reasons] as string[]) : []
  const scaleLines = formatScaleFindingsForAgent(corridorScale.findings)
  for (const r of scaleLines.reasons) {
    if (!existingReasons.includes(r)) existingReasons.push(r)
  }
  for (const n of scaleLines.notes) {
    if (!existingNotes.includes(n)) existingNotes.push(n)
  }
  if (summary.totalAxles > 0) {
    const line = `Axle groups: ${formatAxleGroupSummaryLine(summary)}`
    if (!existingNotes.includes(line)) existingNotes.push(line)
  }
  if (unableToScale) {
    const line =
      'Hard scale limit exceeded on the current axle-group configuration — add axles or reduce weight (beyond typical OSOW permit group ceilings).'
    if (!existingNotes.includes(line)) existingNotes.push(line)
  } else if (
    corridorScale.findings.some(
      (f) =>
        f.severity === 'warning' &&
        (f.code === 'group_over' || f.code === 'gross_over' || f.code === 'corridor_weight')
    )
  ) {
    const line =
      'Exceeds non-permit legal axle/gross limits — overweight permit path on this configuration (typically allowable; confirm spacing / bridge formula per state).'
    if (!existingNotes.includes(line)) existingNotes.push(line)
  }
  if (corridorScale.failedStates.length > 0) {
    const line = `Corridor hard scale limit exceeded in: ${corridorScale.failedStates.join(', ')}.`
    if (!existingNotes.includes(line)) existingNotes.push(line)
    for (const st of corridorScale.failedStates) {
      const cardLine = `${st}: SCALE HARD LIMIT: exceeds typical OSOW permit group ceilings (see Scale & Axle Groups)`
      if (!existingReasons.includes(cardLine)) existingReasons.push(cardLine)
    }
  }

  return {
    ...option,
    notes: existingNotes,
    reasons: existingReasons,
    axleGroupSummary: formatAxleGroupSummaryLine(summary),
    axleGroups: summary,
    scaleFindings: corridorScale.findings,
    corridorScaleFailedStates: corridorScale.failedStates,
    unableToScale,
  }
}
