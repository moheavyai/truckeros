import { describe, expect, it } from 'vitest'
import type { StatePermitRule } from '@/types/permit'
import {
  DEFAULT_SINGLE_AXLE_LBS,
  MAX_TOTAL_AXLES,
  TANDEM_MAX_SPACING_IN,
  assignAxleGroups,
  buildCombinationAdjacentSpacingsIn,
  buildRigAxleSnapshot,
  classifyGroupAxleConfig,
  displayGroupWeightLimitLbs,
  normalizeAxleSpacingSlots,
  checkCorridorScale,
  checkScaleAbility,
  defaultGroupWeightLimitLbs,
  distributeWeightByGroupLimits,
  distributeWeightSteerFirst,
  distributeWeightToGroup,
  formatAxleGroupSummaryLine,
  formatScaleFindingsForAgent,
  groupTypeForAxleIndex,
  mergeConsecutiveSameTypeGroups,
  resolveAxleGroupsFromConfig,
  resolveDeclaredAxleCount,
  sumGroupWeightLbs,
  withinGroupSpacingsFromCombination,
} from './axle-groups'

describe('defaultGroupWeightLimitLbs', () => {
  it('uses tighter steer limit', () => {
    expect(defaultGroupWeightLimitLbs('steer', 1)).toBe(12_000)
  })

  it('uses tandem/tridem for multi-axle groups', () => {
    expect(defaultGroupWeightLimitLbs('drives', 2)).toBe(34_000)
    expect(defaultGroupWeightLimitLbs('trailer', 3)).toBe(42_000)
    expect(defaultGroupWeightLimitLbs('jeep', 2)).toBe(34_000)
  })
})

describe('assignAxleGroups', () => {
  it('assigns steer + drives on a 3-axle tractor', () => {
    const summary = assignAxleGroups({ num_axles: 3 }, [])
    expect(summary.totalAxles).toBe(3)
    expect(summary.groups.map((g) => g.type)).toEqual(['steer', 'drives'])
    expect(summary.groups[0].axleCount).toBe(1)
    expect(summary.groups[1].axleCount).toBe(2)
    expect(summary.axleTypes).toEqual(['steer', 'drives', 'drives'])
  })

  it('classifies jeep / trailer / flip roles from trailer_type', () => {
    const summary = assignAxleGroups(
      { num_axles: 3 },
      [
        { num_axles: 2, trailer_type: 'Jeep' },
        { num_axles: 3, trailer_type: 'RGN' },
        { num_axles: 2, trailer_type: 'Flip' },
      ]
    )
    expect(summary.groups.map((g) => g.type)).toEqual([
      'steer',
      'drives',
      'jeep',
      'trailer',
      'flip',
    ])
    expect(summary.totalAxles).toBe(3 + 2 + 3 + 2)
  })

  it('classifies stinger separately from flip', () => {
    const summary = assignAxleGroups(
      { num_axles: 3 },
      [
        { num_axles: 2, trailer_type: 'RGN' },
        { num_axles: 2, trailer_type: 'Stinger' },
      ]
    )
    expect(summary.groups.map((g) => g.type)).toContain('stinger')
    expect(summary.groups.find((g) => g.type === 'stinger')?.axleCount).toBe(2)
  })

  it('caps total axles at 13', () => {
    const summary = assignAxleGroups(
      { num_axles: 6 },
      [
        { num_axles: 4, trailer_type: 'Jeep' },
        { num_axles: 4, trailer_type: 'RGN' },
        { num_axles: 4, trailer_type: 'Flip' },
      ]
    )
    expect(summary.totalAxles).toBe(MAX_TOTAL_AXLES)
    expect(summary.capped).toBe(true)
  })

  it('handles trailer-only mode', () => {
    const summary = assignAxleGroups(null, [{ num_axles: 3, trailer_type: 'Flatbed' }])
    expect(summary.totalAxles).toBe(3)
    expect(summary.groups[0].type).toBe('trailer')
  })

  it('does not coerce explicit num_axles 0 to default 2/3', () => {
    const summary = assignAxleGroups({ num_axles: 0 }, [{ num_axles: 0, trailer_type: 'Flatbed' }])
    expect(summary.totalAxles).toBe(0)
    expect(summary.groups).toHaveLength(0)
  })

  it('merges consecutive same-role trailer units for capacity', () => {
    const summary = assignAxleGroups(
      { num_axles: 3 },
      [
        { num_axles: 2, trailer_type: 'Flatbed' },
        { num_axles: 2, trailer_type: 'Step Deck' },
      ]
    )
    // Both main trailers merge into one trailer group (4 axles)
    expect(summary.groups.filter((g) => g.type === 'trailer')).toHaveLength(1)
    expect(summary.groups.find((g) => g.type === 'trailer')?.axleCount).toBe(4)
  })

  it('groupTypeForAxleIndex returns correct labels', () => {
    const summary = assignAxleGroups({ num_axles: 3 }, [{ num_axles: 2, trailer_type: 'Step Deck' }])
    expect(groupTypeForAxleIndex(summary, 0)).toBe('steer')
    expect(groupTypeForAxleIndex(summary, 2)).toBe('drives')
    expect(groupTypeForAxleIndex(summary, 3)).toBe('trailer')
    expect(groupTypeForAxleIndex(summary, 99)).toBeNull()
  })
})

