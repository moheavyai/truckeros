/**
 * First-time signup / welcome onboarding helpers.
 * Uses existing profile + membership state — no parallel permission system.
 */

import { DEFAULT_POST_LOGIN_PATH } from '@/lib/auth-redirect'
import { isForcedCarrierOwner } from '@/lib/forced-carrier-owner'
import {
  needsPrimaryOwnerBootstrap,
  type OrganizationMembershipLink,
} from '@/lib/member-profile'
import {
  canAccessArea,
  hasOwnerOrAdminRole,
  primaryRoleFromRoles,
  resolveEffectivePermissions,
  shouldShowEquipmentNav,
  shouldShowProfileNav,
  type PermissionActor,
} from '@/lib/team-permissions'
import type { MemberProfile, TeamMemberProfile, UserRole } from '@/types/member-profile'

/** Profile is the Welcome / onboarding surface (bootstrap card + guided next steps). */
export const ONBOARDING_PATH = '/profile'

/**
 * Default home after onboarding is complete.
 * Single source of truth — re-exports auth-redirect default to avoid drift.
 */
export const DEFAULT_HOME_PATH = DEFAULT_POST_LOGIN_PATH

export type OnboardingPersona =
  | 'master'
  | 'carrier_owner'
  | 'permit_clerk'
  | 'admin'
  | 'driver'
  | 'viewer'
  | 'team_member'

export type OnboardingStep = 'company' | 'team_or_equipment' | 'complete'

export type DashboardToolId =
  | 'permit_analysis'
  | 'equipment'
  | 'profile'
  | 'history'
  | 'carriers'

export type DashboardTool = {
  id: DashboardToolId
  label: string
  href: string
  description: string
  primary?: boolean
}

export type OnboardingActorSnapshot = {
  actorEmail?: string | null
  ownProfile?: MemberProfile | null
  linkedRoster?: TeamMemberProfile | null
  organizationMembership?: OrganizationMembershipLink | null
  userRoles?: UserRole[] | string[] | null
  isPrimaryOwner?: boolean
  /**
   * Optional client signal for platform admin. Prefer not to ship privileged
   * ADMIN_EMAILS to the browser — master persona falls back to forced-owner email.
   */
  isPlatformAdmin?: boolean
}

/** Strip query/hash for path comparisons. */
export function normalizeAppPathname(path: string | null | undefined): string {
  if (path == null) return ''
  const trimmed = String(path).trim()
  if (!trimmed) return ''
  return trimmed.split('?')[0]?.split('#')[0] ?? ''
}

/** True when path is default home (dashboard) or bare `/`. */
export function isDefaultHomePath(
  path: string | null | undefined,
  defaultHome: string = DEFAULT_HOME_PATH
): boolean {
  const pathOnly = normalizeAppPathname(path)
  if (!pathOnly || pathOnly === '/') return true
  return pathOnly === normalizeAppPathname(defaultHome)
}

/** True when path targets onboarding/profile welcome (pathname only). */
export function isOnboardingPath(
  path: string | null | undefined,
  onboardingPath: string = ONBOARDING_PATH
): boolean {
  return normalizeAppPathname(path) === normalizeAppPathname(onboardingPath)
}

/**
 * True when the user must finish first-time owner/org bootstrap before Dashboard.
 * Team members linked via roster/membership are not forced through owner bootstrap.
 */
export function isIncompleteOnboarding(options: {
  actorEmail?: string | null
  ownProfile: MemberProfile | null | undefined
  linkedRoster?: TeamMemberProfile | null
  organizationMembership?: OrganizationMembershipLink | null
}): boolean {
  return needsPrimaryOwnerBootstrap(options)
}

/**
 * Shared team-completion definition: more than one org member profile means a team exists.
 * Use the same count source on Profile and Dashboard (member_profiles for the org).
 */
export function hasTeamBeyondSelf(teamMemberCount: number | null | undefined): boolean {
  return (teamMemberCount ?? 0) > 1
}

/**
 * Resolve landing path after auth.
 * Explicit safe redirects (invite, etc.) always win when they are not the default home.
 * Incomplete onboarding users land on Welcome/profile unless an explicit redirect is present.
 */
