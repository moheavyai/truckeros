import { isForcedCarrierOwner } from '@/lib/forced-carrier-owner'
import { normalizeLicensePlateState } from '@/lib/us-states'
import {
  ASSIGNABLE_TEAM_ROLES,
  LEGACY_OWNER_ADMIN_ROLE,
  PRIMARY_OWNER_ROLE,
  USER_ROLE_OPTIONS,
  type MemberProfile,
  type MemberProfileFormData,
  type TeamMemberProfile,
  type UserRole,
} from '@/types/member-profile'

export const CARRIER_FIELD_KEYS = [
  'company_name',
  'usdot_number',
  'mc_number',
  'ein',
  'carrier_address',
  'carrier_phone',
  'carrier_email',
  'insurance_contact',
] as const satisfies readonly (keyof MemberProfileFormData)[]

export type CarrierFieldKey = (typeof CARRIER_FIELD_KEYS)[number]

export type CarrierSummarySource = Pick<MemberProfileFormData, CarrierFieldKey>

export const CARRIER_SUMMARY_LABELS: { key: CarrierFieldKey; label: string }[] = [
  { key: 'company_name', label: 'Company Name' },
  { key: 'usdot_number', label: 'USDOT#' },
  { key: 'mc_number', label: 'MC#' },
  { key: 'ein', label: 'EIN' },
  { key: 'carrier_address', label: 'Address' },
  { key: 'carrier_phone', label: 'Phone' },
  { key: 'carrier_email', label: 'Email' },
  { key: 'insurance_contact', label: 'Insurance Contact' },
]

const TEXT_FIELDS: (keyof MemberProfileFormData)[] = [
  ...CARRIER_FIELD_KEYS,
  'driver_full_name',
  'cdl_number',
  'driver_phone',
  'driver_email',
  'emergency_contact',
]

export function hasCarrierData(source: CarrierSummarySource | null | undefined): boolean {
  if (!source) return false
  return CARRIER_FIELD_KEYS.some((key) => {
    const value = source[key]
    return typeof value === 'string' && value.trim().length > 0
  })
}

export function formatCarrierSummaryDisplay(
  source: CarrierSummarySource | null | undefined
): { label: string; value: string }[] {
  return CARRIER_SUMMARY_LABELS.map(({ key, label }) => {
    const raw = source?.[key]
    const trimmed = typeof raw === 'string' ? raw.trim() : ''
    return { label, value: trimmed.length > 0 ? trimmed : '—' }
  })
}

export function formatCarrierNameSummary(source: CarrierSummarySource | null | undefined): string {
  const name = source?.company_name
  const trimmed = typeof name === 'string' ? name.trim() : ''
  return trimmed.length > 0 ? trimmed : '—'
}

export type ProfileEditingTarget =
  | { kind: 'self' }
  | { kind: 'member_profile'; id: string; userId: string }
  | { kind: 'team_member_profile'; id: string | null }

export function carrierFieldsDiffer(
  form: MemberProfileFormData,
  profile: MemberProfile | null | undefined
): boolean {
  if (!profile) return true
  const snapshot = memberProfileFromRow(profile)
  return CARRIER_FIELD_KEYS.some((key) => (form[key] as string) !== (snapshot[key] as string))
}

export function resolveCarrierDataSource(
  editingTarget: ProfileEditingTarget,
  form: MemberProfileFormData,
  ownProfile: MemberProfile | null | undefined,
  carrierFormExpanded: boolean
): CarrierSummarySource {
  if (editingTarget.kind !== 'self') {
    return memberProfileFromRow(ownProfile)
  }

  if (carrierFormExpanded || carrierFieldsDiffer(form, ownProfile)) {
    return form
  }

  return memberProfileFromRow(ownProfile)
}

export function resetCarrierFieldsInForm(
  form: MemberProfileFormData,
  ownProfile: MemberProfile | null | undefined
): MemberProfileFormData {
  const snapshot = memberProfileFromRow(ownProfile)
  const next = { ...form }
  for (const key of CARRIER_FIELD_KEYS) {
    next[key] = snapshot[key] as string
  }
  return next
}

export function buildCarrierOnlySavePayload(
  form: MemberProfileFormData,
  existing: MemberProfile | null | undefined
): MemberProfileFormData {
  const base = memberProfileFromRow(existing)
  const merged = { ...base }
  for (const key of CARRIER_FIELD_KEYS) {
    merged[key] = form[key] as string
  }
  if (!existing || !existing.organization_id) {
    merged.user_roles = validateUserRoles(form.user_roles as string[])
  }
  return merged
}

export type CarrierOnlyApiSavePayload = MemberProfileFormData & {
  organization_id?: string
}

/**
 * API payload for carrier-only saves. When an existing profile has organization_id,
 * it is resolved via prepareMemberProfileSave (same path as the server upsert).
 * organization_id in the POST body is logging/traceability only — parseMemberProfileForm
 * does not read it; the server derives org from the DB actor profile.
 */
/** Assigns primary Owner role on first carrier bootstrap (Owner-only or Owner Operator). */
export function ensureBootstrapOwnerRoles(form: MemberProfileFormData): MemberProfileFormData {
  const roles = validateUserRoles(form.user_roles as string[] | undefined)
  const wantsDriver = roles.includes('Driver')
  return {
    ...form,
    user_roles: wantsDriver ? (['Owner', 'Driver'] as UserRole[]) : ['Owner'],
  }
}

