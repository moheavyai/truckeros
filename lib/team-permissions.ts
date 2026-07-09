import { LEGACY_OWNER_ADMIN_ROLE, USER_ROLE_OPTIONS, type UserRole } from '@/types/member-profile'

export { LEGACY_OWNER_ADMIN_ROLE } from '@/types/member-profile'

export type PermissionArea =
  | 'equipment'
  | 'profiles'
  | 'account_settings'
  | 'permit_agent'
  | 'portal_agent'
  | 'file_upload'

export type AreaAccess = 'none' | 'read' | 'write'

export type RolePermissionMap = Record<PermissionArea, AreaAccess>

export type CustomPermissionToggles = {
  equipment: boolean
  profiles: boolean
  account_settings: boolean
}

export type MemberPermissionConfig = {
  mode: 'global' | 'custom'
  custom?: Partial<CustomPermissionToggles>
}

export type PermissionActor = {
  user_roles?: UserRole[] | string[] | null
  is_primary_owner?: boolean
  permissions?: MemberPermissionConfig | null
}

export type PermissionTarget = {
  user_roles?: UserRole[] | string[] | null
  is_primary_owner?: boolean
  is_self?: boolean
}

export type DeletionResourceType = 'carrier' | 'equipment' | 'driver' | 'team_member' | 'roster_member'

export type DeletionRequestStatus = 'pending' | 'approved' | 'rejected'

export type DeletionRequest = {
  id: string
  organization_id: string
  requester_user_id: string
  resource_type: DeletionResourceType
  resource_id: string
  status: DeletionRequestStatus
  reviewed_by_user_id?: string | null
  reviewed_at?: string | null
  created_at?: string
}

export const CUSTOM_PERMISSION_AREAS: (keyof CustomPermissionToggles)[] = [
  'equipment',
  'profiles',
  'account_settings',
]

export const ROLE_DEFAULT_PERMISSIONS: Record<UserRole, RolePermissionMap> = {
  Owner: {
    equipment: 'write',
    profiles: 'write',
    account_settings: 'write',
    permit_agent: 'write',
    portal_agent: 'write',
    file_upload: 'write',
  },
  Admin: {
    equipment: 'write',
    profiles: 'write',
    account_settings: 'write',
    permit_agent: 'write',
    portal_agent: 'write',
    file_upload: 'write',
  },
  Viewer: {
    equipment: 'read',
    profiles: 'read',
    account_settings: 'read',
    permit_agent: 'read',
    portal_agent: 'read',
    file_upload: 'read',
  },
  Driver: {
    equipment: 'none',
    profiles: 'none',
    account_settings: 'none',
    permit_agent: 'write',
    portal_agent: 'write',
    file_upload: 'write',
  },
  'Permit Clerk': {
    equipment: 'write',
    profiles: 'write',
    account_settings: 'none',
    permit_agent: 'write',
    portal_agent: 'write',
    file_upload: 'write',
  },
}

const MANAGEMENT_ROLES: UserRole[] = ['Owner', 'Admin']

function normalizeRoles(roles: string[] | null | undefined): UserRole[] {
  if (!roles?.length) return []
  const allowed = new Set<string>(USER_ROLE_OPTIONS)
  const seen = new Set<UserRole>()
  const result: UserRole[] = []
  for (const rawRole of roles) {
    const normalized = rawRole === LEGACY_OWNER_ADMIN_ROLE ? 'Owner' : rawRole
    if (!allowed.has(normalized)) continue
    const typed = normalized as UserRole
    if (seen.has(typed)) continue
    seen.add(typed)
    result.push(typed)
  }
  return result
}

export function normalizeLegacyRole(role: string): UserRole | null {
  if (role === LEGACY_OWNER_ADMIN_ROLE) return 'Owner'
  const allowed = new Set<string>(USER_ROLE_OPTIONS)
  return allowed.has(role) ? (role as UserRole) : null
}

export function primaryRoleFromRoles(roles: UserRole[] | string[] | null | undefined): UserRole | null {
  const validated = normalizeRoles(roles as string[] | undefined)
  if (validated.includes('Owner')) return 'Owner'
  if (validated.includes('Admin')) return 'Admin'
  if (validated.includes('Permit Clerk')) return 'Permit Clerk'
  if (validated.includes('Driver')) return 'Driver'
  if (validated.includes('Viewer')) return 'Viewer'
  return validated[0] ?? null
}

export function hasOwnerRole(actor: PermissionActor | null | undefined): boolean {
  if (!actor) return false
  if (actor.is_primary_owner) return true
  const roles = normalizeRoles(actor.user_roles as string[] | undefined)
  return roles.includes('Owner')
}

export function hasAdminRole(actor: PermissionActor | null | undefined): boolean {
  const roles = normalizeRoles(actor?.user_roles as string[] | undefined)
  return roles.includes('Admin')
}

export function hasOwnerOrAdminRole(actor: PermissionActor | null | undefined): boolean {
  if (!actor) return false
  if (actor.is_primary_owner) return true
  const roles = normalizeRoles(actor.user_roles as string[] | undefined)
  return roles.includes('Owner') || roles.includes('Admin')
}

export function hasManagementAccess(actor: PermissionActor | null | undefined): boolean {
  return hasOwnerOrAdminRole(actor)
}

export function isAdminOnly(actor: PermissionActor | null | undefined): boolean {
  return hasAdminRole(actor) && !hasOwnerRole(actor)
}

export function isViewerRole(roles: UserRole[] | string[] | null | undefined): boolean {
  const validated = normalizeRoles(roles as string[] | undefined)
  return validated.length > 0 && validated.every((role) => role === 'Viewer')
}

