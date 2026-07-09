/**
 * Carrier connection invites (service operator → new carrier Owner).
 * Glossary: docs/plans/glossary-accounts-roles.md
 * Phase 1: create restricted to Permit Clerk membership only.
 */
import {
  generateInviteToken,
  inviteExpiresAt,
  isInviteExpired,
  normalizeInviteEmail,
  normalizeInvitePhone,
} from '@/lib/team-invites'
import { validateUserRoles } from '@/lib/member-profile'
import type { MemberProfile, UserRole } from '@/types/member-profile'
import type {
  CarrierConnectionInvite,
  CarrierConnectionInviteStatus,
  CreateCarrierConnectionInviteInput,
} from '@/types/organization'

export const CARRIER_CONNECTION_INVITE_TTL_DAYS = 14
export const CARRIER_CONNECTION_INVITE_UNAVAILABLE_MESSAGE =
  'Invite not found or no longer valid'

/** Phase 1: only Permit Clerk may create carrier connection invites. */
export const CARRIER_CONNECTION_CREATOR_ROLES = ['Permit Clerk'] as const

export type CreateCarrierConnectionInviteValidated = {
  company_name: string
  usdot_number: string | null
  mc_number: string | null
  ein: string | null
  carrier_address: string | null
  carrier_phone: string | null
  carrier_email: string | null
  insurance_contact: string | null
  invite_contact_name: string | null
  invite_email: string
  invite_phone: string | null
  message: string | null
}