/** @deprecated Use ensureBootstrapOwnerRoles */
export function ensureBootstrapOwnerAdminRoles(form: MemberProfileFormData): MemberProfileFormData {
  return ensureBootstrapOwnerRoles(form)
}

export function buildCarrierOnlyApiSavePayload(
  form: MemberProfileFormData,
  existing: MemberProfile | null | undefined,
  actorEmail?: string | null
): CarrierOnlyApiSavePayload {
  const merged = buildCarrierOnlySavePayload(form, existing)
  const formForSave =
    !existing?.organization_id || isForcedCarrierOwner(actorEmail)
      ? ensureBootstrapOwnerRoles(merged)
      : merged
  const payload: CarrierOnlyApiSavePayload = { ...formForSave }
  const prepared = prepareMemberProfileSave(
    formForSave,
    existing?.user_id ?? 'client-logging',
    existing,
    actorEmail
  )
  if (typeof prepared.organization_id === 'string') {
    payload.organization_id = prepared.organization_id
  }
  return payload
}

export function hasOwnerOrAdminRole(roles: string[] | null | undefined): boolean {
  const validated = validateUserRoles(roles)
  return validated.includes('Owner') || validated.includes('Admin')
}

/** @deprecated Use hasOwnerOrAdminRole */
export function hasOwnerAdminRole(roles: string[] | null | undefined): boolean {
  return hasOwnerOrAdminRole(roles)
}

/** Whether the actor may save carrier-only scope (UI gate and client handler). */
export function canSaveCarrierInfo(
  profile:
    | Pick<MemberProfile, 'is_primary_owner' | 'organization_id' | 'user_roles'>
    | null
    | undefined,
  form: Pick<MemberProfileFormData, 'user_roles'>,
  actorEmail?: string | null
): boolean {
  if (isForcedCarrierOwner(actorEmail)) return true
  if (!profile) return true
  if (profile.is_primary_owner === true) return true
  if (hasOwnerOrAdminRole(profile.user_roles as string[] | undefined)) return true
  if (!profile.organization_id && hasOwnerOrAdminRole(form.user_roles as string[] | undefined)) {
    return true
  }
  return false
}

export function validateBootstrapCarrierSaveRoles(
  form: MemberProfileFormData,
  existing: MemberProfile | null | undefined,
  actorEmail?: string | null
): { ok: true } | { ok: false; message: string } {
  if (isForcedCarrierOwner(actorEmail)) return { ok: true }
  if (existing?.organization_id || existing?.is_primary_owner) return { ok: true }
  const formWithRoles = ensureBootstrapOwnerRoles(form)
  if (hasOwnerOrAdminRole(formWithRoles.user_roles as string[] | undefined)) return { ok: true }
  return {
    ok: false,
    message: 'Setup could not assign Owner automatically. Please refresh and try again.',
  }
}

export const CARRIER_SAVE_FORBIDDEN_MESSAGE =
  'Only organization owners and admins can save carrier information.'

export const USER_ROLES_HELPER_BOOTSTRAP =
  'You are being set up as Owner for your carrier organization.'
export const USER_ROLES_HELPER_MANAGED_BY_OWNER = 'Roles are managed by your organization owner.'
export const USER_ROLES_HELPER_LANDING_READONLY = 'Your assigned roles.'
export const USER_ROLES_SAVE_WITH_PROFILE_HINT = 'Role changes save with Save Profile.'

export function logCarrierSaveDebug(event: string, data: Record<string, unknown>): void {
  if (process.env.NODE_ENV !== 'development') return
  console.log(`[carrier-save] ${event}`, data)
}

export function logCarrierSaveWarn(event: string, error: unknown): void {
  if (process.env.NODE_ENV !== 'development') return
  console.warn(`[carrier-save] ${event}`, error)
}

export function isAnySaveInFlight(savingCarrier: boolean, savingProfile: boolean): boolean {
  return savingCarrier || savingProfile
}

export function resolvePersistedRosterId(
  priorRosterId: string | null,
  savedRosterId?: string | null
): string | null {
  return savedRosterId ?? priorRosterId
}

export function shouldShowBootstrapProfilePrompt(
  profile: Pick<MemberProfile, 'is_primary_owner' | 'driver_full_name' | 'company_name'> | null | undefined
): boolean {
  if (!profile?.is_primary_owner) return false
  if (!hasCarrierData(profile)) return false
  return !(profile.driver_full_name?.trim())
}

export function buildMemberProfileSavePayloadWithoutCarrier(
  form: MemberProfileFormData,
  existing: MemberProfile | null | undefined
): MemberProfileFormData {
  const base = memberProfileFromRow(existing)
  const merged = { ...form }
  for (const key of CARRIER_FIELD_KEYS) {
    merged[key] = base[key] as string
  }
  return merged
}

export function buildSelfMemberSavePayload(
  form: MemberProfileFormData,
  ownProfile: MemberProfile | null | undefined,
  options: { excludeCarrier: boolean }
): MemberProfileFormData {
  if (!options.excludeCarrier) return form
  return buildMemberProfileSavePayloadWithoutCarrier(form, ownProfile)
}

export function shouldUseCarrierSummaryMode(
  editingTarget: ProfileEditingTarget,
  carrierDataSource: CarrierSummarySource | null | undefined
): boolean {
  if (editingTarget.kind !== 'self') return false
  return hasCarrierData(carrierDataSource)
}

