import { describe, expect, it, vi } from 'vitest'
import {
  STATE_PORTAL_CONFIGS,
  formatBorderPoint,
  formatPortalAddress,
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
  MO_APPLICATION_PREFILL_KEYS,
  MO_TRIP_TAB_PREFILL_KEYS,
  MO_PAYMENT_PREFILL_KEYS,
  MO_PAY_LAST_NOTE,
  MO_FEE_DISPLAY_NOTE,
  MO_CONVEYANCE_TIP,
  MO_DESCRIPTION_LIST_TIP,
  MO_POWER_UNIT_TYPE_TIP,
  buildMoFilingSteps,
  buildMoFilingStepClipboard,
  buildMoVehicleTypeTip,
  buildMoTravelTip,
  buildMoBoosterTip,
  buildMoConveyanceTip,
  buildMoDescriptionListTip,
  buildMoPowerUnitTypeTip,
  buildMoContactName,
  countMoCargoTrailers,
  mapTrailerTypeToMoLabel,
  pickPrimaryCargoTrailer,
  getMoStepPrefillKeysWithValues,
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
    expect(formatBorderPoint({ lat: 36.99, lon: -94.61 })).toBe('36.99000,-94.61000')
    expect(formatBorderPoint({ lat: 36.99, lon: -94.61, highway: 'I-44' })).toBe(
      '36.99000,-94.61000 (I-44)'
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
    expect(fields.entryPoint).toBe('36.99000,-94.62000 (US-69)')
    expect(fields.exitPoint).toBe('40.00000,-95.90000 (US-75)')
    expect(fields.borderEntry).toBe(fields.entryPoint)
    expect(fields.borderExit).toBe(fields.exitPoint)
    expect(fields.borderSummary).toContain('Entry:')
    expect(fields.borderSummary).toContain('Exit:')
  })

  it('origin OK gets exit only (leaveCrossing.entry)', () => {
    const fields = resolveStateBorderFields('OK', ['OK', 'KS', 'NE'], OK_KS_NE_CROSSINGS)
    expect(fields.role).toBe('origin')
    expect(fields.entryPoint).toBe('')
    expect(fields.exitPoint).toBe('36.99000,-94.62000 (US-69)')
  })

  it('destination NE gets entry only', () => {
    const fields = resolveStateBorderFields('NE', ['OK', 'KS', 'NE'], OK_KS_NE_CROSSINGS)
    expect(fields.role).toBe('destination')
    expect(fields.entryPoint).toBe('40.00000,-95.90000 (US-75)')
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
    expect(fields.entryPoint).toBe('36.99000,-94.62000 (US-69)')
    expect(fields.exitPoint).toBe('39.80000,-95.00000 (US-75)')
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
    expect(prefill.generatedFields.entry_point).toBe('36.99000,-94.62000 (US-69)')
    expect(prefill.generatedFields.exit_point).toBe('40.00000,-95.90000 (US-75)')
    expect(prefill.generatedFields.border_entry).toBe('36.99000,-94.62000 (US-69)')
    expect(prefill.generatedFields.border_exit).toBe('40.00000,-95.90000 (US-75)')
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
    expect(prefill.generatedFields.exit_point).toBe('36.99000,-94.62000 (US-69)')
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
            driverId: '42',
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
    expect(prefill.generatedFields.driver_id).toBe('42')
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

    expect(packet).toMatch(/Border Entry: 36\.99000,-94\.62000 \(US-69\)/)
    expect(packet).toMatch(/Border Exit: 40\.00000,-95\.90000 \(US-75\)/)
    expect(packet).toContain('Axles: 6')
    expect(packet).toContain('Vehicle / VIN: UNIT-1')
    expect(packet).toContain('USDOT: 1234567')
    expect(packet).toContain('MC Number: MC-999')
    expect(packet).toContain('Carrier Company: Acme Hauling')
    expect(packet).toContain('Driver: Jane Doe')
    expect(packet).toContain('Trip Type: Single trip')
  })

  it('includes non-MO discrete vehicle identity lines with generic labels', () => {
    const prefill = generatePortalPrefill(
      {
        ...richRequest,
        equipment: {
          rig: {
            totalAxles: 7,
            tractor: {
              unit_number: 'UNIT-1',
              year: 2019,
              make: 'Peterbilt',
              model: '389',
              vin: 'VIN123',
              license_plate: 'abc1',
              license_plate_state: 'ks',
            },
            trailers: [
              {
                year: 2018,
                make: 'Fontaine',
                model: 'Mag',
                vin: 'TRLVIN1',
                license_plate: 'trl1',
                license_plate_state: 'ne',
              },
            ],
          },
        },
      },
      'KS'
    )
    const packet = buildPortalClipboardPacket(prefill, STATE_PORTAL_CONFIGS.KS)
    expect(packet).toContain('Tractor year: 2019')
    expect(packet).toContain('Tractor make: Peterbilt')
    expect(packet).toContain('Tractor model: 389')
    expect(packet).toContain('Tractor year/make/model: 2019 Peterbilt 389')
    expect(packet).toContain('Tractor VIN: VIN123')
    expect(packet).toContain('Tractor plate: ABC1')
    expect(packet).toContain('Tractor plate state: KS')
    expect(packet).toContain('Trailer year: 2018')
    expect(packet).toContain('Trailer make: Fontaine')
    expect(packet).toContain('Trailer VIN: TRLVIN1')
    expect(packet).toContain('Trailer plate: TRL1')
    expect(packet).toContain('Trailer plate state: NE')
    // Identity after axles, before vehicle_id in generic extras path
    const lines = packet.split('\n')
    const idx = (label: string) => lines.findIndex((l) => l.startsWith(label + ':'))
    expect(idx('Axles')).toBeLessThan(idx('Tractor year'))
    expect(idx('Tractor VIN')).toBeLessThan(idx('Vehicle / VIN'))
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

  it('prefills full origin/destination street addresses when structured parts exist', () => {
    const prefill = generatePortalPrefill(
      {
        origin_city: 'Willard',
        origin_state: 'MO',
        origin_street: '6851 MO 123',
        origin_zip: '65781',
        destination_city: 'Lamar',
        destination_state: 'MO',
        destination_street: '805 12th Street West',
        destination_zip: '64759',
        weight: 90000,
        length: 70,
        width: 10,
        height: 13.5,
        route_corridor: ['MO'],
      },
      'MO'
    )
    expect(prefill.generatedFields.origin).toBe('6851 MO 123, Willard, MO 65781')
    expect(prefill.generatedFields.destination).toBe(
      '805 12th Street West, Lamar, MO 64759'
    )
    expect(prefill.generatedFields.origin_street).toBe('6851 MO 123')
    expect(prefill.generatedFields.origin_city).toBe('Willard')
    expect(prefill.generatedFields.origin_state).toBe('MO')
    expect(prefill.generatedFields.origin_zip).toBe('65781')
    expect(prefill.generatedFields.destination_street).toBe('805 12th Street West')
    expect(prefill.generatedFields.destination_city).toBe('Lamar')
    expect(prefill.generatedFields.destination_state).toBe('MO')
    expect(prefill.generatedFields.destination_zip).toBe('64759')

    const packet = buildPortalClipboardPacket(prefill, STATE_PORTAL_CONFIGS.MO)
    expect(packet).toContain('Origin: 6851 MO 123, Willard, MO 65781')
    expect(packet).toContain('Destination: 805 12th Street West, Lamar, MO 64759')
  })

  it('uses nested loadDetails origin/destination and street-like query fallback', () => {
    const nested = generatePortalPrefill(
      {
        origin: {
          query: '6851 MO 123, Willard, MO 65781',
          street: '6851 MO 123',
          city: 'Willard',
          state: 'MO',
          zip: '65781',
        },
        destination: {
          query: '805 12th Street West, Lamar, MO 64759',
          street: '805 12th Street West',
          city: 'Lamar',
          state: 'MO',
          zip: '64759',
        },
        weight: 90000,
        length: 70,
        width: 10,
        height: 13.5,
        route_corridor: ['MO'],
      },
      'MO'
    )
    expect(nested.generatedFields.origin).toBe('6851 MO 123, Willard, MO 65781')
    expect(nested.generatedFields.destination).toBe(
      '805 12th Street West, Lamar, MO 64759'
    )

    const queryOnly = generatePortalPrefill(
      {
        origin_city: 'Willard',
        origin_state: 'MO',
        origin_query: '6851 MO 123, Willard, MO 65781',
        destination_city: 'Lamar',
        destination_state: 'MO',
        destination_query: '805 12th Street West, Lamar, MO 64759',
        weight: 90000,
        length: 70,
        width: 10,
        height: 13.5,
        route_corridor: ['MO'],
      },
      'MO'
    )
    expect(queryOnly.generatedFields.origin).toBe('6851 MO 123, Willard, MO 65781')
    expect(queryOnly.generatedFields.destination).toBe(
      '805 12th Street West, Lamar, MO 64759'
    )
    // Query-only must not invent street/zip split fields
    expect(queryOnly.generatedFields.origin_street).toBeUndefined()
    expect(queryOnly.generatedFields.origin_zip).toBeUndefined()
    expect(queryOnly.generatedFields.destination_street).toBeUndefined()
    expect(queryOnly.generatedFields.destination_zip).toBeUndefined()
    // City/state splits still populated from request fields
    expect(queryOnly.generatedFields.origin_city).toBe('Willard')
    expect(queryOnly.generatedFields.origin_state).toBe('MO')
    expect(queryOnly.generatedFields.destination_city).toBe('Lamar')
    expect(queryOnly.generatedFields.destination_state).toBe('MO')

    const queryPacket = buildPortalClipboardPacket(queryOnly, STATE_PORTAL_CONFIGS.MO)
    expect(queryPacket).toContain('Origin: 6851 MO 123, Willard, MO 65781')
    expect(queryPacket).toContain(
      'Destination: 805 12th Street West, Lamar, MO 64759'
    )

    const cityOnly = generatePortalPrefill(
      {
        origin_city: 'Willard',
        origin_state: 'MO',
        destination_city: 'Lamar',
        destination_state: 'MO',
        weight: 90000,
        length: 70,
        width: 10,
        height: 13.5,
        route_corridor: ['MO'],
      },
      'MO'
    )
    expect(cityOnly.generatedFields.origin).toBe('Willard, MO')
    expect(cityOnly.generatedFields.destination).toBe('Lamar, MO')
    expect(cityOnly.generatedFields.origin_street).toBeUndefined()
    expect(cityOnly.generatedFields.origin_zip).toBeUndefined()
    expect(cityOnly.generatedFields.destination_street).toBeUndefined()
    expect(cityOnly.generatedFields.destination_zip).toBeUndefined()
    expect(cityOnly.generatedFields.origin_city).toBe('Willard')
    expect(cityOnly.generatedFields.origin_state).toBe('MO')
    expect(cityOnly.generatedFields.destination_city).toBe('Lamar')
    expect(cityOnly.generatedFields.destination_state).toBe('MO')
  })

  it('business-name query-only still prefills origin (intentional last resort)', () => {
    const prefill = generatePortalPrefill(
      {
        origin_query: 'Case IH plant Grand Island',
        destination_city: 'Lamar',
        destination_state: 'MO',
        weight: 90000,
        length: 70,
        width: 10,
        height: 13.5,
        route_corridor: ['NE', 'MO'],
      },
      'MO'
    )
    expect(prefill.generatedFields.origin).toBe('Case IH plant Grand Island')
    expect(hasPrefillValue(prefill.generatedFields.origin)).toBe(true)
    expect(prefill.generatedFields.origin_street).toBeUndefined()
  })

  it('re-exports formatPortalAddress from portal-assistant', () => {
    expect(typeof formatPortalAddress).toBe('function')
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
    const ymmItem = checklist.items.find((i) => i.id === 'vehicle_ymm')
    expect(ymmItem?.status).toBe('warn')
    expect(ymmItem?.soft).toBe(true)
    // Soft notes excluded from hard "to fix" warnCount
    expect(checklist.warnCount).toBe(0)
    expect(checklist.softWarnCount).toBe(1)
    expect(checklist.ready).toBe(true)
  })

  it('passes vehicle check with trailer-only VIN or plate', () => {
    const withTrailerVin = generatePortalPrefill(
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
            trailers: [{ vin: '1TRAILERONLYVIN001', year: 2017, make: 'Landoll' }],
          },
        },
        cargo: { carrierDriver: { companyName: 'Co', usdotNumber: '1' } },
      },
      'TX'
    )
    expect(withTrailerVin.generatedFields.tractor_vin).toBeUndefined()
    expect(withTrailerVin.generatedFields.trailer_vin).toBe('1TRAILERONLYVIN001')
    const vinCheck = buildPortalCompletenessChecklist(
      withTrailerVin,
      STATE_PORTAL_CONFIGS.TX
    )
    expect(vinCheck.items.find((i) => i.id === 'vehicle')?.status).toBe('pass')
    expect(vinCheck.items.find((i) => i.id === 'vehicle_ymm')?.status).toBe('pass')

    const withTrailerPlate = generatePortalPrefill(
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
            trailers: [{ license_plate: 'trlonly', license_plate_state: 'tx' }],
          },
        },
        cargo: { carrierDriver: { companyName: 'Co', usdotNumber: '1' } },
      },
      'TX'
    )
    expect(withTrailerPlate.generatedFields.trailer_plate).toBe('TRLONLY')
    const plateCheck = buildPortalCompletenessChecklist(
      withTrailerPlate,
      STATE_PORTAL_CONFIGS.TX
    )
    expect(plateCheck.items.find((i) => i.id === 'vehicle')?.status).toBe('pass')
  })
})

