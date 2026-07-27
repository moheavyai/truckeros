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
})
