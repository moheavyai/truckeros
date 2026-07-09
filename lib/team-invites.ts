import { validateUserRoles } from '@/lib/member-profile'
import { primaryRoleFromRoles } from '@/lib/team-permissions'
import type { UserRole } from '@/types/member-profile'
import type { OrganizationRole } from '@/types/organization'

export type TeamInviteStatus = 'pending' | 'accepted' | 'revoked' | 'expired'

export type TeamInviteChannel = 'email' | 'sms'

export type TeamInviteRow = {
  id: string
  organization_id: string
  invited_by_user_id: string
  role: OrganizationRole
  invite_email?: string | null
  invite_phone?: string | null
  invite_token: string
  invite_link?: string | null
  status: TeamInviteStatus
  accepted_by_user_id?: string | null
  accepted_at?: string | null
  expires_at: string
  created_at?: string
}

export type CreateTeamInviteInput = {
  organizationId: string
  role: OrganizationRole | UserRole | string
  inviteEmail?: string | null
  invitePhone?: string | null
  /** Base URL for invite links, e.g. https://app.example.com */
  appBaseUrl?: string
}

export type AcceptTeamInviteInput = {
  token: string
  acceptorUserId: string
  acceptorEmail?: string | null
}

export type AcceptTeamInviteResult =
  | { ok: true; invite: TeamInviteRow }
  | { ok: false; code: 'invalid' | 'expired' | 'revoked' | 'accepted' | 'email_mismatch'; message: string }

const INVITE_TOKEN_BYTES = 24
const DEFAULT_INVITE_TTL_DAYS = 14

/**
 * First email signup becomes primary Owner (see member-profile bootstrap).
 * Permit Clerk tier organizations may be created via a separate onboarding path;
 * team invites support linking clerks to carriers bi-directionally.
 */
export const PERMIT_CLERK_TIER_SIGNUP_NOTE =
  'Permit Clerk organizations use carrier-link requests or team invites for bi-directional access.'

/** Roles that may be assigned via team invite (Owner is bootstrap-only). */
export const INVITE_ALLOWED_ROLES = ['Admin', 'Driver', 'Permit Clerk', 'Viewer'] as const

export type InviteAllowedRole = (typeof INVITE_ALLOWED_ROLES)[number]

export function normalizeInviteEmail(value: string | null | undefined): string | null {
  const trimmed = (value ?? '').trim().toLowerCase()
  return trimmed.length > 0 ? trimmed : null
}

export function normalizeInvitePhone(value: string | null | undefined): string | null {
  const trimmed = (value ?? '').trim()
  return trimmed.length > 0 ? trimmed : null
}

/** Digits-only phone key for self-invite matching (ignores formatting). */
export function invitePhoneDigits(value: string | null | undefined): string | null {
  const digits = (value ?? '').replace(/\D/g, '')
  return digits.length > 0 ? digits : null
}

/**
 * Phase 1 PE block: cannot team-invite own email (or matching phone on phone-only)
 * as Permit Clerk to regain Service Mode.
 */
export function assertNotSelfPermitClerkInvite(options: {
  role: string
  inviteEmail?: string | null
  invitePhone?: string | null
  inviterEmails?: readonly (string | null | undefined)[]
  inviterPhones?: readonly (string | null | undefined)[]
}): void {
  if (String(options.role).trim() !== 'Permit Clerk') return

  const inviteEmail = normalizeInviteEmail(options.inviteEmail)
  if (inviteEmail) {
    const inviterEmails = (options.inviterEmails ?? [])
      .map((e) => normalizeInviteEmail(e))
      .filter((e): e is string => Boolean(e))
    if (inviterEmails.includes(inviteEmail)) {
      throw new Error('Cannot invite yourself as Permit Clerk')
    }
    return
  }

  // Phone-only: block when phone matches inviter; if inviter phone unknown, allow.
  const invitePhone = invitePhoneDigits(options.invitePhone)
  if (!invitePhone) return

  const inviterPhones = (options.inviterPhones ?? [])
    .map((p) => invitePhoneDigits(p))
    .filter((p): p is string => Boolean(p))
  if (inviterPhones.length === 0) return
  if (inviterPhones.includes(invitePhone)) {
    throw new Error('Cannot invite yourself as Permit Clerk')
  }
}

/**
 * Phase 1 PE block: cannot promote own membership role to Permit Clerk
 * via manager update / profile save sync (without service-role).
 * Idempotent stay-as-Clerk is allowed (previousRole already Permit Clerk).
 */
export function assertNotSelfPromoteToPermitClerk(options: {
  actorUserId: string
  targetUserId: string
  nextRole: string
  /** Existing membership role; when already Permit Clerk, save is allowed. */
  previousRole?: string | null
}): void {
  if (options.actorUserId !== options.targetUserId) return
  if (String(options.nextRole).trim() !== 'Permit Clerk') return
  if (String(options.previousRole ?? '').trim() === 'Permit Clerk') return
  throw new Error('Cannot reassign your own membership role to Permit Clerk')
}

export function validateInviteRole(role: string): OrganizationRole {
  const validated = validateUserRoles([role])
  const primary = primaryRoleFromRoles(validated)
  if (!primary) {
    throw new Error('Invalid invite role')
  }
  if (primary === 'Owner') {
    throw new Error('Owner role cannot be assigned via invite. Use carrier bootstrap instead.')
  }
  if (!(INVITE_ALLOWED_ROLES as readonly string[]).includes(primary)) {
    throw new Error('Invalid invite role')
  }
  return primary
}

