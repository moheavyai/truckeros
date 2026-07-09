import {
  DEV_BASE_OWNER_EMAIL,
  DEV_TEST_PERSONA_STORAGE_KEY,
  isDevBaseOwnerSwitchAllowed,
} from '@/lib/dev-mode'
import { normalizeInviteEmail } from '@/lib/team-invites'
import type { Session, SupabaseClient } from '@supabase/supabase-js'

export type DevAccountSwitchResult =
  | { success: true; session: Session }
  | { success: false; error: string }

/**
 * Exchange an admin-generated magic-link token for a browser Supabase session.
 * Uses verifyOtp so @supabase/ssr persists cookies across reloads (no redirect).
 */
export async function completeDevAccountSwitch(
  supabase: SupabaseClient,
  email: string,
  hashedToken: string
): Promise<DevAccountSwitchResult> {
  const normalizedEmail = normalizeInviteEmail(email)
  const token = hashedToken.trim()

  if (!normalizedEmail || !token) {
    return { success: false, error: 'Missing sign-in credentials' }
  }

  const { data, error: verifyError } = await supabase.auth.verifyOtp({
    token_hash: token,
    type: 'magiclink',
  })

  if (verifyError) {
    return { success: false, error: verifyError.message }
  }

  let session = data?.session ?? null
  if (!session?.user) {
    const {
      data: { session: polledSession },
    } = await supabase.auth.getSession()
    session = polledSession
  }

  if (!session?.user) {
    return {
      success: false,
      error: 'Switch succeeded but no active session was found. Please try again.',
    }
  }

  const sessionEmail = normalizeInviteEmail(session.user.email)
  if (sessionEmail !== normalizedEmail) {
    return {
      success: false,
      error: `Session email mismatch (expected ${normalizedEmail}, got ${sessionEmail ?? 'unknown'})`,
    }
  }

  return { success: true, session }
}

/** Persist or clear the dev test persona label in localStorage after a successful switch. */
export function persistDevTestPersonaEmail(email: string): void {
  if (typeof window === 'undefined') return

  const normalized = normalizeInviteEmail(email)
  if (!normalized) return

  if (normalized === DEV_BASE_OWNER_EMAIL) {
    window.localStorage.removeItem(DEV_TEST_PERSONA_STORAGE_KEY)
  } else {
    window.localStorage.setItem(DEV_TEST_PERSONA_STORAGE_KEY, normalized)
  }
}

/** Clear stale dev test persona on sign-out or direct login. */
export function clearDevTestPersonaEmail(): void {
  if (typeof window === 'undefined') return
  window.localStorage.removeItem(DEV_TEST_PERSONA_STORAGE_KEY)
}

/**
 * Client dropdown is best-effort under RLS; server allowlist uses admin client when available.
 * Mismatches are expected — server enforcement is authoritative.
 */

export function isDevBaseOwnerEmail(email: string | null | undefined): boolean {
  const normalized = normalizeInviteEmail(email)
  return normalized === DEV_BASE_OWNER_EMAIL
}

async function resolveRosterOrganizationId(
  supabase: SupabaseClient,
  userId: string,
  actorEmail: string | null | undefined
): Promise<string | null> {
  const { data: linkedRoster } = await supabase
    .from('team_member_profiles')
    .select('organization_id')
    .eq('linked_user_id', userId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (linkedRoster?.organization_id) {
    return linkedRoster.organization_id
  }

  const normalizedEmail = normalizeInviteEmail(actorEmail)
  if (!normalizedEmail) return null

  const { data: emailRoster } = await supabase
    .from('team_member_profiles')
    .select('organization_id')
    .eq('driver_email', normalizedEmail)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return emailRoster?.organization_id ?? null
}

export async function resolveDevSwitchOrganizationId(
  supabase: SupabaseClient,
  userId: string,
  actorEmail: string | null | undefined
): Promise<string | null> {
  const { data: memberProfile } = await supabase
    .from('member_profiles')
    .select('organization_id')
    .eq('user_id', userId)
    .maybeSingle()

  if (memberProfile?.organization_id) {
    return memberProfile.organization_id
  }

  return resolveRosterOrganizationId(supabase, userId, actorEmail)
}

export async function fetchDevSwitchAllowlistEmails(
  supabase: SupabaseClient,
  organizationId: string | null | undefined,
  actorEmail: string | null | undefined,
  options?: { adminClient?: SupabaseClient | null }
): Promise<Set<string>> {
  const allowed = new Set<string>([DEV_BASE_OWNER_EMAIL])

  const normalizedActor = normalizeInviteEmail(actorEmail)
  if (normalizedActor) allowed.add(normalizedActor)

  if (!organizationId) return allowed

  const queryClient = options?.adminClient ?? supabase

  const [{ data: roster }, { data: members }] = await Promise.all([
    queryClient
      .from('team_member_profiles')
      .select('driver_email')
      .eq('organization_id', organizationId),
    queryClient
      .from('member_profiles')
      .select('driver_email')
      .eq('organization_id', organizationId),
  ])

  for (const row of roster ?? []) {
    const email = normalizeInviteEmail(row.driver_email)
    if (email) allowed.add(email)
  }
  for (const row of members ?? []) {
    const email = normalizeInviteEmail(row.driver_email)
    if (email) allowed.add(email)
  }

  return allowed
}

export function isDevSwitchEmailAllowed(
  email: string,
  allowlist: Set<string>
): boolean {
  if (isDevBaseOwnerEmail(email) && isDevBaseOwnerSwitchAllowed()) return true

  const normalized = normalizeInviteEmail(email)
  return Boolean(normalized && allowlist.has(normalized))
}