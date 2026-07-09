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
    expect(option.escortRequiredStates).toEqual(['NE', 'SD'])
    expect(option.escortWarnings?.length).toBe(2)
    expect(option.notes.some((n) => n.includes('Escort(s) likely required in 2'))).toBe(true)
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
    expect(option.escortWarnings?.some((w) => /height pole recommended/i.test(w))).toBe(true)
  })
})