describe('resolveAxleGroupsFromConfig', () => {
  it('uses 3+1 for 4-axle synthetic (UI alignment)', () => {
    const s = resolveAxleGroupsFromConfig({ axles: 4 })
    expect(s.totalAxles).toBe(4)
    expect(s.groups.map((g) => g.type)).toEqual(['steer', 'drives', 'trailer'])
    expect(s.groups.find((g) => g.type === 'drives')?.axleCount).toBe(2)
    expect(s.groups.find((g) => g.type === 'trailer')?.axleCount).toBe(1)
  })

  it('uses 3+(n-3) for 5+ synthetic', () => {
    const s = resolveAxleGroupsFromConfig({ axles: 5 })
    expect(s.totalAxles).toBe(5)
    expect(s.groups.find((g) => g.type === 'trailer')?.axleCount).toBe(2)
  })

  it('returns empty for 0 / missing axles', () => {
    expect(resolveAxleGroupsFromConfig({ axles: 0 }).totalAxles).toBe(0)
    expect(resolveAxleGroupsFromConfig({}).totalAxles).toBe(0)
  })

  it('prefers equipment over synthetic axles', () => {
    const s = resolveAxleGroupsFromConfig({
      axles: 5,
      tractor: { num_axles: 3 },
      trailers: [{ num_axles: 2, trailer_type: 'Jeep' }],
    })
    expect(s.groups.map((g) => g.type)).toContain('jeep')
  })
})

describe('buildRigAxleSnapshot', () => {
  it('captures role groups, spacings, kingpin, and lift flags for prefill', () => {
    const snap = buildRigAxleSnapshot(
      { num_axles: 3, axle_spacings: [220, 48] },
      [
        {
          num_axles: 2,
          trailer_type: 'Flatbed',
          axle_spacings: [49],
          kingpin_to_first_axle_in: 480,
          has_lift_axle: true,
        },
      ]
    )
    expect(snap.totalAxles).toBe(5)
    expect(snap.groups.groups.map((g) => g.type)).toEqual(['steer', 'drives', 'trailer'])
    expect(snap.groupLine).toMatch(/5 axles/)
    expect(snap.tractorSpacingsIn).toEqual([220, 48])
    expect(snap.trailerSpacingsIn).toEqual([[49]])
    expect(snap.kingpinToFirstAxleIn).toEqual([480])
    expect(snap.trailerHasLiftAxle).toEqual([true])
  })

  it('handles empty equipment without inventing spacings', () => {
    const snap = buildRigAxleSnapshot(null, [])
    expect(snap.totalAxles).toBe(0)
    expect(snap.tractorSpacingsIn).toEqual([])
    expect(snap.trailerSpacingsIn).toEqual([])
  })

  it('preserves middle zero spacing slots (no index collapse)', () => {
    const snap = buildRigAxleSnapshot(
      { num_axles: 4, axle_spacings: [220, 0, 48] },
      [{ num_axles: 3, axle_spacings: [49, 0], trailer_type: 'Flatbed' }]
    )
    // 4-axle tractor → 3 gap slots; middle cleared stays 0 at index 1
    expect(snap.tractorSpacingsIn).toEqual([220, 0, 48])
    expect(snap.trailerSpacingsIn).toEqual([[49, 0]])
  })
})

