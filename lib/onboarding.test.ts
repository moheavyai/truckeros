import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import {
  DEFAULT_HOME_PATH,
  getBootstrapWelcomeSubtitle,
  getBootstrapWelcomeTitle,
  getDashboardSetupCtas,
  getGuidedOnboardingCopy,
  getVisibleDashboardTools,
  getWelcomeHeadline,
  getWelcomeSubtitle,
  hasTeamBeyondSelf,
  isDefaultHomePath,
  isExplicitPostLoginPath,
  isIncompleteOnboarding,
  isOnboardingPath,
  normalizeAppPathname,
  ONBOARDING_PATH,
  onboardingDismissStorageKey,
  readOnboardingGuidedDismissed,
  readRoleWelcomeSeen,
  resolveAuthenticatedLandingPath,
  resolveOnboardingPersona,
  resolveOnboardingStep,
  roleWelcomeStorageKey,
  shouldShowFullWelcomeBanner,
  shouldShowTeamRoleWelcome,
  writeOnboardingGuidedDismissed,
  writeRoleWelcomeSeen,
  canSeeSetupGuidance,
} from './onboarding'
import type { MemberProfile } from '@/types/member-profile'
import { DEFAULT_POST_LOGIN_PATH } from './auth-redirect'

describe('isIncompleteOnboarding', () => {
  it('is true for first-time users with no profile or team linkage', () => {
    expect(
      isIncompleteOnboarding({
        ownProfile: null,
        linkedRoster: null,
        organizationMembership: null,
      })
    ).toBe(true)
  })

  it('is false when user has an organization profile', () => {
    expect(
      isIncompleteOnboarding({
        ownProfile: {
          user_id: 'u1',
          organization_id: 'org-1',
          is_primary_owner: true,
        } as MemberProfile,
      })
    ).toBe(false)
  })

  it('is false for team members with membership but no member_profiles row', () => {
    expect(
      isIncompleteOnboarding({
        ownProfile: null,
        organizationMembership: { organization_id: 'org-1', role: 'Driver' },
      })
    ).toBe(false)
  })
})

describe('path normalization', () => {
  it('strips query and hash', () => {
    expect(normalizeAppPathname('/dashboard?x=1')).toBe('/dashboard')
    expect(normalizeAppPathname('/profile#team')).toBe('/profile')
  })

  it('treats bare / and dashboard query as default home', () => {
    expect(isDefaultHomePath('/')).toBe(true)
    expect(isDefaultHomePath('/dashboard')).toBe(true)
    expect(isDefaultHomePath('/dashboard?tab=1')).toBe(true)
    expect(isDefaultHomePath('/profile')).toBe(false)
  })

  it('detects onboarding path with query', () => {
    expect(isOnboardingPath('/profile?invite=accepted')).toBe(true)
  })

  it('keeps DEFAULT_HOME_PATH aligned with auth-redirect', () => {
    expect(DEFAULT_HOME_PATH).toBe(DEFAULT_POST_LOGIN_PATH)
  })
})