export function resolveAuthenticatedLandingPath(options: {
  /** Path from query/storage helpers (already sanitized). */
  candidatePath: string
  incompleteOnboarding: boolean
  /** True when ?redirect= or stored signup redirect provided a non-default path. */
  hasExplicitRedirect?: boolean
  defaultHome?: string
  onboardingPath?: string
}): string {
  const defaultHome = options.defaultHome ?? DEFAULT_HOME_PATH
  const onboardingPath = options.onboardingPath ?? ONBOARDING_PATH
  const candidate = options.candidatePath || defaultHome
  const candidatePathname = normalizeAppPathname(candidate)

  if (options.hasExplicitRedirect) {
    // Explicit redirect that only points at default home still allows onboarding override.
    if (!isDefaultHomePath(candidate, defaultHome)) {
      return candidate
    }
  }

  // Non-default, non-onboarding candidate (e.g. /invite/...) wins without the flag.
  if (
    candidatePathname &&
    !isDefaultHomePath(candidate, defaultHome) &&
    !isOnboardingPath(candidate, onboardingPath)
  ) {
    return candidate
  }

  if (options.incompleteOnboarding) {
    return onboardingPath
  }

  return defaultHome
}

/** Detect whether resolveClientPostLoginPath returned an explicit non-default path. */
export function isExplicitPostLoginPath(
  path: string,
  defaultHome: string = DEFAULT_HOME_PATH
): boolean {
  const pathOnly = normalizeAppPathname(path)
  if (!pathOnly) return false
  if (isDefaultHomePath(pathOnly, defaultHome)) return false
  return true
}

/**
 * Persona for welcome copy. Prefers membership/profile roles; master is forced owner or platform admin.
 * Note: isPlatformAdmin is optional and rarely set client-side (avoid shipping ADMIN_EMAILS).
 */
export function resolveOnboardingPersona(snapshot: OnboardingActorSnapshot): OnboardingPersona {
  if (snapshot.isPlatformAdmin || isForcedCarrierOwner(snapshot.actorEmail)) {
    return 'master'
  }

  const roles = (snapshot.userRoles ??
    snapshot.ownProfile?.user_roles ??
    (snapshot.organizationMembership?.role
      ? [snapshot.organizationMembership.role]
      : snapshot.linkedRoster?.user_roles) ??
    []) as string[]

  const isPrimary =
    snapshot.isPrimaryOwner === true ||
    snapshot.ownProfile?.is_primary_owner === true ||
    snapshot.organizationMembership?.role === 'Owner'

  if (isPrimary || roles.includes('Owner')) {
    return 'carrier_owner'
  }

  const primary = primaryRoleFromRoles(roles)
  if (primary === 'Permit Clerk') return 'permit_clerk'
  if (primary === 'Admin') return 'admin'
  if (primary === 'Driver') return 'driver'
  if (primary === 'Viewer') return 'viewer'
  return 'team_member'
}

export function getWelcomeHeadline(persona: OnboardingPersona): string {
  switch (persona) {
    case 'master':
      return 'Welcome, Master Admin'
    case 'carrier_owner':
      // Match existing bootstrap card copy (lib/member-profile).
      return 'Welcome to Truckeros'
    case 'permit_clerk':
      return 'Welcome, Permit Clerk'
    case 'admin':
      return 'Welcome, Admin'
    case 'driver':
      return 'Welcome, Driver'
    case 'viewer':
      return 'Welcome, Viewer'
    default:
      return 'Welcome to Truckeros'
  }
}

export type WelcomeCopyOptions = {
  /** True during owner bootstrap (company setup form). Default true for backward-compatible callers. */
  bootstrap?: boolean
  /** Guided onboarding step when known — drives quieter complete copy. */
  step?: OnboardingStep
  /** When true, permit clerk copy may mention Carriers (service mode). */
  serviceMode?: boolean
}

export function getWelcomeSubtitle(
  persona: OnboardingPersona,
  options?: WelcomeCopyOptions
): string {
  const bootstrap = options?.bootstrap !== false
  const step = options?.step
  const complete = step === 'complete'

  switch (persona) {
    case 'master':
      if (bootstrap && step !== 'complete' && step !== 'team_or_equipment') {
        return 'Set up your platform carrier organization — company details first, then team and equipment.'
      }
      if (step === 'team_or_equipment') {
        return 'Company is ready. Invite your team or add equipment, then open the Dashboard.'
      }
      return 'Manage carriers, team access, and permit operations from one place.'
    case 'carrier_owner':
      if (bootstrap && !complete && step !== 'team_or_equipment') {
        return "You're setting up as the account Owner. Add your contact info and company details below — one save creates your organization and profile."
      }
      if (step === 'team_or_equipment') {
        return 'Your carrier account is ready. Build your team or add equipment next.'
      }
      // Complete / quiet landing
      return 'Manage your carrier profile, team, and equipment from this page.'
    case 'permit_clerk':
      if (options?.serviceMode) {
        return 'You help carriers with permits and equipment. Finish your profile if needed, then open Dashboard or Carriers.'
      }
      return 'You help carriers with permits and equipment. Finish your profile if needed, then open the Dashboard.'
    case 'admin':
      return 'You can manage team members, equipment, and carrier details for this organization.'
    case 'driver':
      return 'Update your driver details when needed, then run route analyses from the Dashboard.'
    case 'viewer':
      return 'You have read-only access. Browse Dashboard reports and history for this organization.'
    default:
      return 'Get started with your TruckerOS workspace.'
  }
}