describe('normalizeAxleSpacingSlots', () => {
  it('does not compact middle zeros and pads to expectedLength', () => {
    expect(normalizeAxleSpacingSlots([220, 0, 48])).toEqual([220, 0, 48])
    expect(normalizeAxleSpacingSlots([220, 48, 0])).toEqual([220, 48])
    expect(normalizeAxleSpacingSlots([220], 3)).toEqual([220, 0, 0])
    expect(normalizeAxleSpacingSlots('220,,48')).toEqual([220, 0, 48])
  })
})

describe('distributeWeightByGroupLimits', () => {
  it('keeps steer at or under 12k on an 80k 5-axle legal load', () => {
    const groups = resolveAxleGroupsFromConfig({ axles: 5 }).groups
    const w = distributeWeightByGroupLimits(groups, 80_000)
    expect(w).toHaveLength(5)
    expect(w[0]).toBeLessThanOrEqual(12_000)
    expect(w.reduce((a, b) => a + b, 0)).toBe(80_000)
    // Should not false-fail scale
    const scale = checkScaleAbility({ groups, axleWeights: w, totalWeightLbs: 80_000 })
    expect(scale.findings.some((f) => f.code === 'group_over')).toBe(false)
  })
})

describe('distributeWeightSteerFirst', () => {
  it('fixes steer at 12k and even-splits remainder (80k / 5 axles)', () => {
    const w = distributeWeightSteerFirst(5, 80_000)
    expect(w).toEqual([12_000, 17_000, 17_000, 17_000, 17_000])
    expect(w.reduce((a, b) => a + b, 0)).toBe(80_000)
  })

  it('preserves exact sum when remainder is not evenly divisible', () => {
    const w = distributeWeightSteerFirst(5, 80_001)
    expect(w[0]).toBe(12_000)
    expect(w).toHaveLength(5)
    expect(w.reduce((a, b) => a + b, 0)).toBe(80_001)
    // 68_001 / 4 = 17_000 remainder 1 → one axle gets +1
    expect(w.slice(1).sort((a, b) => a - b)).toEqual([17_000, 17_000, 17_000, 17_001])
  })

  it('preserves sum for odd axle counts (7 axles @ 80k)', () => {
    const w = distributeWeightSteerFirst(7, 80_000)
    expect(w[0]).toBe(12_000)
    expect(w).toHaveLength(7)
    expect(w.reduce((a, b) => a + b, 0)).toBe(80_000)
  })

  it('uses steer group indexes from groups when provided', () => {
    const groups = resolveAxleGroupsFromConfig({ axles: 5 }).groups
    const w = distributeWeightSteerFirst(5, 80_000, groups)
    expect(w[0]).toBe(12_000)
    expect(w.slice(1).every((x) => x === 17_000)).toBe(true)
  })

  it('clamps steer when total is under 12k', () => {
    const w = distributeWeightSteerFirst(5, 10_000)
    expect(w[0]).toBe(10_000)
    expect(w.slice(1).every((x) => x === 0)).toBe(true)
    expect(w.reduce((a, b) => a + b, 0)).toBe(10_000)
  })

  it('puts all weight on steer when only one axle', () => {
    expect(distributeWeightSteerFirst(1, 15_000)).toEqual([15_000])
  })

  it('even-splits when no steer group (trailer-only)', () => {
    const groups = assignAxleGroups(null, [{ num_axles: 3, trailer_type: 'Flatbed' }]).groups
    const w = distributeWeightSteerFirst(3, 30_000, groups)
    expect(w).toEqual([10_000, 10_000, 10_000])
  })

  it('returns zeros for non-positive inputs', () => {
    expect(distributeWeightSteerFirst(0, 80_000)).toEqual([])
    expect(distributeWeightSteerFirst(5, 0)).toEqual([0, 0, 0, 0, 0])
  })

  it('splits multi-steer 12k combined evenly across steer axles', () => {
    // Synthetic: force two-axle steer by merging is not normal; build groups manually
    const groups = [
      {
        type: 'steer' as const,
        axleIndexes: [0, 1],
        axleCount: 2,
        label: 'Steer',
        source: 'tractor' as const,
      },
      {
        type: 'drives' as const,
        axleIndexes: [2, 3],
        axleCount: 2,
        label: 'Drives',
        source: 'tractor' as const,
      },
    ]
    const w = distributeWeightSteerFirst(4, 40_000, groups)
    // 12k combined on steer → 6k each; remainder 28k / 2 = 14k each
    expect(w).toEqual([6_000, 6_000, 14_000, 14_000])
    expect(w[0]).toBe(w[1])
    expect(w[0] + w[1]).toBe(12_000)
    expect(w.reduce((a, b) => a + b, 0)).toBe(40_000)
  })

  it('at exact 12k boundary puts all weight on steer', () => {
    const w = distributeWeightSteerFirst(5, 12_000)
    expect(w).toEqual([12_000, 0, 0, 0, 0])
    expect(w.reduce((a, b) => a + b, 0)).toBe(12_000)
  })
})

