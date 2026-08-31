import { describe, expect, it } from 'vitest'
import {
  applyUserPreferences,
  assessPreferenceEnforcement,
  buildCorridorFromSteps,
  completeCorridorWithHighways,
  extractAvoidHighwaysFromNotEnforcedMarker,
  extractBorderCrossingsFromSteps,
  fillCorridorGapsFromGeometry,
  skipNonTraversedStates,
  formatRoutePreferenceAsSpecialInstructions,
  hasParseableRoutePreference,
  hasPlausibleTransitions,
  hasRoutePreferenceDirectives,
  highwayTokenPresent,
  isAvoidHighwayOnlyPreference,
  isStatesOnlyRoutePreference,
  normalizeHwyToken,
  parseRoutePreferenceInput,
  parseSpecialInstructions,
} from './build-corridor'
import type { CorridorResult } from './build-corridor'

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

  it('strips mid NC-LA-GA even with distant MS and I-10 present, then fills SC', () => {
    // Global TX/MS/AR-anywhere must not block strip; only local gulf prev/next keeps LA.
    // MS is far from LA (via FL→AL), so the old global MS gate wrongly blocked this case.
    const corridor = completeCorridorWithHighways(
      ['NJ', 'DE', 'MD', 'VA', 'NC', 'LA', 'GA', 'FL', 'AL', 'MS'],
      ['I-95', 'I-10'],
    )
    expect(corridor).not.toContain('LA')
    expect(corridor).toContain('SC')
    expect(corridor).toContain('MS')
    const ncIdx = corridor.indexOf('NC')
    const scIdx = corridor.indexOf('SC')
    const gaIdx = corridor.indexOf('GA')
    expect(ncIdx).toBeLessThan(scIdx)
    expect(scIdx).toBeLessThan(gaIdx)
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

  it('prefer clause accepts state routes and US direction suffix', () => {
    expect(parseSpecialInstructions('prefer MO-123').preferred).toEqual(['MO 123'])
    expect(parseSpecialInstructions('prefer US160w').preferred).toEqual(['US 160'])
    expect(parseSpecialInstructions('prefer MO 123, US-160').preferred).toEqual(['MO 123', 'US 160'])
  })

  it('avoid I-40 does not prefer I-40', () => {
    expect(parseSpecialInstructions('avoid I-40').preferred).toEqual([])
  })

  it('avoid MO-123 does not hard-avoid state MO', () => {
    const parsed = parseSpecialInstructions('avoid MO-123')
    expect(parsed.avoided).toEqual([])
    expect(parsed.preferred).toEqual([])
  })

  it('avoid I-49 does not avoid any state', () => {
    expect(parseSpecialInstructions('avoid I-49').avoided).toEqual([])
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

  it('matches state routes and strips US direction suffix', () => {
    expect(highwayTokenPresent('MO-123', ['MO 123', 'I-49'])).toBe(true)
    expect(highwayTokenPresent('MO 123', ['MO-123'])).toBe(true)
    expect(highwayTokenPresent('US160w', ['US 160'])).toBe(true)
    expect(highwayTokenPresent('US 160', ['US160W'])).toBe(true)
  })

  it('I-35E is not I-35W (route identity preserved)', () => {
    expect(highwayTokenPresent('I-35E', ['I-35W'])).toBe(false)
    expect(highwayTokenPresent('I-35E', ['I-35E', 'I-35W'])).toBe(true)
    expect(highwayTokenPresent('I-35W', ['I-35W'])).toBe(true)
    expect(normalizeHwyToken('I-35E')).toBe('I-35E')
    expect(normalizeHwyToken('I-35W')).toBe('I-35W')
  })
})

describe('parseRoutePreferenceInput (Submit New Route smart input)', () => {
  it('MO-123, US160w → preferHighways only (no false need-states)', () => {
    const parsed = parseRoutePreferenceInput('MO-123, US160w')
    expect(parsed.preferHighways).toEqual(['MO 123', 'US 160'])
    expect(parsed.states).toBeUndefined()
    expect(parsed.avoidHighways).toBeUndefined()
    expect(hasParseableRoutePreference(parsed)).toBe(true)
    expect(isStatesOnlyRoutePreference(parsed)).toBe(false)
    expect(formatRoutePreferenceAsSpecialInstructions(parsed)).toBe('prefer MO 123, US 160')
  })

  it('MO, NE, IA → states corridor override still works', () => {
    const parsed = parseRoutePreferenceInput('MO, NE, IA')
    expect(parsed.states).toEqual(['MO', 'NE', 'IA'])
    expect(parsed.preferHighways).toBeUndefined()
    expect(isStatesOnlyRoutePreference(parsed)).toBe(true)
    expect(hasParseableRoutePreference(parsed)).toBe(true)
  })

  it('avoid I-49, prefer US-160 extracts avoid + prefer highways', () => {
    const parsed = parseRoutePreferenceInput('avoid I-49, prefer US-160')
    expect(parsed.preferHighways).toEqual(['US 160'])
    expect(parsed.avoidHighways).toEqual(['I-49'])
    expect(isStatesOnlyRoutePreference(parsed)).toBe(false)
    expect(isAvoidHighwayOnlyPreference(parsed)).toBe(false)
    const text = formatRoutePreferenceAsSpecialInstructions(parsed)
    expect(text).toBe('prefer US 160. highway avoid not enforced: I-49')
    // Must not emit bare avoid I-49 into state-avoid pipeline
    expect(parseSpecialInstructions(text).avoided).toEqual([])
  })

  it('format → re-parse recovers avoidHighways (honesty round-trip)', () => {
    const original = parseRoutePreferenceInput('avoid I-49, prefer US-160')
    const formatted = formatRoutePreferenceAsSpecialInstructions(original)
    expect(formatted).toBe('prefer US 160. highway avoid not enforced: I-49')
    expect(extractAvoidHighwaysFromNotEnforcedMarker(formatted)).toEqual(['I-49'])

    const reparsed = parseRoutePreferenceInput(formatted)
    expect(reparsed.preferHighways).toEqual(['US 160'])
    expect(reparsed.avoidHighways).toEqual(['I-49'])
    expect(isAvoidHighwayOnlyPreference(reparsed)).toBe(false)

    // applyUserPreferences must mark partial (not full "User preference applied")
    const corridors: CorridorResult[] = [
      {
        routeCorridor: ['MO'],
        highways: ['US 160', 'I-49'],
        highwaysAll: ['US 160', 'I-49'],
        distanceMeters: 100_000,
      },
    ]
    const out = applyUserPreferences(corridors, formatted, 'MO', 'MO')
    const note = out[0]?.userPreferenceNote || ''
    expect(note).toMatch(/partial/i)
    expect(note).toMatch(/Highway avoid I-49 not enforced/i)
    expect(note).not.toMatch(/^User preference applied:/)
  })

  it('no AR / steer clear of AR are directives (not include AR)', () => {
    expect(hasRoutePreferenceDirectives('no AR')).toBe(true)
    expect(hasRoutePreferenceDirectives('steer clear of AR')).toBe(true)
    const noAr = parseRoutePreferenceInput('no AR')
    expect(noAr.avoidedStates).toEqual(['AR'])
    expect(noAr.states).toBeUndefined()
    expect(isStatesOnlyRoutePreference(noAr)).toBe(false)
    expect(formatRoutePreferenceAsSpecialInstructions(noAr)).toBe('avoid AR')
    expect(formatRoutePreferenceAsSpecialInstructions(noAr)).not.toContain('include')

    const steer = parseRoutePreferenceInput('steer clear of AR')
    expect(steer.avoidedStates).toEqual(['AR'])
    expect(formatRoutePreferenceAsSpecialInstructions(steer)).toBe('avoid AR')
  })

  it('space-separated uppercase state lists keep stopword codes (WA OR, AL MS TN)', () => {
    const waOr = parseRoutePreferenceInput('WA OR')
    expect(waOr.states).toEqual(['WA', 'OR'])
    expect(isStatesOnlyRoutePreference(waOr)).toBe(true)

    const alMsTn = parseRoutePreferenceInput('AL MS TN')
    expect(alMsTn.states).toEqual(['AL', 'MS', 'TN'])
    expect(isStatesOnlyRoutePreference(alMsTn)).toBe(true)
  })

  it('space-separated English or/in do not invent OR/IN as states', () => {
    const caOrTx = parseRoutePreferenceInput('CA or TX')
    expect(caOrTx.states).toEqual(['CA', 'TX'])
    expect(caOrTx.states).not.toContain('OR')

    const inMo = parseRoutePreferenceInput('in MO')
    expect(inMo.states).toEqual(['MO'])
    expect(inMo.states).not.toContain('IN')
  })

  it('avoid I-49 alone is parseable as avoid-highway-only (UI rejects)', () => {
    const parsed = parseRoutePreferenceInput('avoid I-49')
    expect(parsed.avoidHighways).toEqual(['I-49'])
    expect(parsed.avoidedStates).toBeUndefined()
    expect(isAvoidHighwayOnlyPreference(parsed)).toBe(true)
    expect(hasParseableRoutePreference(parsed)).toBe(true)
  })

  it('avoid MO-123 is highway avoid, not state MO', () => {
    const parsed = parseRoutePreferenceInput('avoid MO-123')
    expect(parsed.avoidHighways).toEqual(['MO 123'])
    expect(parsed.avoidedStates).toBeUndefined()
    expect(parsed.states).toBeUndefined()
    expect(isAvoidHighwayOnlyPreference(parsed)).toBe(true)
    const text = formatRoutePreferenceAsSpecialInstructions(parsed)
    expect(text).toContain('highway avoid not enforced')
    expect(parseSpecialInstructions(text).avoided).not.toContain('MO')
  })

  it('prefer US-160 avoid I-49 multi-verb same line scopes correctly', () => {
    const parsed = parseRoutePreferenceInput('prefer US-160 avoid I-49')
    expect(parsed.preferHighways).toEqual(['US 160'])
    expect(parsed.avoidHighways).toEqual(['I-49'])
    // US-160 must not be tainted as avoid
    expect(parsed.avoidHighways).not.toContain('US 160')
  })

  it('prefer US-160 or I-49 does not invent state OR', () => {
    const parsed = parseRoutePreferenceInput('prefer US-160 or I-49')
    expect(parsed.preferHighways).toEqual(expect.arrayContaining(['US 160', 'I-49']))
    expect(parsed.states || []).not.toContain('OR')
    expect(parsed.avoidedStates || []).not.toContain('OR')
  })

  it('include MS, AL is soft prefs path (not hard manualRoute)', () => {
    const parsed = parseRoutePreferenceInput('include MS, AL')
    expect(parsed.states).toEqual(['MS', 'AL'])
    expect(isStatesOnlyRoutePreference(parsed)).toBe(false)
    expect(formatRoutePreferenceAsSpecialInstructions(parsed)).toBe('include MS, AL')
  })

  it('via MO is soft prefs path (not hard manualRoute)', () => {
    const parsed = parseRoutePreferenceInput('via MO')
    expect(isStatesOnlyRoutePreference(parsed)).toBe(false)
    expect(hasParseableRoutePreference(parsed)).toBe(true)
  })

  it('avoid AR, IL keeps both avoided states (not states-only IL)', () => {
    const parsed = parseRoutePreferenceInput('avoid AR, IL')
    expect(parsed.avoidedStates).toEqual(['AR', 'IL'])
    expect(parsed.states).toBeUndefined()
    expect(isStatesOnlyRoutePreference(parsed)).toBe(false)
    expect(hasParseableRoutePreference(parsed)).toBe(true)
    expect(formatRoutePreferenceAsSpecialInstructions(parsed)).toBe('avoid AR, IL')
  })

  it('avoid AR alone is parseable (not states-only)', () => {
    const parsed = parseRoutePreferenceInput('avoid AR')
    expect(parsed.avoidedStates).toEqual(['AR'])
    expect(isStatesOnlyRoutePreference(parsed)).toBe(false)
    expect(hasParseableRoutePreference(parsed)).toBe(true)
    expect(formatRoutePreferenceAsSpecialInstructions(parsed)).toBe('avoid AR')
  })

  it('mixed bare MO, US-160 uses include+prefer bias (not states-only)', () => {
    const parsed = parseRoutePreferenceInput('MO, US-160')
    expect(parsed.states).toEqual(['MO'])
    expect(parsed.preferHighways).toEqual(['US 160'])
    expect(isStatesOnlyRoutePreference(parsed)).toBe(false)
    expect(formatRoutePreferenceAsSpecialInstructions(parsed)).toBe(
      'prefer US 160. include MO',
    )
  })

  it('empty and garbage are not parseable', () => {
    expect(hasParseableRoutePreference(parseRoutePreferenceInput(''))).toBe(false)
    expect(hasParseableRoutePreference(parseRoutePreferenceInput('asdf qwerty'))).toBe(false)
    expect(isStatesOnlyRoutePreference(parseRoutePreferenceInput('asdf'))).toBe(false)
  })

  it('normalizeHwyToken covers dry-run tokens and I 49 space form', () => {
    expect(normalizeHwyToken('US160w')).toBe('US 160')
    expect(normalizeHwyToken('MO-123')).toBe('MO 123')
    expect(normalizeHwyToken('MO 123')).toBe('MO 123')
    expect(normalizeHwyToken('I-49')).toBe('I-49')
    expect(normalizeHwyToken('I 49')).toBe('I-49')
    expect(normalizeHwyToken('US-160')).toBe('US 160')
    expect(normalizeHwyToken('CA-1A')).toBe('CA 1A')
  })

  it('comma list still keeps OR as Oregon when bare segment', () => {
    const parsed = parseRoutePreferenceInput('WA, OR')
    expect(parsed.states).toEqual(['WA', 'OR'])
    expect(isStatesOnlyRoutePreference(parsed)).toBe(true)
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


describe('extractBorderCrossingsFromSteps border snap (late state flip)', () => {
  it('does not place AL entry at deep mid-state when prev-state geometry exists', () => {
    // Geometry crosses GA→AL bound near ~-85.0; AL label only appears deep in Birmingham.
    // Bound-based snap must place entry near the state edge, not Birmingham.
    const steps = [
      {
        ref: 'GA 400',
        maneuver: { location: [-84.7, 33.5] },
        geometry: {
          coordinates: [
            [-84.7, 33.5],
            [-84.85, 33.4],
            [-84.95, 33.3],
            [-85.05, 33.2], // still GA box / near edge
          ],
        },
      },
      {
        ref: 'I 22;AL 4',
        maneuver: { location: [-86.815, 33.546] },
        geometry: {
          coordinates: [
            [-85.15, 33.15], // first pts still near GA/AL edge
            [-85.4, 33.2],
            [-86.0, 33.4],
            [-86.815, 33.546], // Birmingham
            [-86.82, 33.58],
          ],
        },
      },
      {
        ref: 'I 65;TN 6',
        maneuver: { location: [-86.7, 35.1] },
        geometry: {
          coordinates: [
            [-86.75, 34.7],
            [-86.72, 34.95],
            [-86.7, 35.05], // crosses into TN ~35.0
            [-86.6, 35.5],
          ],
        },
      },
    ]
    const crossings = extractBorderCrossingsFromSteps(steps)
    expect(crossings.length).toBeGreaterThanOrEqual(1)
    const intoAl = crossings.find((c) => c.toState === 'AL')
    expect(intoAl).toBeTruthy()
    // Must not be pure Birmingham entry
    expect(intoAl!.entry.lat).not.toBeCloseTo(33.546, 1)
    expect(intoAl!.entry.lon).not.toBeCloseTo(-86.815, 1)
    // Bound snap should stay near eastern AL (~-85.x), not central Birmingham
    expect(intoAl!.entry.lon).toBeGreaterThan(-86.0)
    const leaveAl = crossings.find((c) => c.fromState === 'AL')
    if (leaveAl) {
      // Exit toward TN should be near northern AL (~35), not Birmingham (~33.5)
      expect(leaveAl.entry.lat).toBeGreaterThan(34.2) // north of Birmingham (~33.5), toward TN (~35)
    }
  })

  it('exit for through state uses last geometry still in that state', () => {
    const steps = [
      {
        ref: 'OK 11',
        maneuver: { location: [-97.0, 36.0] },
        geometry: { coordinates: [[-97.0, 36.0], [-96.9, 36.2]] },
      },
      {
        ref: 'I 35;KS 15',
        maneuver: { location: [-96.8, 37.05] },
        geometry: {
          coordinates: [
            [-96.8, 37.05],
            [-96.7, 38.0],
            [-96.6, 39.5], // last KS-ish before NE
          ],
        },
      },
      {
        ref: 'I 80;NE 2',
        maneuver: { location: [-96.0, 40.6] },
        geometry: { coordinates: [[-96.0, 40.6], [-95.5, 41.0]] },
      },
    ]
    const crossings = extractBorderCrossingsFromSteps(steps)
    const intoKs = crossings.find((c) => c.fromState === 'OK' && c.toState === 'KS')
    const intoNe = crossings.find((c) => c.fromState === 'KS' && c.toState === 'NE')
    expect(intoKs).toBeTruthy()
    expect(intoNe).toBeTruthy()
    // KS exit (into NE entry) should be near northern KS, not the southern KS entry
    expect(intoNe!.entry.lat).toBeGreaterThan(intoKs!.entry.lat)
  })
})


describe('fillCorridorGapsFromGeometry / long-haul insert', () => {
  it('inserts GA AL TN between sparse FL→ND step-ref bookends using dense geometry', () => {
    // Sparse refs only see FL and ND; geometry walks the real SE→upper Midwest path.
    const steps = [
      {
        ref: 'I 75',
        maneuver: { location: [-82.5, 28.0] },
        geometry: {
          coordinates: [
            [-82.5, 28.0], // FL
            [-83.5, 30.5], // FL/GA edge
            [-84.4, 32.0], // GA
            [-85.0, 33.0], // GA/AL
            [-86.8, 33.5], // AL
            [-86.8, 35.0], // AL/TN
            [-86.7, 36.0], // TN
            [-88.5, 37.5], // KY-ish / IL approach
            [-89.5, 39.0], // IL
            [-90.0, 43.0], // WI/MN approach
            [-93.0, 45.0], // MN
            [-101.0, 48.2], // ND
          ],
        },
      },
      {
        ref: 'I 94',
        maneuver: { location: [-101.3, 48.23] },
        geometry: { coordinates: [[-101.3, 48.23], [-101.4, 48.25]] },
      },
    ]
    const sparse = buildCorridorFromSteps(
      [
        { ref: 'FL 60', maneuver: { location: [-82.5, 28.0] }, geometry: { coordinates: [[-82.5, 28.0]] } },
        { ref: 'ND 2', maneuver: { location: [-101.3, 48.23] }, geometry: { coordinates: [[-101.3, 48.23]] } },
      ],
      'FL',
      'ND',
    )
    // Direct fill on sparse FL, ND with rich geometry steps
    const filled = fillCorridorGapsFromGeometry(['FL', 'ND'], steps)
    expect(filled[0]).toBe('FL')
    expect(filled[filled.length - 1]).toBe('ND')
    expect(filled.length).toBeGreaterThan(2)
    // Must pick up southeastern intermediates from geometry
    expect(filled).toEqual(expect.arrayContaining(['GA', 'AL']))
  })

  it('does not reorder or invent states when geometry is empty', () => {
    const filled = fillCorridorGapsFromGeometry(['FL', 'GA', 'AL'], [])
    expect(filled).toEqual(['FL', 'GA', 'AL'])
  })

  it('buildCorridorFromSteps gap-fills long sparse corridor', () => {
    const steps = [
      {
        ref: 'FL 60',
        maneuver: { location: [-82.5, 28.0] },
        geometry: { coordinates: [[-82.5, 28.0], [-82.6, 28.1]] },
      },
      {
        ref: 'I 75',
        maneuver: { location: [-84.4, 32.0] },
        geometry: {
          coordinates: [
            [-83.0, 30.8],
            [-84.4, 32.0],
            [-85.0, 33.0],
            [-86.8, 33.5],
            [-86.8, 35.0],
            [-86.7, 36.0],
          ],
        },
      },
      {
        ref: 'ND 2',
        maneuver: { location: [-101.3, 48.23] },
        geometry: { coordinates: [[-101.3, 48.23]] },
      },
    ]
    const corridor = buildCorridorFromSteps(steps, 'FL', 'ND')
    expect(corridor[0]).toBe('FL')
    expect(corridor[corridor.length - 1]).toBe('ND')
    // Geometry should contribute AL and/or GA/TN between bookends
    const mid = corridor.slice(1, -1)
    expect(mid.length).toBeGreaterThan(0)
  })
})


describe('skipNonTraversedStates', () => {
  it('drops middle states absent from geometry while keeping bookends', () => {
    // Corridor has spurious OK from highway heuristic; geometry only walks MO→IA→NE
    const steps = [
      {
        ref: 'I 29',
        maneuver: { location: [-94.5, 39.1] },
        geometry: {
          coordinates: [
            [-94.5, 39.1], // MO
            [-95.0, 40.5], // IA
            [-96.0, 41.2], // NE
          ],
        },
      },
    ]
    const cleaned = skipNonTraversedStates(['MO', 'OK', 'IA', 'NE'], steps)
    expect(cleaned[0]).toBe('MO')
    expect(cleaned[cleaned.length - 1]).toBe('NE')
    expect(cleaned).not.toContain('OK')
    expect(cleaned).toContain('IA')
  })

  it('no-ops when corridor is already short or geometry empty', () => {
    expect(skipNonTraversedStates(['FL', 'GA'], [])).toEqual(['FL', 'GA'])
    expect(skipNonTraversedStates(['FL'], [{ ref: 'I 75' }])).toEqual(['FL'])
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

describe('completeCorridorWithHighways same-state / I-44 must not invent TN', () => {
  it('keeps a Missouri-only hop on I-44 in Missouri', () => {
    expect(completeCorridorWithHighways(['MO'], ['I-44'])).toEqual(['MO'])
    expect(completeCorridorWithHighways(['MO'], ['I-44', 'I-55', 'US 71'])).toEqual(['MO'])
    expect(completeCorridorWithHighways(['MO', 'MO'], ['I-44'])).toEqual(['MO'])
  })

  it('keeps Kansas-only I-70/I-35 in Kansas', () => {
    expect(completeCorridorWithHighways(['KS'], ['I-70', 'I-35'])).toEqual(['KS'])
  })

  it('may insert TN on a southeast long-haul that already includes MO', () => {
    const se = completeCorridorWithHighways(['KS', 'MO', 'GA', 'FL'], ['I-44', 'I-24'])
    expect(se).toContain('TN')
    expect(se[0]).toBe('KS')
    expect(se[se.length - 1]).toBe('FL')
  })

  it('does not insert TN on I-55 north MO→IL', () => {
    expect(completeCorridorWithHighways(['MO', 'IL'], ['I-55'])).toEqual(['MO', 'IL'])
  })

  it('Willard MO → Lamar MO steps stay in Missouri', () => {
    const steps = [
      {
        ref: 'I 44',
        maneuver: { location: [-93.42853, 37.30505] },
        geometry: {
          coordinates: [
            [-93.42853, 37.30505],
            [-93.8, 37.35],
          ],
        },
      },
      {
        ref: 'US 71',
        maneuver: { location: [-94.27687, 37.49505] },
        geometry: {
          coordinates: [
            [-94.0, 37.4],
            [-94.27687, 37.49505],
          ],
        },
      },
    ]
    const fromSteps = buildCorridorFromSteps(steps, 'MO', 'MO')
    expect(fromSteps).toEqual(['MO'])
    expect(completeCorridorWithHighways(fromSteps, ['I-44', 'US 71'])).toEqual(['MO'])
  })
})