function mergeRoleDefaults(roles: UserRole[]): RolePermissionMap {
  const merged: RolePermissionMap = {
    equipment: 'none',
    profiles: 'none',
    account_settings: 'none',
    permit_agent: 'none',
    portal_agent: 'none',
    file_upload: 'none',
  }

  const rank: Record<AreaAccess, number> = { none: 0, read: 1, write: 2 }

  for (const role of roles) {
    const defaults = ROLE_DEFAULT_PERMISSIONS[role]
    for (const area of Object.keys(defaults) as PermissionArea[]) {
      if (rank[defaults[area]] > rank[merged[area]]) {
        merged[area] = defaults[area]
      }
    }
  }

  return merged
}

function applyCustomOverrides(
  base: RolePermissionMap,
  config: MemberPermissionConfig | null | undefined
): RolePermissionMap {
  if (!config || config.mode !== 'custom') return base

  const next = { ...base }
  for (const area of CUSTOM_PERMISSION_AREAS) {
    const enabled = config.custom?.[area] === true
    next[area] = enabled ? 'write' : 'none'
  }
  return next
}

export function parseMemberPermissionConfig(raw: unknown): MemberPermissionConfig {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { mode: 'global' }
  }

  const record = raw as Record<string, unknown>
  const mode = record.mode === 'custom' ? 'custom' : 'global'
  const customRaw = record.custom

  if (mode !== 'custom' || !customRaw || typeof customRaw !== 'object' || Array.isArray(customRaw)) {
    return { mode }
  }

  const customRecord = customRaw as Record<string, unknown>
  return {
    mode: 'custom',
    custom: {
      equipment: customRecord.equipment === true,
      profiles: customRecord.profiles === true,
      account_settings: customRecord.account_settings === true,
    },
  }
}

export function resolveEffectivePermissions(
  actor: PermissionActor | null | undefined
): RolePermissionMap {
  const roles = normalizeRoles(actor?.user_roles as string[] | undefined)
  if (actor?.is_primary_owner && !roles.includes('Owner')) {
    roles.unshift('Owner')
  }
  const base = mergeRoleDefaults(roles.length > 0 ? roles : ['Viewer'])
  return applyCustomOverrides(base, actor?.permissions ?? null)
}

export function canAccessArea(
  area: PermissionArea,
  permissions: RolePermissionMap,
  options?: { requireWrite?: boolean }
): boolean {
  const access = permissions[area]
  if (options?.requireWrite) return access === 'write'
  return access === 'read' || access === 'write'
}

export function canDeleteResource(
  actorRole: UserRole | null,
  resourceType: DeletionResourceType,
  target: PermissionTarget
): boolean {
  if (!actorRole) return false

  const targetRoles = normalizeRoles(target.user_roles as string[] | undefined)
  const targetIsOwner = target.is_primary_owner === true || targetRoles.includes('Owner')

  if (targetIsOwner) return false
  if (actorRole === 'Admin' && targetRoles.includes('Owner')) return false

  if (actorRole === 'Owner' || actorRole === 'Admin') return true

  if (actorRole === 'Permit Clerk') {
    return ['carrier', 'equipment', 'driver', 'team_member', 'roster_member'].includes(resourceType)
  }

  return false
}

export function requiresDeletionApproval(
  actor: PermissionActor | null | undefined,
  resourceType: DeletionResourceType
): boolean {
  const role = primaryRoleFromRoles(actor?.user_roles)
  if (!role) return true
  if (role === 'Owner' || role === 'Admin') return false
  if (role === 'Permit Clerk') {
    return ['carrier', 'equipment', 'driver', 'team_member', 'roster_member'].includes(resourceType)
  }
  return true
}

export function canActorDeleteMember(
  actor: PermissionActor | null | undefined,
  target: PermissionTarget
): boolean {
  if (!actor?.user_roles && !actor?.is_primary_owner) return false
  if (target.is_self) return false

  const actorRole = primaryRoleFromRoles(actor.user_roles)
  if (!hasManagementAccess(actor) && actorRole !== 'Permit Clerk') return false

  if (requiresDeletionApproval(actor, 'team_member')) return false

  return canDeleteResource(actorRole, 'team_member', target)
}

export function mapMemberSourceToResourceType(
  source: 'member_profile' | 'team_member_profile'
): DeletionResourceType {
  return source === 'team_member_profile' ? 'roster_member' : 'team_member'
}

export function canActorRequestMemberDeletion(
  actor: PermissionActor | null | undefined,
  target: PermissionTarget,
  resourceType: DeletionResourceType = 'team_member'
): boolean {
  if (!actor?.user_roles && !actor?.is_primary_owner) return false
  if (target.is_self) return false
  if (canActorDeleteMember(actor, target)) return false
  const actorRole = primaryRoleFromRoles(actor.user_roles)
  if (actorRole !== 'Permit Clerk') return false
  return requiresDeletionApproval(actor, resourceType)
}

export function shouldShowEquipmentNav(actor: PermissionActor | null | undefined): boolean {
  const permissions = resolveEffectivePermissions(actor)
  return canAccessArea('equipment', permissions)
}

export function shouldShowProfileNav(actor: PermissionActor | null | undefined): boolean {
  const permissions = resolveEffectivePermissions(actor)
  if (canAccessArea('profiles', permissions)) return true
  const roles = normalizeRoles(actor?.user_roles as string[] | undefined)
  return roles.includes('Driver')
}

export function emptyMemberPermissionConfig(): MemberPermissionConfig {
  return { mode: 'global' }
}