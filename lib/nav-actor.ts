/**
 * Pure helpers for resolving header nav actor (roles + permissions) from
 * member profile and organization memberships.
 *
 * Glossary: docs/plans/glossary-accounts-roles.md
 * Plan: docs/plans/user-accounts-roles-flows.md §4.1
 *
 * Membership is authz SSoT for the effective org. Home profile is identity.
 * Owner Operator exception: on home org as primary owner with home
 * user_roles Owner+Driver, merge home multi-select into effective roles so
 * Driver capabilities apply (never on a foreign Service Mode org).
 */

import { validateUserRoles } from '@/lib/member-profile'
import { pickPreferredMembership } from '@/lib/roster-profile-link'
import {
  parseMemberPermissionConfig,
  type MemberPermissionConfig,
} from '@/lib/team-permissions'
import type { UserRole } from '@/types/member-profile'

export type NavActorProfile = {
  user_roles?: unknown
  is_primary_owner?: boolean | null
  organization_id?: string | null
}

export type NavActorMembership = {
  organization_id?: string | null
  role?: string | null
  is_primary_owner?: boolean | null
  permissions?: unknown
  created_at?: string | null
}

export type ResolvedActingActor = {
  /** Scalar membership role for the effective org (null when no membership). */
  membershipRole: UserRole | null
  /** Roles used for nav / tools / resolveEffectivePermissions merge. */
  user_roles: UserRole[]
  is_primary_owner: boolean
  /** True when Owner Operator home-org exception applied. */
  isOwnerOperator: boolean
}

export type ResolvedNavActor = {
  user_roles: UserRole[]
  is_primary_owner: boolean
  permissions: MemberPermissionConfig
  organizationId: string | null
  membershipRole: UserRole | null
  isOwnerOperator: boolean
}

/**
 * Resolve which organization should drive nav permissions.
 * Service mode uses the active carrier when set; otherwise home/preferred membership.
 */
export function resolveNavOrganizationId(options: {
  profileOrgId?: string | null
  workspaceMode?: 'carrier' | 'service'
  activeOrganizationId?: string | null
  preferredMembershipOrgId?: string | null
}): string | null {
  if (
    options.workspaceMode === 'service' &&
    options.activeOrganizationId
  ) {
    return options.activeOrganizationId
  }
  return options.profileOrgId ?? options.preferredMembershipOrgId ?? null
}

/**
 * Pure acting-role SSoT from already-resolved membership + home profile inputs.
 *
 * Default: effectiveRoles = [membershipRole] (empty → Viewer via resolveEffectivePermissions).
 * Owner Operator exception (home org only): when primary owner and home user_roles
 * includes Owner+Driver (after validateUserRoles), effectiveRoles = home user_roles.
 * Service Mode on a foreign org never merges home OO roles.
 */
export function resolveActingRolesFromInputs(options: {
  membershipRole?: string | null
  membershipIsPrimaryOwner?: boolean | null
  homeOrgId?: string | null
  homeIsPrimaryOwner?: boolean | null
  homeUserRoles?: unknown
  effectiveOrgId?: string | null
}): ResolvedActingActor {
  const homeRoles = validateUserRoles(options.homeUserRoles as string[] | undefined)
  const homeOrgId = options.homeOrgId ?? null
  const effectiveOrgId = options.effectiveOrgId ?? null
  const isOnHomeOrg =
    Boolean(homeOrgId) && Boolean(effectiveOrgId) && homeOrgId === effectiveOrgId

  const membershipRoleValidated = options.membershipRole
    ? (validateUserRoles([String(options.membershipRole)])[0] ?? null)
    : null

  // Membership row present when role or explicit primary flag is provided.
  // Prefer membership is_primary_owner; home primary only for bootstrap (no membership).
  const membershipPresent =
    membershipRoleValidated != null ||
    options.membershipIsPrimaryOwner === true ||
    options.membershipIsPrimaryOwner === false

  const isPrimaryOwner = membershipPresent
    ? options.membershipIsPrimaryOwner === true
    : isOnHomeOrg && options.homeIsPrimaryOwner === true

  const homeIsOwnerOperator =
    homeRoles.includes('Owner') && homeRoles.includes('Driver')
  const applyOwnerOperatorException =
    isOnHomeOrg && isPrimaryOwner && homeIsOwnerOperator

  let effectiveRoles: UserRole[]
  if (applyOwnerOperatorException) {
    // Capability merge: membership scalar Owner + home Driver via full home multi-select.
    effectiveRoles = homeRoles
  } else if (membershipRoleValidated) {
    effectiveRoles = [membershipRoleValidated]
  } else if (isOnHomeOrg && homeRoles.length > 0) {
    // Bootstrap / membership-not-yet-synced edge: fall back to home roles on home org only.
    effectiveRoles = homeRoles
  } else {
    effectiveRoles = []
  }

  return {
    membershipRole: membershipRoleValidated,
    user_roles: effectiveRoles,
    is_primary_owner: isPrimaryOwner,
    isOwnerOperator: applyOwnerOperatorException,
  }
}

