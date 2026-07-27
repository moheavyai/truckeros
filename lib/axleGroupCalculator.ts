/**
 * lib/axleGroupCalculator.ts
 *
 * Spacing-based federal / state axle GROUP optimizer for OSOW owner-operators.
 *
 * THIS IS NOT lib/axle-groups.ts
 * - axle-groups.ts: equipment ROLE groups (steer / drives / jeep / trailer / flip / stinger)
 * - this module: physical spacing groups (single / tandem / tridem / quad / spread)
 *   using federal tandem definitions + optional state span/cap overrides.
 *
 * Key federal spacing rules (inches between axle centers):
 * - ≤ 40"            → treated as one single axle group (default 20,000 lbs)
 * - > 40" and ≤ 96"  → tandem group (default 34,000 lbs Interstate)
 * - > 96"            → spread: two separate singles (20k + 20k = 40k "weight win")
 *
 * Multi-axle outer span (first→last of the group):
 * - Tridem: 3 axles, outer span > 96" and ≤ state tridem_max_span (MO 144", KS ~132")
 * - Quad:   4 axles, outer span ≤ state quad_max_span (MO 192")
 *
 * Federal Bridge Formula (2+ consecutive axles in a group):
 *   W = 500 * [ (L * N) / (N - 1) + 12 * N + 36 ]
 *   where L = outer span in FEET, N = number of axles
 *
 * Compliance:
 * - green  → group load ≤ max_legal_lbs
 * - yellow → max_legal_lbs < load ≤ max_permitted_lbs (likely needs OSOW permit)
 * - red    → load > max_permitted_lbs (or missing critical spacing)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AxlePhysicalType = 'steer' | 'drive' | 'trailer' | 'lift'

export type SpacingGroupType = 'single' | 'tandem' | 'tridem' | 'quad' | 'spread'

export type ComplianceStatus = 'green' | 'yellow' | 'red'

export interface AxleInput {
  id: string
  /** Center-line position from a fixed reference (front bumper / steer), inches. */
  position_inches: number
  type: AxlePhysicalType
  tire_count?: number | null
  /** Current scale weight on this axle (lbs). 0 is allowed (empty / unknown). */
  current_load_lbs: number
  /** When true (lift axles), axle is ignored for grouping + weight unless forced. */
  lifted?: boolean
}

export interface StateAxleRule {
  /** Single axle legal cap (lbs). Default 20,000. */
  single_cap_lbs: number
  /** Tandem legal cap (lbs). Default 34,000 Interstate. */
  tandem_cap_lbs: number
  /** Tridem legal cap (lbs). */
  tridem_cap_lbs: number
  /** Quad legal cap (lbs). */
  quad_cap_lbs: number
  /** Max outer span (inches) for a legal tridem group. */
  tridem_max_span_in: number
  /** Max outer span (inches) for a legal quad group. */
  quad_max_span_in: number
  /**
   * Soft OSOW / permit ceiling per group type (lbs). When omitted, derived as
   * ~1.25× legal for multi-axle groups (pragmatic placeholder until state permit tables wire in).
   */
  single_permit_lbs?: number
  tandem_permit_lbs?: number
  tridem_permit_lbs?: number
  quad_permit_lbs?: number
  /** Human-readable state notes (span exceptions, seasonal, etc.). */
  notes?: string
}

export type StateRulesMap = Record<string, StateAxleRule>

export interface BridgeFormulaResult {
  /** Outer span used (feet). */
  L_ft: number
  /** Number of axles N. */
  N: number
  /** Computed max weight W (lbs), floored to integer. */
  W_lbs: number
  /** Raw formula string for tooltips / permit JSON. */
  formula: string
  /** False when N < 2 (formula not applicable). */
  applicable: boolean
}

export interface SpacingAxleGroup {
  id: string
  type: SpacingGroupType
  /** Axle ids in front→rear order. */
  axle_ids: string[]
  /** Axle indexes into the sorted (active) axle list. */
  axle_indexes: number[]
  /** Outer span inches (0 for true single). */
  outer_span_inches: number
  /** Sum of current_load_lbs on member axles. */
  current_load_lbs: number
  /** Min of state group cap and bridge formula (when applicable). */
  max_legal_lbs: number
  /** Higher OSOW/permit soft cap for yellow band. */
  max_permitted_lbs: number
  compliance_status: ComplianceStatus
  bridge_formula: BridgeFormulaResult | null
  /** State code that produced the tightest legal limit (when multi-state). */
  limiting_state?: string
  optimization_tips: string[]
}

/** One consecutive axle sub-span checked against the Federal Bridge Formula. */
export interface BridgeWindowResult {
  /** Inclusive start index into sorted active axles. */
  start_index: number
  /** Inclusive end index into sorted active axles. */
  end_index: number
  axle_ids: string[]
  outer_span_inches: number
  load_lbs: number
  bridge: BridgeFormulaResult
  /** Soft yellow band (~1.25× bridge W) — planner estimate only, not an official permit limit. */
  soft_permit_lbs: number
  compliance_status: ComplianceStatus
}

