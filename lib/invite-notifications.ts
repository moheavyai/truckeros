import {
  formatInviteSmsBody,
  normalizeInviteEmail,
  normalizeInvitePhone,
  shouldSendInviteSms,
  type TeamInviteChannel,
} from '@/lib/team-invites'

export type InviteNotificationResult = {
  channel: TeamInviteChannel
  to: string
  role: string
  invite_link: string | null
  sent: boolean
  stubbed: boolean
  subject?: string
  body: string
}

export type SendInviteNotificationsInput = {
  invite: {
    role: string
    invite_email?: string | null
    invite_phone?: string | null
    invite_link?: string | null
  }
  channels?: TeamInviteChannel[]
  /** Optional overrides (e.g. carrier connection invites). */
  emailSubject?: string
  emailBody?: string
  smsBody?: string
}

export const INVITE_NOTIFY_LOG_PREFIX = '[invite-notify]'

/**
 * Email delivery is stubbed unless INVITE_EMAIL_ENABLED=true.
 * Integrate with SendGrid/Resend/etc. when enabling real delivery.
 */
export function shouldSendInviteEmail(): boolean {
  return process.env.INVITE_EMAIL_ENABLED === 'true'
}

export function formatInviteEmailSubject(role: string): string {
  return `You're invited to TruckerOS as ${role}`
}

export function formatInviteEmailBody(inviteLink: string, role: string): string {
  return `You have been invited to join TruckerOS as ${role}.\n\nAccept your invite: ${inviteLink}`
}

export function logInviteNotification(
  action: string,
  details: Record<string, unknown>
): void {
  console.log(INVITE_NOTIFY_LOG_PREFIX, action, details)
}

export function sendInviteNotifications(input: SendInviteNotificationsInput): {
  email: InviteNotificationResult | null
  sms: InviteNotificationResult | null
} {
  const channels = input.channels ?? ['email', 'sms']
  const { invite } = input
  const inviteLink = invite.invite_link ?? null
  const role = invite.role

  let email: InviteNotificationResult | null = null
  let sms: InviteNotificationResult | null = null

  const emailTo = normalizeInviteEmail(invite.invite_email)
  if (channels.includes('email') && emailTo) {
    const providerEnabled = shouldSendInviteEmail()
    const subject = input.emailSubject ?? formatInviteEmailSubject(role)
    const body =
      input.emailBody ??
      (inviteLink
        ? formatInviteEmailBody(inviteLink, role)
        : `You have been invited to TruckerOS as ${role}.`)
    // Delivery is always stubbed until a real email provider is integrated.
    const sent = false
    const stubbed = true
    email = {
      channel: 'email',
      to: emailTo,
      role,
      invite_link: inviteLink,
      sent,
      stubbed,
      subject,
      body,
    }
    logInviteNotification(providerEnabled ? 'email provider enabled (stubbed)' : 'stubbed email', {
      channel: 'email',
      to: emailTo,
      role,
      invite_link: inviteLink,
      sent,
      stubbed,
      provider_enabled: providerEnabled,
    })
    logInviteNotification('email preview', { subject, body })
  }

  const phoneTo = normalizeInvitePhone(invite.invite_phone)
  if (channels.includes('sms') && phoneTo && inviteLink) {
    const providerEnabled = shouldSendInviteSms()
    const body = input.smsBody ?? formatInviteSmsBody(inviteLink, role)
    // Delivery is always stubbed until Twilio (or similar) is integrated.
    const sent = false
    const stubbed = true
    sms = {
      channel: 'sms',
      to: phoneTo,
      role,
      invite_link: inviteLink,
      sent,
      stubbed,
      body,
    }
    logInviteNotification(providerEnabled ? 'sms provider enabled (stubbed)' : 'stubbed sms', {
      channel: 'sms',
      to: phoneTo,
      role,
      invite_link: inviteLink,
      sent,
      stubbed,
      provider_enabled: providerEnabled,
    })
    logInviteNotification('sms preview', { body })
  }

  return { email, sms }
}