describe('resolveAuthenticatedLandingPath', () => {
  it('sends incomplete onboarding users to profile when no explicit redirect', () => {
    expect(
      resolveAuthenticatedLandingPath({
        candidatePath: DEFAULT_HOME_PATH,
        incompleteOnboarding: true,
      })
    ).toBe(ONBOARDING_PATH)
  })

  it('sends complete users to dashboard by default', () => {
    expect(
      resolveAuthenticatedLandingPath({
        candidatePath: DEFAULT_HOME_PATH,
        incompleteOnboarding: false,
      })
    ).toBe(DEFAULT_HOME_PATH)
  })

  it('honors explicit invite redirects even when onboarding is incomplete', () => {
    expect(
      resolveAuthenticatedLandingPath({
        candidatePath: '/invite/abc123',
        incompleteOnboarding: true,
        hasExplicitRedirect: true,
      })
    ).toBe('/invite/abc123')
  })

  it('honors non-default candidate paths without the explicit flag', () => {
    expect(
      resolveAuthenticatedLandingPath({
        candidatePath: '/invite/tok',
        incompleteOnboarding: true,
      })
    ).toBe('/invite/tok')
  })

  it('treats dashboard-with-query as default home for incomplete override', () => {
    expect(
      resolveAuthenticatedLandingPath({
        candidatePath: '/dashboard?x=1',
        incompleteOnboarding: true,
      })
    ).toBe(ONBOARDING_PATH)
  })

  it('treats bare / as default home for incomplete override', () => {
    expect(
      resolveAuthenticatedLandingPath({
        candidatePath: '/',
        incompleteOnboarding: true,
      })
    ).toBe(ONBOARDING_PATH)
  })

  it('does not treat explicit default-home redirect as blocking onboarding', () => {
    expect(
      resolveAuthenticatedLandingPath({
        candidatePath: '/dashboard',
        incompleteOnboarding: true,
        hasExplicitRedirect: true,
      })
    ).toBe(ONBOARDING_PATH)
  })

  it('sends complete users to dashboard when candidate was onboarding path', () => {
    expect(
      resolveAuthenticatedLandingPath({
        candidatePath: ONBOARDING_PATH,
        incompleteOnboarding: false,
      })
    ).toBe(DEFAULT_HOME_PATH)
  })
})

describe('isExplicitPostLoginPath', () => {
  it('treats invite and profile query paths as explicit', () => {
    expect(isExplicitPostLoginPath('/invite/x')).toBe(true)
    expect(isExplicitPostLoginPath('/profile?invite=accepted')).toBe(true)
  })

  it('treats dashboard and bare / as non-explicit', () => {
    expect(isExplicitPostLoginPath('/dashboard')).toBe(false)
    expect(isExplicitPostLoginPath('/dashboard?x=1')).toBe(false)
    expect(isExplicitPostLoginPath('/')).toBe(false)
    expect(isExplicitPostLoginPath(DEFAULT_HOME_PATH)).toBe(false)
  })
})

describe('resolveOnboardingPersona + welcome copy', () => {
  it('classifies master, carrier owner, clerk, and driver', () => {
    expect(
      resolveOnboardingPersona({
        actorEmail: 'andrehampton1@outlook.com',
      })
    ).toBe('master')
    expect(
      resolveOnboardingPersona({
        isPrimaryOwner: true,
        userRoles: ['Owner'],
      })
    ).toBe('carrier_owner')
    expect(resolveOnboardingPersona({ userRoles: ['Permit Clerk'] })).toBe('permit_clerk')
    expect(resolveOnboardingPersona({ userRoles: ['Driver'] })).toBe('driver')
    expect(resolveOnboardingPersona({ userRoles: ['Admin'] })).toBe('admin')
    expect(resolveOnboardingPersona({ userRoles: ['Viewer'] })).toBe('viewer')
  })

  it('supports optional isPlatformAdmin without requiring email list', () => {
    expect(resolveOnboardingPersona({ isPlatformAdmin: true })).toBe('master')
  })

  it('returns role-specific headlines and subtitles', () => {
    expect(getWelcomeHeadline('permit_clerk')).toContain('Permit Clerk')
    expect(getWelcomeSubtitle('carrier_owner', { bootstrap: true })).toContain('Owner')
    expect(getBootstrapWelcomeTitle('master')).toContain('Master')
    expect(getBootstrapWelcomeSubtitle('carrier_owner')).toContain('organization')
  })

  it('uses quiet complete copy for owners after setup', () => {
    const complete = getWelcomeSubtitle('carrier_owner', {
      bootstrap: false,
      step: 'complete',
    })
    expect(complete).not.toContain('Build your team')
    expect(complete).toContain('Manage your carrier profile')
  })

  it('conditions permit clerk Carriers mention on service mode', () => {
    expect(getWelcomeSubtitle('permit_clerk', { serviceMode: true })).toContain('Carriers')
    expect(getWelcomeSubtitle('permit_clerk', { serviceMode: false })).not.toContain('Carriers')
  })
})