export interface AxleGroupAnalysis {
  groups: SpacingAxleGroup[]
  /** Gross vehicle / combination weight from axle loads. */
  gvw_lbs: number
  /** Sum of per-group max_legal_lbs (informational; can overstate true combination limit). */
  total_group_legal_lbs: number
  total_group_permitted_lbs: number
  /**
   * Combination-level legal ceiling: min(federal gross 80k, full-span bridge when N≥2).
   * Prefer this over summing group legals for GVW compliance.
   */
  gross_legal_lbs: number
  /**
   * Soft permit band on combination (~1.25× gross_legal).
   * Planner estimate only — not an official state permit limit.
   */
  gross_permitted_lbs: number
  /** Bridge formula on first→last active axle outer span (null if N<2). */
  vehicle_bridge_formula: BridgeFormulaResult | null
  /**
   * Every consecutive sub-span of 2+ active axles vs bridge formula.
   * Intermediate windows (e.g. axles 2–5) can fail even when full-vehicle is green.
   */
  bridge_windows: BridgeWindowResult[]
  /** Non-green consecutive bridge windows (yellow + red). */
  bridge_window_violations: BridgeWindowResult[]
  /** Worst consecutive bridge window (red > yellow > green by severity then overload). */
  worst_bridge_window: BridgeWindowResult | null
  overall_compliance: ComplianceStatus
  /** Active states used for this run. Empty = federal Interstate baseline only. */
  states: string[]
  /** Effective merged rules (per state). */
  state_rules: StateRulesMap
  /** Axles that were skipped (lifted). */
  skipped_lift_axles: string[]
  /** Global tips (spread suggestion, multi-state conflicts, zero loads). */
  optimization_tips: string[]
  /** Count of red groups + red bridge windows + gross red. */
  violation_count: number
  /** Permit-ready export blob. */
  permit_json: Record<string, unknown>
}

/** Meta key stored inside axle_configs.state_rules JSON for selected corridor codes. */
export const SELECTED_STATES_META_KEY = '_selected_states'

/** Federal interstate gross default (lbs) without special permit. */
export const FEDERAL_GROSS_LEGAL_LBS = 80_000

export interface CalculateAxleGroupsInput {
  axles: AxleInput[]
  /** Two-letter state codes, e.g. ['MO','KS']. Empty → federal defaults only. */
  states?: string[]
  /** Optional full or partial state rule overrides (merged over defaults). */
  state_rules?: StateRulesMap | null
}

// ---------------------------------------------------------------------------
// Constants — federal + corridor defaults (MO/KS/IL/TN/TX/FL/OK/AL/MS)
// ---------------------------------------------------------------------------

/** Federal single-axle legal default (lbs). */
export const FEDERAL_SINGLE_LBS = 20_000
/** Federal tandem legal default (lbs) — Interstate. */
export const FEDERAL_TANDEM_LBS = 34_000
/** Pragmatic tridem default when state has no tighter table. */
export const FEDERAL_TRIDEM_LBS = 42_000
/** Pragmatic quad default. */
export const FEDERAL_QUAD_LBS = 50_000

/** Axles ≤ this spacing share one single group (federal close-coupled). */
export const CLOSE_COUPLED_MAX_IN = 40
/** Federal tandem outer / consecutive spacing ceiling (inches). */
export const TANDEM_MAX_IN = 96

export const FEDERAL_DEFAULT_RULE: StateAxleRule = {
  single_cap_lbs: FEDERAL_SINGLE_LBS,
  tandem_cap_lbs: FEDERAL_TANDEM_LBS,
  tridem_cap_lbs: FEDERAL_TRIDEM_LBS,
  quad_cap_lbs: FEDERAL_QUAD_LBS,
  tridem_max_span_in: 144,
  quad_max_span_in: 192,
  notes: 'Federal Interstate baseline (no state-specific table applied).',
}

/**
 * Default state rules for primary TruckerOS corridors.
 * Spans / caps are pragmatic OSOW planner defaults — verify against current
 * state statutes / bridge tables before locking a permit package.
 */
export const DEFAULT_STATE_RULES: StateRulesMap = {
  MO: {
    single_cap_lbs: 20_000,
    tandem_cap_lbs: 34_000,
    tridem_cap_lbs: 42_000,
    quad_cap_lbs: 50_000,
    tridem_max_span_in: 144,
    quad_max_span_in: 192,
    notes: 'Missouri: tridem outer ≤ 144", quad outer ≤ 192" (planner defaults).',
  },
  KS: {
    single_cap_lbs: 20_000,
    tandem_cap_lbs: 34_000,
    tridem_cap_lbs: 42_000,
    quad_cap_lbs: 50_000,
    tridem_max_span_in: 132,
    quad_max_span_in: 192,
    notes: 'Kansas: tridem outer ~132" typical; confirm local superload tables.',
  },
  IL: {
    single_cap_lbs: 20_000,
    tandem_cap_lbs: 34_000,
    tridem_cap_lbs: 42_000,
    quad_cap_lbs: 50_000,
    tridem_max_span_in: 144,
    quad_max_span_in: 192,
    notes: 'Illinois: Interstate tandem 34k; bridge formula governs multi-axle.',
  },
  TN: {
    single_cap_lbs: 20_000,
    tandem_cap_lbs: 34_000,
    tridem_cap_lbs: 42_000,
    quad_cap_lbs: 50_000,
    tridem_max_span_in: 144,
    quad_max_span_in: 192,
    notes: 'Tennessee: standard Interstate caps with bridge formula check.',
  },
  TX: {
    single_cap_lbs: 20_000,
    tandem_cap_lbs: 34_000,
    tridem_cap_lbs: 42_000,
    quad_cap_lbs: 50_000,
    tridem_max_span_in: 144,
    quad_max_span_in: 192,
    notes: 'Texas: watch axle group permit tables for superheavy; spread tandems common.',
  },
  FL: {
    single_cap_lbs: 22_000,
    tandem_cap_lbs: 44_000,
    tridem_cap_lbs: 66_000,
    quad_cap_lbs: 70_000,
    tridem_max_span_in: 144,
    quad_max_span_in: 192,
    notes: 'Florida: higher legal group caps on many routes; still apply bridge formula.',
  },
  OK: {
    single_cap_lbs: 20_000,
    tandem_cap_lbs: 34_000,
    tridem_cap_lbs: 42_000,
    quad_cap_lbs: 50_000,
    tridem_max_span_in: 144,
    quad_max_span_in: 192,
    notes: 'Oklahoma: Interstate baseline; OSOW permits raise group ceilings.',
  },
  AL: {
    single_cap_lbs: 20_000,
    tandem_cap_lbs: 34_000,
    tridem_cap_lbs: 42_000,
    quad_cap_lbs: 50_000,
    tridem_max_span_in: 144,
    quad_max_span_in: 192,
    notes: 'Alabama: Interstate baseline with bridge formula.',
  },
  MS: {
    single_cap_lbs: 20_000,
    tandem_cap_lbs: 34_000,
    tridem_cap_lbs: 42_000,
    quad_cap_lbs: 50_000,
    tridem_max_span_in: 144,
    quad_max_span_in: 192,
    notes: 'Mississippi: Interstate baseline with bridge formula.',
  },
}

