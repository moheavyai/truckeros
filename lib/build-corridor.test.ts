import { describe, expect, it } from 'vitest'
import {
  buildCorridorFromSteps,
  completeCorridorWithHighways,
  hasPlausibleTransitions,
} from './build-corridor'

const okMtSparseSteps = [
  {
    ref: 'I 35',
    maneuver: { location: [-95.99, 36.15] },
    geometry: { coordinates: [[-95.99, 36.15], [-96.5, 36.8]] },
  },
  {
    ref: 'I 35',
    maneuver: { location: [-96.8, 38.5] },
    geometry: { coordinates: [[-96.8, 38.5], [-97.0, 39.5]] },
  },
  {
    ref: 'I 35 N',
    maneuver: { location: [-97.0, 39.5] },
    geometry: { coordinates: [[-97.0, 39.5], [-96.5, 40.5]] },
  },
  {
    ref: 'I 80',
    maneuver: { location: [-96.0, 41.2] },
    geometry: { coordinates: [[-96.0, 41.2], [-100.0, 41.5]] },
  },
  {
    ref: 'I 90',
    maneuver: { location: [-104.0, 44.0] },
    geometry: { coordinates: [[-104.0, 44.0], [-106.0, 45.5]] },
  },
  {
    ref: 'I 90',
    maneuver: { location: [-108.5, 45.78] },
    geometry: { coordinates: [[-108.5, 45.78], [-108.6, 45.8]] },
  },
]

const okMtExplicitSteps = [
  { ref: 'OK 11' },
  { ref: 'I 35;KS 15' },
  { ref: 'KS 15' },
  { ref: 'I 80;NE 2' },
  { ref: 'I 90;SD 34' },
  { ref: 'MT 3' },
]

const okMtWesternSteps = [
  { ref: 'I 44', maneuver: { location: [-95.99, 36.15] }, geometry: { coordinates: [[-95.99, 36.15]] } },
  { ref: 'I 35', maneuver: { location: [-96.5, 37.0] }, geometry: { coordinates: [[-96.5, 37.0]] } },
  { ref: 'I 70', maneuver: { location: [-104.71, 39.74] }, geometry: { coordinates: [[-104.71, 39.74]] } },
  { ref: 'I 25', maneuver: { location: [-105.0, 41.5] }, geometry: { coordinates: [[-105.0, 41.5]] } },
  { ref: 'I 90', maneuver: { location: [-108.5, 45.78] }, geometry: { coordinates: [[-108.5, 45.78]] } },
]

describe('buildCorridorFromSteps OK->MT', () => {
  it('sparse interstate refs produce multi-state corridor (not OK->MT only)', () => {
    const corridor = buildCorridorFromSteps(okMtSparseSteps, 'OK', 'MT')
    expect(corridor[0]).toBe('OK')
    expect(corridor[corridor.length - 1]).toBe('MT')
    expect(corridor.length).toBeGreaterThanOrEqual(4)
    expect(corridor).toContain('KS')
    expect(corridor).toContain('NE')
    expect(hasPlausibleTransitions(corridor)).toBe(true)
  })

  it('explicit state route refs yield full OK-KS-NE-SD-MT corridor', () => {
    const corridor = buildCorridorFromSteps(okMtExplicitSteps, 'OK', 'MT')
    expect(corridor).toEqual(['OK', 'KS', 'NE', 'SD', 'MT'])
  })

  it('completeCorridorWithHighways fills OK-MT gap from highways', () => {
    const corridor = completeCorridorWithHighways(['OK', 'MT'], ['I-35', 'I-80', 'I-90'])
    expect(corridor).toEqual(['OK', 'KS', 'NE', 'SD', 'MT'])
  })

  it('western I-70/I-25 corridor fills OK-KS-CO-WY-MT', () => {
    const corridor = completeCorridorWithHighways(['OK', 'MT'], ['I-70', 'I-25'])
    expect(corridor).toEqual(['OK', 'KS', 'CO', 'WY', 'MT'])
  })

  it('western default when sparse OK-MT and I-70/I-25 highways only', () => {
    const corridor = completeCorridorWithHighways(
      ['OK', 'MT'],
      ['I-70 (entry 38.87,-97.64 exit 39.74,-104.71)', 'I-25 (entry 39.99,-104.99 exit 44.37,-106.69)']
    )
    expect(corridor).toEqual(['OK', 'KS', 'CO', 'WY', 'MT'])
  })

  it('eastern not blocked when CO already present from geometry', () => {
    const corridor = completeCorridorWithHighways(['OK', 'CO', 'MT'], ['I-35', 'I-80', 'I-90'])
    expect(corridor).toEqual(['OK', 'KS', 'NE', 'SD', 'MT'])
  })

  it('CO path does not force NE/SD', () => {
    const corridor = completeCorridorWithHighways(['OK', 'KS', 'CO', 'MT'], ['I-70', 'I-25'])
    expect(corridor).not.toContain('NE')
    expect(corridor).not.toContain('SD')
    expect(corridor).toEqual(['OK', 'KS', 'CO', 'WY', 'MT'])
  })

  it('western sparse steps preserve MT bookend', () => {
    const corridor = buildCorridorFromSteps(okMtWesternSteps, 'OK', 'MT')
    expect(corridor[0]).toBe('OK')
    expect(corridor[corridor.length - 1]).toBe('MT')
    expect(corridor.includes('CO') || corridor.includes('WY')).toBe(true)
  })

  it('I 35 NE compass does not become Nebraska in corridor', () => {
    const corridor = buildCorridorFromSteps(
      [{ ref: 'I 35 NE', maneuver: { location: [-97.0, 35.5] }, geometry: { coordinates: [[-97.0, 35.5]] } }],
      'OK',
      'TX'
    )
    expect(corridor).not.toContain('NE')
  })
})

describe('completeCorridorWithHighways Calvert AL->NE', () => {
  it('does not insert spurious OK from I-35/I-40', () => {
    const corridor = completeCorridorWithHighways(['AL', 'MS', 'MO', 'IA', 'NE'], ['I-35', 'I-40'])
    expect(corridor).not.toContain('OK')
  })
})