export type OrganizationMembershipLink = {
  organization_id: string
  role?: string | null
  is_primary_owner?: boolean | null
}

export function hasExistingTeamMembership(options: {
  linkedRoster?: TeamMemberProfile | null
  organizationMembership?: OrganizationMembershipLink | null
}): boolean {
  return Boolean(
    options.linkedRoster?.organization_id || options.organizationMembership?.organization_id
  )
}

/**
 * True only for first-time primary owner setup — not for team members lacking a member_profiles row.
 */
export function needsPrimaryOwnerBootstrap(options: {
  actorEmail?: string | null
  ownProfile: MemberProfile | null | undefined
  linkedRoster?: TeamMemberProfile | null
  organizationMembership?: OrganizationMembershipLink | null
}): boolean {
  if (hasExistingTeamMembership(options)) return false
  if (options.ownProfile?.organization_id) return false
  if (options.ownProfile?.is_primary_owner) return false
  if (isForcedCarrierOwner(options.actorEmail) && !options.ownProfile?.organization_id) {
    return true
  }
  return !options.ownProfile
}

/** Hydrate a member profile view from a roster row for UI/permission checks (no DB row yet). */
export function memberProfileFromLinkedRoster(
  roster: TeamMemberProfile,
  userId: string
): MemberProfile {
  const form = teamMemberProfileFromRow(roster)
  return {
    ...form,
    user_id: userId,
    organization_id: roster.organization_id,
    is_primary_owner: false,
  }
}

export function resolveActorProfile(
  ownProfile: MemberProfile | null | undefined,
  linkedRoster: TeamMemberProfile | null | undefined,
  userId: string,
  organizationMembership?: OrganizationMembershipLink | null
): MemberProfile | null {
  if (ownProfile) return ownProfile
  if (linkedRoster) return memberProfileFromLinkedRoster(linkedRoster, userId)
  if (organizationMembership?.organization_id) {
    const role = organizationMembership.role?.trim()
    return {
      user_id: userId,
      organization_id: organizationMembership.organization_id,
      user_roles: role ? validateUserRoles([role]) : [],
      is_primary_owner: false,
    }
  }
  return null
}

export function resolveSelfSaveOrganizationId(
  actorProfile: MemberProfile | null | undefined,
  linkedRoster?: TeamMemberProfile | null,
  organizationMembership?: OrganizationMembershipLink | null
): string | null {
  return (
    actorProfile?.organization_id ??
    linkedRoster?.organization_id ??
    organizationMembership?.organization_id ??
    null
  )
}

/** Clamp client-submitted roles to roster/membership when joining an existing org (non-bootstrap). */
export function clampSelfSaveRolesFromTeamContext(
  form: MemberProfileFormData,
  linkedRoster?: TeamMemberProfile | null,
  organizationMembership?: OrganizationMembershipLink | null
): MemberProfileFormData {
  const roles = linkedRoster
    ? validateUserRoles(linkedRoster.user_roles as string[] | undefined)
    : organizationMembership?.role
      ? validateUserRoles([organizationMembership.role])
      : []
  if (!roles.length) return form
  const withoutOwner = roles.filter((role) => role !== PRIMARY_OWNER_ROLE)
  const clamped = withoutOwner.length > 0 ? withoutOwner : roles
  return { ...form, user_roles: clamped }
}

export function shouldShowOwnerBootstrapSetupCard(
  editingTarget: ProfileEditingTarget,
  isProfileBootstrap: boolean
): boolean {
  return isProfileBootstrap && editingTarget.kind === 'self'
}

export function isOwnerOperatorSelected(userRoles: string[] | null | undefined): boolean {
  const roles = validateUserRoles(userRoles)
  return roles.includes(PRIMARY_OWNER_ROLE) && roles.includes('Driver')
}

/** Toggles Driver role while keeping bootstrap Owner; unchecked is Owner-only. */
export function applyOwnerOperatorRoles(
  form: MemberProfileFormData,
  checked: boolean
): MemberProfileFormData {
  const withOwner = ensureBootstrapOwnerRoles(form)
  const roles = validateUserRoles(withOwner.user_roles as string[])
  const withoutDriver = roles.filter((role) => role !== 'Driver')
  return {
    ...withOwner,
    user_roles: checked ? [...withoutDriver, 'Driver'] : withoutDriver,
  }
}

export const BOOTSTRAP_MAX_EMAIL_LENGTH = 254
export const BOOTSTRAP_MAX_PHONE_LENGTH = 30
export const BOOTSTRAP_MAX_NAME_LENGTH = 120
export const BOOTSTRAP_MAX_COMPANY_NAME_LENGTH = 200

const BOOTSTRAP_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Mirrors personal email to carrier email when carrier email is empty. */
export function prepareBootstrapFormForSave(form: MemberProfileFormData): MemberProfileFormData {
  const withRoles = ensureBootstrapOwnerRoles(form)
  const personalEmail = (withRoles.driver_email as string)?.trim() ?? ''
  const carrierEmail = (withRoles.carrier_email as string)?.trim() ?? ''
  return {
    ...withRoles,
    carrier_email: carrierEmail || personalEmail,
  }
}

/**
 * Server-side bootstrap role clamp: Owner only, or Owner+Driver when Driver was requested.
 * Also mirrors personal email to carrier email when carrier email is blank.
 */
