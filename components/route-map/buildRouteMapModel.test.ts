import { describe, expect, it } from 'vitest'
import { buildRouteMapModel, buildLinePositions } from './buildRouteMapModel'
import type { RouteMapStop } from './types'

describe('buildRouteMapModel', () => {
  const sampleStops = [
    { name: 'Grand Island, NE', lat: 40.9264, lon: -98.342, is_via: false },
    { name: 'Kansas City, MO', lat: 39.0997, lon: -94.5786, is_via: true },
    { name: 'Memphis, TN', lat: 35.1495, lon: -90.049, is_drop: true },
    { name: 'Mobile, AL', lat: 30.6954, lon: -88.0399, is_drop: true },
  ]

  it('maps origin + via + drop roles from optimize stops', () => {
    const model = buildRouteMapModel({
      status: 'ready',
      option: {
        stops: sampleStops,
        routeCorridor: ['NE', 'KS', 'MO', 'AR', 'TN', 'MS', 'AL'],
        distanceMiles: 1240.4,
        durationHours: 22.5,
        avoidedStates: ['IL'],
        specialInstructionsEnforced: true,
      },
    })

    expect(model.status).toBe('ready')
    expect(model.stops).toHaveLength(4)
    expect(model.stops[0].role).toBe('origin')
    expect(model.stops[0].name).toContain('Grand Island')
    expect(model.stops[1].role).toBe('via')
    expect(model.stops[2].role).toBe('drop')
    expect(model.stops[3].role).toBe('destination')
  })

  it('assigns roles from original index when intermediate coords are missing', () => {
    const model = buildRouteMapModel({
      status: 'ready',
      option: {
        stops: [
          { name: 'Origin NE', lat: 40.9, lon: -98.3 },
          { name: 'Broken via', lat: null, lon: null, is_via: true },
          { name: 'Drop mid', lat: 35.1, lon: -90.0, is_drop: true },
          { name: 'Dest AL', lat: 30.7, lon: -88.0, is_drop: true },
        ],
      },
    })
    // Filtered to 3 stops but roles still from original indices
    expect(model.stops).toHaveLength(3)
    expect(model.stops[0].role).toBe('origin')
    expect(model.stops[1].role).toBe('drop') // original index 2 intermediate drop
    expect(model.stops[1].name).toMatch(/Drop mid|Drop 1/)
    expect(model.stops[2].role).toBe('destination') // original last index
  })

  it('uses 1-based drop ordinal among plotted drops', () => {
    const model = buildRouteMapModel({
      status: 'ready',
      option: {
        stops: [
          { name: 'O', lat: 40, lon: -98 },
          { name: 'D1', lat: 38, lon: -95, is_drop: true },
          { name: 'D2', lat: 36, lon: -92, is_drop: true },
          { name: 'End', lat: 30, lon: -88 },
        ],
      },
    })
    const drops = model.stops.filter((s) => s.role === 'drop')
    expect(drops[0].name).toBe('D1')
    // named from source; fallback would be Drop 1 / Drop 2 when no name
    const unnamed = buildRouteMapModel({
      status: 'ready',
      option: {
        stops: [
          { lat: 40, lon: -98 },
          { lat: 38, lon: -95, is_drop: true },
          { lat: 36, lon: -92, is_drop: true },
          { lat: 30, lon: -88 },
        ],
      },
    })
    expect(unnamed.stops[1].name).toBe('Drop 1')
    expect(unnamed.stops[2].name).toBe('Drop 2')
  })

  it('builds sequential linePositions from stops when no leg geometry', () => {
    const model = buildRouteMapModel({
      status: 'ready',
      option: { stops: sampleStops },
    })
    expect(model.linePositions).toEqual([
      [40.9264, -98.342],
      [39.0997, -94.5786],
      [35.1495, -90.049],
      [30.6954, -88.0399],
    ])
  })

  it('handles 0 and 1 stop without inventing a line', () => {
    const empty = buildRouteMapModel({ status: 'idle' })
    expect(empty.stops).toHaveLength(0)
    expect(empty.linePositions).toHaveLength(0)

    const one = buildRouteMapModel({
      status: 'idle',
      formStops: { origin: { name: 'Only', lat: 41, lon: -96 } },
    })
    expect(one.stops).toHaveLength(1)
    expect(one.linePositions).toHaveLength(1)
  })

  it('includes corridor, distance, duration, and avoid/prefer chips when ready', () => {
    const model = buildRouteMapModel({
      status: 'ready',
      option: {
        stops: sampleStops,
        routeCorridor: ['NE', 'KS', 'MO', 'AL'],
        distanceMiles: 1000,
        durationHours: 18,
        avoidedStates: ['AR', 'IL'],
        specialInstructionsEnforced: true,
      },
    })

    const labels = model.chips.map((c) => c.label)
    expect(labels.some((l) => l.includes('NE') && l.includes('AL'))).toBe(true)
    expect(labels.some((l) => /1,000 mi|1000 mi/.test(l))).toBe(true)
    expect(labels.some((l) => l.includes('hrs'))).toBe(true)
    expect(labels.some((l) => l.includes('Avoids') && l.includes('AR'))).toBe(true)
    expect(labels).toContain('Prefs enforced')
  })

  it('suppresses chips for calculating, error, and idle (no stale success chrome)', () => {
    const option = {
      stops: sampleStops,
      routeCorridor: ['NE', 'AL'],
      distanceMiles: 900,
      specialInstructionsEnforced: true as const,
    }
    expect(buildRouteMapModel({ status: 'calculating', option }).chips).toEqual([])
    expect(buildRouteMapModel({ status: 'error', option, message: 'fail' }).chips).toEqual([])
    expect(
      buildRouteMapModel({
        status: 'idle',
        option,
        formStops: {
          origin: { lat: 40, lon: -98, name: 'O' },
          destination: { lat: 30, lon: -88, name: 'D' },
        },
      }).chips
    ).toEqual([])
  })

  it('marks prefs partial when specialInstructionsEnforced is false with avoids', () => {
    const model = buildRouteMapModel({
      status: 'ready',
      option: {
        stops: sampleStops,
        avoidedStates: ['IL'],
        specialInstructionsEnforced: false,
        chosenCorridorRationale: 'Partial…',
      },
    })
    const labels = model.chips.map((c) => c.label)
    expect(labels).toContain('Prefs partial')
  })

  it('idle with form origin/dest prefers formStops over option and has no chips', () => {
    const model = buildRouteMapModel({
      status: 'idle',
      option: {
        stops: sampleStops,
        routeCorridor: ['NE', 'AL'],
        distanceMiles: 1000,
      },
      formStops: {
        origin: { name: 'Omaha, NE', lat: 41.2565, lon: -95.9345 },
        drops: [{ name: 'Minot, ND', lat: 48.232, lon: -101.296 }],
        destination: { name: 'Minot, ND', lat: 48.232, lon: -101.296 },
      },
    })
    expect(model.stops[0].name).toContain('Omaha')
    expect(model.stops[0].role).toBe('origin')
    expect(model.stops[model.stops.length - 1].role).toBe('destination')
    expect(model.chips).toEqual([])
  })

  it('empty idle surfaces muted message; idle with stops has no empty message', () => {
    const empty = buildRouteMapModel({ status: 'idle' })
    expect(empty.message).toMatch(/origin and destination/i)

    const withStops = buildRouteMapModel({
      status: 'idle',
      formStops: {
        origin: { name: 'A', lat: 40, lon: -98 },
        destination: { name: 'B', lat: 30, lon: -88 },
      },
    })
    expect(withStops.message).toBeUndefined()
  })

  it('calculating status carries progress message and form markers', () => {
    const model = buildRouteMapModel({
      status: 'calculating',
      message: 'Running OR-Tools optimization…',
      formStops: {
        origin: { name: 'A', lat: 40, lon: -98 },
        destination: { name: 'B', lat: 30, lon: -88 },
      },
    })
    expect(model.status).toBe('calculating')
    expect(model.message).toContain('OR-Tools')
    expect(model.stops).toHaveLength(2)
    expect(model.chips).toEqual([])
  })

  it('passes through pendingWaypoints for Map v2 without using them in chips', () => {
    const model = buildRouteMapModel({
      status: 'idle',
      pendingWaypoints: [{ lat: 39.1, lon: -94.5, name: 'KC' }],
      formStops: {
        origin: { lat: 40, lon: -98, name: 'O' },
        destination: { lat: 30, lon: -88, name: 'D' },
      },
    })
    expect(model.pendingWaypoints).toEqual([{ lat: 39.1, lon: -94.5, name: 'KC' }])
  })

  it('error status surfaces failure message without chips', () => {
    const model = buildRouteMapModel({
      status: 'error',
      message: 'Route calculation failed',
      option: { stops: sampleStops, distanceMiles: 100, specialInstructionsEnforced: true },
    })
    expect(model.status).toBe('error')
    expect(model.message).toMatch(/failed/i)
    expect(model.chips).toEqual([])
  })
})