function trimOrNull(value: string | null | undefined): string | null {
  const trimmed = (value ?? '').trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizeUsdot(value: string | null | undefined): string | null {
  const trimmed = trimOrNull(value)
  if (!trimmed) return null
  return trimmed.replace(/^USDOT[-\s]*/i, '').trim() || null
}

function rolesIncludeCreator(roles: UserRole[] | string[]): boolean {
  return roles.some((role) =>
    (CARRIER_CONNECTION_CREATOR_ROLES as readonly string[]).includes(String(role))
  )
}

/**
 * Phase 1: requires organization_memberships.role Permit Clerk
 * (not home profile user_roles alone — closes PE via profile-only Clerk flag).
 * No Owner/Admin/primary_owner short-circuit.
 */
export function canCreateCarrierConnectionInvite(
  _profile: Pick<MemberProfile, 'user_roles' | 'is_primary_owner'> | null | undefined,
  membershipRoles?: readonly string[] | null
): boolean {
  if (!membershipRoles?.length) return false
  const membershipValidated = validateUserRoles([...membershipRoles])
  return rolesIncludeCreator(membershipValidated)
}

/** Strip secrets before returning invites to the client list UI. */
export function redactCarrierConnectionInviteForClient(
  invite: CarrierConnectionInvite
): Omit<CarrierConnectionInvite, 'invite_token'> & { invite_token?: never } {
  const { invite_token: _token, ...rest } = invite
  void _token
  return rest
}

export function buildCarrierConnectionInviteLink(baseUrl: string, token: string): string {
  const trimmed = baseUrl.replace(/\/$/, '')
  return `${trimmed}/carrier-invite/${encodeURIComponent(token)}`
}

export function validateCreateCarrierConnectionInviteInput(
  input: CreateCarrierConnectionInviteInput
): CreateCarrierConnectionInviteValidated {
  const company_name = trimOrNull(input.company_name)
  if (!company_name) {
    throw new Error('Company name is required')
  }
  if (company_name.length > 200) {
    throw new Error('Company name must be 200 characters or fewer')
  }

  const invite_email = normalizeInviteEmail(input.invite_email)
  if (!invite_email) {
    throw new Error('Invite email is required for carrier connection invites')
  }

  const invite_phone = normalizeInvitePhone(input.invite_phone)
  const carrier_email = normalizeInviteEmail(input.carrier_email) ?? invite_email

  return {
    company_name,
    usdot_number: normalizeUsdot(input.usdot_number),
    mc_number: trimOrNull(input.mc_number),
    ein: trimOrNull(input.ein),
    carrier_address: trimOrNull(input.carrier_address),
    carrier_phone: trimOrNull(input.carrier_phone),
    carrier_email,
    insurance_contact: trimOrNull(input.insurance_contact),
    invite_contact_name: trimOrNull(input.invite_contact_name),
    invite_email,
    invite_phone,
    message: trimOrNull(input.message),
  }
}

export function buildCarrierConnectionInviteRecord(input: {
  invitedByUserId: string
  organizationId: string
  validated: CreateCarrierConnectionInviteValidated
  appBaseUrl?: string
  token?: string
}): Omit<CarrierConnectionInvite, 'id' | 'created_at'> {
  const token = input.token ?? generateInviteToken()
  const invite_link = input.appBaseUrl
    ? buildCarrierConnectionInviteLink(input.appBaseUrl, token)
    : null

  return {
    invited_by_user_id: input.invitedByUserId,
    organization_id: input.organizationId,
    company_name: input.validated.company_name,
    usdot_number: input.validated.usdot_number,
    mc_number: input.validated.mc_number,
    ein: input.validated.ein,
    carrier_address: input.validated.carrier_address,
    carrier_phone: input.validated.carrier_phone,
    carrier_email: input.validated.carrier_email,
    insurance_contact: input.validated.insurance_contact,
    invite_contact_name: input.validated.invite_contact_name,
    invite_email: input.validated.invite_email,
    invite_phone: input.validated.invite_phone,
    invite_token: token,
    invite_link,
    status: 'pending',
    expires_at: inviteExpiresAt(new Date(), CARRIER_CONNECTION_INVITE_TTL_DAYS),
    message: input.validated.message,
  }
}

export function filterActivePendingCarrierConnectionInvites<
  T extends Pick<CarrierConnectionInvite, 'expires_at' | 'status'>,
>(invites: T[]): T[] {
  return invites.filter(
    (invite) =>
      invite.status === 'pending' &&
      !isInviteExpired({ expires_at: invite.expires_at, status: invite.status })
  )
}

export type AcceptCarrierConnectionInviteInput = {
  token: string
  acceptorUserId: string
  acceptorEmail?: string | null
}

export type AcceptCarrierConnectionInviteResult =
  | { ok: true; invite: CarrierConnectionInvite }
  | {
      ok: false
      code: 'invalid' | 'expired' | 'revoked' | 'accepted' | 'email_mismatch'
      message: string
    }

export function validateAcceptCarrierConnectionInvite(
  invite: CarrierConnectionInvite | null | undefined,
  input: AcceptCarrierConnectionInviteInput
): AcceptCarrierConnectionInviteResult {
  if (!invite || !invite.invite_token) {
    return { ok: false, code: 'invalid', message: 'Invite not found' }
  }

  if (invite.status === 'accepted') {
    return { ok: false, code: 'accepted', message: 'This invite has already been accepted' }
  }

  if (invite.status === 'revoked') {
    return { ok: false, code: 'revoked', message: 'This invite has been revoked' }
  }

  if (isInviteExpired({ expires_at: invite.expires_at, status: invite.status })) {
    return { ok: false, code: 'expired', message: 'This invite has expired' }
  }

  // Always require email binding for Owner-granting connection invites.
  const inviteEmail = normalizeInviteEmail(invite.invite_email)
  if (!inviteEmail) {
    return { ok: false, code: 'invalid', message: 'Invite not found' }
  }

  const acceptorEmail = normalizeInviteEmail(input.acceptorEmail)
  if (!acceptorEmail || inviteEmail !== acceptorEmail) {
    return {
      ok: false,
      code: 'email_mismatch',
      message: 'Sign in with the email address that received this invite',
    }
  }

  return { ok: true, invite }
}

export function formatCarrierConnectionEmailSubject(companyName: string): string {
  return `Connect with your permit clerk on TruckerOS — ${companyName}`
}

export function formatCarrierConnectionEmailBody(
  inviteLink: string,
  companyName: string,
  contactName?: string | null,
  message?: string | null
): string {
  const greeting = contactName?.trim() ? `Hi ${contactName.trim()},` : 'Hi,'
  const personalNote = message?.trim()
    ? `\n\nMessage from your permit clerk:\n${message.trim()}\n`
    : ''
  return (
    `${greeting}\n\n` +
    `A permit clerk invited you to connect as the Carrier Owner for ${companyName} on TruckerOS.\n\n` +
    `Accept the connection: ${inviteLink}` +
    personalNote +
    `\n\nIf you did not expect this invite, you can ignore this message.`
  )
}

export function formatCarrierConnectionSmsBody(
  inviteLink: string,
  companyName: string,
  message?: string | null
): string {
  const note = message?.trim() ? ` ${message.trim().slice(0, 80)}` : ''
  return `TruckerOS: accept carrier connection for ${companyName}:${note} ${inviteLink}`
}

export function isCarrierConnectionInviteStatus(
  value: string
): value is CarrierConnectionInviteStatus {
  return (
    value === 'pending' ||
    value === 'accepted' ||
    value === 'revoked' ||
    value === 'expired'
  )
}

export function isUsdotConflictError(message: string): boolean {
  const lower = message.toLowerCase()
  return (
    lower.includes('idx_organizations_usdot_number_unique') ||
    (lower.includes('usdot') && (lower.includes('duplicate') || lower.includes('unique')))
  )
}
