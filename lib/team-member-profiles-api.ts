import { createClient } from '@supabase/supabase-js'
import { hasAdminAccess, supabaseAdmin } from '@/lib/supabase'
import {
  canDeleteMember,
  canEditMember,
  canManageMemberPermissions,
  canWriteTeamData,
  isPrimaryOwner,
  parseTeamMemberPermissions,
} from '@/lib/member-profile-permissions'
import { isForcedCarrierOwner } from '@/lib/forced-carrier-owner'
import { resolveActingRolesFromInputs } from '@/lib/nav-actor'
import {
  applySelfSaveScope,
  assertAssignableTeamMemberRoles,
  buildMemberProfileSavePayloadWithoutCarrier,
  buildTeamMemberChildRosterPayload,
  canSelfEditRoles,
  ensureBootstrapOwnerRoles,
  hasCarrierData,
  hasOwnerOrAdminRole,
  logCarrierSaveDebug,
  memberProfileFromRow,
  memberProfileToUpsertPayloadWithoutCarrier,
  clampSelfSaveRolesFromTeamContext,
  needsPrimaryOwnerBootstrap,
  normalizeBootstrapSelfRoles,
  pickCarrierInheritanceSource,
  resolveSelfSaveOrganizationId,
  prepareMemberProfileSave,
  validateBootstrapCarrierOnlySave,
  validateBootstrapCarrierSaveRoles,
  validateBootstrapSelfSave,
  validateUserRoles,
  type MemberProfileSaveScope,
  type OrganizationMembershipLink,
} from '@/lib/member-profile'
import {
  fetchActorTeamContext,
  fetchOrganizationMembershipForOrg,
} from '@/lib/roster-profile-link'
import type { UserRole } from '@/types/member-profile'
import { createDeletionRequest } from '@/lib/deletion-requests'
import {
  canActorRequestMemberDeletion,
  mapMemberSourceToResourceType,
  parseMemberPermissionConfig,
} from '@/lib/team-permissions'
import {
  applyDriverRestrictedFieldBaseline,
  isDriverSelfServiceActor,
} from '@/lib/profile-field-permissions'
import { assertNotSelfPromoteToPermitClerk } from '@/lib/team-invites'
import type { MemberProfile, MemberProfileFormData } from '@/types/member-profile'
import type { OrganizationRole } from '@/types/organization'

function getSupabaseUrl(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!url) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL')
  return url
}

function getSupabaseAnonKey(): string {
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!key) throw new Error('Missing NEXT_PUBLIC_SUPABASE_ANON_KEY')
  return key
}

function primaryRoleFromUserRoles(
  roles: string[] | undefined,
  options?: { isPrimaryOwner?: boolean }
): OrganizationRole {
  const validated = validateUserRoles(roles, options)
  if (validated.includes('Owner')) return 'Owner'
  if (validated.includes('Admin')) return 'Admin'
  if (validated.includes('Permit Clerk')) return 'Permit Clerk'
  if (validated.includes('Driver')) return 'Driver'
  if (validated.includes('Viewer')) return 'Viewer'
  return 'Viewer'
}

/**
 * Sync membership role from profile/roster roles (primaryRoleFromUserRoles).
 * Always pass actorUserId when available so self-promote PE runs (Issue 11).
 *
 * - Preserves existing is_primary_owner (never force false for primary).
 * - When permissions omitted: preserve custom only if role is unchanged; reset to
 *   global on role change so demotes cannot keep elevated custom writes.
 * Roster `user_roles[]` is display/edit; membership.role is authz for linked users.
 */