export function normalizeBootstrapSelfRoles(
  form: MemberProfileFormData,
  existing: MemberProfile | null | undefined
): MemberProfileFormData {
  if (existing?.organization_id) return form
  const prepared = prepareBootstrapFormForSave(form)
  const roles = validateUserRoles(prepared.user_roles as string[])
  const wantsDriver = roles.includes('Driver')
  return {
    ...prepared,
    user_roles: wantsDriver ? (['Owner', 'Driver'] as UserRole[]) : ['Owner'],
  }
}

export function validateBootstrapEmail(
  email: string | null | undefined
): { ok: true; value: string } | { ok: false; message: string } {
  const trimmed = (email ?? '').trim()
  if (!trimmed) return { ok: false, message: 'Email is required.' }
  if (trimmed.length > BOOTSTRAP_MAX_EMAIL_LENGTH) {
    return { ok: false, message: `Email must be ${BOOTSTRAP_MAX_EMAIL_LENGTH} characters or fewer.` }
  }
  if (!BOOTSTRAP_EMAIL_PATTERN.test(trimmed)) {
    return { ok: false, message: 'Enter a valid email address.' }
  }
  return { ok: true, value: trimmed }
}

export function validateBootstrapOptionalPhone(
  phone: string | null | undefined,
  label: string
): { ok: true; value: string } | { ok: false; message: string } {
  const trimmed = (phone ?? '').trim()
  if (!trimmed) return { ok: true, value: '' }
  if (trimmed.length > BOOTSTRAP_MAX_PHONE_LENGTH) {
    return { ok: false, message: `${label} must be ${BOOTSTRAP_MAX_PHONE_LENGTH} characters or fewer.` }
  }
  return { ok: true, value: trimmed }
}

export function validateBootstrapOptionalEmail(
  email: string | null | undefined,
  label: string
): { ok: true; value: string } | { ok: false; message: string } {
  const trimmed = (email ?? '').trim()
  if (!trimmed) return { ok: true, value: '' }
  if (trimmed.length > BOOTSTRAP_MAX_EMAIL_LENGTH) {
    return { ok: false, message: `${label} must be ${BOOTSTRAP_MAX_EMAIL_LENGTH} characters or fewer.` }
  }
  if (!BOOTSTRAP_EMAIL_PATTERN.test(trimmed)) {
    return { ok: false, message: `Enter a valid ${label.toLowerCase()}.` }
  }
  return { ok: true, value: trimmed }
}

/** Legacy carrier_only bootstrap: company required; PII validated when present. */
export function validateBootstrapCarrierOnlySave(
  form: MemberProfileFormData
): { ok: true; form: MemberProfileFormData } | { ok: false; message: string } {
  const prepared = prepareBootstrapFormForSave(form)
  const companyName = (prepared.company_name as string)?.trim() ?? ''

  if (!companyName) return { ok: false, message: 'Company name is required.' }
  if (companyName.length > BOOTSTRAP_MAX_COMPANY_NAME_LENGTH) {
    return {
      ok: false,
      message: `Company name must be ${BOOTSTRAP_MAX_COMPANY_NAME_LENGTH} characters or fewer.`,
    }
  }

  const driverEmailCheck = validateBootstrapOptionalEmail(prepared.driver_email, 'Email')
  if (driverEmailCheck.ok === false) return driverEmailCheck

  const carrierEmailCheck = validateBootstrapOptionalEmail(prepared.carrier_email, 'Carrier email')
  if (carrierEmailCheck.ok === false) return carrierEmailCheck

  const companyPhoneCheck = validateBootstrapOptionalPhone(prepared.carrier_phone, 'Company phone')
  if (companyPhoneCheck.ok === false) return companyPhoneCheck

  const cellPhoneCheck = validateBootstrapOptionalPhone(prepared.driver_phone, 'Cell phone')
  if (cellPhoneCheck.ok === false) return cellPhoneCheck

  return {
    ok: true,
    form: {
      ...prepared,
      company_name: companyName,
      driver_email: driverEmailCheck.value,
      carrier_email: carrierEmailCheck.value || driverEmailCheck.value,
      carrier_phone: companyPhoneCheck.value,
      driver_phone: cellPhoneCheck.value,
    },
  }
}

export function validateBootstrapSelfSave(
  form: MemberProfileFormData
): { ok: true; form: MemberProfileFormData } | { ok: false; message: string } {
  const prepared = prepareBootstrapFormForSave(form)
  const companyName = (prepared.company_name as string)?.trim() ?? ''
  const fullName = (prepared.driver_full_name as string)?.trim() ?? ''

  if (!companyName) return { ok: false, message: 'Company name is required.' }
  if (companyName.length > BOOTSTRAP_MAX_COMPANY_NAME_LENGTH) {
    return {
      ok: false,
      message: `Company name must be ${BOOTSTRAP_MAX_COMPANY_NAME_LENGTH} characters or fewer.`,
    }
  }

  if (!fullName) return { ok: false, message: 'Full name is required.' }
  if (fullName.length > BOOTSTRAP_MAX_NAME_LENGTH) {
    return {
      ok: false,
      message: `Full name must be ${BOOTSTRAP_MAX_NAME_LENGTH} characters or fewer.`,
    }
  }

  const emailCheck = validateBootstrapEmail(prepared.driver_email)
  if (emailCheck.ok === false) return emailCheck

  const companyPhoneCheck = validateBootstrapOptionalPhone(prepared.carrier_phone, 'Company phone')
  if (companyPhoneCheck.ok === false) return companyPhoneCheck

  const cellPhoneCheck = validateBootstrapOptionalPhone(prepared.driver_phone, 'Cell phone')
  if (cellPhoneCheck.ok === false) return cellPhoneCheck

  return {
    ok: true,
    form: {
      ...prepared,
      company_name: companyName,
      driver_full_name: fullName,
      driver_email: emailCheck.value,
      carrier_email: (prepared.carrier_email as string)?.trim() || emailCheck.value,
      carrier_phone: companyPhoneCheck.value,
      driver_phone: cellPhoneCheck.value,
    },
  }
}

