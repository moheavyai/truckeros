import {
  buildCarrierConnectionInviteRecord,
  canCreateCarrierConnectionInvite,
  filterActivePendingCarrierConnectionInvites,
  formatCarrierConnectionEmailBody,
  formatCarrierConnectionEmailSubject,
  formatCarrierConnectionSmsBody,
  isUsdotConflictError,
  redactCarrierConnectionInviteForClient,
  validateAcceptCarrierConnectionInvite,
  validateCreateCarrierConnectionInviteInput,
  CARRIER_CONNECTION_INVITE_UNAVAILABLE_MESSAGE,
  type AcceptCarrierConnectionInviteInput,
  type CreateCarrierConnectionInviteValidated,
} from '@/lib/carrier-connection-invites'
import { sendInviteNotifications } from '@/lib/invite-notifications'
import {
  emptyMemberProfileForm,
  memberProfileFromRow,
  memberProfileToUpsertPayloadWithoutCarrier,
  validateUserRoles,
} from '@/lib/member-profile'
import {
  isMultiOrgInviteJoin,
  shouldRewriteHomeProfileOnInviteAccept,
} from '@/lib/team-invites'
import { hasAdminAccess, supabaseAdmin } from '@/lib/supabase'
import type { CreateCarrierConnectionInviteInput, CarrierConnectionInvite } from '@/types/organization'
import type { MemberProfile } from '@/types/member-profile'
import type { SupabaseClient } from '@supabase/supabase-js'

export type CreateCarrierConnectionInviteResult = {
  invite: ReturnType<typeof redactCarrierConnectionInviteForClient>
  email: ReturnType<typeof sendInviteNotifications>['email']
  sms: ReturnType<typeof sendInviteNotifications>['sms']
}

export type CarrierConnectionInvitePreview = {
  id: string
  company_name: string
  usdot_number?: string | null
  invite_email?: string | null
  invite_contact_name?: string | null
  organization_id?: string | null
  expires_at: string
  status?: string
}

export type AcceptCarrierConnectionInviteOutcome = {
  invite: CarrierConnectionInvite
  multiOrgJoin: boolean
  organizationId: string
}

function requireAdmin() {
  if (!hasAdminAccess || !supabaseAdmin) {
    throw new Error(
      'Carrier connection invites require server admin access (SUPABASE_SERVICE_ROLE_KEY)'
    )
  }
  return supabaseAdmin
}

export async function fetchMembershipRolesForUser(
  supabase: SupabaseClient,
  userId: string
): Promise<string[]> {
  const { data, error } = await supabase
    .from('organization_memberships')
    .select('role')
    .eq('user_id', userId)

  if (error) throw new Error(error.message)
  return (data ?? [])
    .map((row) => String((row as { role?: string }).role ?? '').trim())
    .filter(Boolean)
}

export async function listOutgoingCarrierConnectionInvites(
  supabase: SupabaseClient,
  invitedByUserId: string
): Promise<ReturnType<typeof redactCarrierConnectionInviteForClient>[]> {
  const { data, error } = await supabase
    .from('carrier_connection_invites')
    .select('*')
    .eq('invited_by_user_id', invitedByUserId)
    .order('created_at', { ascending: false })

  if (error) throw new Error(error.message)

  const rows = (data ?? []) as CarrierConnectionInvite[]
  const expiredRows = rows.filter(
    (row) =>
      row.status === 'pending' &&
      Number.isFinite(Date.parse(row.expires_at)) &&
      Date.parse(row.expires_at) < Date.now()
  )
  const expiredIds = expiredRows.map((row) => row.id)

  if (expiredIds.length > 0) {
    await supabase
      .from('carrier_connection_invites')
      .update({ status: 'expired' })
      .in('id', expiredIds)
      .eq('invited_by_user_id', invitedByUserId)
      .eq('status', 'pending')

    // Best-effort shell cleanup so expired invites do not leave ghost carriers.
    for (const row of expiredRows) {
      try {
        await cleanupShellOrgIfOrphaned({
          organizationId: row.organization_id,
          invitedByUserId,
          excludeInviteId: row.id,
        })
      } catch (cleanupError) {
        console.warn(
          '[carrier-connection-invite] expire shell cleanup failed',
          cleanupError instanceof Error ? cleanupError.message : cleanupError
        )
      }
    }
  }

  return rows.map((row) =>
    redactCarrierConnectionInviteForClient(
      expiredIds.includes(row.id) ? { ...row, status: 'expired' as const } : row
    )
  )
}