async function syncOrganizationMembershipForMember(
  supabase: ReturnType<typeof createAuthedSupabaseClient>,
  organizationId: string,
  userId: string,
  roles: string[] | undefined,
  permissions?: unknown,
  actorUserId?: string
): Promise<void> {
  const nextRole = primaryRoleFromUserRoles(roles)

  const { data: existing } = await supabase
    .from('organization_memberships')
    .select('role, permissions, is_primary_owner')
    .eq('organization_id', organizationId)
    .eq('user_id', userId)
    .maybeSingle()

  const previousRole = typeof existing?.role === 'string' ? existing.role : null
  // Preserve primary flag; only bootstrap/explicit paths set true.
  const preservedPrimaryOwner = existing?.is_primary_owner === true

  let resolvedPermissions = permissions
  if (permissions === undefined) {
    if (previousRole != null && previousRole === nextRole) {
      resolvedPermissions = existing?.permissions ?? { mode: 'global' }
    } else {
      // Role change or new row: drop custom overrides (fail closed to role defaults).
      resolvedPermissions = { mode: 'global' }
    }
  }

  if (actorUserId) {
    assertNotSelfPromoteToPermitClerk({
      actorUserId,
      targetUserId: userId,
      nextRole,
      previousRole,
    })
  }

  const { error } = await supabase.from('organization_memberships').upsert(
    {
      organization_id: organizationId,
      user_id: userId,
      role: nextRole,
      is_primary_owner: preservedPrimaryOwner,
      permissions: parseMemberPermissionConfig(resolvedPermissions ?? { mode: 'global' }),
    },
    { onConflict: 'organization_id,user_id' }
  )

  if (error) throw new Error(error.message)
}

async function removeOrganizationMembership(
  supabase: ReturnType<typeof createAuthedSupabaseClient>,
  organizationId: string,
  userId: string
): Promise<void> {
  const { error } = await supabase
    .from('organization_memberships')
    .delete()
    .eq('organization_id', organizationId)
    .eq('user_id', userId)

  if (error) throw new Error(error.message)
}

type OrganizationWriteClient = ReturnType<typeof createAuthedSupabaseClient>

function isNewOrganizationBootstrap(
  payload: Record<string, unknown>,
  actorProfile: MemberProfile | null
): boolean {
  return (
    payload.is_primary_owner === true &&
    typeof payload.organization_id === 'string' &&
    !actorProfile?.organization_id
  )
}

/** Creates the organizations row before member_profiles FK insert on first Owner bootstrap. */
export async function ensureOrganizationRecord(
  supabase: OrganizationWriteClient,
  userId: string,
  organizationId: string,
  profile: Pick<MemberProfile, 'company_name' | 'usdot_number' | 'mc_number'>
): Promise<void> {
  const { error: orgError } = await supabase.from('organizations').upsert(
    {
      id: organizationId,
      name: profile.company_name,
      usdot_number: profile.usdot_number,
      mc_number: profile.mc_number,
      created_by_user_id: userId,
    },
    { onConflict: 'id' }
  )

  if (orgError) throw new Error(orgError.message)
}

async function ensureOrganizationMembership(
  supabase: OrganizationWriteClient,
  userId: string,
  profile: MemberProfile
): Promise<void> {
  const nextRole = primaryRoleFromUserRoles(profile.user_roles as string[] | undefined, {
    isPrimaryOwner: true,
  })

  // Phase 1 PE: primary-owner bootstrap path must not self-promote to Permit Clerk.
  if (nextRole === 'Permit Clerk' && profile.organization_id) {
    const { data: existing } = await supabase
      .from('organization_memberships')
      .select('role')
      .eq('organization_id', profile.organization_id)
      .eq('user_id', userId)
      .maybeSingle()
    assertNotSelfPromoteToPermitClerk({
      actorUserId: userId,
      targetUserId: userId,
      nextRole,
      previousRole: typeof existing?.role === 'string' ? existing.role : null,
    })
  }

  const { error: membershipError } = await supabase.from('organization_memberships').upsert(
    {
      organization_id: profile.organization_id,
      user_id: userId,
      role: nextRole,
      is_primary_owner: true,
      permissions: { mode: 'global' },
    },
    { onConflict: 'organization_id,user_id' }
  )

  if (membershipError) throw new Error(membershipError.message)
}

