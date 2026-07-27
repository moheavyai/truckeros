import { describe, expect, it } from 'vitest'
import { toRouteMapBuildInput } from './toRouteMapBuildInput'
import { buildRouteMapModel } from './buildRouteMapModel'

const baseForm = {
  origin: { city: 'Omaha', state: 'NE', query: 'Omaha NE' },
  destination: { city: 'Minot', state: 'ND', query: 'Minot ND' },
  drops: [{ city: 'Minot', state: 'ND', query: 'Minot ND', lat: 48.232, lon: -101.296 }],
  originLat: 41.2565,
  originLon: -95.9345,
  destinationLat: 48.232,
  destinationLon: -101.296,
}

const primaryOption = {
  stops: [
    { name: 'Omaha', lat: 41.2565, lon: -95.9345 },
    { name: 'Minot', lat: 48.232, lon: -101.296, is_drop: true },
  ],
  routeCorridor: ['NE', 'SD', 'ND'],
  distanceMiles: 500,
  specialInstructionsEnforced: true,
}

describe('toRouteMapBuildInput', () => {
  it('maps ready only when routeProgress ready AND coords+dims ready', () => {
    const input = toRouteMapBuildInput({
      routeProgress: 'ready',
      primary: primaryOption,
      formSynced: baseForm,
      coordsReady: true,
      dimsReady: true,
    })
    expect(input.status).toBe('ready')
    expect(input.option).toBeTruthy()
  })

  it('demotes ready to idle when !coordsReady or !dimsReady (honesty)', () => {
    const noDims = toRouteMapBuildInput({
      routeProgress: 'ready',
      primary: primaryOption,
      formSynced: baseForm,
      coordsReady: true,
      dimsReady: false,
    })
    expect(noDims.status).toBe('idle')
    expect(noDims.option).toBeNull()

    const noCoords = toRouteMapBuildInput({
      routeProgress: 'ready',
      primary: primaryOption,
      formSynced: baseForm,
      coordsReady: false,
      dimsReady: true,
    })
    expect(noCoords.status).toBe('idle')
    expect(noCoords.option).toBeNull()
  })

  it('maps geocoding/calculating to calculating with distinct messages', () => {
    const geo = toRouteMapBuildInput({
      routeProgress: 'geocoding',
      routeProgressDetail: 'Resolving addresses…',
      formSynced: baseForm,
      coordsReady: false,
      dimsReady: true,
    })
    expect(geo.status).toBe('calculating')
    expect(geo.message).toMatch(/Resolving/i)

    const calc = toRouteMapBuildInput({
      routeProgress: 'calculating',
      routeProgressDetail: 'Running OR-Tools…',
      formSynced: baseForm,
      coordsReady: true,
      dimsReady: true,
      primary: primaryOption,
    })
    expect(calc.status).toBe('calculating')
    expect(calc.option).toBeTruthy()
    expect(calc.message).toContain('OR-Tools')
  })

  it('builds formStops labels and lat/lon from formSynced', () => {
    const input = toRouteMapBuildInput({
      routeProgress: 'idle',
      formSynced: baseForm,
      coordsReady: true,
      dimsReady: false,
    })
    expect(input.formStops?.origin?.name).toContain('Omaha')
    expect(input.formStops?.origin?.lat).toBe(41.2565)
    expect(input.formStops?.destination?.lon).toBe(-101.296)
    expect(input.option).toBeNull()
  })

  it('pipeline demote → no chips even with leftover primary', () => {
    const model = buildRouteMapModel(
      toRouteMapBuildInput({
        routeProgress: 'ready',
        primary: primaryOption,
        formSynced: baseForm,
        coordsReady: true,
        dimsReady: false,
      })
    )
    expect(model.status).toBe('idle')
    expect(model.chips).toEqual([])
  })
})