/** Corridor codes used by the multi-select UI. */
export const AXLE_OPTIMIZER_STATE_CODES = Object.keys(DEFAULT_STATE_RULES)

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** Federal Bridge Formula weight limit (lbs) for N axles spanning L feet. */
export function federalBridgeFormulaLbs(L_ft: number, N: number): BridgeFormulaResult {
  const n = Math.max(0, Math.floor(N))
  const L = Math.max(0, L_ft)
  if (n < 2) {
    return {
      L_ft: L,
      N: n,
      W_lbs: 0,
      formula: 'N/A (requires N ≥ 2)',
      applicable: false,
    }
  }
  // W = 500 * [ (L * N) / (N - 1) + 12 * N + 36 ]
  const inner = (L * n) / (n - 1) + 12 * n + 36
  const W = Math.floor(500 * inner)
  return {
    L_ft: L,
    N: n,
    W_lbs: W,
    formula: `W = 500 × [(${L.toFixed(2)} × ${n}) / (${n} − 1) + 12 × ${n} + 36] = ${W.toLocaleString()} lbs`,
    applicable: true,
  }
}

export function normalizeStateCode(code: string | null | undefined): string {
  return String(code || '')
    .trim()
    .toUpperCase()
    .slice(0, 2)
}

/** Numeric StateAxleRule fields only (excludes string `notes`). */
const STATE_RULE_NUMERIC_KEYS = [
  'single_cap_lbs',
  'tandem_cap_lbs',
  'tridem_cap_lbs',
  'quad_cap_lbs',
  'tridem_max_span_in',
  'quad_max_span_in',
  'single_permit_lbs',
  'tandem_permit_lbs',
  'tridem_permit_lbs',
  'quad_permit_lbs',
] as const satisfies readonly (keyof StateAxleRule)[]

type StateAxleRuleNumericKey = (typeof STATE_RULE_NUMERIC_KEYS)[number]

function positiveNumber(value: unknown, fallback: number, min = 1, max = 500_000): number {
  const n = Number(value)
  if (!Number.isFinite(n) || n < min || n > max) return fallback
  return n
}

function numericRuleValue(rule: StateAxleRule, key: StateAxleRuleNumericKey): number {
  const v = rule[key]
  return typeof v === 'number' && Number.isFinite(v) ? v : 1
}

/**
 * Sanitize partial state rule overrides from client/API.
 * - Only known 2-letter keys (or keys present in defaults / requested states)
 * - Numeric caps must be finite positive; bad values dropped (base rule kept)
 * - notes trimmed string only
 */
export function sanitizeStateRules(
  raw: unknown,
  allowedCodes?: string[] | null
): StateRulesMap | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const allowed = new Set(
    (allowedCodes && allowedCodes.length > 0
      ? allowedCodes
      : [...Object.keys(DEFAULT_STATE_RULES), 'US']
    ).map(normalizeStateCode)
  )

  const out: StateRulesMap = {}
  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    // Skip meta keys (e.g. _selected_states) and non-objects
    if (key.startsWith('_')) continue
    const code = normalizeStateCode(key)
    if (!code || code.length !== 2) continue
    if (!allowed.has(code) && !(code in DEFAULT_STATE_RULES) && code !== 'US') continue
    if (!val || typeof val !== 'object' || Array.isArray(val)) continue

    const base =
      code === 'US'
        ? { ...FEDERAL_DEFAULT_RULE }
        : { ...(DEFAULT_STATE_RULES[code] ?? FEDERAL_DEFAULT_RULE) }
    const src = val as Record<string, unknown>
    const cleaned: StateAxleRule = { ...base }

    for (const k of STATE_RULE_NUMERIC_KEYS) {
      if (src[k] === undefined || src[k] === null || src[k] === '') continue
      const fallback = numericRuleValue(base, k)
      const max = k.endsWith('_span_in') ? 600 : 500_000
      const min = k.endsWith('_span_in') ? 40 : 1
      cleaned[k] = positiveNumber(src[k], fallback, min, max)
    }
    if (typeof src.notes === 'string') {
      cleaned.notes = src.notes.trim().slice(0, 500)
    }
    out[code] = cleaned
  }
  return Object.keys(out).length > 0 ? out : null
}

export function mergeStateRules(
  states: string[],
  overrides?: StateRulesMap | null
): StateRulesMap {
  const out: StateRulesMap = {}
  const codes = states.length > 0 ? states.map(normalizeStateCode).filter(Boolean) : ['US']
  const safeOverrides = sanitizeStateRules(overrides, codes)

  for (const code of codes) {
    const base =
      code === 'US'
        ? { ...FEDERAL_DEFAULT_RULE }
        : { ...(DEFAULT_STATE_RULES[code] ?? FEDERAL_DEFAULT_RULE) }
    const over = safeOverrides?.[code]
    out[code] = over ? { ...base, ...over } : base
  }
  return out
}

function groupCapForType(rule: StateAxleRule, type: SpacingGroupType): number {
  switch (type) {
    case 'single':
    case 'spread':
      // Spread halves are scored as singles (20k class); pair capacity is 2× via two groups.
      return rule.single_cap_lbs
    case 'tandem':
      return rule.tandem_cap_lbs
    case 'tridem':
      return rule.tridem_cap_lbs
    case 'quad':
      return rule.quad_cap_lbs
    default:
      return rule.single_cap_lbs
  }
}