export async function ensureOrganizationBootstrap(
  supabase: OrganizationWriteClient,
  userId: string,
  profile: MemberProfile,
  options?: { organizationRecordExists?: boolean; isNewBootstrap?: boolean }
): Promise<void> {
  if (!profile.organization_id || !profile.is_primary_owner) return

  if (!options?.organizationRecordExists) {
    await ensureOrganizationRecord(supabase, userId, profile.organization_id, profile)
  }

  const membershipClient =
    options?.isNewBootstrap && hasAdminAccess && supabaseAdmin ? supabaseAdmin : supabase

  await ensureOrganizationMembership(membershipClient, userId, profile)
}

export function createAuthedSupabaseClient(token: string) {
  return createClient(getSupabaseUrl(), getSupabaseAnonKey(), {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  })
}

export async function getAuthenticatedMemberProfile(token: string): Promise<{
  supabase: ReturnType<typeof createAuthedSupabaseClient>
  userId: string
  profile: MemberProfile
}> {
  const supabase = createAuthedSupabaseClient(token)
  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError || !userData.user) {
    throw new Error('Unauthorized – invalid token')
  }

  const { data: profile, error: profileError } = await supabase
    .from('member_profiles')
    .select('*')
    .eq('user_id', userData.user.id)
    .maybeSingle()

  if (profileError || !profile) {
    throw new Error('Member profile not found')
  }

  return {
    supabase,
    userId: userData.user.id,
    profile: profile as MemberProfile,
  }
}

function normalizeSaveScope(raw: unknown): MemberProfileSaveScope {
  if (raw === 'carrier_only' || raw === 'member_only' || raw === 'full') {
    return raw
  }
  return 'full'
}

/** Forced-owner self-saves that promote to primary owner or bootstrap an org need the admin client. */
function forcedCarrierOwnerNeedsAdminPromotion(
  actorProfile: MemberProfile | null
): boolean {
  if (!actorProfile) return true
  if (!actorProfile.organization_id) return true
  if (!actorProfile.is_primary_owner) return true
  return false
}

/**
 * Membership-first acting permission actor for a target org (§4.1).
 * OO merge only when effective org is home; foreign membership never uses home multi-select.
 */
export function buildActingPermissionActor(options: {
  userId: string
  homeProfile?: Pick<
    MemberProfile,
    'organization_id' | 'is_primary_owner' | 'user_roles'
  > | null
  membership?: OrganizationMembershipLink | null
  /** Defaults to membership org, then home org. */
  effectiveOrgId?: string | null
}): {
  user_id: string
  user_roles: UserRole[]
  is_primary_owner: boolean
} {
  const homeOrgId = options.homeProfile?.organization_id ?? null
  const membership = options.membership ?? null
  const effectiveOrgId =
    options.effectiveOrgId ?? membership?.organization_id ?? homeOrgId ?? null

  // Only pass membership inputs when they apply to the effective org.
  const membershipForEffective =
    membership &&
    effectiveOrgId &&
    membership.organization_id === effectiveOrgId
      ? membership
      : null

  const acting = resolveActingRolesFromInputs({
    membershipRole: membershipForEffective?.role ?? null,
    membershipIsPrimaryOwner: membershipForEffective?.is_primary_owner ?? null,
    homeOrgId,
    homeIsPrimaryOwner: options.homeProfile?.is_primary_owner ?? null,
    homeUserRoles: options.homeProfile?.user_roles,
    effectiveOrgId,
  })

  return {
    user_id: options.userId,
    user_roles: acting.user_roles,
    is_primary_owner: acting.is_primary_owner,
  }
}