export async function listPendingCarrierConnectionInvites(
  supabase: SupabaseClient,
  invitedByUserId: string
): Promise<ReturnType<typeof redactCarrierConnectionInviteForClient>[]> {
  const all = await listOutgoingCarrierConnectionInvites(supabase, invitedByUserId)
  return filterActivePendingCarrierConnectionInvites(
    all as CarrierConnectionInvite[]
  ) as ReturnType<typeof redactCarrierConnectionInviteForClient>[]
}

/** True when org has no primary owner membership (shell org for pending invite). */
async function orgHasNoPrimaryOwner(
  admin: NonNullable<typeof supabaseAdmin>,
  organizationId: string
): Promise<boolean> {
  const { data, error } = await admin
    .from('organization_memberships')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('is_primary_owner', true)
    .limit(1)
    .maybeSingle()

  if (error) throw new Error(error.message)
  return !data
}

async function countPendingInvitesForOrg(
  admin: NonNullable<typeof supabaseAdmin>,
  organizationId: string,
  excludeInviteId?: string
): Promise<number> {
  let query = admin
    .from('carrier_connection_invites')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', organizationId)
    .eq('status', 'pending')

  if (excludeInviteId) {
    query = query.neq('id', excludeInviteId)
  }

  const { count, error } = await query
  if (error) throw new Error(error.message)
  return count ?? 0
}

/**
 * Best-effort: remove clerk membership + shell org when last pending invite is gone
 * and no primary owner exists (orphan cleanup).
 */
export async function cleanupShellOrgIfOrphaned(options: {
  organizationId: string | null | undefined
  invitedByUserId: string
  excludeInviteId?: string
}): Promise<void> {
  const organizationId = options.organizationId
  if (!organizationId) return

  const admin = requireAdmin()
  const noPrimary = await orgHasNoPrimaryOwner(admin, organizationId)
  if (!noPrimary) return

  const remaining = await countPendingInvitesForOrg(
    admin,
    organizationId,
    options.excludeInviteId
  )
  if (remaining > 0) return

  // Only delete shells created by this inviter.
  const { data: org } = await admin
    .from('organizations')
    .select('id, created_by_user_id')
    .eq('id', organizationId)
    .maybeSingle()

  if (!org || org.created_by_user_id !== options.invitedByUserId) return

  await admin
    .from('organization_memberships')
    .delete()
    .eq('organization_id', organizationId)
    .eq('user_id', options.invitedByUserId)

  // Clear org pointer on any remaining invite rows before delete.
  await admin
    .from('carrier_connection_invites')
    .update({ organization_id: null })
    .eq('organization_id', organizationId)

  await admin.from('organizations').delete().eq('id', organizationId)
}

/**
 * Reuse a pending shell org for the same inviter when re-inviting the same USDOT
 * or when a prior invite for this email left an ownerless shell.
 */
