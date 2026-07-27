import { describe, expect, it, vi } from 'vitest'
import {
  STATE_PORTAL_CONFIGS,
  formatBorderPoint,
  formatPortalCityState,
  generatePortalPrefill,
  getPortalStatesForAnalysis,
  openStatePortals,
  resolveInitialPortalState,
  resolveStateBorderFields,
  buildPortalClipboardPacket,
  buildPortalCompletenessChecklist,
  resolvePortalFieldLabel,
  hasPrefillValue,
  formatVehicleYmm,
  VEHICLE_IDENTITY_PREFILL_KEYS,
  PORTAL_TRIP_TYPES,
  isMissouriPortal,
  isMoMultiStatePrefill,
  getMoPortalFieldOrder,
  getMoPortalFieldLabel,
  MO_PORTAL_FIELD_ORDER,
  MO_PORTAL_FIELD_LABELS,
  MO_PORTAL_WALKTHROUGH,
  buildMoFilingSteps,
  buildMoFilingStepClipboard,
  type PrefillPackage,
} from './portal-assistant'

const ALL_US_STATES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
] as const

const EXPECTED_PORTAL_STATES = ALL_US_STATES.filter((s) => s !== 'HI')

/** Patterns that indicate fabricated / non-portal placeholder URLs. */
const PLACEHOLDER_URL_PATTERNS = [
  /\/permits\/osow\/?$/i,
  /\.gov\/osow\/?$/i,
  /\/osow-portal\/?$/i,
  /placeholder/i,
  /example\.com/i,
]

/** gotpermits.com and state subdomains legitimately share infrastructure. */
const LEGITIMATE_SHARED_URL_HOSTS = [
  'gotpermits.com',
  'marylandone.gotpermits.com',
  'wi.gotpermits.com',
  'wv.gotpermits.com',
  'ne.gotpermits.com',
  'nj.gotpermits.com',
  'mn.gotpermits.com',
  'ct.gotpermits.com',
  'ia.gotpermits.com',
  'ar.gotpermits.com',
]

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url)
    return `${u.origin}${u.pathname}`.replace(/\/$/, '').toLowerCase()
  } catch {
    return url.toLowerCase()
  }
}

describe('STATE_PORTAL_CONFIGS', () => {
  it('includes all 49 states (all US except HI)', () => {
    const configured = Object.keys(STATE_PORTAL_CONFIGS).sort()
    expect(configured).toEqual([...EXPECTED_PORTAL_STATES].sort())
    expect(configured).not.toContain('HI')
    expect(configured).toHaveLength(49)
  })

  it('has HTTPS, non-empty portalUrl for every state', () => {
    for (const [code, config] of Object.entries(STATE_PORTAL_CONFIGS)) {
      expect(config.portalUrl, `${code} portalUrl`).toBeTruthy()
      expect(config.portalUrl.startsWith('https://'), `${code} must use HTTPS`).toBe(true)
      expect(() => new URL(config.portalUrl), `${code} must be valid URL`).not.toThrow()
    }
  })

  it('rejects known placeholder portalUrl patterns', () => {
    for (const [code, config] of Object.entries(STATE_PORTAL_CONFIGS)) {
      const matchesPlaceholder = PLACEHOLDER_URL_PATTERNS.some((re) => re.test(config.portalUrl))
      expect(matchesPlaceholder, `${code} portalUrl looks like placeholder: ${config.portalUrl}`).toBe(false)
    }
  })

  it('allows duplicate portalUrls only for legitimate shared hosts (e.g. gotpermits)', () => {
    const byUrl = new Map<string, string[]>()
    for (const [code, config] of Object.entries(STATE_PORTAL_CONFIGS)) {
      const key = normalizeUrl(config.portalUrl)
      const list = byUrl.get(key) ?? []
      list.push(code)
      byUrl.set(key, list)
    }

    const duplicates = [...byUrl.entries()].filter(([, states]) => states.length > 1)
    expect(duplicates, 'unexpected duplicate portal URLs').toEqual([])

    // Sanity: gotpermits states should each have distinct subdomains/paths
    const gotpermitsStates = Object.entries(STATE_PORTAL_CONFIGS)
      .filter(([, c]) => c.portalType === 'gotpermits')
      .map(([code]) => code)
    expect(gotpermitsStates.length).toBeGreaterThan(0)
    for (const host of LEGITIMATE_SHARED_URL_HOSTS) {
      const usingHost = Object.values(STATE_PORTAL_CONFIGS).filter((c) => c.portalUrl.includes(host))
      if (usingHost.length > 1) {
        const paths = new Set(usingHost.map((c) => normalizeUrl(c.portalUrl)))
        expect(paths.size, `gotpermits host ${host} should not duplicate exact paths`).toBe(usingHost.length)
      }
    }
  })

  it('assigns portalType and portalSystemName on every state', () => {
    for (const [code, config] of Object.entries(STATE_PORTAL_CONFIGS)) {
      expect(config.portalType, `${code} portalType`).toBeTruthy()
      expect(config.portalSystemName, `${code} portalSystemName`).toBeTruthy()
    }
  })

  it('does not use removed bogus loginUrl placeholders', () => {
    for (const config of Object.values(STATE_PORTAL_CONFIGS)) {
      expect('loginUrl' in config).toBe(false)
    }
  })
})

describe('getPortalStatesForAnalysis', () => {
  it('returns routeCorridor states in order, including non-permit states', () => {
    const states = getPortalStatesForAnalysis({
      routeCorridor: ['NE', 'SD', 'ND'],
      permitRequiredStates: ['NE', 'ND'],
    })
    expect(states).toEqual(['NE', 'SD', 'ND'])
  })

  it('dedupes corridor while preserving first occurrence order', () => {
    const states = getPortalStatesForAnalysis({
      routeCorridor: ['ne', 'SD', 'NE', 'nd'],
      permitRequiredStates: [],
    })
    expect(states).toEqual(['NE', 'SD', 'ND'])
  })

  it('appends permit-only states not present in corridor', () => {
    const states = getPortalStatesForAnalysis({
      routeCorridor: ['TX', 'OK'],
      permitRequiredStates: ['KS', 'TX'],
    })
    expect(states).toEqual(['TX', 'OK', 'KS'])
  })

  it('opens corridor states when permitRequiredStates is empty', () => {
    const states = getPortalStatesForAnalysis({
      routeCorridor: ['IA', 'NE', 'SD'],
      permitRequiredStates: [],
    })
    expect(states).toEqual(['IA', 'NE', 'SD'])
  })

  it('filters out states without portal config (e.g. HI)', () => {
    const states = getPortalStatesForAnalysis({
      routeCorridor: ['CA', 'HI', 'NV'],
      permitRequiredStates: ['HI'],
    })
    expect(states).toEqual(['CA', 'NV'])
  })

  it('ignores invalid state tokens', () => {
    const states = getPortalStatesForAnalysis({
      routeCorridor: ['NE', 'NEBRASKA', ''],
      permitRequiredStates: ['XX', 'SD'],
    })
    expect(states).toEqual(['NE', 'SD'])
  })
})

describe('resolveInitialPortalState', () => {
  it('returns first corridor state (e.g. NE before SD)', () => {
    const state = resolveInitialPortalState({
      origin_state: 'IA',
      route_corridor: ['NE', 'SD', 'ND'],
      permit_required_states: ['NE', 'ND'],
    })
    expect(state).toBe('NE')
  })

  it('falls back to origin_state when corridor empty', () => {
    expect(
      resolveInitialPortalState({
        origin_state: 'ne',
        route_corridor: [],
        permit_required_states: [],
      })
    ).toBe('NE')
  })

  it('falls back to TX when no corridor or origin config', () => {
    expect(
      resolveInitialPortalState({
        origin_state: 'HI',
        route_corridor: null,
        permit_required_states: null,
      })
    ).toBe('TX')
  })
})

const OK_KS_NE_CROSSINGS = [
  {
    fromState: 'OK',
    toState: 'KS',
    entry: { lat: 36.99, lon: -94.62, highway: 'US-69' },
    exit: { lat: 39.8, lon: -95.0, highway: 'US-75' },
  },
  {
    fromState: 'KS',
    toState: 'NE',
    entry: { lat: 40.0, lon: -95.9, highway: 'US-75' },
    exit: { lat: 41.2, lon: -96.0, highway: 'US-75' },
  },
]

