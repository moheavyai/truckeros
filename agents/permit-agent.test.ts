import { beforeEach, describe, expect, it, vi } from 'vitest'
import { parseDimensionInput } from '@/lib/parse-dimension'
import type { StatePermitRule } from '@/types/permit'
import { processPermitRequest } from './permit-agent'

const txRule: StatePermitRule = {
  state_code: 'TX',
  state_name: 'Texas',
  legal_width_ft: 8.5,
  legal_height_ft: 13.5,
  legal_length_ft: 59,
  legal_weight_lbs: 80000,
  permit_threshold_width_ft: 8.5,
  permit_threshold_height_ft: 13.5,
  permit_threshold_length_ft: 59,
  permit_threshold_weight_lbs: 80000,
}

const neRule: StatePermitRule = {
  state_code: 'NE',
  state_name: 'Nebraska',
  legal_width_ft: 8.5,
  legal_height_ft: 13.5,
  legal_length_ft: 53,
  legal_weight_lbs: 80000,
  permit_threshold_width_ft: 8.5,
  permit_threshold_height_ft: 13.5,
  permit_threshold_length_ft: 53,
  permit_threshold_weight_lbs: 80000,
}

const sdRule: StatePermitRule = {
  state_code: 'SD',
  state_name: 'South Dakota',
  legal_width_ft: 8.5,
  legal_height_ft: 13.5,
  legal_length_ft: 53,
  legal_weight_lbs: 80000,
  permit_threshold_width_ft: 8.5,
  permit_threshold_height_ft: 13.5,
  permit_threshold_length_ft: 53,
  permit_threshold_weight_lbs: 80000,
  escort_threshold_width_ft: 12,
}

const allRules = [txRule, neRule, sdRule]

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        in: vi.fn((_col: string, codes: string[]) =>
          Promise.resolve({
            data: allRules.filter((r) => codes.includes(r.state_code)),
            error: null,
          })
        ),
      })),
    })),
  },
}))

vi.mock('@/lib/dot-corridor-restrictions', () => ({
  getRestrictionsForCorridor: vi.fn(() => []),
  formatRestrictionNote: vi.fn((r: { description?: string }) => r.description ?? ''),
}))

const mockBuildIntelligentCorridor = vi.fn()
const mockSnapToStateHighway = vi.fn()

vi.mock('@/lib/build-corridor', () => ({
  buildIntelligentCorridor: (...args: unknown[]) => mockBuildIntelligentCorridor(...args),
}))

vi.mock('@/lib/snap-highway', () => ({
  snapToStateHighway: (...args: unknown[]) => mockSnapToStateHighway(...args),
}))

describe('permit-agent multi-stop routing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSnapToStateHighway.mockImplementation(async (lat: number, lon: number) => ({
      lat,
      lon,
      snapped: false,
    }))
    mockBuildIntelligentCorridor.mockImplementation(
      async (oLat: number, oLon: number, dLat: number, dLon: number) => [
        {
          routeCorridor: ['NE', 'ND'],
          highways: [`${oLat},${oLon}->${dLat},${dLon}`],
          distanceMeters: 100_000,
          durationSeconds: 3600,
          engine: 'osrm',
        },
      ]
    )
  })

  it('builds sequential legs for each drop stop', async () => {
    const result = await processPermitRequest({
      origin: { city: 'Grand Island', state: 'NE' },
      destination: { city: 'Dickinson', state: 'ND' },
      drops: [
        { query: 'Minot', city: 'Minot', state: 'ND', lat: 48.232, lon: -101.296 },
        { query: 'Dickinson', city: 'Dickinson', state: 'ND', lat: 46.879, lon: -102.789 },
      ],
      weight: 80000,
      length: 74,
      width: 8.5,
      height: 13.5,
      originLat: 40.926,
      originLon: -98.342,
      destinationLat: 46.879,
      destinationLon: -102.789,
    })

    expect(result.status).toBe('pending_review')
    expect(mockBuildIntelligentCorridor).toHaveBeenCalledTimes(2)

    const firstLeg = mockBuildIntelligentCorridor.mock.calls[0]
    const secondLeg = mockBuildIntelligentCorridor.mock.calls[1]
    expect(firstLeg[0]).toBe(40.926)
    expect(firstLeg[2]).toBe(48.232)
    expect(secondLeg[0]).toBe(48.232)
    expect(secondLeg[2]).toBe(46.879)

    const option = result.options[0]
    expect(option.notes?.some((n) => n.includes('multi-stop'))).toBe(true)
  })
})