async function resolveShellOrganizationId(options: {
  admin: NonNullable<typeof supabaseAdmin>
  invitedByUserId: string
  validated: CreateCarrierConnectionInviteValidated
}): Promise<{ organizationId: string; reused: boolean }> {
  const { admin, invitedByUserId, validated } = options

  // Prefer open pending invite for same email from this inviter (re-invite path).
  const { data: pendingByEmail } = await admin
    .from('carrier_connection_invites')
    .select('*')
    .eq('invited_by_user_id', invitedByUserId)
    .eq('status', 'pending')
    .eq('invite_email', validated.invite_email)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (pendingByEmail?.organization_id) {
    const noPrimary = await orgHasNoPrimaryOwner(admin, pendingByEmail.organization_id)
    if (noPrimary) {
      const { error: updateError } = await admin
        .from('organizations')
        .update({
          name: validated.company_name,
          usdot_number: validated.usdot_number,
          mc_number: validated.mc_number,
        })
        .eq('id', pendingByEmail.organization_id)

      if (updateError) {
        if (isUsdotConflictError(updateError.message)) {
          throw new Error(
            'A carrier with this USDOT already exists. Use Request Access to link to that account.'
          )
        }
        throw new Error(updateError.message)
      }

      return { organizationId: pendingByEmail.organization_id, reused: true }
    }
  }

  // Reuse shell by USDOT when inviter created it and it still has no primary.
  if (validated.usdot_number) {
    const { data: existingOrg, error: usdotError } = await admin
      .from('organizations')
      .select('id, created_by_user_id')
      .eq('usdot_number', validated.usdot_number)
      .maybeSingle()

    if (usdotError) throw new Error(usdotError.message)

    if (existingOrg?.id) {
      const noPrimary = await orgHasNoPrimaryOwner(admin, existingOrg.id)
      if (
        noPrimary &&
        existingOrg.created_by_user_id === invitedByUserId
      ) {
        const { error: updateError } = await admin
          .from('organizations')
          .update({
            name: validated.company_name,
            mc_number: validated.mc_number,
          })
          .eq('id', existingOrg.id)

        if (updateError) {
          if (isUsdotConflictError(updateError.message)) {
            throw new Error(
              'A carrier with this USDOT already exists. Use Request Access to link to that account.'
            )
          }
          throw new Error(updateError.message)
        }

        // Ensure clerk membership exists.
        await admin.from('organization_memberships').upsert(
          {
            organization_id: existingOrg.id,
            user_id: invitedByUserId,
            role: 'Permit Clerk',
            is_primary_owner: false,
            permissions: { mode: 'global' },
          },
          { onConflict: 'organization_id,user_id' }
        )

        return { organizationId: existingOrg.id, reused: true }
      }

      throw new Error(
        'A carrier with this USDOT already exists. Use Request Access to link to that account.'
      )
    }
  }

  const organizationId = crypto.randomUUID()
  const { error: orgError } = await admin.from('organizations').insert({
    id: organizationId,
    name: validated.company_name,
    usdot_number: validated.usdot_number,
    mc_number: validated.mc_number,
    created_by_user_id: invitedByUserId,
  })

  if (orgError) {
    if (isUsdotConflictError(orgError.message)) {
      throw new Error(
        'A carrier with this USDOT already exists. Use Request Access to link to that account.'
      )
    }
    throw new Error(orgError.message)
  }

  const { error: membershipError } = await admin.from('organization_memberships').insert({
    organization_id: organizationId,
    user_id: invitedByUserId,
    role: 'Permit Clerk',
    is_primary_owner: false,
    permissions: { mode: 'global' },
  })

  if (membershipError) {
    await admin.from('organizations').delete().eq('id', organizationId)
    throw new Error(membershipError.message)
  }

  return { organizationId, reused: false }
}

