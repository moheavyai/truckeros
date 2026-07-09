export const USER_ROLE_OPTIONS = [
  'Owner',
  'Admin',
  'Driver',
  'Permit Clerk',
  'Viewer',
] as const

export type UserRole = (typeof USER_ROLE_OPTIONS)[number]

/** Roles assignable to team members via invite or roster edit (Owner is bootstrap-only). */
export const ASSIGNABLE_TEAM_ROLES = [
  'Admin',
  'Driver',
  'Permit Clerk',
  'Viewer',
] as const

export type AssignableTeamRole = (typeof ASSIGNABLE_TEAM_ROLES)[number]

export const PRIMARY_OWNER_ROLE: UserRole = 'Owner'

/** @deprecated Use PRIMARY_OWNER_ROLE — legacy combined label normalized at read time. */
export const LEGACY_OWNER_ADMIN_ROLE = 'Owner / Admin' as const

export type MemberProfileFields = {
  company_name?: string | null
  usdot_number?: string | null
  mc_number?: string | null
  ein?: string | null
  carrier_address?: string | null
  carrier_phone?: string | null
  carrier_email?: string | null
  insurance_contact?: string | null
  driver_full_name?: string | null
  cdl_number?: string | null
  cdl_state?: string | null
  date_of_birth?: string | null
  driver_phone?: string | null
  driver_email?: string | null
  emergency_contact?: string | null
  user_roles?: UserRole[] | string[]
}

export type MemberProfile = MemberProfileFields & {
  id?: string
  user_id: string
  organization_id?: string | null
  is_primary_owner?: boolean
  created_at?: string
  updated_at?: string
}

export type TeamMemberPermissionConfig = {
  mode: 'global' | 'custom'
  custom?: {
    equipment?: boolean
    profiles?: boolean
    account_settings?: boolean
  }
}

export type TeamMemberProfile = MemberProfileFields & {
  id: string
  organization_id: string
  linked_user_id?: string | null
  created_by_user_id: string
  permissions?: TeamMemberPermissionConfig | null
  created_at?: string
  updated_at?: string
}

export type MemberProfileFormData = Omit<
  MemberProfile,
  'id' | 'user_id' | 'organization_id' | 'is_primary_owner' | 'created_at' | 'updated_at'
>

export type TeamMemberListSource = 'member_profile' | 'team_member_profile'

export type TeamMemberListItem = {
  id: string
  source: TeamMemberListSource
  user_id?: string | null
  linked_user_id?: string | null
  display_name: string
  company_name?: string | null
  user_roles: UserRole[]
  driver_summary: string
  is_self: boolean
  is_primary_owner?: boolean
}