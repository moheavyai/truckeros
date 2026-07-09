import {
  canActorDeleteMember,
  canActorRequestMemberDeletion,
  hasManagementAccess,
  hasOwnerOrAdminRole,
  isViewerRole,
  mapMemberSourceToResourceType,
  parseMemberPermissionConfig,
  type MemberPermissionConfig,
} from '@/lib/team-permissions'
import type {
  MemberProfile,
  TeamMemberListItem,
  TeamMemberProfile,
  UserRole,
} from '@/types/member-profile'
import { validateUserRoles } from '@/lib/member-profile'

/**
 * Viewer is read-only: accounts with only the Viewer role cannot edit profiles,
 * manage team members, or respond to carrier link requests.
 */
export function isViewerOnly(roles: UserRole[] | string[] | null | undefined): boolean {
  return isViewerRole(roles)
}

export function canWriteTeamData(
  actor: Pick<MemberProfile, 'user_roles' | 'is_primary_owner'> | null | undefined
): boolean {
  if (!actor) return true
  if (isPrimaryOwner(actor)) return true
  if (hasOwnerOrAdminRole({ user_roles: actor.user_roles, is_primary_owner: actor.is_primary_owner })) {
    return true
  }
  return !isViewerOnly(actor.user_roles as string[] | undefined)
}

export function isPrimaryOwner(profile: Pick<MemberProfile, 'is_primary_owner'> | null | undefined): boolean {
  return profile?.is_primary_owner === true
}

export function memberDisplayName(
  row: Pick<MemberProfile, 'driver_full_name' | 'driver_email' | 'company_name'> | null | undefined
): string {
  const name = row?.driver_full_name?.trim()
  if (name) return name
  const email = row?.driver_email?.trim()
  if (email) return email
  const company = row?.company_name?.trim()
  if (company) return company
  return 'Unnamed member'
}

export function formatMemberListSummary(
  row: Pick<
    MemberProfile,
    'cdl_number' | 'cdl_state' | 'driver_phone' | 'driver_email'
  >
): string {
  const parts: string[] = []

  const cdl = row.cdl_number?.trim()
  const state = row.cdl_state?.trim()
  if (cdl && state) parts.push(`CDL ${cdl} (${state})`)
  else if (cdl) parts.push(`CDL ${cdl}`)
  else if (state) parts.push(`CDL (${state})`)

  const phone = row.driver_phone?.trim()
  if (phone) parts.push(phone)

  const email = row.driver_email?.trim()
  if (email) parts.push(email)

  return parts.length > 0 ? parts.join(' · ') : 'No driver details'
}

export function canEditMember(
  actor: Pick<MemberProfile, 'user_id' | 'is_primary_owner' | 'user_roles'> | null | undefined,
  target: Pick<TeamMemberListItem, 'user_id' | 'is_self'>
): boolean {
  if (!actor?.user_id) return false
  if (target.is_self) return true
  return isPrimaryOwner(actor) || hasManagementAccess(actor)
}

export function canDeleteMember(
  actor: Pick<MemberProfile, 'user_id' | 'is_primary_owner' | 'user_roles'> | null | undefined,
  target: Pick<TeamMemberListItem, 'user_id' | 'is_self' | 'is_primary_owner' | 'user_roles'>
): boolean {
  if (!actor?.user_id) return false
  return canActorDeleteMember(actor, {
    user_roles: target.user_roles,
    is_primary_owner: target.is_primary_owner,
    is_self: target.is_self,
  })
}

export function canRequestMemberRemoval(
  actor: Pick<MemberProfile, 'user_id' | 'is_primary_owner' | 'user_roles'> | null | undefined,
  target: Pick<TeamMemberListItem, 'user_id' | 'is_self' | 'is_primary_owner' | 'user_roles' | 'source'>
): boolean {
  if (!actor?.user_id) return false
  const resourceType = mapMemberSourceToResourceType(target.source)
  return canActorRequestMemberDeletion(
    actor,
    {
      user_roles: target.user_roles,
      is_primary_owner: target.is_primary_owner,
      is_self: target.is_self,
    },
    resourceType
  )
}

export function canManageMemberPermissions(
  actor: Pick<MemberProfile, 'user_roles' | 'is_primary_owner'> | null | undefined
): boolean {
  return hasManagementAccess(actor)
}