/** Load membership for target org and build acting permission actor. */
export async function resolveActingPermissionActorForOrg(
  supabase: ReturnType<typeof createAuthedSupabaseClient>,
  userId: string,
  homeProfile: MemberProfile | null,
  targetOrgId: string | null | undefined
): Promise<{
  user_id: string
  user_roles: UserRole[]
  is_primary_owner: boolean
}> {
  const effectiveOrgId = targetOrgId ?? homeProfile?.organization_id ?? null
  const membership = await fetchOrganizationMembershipForOrg(
    supabase,
    userId,
    effectiveOrgId
  )
  return buildActingPermissionActor({
    userId,
    homeProfile,
    membership,
    effectiveOrgId,
  })
}

/** Bootstrap (null actor), primary owners, and Owner/Admin role holders may save carrier_only. */
export function canActorSaveCarrierOnlyScope(
  actorProfile: MemberProfile | null,
  form?: Pick<MemberProfileFormData, 'user_roles'>,
  actorEmail?: string | null
): boolean {
  if (isForcedCarrierOwner(actorEmail)) return true
  if (!actorProfile) return true
  if (isPrimaryOwner(actorProfile)) return true
  if (hasOwnerOrAdminRole(actorProfile.user_roles as string[] | undefined)) return true
  if (
    !actorProfile.organization_id &&
    form &&
    hasOwnerOrAdminRole(form.user_roles as string[] | undefined)
  ) {
    return true
  }
  return false
}

export function selfSaveFormForActor(
  form: MemberProfileFormData,
  actorProfile: MemberProfile | null,
  saveScope: MemberProfileSaveScope
): MemberProfileFormData {
  const rolesAllowed = !actorProfile || canSelfEditRoles(actorProfile)
  let formWithRoles = rolesAllowed
    ? form
    : {
        ...form,
        user_roles: validateUserRoles(actorProfile?.user_roles as string[] | undefined),
      }

  let effectiveScope = saveScope
  if (actorProfile && isDriverSelfServiceActor(actorProfile)) {
    if (saveScope === 'full') {
      effectiveScope = 'member_only'
    }
    if (effectiveScope !== 'carrier_only') {
      formWithRoles = applyDriverRestrictedFieldBaseline(
        formWithRoles,
        memberProfileFromRow(actorProfile)
      )
    }
  }

  return applySelfSaveScope(formWithRoles, actorProfile, effectiveScope)
}