export async function createCarrierConnectionInvite(options: {
  actor: MemberProfile
  invitedByUserId: string
  input: CreateCarrierConnectionInviteInput
  appBaseUrl: string
  membershipRoles?: readonly string[] | null
}): Promise<CreateCarrierConnectionInviteResult> {
  if (!canCreateCarrierConnectionInvite(options.actor, options.membershipRoles)) {
    throw new Error('Forbidden – only Permit Clerk can add carriers')
  }

  const validated = validateCreateCarrierConnectionInviteInput(options.input)
  const admin = requireAdmin()

  // Resolve shell first (may reuse pending email/USDOT shell).
  // Insert the new invite BEFORE revoking priors so a failed insert never
  // leaves the inviter without a pending invite / shell.
  const { organizationId, reused } = await resolveShellOrganizationId({
    admin,
    invitedByUserId: options.invitedByUserId,
    validated,
  })

  const record = buildCarrierConnectionInviteRecord({
    invitedByUserId: options.invitedByUserId,
    organizationId,
    validated,
    appBaseUrl: options.appBaseUrl,
  })

  const { data: invite, error: inviteError } = await admin
    .from('carrier_connection_invites')
    .insert(record)
    .select('*')
    .single()

  if (inviteError || !invite) {
    // Only tear down a brand-new shell; never cleanup a reused shell after failed insert.
    if (!reused) {
      await cleanupShellOrgIfOrphaned({
        organizationId,
        invitedByUserId: options.invitedByUserId,
      })
    }
    throw new Error(inviteError?.message ?? 'Failed to create carrier connection invite')
  }

  // After successful insert: revoke other live invites for this shell (any email)
  // and other pending invites to the same email (other shells).
  const { data: otherPending } = await admin
    .from('carrier_connection_invites')
    .select('id, organization_id, invite_email')
    .eq('invited_by_user_id', options.invitedByUserId)
    .eq('status', 'pending')
    .neq('id', invite.id)

  const revokeCandidates = (otherPending ?? []).filter(
    (row) =>
      row.organization_id === organizationId ||
      String(row.invite_email ?? '').toLowerCase() === validated.invite_email
  )

  if (revokeCandidates.length > 0) {
    const revokeIds = revokeCandidates.map((row) => row.id)
    await admin
      .from('carrier_connection_invites')
      .update({ status: 'revoked' })
      .in('id', revokeIds)
      .eq('status', 'pending')

    // Cleanup orphan shells for revoked invites (never the org we just used).
    for (const prior of revokeCandidates) {
      if (prior.organization_id === organizationId) continue
      await cleanupShellOrgIfOrphaned({
        organizationId: prior.organization_id,
        invitedByUserId: options.invitedByUserId,
        excludeInviteId: prior.id,
      })
    }
  }

  const companyName = validated.company_name
  const inviteLink = record.invite_link ?? ''
  const notifications = sendInviteNotifications({
    invite: {
      role: 'Carrier Owner',
      invite_email: record.invite_email,
      invite_phone: record.invite_phone,
      invite_link: record.invite_link,
    },
    emailSubject: formatCarrierConnectionEmailSubject(companyName),
    emailBody: inviteLink
      ? formatCarrierConnectionEmailBody(
          inviteLink,
          companyName,
          validated.invite_contact_name,
          validated.message
        )
      : undefined,
    smsBody: inviteLink
      ? formatCarrierConnectionSmsBody(inviteLink, companyName, validated.message)
      : undefined,
  })

  return {
    invite: redactCarrierConnectionInviteForClient(invite as CarrierConnectionInvite),
    email: notifications.email,
    sms: notifications.sms,
  }
}

export async function revokeCarrierConnectionInvite(options: {
  invitedByUserId: string
  inviteId: string
}): Promise<ReturnType<typeof redactCarrierConnectionInviteForClient>> {
  const admin = requireAdmin()
  const { data, error } = await admin
    .from('carrier_connection_invites')
    .update({ status: 'revoked' })
    .eq('id', options.inviteId)
    .eq('invited_by_user_id', options.invitedByUserId)
    .eq('status', 'pending')
    .select('*')
    .single()

  if (error) throw new Error(error.message)

  const invite = data as CarrierConnectionInvite
  await cleanupShellOrgIfOrphaned({
    organizationId: invite.organization_id,
    invitedByUserId: options.invitedByUserId,
    excludeInviteId: invite.id,
  })

  return redactCarrierConnectionInviteForClient(invite)
}

export async function fetchCarrierConnectionInviteByTokenAdmin(
  token: string
): Promise<CarrierConnectionInvite | null> {
  if (!hasAdminAccess || !supabaseAdmin) return null

  const { data, error } = await supabaseAdmin
    .from('carrier_connection_invites')
    .select('*')
    .eq('invite_token', token)
    .maybeSingle()

  if (error) throw new Error(error.message)
  return (data as CarrierConnectionInvite | null) ?? null
}