function permitCapForType(rule: StateAxleRule, type: SpacingGroupType, legal: number): number {
  const explicit =
    type === 'single' || type === 'spread'
      ? rule.single_permit_lbs
      : type === 'tandem'
        ? rule.tandem_permit_lbs
        : type === 'tridem'
          ? rule.tridem_permit_lbs
          : rule.quad_permit_lbs
  if (explicit != null && explicit > 0) return Math.max(legal, explicit)
  // Soft OSOW band: 25% above legal (planner placeholder).
  return Math.round(legal * 1.25)
}

export function complianceForLoad(
  loadLbs: number,
  maxLegal: number,
  maxPermitted: number
): ComplianceStatus {
  if (loadLbs <= maxLegal) return 'green'
  if (loadLbs <= maxPermitted) return 'yellow'
  return 'red'
}

function overallFromGroups(statuses: ComplianceStatus[]): ComplianceStatus {
  if (statuses.some((s) => s === 'red')) return 'red'
  if (statuses.some((s) => s === 'yellow')) return 'yellow'
  return 'green'
}

/** Sort active axles front→rear; drop lifted axles (lifted === true). */
export function prepareActiveAxles(axles: AxleInput[]): {
  active: AxleInput[]
  skipped_lift_axles: string[]
} {
  const skipped_lift_axles: string[] = []
  const active: AxleInput[] = []
  for (const a of axles || []) {
    if (!a || a.id == null) continue
    // Lift axles that are UP (lifted) do not carry load / do not form groups.
    if (a.lifted === true) {
      skipped_lift_axles.push(String(a.id))
      continue
    }
    active.push({
      ...a,
      id: String(a.id),
      position_inches: Number(a.position_inches) || 0,
      current_load_lbs: Math.max(0, Number(a.current_load_lbs) || 0),
      tire_count: a.tire_count == null ? null : Number(a.tire_count) || null,
      type: (['steer', 'drive', 'trailer', 'lift'].includes(a.type) ? a.type : 'trailer') as AxlePhysicalType,
    })
  }
  active.sort((x, y) => x.position_inches - y.position_inches || x.id.localeCompare(y.id))
  return { active, skipped_lift_axles }
}

type DraftGroup = Omit<
  SpacingAxleGroup,
  'max_legal_lbs' | 'max_permitted_lbs' | 'compliance_status' | 'bridge_formula' | 'limiting_state'
>

/**
 * Cluster consecutive axles whose *adjacent* spacing is ≤ TANDEM_MAX_IN (96").
 * Gaps > 96" start a new cluster (natural spread / separate groups).
 */
export function clusterByAdjacentSpacing(active: AxleInput[]): number[][] {
  if (active.length === 0) return []
  const clusters: number[][] = []
  let current: number[] = [0]
  for (let i = 1; i < active.length; i++) {
    const gap = active[i].position_inches - active[i - 1].position_inches
    if (gap <= TANDEM_MAX_IN) {
      current.push(i)
    } else {
      clusters.push(current)
      current = [i]
    }
  }
  clusters.push(current)
  return clusters
}

/**
 * Classify one contiguous cluster (indexes into `active`) into one or more groups.
 *
 * Order of operations (critical):
 * 1. Peel close-coupled prefix (all axles within ≤40" of the first) as one single — even if
 *    more axles remain (e.g. A@0, B@30, C@110 → single[A,B] then continue with C).
 * 2. Quad when 4 axles outer ≤ state max.
 * 3. Tridem when 3 axles outer ≤ state tridem max (including outer ≤96" — scored with bridge,
 *    NOT peeled into tandem+single which inflates capacity).
 * 4. Pair tandem / close single.
 */
function classifyCluster(
  active: AxleInput[],
  indexes: number[],
  tridemMax: number,
  quadMax: number,
  nextSeq: () => number
): DraftGroup[] {
  const out: DraftGroup[] = []

  const make = (
    type: SpacingGroupType,
    idxs: number[],
    tips: string[] = []
  ): DraftGroup => {
    const members = idxs.map((i) => active[i])
    const outer =
      idxs.length <= 1
        ? 0
        : members[members.length - 1].position_inches - members[0].position_inches
    return {
      id: `grp-${nextSeq()}`,
      type,
      axle_ids: members.map((m) => m.id),
      axle_indexes: [...idxs],
      outer_span_inches: outer,
      current_load_lbs: members.reduce((s, m) => s + (m.current_load_lbs || 0), 0),
      optimization_tips: tips,
    }
  }

  let rest = [...indexes]

  while (rest.length > 0) {
    if (rest.length === 1) {
      out.push(make('single', rest))
      break
    }

    const outerOf = (slice: number[]) =>
      active[slice[slice.length - 1]].position_inches - active[slice[0]].position_inches

    // 1) Close-coupled prefix FIRST — peel even when more axles remain in the cluster.
    const firstPos = active[rest[0]].position_inches
    let closeEnd = 1
    while (
      closeEnd < rest.length &&
      active[rest[closeEnd]].position_inches - firstPos <= CLOSE_COUPLED_MAX_IN
    ) {
      closeEnd++
    }
    if (closeEnd >= 2) {
      const closeIdx = rest.slice(0, closeEnd)
      out.push(
        make('single', closeIdx, [
          `Close-coupled (≤ ${CLOSE_COUPLED_MAX_IN}") — single axle group.`,
        ])
      )
      rest = rest.slice(closeEnd)
      continue
    }

    // 2) Quad (4) when outer ≤ state max
    if (rest.length >= 4) {
      const quadIdx = rest.slice(0, 4)
      const outer = outerOf(quadIdx)
      if (outer <= quadMax) {
        out.push(
          make('quad', quadIdx, [
            `Quad outer span ${outer.toFixed(0)}" ≤ max ${quadMax}".`,
          ])
        )
        rest = rest.slice(4)
        continue
      }
    }

    // 3) Three axles: form tridem when outer ≤ state max (bridge formula applied in scoreGroups).
    //    Do NOT peel into tandem+single when outer ≤96" — that overstates legal capacity.
    if (rest.length >= 3) {
      const triIdx = rest.slice(0, 3)
      const outer = outerOf(triIdx)
      if (outer <= tridemMax) {
        const tips =
          outer > TANDEM_MAX_IN
            ? [`Tridem outer span ${outer.toFixed(0)}" (limit ${tridemMax}").`]
            : [
                `Three axles within ${TANDEM_MAX_IN}" (outer ${outer.toFixed(0)}") — multi-axle group with bridge formula (not tandem+single).`,
              ]
        out.push(make('tridem', triIdx, tips))
        rest = rest.slice(3)
        continue
      }
      // outer > tridemMax: peel largest legal pair/tandem from front, leave third+
    }

    // 4) Pair (2)
    if (rest.length >= 2) {
      const pair = rest.slice(0, 2)
      const span = outerOf(pair)
      if (span <= CLOSE_COUPLED_MAX_IN) {
        out.push(
          make('single', pair, [
            `Close-coupled (≤ ${CLOSE_COUPLED_MAX_IN}") — single axle group.`,
          ])
        )
      } else if (span <= TANDEM_MAX_IN) {
        out.push(
          make('tandem', pair, [
            `Tandem spacing ${span.toFixed(0)}" (federal tandem ≤ ${TANDEM_MAX_IN}").`,
          ])
        )
      } else {
        // Should not happen inside a ≤96" adjacent cluster for a pure pair
        out.push(make('single', [pair[0]]))
        out.push(
          make('spread', [pair[1]], [
            `Spread > ${TANDEM_MAX_IN}" — separate single (weight win vs tandem).`,
          ])
        )
      }
      rest = rest.slice(2)
      continue
    }
  }

  return out
}