export async function saveTeamMemberProfileForUser(
  token: string,
  body: {
    id?: string
    form: MemberProfileFormData
    targetUserId?: string
    linkedUserId?: string | null
    saveScope?: MemberProfileSaveScope
    permissions?: unknown
  }
) {
  const supabase = createAuthedSupabaseClient(token)
  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError || !userData.user) {
    throw new Error('Unauthorized – invalid token')
  }

  const userId = userData.user.id
  const actorEmail = userData.user.email
  const forcedCarrierOwner = isForcedCarrierOwner(actorEmail)
  const { data: actorProfileRow, error: profileError } = await supabase
    .from('member_profiles')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle()

  if (profileError) {
    throw new Error(profileError.message)
  }

  const actorProfile = (actorProfileRow as MemberProfile | null) ?? null
  const targetUserId = body.targetUserId?.trim()
  const editingSelf = !targetUserId || targetUserId === userId

  if (editingSelf) {
    const saveScope = normalizeSaveScope(body.saveScope)

    let formForSave = selfSaveFormForActor(body.form, actorProfile, saveScope)

    const { linkedRoster, organizationMembership } = await fetchActorTeamContext(
      supabase,
      userId,
      actorEmail
    )

    // Membership-first authz for home org (or preferred membership when no home org yet).
    const homeOrgId = actorProfile?.organization_id ?? null
    const membershipForAuthz = homeOrgId
      ? await fetchOrganizationMembershipForOrg(supabase, userId, homeOrgId)
      : organizationMembership
    const actingActor = buildActingPermissionActor({
      userId,
      homeProfile: actorProfile,
      membership: membershipForAuthz,
      effectiveOrgId: homeOrgId ?? membershipForAuthz?.organization_id ?? null,
    })

    if (
      actorProfile &&
      !canWriteTeamData(actingActor) &&
      !(forcedCarrierOwner && saveScope === 'carrier_only')
    ) {
      throw new Error('Forbidden – viewer accounts cannot edit profiles')
    }

    const shouldBootstrap = needsPrimaryOwnerBootstrap({
      actorEmail,
      ownProfile: actorProfile,
      linkedRoster,
      organizationMembership,
    })

    if (shouldBootstrap) {
      if (saveScope === 'full') {
        const bootstrapValidation = validateBootstrapSelfSave(formForSave)
        if (bootstrapValidation.ok === false) {
          throw new Error(bootstrapValidation.message)
        }
        formForSave = normalizeBootstrapSelfRoles(bootstrapValidation.form, actorProfile)
      } else {
        const carrierValidation = validateBootstrapCarrierOnlySave(formForSave)
        if (carrierValidation.ok === false) {
          throw new Error(carrierValidation.message)
        }
        formForSave = normalizeBootstrapSelfRoles(carrierValidation.form, actorProfile)
      }

      const roleCheck = validateBootstrapCarrierSaveRoles(formForSave, actorProfile, actorEmail)
      if (roleCheck.ok === false) {
        throw new Error(roleCheck.message)
      }
    } else if (
      !shouldBootstrap &&
      !actorProfile?.organization_id &&
      (linkedRoster || organizationMembership)
    ) {
      formForSave = clampSelfSaveRolesFromTeamContext(
        formForSave,
        linkedRoster,
        organizationMembership
      )
    } else if (saveScope === 'carrier_only' && forcedCarrierOwner) {
      formForSave = ensureBootstrapOwnerRoles(formForSave)
    }

    // Carrier-only gate uses acting roles/primary for home org (membership-first).
    const carrierScopeProfile = actorProfile
      ? {
          ...actorProfile,
          user_roles: actingActor.user_roles,
          is_primary_owner: actingActor.is_primary_owner,
        }
      : null
    if (
      saveScope === 'carrier_only' &&
      !canActorSaveCarrierOnlyScope(carrierScopeProfile, formForSave, actorEmail)
    ) {
      throw new Error(
        'Forbidden – only primary owners or Owner/Admin accounts can save carrier-only updates'
      )
    }

    const payload = prepareMemberProfileSave(formForSave, userId, actorProfile, actorEmail)

    const resolvedOrgId = resolveSelfSaveOrganizationId(
      actorProfile,
      linkedRoster,
      organizationMembership
    )
    if (!shouldBootstrap && !actorProfile?.organization_id && !payload.organization_id && resolvedOrgId) {
      payload.organization_id = resolvedOrgId
      payload.is_primary_owner = false
    }

    if (saveScope === 'carrier_only') {
      logCarrierSaveDebug('server before upsert', {
        actorOrgId: actorProfile?.organization_id ?? null,
        payloadOrgId: payload.organization_id ?? null,
        company_name: payload.company_name ?? null,
        save_scope: saveScope,
      })
    }

    const needsAdminPromotion =
      forcedCarrierOwner && forcedCarrierOwnerNeedsAdminPromotion(actorProfile)

    if (needsAdminPromotion && !(hasAdminAccess && supabaseAdmin)) {
      throw new Error(
        'Carrier save requires SUPABASE_SERVICE_ROLE_KEY on server for account promotion.'
      )
    }

    const upsertClient =
      forcedCarrierOwner && hasAdminAccess && supabaseAdmin ? supabaseAdmin : supabase

    const bootstrappingNewOrg = isNewOrganizationBootstrap(payload, actorProfile)
    if (bootstrappingNewOrg) {
      await ensureOrganizationRecord(
        upsertClient,
        userId,
        payload.organization_id as string,
        {
          company_name: String(payload.company_name ?? ''),
          usdot_number: payload.usdot_number as string | undefined,
          mc_number: payload.mc_number as string | undefined,
        }
      )
    }

    const { data, error } = await upsertClient
      .from('member_profiles')
      .upsert(payload, { onConflict: 'user_id' })
      .select('*')
      .single()

    if (error) throw new Error(error.message)

    if (saveScope === 'carrier_only') {
      const saved = data as MemberProfile
      logCarrierSaveDebug('server after upsert', {
        actorOrgId: actorProfile?.organization_id ?? null,
        payloadOrgId: payload.organization_id ?? null,
        savedOrgId: saved.organization_id ?? null,
        company_name: saved.company_name ?? null,
      })
    }

    await ensureOrganizationBootstrap(upsertClient, userId, data as MemberProfile, {
      organizationRecordExists: bootstrappingNewOrg,
      isNewBootstrap: bootstrappingNewOrg,
    })

    if (
      !shouldBootstrap &&
      typeof payload.organization_id === 'string' &&
      (linkedRoster || organizationMembership)
    ) {
      await syncOrganizationMembershipForMember(
        supabase,
        payload.organization_id,
        userId,
        (data as MemberProfile).user_roles as string[] | undefined,
        undefined,
        userId
      )
    }

    return { source: 'member_profile' as const, data }
  }

  if (!actorProfile?.organization_id) {
    throw new Error('Organization not configured for this account')
  }

  const organizationId = actorProfile.organization_id

  const actingActor = await resolveActingPermissionActorForOrg(
    supabase,
    userId,
    actorProfile,
    organizationId
  )

  if (!canEditMember(actingActor, { user_id: targetUserId, is_self: false })) {
    throw new Error('Forbidden – cannot edit this team member')
  }

  // Require existing in-org member (app-layer org membership; not blind upsert).
  const { data: targetRow, error: targetLoadError } = await supabase
    .from('member_profiles')
    .select('*')
    .eq('user_id', targetUserId)
    .eq('organization_id', organizationId)
    .maybeSingle()

  if (targetLoadError) throw new Error(targetLoadError.message)
  if (!targetRow) {
    throw new Error('Team member not found')
  }

  const targetProfile = targetRow as MemberProfile
  const targetIsPrimary = targetProfile.is_primary_owner === true

  // Carrier inheritance: primary keeps own carrier; children inherit org carrier
  // (actor when present, else primary owner — avoids empty Admin denormalization).
  const carrierSource = targetIsPrimary
    ? targetProfile
    : await resolveCarrierInheritanceSource(supabase, organizationId, actorProfile)

  let formForSave: MemberProfileFormData
  if (targetIsPrimary) {
    // Personal-field updates only: never demote primary or strip Owner roles via Admin API.
    formForSave = buildMemberProfileSavePayloadWithoutCarrier(body.form, carrierSource)
    formForSave = {
      ...formForSave,
      user_roles: validateUserRoles(targetProfile.user_roles as string[] | undefined, {
        isPrimaryOwner: true,
      }),
    }
  } else {
    formForSave = buildMemberProfileSavePayloadWithoutCarrier(body.form, carrierSource)
    assertAssignableTeamMemberRoles(formForSave.user_roles as string[])
  }

  const payload = memberProfileToUpsertPayloadWithoutCarrier(
    formForSave,
    targetUserId,
    carrierSource
  )
  payload.organization_id = organizationId
  payload.is_primary_owner = targetIsPrimary

  const { data, error } = await supabase
    .from('member_profiles')
    .update(payload)
    .eq('user_id', targetUserId)
    .eq('organization_id', organizationId)
    .select('*')
    .single()

  if (error) throw new Error(error.message)

  const membershipPermissions =
    body.permissions !== undefined && canManageMemberPermissions(actingActor)
      ? parseTeamMemberPermissions(body.permissions)
      : undefined

  await syncOrganizationMembershipForMember(
    supabase,
    organizationId,
    targetUserId,
    formForSave.user_roles as string[],
    membershipPermissions,
    userId
  )

  return { source: 'member_profile' as const, data }
}

