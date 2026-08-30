export const EMAIL_VERIFY_COOLDOWN_MS = 60_000
export const EMAIL_VERIFY_TOKEN_TTL_MS = 24 * 60 * 60 * 1000
export const EMAIL_VERIFY_FROM = 'MoHeavy AI <noreply@moheavy.com>'

export const EMAIL_UNVERIFIED_HINT =
  'Confirm this inbox before filing permits. Check spam if you do not see the email.'

export const EMAIL_VERIFY_GATE_TITLE = 'Confirm your email to file permits'

export const EMAIL_VERIFY_GATE_BODY =
  'You can keep running route analysis. Portal Assist unlocks after you confirm the email on this account.'

export const EMAIL_VERIFY_ALREADY_CONFIRMED = 'Email is already confirmed.'

export const EMAIL_VERIFY_COOLDOWN_MESSAGE =
  'Please wait a minute before requesting another confirmation email.'

export const EMAIL_VERIFY_NOT_CONFIGURED = 'Email sending is not configured yet.'

export const EMAIL_NOT_VERIFIED_CODE = 'EMAIL_NOT_VERIFIED'

export const EMAIL_NOT_VERIFIED_FILING_ERROR = 'Confirm your email before filing permits.'

export const EMAIL_VERIFY_APPROVE_TITLE = 'Confirm your email on Profile to file permits'

export function isEmailVerified(
  row: { verified_at?: string | null } | null | undefined
): boolean {
  return Boolean(row?.verified_at)
}

export function isEmailVerifyCooldownActive(
  lastSentAt: string | null | undefined,
  nowMs = Date.now()
): boolean {
  if (!lastSentAt) return false
  const sentMs = Date.parse(lastSentAt)
  if (!Number.isFinite(sentMs)) return false
  return nowMs - sentMs < EMAIL_VERIFY_COOLDOWN_MS
}

export function emailVerifyCooldownRemainingMs(
  lastSentAt: string,
  nowMs = Date.now()
): number {
  const sentMs = Date.parse(lastSentAt)
  if (!Number.isFinite(sentMs)) return 0
  return Math.max(0, EMAIL_VERIFY_COOLDOWN_MS - (nowMs - sentMs))
}

export function resolveEmailVerifyOrigin(
  requestOrigin: string,
  nodeEnv = process.env.NODE_ENV
): string {
  if (nodeEnv === 'production') return 'https://moheavy.com'
  return requestOrigin.replace(/\/$/, '')
}

export function buildConfirmEmailUrl(origin: string, rawToken: string): string {
  const base = origin.replace(/\/$/, '')
  return `${base}/auth/confirm-email?token=${encodeURIComponent(rawToken)}`
}

export function buildConfirmEmailMessage(confirmUrl: string): { text: string; html: string } {
  const text = [
    'Confirm your MoHeavy AI email',
    '',
    'Click this link to confirm the inbox on this account:',
    confirmUrl,
    '',
    'This link expires in 24 hours. If you did not create a MoHeavy AI account, you can ignore this email.',
  ].join('\n')
  const html = `<p>Confirm your MoHeavy AI email</p><p>Click this link to confirm the inbox on this account:</p><p><a href="${confirmUrl}">${confirmUrl}</a></p><p>This link expires in 24 hours. If you did not create a MoHeavy AI account, you can ignore this email.</p>`
  return { text, html }
}

/** Fire-and-forget / resend helper used by login, profile, and Portal Assist. */
export function postEmailVerificationSend(
  accessToken: string,
  fetchImpl: typeof fetch = fetch
): Promise<Response> {
  return fetchImpl('/api/auth/email-verification', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ action: 'send' }),
  })
}

export function getEmailVerificationStatus(
  accessToken: string,
  fetchImpl: typeof fetch = fetch
): Promise<Response> {
  return fetchImpl('/api/auth/email-verification', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
}
