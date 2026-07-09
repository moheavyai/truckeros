import {
  emptyMemberProfileForm,
  memberProfileFromRow,
  memberProfileToUpsertPayloadWithoutCarrier,
  validateUserRoles,
} from '@/lib/member-profile'
import { hasAdminAccess, supabaseAdmin } from '@/lib/supabase'
import {
  isInviteExpired,
  isMultiOrgInviteJoin,
  normalizeInviteEmail,
  shouldRewriteHomeProfileOnInviteAccept,
  validateAcceptTeamInvite,
  validateInviteRole,
  type TeamInviteRow,
} from '@/lib/team-invites'
import { createAuthedSupabaseClient } from '@/lib/team-member-profiles-api'
import type { OrganizationRole } from '@/types/organization'

export {
  isMultiOrgInviteJoin,
  shouldRewriteHomeProfileOnInviteAccept,
} from '@/lib/team-invites'

type AuthedSupabaseClient = ReturnType<typeof createAuthedSupabaseClient>

export type InvitePreview = Pick<
  TeamInviteRow,
  'id' | 'role' | 'invite_email' | 'organization_id' | 'expires_at'
>

export type AcceptTeamInviteOutcome = {
  invite: TeamInviteRow
  multiOrgJoin: boolean
}

function mapRpcError(message: string): Error {
  return new Error(message)
}

async function previewInviteViaRpc(
  supabase: AuthedSupabaseClient,
  token: string
): Promise<InvitePreview | null> {
  const { data, error } = await supabase.rpc('preview_team_invite', { p_token: token })
  if (error) throw mapRpcError(error.message)
  if (!data || typeof data !== 'object') return null
  return data as InvitePreview
}

async function acceptInviteViaRpc(
  supabase: AuthedSupabaseClient,
  token: string
): Promise<TeamInviteRow> {
  const { data, error } = await supabase.rpc('accept_team_invite', { p_token: token })
  if (error) throw mapRpcError(error.message)
  return data as TeamInviteRow
}

/** Admin fallback when RPC is unavailable (local dev without migration 029/034). */
export async function fetchInviteByTokenAdmin(token: string): Promise<TeamInviteRow | null> {
  if (!hasAdminAccess || !supabaseAdmin) return null

  const { data, error } = await supabaseAdmin
    .from('team_invites')
    .select('*')
    .eq('invite_token', token)
    .maybeSingle()

  if (error) throw new Error(error.message)
  return (data as TeamInviteRow | null) ?? null
}

/**
 * Exact case-insensitive email match for roster rows (no ILIKE wildcards).
 * Mirrors SQL lower(trim(driver_email)) = email.
 */
export async function linkRosterOnInviteAccept(options: {
  userId: string
  organizationId: string
  acceptorEmail?: string | null
}): Promise<void> {
  if (!hasAdminAccess || !supabaseAdmin) return

  const email = normalizeInviteEmail(options.acceptorEmail)
  if (!email) return

  const { data: rows, error: listError } = await supabaseAdmin
    .from('team_member_profiles')
    .select('id, driver_email')
    .eq('organization_id', options.organizationId)
    .is('linked_user_id', null)

  if (listError) {
    console.warn('[team-invite-accept] roster list failed', listError.message)
    return
  }

  const matchIds = (rows ?? [])
    .filter((row) => normalizeInviteEmail(row.driver_email) === email)
    .map((row) => row.id as string)
    .filter(Boolean)

  if (matchIds.length === 0) return

  const { error } = await supabaseAdmin
    .from('team_member_profiles')
    .update({ linked_user_id: options.userId })
    .in('id', matchIds)

  if (error) {
    console.warn('[team-invite-accept] roster link failed', error.message)
  }
}

async function restoreInviteClaimIfNeeded(
  inviteId: string,
  userId: string
): Promise<void> {
  if (!hasAdminAccess || !supabaseAdmin) return

  // Best-effort: only reverse if still accepted by this user (no concurrent winner).
  const { error } = await supabaseAdmin
    .from('team_invites')
    .update({
      status: 'pending',
      accepted_by_user_id: null,
      accepted_at: null,
    })
    .eq('id', inviteId)
    .eq('status', 'accepted')
    .eq('accepted_by_user_id', userId)

  if (error) {
    console.warn('[team-invite-accept] claim restore failed', error.message)
  }
}

