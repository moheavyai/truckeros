import { hasCarrierData } from '@/lib/member-profile'
import type {
  MemberProfile,
  MemberProfileFields,
  TeamMemberListItem,
  TeamMemberListSource,
  TeamMemberProfile,
} from '@/types/member-profile'

/** Target fields on the permit-test form that carrier/driver autofill populates. */
export type PermitCarrierDriverFormFields = {
  companyName: string
  usdotNumber: string
  mcNumber: string
  dotNumber: string
  ein: string
  carrierAddress: string
  carrierPhone: string
  carrierEmail: string
  insuranceContact: string
  driverFullName: string
  cdlNumber: string
  cdlState: string
  driverPhone: string
  driverEmail: string
  dateOfBirth: string
  emergencyContact: string
}

export const EMPTY_PERMIT_CARRIER_DRIVER_FIELDS: PermitCarrierDriverFormFields = {
  companyName: '',
  usdotNumber: '',
  mcNumber: '',
  dotNumber: '',
  ein: '',
  carrierAddress: '',
  carrierPhone: '',
  carrierEmail: '',
  insuranceContact: '',
  driverFullName: '',
  cdlNumber: '',
  cdlState: '',
  driverPhone: '',
  driverEmail: '',
  dateOfBirth: '',
  emergencyContact: '',
}

export type DriverSelectOption = {
  id: string
  label: string
  source: TeamMemberListSource
  isDefault?: boolean
}

/** Per-organization default driver for Permit Test (carrier mode). Stored in localStorage to avoid a DB migration. */
export const DEFAULT_PERMIT_DRIVER_STORAGE_KEY_PREFIX = 'truckeros_default_permit_driver_'

export function defaultPermitDriverStorageKey(organizationId: string): string {
  return `${DEFAULT_PERMIT_DRIVER_STORAGE_KEY_PREFIX}${organizationId}`
}

export function getDefaultPermitDriverKey(organizationId: string | null | undefined): string | null {
  if (typeof window === 'undefined' || !organizationId) return null
  return window.localStorage.getItem(defaultPermitDriverStorageKey(organizationId))
}

export function setDefaultPermitDriverKey(
  organizationId: string | null | undefined,
  compositeKey: string
): void {
  if (typeof window === 'undefined' || !organizationId) return
  window.localStorage.setItem(defaultPermitDriverStorageKey(organizationId), compositeKey)
}

export function clearDefaultPermitDriverKey(organizationId: string | null | undefined): void {
  if (typeof window === 'undefined' || !organizationId) return
  window.localStorage.removeItem(defaultPermitDriverStorageKey(organizationId))
}

/** Only members with the Driver role appear in the permit-test driver picker. */
export function filterDriverTeamMembers(teamMembers: TeamMemberListItem[]): TeamMemberListItem[] {
  return teamMembers.filter((member) => member.user_roles.includes('Driver'))
}

function formatDriverSelectLabel(member: TeamMemberListItem): string {
  const summary = member.driver_summary?.trim()
  if (summary && summary !== 'No driver details') {
    return `${member.display_name} — ${summary}`
  }
  return member.display_name
}

export type DriverSelectionKey = {
  id: string
  source: TeamMemberListSource
}

function trimField(value: string | null | undefined): string {
  return value?.trim() ?? ''
}

export const PERMIT_CARRIER_FIELD_KEYS = [
  'companyName',
  'usdotNumber',
  'mcNumber',
  'dotNumber',
  'ein',
  'carrierAddress',
  'carrierPhone',
  'carrierEmail',
  'insuranceContact',
] as const satisfies readonly (keyof PermitCarrierDriverFormFields)[]

export const PERMIT_DRIVER_FIELD_KEYS = [
  'driverFullName',
  'cdlNumber',
  'cdlState',
  'driverPhone',
  'driverEmail',
  'dateOfBirth',
  'emergencyContact',
] as const satisfies readonly (keyof PermitCarrierDriverFormFields)[]

