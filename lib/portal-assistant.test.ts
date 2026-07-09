import { describe, expect, it, vi } from 'vitest'
import {
  STATE_PORTAL_CONFIGS,
  generatePortalPrefill,
  getPortalStatesForAnalysis,
  openStatePortals,
  resolveInitialPortalState,
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

describe('generatePortalPrefill', () => {
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