describe('resolveOnboardingStep', () => {
  const ownerProfile = {
    user_id: 'u1',
    organization_id: 'org-1',
    is_primary_owner: true,
    company_name: 'Acme Hauling',
    user_roles: ['Owner'],
  } as MemberProfile

  it('starts at company for incomplete bootstrap', () => {
    expect(resolveOnboardingStep({ incompleteOnboarding: true })).toBe('company')
  })

  it('moves to team_or_equipment after owner company bootstrap', () => {
    expect(
      resolveOnboardingStep({
        incompleteOnboarding: false,
        ownProfile: ownerProfile,
        teamMemberCount: 1,
        hasEquipment: false,
      })
    ).toBe('team_or_equipment')
  })

  it('does not keep admins with org on company step when personal carrier data is empty', () => {
    expect(
      resolveOnboardingStep({
        incompleteOnboarding: false,
        ownProfile: {
          user_id: 'admin-1',
          organization_id: 'org-1',
          is_primary_owner: false,
          company_name: '',
          user_roles: ['Admin'],
        } as MemberProfile,
        teamMemberCount: 1,
        hasEquipment: false,
        canManageSetup: true,
      })
    ).toBe('team_or_equipment')
  })

  it('only uses company step for incomplete bootstrap or missing org', () => {
    expect(
      resolveOnboardingStep({
        incompleteOnboarding: true,
        ownProfile: null,
      })
    ).toBe('company')
    expect(
      resolveOnboardingStep({
        incompleteOnboarding: false,
        ownProfile: {
          user_id: 'u',
          organization_id: null,
          is_primary_owner: true,
        } as MemberProfile,
      })
    ).toBe('company')
  })

  it('completes when teamMemberCount > 1', () => {
    expect(
      resolveOnboardingStep({
        incompleteOnboarding: false,
        ownProfile: ownerProfile,
        teamMemberCount: 2,
        hasEquipment: false,
      })
    ).toBe('complete')
    expect(hasTeamBeyondSelf(2)).toBe(true)
    expect(hasTeamBeyondSelf(1)).toBe(false)
  })

  it('completes when equipment exists or steps dismissed', () => {
    expect(
      resolveOnboardingStep({
        incompleteOnboarding: false,
        ownProfile: ownerProfile,
        hasEquipment: true,
      })
    ).toBe('complete')
    expect(
      resolveOnboardingStep({
        incompleteOnboarding: false,
        ownProfile: ownerProfile,
        dismissedGuidedSteps: true,
      })
    ).toBe('complete')
  })

  it('completes immediately for non-owner team roles', () => {
    expect(
      resolveOnboardingStep({
        incompleteOnboarding: false,
        ownProfile: {
          user_id: 'u2',
          organization_id: 'org-1',
          is_primary_owner: false,
          user_roles: ['Driver'],
        } as MemberProfile,
      })
    ).toBe('complete')
  })

  it('allows Admin canManageSetup to see guided steps', () => {
    expect(
      resolveOnboardingStep({
        incompleteOnboarding: false,
        ownProfile: {
          user_id: 'u3',
          organization_id: 'org-1',
          is_primary_owner: false,
          company_name: 'Acme',
          user_roles: ['Admin'],
        } as MemberProfile,
        teamMemberCount: 1,
        hasEquipment: false,
        canManageSetup: true,
      })
    ).toBe('team_or_equipment')
  })

  it('exposes guided copy for each step', () => {
    expect(getGuidedOnboardingCopy('company').title).toMatch(/Step 1/)
    expect(getGuidedOnboardingCopy('team_or_equipment').title).toMatch(/Step 2/)
  })

  it('canSeeSetupGuidance is true for owner and admin', () => {
    expect(canSeeSetupGuidance({ is_primary_owner: true })).toBe(true)
    expect(canSeeSetupGuidance({ user_roles: ['Admin'] })).toBe(true)
    expect(canSeeSetupGuidance({ user_roles: ['Driver'] })).toBe(false)
  })
})

