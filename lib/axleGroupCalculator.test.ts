import { describe, expect, it } from 'vitest'
import {
  CLOSE_COUPLED_MAX_IN,
  DEFAULT_STATE_RULES,
  FEDERAL_SINGLE_LBS,
  FEDERAL_TANDEM_LBS,
  SELECTED_STATES_META_KEY,
  TANDEM_MAX_IN,
  buildStateRulesForSave,
  calculateAxleGroups,
  clusterByAdjacentSpacing,
  complianceForLoad,
  defaultFiveAxleClass8,
  evaluateConsecutiveBridgeWindows,
  federalBridgeFormulaLbs,
  formSpacingGroups,
  mergeStateRules,
  parseAxleInputs,
  prepareActiveAxles,
  restoreSelectedStatesFromSaved,
  sanitizeStateRules,
  type AxleInput,
} from './axleGroupCalculator'

describe('federalBridgeFormulaLbs', () => {
  it('is not applicable for N < 2', () => {
    const r = federalBridgeFormulaLbs(4, 1)
    expect(r.applicable).toBe(false)
    expect(r.W_lbs).toBe(0)
  })

  it('matches known sanity values for tandem and longer groups', () => {
    // L=4 ft (48"), N=2 → W = 500 * [(4*2)/1 + 24 + 36] = 500 * (8+24+36) = 500*68 = 34,000
    const tandem = federalBridgeFormulaLbs(4, 2)
    expect(tandem.applicable).toBe(true)
    expect(tandem.W_lbs).toBe(34_000)

    // L=10 ft (120"), N=2 → W = 500 * [(10*2)/1 + 24 + 36] = 500 * 80 = 40,000
    const spread = federalBridgeFormulaLbs(10, 2)
    expect(spread.W_lbs).toBe(40_000)

    // L=12 ft, N=3 → W = 500 * [(12*3)/2 + 36 + 36] = 500 * (18+36+36) = 500*90 = 45,000
    const tridem = federalBridgeFormulaLbs(12, 3)
    expect(tridem.W_lbs).toBe(45_000)
  })

  it('includes formula string with W', () => {
    const r = federalBridgeFormulaLbs(4, 2)
    expect(r.formula).toContain('34,000')
  })
})

describe('complianceForLoad', () => {
  it('maps green / yellow / red bands', () => {
    expect(complianceForLoad(30_000, 34_000, 42_500)).toBe('green')
    expect(complianceForLoad(36_000, 34_000, 42_500)).toBe('yellow')
    expect(complianceForLoad(50_000, 34_000, 42_500)).toBe('red')
  })
})

describe('prepareActiveAxles / clusterByAdjacentSpacing', () => {
  it('sorts by position and skips lifted axles', () => {
    const { active, skipped_lift_axles } = prepareActiveAxles([
      { id: 'b', position_inches: 100, type: 'drive', current_load_lbs: 10 },
      { id: 'a', position_inches: 40, type: 'steer', current_load_lbs: 12 },
      { id: 'lift', position_inches: 70, type: 'lift', current_load_lbs: 0, lifted: true },
    ])
    expect(active.map((a) => a.id)).toEqual(['a', 'b'])
    expect(skipped_lift_axles).toEqual(['lift'])
  })

  it('clusters on adjacent gaps ≤ 96"', () => {
    const axles: AxleInput[] = [
      { id: '1', position_inches: 0, type: 'steer', current_load_lbs: 0 },
      { id: '2', position_inches: 54, type: 'drive', current_load_lbs: 0 },
      { id: '3', position_inches: 200, type: 'trailer', current_load_lbs: 0 }, // gap 146 > 96
      { id: '4', position_inches: 254, type: 'trailer', current_load_lbs: 0 },
    ]
    const clusters = clusterByAdjacentSpacing(axles)
    expect(clusters).toEqual([[0, 1], [2, 3]])
  })
})