describe('Missouri Portal Assist playbook v3', () => {
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
    highways: ['I-44', 'I-70'],
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
        trailers: [
          {
            year: 2017,
            make: 'Landoll',
            vin: 'TRLMO1',
            license_plate: 'trlmo',
            license_plate_state: 'mo',
            trailer_type: 'Double Drop',
            overall_length_ft: 53,
          },
        ],
      },
    },
    cargo: {
      description: 'Transformer skid',
      serialNumber: 'SN-7788',
      numberOfPieces: 1,
      load: { lengthFt: 40, widthFt: 10, heightFt: 12 },
      carrierDriver: {
        companyName: 'Show-Me Haul',
        usdotNumber: '7654321',
        driverFullName: 'Pat Driver',
        carrierEmail: 'pat@showmehaul.example',
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

  it('exposes MO v3 field order and MoDOT Single Trip labels', () => {
    expect(getMoPortalFieldOrder()).toEqual([...MO_PORTAL_FIELD_ORDER])
    expect(MO_PORTAL_FIELD_ORDER.join(',')).toBe(
      [
        'trip_type',
        'tip_conveyance',
        'tip_description_list',
        'tip_for_hire',
        'tip_travel',
        'tip_vehicle_type',
        'tip_power_unit_type',
        'tip_booster',
        'tip_piece_dims',
        'load_description',
        'load_pieces',
        'serial_number',
        'piece_width',
        'piece_length',
        'piece_height',
        'tractor_make',
        'tractor_plate',
        'tractor_plate_state',
        'tractor_vin',
        'tractor_year',
        'power_unit_type',
        'trailer_make',
        'trailer_plate',
        'trailer_plate_state',
        'trailer_vin',
        'trailer_year',
        'unit_two_type',
        'trailer_2_make',
        'trailer_2_plate',
        'trailer_2_plate_state',
        'trailer_2_vin',
        'trailer_2_year',
        'width',
        'length',
        'height',
        'trailer_length',
        'weight',
        'front_overhang',
        'rear_overhang',
        'axles',
        'carrier_usdot',
        'carrier_company',
        'carrier_mc',
        'contact_name',
        'carrier_email',
        'driver_name',
        'driver_id',
        'origin',
        'destination',
        'route',
        'highways',
        'border_entry',
        'border_exit',
      ].join(',')
    )
    expect(getMoPortalFieldLabel('load_description')).toBe('Load Description')
    expect(getMoPortalFieldLabel('load_pieces')).toBe('Load Pieces / How Many')
    expect(getMoPortalFieldLabel('serial_number')).toBe('Serial Number')
    expect(getMoPortalFieldLabel('piece_width')).toBe('Piece Width')
    expect(getMoPortalFieldLabel('piece_length')).toBe('Piece Length')
    expect(getMoPortalFieldLabel('piece_height')).toBe('Piece Height')
    expect(getMoPortalFieldLabel('tractor_make')).toBe('Power Unit Make')
    expect(getMoPortalFieldLabel('tractor_plate')).toBe('Power Unit License Number')
    expect(getMoPortalFieldLabel('tractor_plate_state')).toBe('Power Unit License State')
    expect(getMoPortalFieldLabel('tractor_vin')).toBe('Power Unit VIN')
    expect(getMoPortalFieldLabel('tractor_year')).toBe('Power Unit Model Year')
    expect(getMoPortalFieldLabel('power_unit_type')).toBe('Power Unit Type')
    expect(getMoPortalFieldLabel('trailer_make')).toBe('Unit Two Make')
    expect(getMoPortalFieldLabel('trailer_plate')).toBe('Unit Two License Number')
    expect(getMoPortalFieldLabel('trailer_plate_state')).toBe('Unit Two License State')
    expect(getMoPortalFieldLabel('trailer_vin')).toBe('Unit Two VIN')
    expect(getMoPortalFieldLabel('trailer_year')).toBe('Unit Two Model Year')
    expect(getMoPortalFieldLabel('unit_two_type')).toBe('Unit Two Type')
    expect(getMoPortalFieldLabel('width')).toBe('Overall Width')
    expect(getMoPortalFieldLabel('length')).toBe('Overall Length')
    expect(getMoPortalFieldLabel('height')).toBe('Overall Height')
    expect(getMoPortalFieldLabel('trailer_length')).toBe('Trailer/Load Length')
    expect(getMoPortalFieldLabel('weight')).toBe('GVW')
    expect(getMoPortalFieldLabel('front_overhang')).toBe('Front Overhang')
    expect(getMoPortalFieldLabel('rear_overhang')).toBe('Rear Overhang')
    expect(getMoPortalFieldLabel('axles')).toBe('Number of Axles')
    expect(getMoPortalFieldLabel('origin')).toBe('Origin')
    expect(getMoPortalFieldLabel('destination')).toBe('Destination')
    expect(getMoPortalFieldLabel('route')).toBe('Route corridor')
    expect(getMoPortalFieldLabel('highways')).toBe('Highways')
    expect(getMoPortalFieldLabel('border_entry')).toBe('MO entry border')
    expect(getMoPortalFieldLabel('border_exit')).toBe('MO exit border')
    expect(getMoPortalFieldLabel('tip_conveyance')).toBe('Conveyance')
    expect(getMoPortalFieldLabel('tip_vehicle_type')).toBe('Vehicle Type')
    expect(getMoPortalFieldLabel('tip_power_unit_type')).toBe('Power Unit Type tip')
    expect(getMoPortalFieldLabel('tip_travel')).toBe('Travel')
    expect(getMoPortalFieldLabel('tip_booster')).toBe('Booster unit')
    expect(getMoPortalFieldLabel('tip_piece_dims')).toBe('Piece dims note')
    expect(getMoPortalFieldLabel('contact_name')).toBe('Carrier contact name')
    expect(getMoPortalFieldLabel('driver_name')).toBe('Driver name')
    expect(getMoPortalFieldLabel('carrier_email')).toBe('Carrier email')
    expect(getMoPortalFieldLabel('trailer_2_make')).toBe('Unit Three Make')
    expect(MO_PORTAL_FIELD_LABELS.entry_point).toBe('MO entry border')
  })

  it('buildPortalClipboardPacket uses MO v3 order and labels when state is MO', () => {
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
                trailer_type: 'Double Drop',
                overall_length_ft: 53,
              },
            ],
          },
          loadOverhangs: { frontOfRigFt: 0, frontOfTrailerFt: 2, rearFt: 4 },
        },
        cargo: {
          description: 'Transformer skid',
          serialNumber: 'SN-7788',
          numberOfPieces: 1,
          load: { lengthFt: 40, widthFt: 10, heightFt: 12 },
          carrierDriver: {
            companyName: 'Show-Me Haul',
            usdotNumber: '7654321',
            mcNumber: 'MC-4242',
            driverFullName: 'Pat Driver',
            carrierEmail: 'pat@showmehaul.example',
          },
        },
      },
      'MO'
    )
    const packet = buildPortalClipboardPacket(prefill, STATE_PORTAL_CONFIGS.MO, {
      tripType: 'Single trip',
    })
    const lines = packet.split('\n')
    // Permit type + tips first
    expect(lines[0]).toBe('Permit type: Single trip')
    expect(packet).toContain(`Conveyance: ${MO_CONVEYANCE_TIP}`)
    expect(packet).toContain(`Description list: ${MO_DESCRIPTION_LIST_TIP}`)
    expect(packet).toContain('For Hire: Yes (when for-hire carrier; override if private)')
    expect(packet).toContain('Travel: Interstate commerce crossing state line')
    expect(packet).toContain('Vehicle Type: PowerUnit + 1 Unit')
    expect(packet).toContain(`Power Unit Type tip: ${MO_POWER_UNIT_TYPE_TIP}`)
    expect(packet).toContain('Booster unit: No')
    expect(packet).toContain('Load Description: Transformer skid')
    expect(packet).toContain('Load Pieces / How Many: 1')
    expect(packet).toContain('Serial Number: SN-7788')
    expect(packet).toContain('Piece Width:')
    expect(packet).toContain('Power Unit Make: Peterbilt')
    expect(packet).toContain('Power Unit License Number: MO999')
    expect(packet).toContain('Power Unit License State: MO')
    expect(packet).toContain('Power Unit VIN: VINMO9')
    expect(packet).toContain('Power Unit Model Year: 2021')
    expect(packet).toContain('Power Unit Type: TRUCK-TRACTOR')
    expect(packet).toContain('Unit Two Make: Landoll')
    expect(packet).toContain('Unit Two License Number: TRLMO')
    expect(packet).toContain('Unit Two License State: MO')
    expect(packet).toContain('Unit Two VIN: TRLMO1')
    expect(packet).toContain('Unit Two Model Year: 2017')
    expect(packet).toContain('Unit Two Type: DOUBLE DROP TRLR')
    expect(packet).toContain('Overall Width:')
    expect(packet).toContain('Overall Length:')
    expect(packet).toContain('Overall Height:')
    expect(packet).toContain('Trailer/Load Length:')
    expect(packet).toContain('GVW:')
    expect(packet).toContain('Front Overhang:')
    expect(packet).toContain('Rear Overhang:')
    expect(packet).toContain('Number of Axles: 6')
    expect(packet).toContain('USDOT: 7654321')
    expect(packet).toContain('Carrier name: Show-Me Haul')
    expect(packet).toContain('MC number: MC-4242')
    // Contact prefers company over driver
    expect(packet).toContain('Carrier contact name: Show-Me Haul')
    expect(packet).toContain('Carrier email: pat@showmehaul.example')
    expect(packet).toContain('Driver name: Pat Driver')
    expect(packet).toContain('Origin: Tulsa, OK')
    expect(packet).toContain('Destination: Chicago, IL')
    expect(packet).toContain('Route corridor: OK → MO → IL')
    expect(packet).toContain('Highways: I-44, I-70')
    expect(packet).toMatch(/MO entry border:/)
    expect(packet).toMatch(/MO exit border:/)
    // Clean piece dims (no overall annotation)
    expect(packet).toMatch(/Piece Width:.*10/)
    expect(packet).not.toMatch(/overall — load piece not set/)
    // Full label sequence snapshot (prefix order of present lines)
    const labelSeq = lines.map((l) => l.split(':')[0])
    expect(labelSeq[0]).toBe('Permit type')
    expect(labelSeq.indexOf('Conveyance')).toBeGreaterThan(labelSeq.indexOf('Permit type'))
    expect(labelSeq.indexOf('Power Unit Type tip')).toBeGreaterThan(
      labelSeq.indexOf('Vehicle Type')
    )
    expect(labelSeq.indexOf('Load Description')).toBeGreaterThan(labelSeq.indexOf('Booster unit'))
    expect(labelSeq.indexOf('Power Unit Make')).toBeGreaterThan(labelSeq.indexOf('Load Description'))
    expect(labelSeq.indexOf('Unit Two Make')).toBeGreaterThan(labelSeq.indexOf('Power Unit Make'))
    expect(labelSeq.indexOf('Overall Width')).toBeGreaterThan(labelSeq.indexOf('Unit Two Type'))
    expect(labelSeq.indexOf('USDOT')).toBeGreaterThan(labelSeq.indexOf('Number of Axles'))
    expect(labelSeq.indexOf('Carrier contact name')).toBeGreaterThan(labelSeq.indexOf('USDOT'))
    expect(labelSeq.indexOf('Origin')).toBeGreaterThan(labelSeq.indexOf('Carrier email'))
    expect(labelSeq.indexOf('Route corridor')).toBeGreaterThan(labelSeq.indexOf('Origin'))
    expect(labelSeq.indexOf('Highways')).toBeGreaterThan(labelSeq.indexOf('Route corridor'))
  })

  it('generic clipboard path unchanged for non-MO states', () => {
    const prefill = generatePortalPrefill(moCorridorRequest, 'OK')
    const packet = buildPortalClipboardPacket(prefill, STATE_PORTAL_CONFIGS.OK)
    expect(packet).not.toContain('Permit type:')
    expect(packet).toContain('Trip Type: Single trip')
    expect(packet).not.toContain('MO entry border')
    expect(packet).not.toContain('Conveyance:')
  })

  it('resolvePortalFieldLabel uses MO v3 labels for MO config', () => {
    expect(resolvePortalFieldLabel('origin', STATE_PORTAL_CONFIGS.MO)).toBe('Origin')
    expect(resolvePortalFieldLabel('weight', STATE_PORTAL_CONFIGS.MO)).toBe('GVW')
    expect(resolvePortalFieldLabel('axles', STATE_PORTAL_CONFIGS.MO)).toBe(
      'Number of Axles'
    )
    expect(resolvePortalFieldLabel('tractor_plate', STATE_PORTAL_CONFIGS.MO)).toBe(
      'Power Unit License Number'
    )
    expect(resolvePortalFieldLabel('contact_name', STATE_PORTAL_CONFIGS.MO)).toBe(
      'Carrier contact name'
    )
    expect(resolvePortalFieldLabel('driver_name', STATE_PORTAL_CONFIGS.MO)).toBe(
      'Driver name'
    )
    // Non-MO still uses fieldMapping / fallbacks
    expect(resolvePortalFieldLabel('origin', STATE_PORTAL_CONFIGS.TX)).toBe(
      'Origin Location'
    )
  })

  it('buildMoFilingSteps follows live Carrier Express Single Trip path (v3 Trip→Payment)', () => {
    const multi = generatePortalPrefill(moCorridorRequest, 'MO')
    const steps = buildMoFilingSteps(multi)
    expect(steps.map((s) => s.id)).toEqual([
      'login',
      'programs',
      'new_app',
      'travel_dates',
      'application',
      'trip_tab',
      'trip_post_analyze',
      'review',
      'payment',
      'paste_permit',
    ])
    expect(steps.map((s) => s.stepNumber)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    expect(steps.find((s) => s.id === 'login')?.title).toContain('Login Carrier Express')
    expect(steps.find((s) => s.id === 'programs')?.title).toContain(
      'Programs → Oversize/Overweight'
    )
    expect(steps.find((s) => s.id === 'new_app')?.title).toContain(
      'Single Trip Permits → Single Trip'
    )
    expect(steps.find((s) => s.id === 'travel_dates')?.title).toMatch(/Travel Dates/)
    expect(steps.find((s) => s.id === 'application')?.prefillKeys).toEqual([
      ...MO_APPLICATION_PREFILL_KEYS,
    ])
    expect(steps.find((s) => s.id === 'application')?.guidance?.join(' ')).toMatch(
      /Conveyance|Hauled|Travel|Vehicle Type|Power Unit Type|Booster|OTHER/
    )
    // Multi-state: trip tab includes border keys + Street Address / Analyze guidance
    expect(steps.find((s) => s.id === 'trip_tab')?.prefillKeys).toEqual([
      ...MO_TRIP_TAB_PREFILL_KEYS,
    ])
    expect(steps.find((s) => s.id === 'trip_tab')?.title).toMatch(/Street Address/)
    expect(steps.find((s) => s.id === 'trip_tab')?.title).toMatch(/Analyze/)
    expect(steps.find((s) => s.id === 'trip_tab')?.guidance?.join(' ')).toMatch(
      /Street Address|Analyze/
    )
    expect(steps.find((s) => s.id === 'trip_post_analyze')?.title).toMatch(/Failures\s*=\s*0/)
    expect(steps.find((s) => s.id === 'trip_post_analyze')?.title).toMatch(
      /Trip Description/
    )
    expect(steps.find((s) => s.id === 'review')?.title).toMatch(/Review/)
    expect(steps.find((s) => s.id === 'review')?.title).toMatch(/prefill/i)
    const payment = steps.find((s) => s.id === 'payment')!
    expect(payment.title).toMatch(/Payment/)
    expect(payment.title).toMatch(/pay-last/i)
    expect(payment.prefillKeys).toEqual([...MO_PAYMENT_PREFILL_KEYS])
    expect(payment.guidance?.join(' ')).toContain(MO_PAY_LAST_NOTE)
    expect(payment.guidance?.join(' ')).toContain(MO_FEE_DISPLAY_NOTE)
    expect(steps.find((s) => s.id === 'paste_permit')?.title).toMatch(/permit #/i)
    // Single-state: trip tab always present but border keys omitted; no pay-last note
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
    expect(singleSteps.map((s) => s.id)).toEqual(steps.map((s) => s.id))
    expect(singleSteps.find((s) => s.id === 'trip_tab')?.prefillKeys).toEqual([
      'origin',
      'destination',
      'route',
      'highways',
    ])
    expect(singleSteps.find((s) => s.id === 'trip_tab')?.title).not.toMatch(/borders/)
    const singlePay = singleSteps.find((s) => s.id === 'payment')!
    expect(singlePay.title).not.toMatch(/pay-last/i)
    expect(singlePay.guidance?.join(' ') || '').not.toContain(MO_PAY_LAST_NOTE)
    expect(singlePay.guidance?.join(' ')).toContain(MO_FEE_DISPLAY_NOTE)
    expect(buildMoFilingSteps().map((s) => s.id)).toEqual(steps.map((s) => s.id))
  })

  it('buildMoFilingStepClipboard copies application + trip + payment with MO v3 labels', () => {
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
              license_plate: 'mo999',
              license_plate_state: 'mo',
            },
            trailers: [
              {
                year: 2017,
                make: 'Landoll',
                vin: 'TRLMO1',
                license_plate: 'trlmo',
                license_plate_state: 'mo',
                trailer_type: 'single drop',
                overall_length_ft: 53,
              },
            ],
          },
        },
      },
      'MO'
    )
    const steps = buildMoFilingSteps(prefill)

    const app = steps.find((s) => s.id === 'application')!
    const appPacket = buildMoFilingStepClipboard(prefill, app)
    expect(appPacket).toContain('Conveyance: Hauled')
    expect(appPacket).toContain('Under Own Power')
    expect(appPacket).toContain('Load Description: Transformer skid')
    expect(appPacket).toContain('Power Unit Make: Peterbilt')
    expect(appPacket).toContain('Unit Two Type: SINGLE DROP TRLR')
    expect(appPacket).toContain('Number of Axles: 6')
    expect(appPacket).toContain('GVW:')
    expect(appPacket).toContain(`Power Unit Type tip: ${MO_POWER_UNIT_TYPE_TIP}`)
    expect(appPacket).not.toContain('Origin:')

    const trip = steps.find((s) => s.id === 'trip_tab')!
    const tripPacket = buildMoFilingStepClipboard(prefill, trip)
    expect(tripPacket).toContain('Origin: Tulsa, OK')
    expect(tripPacket).toContain('Destination: Chicago, IL')
    expect(tripPacket).toContain('Route corridor: OK → MO → IL')
    expect(tripPacket).toContain('Highways: I-44, I-70')
    expect(tripPacket).toMatch(/MO entry border:/)
    expect(tripPacket).toMatch(/MO exit border:/)
    expect(tripPacket).not.toContain('Load Description')

    const payment = steps.find((s) => s.id === 'payment')!
    const payPacket = buildMoFilingStepClipboard(prefill, payment)
    expect(payPacket).toContain('Carrier contact name: Show-Me Haul')
    expect(payPacket).toContain('Carrier email: pat@showmehaul.example')
    expect(payPacket).toContain('Carrier name: Show-Me Haul')
    expect(payPacket).toContain('USDOT: 7654321')
    expect(payPacket).not.toContain('Load Description')
    expect(payPacket).not.toContain('Driver name:')

    const newApp = steps.find((s) => s.id === 'new_app')!
    expect(buildMoFilingStepClipboard(prefill, newApp, { tripType: 'Round trip' })).toBe(
      'Permit type: Round trip'
    )

    const login = steps.find((s) => s.id === 'login')!
    expect(buildMoFilingStepClipboard(prefill, login)).toBe('')
  })

  it('vehicle type tip: cargo count only (skip jeep); +2 Units; tractor only → PowerUnit; empty omits', () => {
    const withTrailer = generatePortalPrefill(moCorridorRequest, 'MO')
    expect(withTrailer.generatedFields.tip_vehicle_type).toBe('PowerUnit + 1 Unit')
    expect(buildMoVehicleTypeTip(withTrailer)).toBe('PowerUnit + 1 Unit')

    // Jeep + cargo deck → cargo count 1, not PowerUnit + 2 Units
    const jeepAndCargo = generatePortalPrefill(
      {
        ...moCorridorRequest,
        equipment: {
          rig: {
            totalAxles: 8,
            tractor: { vin: 'V1', make: 'Peterbilt', year: 2020 },
            trailers: [
              { trailer_type: 'Jeep', vin: 'JEEP1', make: 'JeepCo', year: 2015 },
              {
                trailer_type: 'Double Drop',
                vin: 'MAIN1',
                make: 'Landoll',
                year: 2018,
              },
            ],
          },
        },
      },
      'MO'
    )
    expect(jeepAndCargo.generatedFields.trailer_count).toBe(2)
    expect(jeepAndCargo.generatedFields.cargo_trailer_count).toBe(1)
    expect(countMoCargoTrailers(jeepAndCargo)).toBe(1)
    expect(jeepAndCargo.generatedFields.tip_vehicle_type).toBe('PowerUnit + 1 Unit')
    expect(jeepAndCargo.generatedFields.tip_booster).toMatch(/^Yes/)
    // Unit Three (jeep) identity present in packet
    const jeepPacket = buildPortalClipboardPacket(jeepAndCargo, STATE_PORTAL_CONFIGS.MO)
    expect(jeepPacket).toContain('Unit Three Make: JeepCo')
    expect(jeepPacket).toContain('Unit Three VIN: JEEP1')
    expect(jeepPacket).toContain('Vehicle Type: PowerUnit + 1 Unit')

    // Two cargo trailers → PowerUnit + 2 Units
    const twoCargo = generatePortalPrefill(
      {
        ...moCorridorRequest,
        equipment: {
          rig: {
            totalAxles: 9,
            tractor: { vin: 'V2', make: 'Kenworth', year: 2019 },
            trailers: [
              { trailer_type: 'Flatbed', vin: 'FB1', make: 'Fontaine', year: 2016 },
              { trailer_type: 'Step Deck', vin: 'SD1', make: 'Landoll', year: 2017 },
            ],
          },
        },
      },
      'MO'
    )
    expect(twoCargo.generatedFields.cargo_trailer_count).toBe(2)
    expect(twoCargo.generatedFields.tip_vehicle_type).toBe('PowerUnit + 2 Units')
    expect(buildMoVehicleTypeTip(twoCargo)).toBe('PowerUnit + 2 Units')

    const tractorOnly = generatePortalPrefill(
      {
        ...moCorridorRequest,
        equipment: {
          rig: {
            totalAxles: 3,
            tractor: { vin: 'VINONLY', make: 'Kenworth', year: 2020 },
            trailers: [],
          },
        },
      },
      'MO'
    )
    expect(tractorOnly.generatedFields.tip_vehicle_type).toBe('PowerUnit')
    expect(buildMoVehicleTypeTip(tractorOnly)).toBe('PowerUnit')

    // Empty equipment — do not invent PowerUnit + 1 Unit
    const emptyEquip = generatePortalPrefill(
      {
        origin_city: 'St. Louis',
        origin_state: 'MO',
        destination_city: 'Kansas City',
        destination_state: 'MO',
        weight: 80000,
        length: 70,
        width: 10,
        height: 13.5,
        route_corridor: ['MO'],
        equipment: {},
        cargo: {},
      },
      'MO'
    )
    expect(emptyEquip.generatedFields.tip_vehicle_type).toBeUndefined()
    expect(buildMoVehicleTypeTip(emptyEquip)).toBe('')
    const emptyPacket = buildPortalClipboardPacket(emptyEquip, STATE_PORTAL_CONFIGS.MO)
    expect(emptyPacket).not.toContain('Vehicle Type:')
  })

  it('travel tip: multi-state interstate vs Intrastate travel within MO; empty corridor uses origin≠dest', () => {
    const multi = generatePortalPrefill(moCorridorRequest, 'MO')
    expect(multi.generatedFields.tip_travel).toBe(
      'Interstate commerce crossing state line'
    )
    expect(buildMoTravelTip(multi)).toBe('Interstate commerce crossing state line')

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
        equipment: { rig: { tractor: { vin: 'X' } } },
        cargo: {},
      },
      'MO'
    )
    expect(single.generatedFields.tip_travel).toBe('Intrastate travel within MO')
    expect(buildMoTravelTip(single)).toBe('Intrastate travel within MO')

    // Empty corridor but OK→IL origin/dest must still be multi-state (same as isMoMultiStatePrefill)
    const emptyCorridorMulti = generatePortalPrefill(
      {
        origin_city: 'Tulsa',
        origin_state: 'OK',
        destination_city: 'Chicago',
        destination_state: 'IL',
        weight: 90000,
        length: 70,
        width: 10,
        height: 13.5,
        route_corridor: [],
        equipment: { rig: { tractor: { vin: 'X', make: 'KW' } } },
        cargo: {},
      },
      'MO'
    )
    expect(isMoMultiStatePrefill(emptyCorridorMulti)).toBe(true)
    expect(emptyCorridorMulti.generatedFields.tip_travel).toBe(
      'Interstate commerce crossing state line'
    )
    expect(buildMoTravelTip(emptyCorridorMulti)).toBe(
      'Interstate commerce crossing state line'
    )
  })

  it('enum tips: conveyance options + Hauled default; description OTHER; power unit type tip', () => {
    expect(buildMoConveyanceTip()).toBe(MO_CONVEYANCE_TIP)
    expect(MO_CONVEYANCE_TIP).toMatch(/Hauled/)
    expect(MO_CONVEYANCE_TIP).toMatch(/Under Own Power/)
    expect(MO_CONVEYANCE_TIP).toMatch(/Towed/)
    expect(MO_CONVEYANCE_TIP).toMatch(/Haul\/Tow/)
    expect(buildMoDescriptionListTip()).toBe(MO_DESCRIPTION_LIST_TIP)
    expect(MO_DESCRIPTION_LIST_TIP).toMatch(/^OTHER/)
    expect(buildMoPowerUnitTypeTip()).toBe(MO_POWER_UNIT_TYPE_TIP)
    expect(MO_POWER_UNIT_TYPE_TIP).toMatch(/TRUCK-TRACTOR/)
    expect(MO_POWER_UNIT_TYPE_TIP).toMatch(/AUTOMOBILE/)
    const prefill = generatePortalPrefill(moCorridorRequest, 'MO')
    expect(prefill.generatedFields.tip_conveyance).toBe(MO_CONVEYANCE_TIP)
    expect(prefill.generatedFields.tip_description_list).toBe(MO_DESCRIPTION_LIST_TIP)
    expect(prefill.generatedFields.tip_power_unit_type).toBe(MO_POWER_UNIT_TYPE_TIP)
  })

  it('payment contact prefers carrier company over driver; labels lock ownership', () => {
    expect(buildMoContactName({ companyName: 'Acme', driverFullName: 'Bob' })).toBe('Acme')
    expect(buildMoContactName({ contactName: 'Dispatch Desk', companyName: 'Acme' })).toBe(
      'Dispatch Desk'
    )
    expect(buildMoContactName({ driverFullName: 'Bob Only' })).toBe('Bob Only')
    expect(buildMoContactName(null)).toBeNull()

    const withCompany = generatePortalPrefill(moCorridorRequest, 'MO')
    expect(withCompany.generatedFields.contact_name).toBe('Show-Me Haul')
    expect(withCompany.generatedFields.driver_name).toBe('Pat Driver')
    expect(withCompany.generatedFields.carrier_email).toBe('pat@showmehaul.example')

    const driverOnly = generatePortalPrefill(
      {
        ...moCorridorRequest,
        cargo: {
          description: 'X',
          carrierDriver: {
            driverFullName: 'Solo Driver',
            carrierEmail: 'solo@example.com',
            usdotNumber: '1',
          },
        },
      },
      'MO'
    )
    expect(driverOnly.generatedFields.contact_name).toBe('Solo Driver')
    expect(driverOnly.generatedFields.carrier_company).toBeUndefined()
  })

  it('piece dims are clean numbers; missing piece dims use tip only (no overall annotation)', () => {
    const withPiece = generatePortalPrefill(moCorridorRequest, 'MO')
    expect(String(withPiece.generatedFields.piece_width)).not.toMatch(/overall/)
    expect(String(withPiece.generatedFields.piece_length)).not.toMatch(/load piece not set/)
    expect(withPiece.generatedFields.tip_piece_dims).toBeUndefined()

    const noPiece = generatePortalPrefill(
      {
        ...moCorridorRequest,
        cargo: {
          description: 'No piece dims',
          numberOfPieces: 1,
          carrierDriver: { companyName: 'Co', usdotNumber: '1' },
        },
      },
      'MO'
    )
    expect(noPiece.generatedFields.piece_width).toBeUndefined()
    expect(noPiece.generatedFields.piece_length).toBeUndefined()
    expect(noPiece.generatedFields.piece_height).toBeUndefined()
    expect(noPiece.generatedFields.tip_piece_dims).toMatch(/Piece W\/L\/H not set/)
    const packet = buildPortalClipboardPacket(noPiece, STATE_PORTAL_CONFIGS.MO)
    expect(packet).toContain('Piece dims note:')
    expect(packet).not.toMatch(/overall — load piece not set/)
  })

  it('booster tip defaults No; Yes when jeep/booster present', () => {
    const noBooster = generatePortalPrefill(moCorridorRequest, 'MO')
    expect(noBooster.generatedFields.tip_booster).toBe('No')
    expect(buildMoBoosterTip(noBooster)).toBe('No')

    const withJeep = generatePortalPrefill(
      {
        ...moCorridorRequest,
        equipment: {
          rig: {
            totalAxles: 8,
            tractor: { vin: 'V1', make: 'Peterbilt' },
            trailers: [
              { trailer_type: 'RGN', vin: 'T1' },
              { trailer_type: 'Jeep', vin: 'J1' },
            ],
          },
        },
      },
      'MO'
    )
    expect(withJeep.generatedFields.tip_booster).toMatch(/^Yes/)
    expect(buildMoBoosterTip(withJeep)).toMatch(/^Yes/)
  })

  it('mapTrailerTypeToMoLabel maps common types; deck/lowboy before RGN; unmapped tip', () => {
    expect(mapTrailerTypeToMoLabel('Double Drop')).toBe('DOUBLE DROP TRLR')
    expect(mapTrailerTypeToMoLabel('single drop')).toBe('SINGLE DROP TRLR')
    expect(mapTrailerTypeToMoLabel('Step Deck')).toBe('STEP DECK TRLR')
    expect(mapTrailerTypeToMoLabel('Flatbed')).toBe('FLAT BED TRLR')
    expect(mapTrailerTypeToMoLabel('flat bed')).toBe('FLAT BED TRLR')
    expect(mapTrailerTypeToMoLabel('RGN')).toBe('RGN')
    expect(mapTrailerTypeToMoLabel('Custom Lowboy Stretch')).toBe('LOWBOY TRLR')
    // Unmapped: raw + select closest tip
    expect(mapTrailerTypeToMoLabel('Special Haul Deck')).toBe(
      'SPECIAL HAUL DECK — select closest on MoDOT list'
    )
    // Specific before generic RGN (e.g. "RGN double drop" → double drop, not bare RGN)
    expect(mapTrailerTypeToMoLabel('RGN Double Drop')).toBe('DOUBLE DROP TRLR')
    expect(mapTrailerTypeToMoLabel('lowboy RGN')).toBe('LOWBOY TRLR')
    expect(mapTrailerTypeToMoLabel(null)).toBeNull()
  })

  it('pickPrimaryCargoTrailer skips jeep/booster when later main trailer exists', () => {
    const jeepFirst = [
      { trailer_type: 'Jeep', vin: 'J1', make: 'JeepCo' },
      { trailer_type: 'Double Drop', vin: 'DD1', make: 'Landoll' },
    ]
    const primary = pickPrimaryCargoTrailer(jeepFirst)!
    expect(primary.vin).toBe('DD1')
    expect(mapTrailerTypeToMoLabel(primary.trailer_type)).toBe('DOUBLE DROP TRLR')

    // Only jeep → still returns jeep
    const onlyJeep = pickPrimaryCargoTrailer([{ trailer_type: 'Jeep', vin: 'J1' }])!
    expect(onlyJeep.vin).toBe('J1')

    // Unit Two uses primary cargo trailer when jeep is first in array
    const prefill = generatePortalPrefill(
      {
        ...moCorridorRequest,
        equipment: {
          rig: {
            totalAxles: 8,
            tractor: { vin: 'V1', make: 'Peterbilt', year: 2020 },
            trailers: [
              { trailer_type: 'Jeep', vin: 'JEEP1', make: 'JeepCo', year: 2015 },
              {
                trailer_type: 'Double Drop',
                vin: 'MAIN1',
                make: 'Landoll',
                year: 2018,
                license_plate: 'mainpl',
                license_plate_state: 'mo',
              },
            ],
          },
        },
      },
      'MO'
    )
    expect(prefill.generatedFields.unit_two_type).toBe('DOUBLE DROP TRLR')
    expect(prefill.generatedFields.trailer_vin).toBe('MAIN1')
    expect(prefill.generatedFields.trailer_make).toBe('Landoll')
    expect(prefill.generatedFields.trailer_2_vin).toBe('JEEP1')
  })

  it('power_unit_type and tip only when tractor present (not trailer-only vehicle_id)', () => {
    const trailerOnly = generatePortalPrefill(
      {
        origin_city: 'St. Louis',
        origin_state: 'MO',
        destination_city: 'KC',
        destination_state: 'MO',
        weight: 80000,
        length: 70,
        width: 10,
        height: 13.5,
        route_corridor: ['MO'],
        equipment: {
          rig: {
            trailers: [{ vin: 'TRAILERONLY', make: 'Fontaine', trailer_type: 'Flatbed' }],
          },
        },
        cargo: {},
      },
      'MO'
    )
    expect(trailerOnly.generatedFields.vehicle_id).toBe('TRAILERONLY')
    expect(trailerOnly.generatedFields.power_unit_type).toBeUndefined()
    expect(trailerOnly.generatedFields.tip_power_unit_type).toBeUndefined()
    expect(trailerOnly.generatedFields.unit_two_type).toBe('FLAT BED TRLR')
    const packet = buildPortalClipboardPacket(trailerOnly, STATE_PORTAL_CONFIGS.MO)
    expect(packet).not.toContain('Power Unit Type:')
    expect(packet).not.toContain('Power Unit Type tip:')
  })

  it('non-MO states do not emit tip_* keys', () => {
    const ok = generatePortalPrefill(moCorridorRequest, 'OK')
    expect(ok.generatedFields.tip_conveyance).toBeUndefined()
    expect(ok.generatedFields.tip_travel).toBeUndefined()
    expect(ok.generatedFields.tip_vehicle_type).toBeUndefined()
    expect(ok.generatedFields.tip_booster).toBeUndefined()
    expect(ok.generatedFields.tip_for_hire).toBeUndefined()
    expect(ok.generatedFields.tip_description_list).toBeUndefined()
    expect(ok.generatedFields.tip_power_unit_type).toBeUndefined()
    const packet = buildPortalClipboardPacket(ok, STATE_PORTAL_CONFIGS.OK)
    expect(packet).not.toContain('Conveyance:')
    expect(packet).not.toContain('Vehicle Type:')
  })

  it('getMoStepPrefillKeysWithValues filters empty keys (e.g. borders when missing)', () => {
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
        equipment: { rig: { tractor: { vin: 'X', make: 'KW' } } },
        cargo: { carrierDriver: { usdotNumber: '1', companyName: 'Co' } },
      },
      'MO'
    )
    const steps = buildMoFilingSteps(single)
    const trip = steps.find((s) => s.id === 'trip_tab')!
    const keys = getMoStepPrefillKeysWithValues(single, trip)
    expect(keys).toContain('origin')
    expect(keys).toContain('destination')
    expect(keys).not.toContain('border_entry')
    expect(keys).not.toContain('border_exit')
  })

  it('generatePortalPrefill emits cargo pieces, serial, overhangs, trailer_length, highways, tips for MO', () => {
    const prefill = generatePortalPrefill(
      {
        ...moCorridorRequest,
        equipment: {
          rig: {
            totalAxles: 6,
            tractor: { vin: 'V', make: 'Freightliner', year: 2019 },
            trailers: [
              {
                trailer_type: 'Step Deck',
                overall_length_ft: 48,
                make: 'Fontaine',
                year: 2018,
              },
            ],
          },
          loadOverhangs: { frontOfRigFt: 1, frontOfTrailerFt: 0, rearFt: 3 },
        },
      },
      'MO'
    )
    const f = prefill.generatedFields
    expect(f.load_description).toBe('Transformer skid')
    expect(f.load_pieces).toBe(1)
    expect(f.serial_number).toBe('SN-7788')
    expect(f.trailer_length).toMatch(/48/)
    expect(f.highways).toBe('I-44, I-70')
    expect(f.front_overhang).toBeTruthy()
    expect(f.rear_overhang).toBeTruthy()
    expect(f.unit_two_type).toBe('STEP DECK TRLR')
    expect(f.power_unit_type).toBe('TRUCK-TRACTOR')
    expect(f.tip_conveyance).toMatch(/Hauled/)
    expect(f.tip_conveyance).toMatch(/Under Own Power/)
    expect(f.tip_travel).toMatch(/Interstate/)
    expect(f.tip_vehicle_type).toBe('PowerUnit + 1 Unit')
    expect(f.tip_power_unit_type).toMatch(/TRUCK-TRACTOR/)
    expect(f.tip_booster).toBe('No')
    expect(f.carrier_usdot).toBe('7654321')
    expect(f.contact_name).toBe('Show-Me Haul')
    expect(f.driver_name).toBe('Pat Driver')
    expect(f.carrier_email).toBe('pat@showmehaul.example')
  })

  it('MO walkthrough aligns with steps; Street Address honesty for city/state prefill', () => {
    expect(MO_PORTAL_WALKTHROUGH).toHaveLength(10)
    expect(MO_PORTAL_WALKTHROUGH[0]).toContain('Login Carrier Express')
    expect(MO_PORTAL_WALKTHROUGH[0]).toContain('mcs.modot.mo.gov')
    expect(MO_PORTAL_WALKTHROUGH[1]).toBe('Programs → Oversize/Overweight')
    expect(MO_PORTAL_WALKTHROUGH[2]).toContain('Single Trip Permits → Single Trip')
    expect(MO_PORTAL_WALKTHROUGH[3]).toMatch(/Travel Dates/)
    expect(MO_PORTAL_WALKTHROUGH[3]).toMatch(/7 moving days/)
    expect(MO_PORTAL_WALKTHROUGH[4]).toMatch(/Application fields/)
    expect(MO_PORTAL_WALKTHROUGH[5]).toMatch(/Trip/)
    expect(MO_PORTAL_WALKTHROUGH[5]).toMatch(/Street Address/)
    expect(MO_PORTAL_WALKTHROUGH[5]).toMatch(/city\/state|full street/i)
    expect(MO_PORTAL_WALKTHROUGH[5]).toMatch(/Analyze/)
    expect(MO_PORTAL_WALKTHROUGH[6]).toMatch(/Failures\s*=\s*0/)
    expect(MO_PORTAL_WALKTHROUGH[6]).toMatch(/Trip Description/)
    expect(MO_PORTAL_WALKTHROUGH[7]).toMatch(/Review/)
    expect(MO_PORTAL_WALKTHROUGH[8]).toMatch(/Payment/)
    expect(MO_PORTAL_WALKTHROUGH[8]).toMatch(/MoDOT-displayed|fee is MoDOT/i)
    expect(MO_PORTAL_WALKTHROUGH[8]).toMatch(/validate other corridor states/i)
    expect(MO_PORTAL_WALKTHROUGH[8]).toMatch(/carrier contact/i)
    expect(MO_PORTAL_WALKTHROUGH[9]).toMatch(/permit #/)
    const steps = buildMoFilingSteps()
    expect(steps).toHaveLength(MO_PORTAL_WALKTHROUGH.length)
    expect(steps.find((s) => s.id === 'trip_tab')?.guidance?.join(' ')).toMatch(
      /city\/state|Street Address/i
    )
    const joined = MO_PORTAL_WALKTHROUGH.join(' ')
    expect(joined).not.toMatch(/click File > Applications > New/i)
    expect(MO_PAY_LAST_NOTE).toMatch(/Validate other corridor states/)
    expect(MO_FEE_DISPLAY_NOTE).toMatch(/MoDOT-displayed/)
  })

  it('MO config points at Carrier Express login with v3 field labels', () => {
    const mo = STATE_PORTAL_CONFIGS.MO
    expect(mo.portalUrl).toMatch(/modot\.mo\.gov/i)
    expect(mo.portalSystemName).toMatch(/Carrier Express/i)
    expect(mo.fieldMapping.origin).toBe('Origin')
    expect(mo.fieldMapping.weight).toBe('GVW')
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