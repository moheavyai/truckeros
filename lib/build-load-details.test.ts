import { describe, expect, it } from 'vitest'
import { buildLoadDetails, extractAxleEquipmentFields } from './build-load-details'

describe('extractAxleEquipmentFields', () => {
  it('extracts axles, weights, and equipment', () => {
    const fields = extractAxleEquipmentFields({
      axles: 5,
      axleWeights: [12000, 17000, 17000, 17000, 17000],
      equipment: {
        tractor: { num_axles: 3 },
        trailers: [{ num_axles: 2, trailer_type: 'RGN' }],
      },
    })
    expect(fields.axles).toBe(5)
    expect(fields.axleWeights?.[0]).toBe(12000)
    expect(fields.equipment?.trailers?.[0]?.trailer_type).toBe('RGN')
  })

  it('accepts rig-shaped snapshot', () => {
    const fields = extractAxleEquipmentFields({
      rig: {
        tractor: { num_axles: 3 },
        trailers: [{ num_axles: 2, trailer_type: 'Jeep' }],
      },
    })
    expect(fields.equipment?.trailers?.[0]?.trailer_type).toBe('Jeep')
  })
})

describe('buildLoadDetails gross weight preference', () => {
  it('uses grossLoadedWeight when positive', () => {
    const load = buildLoadDetails({
      origin: { city: 'A', state: 'NE' },
      destination: { city: 'B', state: 'ND' },
      weight: 50_000,
      grossLoadedWeight: 88_000,
      length: 70,
      width: 8.5,
      height: 13.5,
    })
    expect(load.weight).toBe(88_000)
  })
})