export function parseTeamMemberPermissions(raw: unknown): MemberPermissionConfig {
  return parseMemberPermissionConfig(raw)
}

function linkedMemberProfileUserIds(memberProfiles: MemberProfile[]): Set<string> {
  return new Set(memberProfiles.map((row) => row.user_id))
}

export function memberProfileToListItem(
  row: MemberProfile,
  currentUserId: string
): TeamMemberListItem {
  return {
    id: row.id ?? row.user_id,
    source: 'member_profile',
    user_id: row.user_id,
    display_name: memberDisplayName(row),
    company_name: row.company_name ?? null,
    user_roles: validateUserRoles(row.user_roles as string[] | undefined),
    driver_summary: formatMemberListSummary(row),
    is_self: row.user_id === currentUserId,
    is_primary_owner: row.is_primary_owner === true,
  }
}

export function teamMemberProfileToListItem(
  row: TeamMemberProfile,
  currentUserId: string
): TeamMemberListItem {
  return {
    id: row.id,
    source: 'team_member_profile',
    linked_user_id: row.linked_user_id ?? null,
    display_name: memberDisplayName(row),
    company_name: row.company_name ?? null,
    user_roles: validateUserRoles(row.user_roles as string[] | undefined),
    driver_summary: formatMemberListSummary(row),
    is_self: row.linked_user_id === currentUserId,
    is_primary_owner: false,
  }
}

function buildCombinedTeamMemberList(
  orgMemberProfiles: MemberProfile[],
  teamRosterProfiles: TeamMemberProfile[],
  currentUserId: string
): TeamMemberListItem[] {
  const memberItems = orgMemberProfiles.map((row) => memberProfileToListItem(row, currentUserId))
  const linkedIds = linkedMemberProfileUserIds(orgMemberProfiles)

  const rosterItems = teamRosterProfiles
    .filter((row) => !row.linked_user_id || !linkedIds.has(row.linked_user_id))
    .map((row) => teamMemberProfileToListItem(row, currentUserId))

  const combined = [...memberItems, ...rosterItems]
  combined.sort((a, b) => {
    if (a.is_self !== b.is_self) return a.is_self ? -1 : 1
    return a.display_name.localeCompare(b.display_name, undefined, { sensitivity: 'base' })
  })

  return combined
}

/** Full org roster for permit clerks in service mode (membership-scoped org). */
export function buildOrganizationTeamMemberList(
  orgMemberProfiles: MemberProfile[],
  teamRosterProfiles: TeamMemberProfile[],
  currentUserId: string
): TeamMemberListItem[] {
  return buildCombinedTeamMemberList(orgMemberProfiles, teamRosterProfiles, currentUserId)
}

export function buildTeamMemberList(
  actorProfile: MemberProfile | null,
  orgMemberProfiles: MemberProfile[],
  teamRosterProfiles: TeamMemberProfile[],
  currentUserId: string
): TeamMemberListItem[] {
  const primary = isPrimaryOwner(actorProfile)
  const manager = hasManagementAccess(actorProfile)

  if (!primary && !manager) {
    const selfRow = orgMemberProfiles.find((row) => row.user_id === currentUserId) ?? actorProfile
    return selfRow ? [memberProfileToListItem(selfRow, currentUserId)] : []
  }

  return buildCombinedTeamMemberList(orgMemberProfiles, teamRosterProfiles, currentUserId)
}

export function shouldShowTeamSection(
  actorProfile: MemberProfile | null,
  teamMembers: TeamMemberListItem[]
): boolean {
  return Boolean(actorProfile) || teamMembers.length > 0
}

export function roleBadgeClass(role: UserRole): string {
  switch (role) {
    case 'Owner':
      return 'bg-gray-900 text-white border-gray-900'
    case 'Admin':
      return 'bg-slate-700 text-white border-slate-700'
    case 'Driver':
      return 'bg-emerald-50 text-emerald-800 border-emerald-200'
    case 'Permit Clerk':
      return 'bg-amber-50 text-amber-800 border-amber-200'
    case 'Viewer':
      return 'bg-gray-100 text-gray-700 border-gray-200'
    default:
      return 'bg-gray-100 text-gray-700 border-gray-200'
  }
}