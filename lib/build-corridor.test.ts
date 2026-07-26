import { describe, expect, it } from 'vitest'
import {
  assessPreferenceEnforcement,
  buildCorridorFromSteps,
  completeCorridorWithHighways,
  extractBorderCrossingsFromSteps,
  hasPlausibleTransitions,
  highwayTokenPresent,
  parseSpecialInstructions,
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

/**
 * Plausible mid-Atlantic NJ→FL step chain with explicit state route codes so intermediates
 * are retained (not collapsed to bookends). Trailing bare I-10 must not inject LA.
 */
const njFlI95Steps = [
  { ref: 'NJ 42' },
  { ref: 'I 95;DE 1' },
  { ref: 'I 95;MD 295' },
  { ref: 'I 95;VA 3' },
  { ref: 'I 95;NC 49' },
  { ref: 'I 95;GA 400' },
  { ref: 'I 95;FL 9' },
  // Bare multi-state I-10 must not force LA via HIGHWAY_STATE_HINTS
  { ref: 'I 10' },
]

describe('east-coast corridor NJ→FL I-95', () => {
  it('completeCorridorWithHighways inserts SC when NC+GA are index neighbors on I-95', () => {
    const corridor = completeCorridorWithHighways(
      ['NJ', 'DE', 'MD', 'VA', 'NC', 'GA', 'FL'],
      ['I-95', 'I-85'],
    )
    expect(corridor).toContain('SC')
    expect(corridor).not.toContain('LA')
    expect(corridor[0]).toBe('NJ')
    expect(corridor[corridor.length - 1]).toBe('FL')
    const ncIdx = corridor.indexOf('NC')
    const scIdx = corridor.indexOf('SC')
    const gaIdx = corridor.indexOf('GA')
    expect(ncIdx).toBeLessThan(scIdx)
    expect(scIdx).toBeLessThan(gaIdx)
    expect(hasPlausibleTransitions(corridor)).toBe(true)
  })

  it('completeCorridorWithHighways inserts SC (and GA) for adjacent NC→FL gap without GA', () => {
    const corridor = completeCorridorWithHighways(
      ['NJ', 'DE', 'MD', 'VA', 'NC', 'FL'],
      ['I-95'],
    )
    expect(corridor).toContain('SC')
    expect(corridor).toContain('GA')
    expect(corridor).not.toContain('LA')
    expect(corridor[0]).toBe('NJ')
    expect(corridor[corridor.length - 1]).toBe('FL')
    expect(hasPlausibleTransitions(corridor)).toBe(true)
  })

  it('does not insert SC when inland states sit between NC and FL', () => {
    const corridor = completeCorridorWithHighways(
      ['NC', 'TN', 'AL', 'FL'],
      ['I-95'],
    )
    expect(corridor).not.toContain('SC')
    expect(corridor).toEqual(['NC', 'TN', 'AL', 'FL'])
  })

  it('I-81 alone does not trigger SC fill (seaboard is I-95/I-85 only)', () => {
    const corridor = completeCorridorWithHighways(
      ['VA', 'NC', 'GA', 'FL'],
      ['I-81'],
    )
    expect(corridor).not.toContain('SC')
    expect(corridor).toEqual(['VA', 'NC', 'GA', 'FL'])
  })

  it('strips spurious mid-corridor LA on I-95 then fills SC when NC|GA become adjacent', () => {
    const corridor = completeCorridorWithHighways(
      ['NJ', 'DE', 'MD', 'VA', 'NC', 'LA', 'GA', 'FL'],
      ['I-95', 'I-10'],
    )
    expect(corridor).not.toContain('LA')
    expect(corridor).toContain('SC')
    expect(hasPlausibleTransitions(corridor)).toBe(true)
  })

  it('never strips LA when it is origin or dest bookend', () => {
    const destLa = completeCorridorWithHighways(
      ['TX', 'MS', 'AL', 'FL', 'LA'],
      ['I-95', 'I-10'],
    )
    expect(destLa[destLa.length - 1]).toBe('LA')

    const originLa = completeCorridorWithHighways(
      ['LA', 'MS', 'AL', 'GA', 'NC'],
      ['I-95'],
    )
    expect(originLa[0]).toBe('LA')
  })

  it('keeps LA on gulf I-10 path (TX-LA-MS)', () => {
    const corridor = completeCorridorWithHighways(
      ['TX', 'LA', 'MS', 'AL', 'FL'],
      ['I-10', 'I-95'],
    )
    expect(corridor).toContain('LA')
    expect(corridor.indexOf('TX')).toBeLessThan(corridor.indexOf('LA'))
    expect(corridor.indexOf('LA')).toBeLessThan(corridor.indexOf('MS'))
  })

  it('reverse FL→NJ inserts SC between GA and NC preserving order', () => {
    const corridor = completeCorridorWithHighways(
      ['FL', 'GA', 'NC', 'VA', 'MD', 'DE', 'NJ'],
      ['I-95'],
    )
    expect(corridor).toContain('SC')
    expect(corridor[0]).toBe('FL')
    expect(corridor[corridor.length - 1]).toBe('NJ')
    const gaIdx = corridor.indexOf('GA')
    const scIdx = corridor.indexOf('SC')
    const ncIdx = corridor.indexOf('NC')
    expect(gaIdx).toBeLessThan(scIdx)
    expect(scIdx).toBeLessThan(ncIdx)
    expect(hasPlausibleTransitions(corridor)).toBe(true)
  })

  it('plausible mid-Atlantic steps + bare I-10 retain intermediates and never inject LA', () => {
    const corridor = buildCorridorFromSteps(njFlI95Steps, 'NJ', 'FL')
    expect(corridor[0]).toBe('NJ')
    expect(corridor[corridor.length - 1]).toBe('FL')
    expect(corridor).toContain('MD')
    expect(corridor).toContain('VA')
    expect(corridor).toContain('NC')
    expect(corridor).toContain('GA')
    expect(corridor).not.toContain('LA')
    const completed = completeCorridorWithHighways(corridor, ['I-95', 'I-10'])
    expect(completed).not.toContain('LA')
    expect(completed).toContain('SC')
    expect(hasPlausibleTransitions(completed)).toBe(true)
  })
})

describe('parseSpecialInstructions OD guard + avoid clause bound', () => {
  it('avoid IA. use US136 from Rock Port, MO to enter NE → only IA avoided, US 136 preferred, not MO/NE', () => {
    const parsed = parseSpecialInstructions(
      'avoid IA. use US136 from Rock Port, MO to enter NE',
      'MO',
      'NE',
    )
    expect(parsed.avoided).toEqual(['IA'])
    expect(parsed.preferred).toContain('US 136')
    expect(parsed.avoided).not.toContain('MO')
    expect(parsed.avoided).not.toContain('NE')
  })

  it('clause-bound without o/d: MO/NE not avoided from phrase alone', () => {
    const parsed = parseSpecialInstructions(
      'avoid IA. use US136 from Rock Port, MO to enter NE',
    )
    expect(parsed.avoided).toEqual(['IA'])
    expect(parsed.avoided).not.toContain('MO')
    expect(parsed.avoided).not.toContain('NE')
    expect(parsed.preferred).toContain('US 136')
  })

  it('avoid IA, avoid KS still works', () => {
    const parsed = parseSpecialInstructions('avoid IA, avoid KS')
    expect(parsed.avoided).toEqual(['IA', 'KS'])
  })

  it('origin/dest never remain in avoidedStates', () => {
    const parsed = parseSpecialInstructions('avoid MO, avoid IA, avoid NE', 'MO', 'NE')
    expect(parsed.avoided).toEqual(['IA'])
    expect(parsed.avoided).not.toContain('MO')
    expect(parsed.avoided).not.toContain('NE')
  })

  it('od full name coerced before strip', () => {
    const parsed = parseSpecialInstructions('avoid Missouri, avoid Iowa', 'Missouri', 'Nebraska')
    expect(parsed.avoided).toEqual(['IA'])
    expect(parsed.avoided).not.toContain('MO')
  })

  it('normalizes US-136 / US 136 / US136 and I-29', () => {
    expect(parseSpecialInstructions('use US-136').preferred).toEqual(['US 136'])
    expect(parseSpecialInstructions('prefer US 136').preferred).toEqual(['US 136'])
    expect(parseSpecialInstructions('take US136').preferred).toEqual(['US 136'])
    expect(parseSpecialInstructions('via I-29').preferred).toEqual(['I-29'])
  })

  it('avoid I-40 does not prefer I-40', () => {
    expect(parseSpecialInstructions('avoid I-40').preferred).toEqual([])
  })

  it('avoid AR, avoid IL, include Corinth, MS still separates directives', () => {
    const parsed = parseSpecialInstructions('avoid AR, avoid IL, include Corinth, MS')
    expect(parsed.avoided).toEqual(['AR', 'IL'])
    expect(parsed.included).toContain('MS')
  })

  it('TS state allowlist: bypass OK on way to TX → only OK (not ON)', () => {
    const parsed = parseSpecialInstructions('bypass OK on way to TX')
    expect(parsed.avoided).toEqual(['OK'])
    expect(parsed.avoided).not.toContain('ON')
  })

  it('English conjunction: avoid CA or TX skips OR (not Oregon)', () => {
    expect(parseSpecialInstructions('avoid CA or TX').avoided).toEqual(['CA', 'TX'])
    expect(parseSpecialInstructions('avoid CA or TX').avoided).not.toContain('OR')
  })

  it('comma list keeps OK: avoid AR, OK, TX', () => {
    expect(parseSpecialInstructions('avoid AR, OK, TX').avoided).toEqual(['AR', 'OK', 'TX'])
  })

  it('comma list keeps OR: avoid WA, OR', () => {
    expect(parseSpecialInstructions('avoid WA, OR').avoided).toEqual(['WA', 'OR'])
  })

  it('comma list keeps IN and OH: avoid IL, IN, OH', () => {
    expect(parseSpecialInstructions('avoid IL, IN, OH').avoided).toEqual(['IL', 'IN', 'OH'])
  })

  it('Kansas City is not Kansas', () => {
    expect(parseSpecialInstructions('avoid Kansas City').avoided).not.toContain('KS')
  })
})

describe('highwayTokenPresent equality', () => {
  it('uses boundary equality not substring', () => {
    expect(highwayTokenPresent('I-29', ['I-29', 'I-80'])).toBe(true)
    expect(highwayTokenPresent('I-2', ['I-29'])).toBe(false)
    expect(highwayTokenPresent('US 136', ['US 13'])).toBe(false)
    expect(highwayTokenPresent('US 136', ['US 136 (entry 40.0,-95.5)'])).toBe(true)
  })
})

describe('assessPreferenceEnforcement honesty', () => {
  it('residual avoid → enforced false + partial', () => {
    const h = assessPreferenceEnforcement(
      ['IA'],
      ['US 136'],
      ['MO', 'IA', 'NE'],
      ['I-29', 'I-80'],
      'MO',
      'NE',
    )
    expect(h.stillOn).toEqual(['IA'])
    expect(h.missingPref).toEqual(['US 136'])
    expect(h.enforced).toBe(false)
    expect(h.partial).toBe(true)
  })

  it('preferred missing alone → enforced false even if avoid clean', () => {
    const h = assessPreferenceEnforcement(
      ['IA'],
      ['US 136'],
      ['MO', 'KS', 'NE'],
      ['I-29', 'I-80'],
      'MO',
      'NE',
    )
    expect(h.stillOn).toEqual([])
    expect(h.missingPref).toEqual(['US 136'])
    expect(h.enforced).toBe(false)
  })

  it('full success when avoid clean and preferred present', () => {
    const h = assessPreferenceEnforcement(
      ['IA'],
      ['US 136'],
      ['MO', 'KS', 'NE'],
      ['US 136', 'I-29'],
      'MO',
      'NE',
    )
    expect(h.enforced).toBe(true)
    expect(h.partial).toBe(false)
  })
})

describe('extractBorderCrossingsFromSteps', () => {
  it('returns empty array for single-state steps', () => {
    const steps = [
      {
        ref: 'KS 4',
        maneuver: { location: [-97.3, 38.0] },
        geometry: { coordinates: [[-97.3, 38.0], [-97.4, 38.1]] },
      },
      {
        ref: 'I 70',
        maneuver: { location: [-97.5, 38.2] },
        geometry: { coordinates: [[-97.5, 38.2], [-97.6, 38.3]] },
      },
    ]
    const crossings = extractBorderCrossingsFromSteps(steps)
    expect(crossings).toEqual([])
  })

  it('produces one crossing per state change with entry and exit points', () => {
    const steps = [
      {
        ref: 'OK 11',
        maneuver: { location: [-97.0, 36.0] },
        geometry: { coordinates: [[-97.0, 36.0], [-96.9, 36.2]] },
      },
      {
        ref: 'I 35;KS 15',
        maneuver: { location: [-96.8, 37.1] },
        geometry: { coordinates: [[-96.8, 37.1], [-96.7, 37.5]] },
      },
      {
        ref: 'KS 15',
        maneuver: { location: [-96.6, 38.0] },
        geometry: { coordinates: [[-96.6, 38.0], [-96.5, 38.5]] },
      },
      {
        ref: 'I 80;NE 2',
        maneuver: { location: [-96.0, 40.5] },
        geometry: { coordinates: [[-96.0, 40.5], [-95.5, 41.0]] },
      },
    ]
    const crossings = extractBorderCrossingsFromSteps(steps)
    expect(crossings.length).toBeGreaterThanOrEqual(1)
    const first = crossings[0]
    expect(first.fromState).toBe('OK')
    expect(first.toState).toBe('KS')
    expect(Number.isFinite(first.entry.lat)).toBe(true)
    expect(Number.isFinite(first.entry.lon)).toBe(true)
    expect(Number.isFinite(first.exit.lat)).toBe(true)
    expect(Number.isFinite(first.exit.lon)).toBe(true)
  })
})

describe('same-state corridor resilience', () => {
  it('buildCorridorFromSteps with identical origin/dest still yields the single state', () => {
    const steps = [
      {
        ref: 'I 70',
        maneuver: { location: [-97.3, 38.0] },
        geometry: { coordinates: [[-97.3, 38.0], [-97.5, 38.1]] },
      },
    ]
    const corridor = buildCorridorFromSteps(steps, 'KS', 'KS')
    expect(corridor[0]).toBe('KS')
    expect(corridor[corridor.length - 1]).toBe('KS')
    expect(new Set(corridor).size).toBe(1)
  })
})