export async function createOrUpdateRosterMemberForUser(
  token: string,
  body: {
    id?: string
    form: MemberProfileFormData
    linkedUserId?: string | null
    permissions?: unknown
  }
) {
  const { supabase, userId, profile: actorProfile } = await getAuthenticatedMemberProfile(token)

  if (!actorProfile.organization_id) {
    throw new Error('Organization not configured for this account')
  }

  const actingActor = await resolveActingPermissionActorForOrg(
    supabase,
    userId,
    actorProfile,
    actorProfile.organization_id
  )

  if (!canManageMemberPermissions(actingActor) && !actingActor.is_primary_owner) {
    throw new Error('Forbidden – only owners and admins can manage roster members')
  }

  const linkedUserId = body.linkedUserId?.trim() || null
  if (linkedUserId) {
    await assertLinkedUserInOrganization(supabase, actorProfile.organization_id, linkedUserId)
  }

  // Roster children join the actor's existing org only — never create organizations
  // or set is_primary_owner (roster has no bootstrap path). Carrier fields are
  // denormalized from org carrier for display; client cannot supply an independent company.
  const isNewRosterMember = !body.id
  const carrierSource = await resolveCarrierInheritanceSource(
    supabase,
    actorProfile.organization_id,
    actorProfile
  )
  const payload = buildTeamMemberChildRosterPayload(
    body.form,
    actorProfile,
    userId,
    linkedUserId,
    { requireRoles: isNewRosterMember, carrierSource }
  )
  const childRoles = (payload.user_roles as string[] | undefined) ?? []

  if (
    body.permissions !== undefined &&
    (canManageMemberPermissions(actingActor) || actingActor.is_primary_owner)
  ) {
    payload.permissions = parseTeamMemberPermissions(body.permissions)
  }

  if (body.id) {
    const { created_by_user_id: _createdBy, ...updatePayload } = payload

    const { data, error } = await supabase
      .from('team_member_profiles')
      .update(updatePayload)
      .eq('id', body.id)
      .eq('organization_id', actorProfile.organization_id)
      .select('*')
      .single()

    if (error) throw new Error(error.message)

    // Linked roster: always sync membership.role from user_roles (authz SSoT).
    // Permissions arg only when present so role-only edits preserve custom membership perms.
    if (linkedUserId) {
      await syncOrganizationMembershipForMember(
        supabase,
        actorProfile.organization_id,
        linkedUserId,
        childRoles,
        updatePayload.permissions,
        userId
      )
    }

    return { source: 'team_member_profile' as const, data }
  }

  const { data, error } = await supabase
    .from('team_member_profiles')
    .insert(payload)
    .select('*')
    .single()

  if (error) throw new Error(error.message)

  if (linkedUserId) {
    await syncOrganizationMembershipForMember(
      supabase,
      actorProfile.organization_id,
      linkedUserId,
      childRoles,
      payload.permissions,
      userId
    )
  }

  return { source: 'team_member_profile' as const, data }
}

