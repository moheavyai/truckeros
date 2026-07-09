import { isPrimaryOwner } from '@/lib/member-profile-permissions'
import {
  detectRestrictedFieldChanges,
  DRIVER_RESTRICTED_FIELD_KEYS,
  isDriverSelfServiceActor,
  type DriverRestrictedFieldKey,
  type RestrictedFieldChange,
} from '@/lib/profile-field-permissions'
import { memberProfileFromRow } from '@/lib/member-profile'
import type { MemberProfile, MemberProfileFormData } from '@/types/member-profile'
import { createAuthedSupabaseClient } from '@/lib/team-member-profiles-api'

type AuthedSupabaseClient = ReturnType<typeof createAuthedSupabaseClient>

export const ALLOWED_PROFILE_CHANGE_FIELD_KEYS = DRIVER_RESTRICTED_FIELD_KEYS

export type ProfileChangeRequestRow = {
  id: string
  organization_id: string
  requester_user_id: string
  target_user_id: string
  field_key: string
  current_value: string | null
  requested_value: string | null
  status: 'pending' | 'approved' | 'rejected'
  reviewed_by_user_id: string | null
  reviewed_at: string | null
  created_at: string
  updated_at: string
}

export function assertAllowedProfileChangeFieldKey(fieldKey: string): void {
  if (!(ALLOWED_PROFILE_CHANGE_FIELD_KEYS as readonly string[]).includes(fieldKey)) {
    throw new Error('Forbidden – invalid profile change field')
  }
}

/** Client payload: only restricted field keys that changed (no full form snapshot). */
export type RestrictedChangeRequestPayload = Partial<
  Pick<MemberProfileFormData, DriverRestrictedFieldKey>
>

export function buildRestrictedChangeRequestPayload(
  changes: RestrictedFieldChange[]
): RestrictedChangeRequestPayload {
  const payload: RestrictedChangeRequestPayload = {}
  for (const change of changes) {
    payload[change.fieldKey] = change.requestedValue ?? ''
  }
  return payload
}

export function parseRestrictedChangeRequestBody(body: Record<string, unknown>): MemberProfileFormData {
  const baseline = memberProfileFromRow({ user_id: 'request-body' })
  const next = { ...baseline }

  for (const fieldKey of DRIVER_RESTRICTED_FIELD_KEYS) {
    if (fieldKey in body) {
      next[fieldKey] = body[fieldKey] == null ? '' : String(body[fieldKey])
    }
  }

  return next
}

export function profileChangeFieldLabel(fieldKey: string): string {
  switch (fieldKey) {
    case 'driver_full_name':
      return 'Full Name'
    case 'cdl_number':
      return 'CDL#'
    case 'cdl_state':
      return 'CDL State'
    case 'date_of_birth':
      return 'Date of Birth'
    default:
      return fieldKey
  }
}

export function pendingProfileChangeFieldKeys(
  requests: Pick<ProfileChangeRequestRow, 'field_key' | 'status'>[]
): Set<string> {
  return new Set(
    requests.filter((request) => request.status === 'pending').map((request) => request.field_key)
  )
}

export function assertCanSubmitProfileChangeRequests(
  actor: MemberProfile,
  targetUserId: string
): void {
  if (actor.user_id !== targetUserId) {
    throw new Error('Forbidden – can only submit change requests for your own profile')
  }
  if (!isDriverSelfServiceActor(actor)) {
    throw new Error('Forbidden – only driver accounts use profile change requests')
  }
  if (!actor.organization_id) {
    throw new Error('Organization not configured for this account')
  }
}

export function buildRestrictedChangeRows(
  actor: MemberProfile,
  changes: RestrictedFieldChange[]
): Array<{
  organization_id: string
  requester_user_id: string
  target_user_id: string
  field_key: string
  current_value: string | null
  requested_value: string | null
  status: 'pending'
}> {
  return changes.map((change) => {
    assertAllowedProfileChangeFieldKey(change.fieldKey)
    return {
      organization_id: actor.organization_id!,
      requester_user_id: actor.user_id,
      target_user_id: actor.user_id,
      field_key: change.fieldKey,
      current_value: change.currentValue,
      requested_value: change.requestedValue,
      status: 'pending' as const,
    }
  })
}

