'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import AppHeader from '@/components/AppHeader'
import {
  canSeeSetupGuidance,
  getDashboardSetupCtas,
  getVisibleDashboardTools,
  isIncompleteOnboarding,
  ONBOARDING_PATH,
  readOnboardingGuidedDismissed,
  resolveOnboardingStep,
  type DashboardTool,
  type OnboardingStep,
} from '@/lib/onboarding'
import { resolveNavActor } from '@/lib/nav-actor'
import { useOrganizationContext } from '@/lib/organization-context'
import { fetchActorTeamContext } from '@/lib/roster-profile-link'
import {
  canAccessArea,
  hasOwnerOrAdminRole,
  resolveEffectivePermissions,
  shouldShowEquipmentNav,
  type MemberPermissionConfig,
} from '@/lib/team-permissions'
import type { MemberProfile, UserRole } from '@/types/member-profile'

/** Mobile-first contrast: stronger borders/text on small screens; softer from sm: up (matches permit-test / portal-assist). */
const buttonSecondaryClass =
  'inline-flex items-center gap-3 border border-gray-500 sm:border-gray-300 hover:bg-white px-6 py-4 rounded-xl text-base font-semibold transition-all text-gray-900'
const buttonPrimaryClass =
  'group inline-flex items-center gap-3 bg-black hover:bg-gray-900 text-white px-8 py-4 rounded-xl text-base font-semibold transition-all active:scale-[0.985]'
const mutedTextClass = 'text-gray-600 sm:text-gray-500'
const bodyTextClass = 'text-gray-700 sm:text-gray-600'
const cardClass = 'bg-white border border-gray-300 sm:border-gray-200 rounded-2xl p-6'