/**
 * Tag consecutive single-axle groups whose centers are >96" apart as `spread`
 * (weight-win halves). Each half still uses the single axle cap.
 */
function tagSpreadSingles(active: AxleInput[], draft: DraftGroup[]): DraftGroup[] {
  if (draft.length < 2) return draft
  const out = draft.map((g) => ({ ...g, axle_indexes: [...g.axle_indexes], axle_ids: [...g.axle_ids], optimization_tips: [...g.optimization_tips] }))
  for (let i = 0; i < out.length - 1; i++) {
    const a = out[i]
    const b = out[i + 1]
    if (a.axle_indexes.length !== 1 || b.axle_indexes.length !== 1) continue
    if (a.type !== 'single' && a.type !== 'spread') continue
    if (b.type !== 'single' && b.type !== 'spread') continue
    const i0 = a.axle_indexes[0]
    const i1 = b.axle_indexes[0]
    if (i1 !== i0 + 1) continue
    const span = active[i1].position_inches - active[i0].position_inches
    if (span <= TANDEM_MAX_IN) continue
    const tip =
      `Spread ${span.toFixed(0)}" (> ${TANDEM_MAX_IN}") — weight win: separate singles ` +
      `(up to ${FEDERAL_SINGLE_LBS.toLocaleString()} + ${FEDERAL_SINGLE_LBS.toLocaleString()} vs tandem ${FEDERAL_TANDEM_LBS.toLocaleString()}).`
    a.type = 'spread'
    b.type = 'spread'
    if (!a.optimization_tips.some((t) => /weight win/i.test(t))) a.optimization_tips.push(tip)
    if (!b.optimization_tips.some((t) => /weight win/i.test(t))) b.optimization_tips.push(tip)
  }
  return out
}

/**
 * Form spacing groups from sorted active axles using adjacent ≤96" clusters,
 * then classify each cluster (single / tandem / tridem / quad).
 *
 * Axles with adjacent gap > 96" become separate singles tagged `spread` —
 * the classic weight win (20k + 20k vs 34k tandem).
 */
export function formSpacingGroups(
  active: AxleInput[],
  rules: StateRulesMap
): DraftGroup[] {
  const ruleList = Object.values(rules)
  const tridemMax = Math.min(...ruleList.map((r) => r.tridem_max_span_in))
  const quadMax = Math.min(...ruleList.map((r) => r.quad_max_span_in))

  let seq = 0
  const nextSeq = () => ++seq

  const clusters = clusterByAdjacentSpacing(active)
  const draft: DraftGroup[] = []
  for (const cluster of clusters) {
    draft.push(...classifyCluster(active, cluster, tridemMax, quadMax, nextSeq))
  }
  return tagSpreadSingles(active, draft)
}

/**
 * Apply state caps + bridge formula to draft groups.
 * Multi-state: take the MINIMUM legal (and corresponding permit) across states.
 */
export function scoreGroups(
  draft: ReturnType<typeof formSpacingGroups>,
  rules: StateRulesMap
): SpacingAxleGroup[] {
  const entries = Object.entries(rules)

  return draft.map((g) => {
    let bestLegal = Number.POSITIVE_INFINITY
    let bestPermit = Number.POSITIVE_INFINITY
    let limiting_state: string | undefined
    let bridge: BridgeFormulaResult | null = null

    const L_ft = g.outer_span_inches / 12
    const N = g.axle_ids.length
    const bf = federalBridgeFormulaLbs(L_ft, N)
    if (bf.applicable) bridge = bf

    for (const [code, rule] of entries) {
      let legal = groupCapForType(rule, g.type)
      // Bridge formula can lower the multi-axle legal max
      if (bf.applicable && bf.W_lbs > 0) {
        legal = Math.min(legal, bf.W_lbs)
      }
      // Steer soft guidance is not forced here; physical type is informational.
      const permit = permitCapForType(rule, g.type, legal)
      if (legal < bestLegal) {
        bestLegal = legal
        bestPermit = permit
        limiting_state = code === 'US' ? undefined : code
      } else if (legal === bestLegal && permit < bestPermit) {
        bestPermit = permit
      }
    }

    if (!Number.isFinite(bestLegal)) {
      bestLegal = FEDERAL_SINGLE_LBS
      bestPermit = Math.round(FEDERAL_SINGLE_LBS * 1.25)
    }

    const tips = [...g.optimization_tips]
    if (bridge?.applicable) {
      tips.push(`Bridge formula: ${bridge.formula}`)
      const capOnly = Math.min(
        ...entries.map(([, r]) => groupCapForType(r, g.type))
      )
      if (bridge.W_lbs < capOnly) {
        tips.push(
          `Bridge formula (${bridge.W_lbs.toLocaleString()} lbs) is tighter than state group cap (${capOnly.toLocaleString()} lbs).`
        )
      }
    }
    if (g.current_load_lbs === 0) {
      tips.push('All member axles report 0 lbs — enter scale weights for compliance color.')
    }

    const compliance_status = complianceForLoad(g.current_load_lbs, bestLegal, bestPermit)

    return {
      ...g,
      max_legal_lbs: bestLegal,
      max_permitted_lbs: bestPermit,
      compliance_status,
      bridge_formula: bridge,
      limiting_state,
      optimization_tips: tips,
    }
  })
}

