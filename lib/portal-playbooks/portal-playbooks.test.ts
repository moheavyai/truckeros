import { describe, expect, it } from 'vitest'
import {
  fieldLabelsFromPlaybook,
  fieldOrderFromPlaybook,
  getPlaybook,
  getPlaybookFieldLabel,
  listPlaybookStates,
  MO_PLAYBOOK,
  MO_PLAYBOOK_FIELD_LABELS,
  MO_PLAYBOOK_FIELD_ORDER,
  resolveStepCopyKeys,
  resolveStepTips,
  resolveStepTitle,
} from './index'
import type { PortalPlaybook } from './types'

describe('PortalPlaybook registry', () => {
  it('getPlaybook returns MO playbook and null for unmapped states', () => {
    expect(getPlaybook('MO')).toBe(MO_PLAYBOOK)
    expect(getPlaybook('mo')).toBe(MO_PLAYBOOK)
    expect(getPlaybook(' TX ')).toBeNull()
    expect(getPlaybook('NE')).toBeNull()
    expect(getPlaybook(null)).toBeNull()
    expect(getPlaybook('')).toBeNull()
  })

  it('listPlaybookStates includes MO', () => {
    expect(listPlaybookStates()).toContain('MO')
  })
})

describe('MO PortalPlaybook data (v3)', () => {
  it('has required identity + flags', () => {
    expect(MO_PLAYBOOK.stateCode).toBe('MO')
    expect(MO_PLAYBOOK.portalName).toMatch(/Carrier Express/i)
    expect(MO_PLAYBOOK.portalUrl).toMatch(/modot\.mo\.gov/i)
    expect(MO_PLAYBOOK.flags?.payLastIfMultiState).toBe(true)
    expect(MO_PLAYBOOK.flags?.supportsSingleTrip).toBe(true)
  })

  it('exposes enums used on Application (conveyance, travel, power unit, …)', () => {
    expect(MO_PLAYBOOK.enums?.conveyance).toEqual([
      'Under Own Power',
      'Towed',
      'Hauled',
      'Haul/Tow',
    ])
    expect(MO_PLAYBOOK.enums?.powerUnitType).toContain('TRUCK-TRACTOR')
    expect(MO_PLAYBOOK.enums?.travel?.some((t) => /Interstate/i.test(t))).toBe(true)
    expect(MO_PLAYBOOK.notes?.conveyance).toMatch(/Hauled/)
    expect(MO_PLAYBOOK.notes?.payLast).toMatch(/Validate other corridor states/)
    expect(MO_PLAYBOOK.notes?.feeDisplay).toMatch(/MoDOT-displayed/)
  })

  it('field order matches live Single Trip packet order', () => {
    expect(fieldOrderFromPlaybook(MO_PLAYBOOK)).toEqual([...MO_PLAYBOOK_FIELD_ORDER])
    expect(MO_PLAYBOOK_FIELD_ORDER[0]).toBe('trip_type')
    expect(MO_PLAYBOOK_FIELD_ORDER).toContain('tip_conveyance')
    expect(MO_PLAYBOOK_FIELD_ORDER).toContain('border_exit')
    expect(MO_PLAYBOOK_FIELD_ORDER.indexOf('origin')).toBeGreaterThan(
      MO_PLAYBOOK_FIELD_ORDER.indexOf('carrier_usdot')
    )
  })

  it('labels cover packet keys and aliases', () => {
    const labels = fieldLabelsFromPlaybook(MO_PLAYBOOK)
    expect(labels).toEqual(MO_PLAYBOOK_FIELD_LABELS)
    expect(getPlaybookFieldLabel(MO_PLAYBOOK, 'weight')).toBe('GVW')
    expect(getPlaybookFieldLabel(MO_PLAYBOOK, 'tractor_plate')).toBe(
      'Power Unit License Number'
    )
    expect(labels.entry_point).toBe('MO entry border')
    expect(labels.exit_point).toBe('MO exit border')
    expect(labels.vehicle_id).toBe('Power unit ID / VIN')
  })

  it('steps follow Trip → Review → Payment path with pay-last multi-state titles', () => {
    const ids = MO_PLAYBOOK.steps.map((s) => s.id)
    expect(ids).toEqual([
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
    const trip = MO_PLAYBOOK.steps.find((s) => s.id === 'trip_tab')!
    expect(resolveStepTitle(trip, false)).not.toMatch(/borders/)
    expect(resolveStepTitle(trip, true)).toMatch(/borders/)
    expect(resolveStepCopyKeys(trip, false)).toEqual([
      'origin',
      'destination',
      'route',
      'highways',
    ])
    expect(resolveStepCopyKeys(trip, true)).toEqual([
      'origin',
      'destination',
      'route',
      'highways',
      'border_entry',
      'border_exit',
    ])
    const pay = MO_PLAYBOOK.steps.find((s) => s.id === 'payment')!
    expect(resolveStepTitle(pay, true)).toMatch(/pay-last/i)
    const multiTips = resolveStepTips(pay, true)
    expect(multiTips.join(' ')).toMatch(/Validate other corridor states/)
    expect(multiTips.join(' ')).toMatch(/MoDOT-displayed/)
    const singleTips = resolveStepTips(pay, false)
    expect(singleTips.join(' ')).not.toMatch(/Validate other corridor states/)
  })

  it('application + payment key groups are non-empty subsets of field inventory', () => {
    const keys = new Set(MO_PLAYBOOK.fields.map((f) => f.key))
    expect(MO_PLAYBOOK.applicationKeys?.length).toBeGreaterThan(10)
    expect(MO_PLAYBOOK.paymentKeys).toContain('contact_name')
    for (const k of MO_PLAYBOOK.applicationKeys || []) {
      expect(keys.has(k) || MO_PLAYBOOK_FIELD_ORDER.includes(k)).toBe(true)
    }
  })

  it('resolveStepTips for trip_tab swaps multi-state border/Keypoint tip', () => {
    const trip = MO_PLAYBOOK.steps.find((s) => s.id === 'trip_tab')!
    const multiTips = resolveStepTips(trip, true)
    const singleTips = resolveStepTips(trip, false)
    expect(multiTips.join(' ')).toMatch(/Keypoint|border/i)
    expect(multiTips.join(' ')).toMatch(/borders/i)
    expect(singleTips.join(' ')).toMatch(/if needed/i)
    expect(singleTips.join(' ')).not.toMatch(/for MO borders/i)
    expect(multiTips).toContain('Optional Keypoint/map for MO borders')
    expect(singleTips).toContain('Optional Keypoint/map if needed')
  })

  it('every MO_PLAYBOOK_FIELD_ORDER key exists in MO_PLAYBOOK.fields', () => {
    const fieldKeys = new Set(MO_PLAYBOOK.fields.map((f) => f.key))
    for (const key of MO_PLAYBOOK_FIELD_ORDER) {
      expect(fieldKeys.has(key)).toBe(true)
    }
  })

  it('field enumOptions match MO_PLAYBOOK.enums for tip/power unit selects', () => {
    const byKey = Object.fromEntries(MO_PLAYBOOK.fields.map((f) => [f.key, f]))
    const pairs: Array<{ key: string; enumKey: keyof NonNullable<typeof MO_PLAYBOOK.enums> }> = [
      { key: 'tip_conveyance', enumKey: 'conveyance' },
      { key: 'tip_travel', enumKey: 'travel' },
      { key: 'tip_vehicle_type', enumKey: 'vehicleType' },
      { key: 'power_unit_type', enumKey: 'powerUnitType' },
    ]
    for (const { key, enumKey } of pairs) {
      const fieldOpts = byKey[key]?.enumOptions
      const enumOpts = MO_PLAYBOOK.enums?.[enumKey]
      expect(fieldOpts).toBeDefined()
      expect(enumOpts).toBeDefined()
      expect([...fieldOpts!]).toEqual([...enumOpts!])
    }
  })
})

describe('fieldOrderFromPlaybook (generic non-MO)', () => {
  it('composes application+trip+payment keys with dedupe on overlap', () => {
    const fixture: PortalPlaybook = {
      stateCode: 'XX',
      portalName: 'Test Portal',
      portalUrl: 'https://example.test',
      steps: [],
      fields: [
        { key: 'a', label: 'A' },
        { key: 'b', label: 'B' },
        { key: 'c', label: 'C' },
        { key: 'd', label: 'D' },
      ],
      applicationKeys: ['a', 'b', 'shared'],
      tripKeys: ['shared', 'c'],
      paymentKeys: ['shared', 'd'],
    }
    expect(fieldOrderFromPlaybook(fixture)).toEqual(['a', 'b', 'shared', 'c', 'd'])
  })

  it('falls back to fields.map(key) when key groups are empty', () => {
    const fixture: PortalPlaybook = {
      stateCode: 'YY',
      portalName: 'Empty Groups Portal',
      portalUrl: 'https://example.test/yy',
      steps: [],
      fields: [
        { key: 'first', label: 'First' },
        { key: 'second', label: 'Second' },
        { key: 'third', label: 'Third' },
      ],
    }
    expect(fieldOrderFromPlaybook(fixture)).toEqual(['first', 'second', 'third'])
  })
})