describe('formatBorderPoint / resolveStateBorderFields', () => {
  it('formats lat,lon with optional highway', () => {
    expect(formatBorderPoint({ lat: 36.99, lon: -94.61 })).toBe('36.99,-94.61')
    expect(formatBorderPoint({ lat: 36.99, lon: -94.61, highway: 'I-44' })).toBe(
      '36.99,-94.61 (I-44)'
    )
    expect(formatBorderPoint(null)).toBe('')
    expect(formatBorderPoint(undefined)).toBe('')
    expect(formatBorderPoint({ lat: Number.NaN, lon: -94.61 })).toBe('')
    expect(formatBorderPoint({ lat: 36.99, lon: Number.POSITIVE_INFINITY })).toBe('')
  })

  it('single-state corridor => role single, empty points', () => {
    const fields = resolveStateBorderFields('KS', ['KS'], [])
    expect(fields.role).toBe('single')
    expect(fields.entryPoint).toBe('')
    expect(fields.exitPoint).toBe('')
    expect(fields.borderEntry).toBe('')
    expect(fields.borderExit).toBe('')
    expect(fields.borderSummary).toMatch(/single-state/i)
  })

  it('through-state KS on OK-KS-NE gets entry + exit from sample crossings', () => {
    const fields = resolveStateBorderFields('KS', ['OK', 'KS', 'NE'], OK_KS_NE_CROSSINGS)
    expect(fields.role).toBe('through')
    expect(fields.entryPoint).toBe('36.99,-94.62 (US-69)')
    expect(fields.exitPoint).toBe('40,-95.9 (US-75)')
    expect(fields.borderEntry).toBe(fields.entryPoint)
    expect(fields.borderExit).toBe(fields.exitPoint)
    expect(fields.borderSummary).toContain('Entry:')
    expect(fields.borderSummary).toContain('Exit:')
  })

  it('origin OK gets exit only (leaveCrossing.entry)', () => {
    const fields = resolveStateBorderFields('OK', ['OK', 'KS', 'NE'], OK_KS_NE_CROSSINGS)
    expect(fields.role).toBe('origin')
    expect(fields.entryPoint).toBe('')
    expect(fields.exitPoint).toBe('36.99,-94.62 (US-69)')
  })

  it('destination NE gets entry only', () => {
    const fields = resolveStateBorderFields('NE', ['OK', 'KS', 'NE'], OK_KS_NE_CROSSINGS)
    expect(fields.role).toBe('destination')
    expect(fields.entryPoint).toBe('40,-95.9 (US-75)')
    expect(fields.exitPoint).toBe('')
  })

  it('through-state falls back to enterCrossing.exit when leave crossing missing', () => {
    // Only the inbound crossing is available — exit uses enter.exit
    const partial = [
      {
        fromState: 'OK',
        toState: 'KS',
        entry: { lat: 36.99, lon: -94.62, highway: 'US-69' },
        exit: { lat: 39.8, lon: -95.0, highway: 'US-75' },
      },
    ]
    const fields = resolveStateBorderFields('KS', ['OK', 'KS', 'NE'], partial)
    expect(fields.role).toBe('through')
    expect(fields.entryPoint).toBe('36.99,-94.62 (US-69)')
    expect(fields.exitPoint).toBe('39.8,-95 (US-75)')
  })

  it('origin exit stays empty when only leaveCrossing.exit is present (not entry)', () => {
    const onlyExit = [
      {
        fromState: 'OK',
        toState: 'KS',
        // no valid entry — origin must not use deep-in-next-state exit
        entry: { lat: Number.NaN, lon: Number.NaN },
        exit: { lat: 37.5, lon: -95.5, highway: 'deep-KS' },
      },
    ]
    const fields = resolveStateBorderFields('OK', ['OK', 'KS', 'NE'], onlyExit)
    expect(fields.role).toBe('origin')
    expect(fields.exitPoint).toBe('')
  })

  it('prefers adjacency match over first-match for re-entry corridors', () => {
    // First find would pick TX->OK; adjacency for second OK (idx of first OK is 0 origin)
    // Use corridor OK-KS-OK with crossings at both transitions
    const reentry = [
      {
        fromState: 'OK',
        toState: 'KS',
        entry: { lat: 36.9, lon: -94.6, highway: 'first-enter-KS' },
        exit: { lat: 38.0, lon: -95.0 },
      },
      {
        fromState: 'KS',
        toState: 'OK',
        entry: { lat: 36.5, lon: -94.5, highway: 'reenter-OK' },
        exit: { lat: 35.0, lon: -97.0 },
      },
    ]
    // First OK is origin: leave should be OK->KS
    const originOk = resolveStateBorderFields('OK', ['OK', 'KS', 'OK'], reentry)
    expect(originOk.role).toBe('origin')
    expect(originOk.exitPoint).toContain('first-enter-KS')

    // KS through: enter OK->KS, leave KS->OK
    const throughKs = resolveStateBorderFields('KS', ['OK', 'KS', 'OK'], reentry)
    expect(throughKs.role).toBe('through')
    expect(throughKs.entryPoint).toContain('first-enter-KS')
    expect(throughKs.exitPoint).toContain('reenter-OK')
  })

  it('unknown role for empty state, empty corridor, or off-corridor state', () => {
    expect(resolveStateBorderFields('', ['OK', 'KS'], OK_KS_NE_CROSSINGS).role).toBe('unknown')
    expect(resolveStateBorderFields('KS', [], OK_KS_NE_CROSSINGS).role).toBe('unknown')
    const off = resolveStateBorderFields('TX', ['OK', 'KS', 'NE'], OK_KS_NE_CROSSINGS)
    expect(off.role).toBe('unknown')
    expect(off.entryPoint).toBe('')
    expect(off.exitPoint).toBe('')
    expect(off.borderSummary).toMatch(/No matching border crossings for this state/i)
  })

  it('notes missing geometry when multi-state but crossings array empty', () => {
    const fields = resolveStateBorderFields('KS', ['OK', 'KS', 'NE'], [])
    expect(fields.role).toBe('through')
    expect(fields.entryPoint).toBe('')
    expect(fields.exitPoint).toBe('')
    expect(fields.borderSummary).toMatch(/No geometry border crossings available/i)
  })
})