export type PermitAutofillOptions = {
  /** Org carrier profile used when the selected driver row has no carrier columns. */
  carrierSource?: MemberProfileFields | null
}

function mapCarrierFieldsFromProfile(
  profile: MemberProfileFields
): Pick<PermitCarrierDriverFormFields, (typeof PERMIT_CARRIER_FIELD_KEYS)[number]> {
  const usdot = trimField(profile.usdot_number)
  const mc = trimField(profile.mc_number)

  return {
    companyName: trimField(profile.company_name),
    usdotNumber: usdot,
    mcNumber: mc,
    dotNumber: usdot,
    ein: trimField(profile.ein),
    carrierAddress: trimField(profile.carrier_address),
    carrierPhone: trimField(profile.carrier_phone),
    carrierEmail: trimField(profile.carrier_email),
    insuranceContact: trimField(profile.insurance_contact),
  }
}

function mapDriverFieldsFromProfile(
  profile: MemberProfileFields
): Pick<PermitCarrierDriverFormFields, (typeof PERMIT_DRIVER_FIELD_KEYS)[number]> {
  return {
    driverFullName: trimField(profile.driver_full_name),
    cdlNumber: trimField(profile.cdl_number),
    cdlState: trimField(profile.cdl_state),
    driverPhone: trimField(profile.driver_phone),
    driverEmail: trimField(profile.driver_email),
    dateOfBirth: trimField(profile.date_of_birth),
    emergencyContact: trimField(profile.emergency_contact),
  }
}

/**
 * Maps a member_profiles or team_member_profiles row to permit form fields.
 * USDOT maps to both usdotNumber (display) and dotNumber (agent/API).
 * When the selected row lacks carrier data, carrier fields come from carrierSource.
 */
export function memberProfileToPermitAutofill(
  profile: MemberProfileFields | null | undefined,
  options?: PermitAutofillOptions
): Partial<PermitCarrierDriverFormFields> {
  if (!profile) return {}

  const carrierProfile = hasCarrierData(profile)
    ? profile
    : options?.carrierSource && hasCarrierData(options.carrierSource)
      ? options.carrierSource
      : null

  return {
    ...(carrierProfile ? mapCarrierFieldsFromProfile(carrierProfile) : mapCarrierFieldsFromProfile({} as MemberProfileFields)),
    ...mapDriverFieldsFromProfile(profile),
  }
}

/** Prefer actor profile, then first org member row that has carrier columns. */
export function resolveOrgCarrierProfileForAutofill(
  actorProfile: MemberProfile | null,
  orgMembers: MemberProfile[]
): MemberProfileFields | null {
  if (actorProfile && hasCarrierData(actorProfile)) return actorProfile
  return orgMembers.find((row) => hasCarrierData(row)) ?? null
}

export function pickPermitCarrierDriverFields(
  fields: Partial<PermitCarrierDriverFormFields>
): PermitCarrierDriverFormFields {
  const picked = { ...EMPTY_PERMIT_CARRIER_DRIVER_FIELDS }
  for (const key of Object.keys(EMPTY_PERMIT_CARRIER_DRIVER_FIELDS) as (keyof PermitCarrierDriverFormFields)[]) {
    if (fields[key] !== undefined) picked[key] = fields[key]!
  }
  return picked
}

/**
 * Applies an autofill patch onto existing carrier/driver form values.
 * Driver fields always follow the patch; carrier fields are only overwritten when patch values are non-empty.
 */
export function mergePermitAutofillPatch(
  existing: PermitCarrierDriverFormFields,
  patch: Partial<PermitCarrierDriverFormFields>
): PermitCarrierDriverFormFields {
  const merged = { ...existing }

  for (const key of PERMIT_DRIVER_FIELD_KEYS) {
    if (key in patch) merged[key] = patch[key] ?? ''
  }

  for (const key of PERMIT_CARRIER_FIELD_KEYS) {
    const value = patch[key]
    if (value !== undefined && trimField(value) !== '') {
      merged[key] = value
    }
  }

  return merged
}