export function getOwnerBootstrapSetupCardTitle(): string {
  return 'Welcome to Truckeros'
}

export function getOwnerBootstrapSetupCardSubtitle(): string {
  return "You're setting up as the account Owner. Add your contact info and company details below — one save creates your organization and profile."
}

export function getOwnerBootstrapOwnerOperatorHint(): string {
  return 'You can add CDL details later — use Edit on your row in Team Roster.'
}

export function getOwnerBootstrapSaveButtonLabel(saving: boolean): string {
  return saving ? 'Setting up...' : 'Complete Setup'
}

export function shouldShowCarrierInformationCard(
  editingTarget: ProfileEditingTarget,
  isPrimaryOwnerAccount: boolean,
  isProfileBootstrap = false,
  form?: Pick<MemberProfileFormData, 'user_roles'>,
  actorEmail?: string | null
): boolean {
  if (editingTarget.kind !== 'self') return false
  if (isProfileBootstrap) return false
  if (isForcedCarrierOwner(actorEmail)) return true
  if (isPrimaryOwnerAccount) return true
  if (form && hasOwnerOrAdminRole(form.user_roles as string[] | undefined)) return true
  return false
}

/** Full User Roles checkbox section — only when editing a team member, not on own profile. */
export function shouldShowUserRolesSection(editingTarget: ProfileEditingTarget): boolean {
  return editingTarget.kind !== 'self'
}

export function getLandingAssignedRoles(
  ownProfile: Pick<MemberProfile, 'user_roles'> | null | undefined
): string[] {
  return validateUserRoles(ownProfile?.user_roles as string[] | undefined)
}

/** Read-only role badges on landing for non–Owner/Admin role holders. */
export function shouldShowAssignedRoleBadges(
  ownProfile: Pick<MemberProfile, 'is_primary_owner' | 'user_roles'> | null | undefined,
  editingTarget: ProfileEditingTarget,
  showLandingView: boolean
): boolean {
  if (shouldShowOwnerAdminBadge(ownProfile, editingTarget, showLandingView)) return false
  if (editingTarget.kind !== 'self' || !ownProfile || !showLandingView) return false
  return getLandingAssignedRoles(ownProfile).length > 0
}

/** Compact Owner/Admin badge on own profile instead of role checkboxes. */
export function shouldShowOwnerAdminBadge(
  ownProfile: Pick<MemberProfile, 'is_primary_owner' | 'user_roles'> | null | undefined,
  editingTarget: ProfileEditingTarget,
  showLandingView: boolean
): boolean {
  if (editingTarget.kind !== 'self') return false
  if (!ownProfile) return false
  if (!showLandingView) return false
  return (
    ownProfile.is_primary_owner === true ||
    hasOwnerOrAdminRole(ownProfile.user_roles as string[] | undefined)
  )
}

export function ownerAdminBadgeRole(
  ownProfile: Pick<MemberProfile, 'is_primary_owner' | 'user_roles'> | null | undefined
): UserRole {
  if (ownProfile?.is_primary_owner) return 'Owner'
  const roles = validateUserRoles(ownProfile?.user_roles as string[] | undefined)
  if (roles.includes('Owner')) return 'Owner'
  if (roles.includes('Admin')) return 'Admin'
  return 'Owner'
}

/** Read-only on landing when there is no Save Profile path; editable during bootstrap or active self edit. */
export function isUserRolesReadOnlyOnProfile(
  editingTarget: ProfileEditingTarget,
  options: {
    showLandingView: boolean
    isProfileBootstrap: boolean
    showMemberEditCard: boolean
  }
): boolean {
  if (editingTarget.kind !== 'self') return true
  const isEditable =
    options.isProfileBootstrap || options.showMemberEditCard || !options.showLandingView
  return !isEditable
}

export function getUserRolesSectionHelperText(options: {
  isProfileBootstrap: boolean
  canEditRoles: boolean
  isReadOnlyOnLanding: boolean
  hasOrganizationId: boolean
}): string {
  if (options.isReadOnlyOnLanding) {
    return USER_ROLES_HELPER_LANDING_READONLY
  }
  if (!options.canEditRoles) {
    return USER_ROLES_HELPER_MANAGED_BY_OWNER
  }
  if (options.isProfileBootstrap) {
    return USER_ROLES_HELPER_BOOTSTRAP
  }
  if (options.hasOrganizationId) {
    return `Select your roles. ${USER_ROLES_SAVE_WITH_PROFILE_HINT}`
  }
  return 'Select your roles.'
}

export function shouldShowTeamSectionCarrierBlock(editingTarget: ProfileEditingTarget): boolean {
  return editingTarget.kind !== 'self'
}