describe('5-axle close tandem vs 10 ft (120") spread', () => {
  it('classifies standard Class-8 close tandems as steer single + two tandems', () => {
    const axles = defaultFiveAxleClass8()
    // drives 54" apart, trailers 54" apart — classic legal tandems
    const analysis = calculateAxleGroups({ axles, states: ['MO'] })
    const types = analysis.groups.map((g) => g.type)
    expect(types).toEqual(['single', 'tandem', 'tandem'])
    expect(analysis.gvw_lbs).toBe(12_000 + 17_000 + 17_000 + 17_000 + 17_000)

    const driveTandem = analysis.groups[1]
    expect(driveTandem.max_legal_lbs).toBeLessThanOrEqual(FEDERAL_TANDEM_LBS)
    expect(driveTandem.compliance_status).toBe('green')
  })

  it('treats 120" (10 ft) trailer spread as weight-win spread halves', () => {
    // Same 5-axle but trailer axles 120" apart instead of 54"
    const axles: AxleInput[] = [
      { id: 'ax1', position_inches: 36, type: 'steer', current_load_lbs: 12_000 },
      { id: 'ax2', position_inches: 180, type: 'drive', current_load_lbs: 17_000 },
      { id: 'ax3', position_inches: 234, type: 'drive', current_load_lbs: 17_000 },
      { id: 'ax4', position_inches: 540, type: 'trailer', current_load_lbs: 17_000 },
      { id: 'ax5', position_inches: 660, type: 'trailer', current_load_lbs: 17_000 }, // 120"
    ]
    const analysis = calculateAxleGroups({ axles, states: ['MO'] })
    const types = analysis.groups.map((g) => g.type)
    // steer single, drive tandem, trailer spread halves
    expect(types).toEqual(['single', 'tandem', 'spread', 'spread'])

    const trailerGroups = analysis.groups.slice(2)
    expect(trailerGroups.every((g) => g.type === 'spread')).toBe(true)
    // Each half legal ~20k; together 40k vs 34k tandem
    const trailerLegalSum = trailerGroups.reduce((s, g) => s + g.max_legal_lbs, 0)
    expect(trailerLegalSum).toBeGreaterThanOrEqual(FEDERAL_SINGLE_LBS * 2)
    expect(trailerLegalSum).toBeGreaterThan(FEDERAL_TANDEM_LBS)

    expect(
      analysis.optimization_tips.some((t) => /weight win/i.test(t) || /120/i.test(t))
    ).toBe(true)
  })

  it('close ≤40" pair collapses to single group', () => {
    const axles: AxleInput[] = [
      { id: 'a', position_inches: 100, type: 'drive', current_load_lbs: 10_000 },
      { id: 'b', position_inches: 100 + CLOSE_COUPLED_MAX_IN, type: 'drive', current_load_lbs: 10_000 },
    ]
    const analysis = calculateAxleGroups({ axles, states: [] })
    expect(analysis.groups).toHaveLength(1)
    expect(analysis.groups[0].type).toBe('single')
    expect(analysis.groups[0].max_legal_lbs).toBe(FEDERAL_SINGLE_LBS)
  })
})

describe('tridem / quad classification', () => {
  it('forms tridem when outer span is between 96" and MO 144"', () => {
    // 60" + 60" = 120" outer
    const axles: AxleInput[] = [
      { id: 't1', position_inches: 0, type: 'trailer', current_load_lbs: 14_000 },
      { id: 't2', position_inches: 60, type: 'trailer', current_load_lbs: 14_000 },
      { id: 't3', position_inches: 120, type: 'trailer', current_load_lbs: 14_000 },
    ]
    const analysis = calculateAxleGroups({ axles, states: ['MO'] })
    expect(analysis.groups).toHaveLength(1)
    expect(analysis.groups[0].type).toBe('tridem')
    expect(analysis.groups[0].outer_span_inches).toBe(120)
  })

  it('KS tridem max ~132" rejects wider span as peel-to-tandem', () => {
    // outer 140" > KS 132
    const axles: AxleInput[] = [
      { id: 't1', position_inches: 0, type: 'trailer', current_load_lbs: 14_000 },
      { id: 't2', position_inches: 70, type: 'trailer', current_load_lbs: 14_000 },
      { id: 't3', position_inches: 140, type: 'trailer', current_load_lbs: 14_000 },
    ]
    const ks = calculateAxleGroups({ axles, states: ['KS'] })
    // Cannot be one tridem under KS — should peel
    expect(ks.groups[0].type).not.toBe('tridem')

    const mo = calculateAxleGroups({ axles, states: ['MO'] })
    // MO allows 144" — 140" fits tridem
    expect(mo.groups[0].type).toBe('tridem')
  })

  it('forms quad when 4 axles outer ≤ MO 192"', () => {
    const axles: AxleInput[] = [
      { id: 'q1', position_inches: 0, type: 'trailer', current_load_lbs: 12_000 },
      { id: 'q2', position_inches: 54, type: 'trailer', current_load_lbs: 12_000 },
      { id: 'q3', position_inches: 108, type: 'trailer', current_load_lbs: 12_000 },
      { id: 'q4', position_inches: 162, type: 'trailer', current_load_lbs: 12_000 },
    ]
    const analysis = calculateAxleGroups({ axles, states: ['MO'] })
    expect(analysis.groups).toHaveLength(1)
    expect(analysis.groups[0].type).toBe('quad')
    expect(analysis.groups[0].outer_span_inches).toBe(162)
  })
})