describe('sumGroupWeightLbs', () => {
  const drives = {
    type: 'drives' as const,
    axleIndexes: [1, 2],
    axleCount: 2,
    label: 'Drives',
    source: 'tractor' as const,
  }

  it('includes zeros so display matches entered fields', () => {
    expect(sumGroupWeightLbs(drives, [12_000, 0, 17_000])).toBe(17_000)
    expect(sumGroupWeightLbs(drives, [12_000, 0, 0])).toBe(0)
  })

  it('includes negative finite values (does not skip non-positive)', () => {
    expect(sumGroupWeightLbs(drives, [12_000, -100, 500])).toBe(400)
  })
})

describe('distributeWeightToGroup', () => {
  const drives = {
    type: 'drives' as const,
    axleIndexes: [1, 2],
    axleCount: 2,
    label: 'Drives',
    source: 'tractor' as const,
  }

  it('even-splits group total and leaves other axles unchanged', () => {
    const next = distributeWeightToGroup([12_000, 10_000, 10_000, 17_000, 17_000], drives, 34_000, 5)
    expect(next[0]).toBe(12_000)
    expect(next[1]).toBe(17_000)
    expect(next[2]).toBe(17_000)
    expect(next[3]).toBe(17_000)
    expect(next[4]).toBe(17_000)
    expect(sumGroupWeightLbs(drives, next)).toBe(34_000)
  })

  it('puts remainder on earlier axles so sum matches exactly', () => {
    const next = distributeWeightToGroup([0, 0, 0], drives, 34_001, 3)
    expect(next[1] + next[2]).toBe(34_001)
    expect(next[1]).toBe(17_001)
    expect(next[2]).toBe(17_000)
  })

  it('handles zero total and empty group indexes', () => {
    const empty = {
      type: 'drives' as const,
      axleIndexes: [] as number[],
      axleCount: 0,
      label: 'Drives',
      source: 'tractor' as const,
    }
    expect(distributeWeightToGroup([1, 2, 3], empty, 10_000, 3)).toEqual([1, 2, 3])
    expect(distributeWeightToGroup([12_000, 1, 1], drives, 0, 3)).toEqual([12_000, 0, 0])
  })
})

