import { CARRIER_FIELD_KEYS } from '@/lib/member-profile'
import { isPrimaryOwner } from '@/lib/member-profile-permissions'
import { hasOwnerOrAdminRole } from '@/lib/team-permissions'
import { validateUserRoles } from '@/lib/member-profile'
import type { MemberProfile, MemberProfileFormData } from '@/types/member-profile'

export type ProfileFieldKey = keyof MemberProfileFormData

/** Identity fields drivers cannot persist without admin approval. */
export const DRIVER_RESTRICTED_FIELD_KEYS = [
  'driver_full_name',
  'cdl_number',
  'cdl_state',
  'date_of_birth',
] as const satisfies readonly ProfileFieldKey[]

/** Contact fields drivers may edit on their own profile. */
export const DRIVER_EDITABLE_FIELD_KEYS = [
  'driver_phone',
  'driver_email',
  'emergency_contact',
] as const satisfies readonly ProfileFieldKey[]

/**
 * Load details and routing envelope are editable by drivers elsewhere (dashboard).
 * Helpers are defined here for future use on those surfaces.
 */
export const DRIVER_EDITABLE_LOAD_DETAIL_FIELD_KEYS = [] as const satisfies readonly string[]
export const DRIVER_EDITABLE_ROUTING_FIELD_KEYS = [] as const satisfies readonly string[]

export type DriverRestrictedFieldKey = (typeof DRIVER_RESTRICTED_FIELD_KEYS)[number]

export function isDriverRestrictedField(fieldKey: ProfileFieldKey): fieldKey is DriverRestrictedFieldKey {
  return (DRIVER_RESTRICTED_FIELD_KEYS as readonly string[]).includes(fieldKey)
}

export function requiresAdminApproval(fieldKey: ProfileFieldKey): boolean {
  return isDriverRestrictedField(fieldKey)
}

export function hasDriverRole(
  actor: Pick<MemberProfile, 'user_roles' | 'is_primary_owner'> | null | undefined
): boolean {
  if (!actor || isPrimaryOwner(actor)) return false
  const roles = validateUserRoles(actor.user_roles as string[] | undefined)
  return roles.includes('Driver')
}

export function hasFullProfileEditAccess(
  actor: Pick<MemberProfile, 'user_roles' | 'is_primary_owner'> | null | undefined
): boolean {
  if (!actor) return true
  if (isPrimaryOwner(actor)) return true
  return hasOwnerOrAdminRole(actor)
}

/** Bootstrap-only: null actor may edit before profile row exists. */
export function hasBootstrapProfileEditAccess(
  actor: Pick<MemberProfile, 'user_roles' | 'is_primary_owner'> | null | undefined
): boolean {
  if (!actor) return true
  return hasFullProfileEditAccess(actor)
}

export function isDriverSelfServiceActor(
  actor: Pick<MemberProfile, 'user_roles' | 'is_primary_owner'> | null | undefined
): boolean {
  return hasDriverRole(actor) && !hasFullProfileEditAccess(actor)
}

export function canEditProfileField(
  actor: Pick<MemberProfile, 'user_roles' | 'is_primary_owner'> | null | undefined,
  fieldKey: ProfileFieldKey
): boolean {
  if (!actor) return true
  if (hasFullProfileEditAccess(actor)) return true

  if (isDriverSelfServiceActor(actor)) {
    if ((CARRIER_FIELD_KEYS as readonly string[]).includes(fieldKey)) return false
    if (fieldKey === 'user_roles') return false
    if (isDriverRestrictedField(fieldKey)) return true
    return (DRIVER_EDITABLE_FIELD_KEYS as readonly string[]).includes(fieldKey)
  }

  return false
}

export function canDirectlyPersistProfileField(
  actor: Pick<MemberProfile, 'user_roles' | 'is_primary_owner'> | null | undefined,
  fieldKey: ProfileFieldKey
): boolean {
  if (!canEditProfileField(actor, fieldKey)) return false
  if (isDriverSelfServiceActor(actor) && requiresAdminApproval(fieldKey)) return false
  return true
}

function normalizedFieldValue(value: string | null | undefined): string {
  return (value ?? '').trim()
}

export type RestrictedFieldChange = {
  fieldKey: DriverRestrictedFieldKey
  currentValue: string | null
  requestedValue: string | null
}

export function detectRestrictedFieldChanges(
  form: MemberProfileFormData,
  baseline: MemberProfileFormData
): RestrictedFieldChange[] {
  const changes: RestrictedFieldChange[] = []

  for (const fieldKey of DRIVER_RESTRICTED_FIELD_KEYS) {
    const currentValue = normalizedFieldValue(baseline[fieldKey] as string)
    const requestedValue = normalizedFieldValue(form[fieldKey] as string)
    if (currentValue !== requestedValue) {
      changes.push({
        fieldKey,
        currentValue: currentValue.length > 0 ? currentValue : null,
        requestedValue: requestedValue.length > 0 ? requestedValue : null,
      })
    }
  }

  return changes
}

export function hasPendingRestrictedFieldEdits(
  form: MemberProfileFormData,
  baseline: MemberProfileFormData
): boolean {
  return detectRestrictedFieldChanges(form, baseline).length > 0
}

/** Revert driver-restricted fields to the persisted baseline before a direct save. */
export function applyDriverRestrictedFieldBaseline(
  form: MemberProfileFormData,
  baseline: MemberProfileFormData
): MemberProfileFormData {
  const next = { ...form }
  for (const fieldKey of DRIVER_RESTRICTED_FIELD_KEYS) {
    next[fieldKey] = baseline[fieldKey] as string
  }
  return next
}