describe('multi-state rules', () => {
  it('merges defaults for corridor states', () => {
    const rules = mergeStateRules(['mo', 'KS', 'TX'])
    expect(Object.keys(rules).sort()).toEqual(['KS', 'MO', 'TX'])
    expect(rules.KS.tridem_max_span_in).toBe(132)
    expect(rules.MO.tridem_max_span_in).toBe(144)
    expect(DEFAULT_STATE_RULES.FL.tandem_cap_lbs).toBe(44_000)
  })

  it('uses most restrictive legal across states with exact limiting_state', () => {
    // Florida allows higher tandem; MO is 34k — multi-state should take min and tag MO
    const axles: AxleInput[] = [
      { id: 'a', position_inches: 0, type: 'drive', current_load_lbs: 17_000 },
      { id: 'b', position_inches: 54, type: 'drive', current_load_lbs: 17_000 },
    ]
    const flOnly = calculateAxleGroups({ axles, states: ['FL'] })
    const multi = calculateAxleGroups({ axles, states: ['FL', 'MO'] })
    expect(flOnly.groups[0].max_legal_lbs).toBeGreaterThan(FEDERAL_TANDEM_LBS)
    expect(multi.groups[0].max_legal_lbs).toBe(FEDERAL_TANDEM_LBS)
    expect(multi.groups[0].limiting_state).toBe('MO')
    expect(multi.optimization_tips.some((t) => /multi-state/i.test(t))).toBe(true)
  })

  it('applies federal defaults when no states selected', () => {
    const analysis = calculateAxleGroups({
      axles: [{ id: 's', position_inches: 0, type: 'steer', current_load_lbs: 11_000 }],
      states: [],
    })
    expect(analysis.groups[0].max_legal_lbs).toBe(FEDERAL_SINGLE_LBS)
    expect(analysis.states).toEqual([])
  })
})

describe('0-load and violations', () => {
  it('handles 0-load axles without throwing and tips incompleteness', () => {
    const axles: AxleInput[] = [
      { id: 'a', position_inches: 0, type: 'steer', current_load_lbs: 0 },
      { id: 'b', position_inches: 54, type: 'drive', current_load_lbs: 0 },
    ]
    const analysis = calculateAxleGroups({ axles, states: ['IL'] })
    expect(analysis.gvw_lbs).toBe(0)
    expect(analysis.groups[0].compliance_status).toBe('green') // 0 ≤ legal
    expect(analysis.optimization_tips.some((t) => /0 lbs/i.test(t))).toBe(true)
  })

  it('marks red when load exceeds permit band', () => {
    const axles: AxleInput[] = [
      { id: 'a', position_inches: 0, type: 'drive', current_load_lbs: 30_000 },
      { id: 'b', position_inches: 54, type: 'drive', current_load_lbs: 30_000 },
    ]
    const analysis = calculateAxleGroups({ axles, states: ['MO'] })
    expect(analysis.groups[0].compliance_status).toBe('red')
    expect(analysis.overall_compliance).toBe('red')
    expect(analysis.violation_count).toBeGreaterThanOrEqual(1)
  })
})