describe('classifyGroupAxleConfig + combination spacings', () => {
  const drives = {
    type: 'drives' as const,
    axleIndexes: [1, 2],
    axleCount: 2,
    label: 'Drives',
    source: 'tractor' as const,
  }
  const trailer = {
    type: 'trailer' as const,
    axleIndexes: [3, 4],
    axleCount: 2,
    label: 'Trailer',
    source: 'trailer' as const,
    trailerIndex: 0,
  }
  const steer = {
    type: 'steer' as const,
    axleIndexes: [0],
    axleCount: 1,
    label: 'Steer',
    source: 'tractor' as const,
  }
  const tridem = {
    type: 'trailer' as const,
    axleIndexes: [3, 4, 5],
    axleCount: 3,
    label: 'Trailer',
    source: 'trailer' as const,
    trailerIndex: 0,
  }
  const quadMerged = {
    type: 'trailer' as const,
    axleIndexes: [3, 4, 5, 6],
    axleCount: 4,
    label: 'Trailer',
    source: 'trailer' as const,
  }

  it('classifies single / tandem / spread / unknown', () => {
    expect(classifyGroupAxleConfig(steer).kind).toBe('single')
    expect(classifyGroupAxleConfig(drives, [54]).kind).toBe('tandem')
    expect(classifyGroupAxleConfig(trailer, [120]).kind).toBe('spread')
    expect(classifyGroupAxleConfig(drives, []).kind).toBe('unknown')
    expect(TANDEM_MAX_SPACING_IN).toBe(96)
  })

  it('treats 96" boundary as tandem and >96 as spread', () => {
    expect(classifyGroupAxleConfig(drives, [96]).kind).toBe('tandem')
    expect(classifyGroupAxleConfig(drives, [96.01]).kind).toBe('spread')
    expect(classifyGroupAxleConfig(drives, [97]).kind).toBe('spread')
  })

  it('does not false-label tandem/tridem from partial gaps or zeros', () => {
    // Partial: only one of two tridem gaps known (and ≤96) → unknown, not tridem
    expect(classifyGroupAxleConfig(tridem, [54]).kind).toBe('unknown')
    expect(classifyGroupAxleConfig(tridem, [54, 0]).kind).toBe('unknown')
    // Full close vector → tridem
    expect(classifyGroupAxleConfig(tridem, [54, 54]).kind).toBe('tridem')
    // Partial with a known spread gap still reports spread
    expect(classifyGroupAxleConfig(tridem, [54, 120]).kind).toBe('spread')
    expect(classifyGroupAxleConfig(tridem, [0, 120]).kind).toBe('spread')
  })

  it('does not false-label quad when multi-unit cross gap is 0', () => {
    // Two 2-axle trailers merged into one 4-axle trailer group; middle gap is cross-unit 0
    const within = [54, 0, 54]
    expect(classifyGroupAxleConfig(quadMerged, within).kind).toBe('unknown')
    expect(classifyGroupAxleConfig(quadMerged, within).kind).not.toBe('quad')
    // Full known close vector still allowed
    expect(classifyGroupAxleConfig(quadMerged, [48, 48, 48]).kind).toBe('quad')
  })

  it('uses 20k×axles display limit for spread, tandem ladder otherwise', () => {
    const spreadCfg = classifyGroupAxleConfig(trailer, [120])
    expect(displayGroupWeightLimitLbs(trailer, spreadCfg)).toBe(DEFAULT_SINGLE_AXLE_LBS * 2)
    const tandemCfg = classifyGroupAxleConfig(drives, [54])
    expect(displayGroupWeightLimitLbs(drives, tandemCfg)).toBe(defaultGroupWeightLimitLbs('drives', 2))
  })

  it('builds combination gaps and within-group slices from rig spacings', () => {
    // 3 tractor + 2 trailer: gaps [steer-d1, d1-d2, cross, t1-t2]
    const comb = buildCombinationAdjacentSpacingsIn({
      totalAxles: 5,
      tractorAxleCount: 3,
      tractorSpacingsIn: [180, 54],
      trailerAxleCounts: [2],
      trailerSpacingsIn: [[120]],
    })
    expect(comb).toEqual([180, 54, 0, 120])
    expect(withinGroupSpacingsFromCombination(drives, comb)).toEqual([54])
    expect(withinGroupSpacingsFromCombination(trailer, comb)).toEqual([120])
    expect(classifyGroupAxleConfig(drives, withinGroupSpacingsFromCombination(drives, comb)).label).toBe(
      'Tandem'
    )
    expect(classifyGroupAxleConfig(trailer, withinGroupSpacingsFromCombination(trailer, comb)).label).toBe(
      'Spread'
    )
  })

  it('maps multi-unit trailer spacings without shifting when using assignAxleGroups defaults', () => {
    // Missing num_axles on units: assignAxleGroups uses tractor 3 / trailer 2 defaults.
    // Spacing builder must use the same defaults so trailer gap lands on combo index 3.
    const summary = assignAxleGroups({} as { num_axles?: number }, [
      { trailer_type: 'Flatbed' } as { num_axles?: number; trailer_type?: string },
    ])
    expect(summary.totalAxles).toBe(5)
    const tractorN = resolveDeclaredAxleCount(undefined, 3)
    const trailerNs = [resolveDeclaredAxleCount(undefined, 2)]
    const comb = buildCombinationAdjacentSpacingsIn({
      totalAxles: summary.totalAxles,
      tractorAxleCount: tractorN,
      tractorSpacingsIn: [180, 54],
      trailerAxleCounts: trailerNs,
      trailerSpacingsIn: [[120]],
    })
    const trailerGroup = summary.groups.find((g) => g.type === 'trailer')!
    const within = withinGroupSpacingsFromCombination(trailerGroup, comb)
    expect(within).toEqual([120])
    expect(classifyGroupAxleConfig(trailerGroup, within).kind).toBe('spread')
  })
})

