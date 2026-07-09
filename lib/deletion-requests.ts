import { canManageMemberPermissions } from '@/lib/member-profile-permissions'
import {
  canActorDeleteMember,
  canActorRequestMemberDeletion,
  mapMemberSourceToResourceType,
  type DeletionResourceType,
  type DeletionRequest,
} from '@/lib/team-permissions'
import { createAuthedSupabaseClient } from '@/lib/team-member-profiles-api'
import type { MemberProfile } from '@/types/member-profile'

type AuthedSupabaseClient = ReturnType<typeof createAuthedSupabaseClient>

export type DeletionRequestRow = DeletionRequest & {
  requester_name?: string | null
}

export type CreateDeletionRequestInput = {
  resourceType: DeletionResourceType
  resourceId: string
  targetUserId?: string | null
  source?: 'member_profile' | 'team_member_profile'
}

export function deletionResourceLabel(resourceType: DeletionResourceType): string {
  switch (resourceType) {
    case 'team_member':
      return 'Team member'
    case 'roster_member':
      return 'Roster member'
    case 'driver':
      return 'Driver'
    case 'equipment':
      return 'Equipment'
    case 'carrier':
      return 'Carrier'
    default:
      return resourceType
  }
}

export async function listPendingDeletionRequestsForOrg(
  supabase: AuthedSupabaseClient,
  actor: MemberProfile
): Promise<DeletionRequestRow[]> {
  if (!actor.organization_id || !canManageMemberPermissions(actor)) {
    throw new Error('Forbidden – only owners and admins can list deletion requests')
  }

  const { data, error } = await supabase
    .from('deletion_requests')
    .select('*')
    .eq('organization_id', actor.organization_id)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })

  if (error) throw new Error(error.message)
  return (data ?? []) as DeletionRequestRow[]
}

export async function createDeletionRequest(
  supabase: AuthedSupabaseClient,
  actor: MemberProfile,
  input: CreateDeletionRequestInput
): Promise<DeletionRequestRow> {
  if (!actor.organization_id) {
    throw new Error('Organization not configured for this account')
  }

  const target = {
    user_roles: [] as string[],
    is_primary_owner: false,
    is_self: false,
  }

  if (input.targetUserId) {
    const { data: targetProfile } = await supabase
      .from('member_profiles')
      .select('is_primary_owner, user_roles')
      .eq('user_id', input.targetUserId)
      .eq('organization_id', actor.organization_id)
      .maybeSingle()

    if (targetProfile) {
      target.is_primary_owner = targetProfile.is_primary_owner === true
      target.user_roles = (targetProfile.user_roles as string[]) ?? []
    }
  }

  if (
    !canActorRequestMemberDeletion(actor, target, input.resourceType) &&
    !canActorDeleteMember(actor, target)
  ) {
    throw new Error('Forbidden – cannot request deletion for this resource')
  }

  if (canActorDeleteMember(actor, target)) {
    throw new Error('Forbidden – use direct delete for this resource')
  }

  const { data, error } = await supabase
    .from('deletion_requests')
    .insert({
      organization_id: actor.organization_id,
      requester_user_id: actor.user_id,
      resource_type: input.resourceType,
      resource_id: input.resourceId,
      status: 'pending',
    })
    .select('*')
    .single()

  if (error) throw new Error(error.message)
  return data as DeletionRequestRow
}

async function executeApprovedDeletion(
  supabase: AuthedSupabaseClient,
  actor: MemberProfile,
  request: DeletionRequestRow
): Promise<void> {
  if (!actor.organization_id) {
    throw new Error('Organization not configured for this account')
  }

  if (request.resource_type === 'team_member') {
    const userId = request.resource_id
    const { error: profileError } = await supabase
      .from('member_profiles')
      .delete()
      .eq('user_id', userId)
      .eq('organization_id', actor.organization_id)

    if (profileError) throw new Error(profileError.message)

    const { error: membershipError } = await supabase
      .from('organization_memberships')
      .delete()
      .eq('organization_id', actor.organization_id)
      .eq('user_id', userId)

    if (membershipError) throw new Error(membershipError.message)
    return
  }

  if (request.resource_type === 'roster_member') {
    const { error } = await supabase
      .from('team_member_profiles')
      .delete()
      .eq('id', request.resource_id)
      .eq('organization_id', actor.organization_id)

    if (error) throw new Error(error.message)
    return
  }

  throw new Error(`Unsupported deletion resource type: ${request.resource_type}`)
}

export async function reviewDeletionRequest(
  supabase: AuthedSupabaseClient,
  actor: MemberProfile,
  requestId: string,
  action: 'approve' | 'reject'
): Promise<DeletionRequestRow> {
  if (!actor.organization_id || !canManageMemberPermissions(actor)) {
    throw new Error('Forbidden – only owners and admins can review deletion requests')
  }

  const { data: pending, error: fetchError } = await supabase
    .from('deletion_requests')
    .select('*')
    .eq('id', requestId)
    .eq('organization_id', actor.organization_id)
    .eq('status', 'pending')
    .maybeSingle()

  if (fetchError) throw new Error(fetchError.message)
  if (!pending) throw new Error('Pending deletion request not found')

  if (action === 'approve') {
    await executeApprovedDeletion(supabase, actor, pending as DeletionRequestRow)
  }

  const { data, error } = await supabase
    .from('deletion_requests')
    .update({
      status: action === 'approve' ? 'approved' : 'rejected',
      reviewed_by_user_id: actor.user_id,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', requestId)
    .select('*')
    .single()

  if (error) throw new Error(error.message)
  return data as DeletionRequestRow
}