describe('getVisibleDashboardTools', () => {
  it('shows permit + profile for drivers but not equipment', () => {
    const tools = getVisibleDashboardTools({ user_roles: ['Driver'] })
    const ids = tools.map((t) => t.id)
    expect(ids).toContain('permit_analysis')
    expect(ids).toContain('history')
    expect(ids).toContain('profile')
    expect(ids).not.toContain('equipment')
  })

  it('shows equipment for owners and permit clerks', () => {
    expect(
      getVisibleDashboardTools({ user_roles: ['Owner'], is_primary_owner: true }).map((t) => t.id)
    ).toContain('equipment')
    expect(
      getVisibleDashboardTools({ user_roles: ['Permit Clerk'] }).map((t) => t.id)
    ).toContain('equipment')
  })

  it('shows carriers only in service mode', () => {
    const carrierMode = getVisibleDashboardTools({ user_roles: ['Permit Clerk'] })
    expect(carrierMode.map((t) => t.id)).not.toContain('carriers')
    const serviceMode = getVisibleDashboardTools(
      { user_roles: ['Permit Clerk'] },
      { workspaceMode: 'service' }
    )
    expect(serviceMode.map((t) => t.id)).toContain('carriers')
  })

  it('returns empty for null actor (fail-closed)', () => {
    expect(getVisibleDashboardTools(null)).toEqual([])
  })
})

describe('getDashboardSetupCtas', () => {
  it('returns team and equipment CTAs only for team_or_equipment step', () => {
    expect(getDashboardSetupCtas({ step: 'complete' })).toEqual([])
    const ctas = getDashboardSetupCtas({ step: 'team_or_equipment' })
    expect(ctas.map((c) => c.href)).toEqual(['/profile', '/equipment'])
  })

  it('honors canManageTeam / canManageEquipment flags', () => {
    expect(
      getDashboardSetupCtas({
        step: 'team_or_equipment',
        canManageTeam: false,
        canManageEquipment: true,
      }).map((c) => c.href)
    ).toEqual(['/equipment'])
    expect(
      getDashboardSetupCtas({
        step: 'team_or_equipment',
        canManageTeam: true,
        canManageEquipment: false,
      }).map((c) => c.href)
    ).toEqual(['/profile'])
    expect(
      getDashboardSetupCtas({
        step: 'team_or_equipment',
        canManageTeam: false,
        canManageEquipment: false,
      })
    ).toEqual([])
  })
})

describe('shouldShowFullWelcomeBanner', () => {
  it('shows full banner for bootstrap and incomplete guided steps', () => {
    expect(
      shouldShowFullWelcomeBanner({ isProfileBootstrap: true, guidedStep: 'company' })
    ).toBe(true)
    expect(
      shouldShowFullWelcomeBanner({
        isProfileBootstrap: false,
        guidedStep: 'team_or_equipment',
      })
    ).toBe(true)
    expect(
      shouldShowFullWelcomeBanner({ isProfileBootstrap: false, guidedStep: 'complete' })
    ).toBe(false)
  })
})

describe('shouldShowTeamRoleWelcome', () => {
  it('shows one-time welcome for driver/clerk when onboarding complete and not seen', () => {
    expect(
      shouldShowTeamRoleWelcome({
        persona: 'driver',
        guidedStep: 'complete',
        isProfileBootstrap: false,
        roleWelcomeSeen: false,
      })
    ).toBe(true)
    expect(
      shouldShowTeamRoleWelcome({
        persona: 'driver',
        guidedStep: 'complete',
        isProfileBootstrap: false,
        roleWelcomeSeen: true,
      })
    ).toBe(false)
    expect(
      shouldShowTeamRoleWelcome({
        persona: 'carrier_owner',
        guidedStep: 'complete',
        isProfileBootstrap: false,
        roleWelcomeSeen: false,
      })
    ).toBe(false)
  })
})

