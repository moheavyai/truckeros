import { canManageMemberPermissions } from '@/lib/member-profile-permissions'
import {
  INVITE_ALLOWED_ROLES,
  normalizeInviteEmail,
  normalizeInvitePhone,
} from '@/lib/team-invites'
import { primaryRoleFromRoles } from '@/lib/team-permissions'
import type {
  MemberProfile,
  TeamMemberListItem,
  TeamMemberProfile,
} from '@/types/member-profile'
import type { OrganizationRole } from '@/types/organization'

export type MemberInviteContact = {
  email: string | null
  phone: string | null
}

export function resolveInviteRoleFromMemberRoles(
  roles: string[] | null | undefined
): OrganizationRole {
  const primary = primaryRoleFromRoles(roles ?? [])
  if (
    primary &&
    primary !== 'Owner' &&
    (INVITE_ALLOWED_ROLES as readonly string[]).includes(primary)
  ) {
    return primary
  }

  for (const role of roles ?? []) {
    if ((INVITE_ALLOWED_ROLES as readonly string[]).includes(role)) {
      return role as OrganizationRole
    }
  }

  return 'Driver'
}

export function resolveMemberInviteContact(
  member: TeamMemberListItem,
  orgMemberRows: MemberProfile[],
  teamRosterRows: TeamMemberProfile[]
): MemberInviteContact {
  if (member.source === 'member_profile' && member.user_id) {
    const row = orgMemberRows.find((entry) => entry.user_id === member.user_id)
    return {
      email: normalizeInviteEmail(row?.driver_email),
      phone: normalizeInvitePhone(row?.driver_phone),
    }
  }

  const row = teamRosterRows.find((entry) => entry.id === member.id)
  return {
    email: normalizeInviteEmail(row?.driver_email),
    phone: normalizeInvitePhone(row?.driver_phone),
  }
}

export function canReinviteMember(
  actor: Pick<MemberProfile, 'user_roles' | 'is_primary_owner'> | null | undefined,
  member: TeamMemberListItem,
  contact: MemberInviteContact
): boolean {
  if (!actor || !canManageMemberPermissions(actor)) return false
  if (member.is_primary_owner) return false
  if (member.is_self) return false
  return Boolean(contact.email || contact.phone)
}

export function formatInviteDeliverySummary(
  baseMessage: string,
  inviteLink?: string | null,
  emailStubbed?: boolean,
  smsStubbed?: boolean
): string {
  const parts = [baseMessage]
  if (inviteLink) parts.push(`Invite link: ${inviteLink}`)
  if (emailStubbed) parts.push('(Email stubbed — see server [invite-notify] logs)')
  if (smsStubbed) parts.push('(SMS stubbed — see server [invite-notify] logs)')
  return parts.join(' ')
}

export type CreateTeamInviteApiResult = {
  success?: boolean
  error?: string
  data?: { invite_link?: string | null; invite_token?: string }
  email?: { stubbed?: boolean } | null
  sms?: { stubbed?: boolean } | null
}

export async function createTeamInviteViaApi(
  accessToken: string,
  payload: {
    role: string
    invite_email?: string | null
    invite_phone?: string | null
  }
): Promise<CreateTeamInviteApiResult> {
  const response = await fetch('/api/team-invites', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(payload),
  })

  try {
    const result = (await response.json()) as CreateTeamInviteApiResult
    if (!response.ok) {
      return {
        success: false,
        error: result.error || `Invite request failed (${response.status})`,
      }
    }
    return result
  } catch {
    return { success: false, error: 'Invalid response from server.' }
  }
}