export function buildDriverSelectOptions(teamMembers: TeamMemberListItem[]): DriverSelectOption[] {
  return filterDriverTeamMembers(teamMembers).map((member) => ({
    id: member.id,
    label: formatDriverSelectLabel(member),
    source: member.source,
  }))
}

/** Puts the default driver first and prefixes its label with ★ (mirrors default rig ordering). */
export function sortDriverSelectOptionsWithDefault(
  options: DriverSelectOption[],
  defaultKey: string | null | undefined
): DriverSelectOption[] {
  if (!defaultKey) return options

  const marked = options.map((option) => {
    const isDefault = driverSelectionKey(option) === defaultKey
    return {
      ...option,
      isDefault,
      label: isDefault ? `★ ${option.label}` : option.label,
    }
  })

  const defaultIndex = marked.findIndex((option) => option.isDefault)
  if (defaultIndex <= 0) return marked

  const sorted = [...marked]
  const [defaultOption] = sorted.splice(defaultIndex, 1)
  sorted.unshift(defaultOption)
  return sorted
}

export function driverSelectionKey(selection: DriverSelectionKey): string {
  return `${selection.source}:${selection.id}`
}

export function parseDriverSelectionKey(key: string): DriverSelectionKey | null {
  if (!key) return null

  const separator = key.indexOf(':')
  if (separator <= 0) return null

  const source = key.slice(0, separator) as TeamMemberListSource
  const id = key.slice(separator + 1)

  if ((source === 'member_profile' || source === 'team_member_profile') && id) {
    return { source, id }
  }

  return null
}

/**
 * Resolves the full profile row for autofill from a driver dropdown selection.
 * In service mode, orgMembers are loaded for effectiveOrganizationId (header carrier picker).
 */
export function resolveDriverProfileForSelection(
  selection: DriverSelectionKey | null | undefined,
  orgMembers: MemberProfile[],
  roster: TeamMemberProfile[],
  actorProfile: MemberProfile | null
): MemberProfileFields | null {
  if (!selection) return null

  if (selection.source === 'member_profile') {
    const matchesSelection = (row: MemberProfile) =>
      row.id === selection.id || row.user_id === selection.id

    const fromOrg = orgMembers.find(matchesSelection)
    if (fromOrg) return fromOrg

    if (actorProfile && matchesSelection(actorProfile)) {
      return actorProfile
    }

    return null
  }

  if (selection.source === 'team_member_profile') {
    return roster.find((row) => row.id === selection.id) ?? null
  }

  return null
}

/** One-line driver summary for permit-test carrier mode: name, phone, CDL. */
export function formatDriverSummaryLine(
  fields: Pick<PermitCarrierDriverFormFields, 'driverFullName' | 'driverPhone' | 'cdlNumber' | 'cdlState'>
): string {
  const name = trimField(fields.driverFullName)
  const phone = trimField(fields.driverPhone)
  const cdlNumber = trimField(fields.cdlNumber)
  const cdlState = trimField(fields.cdlState)

  if (!name && !phone && !cdlNumber && !cdlState) return '—'

  const cdl =
    cdlNumber || cdlState
      ? `CDL ${cdlNumber || '—'}${cdlState ? ` (${cdlState})` : ''}`
      : '—'
  return `${name || '—'} — ${phone || '—'} — ${cdl}`
}

/** Extract dotNumber/mcNumber for permit agent and optimize-route API payloads. */
export function permitFormToLoadDetailsCarrierFields(
  fields: Pick<PermitCarrierDriverFormFields, 'usdotNumber' | 'mcNumber' | 'dotNumber'>
): { dotNumber?: string; mcNumber?: string } {
  const dotNumber = trimField(fields.dotNumber) || trimField(fields.usdotNumber)
  const mcNumber = trimField(fields.mcNumber)

  return {
    ...(dotNumber ? { dotNumber } : {}),
    ...(mcNumber ? { mcNumber } : {}),
  }
}