import { readFileSync } from 'fs'
import path from 'path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/dev-mode', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/dev-mode')>()
  return {
    ...actual,
    isDevBaseOwnerSwitchAllowed: vi.fn(() => true),
  }
})

import { DEV_BASE_OWNER_EMAIL } from '@/lib/dev-mode'
import { DEV_TEST_PERSONA_STORAGE_KEY } from '@/lib/dev-mode'
import {
  clearDevTestPersonaEmail,
  completeDevAccountSwitch,
  fetchDevSwitchAllowlistEmails,
  isDevBaseOwnerEmail,
  isDevSwitchEmailAllowed,
  persistDevTestPersonaEmail,
  resolveDevSwitchOrganizationId,
} from './dev-account-switch'

function memberProfileFrom(result: { data: unknown; error: unknown }) {
  return {
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        maybeSingle: vi.fn(async () => result),
      })),
    })),
  }
}

function rosterFrom(result: { data: unknown; error: unknown }) {
  return {
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        order: vi.fn(() => ({
          limit: vi.fn(() => ({
            maybeSingle: vi.fn(async () => result),
          })),
        })),
      })),
    })),
  }
}

describe('dev-account-switch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('exchanges hashed_token via verifyOtp token_hash and uses returned session', async () => {
    const verifyOtp = vi.fn().mockResolvedValue({
      data: {
        user: { email: 'driver@example.com' },
        session: {
          user: { email: 'driver@example.com' },
          access_token: 'token-1',
        },
      },
      error: null,
    })
    const getSession = vi.fn()

    const result = await completeDevAccountSwitch(
      { auth: { verifyOtp, getSession } } as never,
      'driver@example.com',
      'hashed-token-abc'
    )

    expect(result.success).toBe(true)
    expect(verifyOtp).toHaveBeenCalledWith({
      token_hash: 'hashed-token-abc',
      type: 'magiclink',
    })
    expect(getSession).not.toHaveBeenCalled()
  })

  it('falls back to getSession when verifyOtp returns no session', async () => {
    const verifyOtp = vi.fn().mockResolvedValue({
      data: { user: { email: 'driver@example.com' }, session: null },
      error: null,
    })
    const getSession = vi.fn().mockResolvedValue({
      data: {
        session: {
          user: { email: 'driver@example.com' },
          access_token: 'token-1',
        },
      },
    })

    const result = await completeDevAccountSwitch(
      { auth: { verifyOtp, getSession } } as never,
      'driver@example.com',
      'hashed-token-abc'
    )

    expect(result.success).toBe(true)
    expect(getSession).toHaveBeenCalled()
  })

  it('returns error when verifyOtp succeeds but no session is available', async () => {
    const verifyOtp = vi.fn().mockResolvedValue({
      data: { user: { email: 'driver@example.com' }, session: null },
      error: null,
    })
    const getSession = vi.fn().mockResolvedValue({ data: { session: null } })

    const result = await completeDevAccountSwitch(
      { auth: { verifyOtp, getSession } } as never,
      'driver@example.com',
      'hashed-token-abc'
    )

    expect(result).toEqual({
      success: false,
      error: 'Switch succeeded but no active session was found. Please try again.',
    })
  })

  it('rejects empty credentials before verifyOtp', async () => {
    const verifyOtp = vi.fn()

    const result = await completeDevAccountSwitch(
      { auth: { verifyOtp } } as never,
      '',
      'hashed-token-abc'
    )

    expect(result).toEqual({ success: false, error: 'Missing sign-in credentials' })
    expect(verifyOtp).not.toHaveBeenCalled()
  })

  it('returns verifyOtp errors from completeDevAccountSwitch', async () => {
    const verifyOtp = vi.fn().mockResolvedValue({
      data: { user: null, session: null },
      error: { message: 'Token has expired or is invalid' },
    })

    const result = await completeDevAccountSwitch(
      { auth: { verifyOtp, getSession: vi.fn() } } as never,
      'driver@example.com',
      'bad-token'
    )

    expect(result).toEqual({ success: false, error: 'Token has expired or is invalid' })
  })

  it('rejects session email mismatch after verifyOtp', async () => {
    const verifyOtp = vi.fn().mockResolvedValue({
      data: {
        user: { email: 'other@example.com' },
        session: { user: { email: 'other@example.com' } },
      },
      error: null,
    })
    const getSession = vi.fn()

    const result = await completeDevAccountSwitch(
      { auth: { verifyOtp, getSession } } as never,
      'driver@example.com',
      'hashed-token-abc'
    )

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error).toContain('Session email mismatch')
    }
  })

  it('always allows the dev base owner email in development', () => {
    expect(isDevBaseOwnerEmail('andrehampton1@outlook.com')).toBe(true)
    expect(isDevBaseOwnerEmail('AndreHampton1@outlook.com')).toBe(true)
    expect(isDevSwitchEmailAllowed('andrehampton1@outlook.com', new Set())).toBe(true)
  })

  it('rejects non-owner emails outside the allowlist', () => {
    expect(isDevSwitchEmailAllowed('stranger@example.com', new Set(['driver@example.com']))).toBe(
      false
    )
  })

  it('rejects owner email when base-owner bypass is disabled', async () => {
    const { isDevBaseOwnerSwitchAllowed } = await import('@/lib/dev-mode')
    vi.mocked(isDevBaseOwnerSwitchAllowed).mockReturnValue(false)

    expect(isDevSwitchEmailAllowed('andrehampton1@outlook.com', new Set())).toBe(false)
  })

  it('includes base owner in allowlist even without organization context', async () => {
    const supabase = {
      from: vi.fn(),
    } as never

    const allowlist = await fetchDevSwitchAllowlistEmails(supabase, null, 'driver@example.com')

    expect(allowlist.has(DEV_BASE_OWNER_EMAIL)).toBe(true)
    expect(allowlist.has('driver@example.com')).toBe(true)
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it('includes actor email with null organization id and null actor email', async () => {
    const supabase = { from: vi.fn() } as never
    const allowlist = await fetchDevSwitchAllowlistEmails(supabase, null, null)
    expect(allowlist.has(DEV_BASE_OWNER_EMAIL)).toBe(true)
    expect(allowlist.size).toBe(1)
  })

  it('uses admin client for org roster lookups when provided', async () => {
    const authedFrom = vi.fn()
    const adminFrom = vi.fn((table: string) => {
      if (table === 'team_member_profiles') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(async () => ({
              data: [{ driver_email: 'driver@example.com' }],
              error: null,
            })),
          })),
        }
      }
      if (table === 'member_profiles') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(async () => ({
              data: [{ driver_email: 'admin@example.com' }],
              error: null,
            })),
          })),
        }
      }
      return {}
    })

    const allowlist = await fetchDevSwitchAllowlistEmails(
      { from: authedFrom } as never,
      'org-1',
      'driver@example.com',
      { adminClient: { from: adminFrom } as never }
    )

    expect(adminFrom).toHaveBeenCalledWith('team_member_profiles')
    expect(adminFrom).toHaveBeenCalledWith('member_profiles')
    expect(authedFrom).not.toHaveBeenCalled()
    expect(allowlist.has('driver@example.com')).toBe(true)
    expect(allowlist.has('admin@example.com')).toBe(true)
  })

  it('resolves organization id from member_profiles first', async () => {
    const from = vi.fn((table: string) => {
      if (table === 'member_profiles') {
        return memberProfileFrom({ data: { organization_id: 'org-member' }, error: null })
      }
      return rosterFrom({ data: null, error: null })
    })

    const orgId = await resolveDevSwitchOrganizationId(
      { from } as never,
      'user-1',
      'driver@example.com'
    )

    expect(orgId).toBe('org-member')
    expect(from).toHaveBeenCalledWith('member_profiles')
  })

  it('returns null when member profile has null organization_id and no roster match', async () => {
    const from = vi.fn((table: string) => {
      if (table === 'member_profiles') {
        return memberProfileFrom({ data: { organization_id: null }, error: null })
      }
      if (table === 'team_member_profiles') {
        return rosterFrom({ data: null, error: null })
      }
      return {}
    })

    const orgId = await resolveDevSwitchOrganizationId({ from } as never, 'user-1', null)
    expect(orgId).toBeNull()
  })

  it('prefers linked_user_id roster row over driver_email', async () => {
    const from = vi.fn((table: string) => {
      if (table === 'member_profiles') {
        return memberProfileFrom({ data: null, error: null })
      }
      if (table === 'team_member_profiles') {
        return {
          select: vi.fn((columns?: string) => ({
            eq: vi.fn((column: string) => {
              if (column === 'linked_user_id') {
                return {
                  order: vi.fn(() => ({
                    limit: vi.fn(() => ({
                      maybeSingle: vi.fn(async () => ({
                        data: { organization_id: 'org-linked' },
                        error: null,
                      })),
                    })),
                  })),
                }
              }
              return {
                order: vi.fn(() => ({
                  limit: vi.fn(() => ({
                    maybeSingle: vi.fn(async () => ({
                      data: { organization_id: 'org-email' },
                      error: null,
                    })),
                  })),
                })),
              }
            }),
          })),
        }
      }
      return {}
    })

    const orgId = await resolveDevSwitchOrganizationId(
      { from } as never,
      'user-1',
      'driver@example.com'
    )

    expect(orgId).toBe('org-linked')
  })

  it('falls back to driver_email roster lookup when linked_user_id has no row', async () => {
    const from = vi.fn((table: string) => {
      if (table === 'member_profiles') {
        return memberProfileFrom({ data: null, error: null })
      }
      if (table === 'team_member_profiles') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn((column: string) => {
              if (column === 'linked_user_id') {
                return {
                  order: vi.fn(() => ({
                    limit: vi.fn(() => ({
                      maybeSingle: vi.fn(async () => ({ data: null, error: null })),
                    })),
                  })),
                }
              }
              return {
                order: vi.fn(() => ({
                  limit: vi.fn(() => ({
                    maybeSingle: vi.fn(async () => ({
                      data: { organization_id: 'org-roster' },
                      error: null,
                    })),
                  })),
                })),
              }
            }),
          })),
        }
      }
      return {}
    })

    const orgId = await resolveDevSwitchOrganizationId(
      { from } as never,
      'user-1',
      'driver@example.com'
    )

    expect(orgId).toBe('org-roster')
  })

  it('persists team persona email to localStorage', () => {
    const storage = new Map<string, string>()
    vi.stubGlobal('window', {
      localStorage: {
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
      },
    })

    persistDevTestPersonaEmail('driver@example.com')

    expect(storage.get(DEV_TEST_PERSONA_STORAGE_KEY)).toBe('driver@example.com')
    vi.unstubAllGlobals()
  })

  it('clears persona localStorage when switching to owner', () => {
    const storage = new Map<string, string>([[DEV_TEST_PERSONA_STORAGE_KEY, 'driver@example.com']])
    vi.stubGlobal('window', {
      localStorage: {
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
      },
    })

    persistDevTestPersonaEmail('andrehampton1@outlook.com')

    expect(storage.has(DEV_TEST_PERSONA_STORAGE_KEY)).toBe(false)
    vi.unstubAllGlobals()
  })

  it('clearDevTestPersonaEmail removes stored persona', () => {
    const storage = new Map<string, string>([[DEV_TEST_PERSONA_STORAGE_KEY, 'driver@example.com']])
    vi.stubGlobal('window', {
      localStorage: {
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
      },
    })

    clearDevTestPersonaEmail()

    expect(storage.has(DEV_TEST_PERSONA_STORAGE_KEY)).toBe(false)
    vi.unstubAllGlobals()
  })

  it('regression: completeDevAccountSwitch uses token_hash verifyOtp shape', () => {
    const source = readFileSync(
      path.join(process.cwd(), 'lib', 'dev-account-switch.ts'),
      'utf8'
    )

    expect(source).toContain('token_hash')
    expect(source).not.toMatch(/verifyOtp\(\{[\s\S]*email:\s*normalizedEmail/)
  })

  it('regression: switch-user route does not return action_link redirect', () => {
    const source = readFileSync(
      path.join(process.cwd(), 'app', 'api', 'dev', 'switch-user', 'route.ts'),
      'utf8'
    )

    expect(source).toContain('hashed_token')
    expect(source).not.toContain('action_link')
    expect(source).not.toContain('redirect_to')
  })

  it('regression: DevAccountSwitcher does not redirect to action_link', () => {
    const source = readFileSync(
      path.join(process.cwd(), 'components', 'DevAccountSwitcher.tsx'),
      'utf8'
    )

    expect(source).toContain('completeDevAccountSwitch')
    expect(source).toContain('persistDevTestPersonaEmail')
    expect(source).not.toContain('action_link')
    expect(source).not.toMatch(/location\.href\s*=\s*actionLink/)
  })
})