import { describe, expect, it } from 'vitest'
import { buildPermitCargoSnapshot, type PermitCargoFormInput } from './permit-cargo-snapshot'

const baseForm: PermitCargoFormInput = {
  cargoDescription: 'Transformer',
  cargoMakeModel: 'GE X100',
  cargoSerialNumber: 'SN-1',
  cargoManufacturer: 'GE',
  numberOfPieces: 2,
  loadedArrangement: 'side-by-side',
  moveType: 'hauled',
  axleWeights: [16000, 16000],
  grossLoadedWeight: 32000,
  weight: 80000,
  length: 60,
  width: 9.67,
  height: 13.5,
  loadWeightLbs: '42000',
  loadLengthFt: '40',
  loadWidthFt: '8',
  loadHeightFt: '12',
  companyName: 'Acme',
  usdotNumber: '123',
  mcNumber: 'MC-1',
  dotNumber: 'DOT-1',
  ein: 'EIN-1',
  carrierAddress: '1 Main',
  carrierPhone: '555-0100',
  carrierEmail: 'ops@acme.com',
  insuranceContact: 'Ins Co',
  driverFullName: 'Jane Doe',
  cdlNumber: 'CDL-1',
  cdlState: 'TX',
  driverPhone: '555-0200',
  driverEmail: 'jane@acme.com',
  dateOfBirth: '1980-01-01',
  emergencyContact: 'Bob',
}

describe('buildPermitCargoSnapshot', () => {
  it('includes sanitized cargo subfields and carrier driver key', () => {
    const snapshot = buildPermitCargoSnapshot(baseForm, 'driver-key-1')

    expect(snapshot.numberOfPieces).toBe(2)
    expect(snapshot.loadedArrangement).toBe('side-by-side')
    expect(snapshot.moveType).toBe('hauled')
    expect(snapshot.description).toBe('Transformer')
    expect((snapshot.carrierDriver as Record<string, string>).selectedDriverKey).toBe('driver-key-1')
  })

  it('re-sanitizes invalid enum and piece values at build time', () => {
    const snapshot = buildPermitCargoSnapshot(
      {
        ...baseForm,
        numberOfPieces: 0,
        loadedArrangement: 'invalid',
        moveType: 'flying',
      },
      ''
    )

    expect(snapshot.numberOfPieces).toBe(1)
    expect(snapshot.loadedArrangement).toBe('side-by-side')
    expect(snapshot.moveType).toBe('hauled')
  })

  it('caps numberOfPieces at MAX_NUMBER_OF_PIECES', () => {
    const snapshot = buildPermitCargoSnapshot({ ...baseForm, numberOfPieces: 5000 }, '')
    expect(snapshot.numberOfPieces).toBe(999)
  })

  it('includes organizationId when provided for service-mode scoped permits', () => {
    const snapshot = buildPermitCargoSnapshot(baseForm, 'driver-key-1', {
      organizationId: 'org-carrier-123',
    })
    expect(snapshot.organizationId).toBe('org-carrier-123')
  })
})