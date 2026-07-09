import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  INVITE_NOTIFY_LOG_PREFIX,
  formatInviteEmailBody,
  formatInviteEmailSubject,
  sendInviteNotifications,
  shouldSendInviteEmail,
} from './invite-notifications'

describe('shouldSendInviteEmail', () => {
  const original = process.env.INVITE_EMAIL_ENABLED

  afterEach(() => {
    process.env.INVITE_EMAIL_ENABLED = original
  })

  it('is false unless INVITE_EMAIL_ENABLED=true', () => {
    delete process.env.INVITE_EMAIL_ENABLED
    expect(shouldSendInviteEmail()).toBe(false)
    process.env.INVITE_EMAIL_ENABLED = 'true'
    expect(shouldSendInviteEmail()).toBe(true)
  })
})

describe('formatInviteEmailSubject/Body', () => {
  it('includes role and invite link', () => {
    expect(formatInviteEmailSubject('Driver')).toContain('Driver')
    expect(formatInviteEmailBody('https://app.example.com/invite/abc', 'Driver')).toContain(
      'https://app.example.com/invite/abc'
    )
  })
})

describe('sendInviteNotifications', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    delete process.env.INVITE_EMAIL_ENABLED
    delete process.env.TWILIO_ENABLED
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('logs provider-enabled stub when INVITE_EMAIL_ENABLED is set', () => {
    process.env.INVITE_EMAIL_ENABLED = 'true'
    sendInviteNotifications({
      invite: {
        role: 'Driver',
        invite_email: 'driver@example.com',
        invite_phone: null,
        invite_link: 'https://app.example.com/invite/token-1',
      },
      channels: ['email'],
    })

    const logs = vi.mocked(console.log).mock.calls.map((call) => call.join(' '))
    expect(logs.some((line) => line.includes('email provider enabled (stubbed)'))).toBe(true)
  })

  it('returns stubbed email and sms results with invite-notify logs', () => {
    const result = sendInviteNotifications({
      invite: {
        role: 'Driver',
        invite_email: 'driver@example.com',
        invite_phone: '(555) 123-4567',
        invite_link: 'https://app.example.com/invite/token-1',
      },
    })

    expect(result.email).toMatchObject({
      channel: 'email',
      to: 'driver@example.com',
      sent: false,
      stubbed: true,
    })
    expect(result.sms).toMatchObject({
      channel: 'sms',
      to: '(555) 123-4567',
      sent: false,
      stubbed: true,
    })

    const logs = vi.mocked(console.log).mock.calls.map((call) => call.join(' '))
    expect(logs.some((line) => line.includes(INVITE_NOTIFY_LOG_PREFIX))).toBe(true)
    expect(logs.some((line) => line.includes('stubbed email'))).toBe(true)
    expect(logs.some((line) => line.includes('stubbed sms'))).toBe(true)
  })

  it('omits sms when invite link is missing', () => {
    const result = sendInviteNotifications({
      invite: {
        role: 'Viewer',
        invite_email: 'viewer@example.com',
        invite_phone: '(555) 999-0000',
        invite_link: null,
      },
    })

    expect(result.email).not.toBeNull()
    expect(result.sms).toBeNull()
  })
})