export function shouldShowLandingProfileView(
  editingTarget: ProfileEditingTarget,
  editingMemberKey: string | null,
  isProfileBootstrap: boolean
): boolean {
  return editingTarget.kind === 'self' && editingMemberKey === null && !isProfileBootstrap
}

export function shouldShowEditMyProfileOnLanding(
  editingTarget: ProfileEditingTarget,
  editingMemberKey: string | null,
  isProfileBootstrap: boolean,
  ownProfile: MemberProfile | null | undefined,
  isDriverSelfService: boolean
): boolean {
  return (
    shouldShowLandingProfileView(editingTarget, editingMemberKey, isProfileBootstrap) &&
    Boolean(ownProfile && isDriverSelfService)
  )
}

export function shouldShowMemberEditCard(
  editingTarget: ProfileEditingTarget,
  editingMemberKey: string | null,
  isProfileBootstrap: boolean,
  ownProfile?: Pick<MemberProfile, 'is_primary_owner' | 'driver_full_name' | 'company_name'> | null
): boolean {
  if (isProfileBootstrap) return false
  if (shouldShowBootstrapProfilePrompt(ownProfile)) return true
  if (editingTarget.kind !== 'self') return true
  return editingMemberKey !== null
}

export function getMemberEditCardSubtitle(editingTarget: ProfileEditingTarget): string {
  if (editingTarget.kind === 'team_member_profile' && !editingTarget.id) {
    return 'Add personal details and roles under this carrier. No new company setup.'
  }
  if (editingTarget.kind === 'self') {
    return 'Update driver details and contacts.'
  }
  return 'Update personal details, contacts, and roles under this carrier.'
}

export function getTeamMemberRolesHelperText(canEditRoles: boolean): string {
  return canEditRoles
    ? 'Select all roles that apply. Team members (including Permit Clerk) join this carrier — not a new organization.'
    : USER_ROLES_HELPER_MANAGED_BY_OWNER
}

/** Read-only parent-carrier helper under the member edit card. */
export function getTeamSectionCarrierHelperText(options: {
  showExpandableSummary: boolean
}): string {
  if (options.showExpandableSummary) {
    return 'Parent carrier is shared and read-only here. Edit company details on your profile above.'
  }
  return 'Parent carrier is shared and read-only for team members under this organization.'
}

export function memberEditCardTitle(
  editingTarget: ProfileEditingTarget,
  editingDisplayName: string | null
): string {
  if (editingTarget.kind === 'team_member_profile' && !editingTarget.id) {
    return 'New Team Member'
  }
  if (editingTarget.kind === 'self') {
    return 'Your Profile'
  }
  return `Edit ${editingDisplayName?.trim() || 'team member'}`
}

export function memberEditSaveButtonLabel(
  savingProfile: boolean,
  editingTarget: ProfileEditingTarget
): string {
  if (savingProfile) return 'Saving...'
  if (editingTarget.kind === 'team_member_profile' && !editingTarget.id) {
    return 'Save New Member'
  }
  if (editingTarget.kind === 'self') {
    return 'Save Profile'
  }
  return 'Save Changes'
}

export function isNewTeamMemberTarget(editingTarget: ProfileEditingTarget): boolean {
  return editingTarget.kind === 'team_member_profile' && !editingTarget.id
}

/** New team member save lives under User Roles; other flows keep header save. */
export function shouldShowMemberSaveInCardHeader(editingTarget: ProfileEditingTarget): boolean {
  return !isNewTeamMemberTarget(editingTarget)
}

export function memberEditSaveDisabled(
  editingTarget: ProfileEditingTarget,
  options: {
    isSaving: boolean
    canWriteProfile: boolean
    forcedCarrierOwner: boolean
    isLoadingMember: boolean
    userRoles: string[] | undefined
  }
): boolean {
  const baseDisabled =
    options.isSaving ||
    options.isLoadingMember ||
    (!options.canWriteProfile && !options.forcedCarrierOwner)
  if (isNewTeamMemberTarget(editingTarget)) {
    const roles = validateUserRoles(options.userRoles)
    return baseDisabled || roles.length === 0
  }
  return baseDisabled
}

export function shouldShowCarrierForm(
  editingTarget: ProfileEditingTarget,
  carrierDataSource: CarrierSummarySource | null | undefined,
  carrierFormExpanded: boolean
): boolean {
  if (editingTarget.kind !== 'self') return false
  if (!hasCarrierData(carrierDataSource)) return true
  return carrierFormExpanded
}

export function shouldShowTeamSectionCarrierDetails(
  carrierDataSource: CarrierSummarySource | null | undefined,
  carrierFormExpanded: boolean
): boolean {
  return carrierFormExpanded && hasCarrierData(carrierDataSource)
}

export function shouldUseTeamMemberCarrierSummary(
  editingTarget: ProfileEditingTarget,
  carrierDataSource: CarrierSummarySource | null | undefined,
  carrierFormExpanded: boolean
): boolean {
  if (editingTarget.kind === 'self') return false
  if (!hasCarrierData(carrierDataSource)) return false
  return !carrierFormExpanded
}

export function canSelfEditRoles(profile: Pick<MemberProfile, 'is_primary_owner'> | null | undefined): boolean {
  if (!profile) return true
  return profile.is_primary_owner === true
}

export type MemberProfileSaveScope = 'full' | 'carrier_only' | 'member_only'

