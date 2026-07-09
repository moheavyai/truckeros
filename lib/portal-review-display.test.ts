import { describe, expect, it } from 'vitest'
import {
  formatCarrierReviewFields,
  formatDriverReviewFields,
  formatLoadReviewDetails,
} from './portal-review-display'

describe('formatCarrierReviewFields', () => {
  it('returns available carrier fields from carrierDriver snapshot', () => {
    const fields = formatCarrierReviewFields({
      companyName: 'Acme Hauling',
      usdotNumber: '1234567',
      mcNumber: 'MC-999',
      carrierAddress: '100 Main St, Dallas TX',
      carrierPhone: '555-0100',
      carrierEmail: 'ops@acme.com',
    })

    expect(fields).toEqual([
      { label: 'Company', value: 'Acme Hauling' },
      { label: 'USDOT', value: '1234567' },
      { label: 'MC', value: 'MC-999' },
      { label: 'Address', value: '100 Main St, Dallas TX' },
      { label: 'Phone', value: '555-0100' },
      { label: 'Email', value: 'ops@acme.com' },
    ])
  })

  it('returns empty array when carrierDriver is missing', () => {
    expect(formatCarrierReviewFields(null)).toEqual([])
    expect(formatCarrierReviewFields(undefined)).toEqual([])
  })

  it('accepts snake_case carrierDriver keys (PRD-1)', () => {
    const fields = formatCarrierReviewFields({
      company_name: 'Snake Case Carrier',
      usdot_number: '9988776',
      carrier_phone: '555-9999',
    })

    expect(fields).toEqual([
      { label: 'Company', value: 'Snake Case Carrier' },
      { label: 'USDOT', value: '9988776' },
      { label: 'Phone', value: '555-9999' },
    ])
  })

  it('returns only populated carrier fields when snapshot is partial (PRD-2)', () => {
    const fields = formatCarrierReviewFields({ companyName: 'Partial Co' })
    expect(fields).toEqual([{ label: 'Company', value: 'Partial Co' }])
  })
})

describe('formatDriverReviewFields', () => {
  it('returns driver fields from carrierDriver snapshot', () => {
    const fields = formatDriverReviewFields({
      driverFullName: 'Jane Doe',
      cdlNumber: 'D1234567',
      cdlState: 'TX',
      driverPhone: '555-0200',
    })

    expect(fields).toEqual([
      { label: 'Full name', value: 'Jane Doe' },
      { label: 'CDL number', value: 'D1234567' },
      { label: 'CDL state', value: 'TX' },
      { label: 'Phone', value: '555-0200' },
    ])
  })

  it('returns empty array when driver fields are absent (PRD-3)', () => {
    expect(formatDriverReviewFields(null)).toEqual([])
    expect(formatDriverReviewFields({ companyName: 'Carrier only' })).toEqual([])
  })
})

describe('formatLoadReviewDetails', () => {
  it('formats weight, dimensions, overhang, and cargo description', () => {
    const details = formatLoadReviewDetails(
      { weight: 95000, length: 62, width: 10.5, height: 14.2 },
      {
        loadOverhangs: { frontOfRigFt: 2, frontOfTrailerFt: 1, rearFt: 5 },
      },
      { description: 'Oversized machinery' }
    )

    expect(details.weight).toBe('95,000 lbs')
    expect(details.dimensionsLine).toBe(`62' 0" × 10' 6" × 14' 2"`)
    expect(details.overhang).toBe('front rig 2 ft + trailer 1 ft / rear 5 ft')
    expect(details.cargoDescription).toBe('Oversized machinery')
    expect(details.numberOfPieces).toBeNull()
    expect(details.loadedArrangement).toBeNull()
    expect(details.moveType).toBeNull()
    expect(details.hasContent).toBe(true)
  })

  it('formats numberOfPieces, loadedArrangement, and moveType with human-readable labels', () => {
    const details = formatLoadReviewDetails(
      { weight: 80000, length: 60, width: 9.67, height: 13.5 },
      null,
      {
        numberOfPieces: 3,
        loadedArrangement: 'end-to-end',
        moveType: 'self-propelled',
      }
    )

    expect(details.numberOfPieces).toBe('3 pieces')
    expect(details.loadedArrangement).toBe('End to end')
    expect(details.moveType).toBe('Self-propelled')
    expect(details.hasContent).toBe(true)
  })

  it('omits invalid cargo subfields for older requests', () => {
    const details = formatLoadReviewDetails(
      { weight: 0, length: null, width: null, height: null },
      null,
      { numberOfPieces: 0, loadedArrangement: 'invalid', moveType: 'flying' }
    )

    expect(details.numberOfPieces).toBeNull()
    expect(details.loadedArrangement).toBeNull()
    expect(details.moveType).toBeNull()
    expect(details.hasContent).toBe(false)
  })

  it('prefers cargo.load dimensions over request envelope', () => {
    const details = formatLoadReviewDetails(
      { weight: 95000, length: 62, width: 10.5, height: 14.2 },
      null,
      {
        load: {
          weightLbs: 48000,
          lengthFt: 40,
          widthFt: 8,
          heightFt: 12,
        },
      }
    )

    expect(details.weight).toBe('48,000 lbs')
    expect(details.dimensionsLine).toBe(`40' 0" × 8' 0" × 12' 0"`)
    expect(details.hasContent).toBe(true)
  })

  it('handles missing cargo and overhang gracefully', () => {
    const details = formatLoadReviewDetails({ weight: 60000, length: 40, width: 8, height: 12 }, null, null)

    expect(details.weight).toBe('60,000 lbs')
    expect(details.overhang).toBeNull()
    expect(details.cargoDescription).toBeNull()
    expect(details.hasContent).toBe(true)
  })

  it('sets hasContent false when no meaningful load data exists', () => {
    const details = formatLoadReviewDetails({ weight: 0, length: null, width: null, height: null }, null, null)
    expect(details.hasContent).toBe(false)
  })
})