export async function replacePendingProfileChangeRequests(
  supabase: AuthedSupabaseClient,
  actor: MemberProfile,
  rows: Array<{
    organization_id: string
    requester_user_id: string
    target_user_id: string
    field_key: string
    current_value: string | null
    requested_value: string | null
    status: 'pending'
  }>
): Promise<ProfileChangeRequestRow[]> {
  if (rows.length === 0) return []

  const fieldKeys = rows.map((row) => row.field_key)
  const { error: deleteError } = await supabase
    .from('profile_change_requests')
    .delete()
    .eq('organization_id', actor.organization_id!)
    .eq('target_user_id', actor.user_id)
    .in('field_key', fieldKeys)
    .eq('status', 'pending')

  if (deleteError) throw new Error(deleteError.message)

  const { data, error } = await supabase.from('profile_change_requests').insert(rows).select('*')

  if (error) throw new Error(error.message)
  return (data ?? []) as ProfileChangeRequestRow[]
}

export async function submitProfileChangeRequests(
  supabase: AuthedSupabaseClient,
  actor: MemberProfile,
  form: MemberProfileFormData,
  baseline?: MemberProfileFormData
): Promise<ProfileChangeRequestRow[]> {
  assertCanSubmitProfileChangeRequests(actor, actor.user_id)
  const serverBaseline = baseline ?? memberProfileFromRow(actor)
  const changes = detectRestrictedFieldChanges(form, serverBaseline)
  if (changes.length === 0) return []

  const rows = buildRestrictedChangeRows(actor, changes)
  return replacePendingProfileChangeRequests(supabase, actor, rows)
}

export async function listPendingProfileChangeRequestsForOrg(
  supabase: AuthedSupabaseClient,
  actor: MemberProfile
): Promise<ProfileChangeRequestRow[]> {
  if (!isPrimaryOwner(actor) || !actor.organization_id) {
    throw new Error('Forbidden – only primary owners can list org change requests')
  }

  const { data, error } = await supabase
    .from('profile_change_requests')
    .select('*')
    .eq('organization_id', actor.organization_id)
    .eq('status', 'pending')
    .order('created_at', { ascending: true })

  if (error) throw new Error(error.message)
  return (data ?? []) as ProfileChangeRequestRow[]
}

export async function withdrawPendingProfileChangeRequest(
  supabase: AuthedSupabaseClient,
  actor: MemberProfile,
  requestId: string
): Promise<void> {
  assertCanSubmitProfileChangeRequests(actor, actor.user_id)

  const { data: request, error: fetchError } = await supabase
    .from('profile_change_requests')
    .select('id, status, target_user_id')
    .eq('id', requestId)
    .eq('target_user_id', actor.user_id)
    .eq('status', 'pending')
    .maybeSingle()

  if (fetchError) throw new Error(fetchError.message)
  if (!request) throw new Error('Change request not found')

  const { error: deleteError } = await supabase
    .from('profile_change_requests')
    .delete()
    .eq('id', requestId)
    .eq('target_user_id', actor.user_id)
    .eq('status', 'pending')

  if (deleteError) throw new Error(deleteError.message)
}

export async function listOwnPendingProfileChangeRequests(
  supabase: AuthedSupabaseClient,
  actor: MemberProfile
): Promise<ProfileChangeRequestRow[]> {
  const { data, error } = await supabase
    .from('profile_change_requests')
    .select('*')
    .eq('target_user_id', actor.user_id)
    .eq('status', 'pending')
    .order('created_at', { ascending: true })

  if (error) throw new Error(error.message)
  return (data ?? []) as ProfileChangeRequestRow[]
}

export async function reviewProfileChangeRequest(
  supabase: AuthedSupabaseClient,
  actor: MemberProfile,
  requestId: string,
  action: 'approve' | 'reject'
): Promise<ProfileChangeRequestRow> {
  if (!isPrimaryOwner(actor) || !actor.organization_id) {
    throw new Error('Forbidden – only primary owners can review change requests')
  }

  const { data: request, error: fetchError } = await supabase
    .from('profile_change_requests')
    .select('*')
    .eq('id', requestId)
    .eq('organization_id', actor.organization_id)
    .eq('status', 'pending')
    .maybeSingle()

  if (fetchError) throw new Error(fetchError.message)
  if (!request) throw new Error('Change request not found')

  assertAllowedProfileChangeFieldKey(request.field_key)

  if (action === 'approve') {
    const updatePayload: Record<string, string | null> = {
      [request.field_key]: request.requested_value,
    }

    const { error: profileError } = await supabase
      .from('member_profiles')
      .update(updatePayload)
      .eq('user_id', request.target_user_id)
      .eq('organization_id', actor.organization_id)

    if (profileError) throw new Error(profileError.message)
  }

  const { data: updated, error: updateError } = await supabase
    .from('profile_change_requests')
    .update({
      status: action === 'approve' ? 'approved' : 'rejected',
      reviewed_by_user_id: actor.user_id,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', requestId)
    .select('*')
    .single()

  if (updateError) throw new Error(updateError.message)
  return updated as ProfileChangeRequestRow
}