describe('generatePortalPrefill', () => {
  it('includes border fields when border_crossings present', () => {
    const prefill = generatePortalPrefill(
      {
        origin_city: 'Tulsa',
        origin_state: 'OK',
        destination_city: 'Omaha',
        destination_state: 'NE',
        weight: 90000,
        length: 70,
        width: 10,
        height: 13.5,
        route_corridor: ['OK', 'KS', 'NE'],
        permit_required_states: ['OK', 'KS', 'NE'],
        border_crossings: OK_KS_NE_CROSSINGS,
        equipment: {},
        cargo: {},
      },
      'KS'
    )

    expect(prefill.generatedFields.border_role).toBe('through')
    expect(prefill.generatedFields.entry_point).toBe('36.99,-94.62 (US-69)')
    expect(prefill.generatedFields.exit_point).toBe('40,-95.9 (US-75)')
    expect(prefill.generatedFields.border_entry).toBe('36.99,-94.62 (US-69)')
    expect(prefill.generatedFields.border_exit).toBe('40,-95.9 (US-75)')
    expect(prefill.generatedFields.border_summary).toContain('Entry:')
    expect(prefill.generatedFields.border_summary).toContain('Exit:')
  })

  it('accepts camelCase borderCrossings on the request', () => {
    const prefill = generatePortalPrefill(
      {
        origin_city: 'Tulsa',
        origin_state: 'OK',
        destination_city: 'Omaha',
        destination_state: 'NE',
        weight: 90000,
        length: 70,
        width: 10,
        height: 13.5,
        route_corridor: ['OK', 'KS', 'NE'],
        permit_required_states: ['OK', 'KS', 'NE'],
        borderCrossings: OK_KS_NE_CROSSINGS,
        equipment: {},
        cargo: {},
      },
      'OK'
    )
    expect(prefill.generatedFields.border_role).toBe('origin')
    expect(prefill.generatedFields.exit_point).toBe('36.99,-94.62 (US-69)')
    expect(prefill.generatedFields.entry_point).toBe('')
  })

  it('always includes border field keys even when crossings absent', () => {
    const prefill = generatePortalPrefill(
      {
        origin_city: 'Tulsa',
        origin_state: 'OK',
        destination_city: 'Omaha',
        destination_state: 'NE',
        weight: 90000,
        length: 70,
        width: 10,
        height: 13.5,
        route_corridor: ['OK', 'KS', 'NE'],
        permit_required_states: ['OK'],
        equipment: {},
        cargo: {},
      },
      'KS'
    )
    expect(prefill.generatedFields).toHaveProperty('border_role', 'through')
    expect(prefill.generatedFields).toHaveProperty('entry_point', '')
    expect(prefill.generatedFields).toHaveProperty('exit_point', '')
    expect(prefill.generatedFields).toHaveProperty('border_entry', '')
    expect(prefill.generatedFields).toHaveProperty('border_exit', '')
    expect(prefill.generatedFields.border_summary).toMatch(/No geometry border crossings available/i)
  })

  it('formats dimensions as clean X\' Y" strings, not long decimals', () => {
    const prefill = generatePortalPrefill(
      {
        origin_city: 'Omaha',
        origin_state: 'NE',
        destination_city: 'Fargo',
        destination_state: 'ND',
        weight: 95000,
        length: 67.91666,
        width: 8.5,
        height: 13.3333,
        route_corridor: ['NE', 'SD', 'ND'],
        permit_required_states: ['NE'],
        equipment: {
          rig: {
            rigName: '93 Pete c/ SD',
            overallLengthFt: 74,
            totalAxles: 5,
            tractor: {
              profile_name: '93 Pete',
              unit_number: '4721',
              num_axles: 3,
              vin: '1XPBDP9X5HD123456',
            },
            trailers: [
              {
                profile_name: '53 SD',
                overall_length_ft: 53,
                num_axles: 2,
                vin: '1UYVS2535CM123456',
              },
            ],
          },
          loadOverhangs: { frontOfRigFt: 2, frontOfTrailerFt: 1, rearFt: 4 },
        },
        cargo: {},
      },
      'NE'
    )

    expect(prefill.generatedFields.length).toBe(`67' 11"`)
    expect(prefill.generatedFields.width).toBe(`8' 6"`)
    expect(prefill.generatedFields.height).toBe(`13' 4"`)
    expect(prefill.generatedFields.weight).toBe('95,000 lbs')
    expect(prefill.generatedFields.rig_name).toBe('93 Pete c/ SD')
    expect(prefill.generatedFields.axles).toBe(5)
    expect(prefill.generatedFields.vehicle_id).toBe('4721')
    expect(prefill.generatedFields.trailers).toContain('53 SD')
    expect(prefill.generatedFields.overhang).toBe('front 3 ft / rear 4 ft')
  })

  it('emits discrete tractor/trailer identity keys and ymm helpers from rig snapshot', () => {
    const prefill = generatePortalPrefill(
      {
        origin_city: 'Omaha',
        origin_state: 'NE',
        destination_city: 'Fargo',
        destination_state: 'ND',
        weight: 95000,
        length: 70,
        width: 8.5,
        height: 13.5,
        route_corridor: ['NE', 'SD', 'ND'],
        equipment: {
          rig: {
            totalAxles: 7,
            tractor: {
              unit_number: '4721',
              year: 2019,
              make: 'Peterbilt',
              model: '389',
              vin: '1XPBDP9X5HD123456',
              license_plate: 'abc1234',
              license_plate_state: 'tx',
            },
            trailers: [
              {
                profile_name: '53 SD',
                year: 2018,
                make: 'Fontaine',
                model: 'Magnitude',
                vin: '1UYVS2535CM111111',
                license_plate: 'trl111',
                license_plate_state: 'ne',
              },
              {
                profile_name: 'Jeep',
                year: 2020,
                make: 'Trail King',
                model: 'TK80',
                vin: '1JJJJ2222',
                license_plate: 'jeep9',
                license_plate_state: 'ks',
              },
            ],
          },
        },
        cargo: {},
      },
      'NE'
    )
    const f = prefill.generatedFields
    expect(f.tractor_year).toBe(2019)
    expect(f.tractor_make).toBe('Peterbilt')
    expect(f.tractor_model).toBe('389')
    expect(f.tractor_ymm).toBe('2019 Peterbilt 389')
    expect(f.tractor_vin).toBe('1XPBDP9X5HD123456')
    expect(f.tractor_plate).toBe('ABC1234')
    expect(f.tractor_plate_state).toBe('TX')
    expect(f.trailer_year).toBe(2018)
    expect(f.trailer_make).toBe('Fontaine')
    expect(f.trailer_model).toBe('Magnitude')
    expect(f.trailer_ymm).toBe('2018 Fontaine Magnitude')
    expect(f.trailer_vin).toBe('1UYVS2535CM111111')
    expect(f.trailer_plate).toBe('TRL111')
    expect(f.trailer_plate_state).toBe('NE')
    // Second trailer only when values present
    expect(f.trailer_2_year).toBe(2020)
    expect(f.trailer_2_make).toBe('Trail King')
    expect(f.trailer_2_model).toBe('TK80')
    expect(f.trailer_2_ymm).toBe('2020 Trail King TK80')
    expect(f.trailer_2_vin).toBe('1JJJJ2222')
    expect(f.trailer_2_plate).toBe('JEEP9')
    expect(f.trailer_2_plate_state).toBe('KS')
    // Backward-compat summaries still present
    expect(f.vehicle_id).toBe('4721')
    expect(f.trailers).toContain('53 SD')
    // Does not treat trailer_type as manufacturer make
    const noMake = generatePortalPrefill(
      {
        origin_city: 'A',
        origin_state: 'TX',
        destination_city: 'B',
        destination_state: 'OK',
        weight: 1,
        length: 1,
        width: 1,
        height: 1,
        route_corridor: ['TX'],
        equipment: {
          rig: {
            tractor: { unit_number: 'U1' },
            trailers: [{ trailer_type: 'Flatbed', profile_name: 'T1' }],
          },
        },
      },
      'TX'
    )
    expect(noMake.generatedFields.trailer_make).toBeUndefined()
    expect(noMake.generatedFields.trailer_ymm).toBeUndefined()
  })

  it('formatVehicleYmm joins only present parts', () => {
    expect(formatVehicleYmm(2019, 'Peterbilt', '389')).toBe('2019 Peterbilt 389')
    expect(formatVehicleYmm(null, 'Peterbilt', '389')).toBe('Peterbilt 389')
    expect(formatVehicleYmm(2019, null, null)).toBe('2019')
    expect(formatVehicleYmm(null, null, null)).toBeNull()
    expect(VEHICLE_IDENTITY_PREFILL_KEYS).toContain('tractor_ymm')
    expect(VEHICLE_IDENTITY_PREFILL_KEYS).toContain('trailer_plate_state')
  })

  it('includes carrier and driver fields from cargo.carrierDriver snapshot', () => {
    const prefill = generatePortalPrefill(
      {
        origin_city: 'Omaha',
        origin_state: 'NE',
        destination_city: 'Fargo',
        destination_state: 'ND',
        weight: 95000,
        length: 67,
        width: 8.5,
        height: 13.5,
        route_corridor: ['NE', 'SD', 'ND'],
        permit_required_states: ['NE'],
        equipment: {},
        cargo: {
          carrierDriver: {
            companyName: 'Acme Hauling',
            usdotNumber: '1234567',
            mcNumber: 'MC-999',
            carrierPhone: '555-0100',
            carrierEmail: 'ops@acme.com',
            driverFullName: 'Jane Doe',
            cdlNumber: 'D1234567',
            cdlState: 'TX',
            driverPhone: '555-0200',
          },
        },
      },
      'NE'
    )

    expect(prefill.generatedFields.carrier_company).toBe('Acme Hauling')
    expect(prefill.generatedFields.carrier_usdot).toBe('1234567')
    expect(prefill.generatedFields.carrier_mc).toBe('MC-999')
    expect(prefill.generatedFields.carrier_phone).toBe('555-0100')
    expect(prefill.generatedFields.carrier_email).toBe('ops@acme.com')
    expect(prefill.generatedFields.driver_name).toBe('Jane Doe')
    expect(prefill.generatedFields.driver_cdl).toBe('D1234567')
    expect(prefill.generatedFields.driver_cdl_state).toBe('TX')
    expect(prefill.generatedFields.driver_phone).toBe('555-0200')
  })

  it('defaults trip_type to Single trip and accepts options.tripType', () => {
    const base = {
      origin_city: 'Houston',
      origin_state: 'TX',
      destination_city: 'Dallas',
      destination_state: 'TX',
      weight: 80000,
      length: 60,
      width: 8.5,
      height: 13.5,
      route_corridor: ['TX'],
      permit_required_states: [],
      equipment: {},
      cargo: {},
    }
    const def = generatePortalPrefill(base, 'TX')
    expect(def.generatedFields.trip_type).toBe('Single trip')
    const round = generatePortalPrefill(base, 'TX', { tripType: 'Round trip' })
    expect(round.generatedFields.trip_type).toBe('Round trip')
    expect(PORTAL_TRIP_TYPES).toContain('Annual')
  })
})