/** Whether the actor should see soft setup guidance (team/equipment). */
export function canSeeSetupGuidance(actor: PermissionActor | null | undefined): boolean {
  if (!actor) return false
  if (actor.is_primary_owner) return true
  return hasOwnerOrAdminRole(actor)
}

/** Guided onboarding step from durable profile/org state. */
export function resolveOnboardingStep(options: {
  incompleteOnboarding: boolean
  ownProfile?: MemberProfile | null
  /** Org member_profiles count (shared Profile/Dashboard definition). */
  teamMemberCount?: number
  hasEquipment?: boolean
  dismissedGuidedSteps?: boolean
  /** When set, used instead of deriving owner/admin from profile alone. */
  canManageSetup?: boolean
}): OnboardingStep {
  // Company step only for true first-time owner bootstrap (no org yet).
  // Admins/managers with an existing home org never stay stuck on "company"
  // just because personal hasCarrierData is empty.
  if (options.incompleteOnboarding) return 'company'

  const profile = options.ownProfile
  if (!profile?.organization_id) return 'company'

  const isPrimary = profile.is_primary_owner === true
  const isManager =
    options.canManageSetup !== undefined
      ? options.canManageSetup
      : isPrimary ||
        hasOwnerOrAdminRole({
          user_roles: profile.user_roles as string[],
          is_primary_owner: isPrimary,
        })

  if (!isManager) return 'complete'
  if (options.dismissedGuidedSteps) return 'complete'

  const hasTeam = hasTeamBeyondSelf(options.teamMemberCount)
  const hasEquipment = options.hasEquipment === true

  // Org already exists — company bootstrap is done. Soft-guide team/equipment only.
  // (Primary owners can still edit carrier fields on Profile without a forced company step.)
  if (hasTeam || hasEquipment) return 'complete'
  return 'team_or_equipment'
}

export function getGuidedOnboardingCopy(step: OnboardingStep): {
  title: string
  body: string
} {
  switch (step) {
    case 'company':
      return {
        title: 'Step 1 — Company profile',
        body: 'Enter your contact and carrier details to create your organization.',
      }
    case 'team_or_equipment':
      return {
        title: 'Step 2 — Team or equipment',
        body: 'Invite teammates or build your first rig so permit analysis has accurate data.',
      }
    case 'complete':
      return {
        title: 'You are set up',
        body: 'Head to the Dashboard for route analysis and tools for your role.',
      }
  }
}

const ONBOARDING_DISMISS_PREFIX = 'truckeros_onboarding_guided_dismissed:'

export function onboardingDismissStorageKey(userId: string): string {
  return `${ONBOARDING_DISMISS_PREFIX}${userId}`
}

export function readOnboardingGuidedDismissed(userId: string | null | undefined): boolean {
  if (typeof window === 'undefined' || !userId) return false
  try {
    return window.localStorage.getItem(onboardingDismissStorageKey(userId)) === '1'
  } catch {
    return false
  }
}

export function writeOnboardingGuidedDismissed(userId: string | null | undefined, dismissed = true): void {
  if (typeof window === 'undefined' || !userId) return
  try {
    if (dismissed) {
      window.localStorage.setItem(onboardingDismissStorageKey(userId), '1')
    } else {
      window.localStorage.removeItem(onboardingDismissStorageKey(userId))
    }
  } catch {
    // ignore quota / private mode
  }
}

/**
 * Dashboard tools/reports visible for the actor.
 * Aligns with resolveEffectivePermissions + nav-actor patterns.
 */
