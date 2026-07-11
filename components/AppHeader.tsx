'use client'

import { useEffect, useState } from 'react'
import { clearDevTestPersonaEmail } from '@/lib/dev-account-switch'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import CarrierContextBar from '@/components/CarrierContextBar'
import DevAccountSwitcher from '@/components/DevAccountSwitcher'
import { isIncompleteOnboarding, ONBOARDING_PATH } from '@/lib/onboarding'
import { resolveNavActor } from '@/lib/nav-actor'
import { useOrganizationContext } from '@/lib/organization-context'
import { fetchActorTeamContext } from '@/lib/roster-profile-link'
import {
  shouldShowEquipmentNav,
  shouldShowProfileNav,
  type MemberPermissionConfig,
} from '@/lib/team-permissions'
import type { UserRole } from '@/types/member-profile'

interface AppHeaderProps {
  user?: any
  activePage?: 'dashboard' | 'equipment' | 'profile' | 'carriers'
  ownOrganizationId?: string | null
  showWorkspaceBar?: boolean
}

export default function AppHeader({
  user,
  activePage,
  ownOrganizationId,
  showWorkspaceBar = true,
}: AppHeaderProps) {
  const router = useRouter()
  const { workspaceMode, activeOrganizationId } = useOrganizationContext(ownOrganizationId)
  const [navActor, setNavActor] = useState<{
    user_roles: UserRole[]
    is_primary_owner: boolean
    permissions: MemberPermissionConfig
  } | null>(null)
  const [navReady, setNavReady] = useState(false)
  const [incompleteOnboarding, setIncompleteOnboarding] = useState(false)

  useEffect(() => {
    if (!user?.id) {
      setNavActor(null)
      setIncompleteOnboarding(false)
      setNavReady(true)
      return
    }

    let cancelled = false
    const supabase = createClient()
    setNavReady(false)

    async function loadNavActor() {
      try {
        const { data: profile } = await supabase
          .from('member_profiles')
          .select('user_roles, is_primary_owner, organization_id')
          .eq('user_id', user.id)
          .maybeSingle()

        if (cancelled) return

        const { data: memberships } = await supabase
          .from('organization_memberships')
          .select('organization_id, role, is_primary_owner, permissions, created_at')
          .eq('user_id', user.id)
          .order('is_primary_owner', { ascending: false })
          .order('created_at', { ascending: false })
          .limit(20)

        if (cancelled) return

        let linkedRoster = null
        let organizationMembership = null
        if (!profile?.organization_id) {
          const teamContext = await fetchActorTeamContext(supabase, user.id, user.email)
          if (cancelled) return
          linkedRoster = teamContext.linkedRoster
          organizationMembership = teamContext.organizationMembership
        }

        const incomplete = isIncompleteOnboarding({
          actorEmail: user.email,
          ownProfile: profile
            ? {
                user_id: user.id,
                organization_id: profile.organization_id,
                is_primary_owner: profile.is_primary_owner,
                user_roles: profile.user_roles as UserRole[] | undefined,
              }
            : null,
          linkedRoster,
          organizationMembership,
        })

        if (cancelled) return
        setIncompleteOnboarding(incomplete)

        const resolved = resolveNavActor({
          profile: profile ?? null,
          memberships: memberships ?? [],
          workspaceMode,
          activeOrganizationId,
        })

        if (cancelled) return

        setNavActor({
          user_roles: resolved.user_roles,
          is_primary_owner: resolved.is_primary_owner,
          permissions: resolved.permissions,
        })
      } catch (error) {
        console.warn('[AppHeader] loadNavActor failed', error)
        if (!cancelled) {
          // Fail-closed: null actor keeps equipment/profile hidden.
          // Treat unknown onboarding status as incomplete so Dashboard stays hidden.
          setNavActor(null)
          setIncompleteOnboarding(true)
        }
      } finally {
        if (!cancelled) setNavReady(true)
      }
    }

    void loadNavActor()
    return () => {
      cancelled = true
    }
  }, [user?.id, user?.email, workspaceMode, activeOrganizationId])

  // Hide restricted nav until actor is loaded (avoids flash of privileged links).
  // During incomplete bootstrap, hide Dashboard/equipment so users stay on Welcome.
  const showDashboard = navReady && !incompleteOnboarding
  const showEquipment =
    navReady && !incompleteOnboarding && navActor ? shouldShowEquipmentNav(navActor) : false
  const showProfile = navReady && navActor ? shouldShowProfileNav(navActor) : incompleteOnboarding
  const showCarriers =
    navReady && !incompleteOnboarding && workspaceMode === 'service'

  const handleLogout = async () => {
    clearDevTestPersonaEmail()
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  const navLink = (href: string, label: string, isActive: boolean) => (
    <a
      href={href}
      className={`inline-flex items-center min-h-[40px] px-1.5 font-medium transition-colors touch-manipulation ${isActive ? 'text-black' : 'text-gray-700 hover:text-black'}`}
    >
      {label}
    </a>
  )

  return (
    <>
      <DevAccountSwitcher currentEmail={user?.email} />
      <header className="border-b bg-white sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 py-3 sm:py-4 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1 sm:flex-initial">
            <a
              href={incompleteOnboarding ? ONBOARDING_PATH : '/'}
              className="flex items-center gap-2 sm:gap-2.5 min-w-0 max-w-full"
            >
              <div className="w-8 h-8 bg-black rounded flex items-center justify-center shrink-0">
                <span className="text-white text-lg font-bold tracking-tighter">T</span>
              </div>
              <span className="text-lg sm:text-xl font-semibold tracking-tight truncate min-w-0">TruckerOS</span>
            </a>
          </div>

          <div className="flex items-center gap-2 sm:gap-4 text-xs sm:text-sm flex-wrap justify-end max-w-full">
            {/* Omit self-link on each page; swap Dashboard/Equipment/Profile → History in that slot.
                History stays unhighlighted (activePage excludes 'history'). */}
            {showDashboard &&
              (activePage === 'dashboard'
                ? navLink('/history', 'History', false)
                : navLink('/dashboard', 'Dashboard', activePage === 'dashboard'))}
            {showEquipment &&
              (activePage === 'equipment'
                ? navLink('/history', 'History', false)
                : navLink('/equipment', 'Equipment', activePage === 'equipment'))}
            {showCarriers && navLink('/carriers', 'Carriers', activePage === 'carriers')}
            {showProfile &&
              (activePage === 'profile' && showDashboard
                ? navLink('/history', 'History', false)
                : navLink('/profile', 'Profile', activePage === 'profile'))}
            <div className="w-px h-4 bg-gray-300 mx-0.5 sm:mx-1" />
            {user && (
              <span className="text-gray-600 hidden md:inline text-sm">{user.email}</span>
            )}
            <button
              onClick={handleLogout}
              className="inline-flex items-center justify-center min-h-[40px] px-3 sm:px-4 py-2 text-xs sm:text-sm border border-gray-300 hover:bg-gray-50 rounded-lg transition-colors shrink-0 touch-manipulation"
            >
              Logout
            </button>
          </div>
        </div>
      </header>
      {showWorkspaceBar && !incompleteOnboarding && (
        <CarrierContextBar ownOrganizationId={ownOrganizationId} />
      )}
    </>
  )
}