describe('buildPortalClipboardPacket', () => {
  const richRequest = {
    origin_city: 'Tulsa',
    origin_state: 'OK',
    destination_city: 'Omaha',
    destination_state: 'NE',
    weight: 90000,
    length: 70,
    width: 10,
    height: 13.5,
    route_corridor: ['OK', 'KS', 'NE'],
    permit_required_states: ['OK', 'KS', 'NE'],
    border_crossings: OK_KS_NE_CROSSINGS,
    equipment: {
      rig: {
        totalAxles: 6,
        tractor: { unit_number: 'UNIT-1', vin: 'VIN123' },
      },
    },
    cargo: {
      carrierDriver: {
        companyName: 'Acme Hauling',
        usdotNumber: '1234567',
        mcNumber: 'MC-999',
        driverFullName: 'Jane Doe',
      },
    },
  }

  it('formats lines as "Portal label: value" using fieldMapping labels', () => {
    const prefill = generatePortalPrefill(richRequest, 'KS')
    const config = STATE_PORTAL_CONFIGS.KS
    const packet = buildPortalClipboardPacket(prefill, config)

    expect(packet).toContain(`${config.fieldMapping.origin}: Tulsa, OK`)
    expect(packet).toContain(`${config.fieldMapping.destination}: Omaha, NE`)
    expect(packet).toContain(`${config.fieldMapping.weight}:`)
    expect(packet).toContain(`${config.fieldMapping.route}: OK → KS → NE`)
    // Label: value shape
    for (const line of packet.split('\n')) {
      expect(line).toMatch(/^.+: .+$/)
    }
  })

  it('includes border entry/exit, axles, vehicle_id, carrier, driver, and trip type', () => {
    const prefill = generatePortalPrefill(richRequest, 'KS')
    const packet = buildPortalClipboardPacket(prefill, STATE_PORTAL_CONFIGS.KS)

    expect(packet).toMatch(/Border Entry: 36\.99,-94\.62 \(US-69\)/)
    expect(packet).toMatch(/Border Exit: 40,-95\.9 \(US-75\)/)
    expect(packet).toContain('Axles: 6')
    expect(packet).toContain('Vehicle / VIN: UNIT-1')
    expect(packet).toContain('USDOT: 1234567')
    expect(packet).toContain('MC Number: MC-999')
    expect(packet).toContain('Carrier Company: Acme Hauling')
    expect(packet).toContain('Driver: Jane Doe')
    expect(packet).toContain('Trip Type: Single trip')
  })

  it('honors options.tripType override over generatedFields', () => {
    const prefill = generatePortalPrefill(richRequest, 'KS', { tripType: 'Single trip' })
    const packet = buildPortalClipboardPacket(prefill, STATE_PORTAL_CONFIGS.KS, {
      tripType: 'Round trip',
    })
    expect(packet).toContain('Trip Type: Round trip')
    expect(packet).not.toContain('Trip Type: Single trip')
  })

  it('omits empty optional extras but always includes trip type', () => {
    const prefill = generatePortalPrefill(
      {
        origin_city: 'Houston',
        origin_state: 'TX',
        destination_city: 'Dallas',
        destination_state: 'TX',
        weight: 80000,
        length: 60,
        width: 8.5,
        height: 13.5,
        route_corridor: ['TX'],
        permit_required_states: [],
        equipment: {},
        cargo: {},
      },
      'TX'
    )
    const packet = buildPortalClipboardPacket(prefill, STATE_PORTAL_CONFIGS.TX)
    expect(packet).toContain('Trip Type: Single trip')
    expect(packet).not.toContain('USDOT:')
    expect(packet).not.toContain('Axles:')
    expect(packet).not.toContain('Border Entry:')
  })

  it('includes route corridor even when fieldMapping omits route (FL)', () => {
    const prefill = generatePortalPrefill(
      {
        origin_city: 'Miami',
        origin_state: 'FL',
        destination_city: 'Tampa',
        destination_state: 'FL',
        weight: 80000,
        length: 60,
        width: 8.5,
        height: 13.5,
        route_corridor: ['FL', 'GA'],
        permit_required_states: [],
        equipment: {},
        cargo: {},
      },
      'FL'
    )
    expect(STATE_PORTAL_CONFIGS.FL.fieldMapping.route).toBeUndefined()
    const packet = buildPortalClipboardPacket(prefill, STATE_PORTAL_CONFIGS.FL)
    expect(packet).toMatch(/Route corridor: FL → GA/)
  })

  it('supports Annual trip type and trims whitespace in values', () => {
    const prefill = generatePortalPrefill(
      {
        origin_city: '  Houston  ',
        origin_state: 'TX',
        destination_city: 'Dallas',
        destination_state: 'TX',
        weight: 80000,
        length: 60,
        width: 8.5,
        height: 13.5,
        route_corridor: ['TX'],
        equipment: {},
        cargo: {},
      },
      'TX',
      { tripType: 'Annual' }
    )
    // Inject padded field to assert packet trims
    prefill.generatedFields.carrier_usdot = '  123  '
    const packet = buildPortalClipboardPacket(prefill, STATE_PORTAL_CONFIGS.TX, {
      tripType: 'Annual',
    })
    expect(packet).toContain('Trip Type: Annual')
    expect(packet).toContain('USDOT: 123')
    expect(packet).not.toContain('USDOT:  123')
  })

  it('dedupes route when already present via fieldMapping', () => {
    const prefill = generatePortalPrefill(
      {
        origin_city: 'Houston',
        origin_state: 'TX',
        destination_city: 'Dallas',
        destination_state: 'TX',
        weight: 80000,
        length: 60,
        width: 8.5,
        height: 13.5,
        route_corridor: ['TX', 'OK'],
        equipment: {},
        cargo: {},
      },
      'TX'
    )
    const packet = buildPortalClipboardPacket(prefill, STATE_PORTAL_CONFIGS.TX)
    const routeLines = packet.split('\n').filter((l) => /route|corridor/i.test(l.split(':')[0]))
    expect(routeLines.length).toBe(1)
  })
})

