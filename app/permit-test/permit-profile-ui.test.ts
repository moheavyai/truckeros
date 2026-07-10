/**
 * Permit profile UI tests use static source inspection (same accepted limitation as profile-ui.test.ts).
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'

const permitPagePath = path.join(process.cwd(), 'app', 'permit-test', 'page.tsx')
const autofillLibPath = path.join(process.cwd(), 'lib', 'permit-profile-autofill.ts')

function readPermitPageSource() {
  return readFileSync(permitPagePath, 'utf8')
}

function readAutofillLibSource() {
  return readFileSync(autofillLibPath, 'utf8')
}

function carrierDriverSectionSlice(source: string) {
  const start = source.indexOf('Permit driver & carrier')
  const end = source.indexOf('Primary rig — auto-loaded', start)
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  return source.slice(start, end)
}

function validateFormSlice(source: string) {
  const start = source.indexOf('function validateForm(data: any = formData): boolean {')
  const end = source.indexOf('function validateFormWithData', start)
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  return source.slice(start, end)
}

function analyzePayloadSlice(source: string) {
  const start = source.indexOf('const analyzePayload = {')
  const end = source.indexOf("setRouteProgressDetail('Running OR-Tools", start)
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  return source.slice(start, end)
}

function changePayloadSlice(source: string) {
  const start = source.indexOf('const changePayload = {')
  const end = source.indexOf("fetch('/api/optimize-route'", start)
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  return source.slice(start, end)
}

function analyzePermitFetchSlice(source: string) {
  const start = source.indexOf("fetch('/api/analyze-permit'")
  const end = source.indexOf('const newAgentData = await response.json()', start)
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  return source.slice(start, end)
}

function handleDriverSelectSlice(source: string) {
  const start = source.indexOf('const handleDriverSelect = (compositeKey: string) => {')
  const end = source.indexOf('const handleSetDefaultDriver = () => {', start)
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  return source.slice(start, end)
}

function handleSetDefaultDriverSlice(source: string) {
  const start = source.indexOf('const handleSetDefaultDriver = () => {')
  const end = source.indexOf('const showDriverPickerUi =', start)
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  return source.slice(start, end)
}

describe('Permit test page — member profile autofill UI', () => {
  it('imports permit-profile-autofill helpers and organization context', () => {
    const source = readPermitPageSource()

    expect(source).toContain("from '@/lib/permit-profile-autofill'")
    expect(source).toContain('buildDriverSelectOptions')
    expect(source).toContain('sortDriverSelectOptionsWithDefault')
    expect(source).toContain('getDefaultPermitDriverKey')
    expect(source).toContain('setDefaultPermitDriverKey')
    expect(source).toContain('clearDefaultPermitDriverKey')
    expect(source).toContain('formatDriverSummaryLine')
    expect(source).toContain('memberProfileToPermitAutofill')
    expect(source).toContain('resolveDriverProfileForSelection')
    expect(source).toContain('permitFormToLoadDetailsCarrierFields')
    expect(source).toContain("from '@/lib/organization-context'")
    expect(source).toContain('useOrganizationContext')
    expect(source).toContain('effectiveOrganizationId')
    expect(source).toContain("from '@/lib/service-mode-scope'")
    expect(source).toContain('resolvePermitOrganizationId')
    expect(source).toContain('resolveEquipmentScope')
    expect(source).toContain("from '@/components/CarrierContextBar'")
    expect(source).toContain('<CarrierContextBar')
  })

  it('loads team roster data scoped by effectiveOrganizationId in service mode', () => {
    const source = readPermitPageSource()

    expect(source).toContain('buildTeamMemberList')
    expect(source).toContain('buildOrganizationTeamMemberList')
    expect(source).toContain("from('member_profiles')")
    expect(source).toContain("from('team_member_profiles')")
    expect(source).toContain('loadPermitTeamData')
    expect(source).toContain('permitOrganizationId')
    expect(source).toContain("workspaceMode === 'service' && scopedOrganizationId")
  })

  it('shows rig-style Select Driver in carrier and service mode with autofill handler', () => {
    const source = readPermitPageSource()
    const section = carrierDriverSectionSlice(source)

    expect(section).toContain('Driver for this load')
    expect(section).toContain('carrier details are applied automatically')
    expect(section).toContain('Select Driver')
    expect(section).toContain('Change Driver')
    expect(section).toContain('showDriverPicker')
    expect(section).toContain('setShowDriverPicker')
    expect(section).toContain('loadingDrivers')
    expect(section).toContain('Loading drivers…')
    expect(section).toContain('formatDriverSummaryLine')
    expect(section).toContain('pickPermitCarrierDriverFields(formData)')
    expect(section).toContain('showDriverPickerUi')
    expect(section).toContain('handleDriverSelect')
    expect(section).toContain('No driver selected')
    expect(section).toContain('Set as Default')
    expect(section).toContain('handleSetDefaultDriver')
    expect(section).toContain('defaultDriverKey')
    expect(section).toContain('★')
    expect(section).toMatch(/selectedDriverKey\s*\?\s*\(/)
    expect(section).toContain('driverSelectionKey(option)')
    expect(section).toContain('workspace bar above')
    expect(source).toMatch(/handleDriverSelect[\s\S]*memberProfileToPermitAutofill/)
    expect(source).toMatch(/handleDriverSelect[\s\S]*mergePermitAutofillPatch/)
    expect(source).toMatch(/handleDriverSelect[\s\S]*resolveOrgCarrierProfileForAutofill/)
  })

  it('does not expose manual carrier/driver form grid in service mode', () => {
    const source = readPermitPageSource()
    const section = carrierDriverSectionSlice(source)

    expect(section).not.toContain('Enter carrier and driver details manually')
    expect(section).not.toContain('Company Name')
    expect(section).not.toContain('Emergency Contact')
    expect(section).not.toContain('Date of Birth')
  })

  it('keeps page flow order: driver selector, then rig, then load details', () => {
    const source = readPermitPageSource()

    const driverIdx = source.indexOf('permit-select-driver')
    const rigIdx = source.indexOf('Change Rig')
    const loadIdx = source.indexOf('Load Details (Cargo, Axle Weights, Overhangs)')

    expect(driverIdx).toBeGreaterThan(-1)
    expect(rigIdx).toBeGreaterThan(driverIdx)
    expect(loadIdx).toBeGreaterThan(rigIdx)
  })

  it('resets carrier/driver fields when driver selection is cleared', () => {
    const handler = handleDriverSelectSlice(readPermitPageSource())

    expect(handler).toContain('if (!compositeKey)')
    expect(handler).toContain("setSelectedDriverKey('')")
    expect(handler).toContain('EMPTY_PERMIT_CARRIER_DRIVER_FIELDS')
    expect(handler).toContain('setShowDriverPicker(false)')
  })

  it('requires selectedDriverKey when driver picker is shown during validateForm', () => {
    const validateForm = validateFormSlice(readPermitPageSource())

    expect(validateForm).toContain('showDriverPickerUi')
    expect(validateForm).toContain('!selectedDriverKey')
    expect(validateForm).toContain("newErrors['driver']")
    expect(validateForm).toContain('Please select a driver')
    expect(validateForm).toContain("newErrors['carrier']")
    expect(validateForm).toContain('workspace bar')
  })

  it('clears stale driver selection after roster reload and on workspace/carrier scope change', () => {
    const source = readPermitPageSource()

    expect(source).toContain('driverSelectionKey(option) === selectedDriverKey')
    expect(source).toContain('autoSelectDriverDoneRef.current = false')
    expect(source).toContain('setLoadingDrivers(true)')
    expect(source).toContain('setLoadingDrivers(false)')
    expect(source).toMatch(
      /useEffect\(\(\) => \{[\s\S]*setSelectedDriverKey\(''\)[\s\S]*EMPTY_PERMIT_CARRIER_DRIVER_FIELDS[\s\S]*\}, \[workspaceMode, effectiveOrganizationId\]\)/
    )
    expect(source).toMatch(
      /Reconcile stored default[\s\S]*clearDefaultPermitDriverKey\(permitOrganizationId\)[\s\S]*setDefaultDriverKey\(null\)/
    )
  })

  it('persists default driver via handleSetDefaultDriver using permitOrganizationId', () => {
    const handler = handleSetDefaultDriverSlice(readPermitPageSource())

    expect(handler).toContain('if (!selectedDriverKey || !permitOrganizationId) return')
    expect(handler).toContain('setDefaultPermitDriverKey(permitOrganizationId, selectedDriverKey)')
    expect(handler).toContain('setDefaultDriverKey(selectedDriverKey)')
  })

  it('auto-selects default driver on load when driver picker is shown', () => {
    const source = readPermitPageSource()

    expect(source).toContain('autoSelectDriverDoneRef')
    expect(source).toContain('showDriverPickerUi')
    expect(source).toMatch(
      /useEffect\(\(\) => \{[\s\S]*showDriverPickerUi[\s\S]*getDefaultPermitDriverKey\(permitOrganizationId\)[\s\S]*handleDriverSelect\(keyToSelect\)[\s\S]*\}, \[[\s\S]*permitOrganizationId[\s\S]*\]\)/
    )
  })

  it('scopes equipment and rig loads by organization in service mode', () => {
    const source = readPermitPageSource()

    expect(source).toContain('fetchCarrierPrimaryOwnerUserId')
    expect(source).toContain("query.eq('organization_id', scope.organizationId)")
    expect(source).toContain("eq('user_id', scope.rigOwnerUserId)")
    expect(source).toContain('scope.canLoadRigs')
    expect(source).toContain('scope.canLoadEquipment')
    expect(source).toContain('carrierPrimaryOwnerUserId')
    expect(source).toContain('carrierPrimaryOwnerError')
    expect(source).toContain('loadingPrimaryOwner')
  })

  it('clears rig and profile selection on workspace or carrier scope change', () => {
    const source = readPermitPageSource()

    expect(source).toMatch(
      /useEffect\(\(\) => \{[\s\S]*setSelectedRigId\(null\)[\s\S]*setSelectedProfileId\(null\)[\s\S]*autoSelectRigDoneRef\.current = false[\s\S]*\}, \[effectiveOrganizationId, workspaceMode\]\)/
    )
    expect(source).toContain("workspaceMode === 'service' && !scopedOrganizationId")
    expect(source).toContain('setTeamMembers([])')
  })

  it('adds Carriers and Equipment nav links and organizationId to permit cargo snapshot in service mode', () => {
    const source = readPermitPageSource()

    expect(source).toContain("workspaceMode === 'service'")
    expect(source).toContain('href="/carriers"')
    expect(source).toContain('href="/equipment"')
    expect(source).toContain('organizationId: permitOrganizationId')
    expect(source).toContain('migration 024/025')
  })

  it('resets autoSelectRigDoneRef when primary owner resolves', () => {
    const source = readPermitPageSource()

    expect(source).toMatch(
      /fetchCarrierPrimaryOwnerUserId[\s\S]*if \(result\.userId\) \{[\s\S]*autoSelectRigDoneRef\.current = false/
    )
  })

  it('shows service-mode empty rig copy without equipment edit link', () => {
    const source = readPermitPageSource()

    expect(source).toContain('No saved rig for this carrier.')
    expect(source).toMatch(/workspaceMode === 'service'[\s\S]*No saved rig for this carrier\./)
  })

  it('passes dotNumber and mcNumber through route analysis payloads', () => {
    const source = readPermitPageSource()

    expect(analyzePayloadSlice(source)).toContain('permitFormToLoadDetailsCarrierFields(currentData)')
    expect(changePayloadSlice(source)).toContain('permitFormToLoadDetailsCarrierFields(formData)')
    expect(analyzePermitFetchSlice(source)).toContain('permitFormToLoadDetailsCarrierFields(formData)')
    expect(analyzePermitFetchSlice(source)).not.toContain('carrierDriver')
  })

  it('includes carrier/driver snapshot when saving permit requests', () => {
    const source = readPermitPageSource()

    expect(source).toContain('buildPermitCargoSnapshot')
    expect(source).toContain("from '@/lib/permit-cargo-snapshot'")
    expect(source).toContain('cargo: buildPermitCargoSnapshot')
    expect(source).toContain('selectedDriverKey')
    expect(source).toContain('organizationId: permitOrganizationId')
  })
})

describe('Permit test page — routing envelope form string→number coercion', () => {
  const coercedFields = [
    'trailerWidthFt: Number(formData.trailerWidthFt) || 0',
    'loadWidthFt: Number(formData.loadWidthFt) || 0',
    'deckHeightFt: Number(formData.trailerDeckHeightFt) || 0',
    'loadHeightFt: Number(formData.loadHeightFt) || 0',
    'loadWeightLbs: Number(formData.loadWeightLbs) || 0',
  ] as const

  function computeRoutingEnvelopeCallSlices(source: string): string[] {
    const slices: string[] = []
    let searchFrom = 0
    while (true) {
      const start = source.indexOf('const envelope = computeRoutingEnvelope({', searchFrom)
      if (start === -1) break
      const end = source.indexOf('})', start)
      expect(end).toBeGreaterThan(start)
      slices.push(source.slice(start, end + 2))
      searchFrom = start + 1
    }
    return slices
  }

  it('coerces string form fields with Number(...) || 0 at both computeRoutingEnvelope call sites', () => {
    const source = readPermitPageSource()
    const slices = computeRoutingEnvelopeCallSlices(source)

    // Envelope useEffect + formatRigSummaryLine
    expect(slices).toHaveLength(2)
    expect(source).toContain('function formatRigSummaryLine()')

    for (const slice of slices) {
      for (const field of coercedFields) {
        expect(slice).toContain(field)
      }
      // Must not pass raw string form fields into the number-typed envelope input
      expect(slice).not.toContain('trailerWidthFt: formData.trailerWidthFt,')
      expect(slice).not.toContain('loadWidthFt: formData.loadWidthFt,')
      expect(slice).not.toContain('deckHeightFt: formData.trailerDeckHeightFt,')
      expect(slice).not.toContain('loadHeightFt: formData.loadHeightFt,')
      expect(slice).not.toContain('loadWeightLbs: formData.loadWeightLbs,')
    }
  })
})

describe('permit-profile-autofill lib — service mode', () => {
  it('documents effectiveOrganizationId driver filtering via org-scoped roster loads', () => {
    const source = readAutofillLibSource()

    expect(source).not.toContain('SERVICE_MODE_TODO')
    expect(source).toContain('effectiveOrganizationId')
    expect(source).toContain('header carrier picker')
  })

  it('filters driver picker to Driver role and stores default per organization in localStorage', () => {
    const source = readAutofillLibSource()

    expect(source).toContain('filterDriverTeamMembers')
    expect(source).toContain("member.user_roles.includes('Driver')")
    expect(source).toContain('DEFAULT_PERMIT_DRIVER_STORAGE_KEY_PREFIX')
    expect(source).toContain('getDefaultPermitDriverKey')
    expect(source).toContain('setDefaultPermitDriverKey')
    expect(source).toContain('clearDefaultPermitDriverKey')
    expect(source).toContain('sortDriverSelectOptionsWithDefault')
  })
})