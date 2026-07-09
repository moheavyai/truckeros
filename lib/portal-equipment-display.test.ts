import { describe, expect, it } from 'vitest'
import { formatPortalEquipmentSnapshot } from './portal-equipment-display'

describe('formatPortalEquipmentSnapshot', () => {
  it('shows complete rig, tractor, and all attached trailers', () => {
    const snapshot = formatPortalEquipmentSnapshot(
      {
        rig: {
          rigName: '93 Pete c/ SD + Jeep',
          overallLengthFt: 98.5,
          totalAxles: 7,
          tractor: {
            profile_name: '93 Pete',
            unit_number: '4721',
            year: 2019,
            make: 'Peterbilt',
            model: '389',
            num_axles: 3,
            overall_length_ft: 22,
            license_plate: 'abc1234',
            license_plate_state: 'tx',
            vin: '1XPBDP9X5HD123456',
            empty_weight_lbs: 18000,
          },
          trailers: [
            {
              profile_name: '53 SD',
              overall_length_ft: 53,
              num_axles: 2,
              trailer_type: 'Stepdeck',
              width_ft: 8.5,
              deck_height_ft: 4.5,
              license_plate: 'trl111',
              license_plate_state: 'ne',
              vin: '1UYVS2535CM111111',
              empty_weight_lbs: 12000,
            },
            {
              profile_name: 'Jeep dolly',
              overall_length_ft: 20,
              num_axles: 2,
              vin: '1JJJJ2222',
            },
          ],
        },
        loadOverhangs: { frontOfRigFt: 2, frontOfTrailerFt: 1, rearFt: 5 },
      },
      {}
    )

    expect(snapshot.hasContent).toBe(true)
    expect(snapshot.rigLine).toContain('93 Pete c/ SD + Jeep')
    expect(snapshot.rigLine).toContain('98.5 ft overall')
    expect(snapshot.rigLine).toContain('7 axles total')
    expect(snapshot.tractorLine).toContain('93 Pete')
    expect(snapshot.tractorLine).toContain('4721')
    expect(snapshot.tractorLine).toContain('ABC1234 (TX)')
    expect(snapshot.trailerLines).toHaveLength(2)
    expect(snapshot.trailerLines[0]).toContain('53 SD')
    expect(snapshot.trailerLines[0]).toContain(`8' 6"`)
    expect(snapshot.trailerLines[1]).toContain('Jeep dolly')
    expect(snapshot.overhangLine).toContain('front rig 2 ft + trailer 1 ft')
    expect(snapshot.overhangLine).toContain('rear 5 ft')
  })

  it('falls back to legacy flat equipment when no rig snapshot', () => {
    const snapshot = formatPortalEquipmentSnapshot(
      { unitNumber: 'PETE-99', axles: 5, trailerLengthFt: 53 },
      { overhang_front_ft: 3, overhang_rear_ft: 4 }
    )

    expect(snapshot.rigLine).toBeNull()
    expect(snapshot.legacyLine).toContain('PETE-99')
    expect(snapshot.legacyLine).toContain('5 axles')
    expect(snapshot.overhangLine).toBe('front 3 ft / rear 4 ft')
  })
})