/** Defense-in-depth checks shared by admin accept path (mirrors RPC). */
export async function assertAcceptDefenseInDepth(options: {
  invite: CarrierConnectionInvite
  acceptorUserId: string
}): Promise<void> {
  const admin = requireAdmin()
  const organizationId = options.invite.organization_id
  if (!organizationId) {
    throw new Error('Invite is missing organization')
  }

  const { data: inviterMembership, error: inviterError } = await admin
    .from('organization_memberships')
    .select('role, is_primary_owner')
    .eq('organization_id', organizationId)
    .eq('user_id', options.invite.invited_by_user_id)
    .maybeSingle()

  if (inviterError) throw new Error(inviterError.message)
  if (!inviterMembership) {
    throw new Error(CARRIER_CONNECTION_INVITE_UNAVAILABLE_MESSAGE)
  }

  // Phase 1: inviter on shell must be Permit Clerk (create path always attaches Clerk).
  const role = String(inviterMembership.role ?? '')
  if (role !== 'Permit Clerk') {
    throw new Error(CARRIER_CONNECTION_INVITE_UNAVAILABLE_MESSAGE)
  }

  const { data: otherPrimary, error: primaryError } = await admin
    .from('organization_memberships')
    .select('user_id')
    .eq('organization_id', organizationId)
    .eq('is_primary_owner', true)
    .neq('user_id', options.acceptorUserId)
    .limit(1)
    .maybeSingle()

  if (primaryError) throw new Error(primaryError.message)
  if (otherPrimary?.user_id) {
    throw new Error('This carrier already has a primary owner')
  }
}

export async function previewCarrierConnectionInviteForUser(options: {
  supabase: SupabaseClient
  token: string
  acceptorEmail?: string | null
}): Promise<CarrierConnectionInvitePreview | null> {
  const { supabase, token, acceptorEmail } = options

  try {
    const { data, error } = await supabase.rpc('preview_carrier_connection_invite', {
      p_token: token,
    })
    if (error) throw error
    if (!data || typeof data !== 'object') return null
    return data as CarrierConnectionInvitePreview
  } catch (rpcError) {
    const invite = await fetchCarrierConnectionInviteByTokenAdmin(token)
    if (!invite) {
      throw rpcError instanceof Error ? rpcError : new Error('Failed to load invite')
    }

    const validation = validateAcceptCarrierConnectionInvite(invite, {
      token,
      acceptorUserId: '',
      acceptorEmail,
    })

    if (validation.ok === false) {
      return null
    }

    return {
      id: invite.id,
      company_name: invite.company_name,
      usdot_number: invite.usdot_number,
      invite_email: invite.invite_email,
      invite_contact_name: invite.invite_contact_name,
      organization_id: invite.organization_id,
      expires_at: invite.expires_at,
      status: invite.status,
    }
  }
}

async function restoreCarrierInviteClaimIfNeeded(
  inviteId: string,
  userId: string
): Promise<void> {
  if (!hasAdminAccess || !supabaseAdmin) return

  const { error } = await supabaseAdmin
    .from('carrier_connection_invites')
    .update({
      status: 'pending',
      accepted_by_user_id: null,
      accepted_at: null,
    })
    .eq('id', inviteId)
    .eq('status', 'accepted')
    .eq('accepted_by_user_id', userId)

  if (error) {
    console.warn('[carrier-connection-invite] claim restore failed', error.message)
  }
}