/**
 * Resolve acting actor for an effective org from profile + memberships rows.
 * Prefer this (or resolveActingRolesFromInputs) over reading profile.user_roles alone
 * when a membership exists for the effective org.
 */
export function resolveActingActor(options: {
  profile: NavActorProfile | null | undefined
  memberships: NavActorMembership[] | null | undefined
  workspaceMode?: 'carrier' | 'service'
  activeOrganizationId?: string | null
  /** Optional override; otherwise derived from profile/workspace/memberships. */
  effectiveOrgId?: string | null
}): ResolvedActingActor & { organizationId: string | null } {
  const profile = options.profile ?? null
  const memberships = options.memberships ?? []
  const preferred = pickPreferredMembership(memberships)

  const organizationId =
    options.effectiveOrgId !== undefined
      ? options.effectiveOrgId
      : resolveNavOrganizationId({
          profileOrgId: profile?.organization_id,
          workspaceMode: options.workspaceMode,
          activeOrganizationId: options.activeOrganizationId,
          preferredMembershipOrgId: preferred?.organization_id,
        })

  const membershipForOrg = organizationId
    ? memberships.find((row) => row.organization_id === organizationId) ?? null
    : preferred

  const acting = resolveActingRolesFromInputs({
    membershipRole: membershipForOrg?.role,
    membershipIsPrimaryOwner: membershipForOrg?.is_primary_owner,
    homeOrgId: profile?.organization_id,
    homeIsPrimaryOwner: profile?.is_primary_owner,
    homeUserRoles: profile?.user_roles,
    effectiveOrgId: organizationId ?? membershipForOrg?.organization_id ?? null,
  })

  return {
    ...acting,
    organizationId: organizationId ?? membershipForOrg?.organization_id ?? null,
  }
}

/**
 * Build nav actor from profile row + membership rows for a target organization.
 * Single membership lookup for org + permissions (no double find).
 */
export function resolveNavActor(options: {
  profile: NavActorProfile | null | undefined
  memberships: NavActorMembership[] | null | undefined
  workspaceMode?: 'carrier' | 'service'
  activeOrganizationId?: string | null
}): ResolvedNavActor {
  const profile = options.profile ?? null
  const memberships = options.memberships ?? []
  const preferred = pickPreferredMembership(memberships)

  const organizationId = resolveNavOrganizationId({
    profileOrgId: profile?.organization_id,
    workspaceMode: options.workspaceMode,
    activeOrganizationId: options.activeOrganizationId,
    preferredMembershipOrgId: preferred?.organization_id,
  })

  const membershipForOrg = organizationId
    ? memberships.find((row) => row.organization_id === organizationId) ?? null
    : preferred

  const resolvedOrgId = organizationId ?? membershipForOrg?.organization_id ?? null

  const acting = resolveActingRolesFromInputs({
    membershipRole: membershipForOrg?.role,
    membershipIsPrimaryOwner: membershipForOrg?.is_primary_owner,
    homeOrgId: profile?.organization_id,
    homeIsPrimaryOwner: profile?.is_primary_owner,
    homeUserRoles: profile?.user_roles,
    effectiveOrgId: resolvedOrgId,
  })

  const permissions = parseMemberPermissionConfig(membershipForOrg?.permissions ?? null)

  return {
    user_roles: acting.user_roles,
    is_primary_owner: acting.is_primary_owner,
    permissions,
    organizationId: resolvedOrgId,
    membershipRole: acting.membershipRole,
    isOwnerOperator: acting.isOwnerOperator,
  }
}