export function applySelfSaveScope(
  form: MemberProfileFormData,
  actorProfile: MemberProfile | null | undefined,
  saveScope: MemberProfileSaveScope = 'full'
): MemberProfileFormData {
  if (saveScope === 'carrier_only') {
    return buildCarrierOnlySavePayload(form, actorProfile)
  }
  if (saveScope === 'member_only') {
    return buildMemberProfileSavePayloadWithoutCarrier(form, actorProfile)
  }
  return form
}

export function emptyMemberProfileForm(): MemberProfileFormData {
  return {
    company_name: '',
    usdot_number: '',
    mc_number: '',
    ein: '',
    carrier_address: '',
    carrier_phone: '',
    carrier_email: '',
    insurance_contact: '',
    driver_full_name: '',
    cdl_number: '',
    cdl_state: '',
    date_of_birth: '',
    driver_phone: '',
    driver_email: '',
    emergency_contact: '',
    user_roles: [],
  }
}

export function normalizeCdlState(raw: string | null | undefined): string | null {
  return normalizeLicensePlateState(raw)
}

export function validateUserRoles(
  roles: string[] | null | undefined,
  options?: { isPrimaryOwner?: boolean }
): UserRole[] {
  if (!roles?.length) return []
  const allowed = new Set<string>(USER_ROLE_OPTIONS)
  const seen = new Set<UserRole>()
  const result: UserRole[] = []
  for (const rawRole of roles) {
    let normalized = rawRole
    if (rawRole === LEGACY_OWNER_ADMIN_ROLE) {
      normalized = options?.isPrimaryOwner ? 'Owner' : 'Admin'
    }
    if (!allowed.has(normalized)) continue
    const typed = normalized as UserRole
    if (seen.has(typed)) continue
    seen.add(typed)
    result.push(typed)
  }
  return result
}

const MEMBER_PROFILE_ALLOWED_ROLES = new Set<string>([
  ...USER_ROLE_OPTIONS,
  LEGACY_OWNER_ADMIN_ROLE,
])

/**
 * Mirrors DB function member_profile_user_roles_valid (migration 030).
 * Owner may only combine with Driver (Owner Operator).
 */
export function isValidMemberProfileUserRolesCombination(
  roles: string[] | null | undefined
): boolean {
  if (!roles?.length) return true
  if (!roles.every((role) => MEMBER_PROFILE_ALLOWED_ROLES.has(role))) return false
  if (roles.includes('Owner') && !roles.every((role) => role === 'Owner' || role === 'Driver')) {
    return false
  }
  if (roles.includes(LEGACY_OWNER_ADMIN_ROLE)) {
    const others = roles.filter((role) => role !== LEGACY_OWNER_ADMIN_ROLE)
    if (others.length > 0 && !others.every((role) => role === 'Driver')) return false
  }
  return true
}

export const NON_BOOTSTRAP_OWNER_ROLE_MESSAGE =
  'Owner role can only be assigned during organization bootstrap'

/** Team-path message for Owner or any non-assignable role (not bootstrap wording). */
export const NON_ASSIGNABLE_TEAM_ROLE_MESSAGE =
  'Only Admin, Driver, Permit Clerk, or Viewer can be assigned to team members under a carrier'

export const TEAM_MEMBER_ROLES_REQUIRED_MESSAGE =
  'At least one role is required for a new team member'

/** Rejects Owner on team member saves (bootstrap and primary-owner paths are exempt). */
export function rejectNonBootstrapOwnerRoles(roles: string[] | null | undefined): void {
  const validated = validateUserRoles(roles)
  if (validated.includes(PRIMARY_OWNER_ROLE)) {
    throw new Error(NON_BOOTSTRAP_OWNER_ROLE_MESSAGE)
  }
}

/**
 * Team roster / other-member saves: only assignable in-org roles (never Owner bootstrap).
 * Empty roles are allowed for partial updates of existing rows; use requireRoles on insert.
 */
export function assertAssignableTeamMemberRoles(roles: string[] | null | undefined): UserRole[] {
  const validated = validateUserRoles(roles)
  const assignable = new Set<string>(ASSIGNABLE_TEAM_ROLES)
  // Owner and any non-assignable role use the team-path message (not bootstrap copy).
  if (validated.some((role) => !assignable.has(role))) {
    throw new Error(NON_ASSIGNABLE_TEAM_ROLE_MESSAGE)
  }
  return validated
}

export type TeamMemberChildRosterOptions = {
  /** When true (new roster insert), reject empty user_roles. */
  requireRoles?: boolean
  /**
   * Carrier field inheritance source (parent org carrier). Defaults to parentProfile.
   * Prefer primary-owner carrier when the acting Admin lacks denormalized company fields.
   */
  carrierSource?: MemberProfile | null
}

/**
 * Child roster payload: parent org only, carrier fields inherited from carrierSource
 * (denormalized display copy), assignable roles only. Never bootstraps organizations
 * or primary owner.
 */
export function buildTeamMemberChildRosterPayload(
  form: MemberProfileFormData,
  parentProfile: MemberProfile,
  createdByUserId: string,
  linkedUserId?: string | null,
  options?: TeamMemberChildRosterOptions
): Record<string, unknown> {
  if (!parentProfile.organization_id) {
    throw new Error('Organization not configured for this account')
  }
  const roles = assertAssignableTeamMemberRoles(form.user_roles as string[] | undefined)
  if (options?.requireRoles && roles.length === 0) {
    throw new Error(TEAM_MEMBER_ROLES_REQUIRED_MESSAGE)
  }
  const carrierSource = options?.carrierSource ?? parentProfile
  return teamMemberProfileToPayloadWithoutCarrier(
    form,
    parentProfile.organization_id,
    createdByUserId,
    carrierSource,
    linkedUserId
  )
}