/** Admin fallback when RPC is unavailable. */
export async function acceptCarrierConnectionInviteViaAdmin(
  input: AcceptCarrierConnectionInviteInput
): Promise<AcceptCarrierConnectionInviteOutcome> {
  const admin = requireAdmin()
  const invite = await fetchCarrierConnectionInviteByTokenAdmin(input.token)
  const validation = validateAcceptCarrierConnectionInvite(invite, input)

  if (validation.ok === false) {
    throw new Error(validation.message)
  }

  const acceptedInvite = validation.invite
  const organizationId = acceptedInvite.organization_id
  if (!organizationId) {
    throw new Error('Invite is missing organization')
  }

  await assertAcceptDefenseInDepth({
    invite: acceptedInvite,
    acceptorUserId: input.acceptorUserId,
  })

  const { data: claimed, error: claimError } = await admin
    .from('carrier_connection_invites')
    .update({
      status: 'accepted',
      accepted_by_user_id: input.acceptorUserId,
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

  let membershipCommitted = false

  try {
    const { data: existingMembership, error: memLookupError } = await admin
      .from('organization_memberships')
      .select('is_primary_owner, role, permissions')
      .eq('organization_id', organizationId)
      .eq('user_id', input.acceptorUserId)
      .maybeSingle()

    if (memLookupError) throw new Error(memLookupError.message)

    const keepPrimary = existingMembership?.is_primary_owner === true
    const { error: membershipError } = await admin.from('organization_memberships').upsert(
      {
        organization_id: organizationId,
        user_id: input.acceptorUserId,
        role: keepPrimary ? String(existingMembership?.role ?? 'Owner') : 'Owner',
        is_primary_owner: true,
        permissions:
          existingMembership?.permissions != null
            ? existingMembership.permissions
            : { mode: 'global' },
      },
      { onConflict: 'organization_id,user_id' }
    )

    if (membershipError) throw new Error(membershipError.message)
    membershipCommitted = true

    const { data: existingProfile, error: existingError } = await admin
      .from('member_profiles')
      .select('*')
      .eq('user_id', input.acceptorUserId)
      .maybeSingle()

    if (existingError) throw new Error(existingError.message)

    const existingOrgId = (existingProfile as { organization_id?: string | null } | null)
      ?.organization_id
    const existingIsPrimary = (existingProfile as { is_primary_owner?: boolean | null } | null)
      ?.is_primary_owner

    const multiOrgJoin = isMultiOrgInviteJoin({
      existingOrganizationId: existingOrgId,
      inviteOrganizationId: organizationId,
    })

    const rewriteHome = shouldRewriteHomeProfileOnInviteAccept({
      existingOrganizationId: existingOrgId,
      existingIsPrimaryOwner: existingIsPrimary,
      inviteOrganizationId: organizationId,
    })

    const roles = validateUserRoles(['Owner'])

    if (rewriteHome) {
      const carrierFields = {
        company_name: acceptedInvite.company_name,
        usdot_number: acceptedInvite.usdot_number ?? '',
        mc_number: acceptedInvite.mc_number ?? '',
        ein: acceptedInvite.ein ?? '',
        carrier_address: acceptedInvite.carrier_address ?? '',
        carrier_phone: acceptedInvite.carrier_phone ?? '',
        carrier_email:
          acceptedInvite.carrier_email || acceptedInvite.invite_email || '',
        insurance_contact: acceptedInvite.insurance_contact ?? '',
        driver_full_name: acceptedInvite.invite_contact_name ?? '',
        driver_email: acceptedInvite.invite_email ?? '',
        driver_phone: acceptedInvite.invite_phone ?? '',
      }

      if (existingProfile) {
        const mergedForm = memberProfileFromRow(
          existingProfile as Parameters<typeof memberProfileFromRow>[0]
        )
        mergedForm.user_roles = roles
        Object.assign(mergedForm, {
          company_name: mergedForm.company_name || carrierFields.company_name,
          usdot_number: mergedForm.usdot_number || carrierFields.usdot_number,
          mc_number: mergedForm.mc_number || carrierFields.mc_number,
          ein: mergedForm.ein || carrierFields.ein,
          carrier_address: mergedForm.carrier_address || carrierFields.carrier_address,
          carrier_phone: mergedForm.carrier_phone || carrierFields.carrier_phone,
          carrier_email: mergedForm.carrier_email || carrierFields.carrier_email,
          insurance_contact: mergedForm.insurance_contact || carrierFields.insurance_contact,
          driver_full_name: mergedForm.driver_full_name || carrierFields.driver_full_name,
          driver_email: mergedForm.driver_email || carrierFields.driver_email,
          driver_phone: mergedForm.driver_phone || carrierFields.driver_phone,
        })

        const profilePayload = memberProfileToUpsertPayloadWithoutCarrier(
          mergedForm,
          input.acceptorUserId,
          existingProfile as Parameters<typeof memberProfileToUpsertPayloadWithoutCarrier>[2]
        )
        Object.assign(profilePayload, {
          organization_id: organizationId,
          is_primary_owner: true,
          company_name: mergedForm.company_name,
          usdot_number: mergedForm.usdot_number,
          mc_number: mergedForm.mc_number,
          ein: mergedForm.ein,
          carrier_address: mergedForm.carrier_address,
          carrier_phone: mergedForm.carrier_phone,
          carrier_email: mergedForm.carrier_email,
          insurance_contact: mergedForm.insurance_contact,
        })

        const { error: profileError } = await admin
          .from('member_profiles')
          .update(profilePayload)
          .eq('user_id', input.acceptorUserId)

        if (profileError) throw new Error(profileError.message)
      } else {
        const form = {
          ...emptyMemberProfileForm(),
          user_roles: roles,
          ...carrierFields,
        }
        const profilePayload = memberProfileToUpsertPayloadWithoutCarrier(
          form,
          input.acceptorUserId,
          null
        )
        Object.assign(profilePayload, {
          organization_id: organizationId,
          is_primary_owner: true,
          company_name: carrierFields.company_name,
          usdot_number: carrierFields.usdot_number,
          mc_number: carrierFields.mc_number,
          ein: carrierFields.ein,
          carrier_address: carrierFields.carrier_address,
          carrier_phone: carrierFields.carrier_phone,
          carrier_email: carrierFields.carrier_email,
          insurance_contact: carrierFields.insurance_contact,
          driver_full_name: carrierFields.driver_full_name,
          driver_email: carrierFields.driver_email,
          driver_phone: carrierFields.driver_phone,
        })

        const { error: profileError } = await admin.from('member_profiles').insert(profilePayload)
        if (profileError) throw new Error(profileError.message)
      }
    }

    return {
      invite: claimed as CarrierConnectionInvite,
      multiOrgJoin,
      organizationId,
    }
  } catch (grantError) {
    if (!membershipCommitted) {
      await restoreCarrierInviteClaimIfNeeded(acceptedInvite.id, input.acceptorUserId)
    } else {
      console.warn(
        '[carrier-connection-invite] post-membership step failed; invite left accepted',
        grantError instanceof Error ? grantError.message : grantError
      )
    }
    throw grantError
  }
}

export async function acceptCarrierConnectionInviteForUser(options: {
  supabase: SupabaseClient
  userId: string
  acceptorEmail?: string | null
  token: string
}): Promise<AcceptCarrierConnectionInviteOutcome> {
  const { supabase, userId, acceptorEmail, token } = options

  const { data: priorProfile } = await supabase
    .from('member_profiles')
    .select('organization_id, is_primary_owner')
    .eq('user_id', userId)
    .maybeSingle()

  const priorOrgId = (priorProfile as { organization_id?: string | null } | null)?.organization_id

  try {
    const { data, error } = await supabase.rpc('accept_carrier_connection_invite', {
      p_token: token,
    })
    if (error) throw error
    const invite = data as CarrierConnectionInvite
    const organizationId = invite.organization_id
    if (!organizationId) {
      throw new Error('Invite is missing organization')
    }
    return {
      invite,
      multiOrgJoin: isMultiOrgInviteJoin({
        existingOrganizationId: priorOrgId,
        inviteOrganizationId: organizationId,
      }),
      organizationId,
    }
  } catch (rpcError) {
    const message = rpcError instanceof Error ? rpcError.message : String(rpcError)
    const rpcMissing =
      message.toLowerCase().includes('function') ||
      message.toLowerCase().includes('could not find') ||
      message.toLowerCase().includes('schema cache')
    if (!rpcMissing) {
      throw rpcError instanceof Error ? rpcError : new Error(message)
    }
    return acceptCarrierConnectionInviteViaAdmin({
      token,
      acceptorUserId: userId,
      acceptorEmail,
    })
  }
}

export { CARRIER_CONNECTION_INVITE_UNAVAILABLE_MESSAGE, canCreateCarrierConnectionInvite }