describe('parseAxleInputs', () => {
  it('rejects non-array / empty / bad ranges', () => {
    expect(parseAxleInputs(null).ok).toBe(false)
    expect(parseAxleInputs([]).ok).toBe(false)
    expect(
      parseAxleInputs([{ id: 'x', position_inches: -1, type: 'steer', current_load_lbs: 0 }]).ok
    ).toBe(false)
    expect(
      parseAxleInputs([{ id: 'x', position_inches: 10, type: 'steer', current_load_lbs: -5 }]).ok
    ).toBe(false)
  })

  it('rejects more than 20 axles and position > 2400', () => {
    const tooMany = Array.from({ length: 21 }, (_, i) => ({
      id: `a${i}`,
      position_inches: i * 10,
      type: 'trailer',
      current_load_lbs: 0,
    }))
    expect(parseAxleInputs(tooMany).ok).toBe(false)
    expect(parseAxleInputs(tooMany).error).toMatch(/20/)
    expect(
      parseAxleInputs([{ id: 'x', position_inches: 2401, type: 'steer', current_load_lbs: 0 }]).ok
    ).toBe(false)
  })

  it('accepts valid payload', () => {
    const r = parseAxleInputs([
      { id: 'ax1', position_inches: 36, type: 'steer', current_load_lbs: 12_000 },
    ])
    expect(r.ok).toBe(true)
    expect(r.axles[0].type).toBe('steer')
  })
})

describe('formSpacingGroups + permit_json', () => {
  it('emits permit-ready JSON shape', () => {
    const analysis = calculateAxleGroups({
      axles: defaultFiveAxleClass8(),
      states: ['MO', 'KS'],
    })
    expect(analysis.permit_json.version).toBe(1)
    expect(analysis.permit_json.engine).toBe('axleGroupCalculator')
    expect(Array.isArray(analysis.permit_json.groups)).toBe(true)
    expect(analysis.states).toEqual(['MO', 'KS'])
    expect(analysis.gross_legal_lbs).toBeLessThanOrEqual(80_000)
    expect(analysis.vehicle_bridge_formula?.applicable).toBe(true)
  })

  it('TANDEM_MAX_IN is federal 96', () => {
    expect(TANDEM_MAX_IN).toBe(96)
  })

  it('formSpacingGroups returns draft without scores', () => {
    const { active } = prepareActiveAxles(defaultFiveAxleClass8())
    const draft = formSpacingGroups(active, mergeStateRules(['MO']))
    expect(draft.length).toBe(3)
    expect(draft[0]).not.toHaveProperty('max_legal_lbs')
  })
})