/**
 * Detect adjacent spread/single pairs that form a >96" weight-win tip (global).
 */
function collectSpreadTips(
  active: AxleInput[],
  groups: SpacingAxleGroup[]
): string[] {
  const tips: string[] = []
  for (let g = 0; g < groups.length - 1; g++) {
    const a = groups[g]
    const b = groups[g + 1]
    if (a.axle_indexes.length !== 1 || b.axle_indexes.length !== 1) continue
    if (!(['single', 'spread'] as SpacingGroupType[]).includes(a.type)) continue
    if (!(['single', 'spread'] as SpacingGroupType[]).includes(b.type)) continue
    const i0 = a.axle_indexes[0]
    const i1 = b.axle_indexes[0]
    const span = active[i1].position_inches - active[i0].position_inches
    if (span > TANDEM_MAX_IN) {
      tips.push(
        `Weight win: axles ${active[i0].id}→${active[i1].id} are ${span.toFixed(0)}" apart (> ${TANDEM_MAX_IN}"). ` +
          `Treated as two singles (up to ${FEDERAL_SINGLE_LBS * 2} lbs) instead of a 34k tandem.`
      )
    }
  }
  return tips
}

/**
 * Federal Bridge Formula on every consecutive sub-span of 2+ sorted active axles.
 * Catches intermediate windows (e.g. axles index 1–4) that full-vehicle bridge misses.
 */
export function evaluateConsecutiveBridgeWindows(active: AxleInput[]): {
  windows: BridgeWindowResult[]
  violations: BridgeWindowResult[]
  worst: BridgeWindowResult | null
} {
  const windows: BridgeWindowResult[] = []
  const n = active.length
  for (let i = 0; i < n; i++) {
    let load = active[i].current_load_lbs || 0
    for (let j = i + 1; j < n; j++) {
      load += active[j].current_load_lbs || 0
      const outerIn = active[j].position_inches - active[i].position_inches
      const N = j - i + 1
      const bridge = federalBridgeFormulaLbs(outerIn / 12, N)
      if (!bridge.applicable || bridge.W_lbs <= 0) continue
      const soft_permit_lbs = Math.round(bridge.W_lbs * 1.25)
      const compliance_status = complianceForLoad(load, bridge.W_lbs, soft_permit_lbs)
      windows.push({
        start_index: i,
        end_index: j,
        axle_ids: active.slice(i, j + 1).map((a) => a.id),
        outer_span_inches: outerIn,
        load_lbs: load,
        bridge,
        soft_permit_lbs,
        compliance_status,
      })
    }
  }

  const rank = (s: ComplianceStatus) => (s === 'red' ? 2 : s === 'yellow' ? 1 : 0)
  const violations = windows.filter((w) => w.compliance_status !== 'green')
  let worst: BridgeWindowResult | null = null
  for (const w of windows) {
    if (!worst) {
      worst = w
      continue
    }
    const dr = rank(w.compliance_status) - rank(worst.compliance_status)
    if (dr > 0) {
      worst = w
      continue
    }
    if (dr === 0) {
      const overW = w.load_lbs - w.bridge.W_lbs
      const overB = worst.load_lbs - worst.bridge.W_lbs
      if (overW > overB) worst = w
    }
  }
  // Prefer a non-green window as worst when any exist
  if (worst && worst.compliance_status === 'green' && violations.length > 0) {
    worst = violations[0]
    for (const w of violations) {
      const dr = rank(w.compliance_status) - rank(worst.compliance_status)
      if (dr > 0 || (dr === 0 && w.load_lbs - w.bridge.W_lbs > worst.load_lbs - worst.bridge.W_lbs)) {
        worst = w
      }
    }
  }

  return { windows, violations, worst }
}

/**
 * Build state_rules JSON for persistence.
 * - Empty corridor → federal baseline only (US) + _selected_states: []
 * - Non-empty → rules for those states only + _selected_states: codes
 * Never expands empty selection to all DEFAULT_STATE_RULES corridor keys.
 */
export function buildStateRulesForSave(
  states: string[],
  overrides?: StateRulesMap | null
): Record<string, unknown> {
  const unique = [...new Set(states.map(normalizeStateCode).filter((s) => s.length === 2))]
  const rules = mergeStateRules(unique, overrides)
  return {
    ...rules,
    [SELECTED_STATES_META_KEY]: unique,
  }
}

/**
 * Restore corridor selection from saved state_rules JSON.
 * Prefers `_selected_states`; falls back to non-meta keys (excluding US).
 * Empty array = federal-only intent.
 */