describe('buildPortalCompletenessChecklist', () => {
  it('passes when origin, dest, dims, carrier, and vehicle present', () => {
    const prefill = generatePortalPrefill(
      {
        origin_city: 'Houston',
        origin_state: 'TX',
        destination_city: 'Dallas',
        destination_state: 'TX',
        weight: 80000,
        length: 60,
        width: 8.5,
        height: 13.5,
        route_corridor: ['TX'],
        permit_required_states: [],
        equipment: {
          rig: {
            tractor: {
              unit_number: 'T-1',
              vin: '1XPBTESTVIN000001',
              year: 2019,
              make: 'Peterbilt',
              model: '389',
            },
          },
        },
        cargo: {
          carrierDriver: { usdotNumber: '999', companyName: 'Co' },
        },
      },
      'TX'
    )
    const checklist = buildPortalCompletenessChecklist(prefill, STATE_PORTAL_CONFIGS.TX)
    expect(checklist.warnCount).toBe(0)
    expect(checklist.ready).toBe(true)
    expect(checklist.items.find((i) => i.id === 'origin')?.status).toBe('pass')
    expect(checklist.items.find((i) => i.id === 'dimensions')?.status).toBe('pass')
    expect(checklist.items.find((i) => i.id === 'carrier')?.status).toBe('pass')
    expect(checklist.items.find((i) => i.id === 'vehicle')?.status).toBe('pass')
    expect(checklist.items.find((i) => i.id === 'vehicle_ymm')?.status).toBe('pass')
    // Single-state: no route corridor item required
    expect(checklist.items.find((i) => i.id === 'route')).toBeUndefined()
  })

  it('warns missing carrier with Profile/Permit Test fix hint', () => {
    const prefill = generatePortalPrefill(
      {
        origin_city: 'Houston',
        origin_state: 'TX',
        destination_city: 'Dallas',
        destination_state: 'TX',
        weight: 80000,
        length: 60,
        width: 8.5,
        height: 13.5,
        route_corridor: ['TX'],
        permit_required_states: [],
        equipment: { unit_number: 'T-1' },
        cargo: {},
      },
      'TX'
    )
    const checklist = buildPortalCompletenessChecklist(prefill, STATE_PORTAL_CONFIGS.TX)
    const carrier = checklist.items.find((i) => i.id === 'carrier')
    expect(carrier?.status).toBe('warn')
    expect(carrier?.hint).toMatch(/USDOT on Profile \/ Permit Test carrier section/)
    expect(checklist.ready).toBe(false)
  })

  it('requires route corridor on multi-state and border for through role', () => {
    const prefill = generatePortalPrefill(
      {
        origin_city: 'Tulsa',
        origin_state: 'OK',
        destination_city: 'Omaha',
        destination_state: 'NE',
        weight: 90000,
        length: 70,
        width: 10,
        height: 13.5,
        route_corridor: ['OK', 'KS', 'NE'],
        permit_required_states: ['KS'],
        border_crossings: OK_KS_NE_CROSSINGS,
        equipment: { unit_number: 'U1' },
        cargo: { carrierDriver: { usdotNumber: '1' } },
      },
      'KS'
    )
    const checklist = buildPortalCompletenessChecklist(prefill, STATE_PORTAL_CONFIGS.KS)
    expect(checklist.items.find((i) => i.id === 'route')?.status).toBe('pass')
    expect(checklist.items.find((i) => i.id === 'border')?.status).toBe('pass')
    expect(checklist.items.find((i) => i.id === 'border')?.label).toMatch(/entry & exit/i)
  })

  it('warns through state missing border points with geometry hint', () => {
    const prefill = generatePortalPrefill(
      {
        origin_city: 'Tulsa',
        origin_state: 'OK',
        destination_city: 'Omaha',
        destination_state: 'NE',
        weight: 90000,
        length: 70,
        width: 10,
        height: 13.5,
        route_corridor: ['OK', 'KS', 'NE'],
        permit_required_states: ['KS'],
        equipment: { unit_number: 'U1' },
        cargo: { carrierDriver: { companyName: 'Acme' } },
      },
      'KS'
    )
    const checklist = buildPortalCompletenessChecklist(prefill, STATE_PORTAL_CONFIGS.KS)
    const border = checklist.items.find((i) => i.id === 'border')
    expect(border?.status).toBe('warn')
    expect(border?.hint).toMatch(/geometry/i)
  })

  it('origin role checks exit only; destination role checks entry only', () => {
    const originPrefill = generatePortalPrefill(
      {
        origin_city: 'Tulsa',
        origin_state: 'OK',
        destination_city: 'Omaha',
        destination_state: 'NE',
        weight: 90000,
        length: 70,
        width: 10,
        height: 13.5,
        route_corridor: ['OK', 'KS', 'NE'],
        permit_required_states: [],
        border_crossings: OK_KS_NE_CROSSINGS,
        equipment: { unit_number: 'U1' },
        cargo: { carrierDriver: { usdotNumber: '1' } },
      },
      'OK'
    )
    const originCheck = buildPortalCompletenessChecklist(
      originPrefill,
      STATE_PORTAL_CONFIGS.OK
    )
    expect(originCheck.items.find((i) => i.id === 'border')?.label).toMatch(/exit/i)
    expect(originCheck.items.find((i) => i.id === 'border')?.status).toBe('pass')

    const destPrefill = generatePortalPrefill(
      {
        origin_city: 'Tulsa',
        origin_state: 'OK',
        destination_city: 'Omaha',
        destination_state: 'NE',
        weight: 90000,
        length: 70,
        width: 10,
        height: 13.5,
        route_corridor: ['OK', 'KS', 'NE'],
        permit_required_states: [],
        border_crossings: OK_KS_NE_CROSSINGS,
        equipment: { unit_number: 'U1' },
        cargo: { carrierDriver: { usdotNumber: '1' } },
      },
      'NE'
    )
    const destCheck = buildPortalCompletenessChecklist(destPrefill, STATE_PORTAL_CONFIGS.NE)
    expect(destCheck.items.find((i) => i.id === 'border')?.label).toMatch(/entry/i)
    expect(destCheck.items.find((i) => i.id === 'border')?.status).toBe('pass')
  })

  it('skips vehicle check when requiresVehicleInfo is false', () => {
    // FL has requiresVehicleInfo: false
    const prefill = generatePortalPrefill(
      {
        origin_city: 'Miami',
        origin_state: 'FL',
        destination_city: 'Tampa',
        destination_state: 'FL',
        weight: 80000,
        length: 60,
        width: 8.5,
        height: 13.5,
        route_corridor: ['FL'],
        permit_required_states: [],
        equipment: {},
        cargo: { carrierDriver: { companyName: 'FL Co' } },
      },
      'FL'
    )
    const checklist = buildPortalCompletenessChecklist(prefill, STATE_PORTAL_CONFIGS.FL)
    expect(checklist.items.find((i) => i.id === 'vehicle')).toBeUndefined()
    expect(checklist.ready).toBe(true)
  })

  it('resolvePortalFieldLabel prefers fieldMapping over fallbacks', () => {
    expect(resolvePortalFieldLabel('origin', STATE_PORTAL_CONFIGS.TX)).toBe(
      'Origin Location'
    )
    expect(resolvePortalFieldLabel('trip_type')).toBe('Trip Type')
    expect(resolvePortalFieldLabel('vehicle_id')).toBe('Vehicle / VIN')
  })

  it('warns missing origin/destination/dims/vehicle and rejects undefined O/D false-pass', () => {
    const prefill = generatePortalPrefill(
      {
        origin_city: undefined,
        origin_state: 'TX',
        destination_city: '',
        destination_state: 'OK',
        weight: 0,
        length: null,
        width: 8.5,
        height: 13.5,
        route_corridor: ['TX'],
        equipment: {},
        cargo: { carrierDriver: { usdotNumber: '1' } },
      },
      'TX'
    )
    // Generation must not produce "undefined, TX" — requires both city and state
    expect(prefill.generatedFields.origin).toBe('')
    expect(prefill.generatedFields.destination).toBe('')
    const genCheck = buildPortalCompletenessChecklist(prefill, STATE_PORTAL_CONFIGS.TX)
    expect(genCheck.items.find((i) => i.id === 'origin')?.status).toBe('warn')
    expect(genCheck.items.find((i) => i.id === 'destination')?.status).toBe('warn')
    expect(genCheck.items.find((i) => i.id === 'dimensions')?.status).toBe('warn')
    expect(genCheck.items.find((i) => i.id === 'vehicle')?.status).toBe('warn')

    // Legacy placeholder strings also rejected by hasPrefillValue
    const broken: PrefillPackage = {
      ...prefill,
      generatedFields: {
        ...prefill.generatedFields,
        origin: 'undefined, TX',
        destination: ', ',
        weight: '',
        length: '',
        width: '',
        height: '',
        vehicle_id: '',
      },
    }
    const checklist = buildPortalCompletenessChecklist(broken, STATE_PORTAL_CONFIGS.TX)
    expect(checklist.items.find((i) => i.id === 'origin')?.status).toBe('warn')
    expect(checklist.items.find((i) => i.id === 'destination')?.status).toBe('warn')
    expect(hasPrefillValue('undefined, TX')).toBe(false)
    expect(hasPrefillValue('City, null')).toBe(false)
    expect(formatPortalCityState(undefined, 'TX')).toBe('')
    expect(formatPortalCityState(undefined, undefined)).toBe('')
    expect(formatPortalCityState('Houston', 'TX')).toBe('Houston, TX')
  })

  it('warns multi-state when route string empty (not circular on corridor length)', () => {
    const prefill = generatePortalPrefill(
      {
        origin_city: 'Tulsa',
        origin_state: 'OK',
        destination_city: 'Omaha',
        destination_state: 'NE',
        weight: 90000,
        length: 70,
        width: 10,
        height: 13.5,
        route_corridor: ['OK', 'KS', 'NE'],
        equipment: { unit_number: 'U1' },
        cargo: { carrierDriver: { usdotNumber: '1' } },
      },
      'KS'
    )
    // Clear route + corridor so multi-state is forced via context, route is missing
    const stripped: PrefillPackage = {
      ...prefill,
      routeCorridor: [],
      generatedFields: { ...prefill.generatedFields, route: '' },
    }
    const checklist = buildPortalCompletenessChecklist(stripped, STATE_PORTAL_CONFIGS.KS, {
      multiState: true,
    })
    expect(checklist.items.find((i) => i.id === 'route')?.status).toBe('warn')
    expect(checklist.items.find((i) => i.id === 'route')?.hint).toMatch(/corridor/i)
  })

  it('warns origin missing exit and destination missing entry', () => {
    const base = {
      origin_city: 'Tulsa',
      origin_state: 'OK',
      destination_city: 'Omaha',
      destination_state: 'NE',
      weight: 90000,
      length: 70,
      width: 10,
      height: 13.5,
      route_corridor: ['OK', 'KS', 'NE'],
      equipment: { unit_number: 'U1' },
      cargo: { carrierDriver: { usdotNumber: '1' } },
    }
    const originPrefill = generatePortalPrefill(base, 'OK')
    originPrefill.generatedFields.exit_point = ''
    originPrefill.generatedFields.border_exit = ''
    const originCheck = buildPortalCompletenessChecklist(
      originPrefill,
      STATE_PORTAL_CONFIGS.OK
    )
    expect(originCheck.items.find((i) => i.id === 'border')?.status).toBe('warn')
    expect(originCheck.items.find((i) => i.id === 'border')?.label).toMatch(/exit/i)

    const destPrefill = generatePortalPrefill(base, 'NE')
    destPrefill.generatedFields.entry_point = ''
    destPrefill.generatedFields.border_entry = ''
    const destCheck = buildPortalCompletenessChecklist(destPrefill, STATE_PORTAL_CONFIGS.NE)
    expect(destCheck.items.find((i) => i.id === 'border')?.status).toBe('warn')
    expect(destCheck.items.find((i) => i.id === 'border')?.label).toMatch(/entry/i)
  })

  it('warns multi-leg load with empty corridor via origin≠dest', () => {
    const prefill = generatePortalPrefill(
      {
        origin_city: 'Houston',
        origin_state: 'TX',
        destination_city: 'Chicago',
        destination_state: 'IL',
        weight: 90000,
        length: 70,
        width: 10,
        height: 13.5,
        route_corridor: [],
        equipment: { unit_number: 'U1' },
        cargo: { carrierDriver: { companyName: 'Co' } },
      },
      'TX'
    )
    expect(prefill.generatedFields.route).toBeUndefined()
    const checklist = buildPortalCompletenessChecklist(prefill, STATE_PORTAL_CONFIGS.TX)
    expect(checklist.items.find((i) => i.id === 'route')?.status).toBe('warn')
  })

  it('MO completeness prefers USDOT and requires axles when requiresVehicleInfo', () => {
    const thinCarrier = generatePortalPrefill(
      {
        origin_city: 'St. Louis',
        origin_state: 'MO',
        destination_city: 'Kansas City',
        destination_state: 'MO',
        weight: 90000,
        length: 70,
        width: 10,
        height: 13.5,
        route_corridor: ['MO'],
        equipment: { unit_number: 'MO-1' },
        cargo: { carrierDriver: { companyName: 'Thin Co' } },
      },
      'MO'
    )
    const thinCheck = buildPortalCompletenessChecklist(
      thinCarrier,
      STATE_PORTAL_CONFIGS.MO
    )
    // Company alone is not enough for MO — USDOT required
    expect(thinCheck.items.find((i) => i.id === 'carrier')?.status).toBe('warn')
    expect(thinCheck.items.find((i) => i.id === 'carrier')?.label).toBe('USDOT')
    // Axles missing
    expect(thinCheck.items.find((i) => i.id === 'axles')?.status).toBe('warn')
    expect(thinCheck.items.find((i) => i.id === 'vehicle')?.status).toBe('pass')
    // Soft note: year/make/model empty
    expect(thinCheck.items.find((i) => i.id === 'vehicle_ymm')?.status).toBe('warn')

    const full = generatePortalPrefill(
      {
        origin_city: 'St. Louis',
        origin_state: 'MO',
        destination_city: 'Kansas City',
        destination_state: 'MO',
        weight: 90000,
        length: 70,
        width: 10,
        height: 13.5,
        route_corridor: ['MO'],
        equipment: {
          rig: {
            totalAxles: 5,
            tractor: {
              unit_number: 'MO-1',
              year: 2020,
              make: 'Kenworth',
              model: 'W900',
              vin: '1XKWDM9X5LJ123456',
              license_plate: 'MOUNIT1',
              license_plate_state: 'MO',
            },
          },
        },
        cargo: { carrierDriver: { usdotNumber: '1234567', companyName: 'Full Co' } },
      },
      'MO'
    )
    const fullCheck = buildPortalCompletenessChecklist(full, STATE_PORTAL_CONFIGS.MO)
    expect(fullCheck.items.find((i) => i.id === 'carrier')?.status).toBe('pass')
    expect(fullCheck.items.find((i) => i.id === 'axles')?.status).toBe('pass')
    expect(fullCheck.items.find((i) => i.id === 'vehicle')?.status).toBe('pass')
    expect(fullCheck.items.find((i) => i.id === 'vehicle_ymm')?.status).toBe('pass')
    expect(fullCheck.ready).toBe(true)
  })

  it('warns when requiresVehicleInfo and both VIN and plate are missing', () => {
    const prefill = generatePortalPrefill(
      {
        origin_city: 'Dallas',
        origin_state: 'TX',
        destination_city: 'Austin',
        destination_state: 'TX',
        weight: 80000,
        length: 65,
        width: 8.5,
        height: 13.5,
        route_corridor: ['TX'],
        equipment: {
          // No unit_number / vin / plate → vehicle_id empty
          rig: { tractor: { num_axles: 3 } },
        },
        cargo: { carrierDriver: { companyName: 'Co', usdotNumber: '1' } },
      },
      'TX'
    )
    // No vehicle_id, vin, or plate
    expect(prefill.generatedFields.vehicle_id).toBeUndefined()
    expect(prefill.generatedFields.tractor_vin).toBeUndefined()
    expect(prefill.generatedFields.tractor_plate).toBeUndefined()
    const checklist = buildPortalCompletenessChecklist(prefill, STATE_PORTAL_CONFIGS.TX)
    expect(checklist.items.find((i) => i.id === 'vehicle')?.status).toBe('warn')
    expect(checklist.items.find((i) => i.id === 'vehicle_ymm')?.status).toBe('warn')
    // Soft ymm note does not block ready by itself when vehicle is the only hard fail
    // (ready still false because vehicle is hard warn)
    expect(checklist.ready).toBe(false)

    // Plate alone is enough for vehicle; soft ymm pass with year/make
    const withPlate = generatePortalPrefill(
      {
        origin_city: 'Dallas',
        origin_state: 'TX',
        destination_city: 'Austin',
        destination_state: 'TX',
        weight: 80000,
        length: 65,
        width: 8.5,
        height: 13.5,
        route_corridor: ['TX'],
        equipment: {
          rig: {
            tractor: {
              license_plate: 'ABC123',
              license_plate_state: 'TX',
              year: 2018,
              make: 'Freightliner',
            },
          },
        },
        cargo: { carrierDriver: { companyName: 'Co', usdotNumber: '1' } },
      },
      'TX'
    )
    const plateCheck = buildPortalCompletenessChecklist(withPlate, STATE_PORTAL_CONFIGS.TX)
    expect(plateCheck.items.find((i) => i.id === 'vehicle')?.status).toBe('pass')
    expect(plateCheck.items.find((i) => i.id === 'vehicle_ymm')?.status).toBe('pass')
  })

  it('treats missing year/make/model as soft note that does not block ready', () => {
    const prefill = generatePortalPrefill(
      {
        origin_city: 'Dallas',
        origin_state: 'TX',
        destination_city: 'Austin',
        destination_state: 'TX',
        weight: 80000,
        length: 65,
        width: 8.5,
        height: 13.5,
        route_corridor: ['TX'],
        equipment: {
          rig: {
            tractor: { unit_number: 'U9', vin: 'VINONLY12345678901' },
          },
        },
        cargo: { carrierDriver: { companyName: 'Co', usdotNumber: '1' } },
      },
      'TX'
    )
    const checklist = buildPortalCompletenessChecklist(prefill, STATE_PORTAL_CONFIGS.TX)
    expect(checklist.items.find((i) => i.id === 'vehicle')?.status).toBe('pass')
    expect(checklist.items.find((i) => i.id === 'vehicle_ymm')?.status).toBe('warn')
    expect(checklist.ready).toBe(true)
  })
})

