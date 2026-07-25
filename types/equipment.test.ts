import { describe, expect, it } from 'vitest'
import {
  computeOverallDimensions,
  computeRigDimensions,
  computeRoutingEnvelope,
  parseAxleSpacings,
} from './equipment'

describe('computeRoutingEnvelope', () => {
  it('length = rig length + front + rear overhangs', () => {
    const env = computeRoutingEnvelope({
      rigLengthFt: 74,
      loadOverhangFrontFt: 3,
      loadOverhangRearFt: 5,
    })
    expect(env.lengthFt).toBe(82)
  })

  it('width = max(trailer width, load width)', () => {
    expect(
      computeRoutingEnvelope({ trailerWidthFt: 8.5, loadWidthFt: 10 }).widthFt
    ).toBe(10)
    expect(
      computeRoutingEnvelope({ trailerWidthFt: 8.5, loadWidthFt: 7 }).widthFt
    ).toBe(8.5)
  })

  it('width uses trailer/rig only when load width is absent (no inflated default)', () => {
    // Legal trailer width 8'6" with no load details must not become ~9'8"
    expect(
      computeRoutingEnvelope({ trailerWidthFt: 8.5 }).widthFt
    ).toBe(8.5)
    expect(
      computeRoutingEnvelope({ trailerWidthFt: 8.5, loadWidthFt: null }).widthFt
    ).toBe(8.5)
    expect(
      computeRoutingEnvelope({ trailerWidthFt: 8.5, loadWidthFt: 0 }).widthFt
    ).toBe(8.5)
    expect(
      computeRoutingEnvelope({ trailerWidthFt: 8.5, loadWidthFt: undefined }).widthFt
    ).toBe(8.5)
    // Call-site shape: blank form string coerced via Number(...) || 0
    expect(
      computeRoutingEnvelope({
        trailerWidthFt: 8.5,
        loadWidthFt: Number('') || 0,
      }).widthFt
    ).toBe(8.5)
  })

  it('width uses load only when trailer width is absent but load width is present', () => {
    expect(computeRoutingEnvelope({ loadWidthFt: 10 }).widthFt).toBe(10)
  })

  it('height = deck height + load height', () => {
    expect(
      computeRoutingEnvelope({ deckHeightFt: 5, loadHeightFt: 9.5 }).heightFt
    ).toBe(14.5)
  })

  it('weight = rig empty + load weight', () => {
    expect(
      computeRoutingEnvelope({ rigEmptyWeightLbs: 35000, loadWeightLbs: 25000 }).weightLbs
    ).toBe(60000)
  })

  it('returns zeros when all inputs are empty', () => {
    expect(computeRoutingEnvelope({})).toEqual({
      lengthFt: 0,
      widthFt: 0,
      heightFt: 0,
      weightLbs: 0,
    })
  })

  it('treats NaN inputs as zero via Number coercion', () => {
    expect(
      computeRoutingEnvelope({
        trailerWidthFt: NaN,
        loadWidthFt: NaN,
        deckHeightFt: NaN,
        loadHeightFt: NaN,
        rigEmptyWeightLbs: NaN,
        loadWeightLbs: NaN,
        rigLengthFt: NaN,
        loadOverhangFrontFt: NaN,
        loadOverhangRearFt: NaN,
      })
    ).toEqual({
      lengthFt: 0,
      widthFt: 0,
      heightFt: 0,
      weightLbs: 0,
    })
  })

  it('includes only front overhang when rear is zero', () => {
    expect(
      computeRoutingEnvelope({ rigLengthFt: 60, loadOverhangFrontFt: 4, loadOverhangRearFt: 0 })
        .lengthFt
    ).toBe(64)
  })
})

describe('computeOverallDimensions axleGroupCount heuristic', () => {
  it('counts steer+drives + one group per trailer unit', () => {
    const d = computeOverallDimensions(
      { num_axles: 3, overall_length_ft: 22 },
      [{ num_axles: 2, overall_length_ft: 53 }]
    )
    // tractor: 2 groups (steer+drives), trailer: 1 → 3
    expect(d.axleGroupCount).toBe(3)
    expect(d.totalAxles).toBe(5)
  })

  it('does not invent groups for explicit zero axles', () => {
    const d = computeOverallDimensions({ num_axles: 0 }, [{ num_axles: 0 }])
    expect(d.axleGroupCount).toBe(0)
  })
})

describe('parseAxleSpacings slot preservation', () => {
  it('does not collapse middle zeros', () => {
    expect(parseAxleSpacings([220, 0, 48])).toEqual([220, 0, 48])
    expect(parseAxleSpacings([220, 48, 0])).toEqual([220, 48])
    expect(parseAxleSpacings([220], 3)).toEqual([220, 0, 0])
    expect(parseAxleSpacings('220,,48')).toEqual([220, 0, 48])
  })
})

describe('computeRigDimensions spacing slots', () => {
  it('keeps axle positions aligned when a middle gap is zero (uses default for geometry)', () => {
    const dims = computeRigDimensions(
      {
        overall_length_ft: 28,
        num_axles: 4,
        steer_axle_setback_in: 36,
        axle_spacings: [220, 0, 48],
      },
      []
    )
    // 4 axles → 4 positions; middle zero gap falls back to 48" so positions stay strictly increasing
    expect(dims.totalAxles).toBe(4)
    expect(dims.axlePositionsFt).toHaveLength(4)
    for (let i = 1; i < dims.axlePositionsFt.length; i++) {
      expect(dims.axlePositionsFt[i]).toBeGreaterThan(dims.axlePositionsFt[i - 1])
    }
  })
})