export default function Dashboard() {
  const [user, setUser] = useState<any>(null)
  const [ownOrganizationId, setOwnOrganizationId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [recentRequests, setRecentRequests] = useState<any[]>([])
  const [navActor, setNavActor] = useState<{
    user_roles: UserRole[]
    is_primary_owner: boolean
    permissions: MemberPermissionConfig
  } | null>(null)
  const [membershipRows, setMembershipRows] = useState<
    Array<{
      organization_id?: string | null
      role?: string | null
      is_primary_owner?: boolean | null
      permissions?: unknown
      created_at?: string | null
    }>
  >([])
  const [profileSnapshot, setProfileSnapshot] = useState<MemberProfile | null>(null)
  const [teamMemberCount, setTeamMemberCount] = useState(1)
  const [hasEquipment, setHasEquipment] = useState(false)
  const [guidedDismissed, setGuidedDismissed] = useState(false)
  const router = useRouter()
  const { workspaceMode, activeOrganizationId } = useOrganizationContext(ownOrganizationId)

  /**
   * Authentication Guard (client-side) + Initial Data Load
   *
   * - Checks for a valid Supabase session on mount.
   * - Redirects unauthenticated users to /login immediately.
   * - Incomplete first-time onboarding → Welcome/profile (not Dashboard tools).
   * - Once authenticated, fetches the user's recent permit requests.
   * - Listens for auth changes (logout in another tab, token expiry, etc.).
   * - Keeps the page behind a loading state until auth is confirmed.
   * - Consistent protection pattern with /permit-test and other protected routes.
   */
  useEffect(() => {
    const supabase = createClient()
    let cancelled = false

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (cancelled) return

      if (!session) {
        router.push('/login')
        setLoading(false)
        return
      }

      setUser(session.user)
      setGuidedDismissed(readOnboardingGuidedDismissed(session.user.id))

      try {
        const { data: profile } = await supabase
          .from('member_profiles')
          .select('*')
          .eq('user_id', session.user.id)
          .maybeSingle()

        if (cancelled) return

        let linkedRoster = null
        let organizationMembership = null
        if (!profile?.organization_id) {
          const teamContext = await fetchActorTeamContext(
            supabase,
            session.user.id,
            session.user.email
          )
          linkedRoster = teamContext.linkedRoster
          organizationMembership = teamContext.organizationMembership
        }

        if (cancelled) return

        const incomplete = isIncompleteOnboarding({
          actorEmail: session.user.email,
          ownProfile: (profile as MemberProfile | null) ?? null,
          linkedRoster,
          organizationMembership,
        })

        if (incomplete) {
          // Stay on loading shell (no tools flash) while navigating to Welcome.
          router.replace(ONBOARDING_PATH)
          return
        }

        const typedProfile = (profile as MemberProfile | null) ?? null
        setProfileSnapshot(typedProfile)

        if (typedProfile?.organization_id) {
          setOwnOrganizationId(typedProfile.organization_id)
        }

        const { data: memberships } = await supabase
          .from('organization_memberships')
          .select('organization_id, role, is_primary_owner, permissions, created_at')
          .eq('user_id', session.user.id)
          .order('is_primary_owner', { ascending: false })
          .order('created_at', { ascending: false })
          .limit(20)

        if (cancelled) return

        setMembershipRows(memberships ?? [])

        const resolved = resolveNavActor({
          profile: typedProfile
            ? {
                user_roles: typedProfile.user_roles,
                is_primary_owner: typedProfile.is_primary_owner,
                organization_id: typedProfile.organization_id,
              }
            : null,
          memberships: memberships ?? [],
          workspaceMode,
          activeOrganizationId,
        })

        setNavActor({
          user_roles: resolved.user_roles,
          is_primary_owner: resolved.is_primary_owner,
          permissions: resolved.permissions,
        })

        // ownOrganizationId is home only — never effective/active Service Mode org.
        // (Already set from typedProfile.organization_id above.)

        const setupActor = {
          user_roles: resolved.user_roles,
          is_primary_owner: resolved.is_primary_owner,
          permissions: resolved.permissions,
        }
        const canManageSetup = canSeeSetupGuidance(setupActor)

        // Soft setup metrics: home org only (not active Service Mode client).
        const orgId = typedProfile?.organization_id ?? null
        if (orgId && canManageSetup) {
          const [{ count: memberCount }, { count: equipCount }] = await Promise.all([
            supabase
              .from('member_profiles')
              .select('id', { count: 'exact', head: true })
              .eq('organization_id', orgId),
            supabase
              .from('equipment_profiles')
              .select('id', { count: 'exact', head: true })
              .eq('organization_id', orgId),
          ])
          if (cancelled) return
          setTeamMemberCount(memberCount ?? 1)
          setHasEquipment((equipCount ?? 0) > 0)
        } else {
          setTeamMemberCount(1)
          setHasEquipment(false)
        }

        // Fetch real recent requests (only after confirming the user is logged in)
        const canReadHistory = canAccessArea(
          'permit_agent',
          resolveEffectivePermissions(setupActor)
        )

        if (canReadHistory) {
          const { data: requests } = await supabase
            .from('permit_requests')
            .select('*')
            .eq('user_id', session.user.id)
            .order('created_at', { ascending: false })
            .limit(5)

          if (cancelled) return

          if (requests) {
            setRecentRequests(requests)
          }
        }

        // Only settle loading when we stay on Dashboard with data (no tools flash on redirect).
        if (!cancelled) setLoading(false)
      } catch (error) {
        console.warn('[dashboard] load failed', error)
        // Fail-closed: unknown onboarding/profile status → Welcome, not empty Dashboard shell.
        // Keep loading true so incomplete users never see a tools flash.
        if (!cancelled) {
          router.replace(ONBOARDING_PATH)
        }
      }
    })

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) {
        router.push('/login')
      } else {
        setUser(session.user)
      }
    })

    return () => {
      cancelled = true
      listener.subscription.unsubscribe()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount auth guard once; workspace recompute below
  }, [router])

  // Recompute nav actor when workspace / active carrier changes (service mode).
  useEffect(() => {
    if (!user?.id || loading) return

    const resolved = resolveNavActor({
      profile: profileSnapshot
        ? {
            user_roles: profileSnapshot.user_roles,
            is_primary_owner: profileSnapshot.is_primary_owner,
            organization_id: profileSnapshot.organization_id,
          }
        : null,
      memberships: membershipRows,
      workspaceMode,
      activeOrganizationId,
    })

    setNavActor({
      user_roles: resolved.user_roles,
      is_primary_owner: resolved.is_primary_owner,
      permissions: resolved.permissions,
    })
  }, [
    user?.id,
    loading,
    workspaceMode,
    activeOrganizationId,
    profileSnapshot,
    membershipRows,
  ])

  const onboardingStep: OnboardingStep = useMemo(
    () =>
      resolveOnboardingStep({
        incompleteOnboarding: false,
        ownProfile: profileSnapshot,
        teamMemberCount,
        hasEquipment,
        dismissedGuidedSteps: guidedDismissed,
        canManageSetup: canSeeSetupGuidance(navActor),
      }),
    [profileSnapshot, teamMemberCount, hasEquipment, guidedDismissed, navActor]
  )

  const tools: DashboardTool[] = useMemo(
    () =>
      getVisibleDashboardTools(navActor, {
        workspaceMode: workspaceMode === 'service' ? 'service' : 'carrier',
      }),
    [navActor, workspaceMode]
  )

  const setupCtas = useMemo(
    () =>
      getDashboardSetupCtas({
        step: onboardingStep,
        canManageTeam: navActor
          ? canAccessArea('profiles', resolveEffectivePermissions(navActor), { requireWrite: true }) ||
            hasOwnerOrAdminRole(navActor)
          : false,
        canManageEquipment: navActor ? shouldShowEquipmentNav(navActor) : false,
      }),
    [onboardingStep, navActor]
  )

  const primaryTool = tools.find((t) => t.primary) ?? tools[0]
  const secondaryTools = tools.filter((t) => t.id !== primaryTool?.id)

  // === Authentication Protection ===
  // Show a clean, branded loading state while verifying the user's session.
  // This prevents any flash of protected content and provides good UX.
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          {/* TruckerOS brand mark */}
          <div className="w-14 h-14 bg-black rounded-xl flex items-center justify-center mx-auto mb-4 shadow-sm">
            <span className="text-white text-3xl font-bold tracking-tighter">T</span>
          </div>
          <p className="text-gray-700 font-semibold text-lg">Checking authentication...</p>
          <p className={`${mutedTextClass} text-sm mt-1`}>Please wait while we verify your session</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader user={user} activePage="dashboard" ownOrganizationId={ownOrganizationId} />

      <main className="max-w-7xl mx-auto px-6 py-10">
        {/* Welcome Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-semibold tracking-tight text-gray-900">
            Welcome back{user?.email ? `, ${user.email.split('@')[0]}` : ''}
          </h1>
          <p className={`${bodyTextClass} mt-1.5 text-[15px]`}>
            Get accurate, route-specific permit intelligence in seconds.
          </p>
        </div>

        {/* Incomplete setup CTAs (role-gated, honors guided dismiss) */}
        {setupCtas.length > 0 && (
          <div className="mb-8 rounded-2xl border border-amber-200 bg-amber-50 p-5">
            <h2 className="font-semibold text-amber-950 tracking-tight">Finish setting up</h2>
            <p className="text-sm text-amber-900/90 mt-1">
              Complete team invites or equipment so route analysis has accurate data.
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              {setupCtas.map((cta) => (
                <a
                  key={cta.href + cta.label}
                  href={cta.href}
                  className="inline-flex items-center gap-2 rounded-xl border border-amber-400 sm:border-amber-300 bg-white px-4 py-2.5 text-sm font-semibold text-amber-950 hover:bg-amber-100 transition"
                >
                  {cta.label}
                  <span className="text-amber-800 sm:text-amber-700">→</span>
                </a>
              ))}
            </div>
          </div>
        )}

        {/* Primary CTA — role-filtered tools */}
        <div className="mb-10 flex flex-wrap gap-3">
          {primaryTool && (
            <a
              href={primaryTool.href}
              className={buttonPrimaryClass}
            >
              <span>{primaryTool.label}</span>
              <span className="text-xl group-hover:translate-x-0.5 transition">→</span>
            </a>
          )}
          {secondaryTools.map((tool) => (
            <a
              key={tool.id}
              href={tool.href}
              className={buttonSecondaryClass}
            >
              {tool.label}
            </a>
          ))}
          {tools.length === 0 && (
            <p className={`text-sm ${bodyTextClass}`}>
              No tools available for your role yet.{' '}
              <a href="/profile" className="font-medium text-black underline underline-offset-2">
                Open Profile
              </a>
            </p>
          )}
          {primaryTool?.description && (
            <p className={`text-sm ${mutedTextClass} mt-2 ml-1 basis-full`}>{primaryTool.description}</p>
          )}
        </div>

        {/* Stats + Quick Cards — only when permit history is in scope */}
        {tools.some((t) => t.id === 'history' || t.id === 'permit_analysis') && (
          <div className="grid md:grid-cols-3 gap-6 mb-10">
            <div className={cardClass}>
              <div className={`text-sm ${mutedTextClass} mb-1`}>Recent analyses</div>
              <div className="text-4xl font-semibold tracking-tighter text-gray-900">
                {recentRequests.length > 0 ? recentRequests.length : '—'}
              </div>
              <div className={`text-xs ${mutedTextClass} mt-2`}>Recent saved runs</div>
            </div>
            <div className={cardClass}>
              <div className={`text-sm ${mutedTextClass} mb-1`}>Permits Required</div>
              <div className="text-4xl font-semibold tracking-tighter text-gray-900">
                {recentRequests.reduce(
                  (sum, req) => sum + (req.permit_required_states?.length || 0),
                  0
                ) || '—'}
              </div>
              <div className={`text-xs ${mutedTextClass} mt-2`}>Across recent routes</div>
            </div>
            <div className={cardClass}>
              <div className={`text-sm ${mutedTextClass} mb-1`}>Tools for your role</div>
              <div className="text-4xl font-semibold tracking-tighter text-gray-900">{tools.length}</div>
              <div className={`text-xs ${mutedTextClass} mt-2`}>Based on membership permissions</div>
            </div>
          </div>
        )}

        {/* Main Content Grid */}
        <div className="grid lg:grid-cols-3 gap-6">
          {/* Recent Activity */}
          {tools.some((t) => t.id === 'history' || t.id === 'permit_analysis') && (
            <div className={`lg:col-span-2 ${cardClass}`}>
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-semibold text-lg tracking-tight text-gray-900">Recent Analyses</h2>
                {tools.some((t) => t.id === 'history') && (
                  <a href="/history" className={`text-sm ${bodyTextClass} hover:text-black`}>
                    View all →
                  </a>
                )}
              </div>

              <div className="divide-y divide-gray-200 sm:divide-gray-100">
                {recentRequests.length > 0 ? (
                  recentRequests.map((req, index) => {
                    const permitCount = req.permit_required_states?.length || 0
                    const date = req.created_at ? new Date(req.created_at).toLocaleDateString() : ''

                    return (
                      <div key={index} className="py-4 flex items-center justify-between text-sm">
                        <div>
                          <div className="font-medium text-gray-900">
                            {req.origin_city}, {req.origin_state} → {req.destination_city},{' '}
                            {req.destination_state}
                          </div>
                          <div className={`${mutedTextClass} text-xs mt-0.5`}>
                            {req.weight?.toLocaleString()} lbs • {req.length} ft
                          </div>
                        </div>
                        <div className="text-right">
                          <div
                            className={`${permitCount > 0 ? 'text-orange-700 sm:text-orange-600' : 'text-emerald-700 sm:text-emerald-600'} font-medium text-xs`}
                          >
                            {permitCount > 0
                              ? `${permitCount} State${permitCount > 1 ? 's' : ''} Require Permit`
                              : 'No Permit Required'}
                          </div>
                          <div className={`${mutedTextClass} text-xs`}>{date}</div>
                        </div>
                      </div>
                    )
                  })
                ) : (
                  <div className={`py-6 text-center text-sm ${mutedTextClass}`}>
                    No analyses yet. Run your first route analysis to see history here.
                  </div>
                )}
              </div>

              {recentRequests.length > 0 && (
                <div className={`pt-4 text-xs ${mutedTextClass} border-t border-gray-200 sm:border-gray-100`}>
                  Showing your last {recentRequests.length} saved analyses.
                </div>
              )}
            </div>
          )}

          {/* Tips / Guidance */}
          <div
            className={`${cardClass} ${
              tools.some((t) => t.id === 'history' || t.id === 'permit_analysis')
                ? ''
                : 'lg:col-span-3'
            }`}
          >
            <h2 className="font-semibold text-lg tracking-tight text-gray-900 mb-4">Pro Tips</h2>
            <div className="space-y-4 text-sm">
              <div className="flex gap-3">
                <div className="text-lg">🛣️</div>
                <div>
                  <div className="font-medium text-gray-900">Use real coordinates</div>
                  <div className={`${bodyTextClass} text-xs`}>
                    Geocoding your origin and destination gives the most accurate corridor.
                  </div>
                </div>
              </div>
              <div className="flex gap-3">
                <div className="text-lg">❄️</div>
                <div>
                  <div className="font-medium text-gray-900">Check seasonal restrictions</div>
                  <div className={`${bodyTextClass} text-xs`}>
                    Northern routes often have spring frost laws that reduce allowable weights.
                  </div>
                </div>
              </div>
              {shouldShowEquipmentNav(navActor) && (
                <div className="flex gap-3">
                  <div className="text-lg">🚛</div>
                  <div>
                    <div className="font-medium text-gray-900">Use the Rig Builder first</div>
                    <div className={`${bodyTextClass} text-xs`}>
                      Save precise tractor/trailer measurements once — then they prefill every
                      permit request with accurate overall length.
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