export async function deleteTeamMemberForUser(
  token: string,
  body: {
    source: 'member_profile' | 'team_member_profile'
    id: string
    userId?: string
  }
) {
  const { supabase, userId, profile: actorProfile } = await getAuthenticatedMemberProfile(token)

  const actingActor = await resolveActingPermissionActorForOrg(
    supabase,
    userId,
    actorProfile,
    actorProfile.organization_id
  )

  const target = {
    user_id: body.userId ?? null,
    is_self: body.userId === userId,
    is_primary_owner: false,
    user_roles: [] as string[],
  }

  if (body.source === 'member_profile' && body.userId) {
    const { data: targetProfile } = await supabase
      .from('member_profiles')
      .select('is_primary_owner, user_roles')
      .eq('user_id', body.userId)
      .eq('organization_id', actorProfile.organization_id)
      .maybeSingle()

    if (targetProfile) {
      target.is_primary_owner = targetProfile.is_primary_owner === true
      target.user_roles = (targetProfile.user_roles as string[]) ?? []
    }
  }

  const resourceType = mapMemberSourceToResourceType(body.source)
  const resourceId = body.source === 'member_profile' ? (body.userId ?? body.id) : body.id

  if (canActorRequestMemberDeletion(actingActor, target, resourceType)) {
    const request = await createDeletionRequest(supabase, actorProfile, {
      resourceType,
      resourceId,
      targetUserId: body.userId ?? null,
      source: body.source,
    })
    return { deleted: false, source: body.source, deletion_request: request }
  }

  if (!canDeleteMember(actingActor, target)) {
    throw new Error('Forbidden – cannot delete this team member')
  }

  if (body.source === 'member_profile') {
    if (!body.userId) {
      throw new Error('userId is required to delete a member profile')
    }

    const { error } = await supabase
      .from('member_profiles')
      .delete()
      .eq('user_id', body.userId)
      .eq('organization_id', actorProfile.organization_id)

    if (error) throw new Error(error.message)

    await removeOrganizationMembership(supabase, actorProfile.organization_id, body.userId)
    return { deleted: true, source: body.source }
  }

  const { error } = await supabase
    .from('team_member_profiles')
    .delete()
    .eq('id', body.id)
    .eq('organization_id', actorProfile.organization_id)

  if (error) throw new Error(error.message)
  return { deleted: true, source: body.source }
}