describe('checkScaleAbility', () => {
  const groups = assignAxleGroups(
    { num_axles: 3 },
    [{ num_axles: 2, trailer_type: 'Flatbed' }]
  ).groups

  it('invents capacity-proportional weights (not steer-first) when axle weights missing', () => {
    // At 100k, capacity-proportional puts ~15k on steer; steer-first keeps 12k.
    const result = checkScaleAbility({ groups, totalWeightLbs: 100_000 })
    const steerCheck = result.groupChecks.find((c) => c.group.type === 'steer')
    expect(steerCheck).toBeTruthy()
    expect(steerCheck!.weightLbs).toBeGreaterThan(12_000)
    const steerFirst = distributeWeightSteerFirst(5, 100_000, groups)
    expect(steerFirst[0]).toBe(12_000)
    expect(steerCheck!.weightLbs).not.toBe(steerFirst[0])
    // Fence: synthetic path still uses capacity distribute, not steer-first
    const capacity = distributeWeightByGroupLimits(groups, 100_000)
    expect(steerCheck!.weightLbs).toBe(capacity[0])
  })

  it('passes when evenly distributed under limits', () => {
    const result = checkScaleAbility({
      groups,
      axleWeights: [12_000, 17_000, 17_000, 12_000, 12_000],
      totalWeightLbs: 70_000,
    })
    expect(result.ableToScale).toBe(true)
    expect(result.findings.filter((f) => f.severity === 'failure')).toHaveLength(0)
  })

  it('does not false-fail legal 80k when no axle weights (uses capacity distribute)', () => {
    const result = checkScaleAbility({
      groups,
      totalWeightLbs: 80_000,
    })
    expect(result.findings.some((f) => f.code === 'group_over')).toBe(false)
    expect(result.ableToScale).toBe(true)
  })

  it('soft-warns when a group exceeds legal but stays under typical OSOW permit ceiling', () => {
    const result = checkScaleAbility({
      groups,
      axleWeights: [20_000, 20_000, 20_000, 20_000, 20_000],
      totalWeightLbs: 100_000,
    })
    // 40k tandem is over 34k legal, under 46k typical permit → warning, not hard fail
    expect(result.ableToScale).toBe(true)
    expect(result.findings.some((f) => f.code === 'group_over' && f.severity === 'warning')).toBe(true)
    expect(result.findings.some((f) => f.severity === 'failure')).toBe(false)
  })

  it('hard-fails when a group exceeds typical OSOW permit ceiling', () => {
    const result = checkScaleAbility({
      groups,
      axleWeights: [12_000, 30_000, 30_000, 30_000, 30_000],
      totalWeightLbs: 132_000,
    })
    // 60k tandem > 46k permit ceiling
    expect(result.ableToScale).toBe(false)
    expect(result.findings.some((f) => f.code === 'group_over' && f.severity === 'failure')).toBe(true)
  })

  it('warns on partial axle weights without inventing group_over on zeros', () => {
    const result = checkScaleAbility({
      groups,
      axleWeights: [12_000, 0, 0, 0, 0],
      totalWeightLbs: 80_000,
    })
    expect(result.findings.some((f) => f.code === 'incomplete_weights')).toBe(true)
    // Incomplete drive/trailer groups must not spuriously fail as group_over
    expect(result.findings.filter((f) => f.code === 'group_over')).toHaveLength(0)
  })


  it('92k on 5-axle is overweight-permit path not hard fail', () => {
    const result = checkScaleAbility({
      groups,
      totalWeightLbs: 92_000,
    })
    expect(result.ableToScale).toBe(true)
    expect(result.findings.some((f) => f.code === 'unable_to_scale' && f.severity === 'failure')).toBe(false)
  })

  it('detects unable_to_scale when gross exceeds combined group capacity', () => {
    const result = checkScaleAbility({
      groups,
      totalWeightLbs: 200_000,
    })
    expect(result.ableToScale).toBe(false)
    expect(result.findings.some((f) => f.code === 'unable_to_scale')).toBe(true)
  })

  it('sumGroupWeightLbs sums indexes', () => {
    const g = groups[1] // drives
    expect(sumGroupWeightLbs(g, [100, 200, 300, 400, 500])).toBe(200 + 300)
  })

  it('empty corridor still reports global findings', () => {
    const result = checkCorridorScale({
      groups,
      totalWeightLbs: 200_000,
      routeCorridor: [],
      ruleMap: new Map(),
    })
    expect(result.findings.some((f) => f.code === 'unable_to_scale')).toBe(true)
  })
})

