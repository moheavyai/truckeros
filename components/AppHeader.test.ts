import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'

const headerPath = path.join(process.cwd(), 'components', 'AppHeader.tsx')

function readHeaderSource() {
  return readFileSync(headerPath, 'utf8')
}

function navRegionSlice(source: string) {
  const start = source.indexOf(
    '<div className="flex items-center gap-2 sm:gap-4 text-xs sm:text-sm flex-wrap justify-end max-w-full">'
  )
  const end = source.indexOf('w-px h-4 bg-gray-300')
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  return source.slice(start, end)
}

describe('AppHeader top navigation', () => {
  it('renders active-page-aware Dashboard, Equipment, History, Profile, and Carriers nav', () => {
    const nav = navRegionSlice(readHeaderSource())

    // Dashboard slot: History when active, else Dashboard (leading app-link position)
    expect(nav).toContain('showDashboard &&')
    expect(nav).toContain("activePage === 'dashboard'")
    expect(nav).toContain("navLink('/history', 'History'")
    expect(nav).toContain("navLink('/dashboard', 'Dashboard'")

    // Equipment self-link swapped to History when on equipment
    expect(nav).toContain('showEquipment &&')
    expect(nav).toContain("activePage === 'equipment'")
    expect(nav).toContain("navLink('/equipment', 'Equipment'")

    // Profile self-link swapped to History when on profile (only when onboarding complete)
    expect(nav).toContain('showProfile &&')
    expect(nav).toContain("activePage === 'profile' && showDashboard")
    expect(nav).toContain("navLink('/profile', 'Profile'")

    expect(nav).toContain('showCarriers && navLink')
    expect(nav).toContain("navLink('/carriers', 'Carriers'")
    expect(nav).not.toContain("navLink('/portal-assist'")
  })

  it('omits redundant self-links and places History in the swapped active-page slot', () => {
    const nav = navRegionSlice(readHeaderSource())

    // On dashboard: History first in the Dashboard slot (not after Equipment).
    // Else branch uses isActive=false — activePage is narrowed away from 'dashboard'/'equipment'.
    expect(nav).toMatch(
      /showDashboard &&\s*\(activePage === 'dashboard'\s*\?\s*navLink\('\/history', 'History', false\)\s*:\s*navLink\('\/dashboard', 'Dashboard', false\)\)/
    )
    // Dashboard branch appears before Equipment branch in source order
    const dashSlot = nav.indexOf("activePage === 'dashboard'")
    const equipSlot = nav.indexOf("activePage === 'equipment'")
    expect(dashSlot).toBeGreaterThan(-1)
    expect(equipSlot).toBeGreaterThan(dashSlot)

    // On equipment: History instead of Equipment
    expect(nav).toMatch(
      /activePage === 'equipment'\s*\?\s*navLink\('\/history', 'History', false\)\s*:\s*navLink\('\/equipment', 'Equipment', false\)/
    )
    // On profile: History instead of Profile when showDashboard (completed onboarding)
    expect(nav).toMatch(
      /activePage === 'profile' && showDashboard\s*\?\s*navLink\('\/history', 'History', false\)\s*:\s*navLink\('\/profile', 'Profile', activePage === 'profile'\)/
    )
  })

  it('does not show History as always-on nav (only swap slots; carriers/unset keep no History)', () => {
    const nav = navRegionSlice(readHeaderSource())
    // History only appears inside activePage === 'dashboard' | 'equipment' | profile+showDashboard ternaries
    expect(nav).toMatch(/activePage === 'dashboard'[\s\S]*navLink\('\/history', 'History'/)
    expect(nav).toMatch(/activePage === 'equipment'[\s\S]*navLink\('\/history', 'History'/)
    expect(nav).toMatch(/activePage === 'profile' && showDashboard[\s\S]*navLink\('\/history', 'History'/)
    // No unconditional History link
    expect(nav).not.toMatch(/show\w+ &&\s*navLink\('\/history'/)
    // Carriers path is independent of History
    expect(nav).toMatch(/showCarriers && navLink\('\/carriers', 'Carriers', activePage === 'carriers'\)/)
  })

  it('keeps Profile (not History) when onboarding incomplete on profile', () => {
    const nav = navRegionSlice(readHeaderSource())
    // Incomplete onboarding: showDashboard is false → else branch renders Profile
    expect(nav).toMatch(
      /activePage === 'profile' && showDashboard\s*\?\s*navLink\('\/history', 'History', false\)\s*:\s*navLink\('\/profile', 'Profile', activePage === 'profile'\)/
    )
    // showDashboard itself requires completed onboarding
    const source = readHeaderSource()
    expect(source).toMatch(/showDashboard = navReady && !incompleteOnboarding/)
  })

  it('hides Dashboard and equipment during incomplete onboarding', () => {
    const source = readHeaderSource()
    expect(source).toContain('isIncompleteOnboarding')
    expect(source).toContain('incompleteOnboarding')
    expect(source).toMatch(/showDashboard = navReady && !incompleteOnboarding/)
    expect(source).toMatch(/showEquipment =[\s\S]*!incompleteOnboarding/)
  })

  it('limits activePage to dashboard, equipment, profile, and carriers (not history)', () => {
    const source = readHeaderSource()

    expect(source).toMatch(/activePage\?: 'dashboard' \| 'equipment' \| 'profile' \| 'carriers'/)
    expect(source).not.toMatch(/activePage\?:[^;]*'history'/)
    expect(source).not.toMatch(/activePage\?:[^;]*'portal-assist'/)
  })
})

describe('AppHeader workspace context', () => {
  it('renders CarrierContextBar with organization id prop', () => {
    const source = readHeaderSource()

    expect(source).toContain('CarrierContextBar')
    expect(source).toContain('ownOrganizationId')
    expect(source).toContain('showWorkspaceBar')
  })
})

describe('AppHeader nav actor permissions', () => {
  it('loads organization_id with member profile and resolves via resolveNavActor', () => {
    const source = readHeaderSource()

    expect(source).toContain("select('user_roles, is_primary_owner, organization_id')")
    expect(source).toContain("from('organization_memberships')")
    expect(source).toContain('resolveNavActor')
    expect(source).toContain('workspaceMode')
    expect(source).toContain('activeOrganizationId')
  })

  it('hides equipment/profile nav until nav actor is ready', () => {
    const source = readHeaderSource()
    expect(source).toContain('navReady')
    expect(source).toMatch(
      /showEquipment =[\s\S]*navReady && !incompleteOnboarding && navActor \? shouldShowEquipmentNav/
    )
    expect(source).toMatch(
      /showProfile = navReady && navActor \? shouldShowProfileNav\(navActor\) : incompleteOnboarding/
    )
  })

  it('checks cancelled after membership fetch before setNavActor', () => {
    const source = readHeaderSource()
    expect(source).toMatch(
      /from\('organization_memberships'\)[\s\S]*if \(cancelled\) return[\s\S]*setNavActor/
    )
  })

  it('sets navReady in finally so restricted nav is not stuck hidden on error', () => {
    const source = readHeaderSource()
    expect(source).toContain('finally')
    expect(source).toMatch(/finally \{[\s\S]*setNavReady\(true\)/)
  })

  it('fail-closes nav actor to null on load error (not empty Viewer defaults)', () => {
    const source = readHeaderSource()
    expect(source).toMatch(/catch \(error\) \{[\s\S]*setNavActor\(null\)/)
    expect(source).not.toMatch(/catch \(error\) \{[\s\S]*user_roles: \[\]/)
  })

  it('fail-closes incompleteOnboarding to true on load error (hide Dashboard)', () => {
    const source = readHeaderSource()
    expect(source).toMatch(
      /catch \(error\) \{[\s\S]*setIncompleteOnboarding\(true\)/
    )
    expect(source).not.toMatch(
      /catch \(error\) \{[\s\S]*setIncompleteOnboarding\(false\)/
    )
  })
})


describe('AppHeader dev persona cleanup', () => {
  it('clears dev test persona before sign-out', () => {
    const source = readHeaderSource()

    expect(source).toContain('clearDevTestPersonaEmail')
    expect(source).toMatch(/clearDevTestPersonaEmail\(\)[\s\S]*auth\.signOut\(\)/)
  })
})

describe('AppHeader legacy chrome removal', () => {
  it('does not show Permit Agent badge, permit-test link, or New Analysis CTA', () => {
    const source = readHeaderSource()

    expect(source).not.toContain('Permit Agent')
    expect(source).not.toMatch(/href="\/permit-test"/)
    expect(source).not.toContain('New Analysis')
    expect(source).not.toContain('new-analysis')
  })
})

describe('AppHeader mobile touch targets', () => {
  it('gives nav links and logout a practical mobile touch height', () => {
    const source = readHeaderSource()
    expect(source).toMatch(
      /navLink[\s\S]*?min-h-\[40px\][\s\S]*?touch-manipulation/
    )
    expect(source).toMatch(
      /handleLogout[\s\S]*?min-h-\[40px\][\s\S]*?touch-manipulation|min-h-\[40px\][\s\S]*?Logout/
    )
    expect(source).toContain('touch-manipulation')
  })

  it('constrains brand so truncate can shrink on narrow screens', () => {
    const source = readHeaderSource()
    expect(source).toMatch(/flex items-center gap-2 sm:gap-3 min-w-0 flex-1 sm:flex-initial/)
    expect(source).toMatch(/min-w-0 max-w-full/)
    expect(source).toMatch(/truncate min-w-0/)
  })
})