async function assertLinkedUserInOrganization(
  supabase: ReturnType<typeof createAuthedSupabaseClient>,
  organizationId: string,
  linkedUserId: string
): Promise<void> {
  const { data, error } = await supabase
    .from('member_profiles')
    .select('user_id')
    .eq('organization_id', organizationId)
    .eq('user_id', linkedUserId)
    .maybeSingle()

  if (error) throw new Error(error.message)
  if (!data) {
    throw new Error('Forbidden – linked user is not a member of this organization')
  }
}

/**
 * Resolve denormalized carrier fields for child roster/member saves.
 * Prefer actor when they have carrier data; else load primary owner of the org.
 */
async function resolveCarrierInheritanceSource(
  supabase: ReturnType<typeof createAuthedSupabaseClient>,
  organizationId: string,
  actorProfile: MemberProfile
): Promise<MemberProfile> {
  if (hasCarrierData(actorProfile)) return actorProfile

  const { data, error } = await supabase
    .from('member_profiles')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('is_primary_owner', true)
    .maybeSingle()

  if (error) {
    console.warn('[team-member-profiles] primary owner carrier lookup failed', error.message)
    return actorProfile
  }

  return pickCarrierInheritanceSource(actorProfile, (data as MemberProfile | null) ?? null)
}

export function parseMemberProfileForm(body: Record<string, unknown>): MemberProfileFormData {
  const roles = validateUserRoles(
    Array.isArray(body.user_roles) ? body.user_roles.map(String) : []
  )

  return {
    company_name: String(body.company_name ?? ''),
    usdot_number: String(body.usdot_number ?? ''),
    mc_number: String(body.mc_number ?? ''),
    ein: String(body.ein ?? ''),
    carrier_address: String(body.carrier_address ?? ''),
    carrier_phone: String(body.carrier_phone ?? ''),
    carrier_email: String(body.carrier_email ?? ''),
    insurance_contact: String(body.insurance_contact ?? ''),
    driver_full_name: String(body.driver_full_name ?? ''),
    cdl_number: String(body.cdl_number ?? ''),
    cdl_state: String(body.cdl_state ?? ''),
    date_of_birth: String(body.date_of_birth ?? ''),
    driver_phone: String(body.driver_phone ?? ''),
    driver_email: String(body.driver_email ?? ''),
    emergency_contact: String(body.emergency_contact ?? ''),
    user_roles: roles,
  }
}