describe('checkCorridorScale', () => {
  function rule(code: string, legal: number): StatePermitRule {
    return {
      state_code: code,
      state_name: code,
      legal_width_ft: 8.5,
      legal_height_ft: 13.5,
      legal_length_ft: 53,
      legal_weight_lbs: legal,
      permit_threshold_width_ft: 8.5,
      permit_threshold_height_ft: 13.5,
      permit_threshold_length_ft: 53,
      permit_threshold_weight_lbs: legal,
    }
  }

  it('warns when gross exceeds legal but groups can still scale', () => {
    const groups = assignAxleGroups(
      { num_axles: 3 },
      [{ num_axles: 2, trailer_type: 'Flatbed' }]
    ).groups
    const result = checkCorridorScale({
      groups,
      totalWeightLbs: 78_000,
      axleWeights: [12_000, 17_000, 17_000, 16_000, 16_000],
      routeCorridor: ['TX'],
      ruleMap: new Map([['TX', rule('TX', 70_000)]]),
    })
    expect(result.failedStates).not.toContain('TX')
    expect(result.findings.some((f) => f.code === 'corridor_weight' && f.severity === 'warning')).toBe(true)
  })

  it('fails corridor when configuration cannot scale the load', () => {
    const groups = assignAxleGroups(
      { num_axles: 3 },
      [{ num_axles: 2, trailer_type: 'Flatbed' }]
    ).groups
    const result = checkCorridorScale({
      groups,
      totalWeightLbs: 200_000,
      axleWeights: [40_000, 40_000, 40_000, 40_000, 40_000],
      routeCorridor: ['TX', 'OK'],
      ruleMap: new Map([
        ['TX', rule('TX', 80_000)],
        ['OK', rule('OK', 90_000)],
      ]),
    })
    expect(result.failedStates).toContain('TX')
    expect(result.failedStates).toContain('OK')
    expect(result.corridorOk).toBe(false)
    // One corridor summary for config fail — not identical copy per state
    const corridorFails = result.findings.filter(
      (f) => f.code === 'corridor_weight' && f.severity === 'failure'
    )
    expect(corridorFails.length).toBe(1)
    expect(corridorFails[0].message).toMatch(/group capacity|v1/i)
    expect(corridorFails[0].message).toMatch(/TX/)
    expect(corridorFails[0].message).toMatch(/OK/)
  })

  it('structures a 13-axle multi-unit combination (cap)', () => {
    const summary = assignAxleGroups(
      { num_axles: 3 },
      [
        { num_axles: 2, trailer_type: 'Jeep' },
        { num_axles: 4, trailer_type: 'RGN' },
        { num_axles: 2, trailer_type: 'Flip' },
        { num_axles: 4, trailer_type: 'Stinger' },
      ]
    )
    expect(summary.totalAxles).toBe(MAX_TOTAL_AXLES)
    expect(summary.capped).toBe(true)
    expect(summary.groups.map((g) => g.type)).toEqual(
      expect.arrayContaining(['steer', 'drives', 'jeep', 'trailer', 'flip', 'stinger'])
    )
    expect(summary.axleTypes).toHaveLength(MAX_TOTAL_AXLES)
  })

  it('looks up ruleMap keys case-insensitively', () => {
    const groups = resolveAxleGroupsFromConfig({ axles: 5 }).groups
    const result = checkCorridorScale({
      groups,
      totalWeightLbs: 200_000,
      routeCorridor: ['tx'],
      ruleMap: new Map([['tx', rule('tx', 80_000)]]),
    })
    expect(result.failedStates).toContain('TX')
  })
})