/**
 * Admin accept path (RPC-missing fallback). Claim-first; preserve primary owners;
 * do not wipe custom membership permissions; validate invite role.
 * On post-claim grant failure, best-effort restore pending to avoid burned invites.
 */
export async function acceptInviteViaAdmin(options: {
  userId: string
  acceptorEmail?: string | null
  token: string
}): Promise<AcceptTeamInviteOutcome> {
  if (!hasAdminAccess || !supabaseAdmin) {
    throw new Error('Invite accept requires server admin access or migration 029 RPC')
  }

  const invite = await fetchInviteByTokenAdmin(options.token)
  const validation = validateAcceptTeamInvite(invite, {
    token: options.token,
    acceptorUserId: options.userId,
    acceptorEmail: options.acceptorEmail,
  })

  if (validation.ok === false) {
    throw new Error(validation.message)
  }

  const acceptedInvite = validation.invite
  // Reject Owner / invalid roles (parity with RPC).
  const role = validateInviteRole(String(acceptedInvite.role)) as OrganizationRole

  // Claim first (atomic) — only pending + unexpired rows succeed.
  const { data: claimed, error: claimError } = await supabaseAdmin
    .from('team_invites')
    .update({
      status: 'accepted',
      accepted_by_user_id: options.userId,
      accepted_at: new Date().toISOString(),
    })
    .eq('id', acceptedInvite.id)
    .eq('status', 'pending')
    .gt('expires_at', new Date().toISOString())
    .select('*')
    .maybeSingle()

  if (claimError) throw new Error(claimError.message)
  if (!claimed) {
    throw new Error('This invite has already been accepted')
  }

  // Only restore claim if membership never committed (avoids reopening after partial success).
  let membershipCommitted = false

  try {
    const { data: existingMembership, error: memLookupError } = await supabaseAdmin
      .from('organization_memberships')
      .select('is_primary_owner, role, permissions')
      .eq('organization_id', acceptedInvite.organization_id)
      .eq('user_id', options.userId)
      .maybeSingle()

    if (memLookupError) throw new Error(memLookupError.message)

    const keepPrimary = existingMembership?.is_primary_owner === true
    const membershipPayload = {
      organization_id: acceptedInvite.organization_id,
      user_id: options.userId,
      role: keepPrimary ? String(existingMembership?.role ?? role) : role,
      is_primary_owner: keepPrimary,
      permissions:
        existingMembership?.permissions != null
          ? existingMembership.permissions
          : { mode: 'global' as const },
    }

    const { error: membershipError } = await supabaseAdmin
      .from('organization_memberships')
      .upsert(membershipPayload, { onConflict: 'organization_id,user_id' })

    if (membershipError) throw new Error(membershipError.message)
    membershipCommitted = true

    const { data: existingProfile, error: existingError } = await supabaseAdmin
      .from('member_profiles')
      .select('*')
      .eq('user_id', options.userId)
      .maybeSingle()

    if (existingError) throw new Error(existingError.message)

    const existingOrgId = (existingProfile as { organization_id?: string | null } | null)
      ?.organization_id
    const existingIsPrimary = (existingProfile as { is_primary_owner?: boolean | null } | null)
      ?.is_primary_owner

    const multiOrgJoin = isMultiOrgInviteJoin({
      existingOrganizationId: existingOrgId,
      inviteOrganizationId: acceptedInvite.organization_id,
    })

    const roles = validateUserRoles([role])
    const rewriteHome = shouldRewriteHomeProfileOnInviteAccept({
      existingOrganizationId: existingOrgId,
      existingIsPrimaryOwner: existingIsPrimary,
      inviteOrganizationId: acceptedInvite.organization_id,
    })

    if (rewriteHome) {
      if (existingProfile) {
        const mergedForm = memberProfileFromRow(
          existingProfile as Parameters<typeof memberProfileFromRow>[0]
        )
        mergedForm.user_roles = roles
        const profilePayload = memberProfileToUpsertPayloadWithoutCarrier(
          mergedForm,
          options.userId,
          existingProfile as Parameters<typeof memberProfileToUpsertPayloadWithoutCarrier>[2]
        )
        profilePayload.organization_id = acceptedInvite.organization_id
        profilePayload.is_primary_owner = existingIsPrimary === true

        const { error: profileError } = await supabaseAdmin
          .from('member_profiles')
          .update(profilePayload)
          .eq('user_id', options.userId)

        if (profileError) throw new Error(profileError.message)
      } else {
        const profilePayload = memberProfileToUpsertPayloadWithoutCarrier(
          { ...emptyMemberProfileForm(), user_roles: roles },
          options.userId,
          null
        )
        profilePayload.organization_id = acceptedInvite.organization_id
        profilePayload.is_primary_owner = false

        const { error: profileError } = await supabaseAdmin
          .from('member_profiles')
          .insert(profilePayload)

        if (profileError) throw new Error(profileError.message)
      }
    }

    await linkRosterOnInviteAccept({
      userId: options.userId,
      organizationId: acceptedInvite.organization_id,
      acceptorEmail: options.acceptorEmail,
    })

    return {
      invite: claimed as TeamInviteRow,
      multiOrgJoin,
    }
  } catch (grantError) {
    // Only reopen invite when membership never committed. If membership succeeded but
    // profile/roster failed, leave invite accepted to prevent double-claim races.
    if (!membershipCommitted) {
      await restoreInviteClaimIfNeeded(acceptedInvite.id, options.userId)
    } else {
      console.warn(
        '[team-invite-accept] post-membership step failed; invite left accepted',
        grantError instanceof Error ? grantError.message : grantError
      )
    }
    throw grantError
  }
}

