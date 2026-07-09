import type { OrganizationMembershipLink } from '@/lib/member-profile'
import { normalizeInviteEmail } from '@/lib/team-invites'
import type { TeamMemberProfile } from '@/types/member-profile'
import type { SupabaseClient } from '@supabase/supabase-js'

export type { OrganizationMembershipLink }

export type ActorTeamContext = {
  linkedRoster: TeamMemberProfile | null
  organizationMembership: OrganizationMembershipLink | null
}

/**
 * Load team linkage for bootstrap decisions. Membership is fetched first because
 * users can read their own organization_memberships under RLS even when roster
 * rows are not visible client-side.
 */
export async function fetchActorTeamContext(
  supabase: SupabaseClient,
  userId: string,
  actorEmail?: string | null
): Promise<ActorTeamContext> {
  const organizationMembership = await fetchOrganizationMembershipForUser(supabase, userId)
  const linkedRoster = await fetchLinkedTeamMemberRoster(supabase, userId, actorEmail)
  return { linkedRoster, organizationMembership }
}

/** Resolve roster row for an auth user via linked_user_id, then driver_email. */
export async function fetchLinkedTeamMemberRoster(
  supabase: SupabaseClient,
  userId: string,
  actorEmail?: string | null
): Promise<TeamMemberProfile | null> {
  const { data: linkedRoster, error: linkedError } = await supabase
    .from('team_member_profiles')
    .select('*')
    .eq('linked_user_id', userId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (linkedError) {
    console.warn('team_member_profiles linked_user_id lookup', linkedError)
  }

  if (linkedRoster) {
    return linkedRoster as TeamMemberProfile
  }

  const normalizedEmail = normalizeInviteEmail(actorEmail)
  if (!normalizedEmail) return null

  const { data: emailRoster, error: emailError } = await supabase
    .from('team_member_profiles')
    .select('*')
    .eq('driver_email', normalizedEmail)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (emailError) {
    console.warn('team_member_profiles driver_email lookup', emailError)
  }

  return (emailRoster as TeamMemberProfile | null) ?? null
}

/**
 * Pick the best membership when a user belongs to multiple orgs.
 * Prefers primary-owner home org, then most recently created membership.
 * Note: organization_memberships has created_at but not updated_at.
 */
export function pickPreferredMembership<
  T extends { organization_id?: string | null; is_primary_owner?: boolean | null; created_at?: string | null },
>(rows: T[] | null | undefined): T | null {
  if (!rows?.length) return null
  const withOrg = rows.filter((row) => Boolean(row.organization_id))
  if (!withOrg.length) return null

  const primary = withOrg.find((row) => row.is_primary_owner === true)
  if (primary) return primary

  return [...withOrg].sort((a, b) => {
    const aTime = Date.parse(a.created_at ?? '') || 0
    const bTime = Date.parse(b.created_at ?? '') || 0
    return bTime - aTime
  })[0]
}

/**
 * Membership for a specific org (home org for profile acting SSoT).
 * Prefer this over preferred/multi-org pick when gates/badges must match home.
 */
export async function fetchOrganizationMembershipForOrg(
  supabase: SupabaseClient,
  userId: string,
  organizationId: string | null | undefined
): Promise<OrganizationMembershipLink | null> {
  if (!organizationId) return null

  const { data, error } = await supabase
    .from('organization_memberships')
    .select('organization_id, role, is_primary_owner')
    .eq('user_id', userId)
    .eq('organization_id', organizationId)
    .maybeSingle()

  if (error) {
    console.warn('organization_memberships home-org lookup', error)
    return null
  }

  if (!data?.organization_id) return null
  return {
    organization_id: data.organization_id as string,
    role: (data.role as string | null | undefined) ?? null,
    is_primary_owner: data.is_primary_owner === true,
  }
}

export async function fetchOrganizationMembershipForUser(
  supabase: SupabaseClient,
  userId: string
): Promise<OrganizationMembershipLink | null> {
  const { data, error } = await supabase
    .from('organization_memberships')
    .select('organization_id, role, is_primary_owner, created_at')
    .eq('user_id', userId)
    .order('is_primary_owner', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(20)

  if (error) {
    console.warn('organization_memberships lookup', error)
    return null
  }

  const preferred = pickPreferredMembership(
    (data ?? []) as Array<{
      organization_id?: string | null
      role?: string | null
      is_primary_owner?: boolean | null
      created_at?: string | null
    }>
  )

  if (!preferred?.organization_id) return null
  return {
    organization_id: preferred.organization_id,
    role: preferred.role ?? null,
    is_primary_owner: preferred.is_primary_owner === true,
  }
}