describe('permit-agent length permit integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('TX rule permit_threshold_length_ft=59 with trailer=53 envelope=74 does not flag length', async () => {
    const result = await processPermitRequest({
      origin: { city: 'Dallas', state: 'TX' },
      destination: { city: 'Houston', state: 'TX' },
      weight: 80000,
      length: 74,
      width: 8.5,
      height: 13.5,
      trailerLengthFt: 53,
      manualRoute: ['TX'],
    })

    expect(result.status).toBe('pending_review')
    expect(result.options).toHaveLength(1)

    const option = result.options[0]
    expect(option.permitRequiredStates).not.toContain('TX')
    expect(option.reasons.some(r => r.includes('envelope length'))).toBe(false)
    expect(option.reasons.some(r => r.toLowerCase().includes('length'))).toBe(false)
  })
})

describe('permit-agent scale findings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('surfaces axleGroupSummary and unableToScale on overweight unscaleable loads', async () => {
    const result = await processPermitRequest({
      origin: { city: 'Dallas', state: 'TX' },
      destination: { city: 'Houston', state: 'TX' },
      weight: 200_000,
      length: 74,
      width: 8.5,
      height: 13.5,
      axles: 5,
      axleWeights: [40_000, 40_000, 40_000, 40_000, 40_000],
      manualRoute: ['TX'],
    })

    expect(result.status).toBe('pending_review')
    const option = result.options[0]
    expect(option.axleGroupSummary).toMatch(/axles/i)
    expect(option.scaleFindings?.length).toBeGreaterThan(0)
    expect(option.unableToScale).toBe(true)
    expect(option.notes?.some((n) => n.includes('Axle groups'))).toBe(true)
    // Config scale fail promotes corridor states onto permit flags + card-friendly reasons
    expect(option.corridorScaleFailedStates).toContain('TX')
    expect(option.permitRequiredStates).toContain('TX')
    expect(option.reasons.some((r) => r.startsWith('TX:') && r.includes('SCALE FAIL'))).toBe(true)
  })

  it('uses ${state}: prefix on dimension permit reasons for per-state cards', async () => {
    const result = await processPermitRequest({
      origin: { city: 'Dallas', state: 'TX' },
      destination: { city: 'Houston', state: 'TX' },
      weight: 80_000,
      length: 74,
      width: 12,
      height: 13.5,
      trailerLengthFt: 53,
      manualRoute: ['TX'],
    })
    const option = result.options[0]
    expect(option.permitRequiredStates).toContain('TX')
    expect(option.reasons.some((r) => r.startsWith('TX: Permit required'))).toBe(true)
    expect(option.reasons.some((r) => r.startsWith('TX (State):') || r.startsWith('TX (state):'))).toBe(false)
  })

  it('does not false-fail scale on legal 80k with group-aware weights missing', async () => {
    const result = await processPermitRequest({
      origin: { city: 'Dallas', state: 'TX' },
      destination: { city: 'Houston', state: 'TX' },
      weight: 80_000,
      length: 74,
      width: 8.5,
      height: 13.5,
      axles: 5,
      manualRoute: ['TX'],
    })
    const option = result.options[0]
    expect(option.unableToScale).toBe(false)
    expect(option.scaleFindings?.some((f) => f.code === 'group_over')).toBe(false)
  })
})