describe('classifier regressions', () => {
  it('A@0 B@30 C@110 peels close single then remainder (not tridem)', () => {
    const axles: AxleInput[] = [
      { id: 'A', position_inches: 0, type: 'drive', current_load_lbs: 10_000 },
      { id: 'B', position_inches: 30, type: 'drive', current_load_lbs: 10_000 },
      { id: 'C', position_inches: 110, type: 'drive', current_load_lbs: 10_000 },
    ]
    const analysis = calculateAxleGroups({ axles, states: ['MO'] })
    expect(analysis.groups.map((g) => g.type)).toEqual(['single', 'single'])
    expect(analysis.groups[0].axle_ids).toEqual(['A', 'B'])
    expect(analysis.groups[1].axle_ids).toEqual(['C'])
    // Capacity is 20k + 20k, not a 42k tridem
    expect(analysis.groups.reduce((s, g) => s + g.max_legal_lbs, 0)).toBe(
      FEDERAL_SINGLE_LBS * 2
    )
  })

  it('three axles within 96" form bridge-capped tridem not tandem+single (54k)', () => {
    // 0, 48, 90 — outer 90" ≤ 96; peeling tandem+single would allow 34k+20k=54k
    const axles: AxleInput[] = [
      { id: 'a', position_inches: 0, type: 'trailer', current_load_lbs: 14_000 },
      { id: 'b', position_inches: 48, type: 'trailer', current_load_lbs: 14_000 },
      { id: 'c', position_inches: 90, type: 'trailer', current_load_lbs: 14_000 },
    ]
    const analysis = calculateAxleGroups({ axles, states: ['MO'] })
    expect(analysis.groups).toHaveLength(1)
    expect(analysis.groups[0].type).toBe('tridem')
    expect(analysis.groups[0].bridge_formula?.applicable).toBe(true)
    // Bridge on L=7.5 ft N=3 → 41,625; tridem cap 42k → min is bridge
    const expectedBridge = federalBridgeFormulaLbs(90 / 12, 3).W_lbs
    expect(analysis.groups[0].max_legal_lbs).toBe(expectedBridge)
    expect(analysis.groups[0].max_legal_lbs).toBeLessThan(FEDERAL_TANDEM_LBS + FEDERAL_SINGLE_LBS)
  })

  it('bridge formula binds tandem legal below inflated spacing cap when tight', () => {
    // Very tight tandem 42" = 3.5 ft: W = 500*[(3.5*2)/1 + 24+36] = 500*67 = 33,500
    const axles: AxleInput[] = [
      { id: 'a', position_inches: 0, type: 'drive', current_load_lbs: 17_000 },
      { id: 'b', position_inches: 42, type: 'drive', current_load_lbs: 17_000 },
    ]
    const analysis = calculateAxleGroups({ axles, states: ['MO'] })
    expect(analysis.groups[0].type).toBe('tandem')
    expect(analysis.groups[0].bridge_formula?.W_lbs).toBe(33_500)
    expect(analysis.groups[0].max_legal_lbs).toBe(33_500)
  })

  it('all-lifted axles are yellow overall not green', () => {
    const analysis = calculateAxleGroups({
      axles: [
        { id: 'a', position_inches: 0, type: 'lift', current_load_lbs: 0, lifted: true },
        { id: 'b', position_inches: 54, type: 'lift', current_load_lbs: 0, lifted: true },
      ],
      states: ['MO'],
    })
    expect(analysis.groups).toHaveLength(0)
    expect(analysis.overall_compliance).toBe('yellow')
    expect(analysis.gross_legal_lbs).toBe(0)
  })

  it('sanitizeStateRules drops negative/NaN caps', () => {
    const cleaned = sanitizeStateRules(
      {
        MO: { tandem_cap_lbs: -1, single_cap_lbs: 20_000 },
        XX: { tandem_cap_lbs: 99_000 },
        FL: { tandem_cap_lbs: Number.NaN, notes: 'ok' },
      },
      ['MO', 'FL']
    )
    expect(cleaned).not.toBeNull()
    expect(cleaned!.MO.tandem_cap_lbs).toBe(DEFAULT_STATE_RULES.MO.tandem_cap_lbs)
    expect(cleaned!.MO.single_cap_lbs).toBe(20_000)
    expect(cleaned!.XX).toBeUndefined()
    expect(cleaned!.FL.tandem_cap_lbs).toBe(DEFAULT_STATE_RULES.FL.tandem_cap_lbs)
  })

  it('overall is not green when GVW exceeds vehicle bridge / gross', () => {
    // Long combination with high loads: sum of group legals can look ok while gross is red
    const axles: AxleInput[] = [
      { id: 's', position_inches: 0, type: 'steer', current_load_lbs: 12_000 },
      { id: 'd1', position_inches: 180, type: 'drive', current_load_lbs: 17_000 },
      { id: 'd2', position_inches: 234, type: 'drive', current_load_lbs: 17_000 },
      { id: 't1', position_inches: 540, type: 'trailer', current_load_lbs: 20_000 },
      { id: 't2', position_inches: 594, type: 'trailer', current_load_lbs: 20_000 },
    ]
    // Push GVW over 80k
    axles[0].current_load_lbs = 20_000
    axles[1].current_load_lbs = 20_000
    axles[2].current_load_lbs = 20_000
    axles[3].current_load_lbs = 20_000
    axles[4].current_load_lbs = 20_000
    const analysis = calculateAxleGroups({ axles, states: ['MO'] })
    expect(analysis.gvw_lbs).toBe(100_000)
    expect(analysis.gross_legal_lbs).toBeLessThanOrEqual(80_000)
    expect(analysis.overall_compliance).not.toBe('green')
  })
})