describe('Missouri Portal Assist playbook', () => {
  const moCorridorRequest = {
    origin_city: 'Tulsa',
    origin_state: 'OK',
    destination_city: 'Chicago',
    destination_state: 'IL',
    weight: 95000,
    length: 75,
    width: 11,
    height: 13.5,
    route_corridor: ['OK', 'MO', 'IL'],
    permit_required_states: ['OK', 'MO', 'IL'],
    border_crossings: [
      {
        fromState: 'OK',
        toState: 'MO',
        entry: { lat: 36.9, lon: -94.5, highway: 'I-44' },
        exit: { lat: 37.0, lon: -94.4, highway: 'I-44' },
      },
      {
        fromState: 'MO',
        toState: 'IL',
        entry: { lat: 38.6, lon: -90.2, highway: 'I-70' },
        exit: { lat: 38.7, lon: -90.1, highway: 'I-70' },
      },
    ],
    equipment: {
      rig: {
        totalAxles: 6,
        tractor: { unit_number: 'PWR-9', vin: 'VINMO9' },
      },
    },
    cargo: {
      carrierDriver: {
        companyName: 'Show-Me Haul',
        usdotNumber: '7654321',
        driverFullName: 'Pat Driver',
      },
    },
  }

  it('isMissouriPortal detects MO by state code and config', () => {
    expect(isMissouriPortal('MO')).toBe(true)
    expect(isMissouriPortal('mo')).toBe(true)
    expect(isMissouriPortal('TX')).toBe(false)
    expect(isMissouriPortal(null, STATE_PORTAL_CONFIGS.MO)).toBe(true)
    expect(isMissouriPortal(null, STATE_PORTAL_CONFIGS.TX)).toBe(false)
  })

  it('exposes MO field order and MoDOT-oriented labels', () => {
    expect(getMoPortalFieldOrder()).toEqual([...MO_PORTAL_FIELD_ORDER])
    // Full order: dims/axles → vehicle identity → vehicle_id → route/borders → carrier
    expect(MO_PORTAL_FIELD_ORDER.join(',')).toBe(
      [
        'trip_type',
        'origin',
        'destination',
        'weight',
        'length',
        'width',
        'height',
        'axles',
        'tractor_year',
        'tractor_make',
        'tractor_model',
        'tractor_ymm',
        'tractor_vin',
        'tractor_plate',
        'tractor_plate_state',
        'trailer_year',
        'trailer_make',
        'trailer_model',
        'trailer_ymm',
        'trailer_vin',
        'trailer_plate',
        'trailer_plate_state',
        'trailer_2_year',
        'trailer_2_make',
        'trailer_2_model',
        'trailer_2_ymm',
        'trailer_2_vin',
        'trailer_2_plate',
        'trailer_2_plate_state',
        'vehicle_id',
        'route',
        'border_entry',
        'border_exit',
        'carrier_usdot',
        'carrier_mc',
        'carrier_company',
        'driver_name',
      ].join(',')
    )
    expect(getMoPortalFieldLabel('trip_type')).toBe('Permit type')
    expect(getMoPortalFieldLabel('origin')).toBe('Origin (city, state / junction)')
    expect(getMoPortalFieldLabel('destination')).toBe(
      'Destination (city, state / junction)'
    )
    expect(getMoPortalFieldLabel('weight')).toBe('Gross weight (lbs)')
    expect(getMoPortalFieldLabel('length')).toBe('Overall length')
    expect(getMoPortalFieldLabel('width')).toBe('Overall width')
    expect(getMoPortalFieldLabel('height')).toBe('Overall height')
    expect(getMoPortalFieldLabel('axles')).toBe('Number of axles')
    expect(getMoPortalFieldLabel('route')).toBe('Requested route / corridor')
    expect(getMoPortalFieldLabel('border_entry')).toBe('Entry into Missouri')
    expect(getMoPortalFieldLabel('border_exit')).toBe('Exit from Missouri')
    expect(getMoPortalFieldLabel('vehicle_id')).toBe('Power unit ID / VIN')
    expect(getMoPortalFieldLabel('tractor_year')).toBe('Power unit year')
    expect(getMoPortalFieldLabel('tractor_make')).toBe('Power unit make')
    expect(getMoPortalFieldLabel('tractor_model')).toBe('Power unit model')
    expect(getMoPortalFieldLabel('tractor_ymm')).toBe('Power unit year/make/model')
    expect(getMoPortalFieldLabel('tractor_vin')).toBe('Power unit VIN')
    expect(getMoPortalFieldLabel('tractor_plate')).toBe('Power unit plate')
    expect(getMoPortalFieldLabel('tractor_plate_state')).toBe('Power unit plate state')
    expect(getMoPortalFieldLabel('trailer_year')).toBe('Trailer year')
    expect(getMoPortalFieldLabel('trailer_make')).toBe('Trailer make')
    expect(getMoPortalFieldLabel('trailer_model')).toBe('Trailer model')
    expect(getMoPortalFieldLabel('trailer_ymm')).toBe('Trailer year/make/model')
    expect(getMoPortalFieldLabel('trailer_vin')).toBe('Trailer VIN')
    expect(getMoPortalFieldLabel('trailer_plate')).toBe('Trailer plate')
    expect(getMoPortalFieldLabel('trailer_plate_state')).toBe('Trailer plate state')
    expect(getMoPortalFieldLabel('carrier_usdot')).toBe('USDOT')
    expect(getMoPortalFieldLabel('carrier_mc')).toBe('MC number')
    expect(getMoPortalFieldLabel('carrier_company')).toBe('Carrier name')
    expect(getMoPortalFieldLabel('driver_name')).toBe('Driver name')
    expect(MO_PORTAL_FIELD_LABELS.entry_point).toBe('Entry into Missouri')
  })

  it('buildPortalClipboardPacket uses MO order and labels when state is MO', () => {
    const prefill = generatePortalPrefill(
      {
        ...moCorridorRequest,
        equipment: {
          rig: {
            totalAxles: 6,
            tractor: {
              unit_number: 'PWR-9',
              vin: 'VINMO9',
              year: 2021,
              make: 'Peterbilt',
              model: '579',
              license_plate: 'mo999',
              license_plate_state: 'mo',
            },
            trailers: [
              {
                year: 2017,
                make: 'Landoll',
                model: '455',
                vin: 'TRLMO1',
                license_plate: 'trlmo',
                license_plate_state: 'mo',
              },
            ],
          },
        },
        cargo: {
          carrierDriver: {
            companyName: 'Show-Me Haul',
            usdotNumber: '7654321',
            mcNumber: 'MC-4242',
            driverFullName: 'Pat Driver',
          },
        },
      },
      'MO'
    )
    const packet = buildPortalClipboardPacket(prefill, STATE_PORTAL_CONFIGS.MO, {
      tripType: 'Single trip',
    })
    const lines = packet.split('\n')
    // Permit type first
    expect(lines[0]).toBe('Permit type: Single trip')
    expect(packet).toContain('Origin (city, state / junction): Tulsa, OK')
    expect(packet).toContain('Destination (city, state / junction): Chicago, IL')
    expect(packet).toContain('Gross weight (lbs):')
    expect(packet).toContain('Overall length:')
    expect(packet).toContain('Overall width:')
    expect(packet).toContain('Overall height:')
    expect(packet).toContain('Number of axles: 6')
    expect(packet).toContain('Power unit year: 2021')
    expect(packet).toContain('Power unit make: Peterbilt')
    expect(packet).toContain('Power unit model: 579')
    expect(packet).toContain('Power unit year/make/model: 2021 Peterbilt 579')
    expect(packet).toContain('Power unit VIN: VINMO9')
    expect(packet).toContain('Power unit plate: MO999')
    expect(packet).toContain('Power unit plate state: MO')
    expect(packet).toContain('Trailer year: 2017')
    expect(packet).toContain('Trailer make: Landoll')
    expect(packet).toContain('Trailer VIN: TRLMO1')
    expect(packet).toContain('Trailer plate: TRLMO')
    expect(packet).toContain('Trailer plate state: MO')
    expect(packet).toContain('Requested route / corridor: OK → MO → IL')
    expect(packet).toMatch(/Entry into Missouri:/)
    expect(packet).toMatch(/Exit from Missouri:/)
    expect(packet).toContain('Power unit ID / VIN: PWR-9')
    expect(packet).toContain('USDOT: 7654321')
    expect(packet).toContain('MC number: MC-4242')
    expect(packet).toContain('Carrier name: Show-Me Haul')
    expect(packet).toContain('Driver name: Pat Driver')
    // Identity after axles, before route/borders
    const idx = (label: string) =>
      lines.findIndex((l) => l.startsWith(label + ':') || l.startsWith(label))
    expect(idx('Permit type')).toBeLessThan(idx('Origin (city, state / junction)'))
    expect(idx('Number of axles')).toBeLessThan(idx('Power unit year'))
    expect(idx('Power unit VIN')).toBeLessThan(idx('Requested route / corridor'))
    expect(idx('Number of axles')).toBeLessThan(idx('Requested route / corridor'))
    expect(idx('USDOT')).toBeLessThan(idx('MC number'))
    expect(idx('MC number')).toBeLessThan(idx('Carrier name'))
    expect(idx('Carrier name')).toBeLessThan(idx('Driver name'))
  })

  it('generic clipboard path unchanged for non-MO states', () => {
    const prefill = generatePortalPrefill(moCorridorRequest, 'OK')
    const packet = buildPortalClipboardPacket(prefill, STATE_PORTAL_CONFIGS.OK)
    expect(packet).not.toContain('Permit type:')
    expect(packet).toContain('Trip Type: Single trip')
    expect(packet).not.toContain('Entry into Missouri')
  })

  it('resolvePortalFieldLabel uses MO labels for MO config', () => {
    expect(resolvePortalFieldLabel('origin', STATE_PORTAL_CONFIGS.MO)).toBe(
      'Origin (city, state / junction)'
    )
    expect(resolvePortalFieldLabel('trip_type', STATE_PORTAL_CONFIGS.MO)).toBe(
      'Permit type'
    )
    expect(resolvePortalFieldLabel('axles', STATE_PORTAL_CONFIGS.MO)).toBe(
      'Number of axles'
    )
    // Non-MO still uses fieldMapping / fallbacks
    expect(resolvePortalFieldLabel('origin', STATE_PORTAL_CONFIGS.TX)).toBe(
      'Origin Location'
    )
  })

  it('buildMoFilingSteps filters multiStateOnly for single-state MO and renumbers', () => {
    const single = generatePortalPrefill(
      {
        origin_city: 'St. Louis',
        origin_state: 'MO',
        destination_city: 'Kansas City',
        destination_state: 'MO',
        weight: 90000,
        length: 70,
        width: 10,
        height: 13.5,
        route_corridor: ['MO'],
        equipment: {},
        cargo: {},
      },
      'MO'
    )
    expect(isMoMultiStatePrefill(single)).toBe(false)
    const singleSteps = buildMoFilingSteps(single)
    expect(singleSteps.find((s) => s.id === 'route_borders')).toBeUndefined()
    expect(singleSteps.map((s) => s.id)).toEqual([
      'login',
      'start',
      'origin_dest',
      'dims_weight',
      'axles_vehicle',
      'carrier_driver',
      'review_pay',
    ])
    expect(singleSteps.map((s) => s.stepNumber)).toEqual([1, 2, 3, 4, 5, 6, 7])

    const multi = generatePortalPrefill(moCorridorRequest, 'MO')
    expect(isMoMultiStatePrefill(multi)).toBe(true)
    const multiSteps = buildMoFilingSteps(multi)
    expect(multiSteps).toHaveLength(8)
    expect(multiSteps.map((s) => s.stepNumber)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    expect(multiSteps.find((s) => s.id === 'route_borders')?.prefillKeys).toEqual([
      'route',
      'border_entry',
      'border_exit',
    ])
    expect(multiSteps.find((s) => s.id === 'carrier_driver')?.prefillKeys).toEqual([
      'carrier_usdot',
      'carrier_mc',
      'carrier_company',
      'driver_name',
    ])
    // Without prefill: multiState false → omit route step
    const noPrefill = buildMoFilingSteps()
    expect(noPrefill.find((s) => s.id === 'route_borders')).toBeUndefined()
  })

  it('buildMoFilingStepClipboard copies step keys with MO labels (od, dims, trip, axles, route, carrier)', () => {
    const prefill = generatePortalPrefill(
      {
        ...moCorridorRequest,
        cargo: {
          carrierDriver: {
            companyName: 'Show-Me Haul',
            usdotNumber: '7654321',
            mcNumber: 'MC-4242',
            driverFullName: 'Pat Driver',
          },
        },
      },
      'MO'
    )
    const steps = buildMoFilingSteps(prefill)

    const od = steps.find((s) => s.id === 'origin_dest')!
    const odPacket = buildMoFilingStepClipboard(prefill, od)
    expect(odPacket).toContain('Origin (city, state / junction): Tulsa, OK')
    expect(odPacket).toContain('Destination (city, state / junction): Chicago, IL')
    expect(odPacket).not.toContain('USDOT')

    const dims = steps.find((s) => s.id === 'dims_weight')!
    const dimsPacket = buildMoFilingStepClipboard(prefill, dims)
    expect(dimsPacket).toContain('Overall length:')
    expect(dimsPacket).toContain('Gross weight (lbs):')

    const start = steps.find((s) => s.id === 'start')!
    expect(buildMoFilingStepClipboard(prefill, start, { tripType: 'Round trip' })).toBe(
      'Permit type: Round trip'
    )

    const axles = steps.find((s) => s.id === 'axles_vehicle')!
    const axlesPacket = buildMoFilingStepClipboard(prefill, axles)
    expect(axlesPacket).toContain('Number of axles: 6')
    expect(axlesPacket).toContain('Power unit ID / VIN: PWR-9')

    const route = steps.find((s) => s.id === 'route_borders')!
    const routePacket = buildMoFilingStepClipboard(prefill, route)
    expect(routePacket).toContain('Requested route / corridor: OK → MO → IL')
    expect(routePacket).toMatch(/Entry into Missouri:/)
    expect(routePacket).toMatch(/Exit from Missouri:/)

    const carrier = steps.find((s) => s.id === 'carrier_driver')!
    const carrierPacket = buildMoFilingStepClipboard(prefill, carrier)
    expect(carrierPacket).toContain('USDOT: 7654321')
    expect(carrierPacket).toContain('MC number: MC-4242')
    expect(carrierPacket).toContain('Carrier name: Show-Me Haul')
    expect(carrierPacket).toContain('Driver name: Pat Driver')

    const login = steps.find((s) => s.id === 'login')!
    expect(buildMoFilingStepClipboard(prefill, login)).toBe('')
  })

  it('MO walkthrough is static honest copy without invented menus', () => {
    expect(MO_PORTAL_WALKTHROUGH.length).toBeGreaterThanOrEqual(5)
    const joined = MO_PORTAL_WALKTHROUGH.join(' ')
    expect(joined).toMatch(/sign in/i)
    expect(joined).toMatch(/OSOW|oversize/i)
    expect(joined).toMatch(/Single trip/i)
    expect(joined).toMatch(/permit #/i)
    // Do not invent exact nested menu paths
    expect(joined).not.toMatch(/click File > Applications > New/i)
  })

  it('MO config points at Carrier Express login', () => {
    const mo = STATE_PORTAL_CONFIGS.MO
    expect(mo.portalUrl).toMatch(/modot\.mo\.gov/i)
    expect(mo.portalSystemName).toMatch(/Carrier Express/i)
    expect(mo.fieldMapping.origin).toBe('Origin (city, state / junction)')
    expect(mo.requiresVehicleInfo).toBe(true)
  })
})

describe('openStatePortals', () => {
  it('opens each state portalUrl with a unique target', () => {
    const openTab = vi.fn()
    openStatePortals(['NE', 'SD', 'ND'], { staggerMs: 0, openTab })

    expect(openTab).toHaveBeenCalledTimes(3)
    expect(openTab).toHaveBeenNthCalledWith(
      1,
      STATE_PORTAL_CONFIGS.NE.portalUrl,
      '_truckeros_portal_NE'
    )
    expect(openTab).toHaveBeenNthCalledWith(
      2,
      STATE_PORTAL_CONFIGS.SD.portalUrl,
      '_truckeros_portal_SD'
    )
    expect(openTab).toHaveBeenNthCalledWith(
      3,
      STATE_PORTAL_CONFIGS.ND.portalUrl,
      '_truckeros_portal_ND'
    )
  })

  it('skips states missing from STATE_PORTAL_CONFIGS', () => {
    const openTab = vi.fn()
    openStatePortals(['NE', 'HI'], { staggerMs: 0, openTab })
    expect(openTab).toHaveBeenCalledTimes(1)
    expect(openTab).toHaveBeenCalledWith(
      STATE_PORTAL_CONFIGS.NE.portalUrl,
      '_truckeros_portal_NE'
    )
  })
})