export async function previewTeamInviteForUser(options: {
  supabase: AuthedSupabaseClient
  token: string
  acceptorEmail?: string | null
}): Promise<InvitePreview | null> {
  const { supabase, token, acceptorEmail } = options

  try {
    const preview = await previewInviteViaRpc(supabase, token)
    if (!preview) return null
    if (isInviteExpired({ ...preview, status: 'pending' })) return null
    return preview
  } catch (rpcError) {
    const invite = invitePreviewFromRow(await fetchInviteByTokenAdmin(token))
    if (!invite) {
      throw rpcError instanceof Error ? rpcError : new Error('Failed to load invite')
    }

    const validation = validateAcceptTeamInvite(invite, {
      token,
      acceptorUserId: '',
      acceptorEmail,
    })

    if (validation.ok === false && validation.code !== 'email_mismatch') {
      return null
    }

    // Surface email mismatch to caller via null preview when emails differ
    // (route maps both to uniform unavailable message).
    if (validation.ok === false && validation.code === 'email_mismatch') {
      return {
        id: invite.id,
        role: invite.role,
        invite_email: invite.invite_email,
        organization_id: invite.organization_id,
        expires_at: invite.expires_at,
      }
    }

    return {
      id: invite.id,
      role: invite.role,
      invite_email: invite.invite_email,
      organization_id: invite.organization_id,
      expires_at: invite.expires_at,
    }
  }
}

export async function acceptTeamInviteForUser(options: {
  supabase: AuthedSupabaseClient
  userId: string
  acceptorEmail?: string | null
  token: string
}): Promise<AcceptTeamInviteOutcome> {
  const { supabase, userId, acceptorEmail, token } = options

  // Snapshot home profile before accept so multi-org join can be reported to the client.
  const { data: priorProfile } = await supabase
    .from('member_profiles')
    .select('organization_id, is_primary_owner')
    .eq('user_id', userId)
    .maybeSingle()

  const priorOrgId = (priorProfile as { organization_id?: string | null } | null)?.organization_id

  try {
    const invite = await acceptInviteViaRpc(supabase, token)
    const multiOrgJoin = isMultiOrgInviteJoin({
      existingOrganizationId: priorOrgId,
      inviteOrganizationId: invite.organization_id,
    })
    return { invite, multiOrgJoin }
  } catch (rpcError) {
    const message = rpcError instanceof Error ? rpcError.message : ''
    const rpcMissing =
      message.toLowerCase().includes('function') ||
      message.toLowerCase().includes('could not find')
    if (!rpcMissing) {
      throw rpcError instanceof Error ? rpcError : new Error('Failed to accept invite')
    }
    return acceptInviteViaAdmin({ userId, acceptorEmail, token })
  }
}

export function invitePreviewFromRow(invite: TeamInviteRow | null): TeamInviteRow | null {
  if (!invite) return null
  if (isInviteExpired(invite)) return null
  return invite
}

/** @deprecated Use previewTeamInviteForUser — client must not read team_invites directly. */
export async function fetchInviteByToken(
  supabase: AuthedSupabaseClient,
  token: string
): Promise<TeamInviteRow | null> {
  void supabase
  return fetchInviteByTokenAdmin(token)
}