export function getVisibleDashboardTools(
  actor: PermissionActor | null | undefined,
  options?: { workspaceMode?: 'carrier' | 'service' }
): DashboardTool[] {
  if (!actor) return []

  const permissions = resolveEffectivePermissions(actor)
  const tools: DashboardTool[] = []

  if (canAccessArea('permit_agent', permissions)) {
    tools.push({
      id: 'permit_analysis',
      label: 'Start New Route Analysis',
      href: '/permit-test',
      description: 'Get accurate, route-specific permit intelligence.',
      primary: true,
    })
  }

  if (shouldShowEquipmentNav(actor)) {
    tools.push({
      id: 'equipment',
      label: 'Manage Equipment & Rigs',
      href: '/equipment',
      description: 'Build tractor + trailer profiles with graphical previews.',
    })
  }

  if (canAccessArea('permit_agent', permissions)) {
    tools.push({
      id: 'history',
      label: 'View Analysis History',
      href: '/history',
      description: 'Review recent permit analyses and corridors.',
    })
  }

  if (shouldShowProfileNav(actor)) {
    tools.push({
      id: 'profile',
      label: 'Profile & Team',
      href: '/profile',
      description: 'Update company, driver, and team settings.',
    })
  }

  if (options?.workspaceMode === 'service') {
    tools.push({
      id: 'carriers',
      label: 'Carriers',
      href: '/carriers',
      description: 'Select a carrier organization to work in service mode.',
    })
  }

  return tools
}

/** Soft CTAs when owner/admin setup is incomplete (company done, no team/equipment yet). */
export function getDashboardSetupCtas(options: {
  step: OnboardingStep
  canManageTeam?: boolean
  canManageEquipment?: boolean
}): { label: string; href: string; description: string }[] {
  if (options.step !== 'team_or_equipment') return []

  const ctas: { label: string; href: string; description: string }[] = []
  if (options.canManageTeam !== false) {
    ctas.push({
      label: 'Build your team',
      href: '/profile',
      description: 'Invite admins, drivers, or permit clerks.',
    })
  }
  if (options.canManageEquipment !== false) {
    ctas.push({
      label: 'Add equipment',
      href: '/equipment',
      description: 'Create your first tractor, trailer, or rig.',
    })
  }
  return ctas
}

/** Owner bootstrap card title — persona-aware wrapper over legacy copy. */
export function getBootstrapWelcomeTitle(persona: OnboardingPersona): string {
  return getWelcomeHeadline(persona)
}

export function getBootstrapWelcomeSubtitle(persona: OnboardingPersona): string {
  return getWelcomeSubtitle(persona, { bootstrap: true })
}

/**
 * Whether to show the full role welcome banner on Profile.
 * Full banner for bootstrap / guided incomplete; quieter header when complete.
 */
export function shouldShowFullWelcomeBanner(options: {
  isProfileBootstrap: boolean
  guidedStep: OnboardingStep
}): boolean {
  if (options.isProfileBootstrap) return true
  return options.guidedStep !== 'complete'
}

/** Team personas that get a one-time quiet role welcome after onboarding is complete. */
const TEAM_ROLE_WELCOME_PERSONAS: OnboardingPersona[] = [
  'permit_clerk',
  'admin',
  'driver',
  'viewer',
  'team_member',
]

/**
 * One-time role welcome for non-owner personas (guided step is always complete for them).
 * Callers track `roleWelcomeSeen` via localStorage (see roleWelcomeStorageKey).
 */
export function shouldShowTeamRoleWelcome(options: {
  persona: OnboardingPersona
  guidedStep: OnboardingStep
  isProfileBootstrap: boolean
  roleWelcomeSeen: boolean
}): boolean {
  if (options.isProfileBootstrap) return false
  if (options.guidedStep !== 'complete') return false
  if (options.roleWelcomeSeen) return false
  return TEAM_ROLE_WELCOME_PERSONAS.includes(options.persona)
}

const ROLE_WELCOME_SEEN_PREFIX = 'truckeros_role_welcome_seen:'

export function roleWelcomeStorageKey(userId: string): string {
  return `${ROLE_WELCOME_SEEN_PREFIX}${userId}`
}

export function readRoleWelcomeSeen(userId: string | null | undefined): boolean {
  if (typeof window === 'undefined' || !userId) return false
  try {
    return window.localStorage.getItem(roleWelcomeStorageKey(userId)) === '1'
  } catch {
    return false
  }
}

export function writeRoleWelcomeSeen(userId: string | null | undefined, seen = true): void {
  if (typeof window === 'undefined' || !userId) return
  try {
    if (seen) {
      window.localStorage.setItem(roleWelcomeStorageKey(userId), '1')
    } else {
      window.localStorage.removeItem(roleWelcomeStorageKey(userId))
    }
  } catch {
    // ignore quota / private mode
  }
}