export function filterActivePendingInvites<T extends Pick<TeamInviteRow, 'expires_at' | 'status'>>(
  invites: T[]
): T[] {
  return invites.filter((invite) => invite.status === 'pending' && !isInviteExpired(invite))
}

export function generateInviteToken(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '').slice(0, 8)
  }
  throw new Error('crypto.randomUUID is not available')
}

export function buildInviteLink(baseUrl: string, token: string): string {
  const trimmed = baseUrl.replace(/\/$/, '')
  return `${trimmed}/invite/${encodeURIComponent(token)}`
}

export function inviteExpiresAt(from: Date = new Date(), ttlDays = DEFAULT_INVITE_TTL_DAYS): string {
  const expires = new Date(from)
  expires.setDate(expires.getDate() + ttlDays)
  return expires.toISOString()
}

export function validateCreateTeamInviteInput(input: CreateTeamInviteInput): {
  role: OrganizationRole
  invite_email: string | null
  invite_phone: string | null
} {
  const invite_email = normalizeInviteEmail(input.inviteEmail)
  const invite_phone = normalizeInvitePhone(input.invitePhone)

  if (!invite_email && !invite_phone) {
    throw new Error('Provide an email or phone number for the invite')
  }

  return {
    role: validateInviteRole(String(input.role)),
    invite_email,
    invite_phone,
  }
}

export function buildTeamInviteRecord(
  input: CreateTeamInviteInput & { invitedByUserId: string; token?: string }
): Omit<TeamInviteRow, 'id' | 'created_at'> {
  const validated = validateCreateTeamInviteInput(input)
  const token = input.token ?? generateInviteToken()
  const invite_link = input.appBaseUrl ? buildInviteLink(input.appBaseUrl, token) : null

  return {
    organization_id: input.organizationId,
    invited_by_user_id: input.invitedByUserId,
    role: validated.role,
    invite_email: validated.invite_email,
    invite_phone: validated.invite_phone,
    invite_token: token,
    invite_link,
    status: 'pending',
    expires_at: inviteExpiresAt(),
  }
}

export function isInviteExpired(invite: Pick<TeamInviteRow, 'expires_at' | 'status'>): boolean {
  if (invite.status === 'expired') return true
  const expires = Date.parse(invite.expires_at)
  return Number.isFinite(expires) && expires < Date.now()
}

/**
 * Whether accepting an invite should rewrite the user's home member_profiles row.
 * - No home org → create/set home to invite org
 * - Same org but not primary owner → update roles for re-invite
 * - Same org primary owner → never rewrite (would demote)
 * - Different home org → membership-only multi-org join
 */
export function shouldRewriteHomeProfileOnInviteAccept(options: {
  existingOrganizationId?: string | null
  existingIsPrimaryOwner?: boolean | null
  inviteOrganizationId: string
}): boolean {
  const homeOrg = options.existingOrganizationId ?? null
  if (!homeOrg) return true
  if (homeOrg === options.inviteOrganizationId) {
    // Never demote an existing primary owner via invite accept.
    if (options.existingIsPrimaryOwner === true) return false
    return true
  }
  // Already has a different home org — membership-only join.
  return false
}

/**
 * True when the user already has a home org different from the invite org.
 * Same-org primary-owner skip (rewrite=false) is NOT multi-org.
 */
export function isMultiOrgInviteJoin(options: {
  existingOrganizationId?: string | null
  inviteOrganizationId: string
}): boolean {
  const homeOrg = options.existingOrganizationId ?? null
  if (!homeOrg) return false
  return homeOrg !== options.inviteOrganizationId
}

export function validateAcceptTeamInvite(
  invite: TeamInviteRow | null | undefined,
  input: AcceptTeamInviteInput
): AcceptTeamInviteResult {
  if (!invite || !invite.invite_token) {
    return { ok: false, code: 'invalid', message: 'Invite not found' }
  }

  if (invite.status === 'accepted') {
    return { ok: false, code: 'accepted', message: 'This invite has already been accepted' }
  }

  if (invite.status === 'revoked') {
    return { ok: false, code: 'revoked', message: 'This invite has been revoked' }
  }

  if (isInviteExpired(invite)) {
    return { ok: false, code: 'expired', message: 'This invite has expired' }
  }

  const inviteEmail = normalizeInviteEmail(invite.invite_email)
  const acceptorEmail = normalizeInviteEmail(input.acceptorEmail)
  // Require matching acceptor email whenever the invite is email-bound.
  if (inviteEmail && (!acceptorEmail || inviteEmail !== acceptorEmail)) {
    return {
      ok: false,
      code: 'email_mismatch',
      message: 'Sign in with the email address that received this invite',
    }
  }

  return { ok: true, invite }
}

/** Uniform client-facing message for invalid/expired/mismatch (avoids token oracles). */
export const INVITE_UNAVAILABLE_MESSAGE = 'Invite not found or no longer valid'

/**
 * SMS delivery is stubbed: invite_link + phone are persisted.
 * Set TWILIO_ENABLED=true to enable real Twilio delivery in a future integration.
 */
export function shouldSendInviteSms(): boolean {
  return process.env.TWILIO_ENABLED === 'true'
}

export function formatInviteSmsBody(inviteLink: string, role: string): string {
  return `You have been invited to TruckerOS as ${role}. Accept: ${inviteLink}`
}