describe('format helpers', () => {
  it('formatAxleGroupSummaryLine', () => {
    const summary = assignAxleGroups(
      { num_axles: 3 },
      [{ num_axles: 2, trailer_type: 'RGN' }]
    )
    const line = formatAxleGroupSummaryLine(summary)
    expect(line).toContain('5 axles')
    expect(line).toContain('Steer×1')
    expect(line).toContain('Drives×2')
    expect(line).toContain('Trailer×2')
  })

  it('formatScaleFindingsForAgent state-prefixes failures', () => {
    const { reasons, notes } = formatScaleFindingsForAgent([
      { severity: 'failure', code: 'group_over', message: 'drives over', stateCode: 'TX' },
      { severity: 'warning', code: 'axle_cap', message: 'cap' },
    ])
    expect(reasons[0]).toMatch(/^TX: SCALE FAIL:/)
    expect(notes[0]).toMatch(/SCALE:/)
  })
})

describe('mergeConsecutiveSameTypeGroups', () => {
  it('merges consecutive same types only', () => {
    const merged = mergeConsecutiveSameTypeGroups([
      { type: 'steer', axleIndexes: [0], axleCount: 1, label: 'Steer', source: 'tractor' },
      { type: 'drives', axleIndexes: [1, 2], axleCount: 2, label: 'Drives', source: 'tractor' },
      { type: 'trailer', axleIndexes: [3, 4], axleCount: 2, label: 'Trailer', source: 'trailer', trailerIndex: 0 },
      { type: 'trailer', axleIndexes: [5, 6], axleCount: 2, label: 'Trailer', source: 'trailer', trailerIndex: 1 },
    ])
    expect(merged).toHaveLength(3)
    expect(merged[2].axleCount).toBe(4)
  })
})

describe('resolveDeclaredAxleCount', () => {
  it('keeps explicit zero', () => {
    expect(resolveDeclaredAxleCount(0, 3)).toBe(0)
  })
  it('uses default when missing', () => {
    expect(resolveDeclaredAxleCount(null, 3)).toBe(3)
    expect(resolveDeclaredAxleCount(undefined, 2)).toBe(2)
  })
})
