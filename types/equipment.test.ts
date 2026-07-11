import { describe, expect, it } from 'vitest'
import { computeRoutingEnvelope } from './equipment'

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