/**
 * Prefer actor carrier when present; otherwise use primary owner's carrier fields for
 * denormalized inheritance onto child roster/member rows.
 */
export function pickCarrierInheritanceSource(
  actorProfile: MemberProfile,
  primaryOwnerProfile: MemberProfile | null | undefined
): MemberProfile {
  if (hasCarrierData(actorProfile)) return actorProfile
  if (primaryOwnerProfile && hasCarrierData(primaryOwnerProfile)) return primaryOwnerProfile
  return actorProfile
}

function trimOrNull(value: string | null | undefined): string | null {
  const trimmed = (value ?? '').trim()
  return trimmed.length > 0 ? trimmed : null
}

export function memberProfileFromRow(row: MemberProfile | null): MemberProfileFormData {
  if (!row) return emptyMemberProfileForm()

  const form = emptyMemberProfileForm()
  for (const key of TEXT_FIELDS) {
    form[key] = (row[key] as string | null) ?? ''
  }
  form.cdl_state = row.cdl_state ?? ''
  form.date_of_birth = row.date_of_birth ? row.date_of_birth.slice(0, 10) : ''
  form.user_roles = validateUserRoles(row.user_roles as string[] | undefined, {
    isPrimaryOwner: row.is_primary_owner === true,
  })
  return form
}

function profileFieldsToPayload(
  form: MemberProfileFormData,
  fieldKeys: readonly (keyof MemberProfileFormData)[] = TEXT_FIELDS
): Record<string, unknown> {
  const payload: Record<string, unknown> = {}

  for (const key of fieldKeys) {
    payload[key] = trimOrNull(form[key] as string)
  }

  payload.cdl_state = normalizeCdlState(form.cdl_state)
  payload.date_of_birth = trimOrNull(form.date_of_birth)
  const userRoles = validateUserRoles(form.user_roles as string[])
  if (!isValidMemberProfileUserRolesCombination(userRoles)) {
    throw new Error('Invalid role combination for member profile')
  }
  payload.user_roles = userRoles

  return payload
}

export function memberProfileToUpsertPayloadWithoutCarrier(
  form: MemberProfileFormData,
  userId: string,
  existing: MemberProfile | null | undefined
): Record<string, unknown> {
  const merged = buildMemberProfileSavePayloadWithoutCarrier(form, existing)
  return {
    user_id: userId,
    ...profileFieldsToPayload(merged),
  }
}

export function teamMemberProfileToPayloadWithoutCarrier(
  form: MemberProfileFormData,
  organizationId: string,
  createdByUserId: string,
  existing: MemberProfile | null | undefined,
  linkedUserId?: string | null
): Record<string, unknown> {
  const merged = buildMemberProfileSavePayloadWithoutCarrier(form, existing)
  return {
    organization_id: organizationId,
    created_by_user_id: createdByUserId,
    linked_user_id: linkedUserId ?? null,
    ...profileFieldsToPayload(merged),
  }
}

export function memberProfileToUpsertPayload(
  form: MemberProfileFormData,
  userId: string
): Record<string, unknown> {
  return {
    user_id: userId,
    ...profileFieldsToPayload(form),
  }
}

export function teamMemberProfileToPayload(
  form: MemberProfileFormData,
  organizationId: string,
  createdByUserId: string,
  linkedUserId?: string | null
): Record<string, unknown> {
  return {
    organization_id: organizationId,
    created_by_user_id: createdByUserId,
    linked_user_id: linkedUserId ?? null,
    ...profileFieldsToPayload(form),
  }
}

export function teamMemberProfileFromRow(row: TeamMemberProfile | null): MemberProfileFormData {
  return memberProfileFromRow(row)
}

export function generateOrganizationId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  throw new Error('crypto.randomUUID is not available')
}

export function shouldBootstrapOrganization(
  form: MemberProfileFormData,
  existing: MemberProfile | null | undefined,
  actorEmail?: string | null
): boolean {
  if (isForcedCarrierOwner(actorEmail) && !existing?.organization_id) return true
  if (existing?.organization_id) return false
  if (existing?.is_primary_owner === true) return true
  const roles = validateUserRoles(form.user_roles as string[] | undefined)
  return roles.includes(PRIMARY_OWNER_ROLE)
}

export function prepareMemberProfileSave(
  form: MemberProfileFormData,
  userId: string,
  existing: MemberProfile | null | undefined,
  actorEmail?: string | null
): Record<string, unknown> {
  const formForSave = isForcedCarrierOwner(actorEmail) ? ensureBootstrapOwnerRoles(form) : form
  const payload = memberProfileToUpsertPayload(formForSave, userId)

  if (existing?.organization_id) {
    payload.organization_id = existing.organization_id
    if (existing.is_primary_owner || isForcedCarrierOwner(actorEmail)) {
      payload.is_primary_owner = true
    }
    return payload
  }

  if (shouldBootstrapOrganization(formForSave, existing, actorEmail)) {
    payload.organization_id = generateOrganizationId()
    payload.is_primary_owner = true
  }

  return payload
}