describe('buildLinePositions', () => {
  const stops: RouteMapStop[] = [
    { id: '1', name: 'A', lat: 1, lon: 2, role: 'origin' },
    { id: '2', name: 'B', lat: 3, lon: 4, role: 'destination' },
  ]

  it('falls back to stop order', () => {
    expect(buildLinePositions(stops, null)).toEqual([
      [1, 2],
      [3, 4],
    ])
  })

  it('uses explicit GeoJSON lon/lat order for geometry objects', () => {
    const line = buildLinePositions(stops, {
      legs: [
        {
          geometry: {
            type: 'LineString',
            // European-ish lon/lat still GeoJSON order
            coordinates: [
              [2.35, 48.85],
              [13.4, 52.52],
            ],
          },
        },
      ],
    })
    expect(line[0]).toEqual([48.85, 2.35])
    expect(line[1]).toEqual([52.52, 13.4])
  })

  it('prefers leg geometry coordinates when present (US GeoJSON)', () => {
    const line = buildLinePositions(stops, {
      legs: [
        {
          geometry: {
            type: 'LineString',
            coordinates: [
              [-98.3, 40.9],
              [-94.5, 39.1],
            ],
          },
        },
      ],
    })
    expect(line[0]).toEqual([40.9, -98.3])
    expect(line[1]).toEqual([39.1, -94.5])
  })
})