describe('role welcome localStorage', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', {
      store: {} as Record<string, string>,
      getItem(key: string) {
        return this.store[key] ?? null
      },
      setItem(key: string, value: string) {
        this.store[key] = value
      },
      removeItem(key: string) {
        delete this.store[key]
      },
    })
    vi.stubGlobal('window', {
      localStorage: (globalThis as { localStorage: Storage }).localStorage,
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reads and writes per-user role welcome seen flag', () => {
    expect(readRoleWelcomeSeen('u1')).toBe(false)
    writeRoleWelcomeSeen('u1', true)
    expect(localStorage.getItem(roleWelcomeStorageKey('u1'))).toBe('1')
    expect(readRoleWelcomeSeen('u1')).toBe(true)
    writeRoleWelcomeSeen('u1', false)
    expect(localStorage.getItem(roleWelcomeStorageKey('u1'))).toBeNull()
    expect(readRoleWelcomeSeen('u1')).toBe(false)
  })

  it('returns false for null/undefined user id (missing key / SSR-safe)', () => {
    expect(readRoleWelcomeSeen(null)).toBe(false)
    expect(readRoleWelcomeSeen(undefined)).toBe(false)
    expect(() => writeRoleWelcomeSeen(null, true)).not.toThrow()
    expect(() => writeRoleWelcomeSeen(undefined, true)).not.toThrow()
  })

  it('returns false and does not throw when localStorage throws', () => {
    vi.stubGlobal('localStorage', {
      getItem() {
        throw new Error('quota')
      },
      setItem() {
        throw new Error('quota')
      },
      removeItem() {
        throw new Error('quota')
      },
    })
    vi.stubGlobal('window', {
      localStorage: (globalThis as { localStorage: Storage }).localStorage,
    })
    expect(readRoleWelcomeSeen('u1')).toBe(false)
    expect(() => writeRoleWelcomeSeen('u1', true)).not.toThrow()
    expect(() => writeRoleWelcomeSeen('u1', false)).not.toThrow()
  })
})

describe('guided dismiss localStorage', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', {
      store: {} as Record<string, string>,
      getItem(key: string) {
        return this.store[key] ?? null
      },
      setItem(key: string, value: string) {
        this.store[key] = value
      },
      removeItem(key: string) {
        delete this.store[key]
      },
    })
    vi.stubGlobal('window', {
      localStorage: (globalThis as { localStorage: Storage }).localStorage,
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reads and writes per-user dismiss flag', () => {
    expect(readOnboardingGuidedDismissed('u1')).toBe(false)
    writeOnboardingGuidedDismissed('u1', true)
    expect(localStorage.getItem(onboardingDismissStorageKey('u1'))).toBe('1')
    expect(readOnboardingGuidedDismissed('u1')).toBe(true)
    writeOnboardingGuidedDismissed('u1', false)
    expect(readOnboardingGuidedDismissed('u1')).toBe(false)
  })

  it('returns false for null user id and when localStorage throws', () => {
    expect(readOnboardingGuidedDismissed(null)).toBe(false)
    expect(readOnboardingGuidedDismissed(undefined)).toBe(false)
    vi.stubGlobal('localStorage', {
      getItem() {
        throw new Error('quota')
      },
      setItem() {
        throw new Error('quota')
      },
      removeItem() {
        throw new Error('quota')
      },
    })
    expect(readOnboardingGuidedDismissed('u1')).toBe(false)
    expect(() => writeOnboardingGuidedDismissed('u1', true)).not.toThrow()
  })
})