export function restoreSelectedStatesFromSaved(
  stateRules: unknown,
  corridorCodes: string[] = Object.keys(DEFAULT_STATE_RULES)
): string[] {
  if (!stateRules || typeof stateRules !== 'object' || Array.isArray(stateRules)) {
    return []
  }
  const obj = stateRules as Record<string, unknown>
  if (Array.isArray(obj[SELECTED_STATES_META_KEY])) {
    return (obj[SELECTED_STATES_META_KEY] as unknown[])
      .map((s) => normalizeStateCode(String(s)))
      .filter((s) => s.length === 2)
  }
  // Legacy: only corridor keys (not US / meta)
  return Object.keys(obj)
    .map(normalizeStateCode)
    .filter(
      (k) =>
        k.length === 2 &&
        k !== 'US' &&
        !k.startsWith('_') &&
        corridorCodes.includes(k)
    )
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

/**
 * Calculate spacing-based axle groups, legal/permit caps, bridge formula, and tips.
 */
export function calculateAxleGroups(input: CalculateAxleGroupsInput): AxleGroupAnalysis {
  const states = (input.states || [])
    .map(normalizeStateCode)
    .filter((s) => s.length === 2)
  // Dedupe preserve order
  const uniqueStates = [...new Set(states)]

  const state_rules = mergeStateRules(uniqueStates, input.state_rules)
  const { active, skipped_lift_axles } = prepareActiveAxles(input.axles || [])

  const draft = formSpacingGroups(active, state_rules)
  const groups = scoreGroups(draft, state_rules)

  const gvw_lbs = active.reduce((s, a) => s + (a.current_load_lbs || 0), 0)
  const total_group_legal_lbs = groups.reduce((s, g) => s + g.max_legal_lbs, 0)
  const total_group_permitted_lbs = groups.reduce((s, g) => s + g.max_permitted_lbs, 0)

  // Full-vehicle bridge (first→last active axle) + federal gross 80k ceiling.
  let vehicle_bridge_formula: BridgeFormulaResult | null = null
  let gross_legal_lbs = FEDERAL_GROSS_LEGAL_LBS
  if (active.length >= 2) {
    const outerIn =
      active[active.length - 1].position_inches - active[0].position_inches
    vehicle_bridge_formula = federalBridgeFormulaLbs(outerIn / 12, active.length)
    if (vehicle_bridge_formula.applicable && vehicle_bridge_formula.W_lbs > 0) {
      gross_legal_lbs = Math.min(gross_legal_lbs, vehicle_bridge_formula.W_lbs)
    }
  } else if (active.length === 1) {
    gross_legal_lbs = Math.min(gross_legal_lbs, FEDERAL_SINGLE_LBS)
  } else {
    gross_legal_lbs = 0
  }
  const gross_permitted_lbs =
    gross_legal_lbs > 0 ? Math.round(gross_legal_lbs * 1.25) : 0

  // Every consecutive sub-span (including intermediate windows like axles 2–5).
  const {
    windows: bridge_windows,
    violations: bridge_window_violations,
    worst: worst_bridge_window,
  } = evaluateConsecutiveBridgeWindows(active)

  const optimization_tips: string[] = []
  optimization_tips.push(...collectSpreadTips(active, groups))

  // Empty / all-lifted: not green — incomplete analysis.
  let overall_compliance: ComplianceStatus
  if (active.length === 0) {
    overall_compliance = 'yellow'
    optimization_tips.push(
      'No active axles (all lifted or empty) — compliance incomplete; not marked green.'
    )
  } else {
    const groupOverall = overallFromGroups(groups.map((g) => g.compliance_status))
    // Never show green when combination GVW violates bridge / federal gross.
    const gvwStatus = complianceForLoad(gvw_lbs, gross_legal_lbs, gross_permitted_lbs)
    const windowOverall = overallFromGroups(
      bridge_windows.map((w) => w.compliance_status)
    )
    overall_compliance = overallFromGroups([groupOverall, gvwStatus, windowOverall])
    if (gvwStatus !== 'green' && gvw_lbs > 0) {
      optimization_tips.push(
        `Combination GVW ${gvw_lbs.toLocaleString()} lbs vs gross legal ${gross_legal_lbs.toLocaleString()} lbs` +
          (vehicle_bridge_formula?.applicable
            ? ` (vehicle bridge ${vehicle_bridge_formula.W_lbs.toLocaleString()} lbs / federal ${FEDERAL_GROSS_LEGAL_LBS.toLocaleString()} lbs).`
            : ` (federal gross ${FEDERAL_GROSS_LEGAL_LBS.toLocaleString()} lbs).`)
      )
    }
    if (total_group_legal_lbs > gross_legal_lbs && gross_legal_lbs > 0) {
      optimization_tips.push(
        `Σ group legal (${total_group_legal_lbs.toLocaleString()} lbs) exceeds combination ceiling (${gross_legal_lbs.toLocaleString()} lbs) — do not rely on summed group caps for GVW.`
      )
    }
    if (worst_bridge_window && worst_bridge_window.compliance_status !== 'green') {
      const w = worst_bridge_window
      const over = w.load_lbs - w.bridge.W_lbs
      optimization_tips.push(
        `Bridge window axles ${w.axle_ids.join('→')} (idx ${w.start_index}–${w.end_index}, ` +
          `span ${w.outer_span_inches.toFixed(0)}", N=${w.bridge.N}): load ${w.load_lbs.toLocaleString()} lbs ` +
          `vs W ${w.bridge.W_lbs.toLocaleString()} lbs (${w.compliance_status}` +
          (over > 0 ? `, over by ${over.toLocaleString()} lbs` : '') +
          '). Soft yellow band is a planner estimate — not an official permit limit.'
      )
    }
    if (bridge_window_violations.length > 1) {
      optimization_tips.push(
        `${bridge_window_violations.length} consecutive bridge windows are yellow/red (checked all 2+ axle sub-spans).`
      )
    }
  }

  const violation_count =
    groups.filter((g) => g.compliance_status === 'red').length +
    bridge_window_violations.filter((w) => w.compliance_status === 'red').length +
    (gvw_lbs > gross_permitted_lbs && active.length > 0 ? 1 : 0)

  if (active.some((a) => a.current_load_lbs === 0)) {
    optimization_tips.push(
      'One or more axles have 0 lbs load — groups still form by spacing; compliance may be incomplete.'
    )
  }
  if (skipped_lift_axles.length > 0) {
    optimization_tips.push(
      `Lifted axles excluded from groups: ${skipped_lift_axles.join(', ')}.`
    )
  }
  if (uniqueStates.length > 1) {
    optimization_tips.push(
      `Multi-state run (${uniqueStates.join(', ')}): legal caps use the most restrictive state per group.`
    )
  }
  if (uniqueStates.length === 0) {
    optimization_tips.push('No states selected — federal Interstate defaults applied.')
  }

  // Suggest spreading a tandem that is red/yellow if spacing is still ≤96"
  for (const g of groups) {
    if (g.type === 'tandem' && (g.compliance_status === 'red' || g.compliance_status === 'yellow')) {
      if (g.outer_span_inches <= TANDEM_MAX_IN) {
        const need = g.current_load_lbs - g.max_legal_lbs
        if (need > 0) {
          optimization_tips.push(
            `Consider spreading group ${g.id} beyond ${TANDEM_MAX_IN}" to unlock two 20k singles ` +
              `(potential +${FEDERAL_SINGLE_LBS * 2 - FEDERAL_TANDEM_LBS} lbs legal vs tandem) — overload ~${need.toLocaleString()} lbs.`
          )
        }
      }
    }
  }

  const permit_json = {
    version: 1,
    engine: 'axleGroupCalculator',
    states: uniqueStates,
    gvw_lbs,
    gross_legal_lbs,
    gross_permitted_lbs,
    vehicle_bridge_formula,
    worst_bridge_window,
    bridge_window_violation_count: bridge_window_violations.length,
    overall_compliance,
    violation_count,
    groups: groups.map((g) => ({
      id: g.id,
      type: g.type,
      axle_ids: g.axle_ids,
      outer_span_inches: g.outer_span_inches,
      current_load_lbs: g.current_load_lbs,
      max_legal_lbs: g.max_legal_lbs,
      max_permitted_lbs: g.max_permitted_lbs,
      compliance_status: g.compliance_status,
      limiting_state: g.limiting_state ?? null,
      bridge_formula: g.bridge_formula,
    })),
    axles: active.map((a) => ({
      id: a.id,
      position_inches: a.position_inches,
      type: a.type,
      tire_count: a.tire_count ?? null,
      current_load_lbs: a.current_load_lbs,
    })),
    skipped_lift_axles,
    state_rules,
    tips: optimization_tips,
  }

  return {
    groups,
    gvw_lbs,
    total_group_legal_lbs,
    total_group_permitted_lbs,
    gross_legal_lbs,
    gross_permitted_lbs,
    vehicle_bridge_formula,
    bridge_windows,
    bridge_window_violations,
    worst_bridge_window,
    overall_compliance,
    states: uniqueStates,
    state_rules,
    skipped_lift_axles,
    optimization_tips,
    violation_count,
    permit_json,
  }
}

/** Convenience: default 5-axle Class 8 layout (steer + tandem drive + tandem trailer). */
export function defaultFiveAxleClass8(): AxleInput[] {
  return [
    { id: 'ax1', position_inches: 36, type: 'steer', tire_count: 2, current_load_lbs: 12_000 },
    { id: 'ax2', position_inches: 180, type: 'drive', tire_count: 4, current_load_lbs: 17_000 },
    { id: 'ax3', position_inches: 234, type: 'drive', tire_count: 4, current_load_lbs: 17_000 }, // 54" tandem
    { id: 'ax4', position_inches: 540, type: 'trailer', tire_count: 4, current_load_lbs: 17_000 },
    { id: 'ax5', position_inches: 594, type: 'trailer', tire_count: 4, current_load_lbs: 17_000 }, // 54" tandem
  ]
}

/**
 * Validate/normalize axle array from API/client body.
 * Returns { ok, axles, error }.
 */
export function parseAxleInputs(raw: unknown): {
  ok: boolean
  axles: AxleInput[]
  error?: string
} {
  if (!Array.isArray(raw)) {
    return { ok: false, axles: [], error: 'axles must be an array' }
  }
  if (raw.length === 0) {
    return { ok: false, axles: [], error: 'at least one axle is required' }
  }
  if (raw.length > 20) {
    return { ok: false, axles: [], error: 'maximum 20 axles supported' }
  }

  const axles: AxleInput[] = []
  for (let i = 0; i < raw.length; i++) {
    const row = raw[i] as Record<string, unknown>
    if (!row || typeof row !== 'object') {
      return { ok: false, axles: [], error: `axles[${i}] must be an object` }
    }
    const id = String(row.id ?? `ax${i + 1}`)
    const position_inches = Number(row.position_inches)
    if (!Number.isFinite(position_inches) || position_inches < 0 || position_inches > 2400) {
      return {
        ok: false,
        axles: [],
        error: `axles[${i}].position_inches must be 0–2400`,
      }
    }
    const load = Number(row.current_load_lbs)
    if (!Number.isFinite(load) || load < 0 || load > 100_000) {
      return {
        ok: false,
        axles: [],
        error: `axles[${i}].current_load_lbs must be 0–100000`,
      }
    }
    const typeRaw = String(row.type || 'trailer').toLowerCase()
    const type = (
      ['steer', 'drive', 'trailer', 'lift'].includes(typeRaw) ? typeRaw : 'trailer'
    ) as AxlePhysicalType

    axles.push({
      id,
      position_inches,
      type,
      tire_count:
        row.tire_count == null || row.tire_count === ''
          ? null
          : Math.max(0, Math.floor(Number(row.tire_count)) || 0),
      current_load_lbs: load,
      lifted: row.lifted === true,
    })
  }

  return { ok: true, axles }
}