describe('intermediate consecutive bridge windows', () => {
  it('flags intermediate window (axles 2–5) even when full span is long', () => {
    // Tight heavy cluster in the middle: positions 0, 100, 140, 180, 220, 600
    // Window idx 1–4: outer 120", N=4, heavy loads → bridge fail while full vehicle may look OK on spacing alone
    const axles: AxleInput[] = [
      { id: 'a1', position_inches: 0, type: 'steer', current_load_lbs: 5_000 },
      { id: 'a2', position_inches: 100, type: 'drive', current_load_lbs: 22_000 },
      { id: 'a3', position_inches: 140, type: 'drive', current_load_lbs: 22_000 },
      { id: 'a4', position_inches: 180, type: 'trailer', current_load_lbs: 22_000 },
      { id: 'a5', position_inches: 220, type: 'trailer', current_load_lbs: 22_000 },
      { id: 'a6', position_inches: 600, type: 'trailer', current_load_lbs: 5_000 },
    ]
    const { windows, violations, worst } = evaluateConsecutiveBridgeWindows(axles)
    expect(windows.length).toBeGreaterThan(1)
    const mid = windows.find((w) => w.start_index === 1 && w.end_index === 4)
    expect(mid).toBeDefined()
    expect(mid!.bridge.N).toBe(4)
    expect(mid!.load_lbs).toBe(88_000)
    // L = 120/12 = 10 ft, N=4 → W = 500*[(10*4)/3 + 48+36] = 500*(13.333+84) = 500*97.333 ≈ 48666
    expect(mid!.bridge.W_lbs).toBeLessThan(88_000)
    expect(mid!.compliance_status).toBe('red')
    expect(violations.some((v) => v.start_index === 1 && v.end_index === 4)).toBe(true)
    expect(worst?.compliance_status).toBe('red')

    const analysis = calculateAxleGroups({ axles, states: [] })
    expect(analysis.overall_compliance).toBe('red')
    expect(analysis.bridge_window_violations.length).toBeGreaterThan(0)
    expect(analysis.worst_bridge_window?.start_index).toBeDefined()
    expect(analysis.optimization_tips.some((t) => /bridge window/i.test(t))).toBe(true)
  })

  it('yellow soft band on intermediate window when load is between W and 1.25W', () => {
    // Two axles 48" (4 ft): W = 34,000. Load 36,000 → yellow
    const axles: AxleInput[] = [
      { id: 'x', position_inches: 0, type: 'drive', current_load_lbs: 18_000 },
      { id: 'y', position_inches: 48, type: 'drive', current_load_lbs: 18_000 },
    ]
    const { windows } = evaluateConsecutiveBridgeWindows(axles)
    expect(windows).toHaveLength(1)
    expect(windows[0].bridge.W_lbs).toBe(34_000)
    expect(windows[0].compliance_status).toBe('yellow')
    const analysis = calculateAxleGroups({ axles, states: ['MO'] })
    // Group tandem also yellow; overall not green
    expect(analysis.overall_compliance).toBe('yellow')
  })
})

describe('save/load selected states (federal empty)', () => {
  it('buildStateRulesForSave empty states stores federal only + meta []', () => {
    const stored = buildStateRulesForSave([])
    expect(stored[SELECTED_STATES_META_KEY]).toEqual([])
    expect(stored.US).toBeDefined()
    expect(stored.MO).toBeUndefined()
    expect(Object.keys(stored).filter((k) => k !== 'US' && !k.startsWith('_'))).toEqual([])
  })

  it('buildStateRulesForSave only includes selected corridor states', () => {
    const stored = buildStateRulesForSave(['MO', 'ks'])
    expect(stored[SELECTED_STATES_META_KEY]).toEqual(['MO', 'KS'])
    expect(stored.MO).toBeDefined()
    expect(stored.KS).toBeDefined()
    expect(stored.TX).toBeUndefined()
  })

  it('restoreSelectedStatesFromSaved prefers _selected_states including empty', () => {
    expect(
      restoreSelectedStatesFromSaved({
        US: DEFAULT_STATE_RULES.MO,
        [SELECTED_STATES_META_KEY]: [],
        MO: DEFAULT_STATE_RULES.MO, // should be ignored when meta present
      })
    ).toEqual([])
    expect(
      restoreSelectedStatesFromSaved({
        MO: DEFAULT_STATE_RULES.MO,
        KS: DEFAULT_STATE_RULES.KS,
        [SELECTED_STATES_META_KEY]: ['TX'],
      })
    ).toEqual(['TX'])
  })

  it('legacy restore uses corridor keys excluding US', () => {
    expect(
      restoreSelectedStatesFromSaved({
        US: { ...DEFAULT_STATE_RULES.MO },
        MO: DEFAULT_STATE_RULES.MO,
      })
    ).toEqual(['MO'])
  })
})