describe('permit-agent borderCrossings pass-through', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSnapToStateHighway.mockImplementation(async (lat: number, lon: number) => ({
      lat,
      lon,
      snapped: false,
    }))
  })

  it('includes borderCrossings from a single corridor mock on options', async () => {
    const crossings = [
      {
        fromState: 'OK',
        toState: 'KS',
        entry: { lat: 36.99, lon: -94.62, highway: 'US-69' },
        exit: { lat: 39.8, lon: -95.0, highway: 'US-75' },
      },
    ]
    mockBuildIntelligentCorridor.mockResolvedValueOnce([
      {
        routeCorridor: ['OK', 'KS'],
        highways: ['US-69'],
        borderCrossings: crossings,
        distanceMeters: 200_000,
        durationSeconds: 7200,
        engine: 'osrm',
      },
    ])

    const result = await processPermitRequest({
      origin: { city: 'Tulsa', state: 'OK' },
      destination: { city: 'Wichita', state: 'KS' },
      weight: 80000,
      length: 74,
      width: 8.5,
      height: 13.5,
      originLat: 36.15,
      originLon: -95.99,
      destinationLat: 37.69,
      destinationLon: -97.34,
    })

    expect(result.status).toBe('pending_review')
    expect(result.options[0].borderCrossings).toEqual(crossings)
  })

  it('merges multi-leg borderCrossings in order', async () => {
    const leg1 = [
      {
        fromState: 'NE',
        toState: 'SD',
        entry: { lat: 42.9, lon: -97.4, highway: 'I-29' },
        exit: { lat: 43.5, lon: -96.7, highway: 'I-29' },
      },
    ]
    const leg2 = [
      {
        fromState: 'SD',
        toState: 'ND',
        entry: { lat: 45.9, lon: -96.6, highway: 'I-29' },
        exit: { lat: 46.8, lon: -96.8, highway: 'I-29' },
      },
    ]
    mockBuildIntelligentCorridor
      .mockResolvedValueOnce([
        {
          routeCorridor: ['NE', 'SD'],
          highways: ['I-29'],
          borderCrossings: leg1,
          distanceMeters: 100_000,
          durationSeconds: 3600,
          engine: 'osrm',
        },
      ])
      .mockResolvedValueOnce([
        {
          routeCorridor: ['SD', 'ND'],
          highways: ['I-29'],
          borderCrossings: leg2,
          distanceMeters: 120_000,
          durationSeconds: 4000,
          engine: 'osrm',
        },
      ])

    const result = await processPermitRequest({
      origin: { city: 'Grand Island', state: 'NE' },
      destination: { city: 'Dickinson', state: 'ND' },
      drops: [
        { query: 'Sioux Falls', city: 'Sioux Falls', state: 'SD', lat: 43.54, lon: -96.73 },
        { query: 'Dickinson', city: 'Dickinson', state: 'ND', lat: 46.879, lon: -102.789 },
      ],
      weight: 80000,
      length: 74,
      width: 8.5,
      height: 13.5,
      originLat: 40.926,
      originLon: -98.342,
      destinationLat: 46.879,
      destinationLon: -102.789,
    })

    expect(result.status).toBe('pending_review')
    expect(mockBuildIntelligentCorridor).toHaveBeenCalledTimes(2)
    expect(result.options[0].borderCrossings).toEqual([...leg1, ...leg2])
  })

  it('defaults borderCrossings to [] when corridor omits them', async () => {
    mockBuildIntelligentCorridor.mockResolvedValueOnce([
      {
        routeCorridor: ['NE', 'SD'],
        highways: [],
        distanceMeters: 50_000,
        durationSeconds: 1800,
        engine: 'osrm',
      },
    ])

    const result = await processPermitRequest({
      origin: { city: 'Omaha', state: 'NE' },
      destination: { city: 'Sioux Falls', state: 'SD' },
      weight: 80000,
      length: 74,
      width: 8.5,
      height: 13.5,
      originLat: 41.25,
      originLon: -96.0,
      destinationLat: 43.54,
      destinationLon: -96.73,
    })

    expect(result.options[0].borderCrossings).toEqual([])
  })
})

describe('permit-agent escort integration', () => {
  it('12\'7" width manual corridor surfaces escortWarnings via analyzeCorridor', async () => {
    const widthFt = parseDimensionInput("12'7")!.feetDecimal

    const result = await processPermitRequest({
      origin: { city: 'Omaha', state: 'NE' },
      destination: { city: 'Sioux Falls', state: 'SD' },
      weight: 80000,
      length: 74,
      width: widthFt,
      height: 13.5,
      manualRoute: ['NE', 'SD'],
    })

    expect(result.status).toBe('pending_review')
    const option = result.options[0]
    expect(option.escortRequiredStates).toEqual([])
    expect(option.escortPossibleStates).toEqual(['NE', 'SD'])
    expect(option.escortWarnings?.length).toBe(2)
    expect(option.escortDetails?.every((d) => d.requirementLevel === 'may_require')).toBe(true)
    expect(option.escortDetails?.every((d) => d.positionMode === 'relocates')).toBe(true)
    expect(option.notes.some((n) => /likely required/i.test(n))).toBe(false)
    expect(option.notes.some((n) => n.includes('Escort(s) possible in 2'))).toBe(true)
    expect(option.notes.some((n) => n.startsWith('NE:'))).toBe(false)
  })

  it('15\'8" height manual corridor surfaces escortWarnings via analyzeCorridor', async () => {
    const heightFt = parseDimensionInput("15'8")!.feetDecimal

    const result = await processPermitRequest({
      origin: { city: 'Omaha', state: 'NE' },
      destination: { city: 'Lincoln', state: 'NE' },
      weight: 80000,
      length: 74,
      width: 8.5,
      height: heightFt,
      manualRoute: ['NE'],
    })

    expect(result.status).toBe('pending_review')
    const option = result.options[0]
    expect(option.escortRequiredStates).toEqual(['NE'])
    expect(option.escortPossibleStates).toEqual([])
    expect(option.escortDetails?.[0].requirementLevel).toBe('required')
    expect(option.escortDetails?.[0].positionMode).toBe('relocates')
    expect(option.escortWarnings?.some((w) => /height pole required/i.test(w))).toBe(true)
  })
})