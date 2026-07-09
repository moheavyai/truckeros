import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'

const headerPath = path.join(process.cwd(), 'components', 'AppHeader.tsx')

function readHeaderSource() {
  return readFileSync(headerPath, 'utf8')
}

function navRegionSlice(source: string) {
  const start = source.indexOf('<div className="flex items-center gap-4 text-sm">')
  const end = source.indexOf('<div className="w-px h-4 bg-gray-300 mx-1" />')
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  return source.slice(start, end)
}

describe('AppHeader top navigation', () => {
  it('renders Dashboard, Equipment, Profile, and Carriers nav in service mode', () => {
    const nav = navRegionSlice(readHeaderSource())

    expect(nav).toContain('showDashboard && navLink')
    expect(nav).toContain("navLink('/dashboard', 'Dashboard'")
    expect(nav).toContain('showEquipment && navLink')
    expect(nav).toContain("navLink('/equipment', 'Equipment'")
    expect(nav).toContain('showProfile && navLink')
    expect(nav).toContain("navLink('/profile', 'Profile'")
    expect(nav).toContain('showCarriers && navLink')
    expect(nav).toContain("navLink('/carriers', 'Carriers'")
    expect(nav).not.toContain("navLink('/history'")
    expect(nav).not.toContain("navLink('/portal-assist'")
  })

  it('hides Dashboard and equipment during incomplete onboarding', () => {
    const source = readHeaderSource()
    expect(source).toContain('isIncompleteOnboarding')
    expect(source).toContain('incompleteOnboarding')
    expect(source).toMatch(/showDashboard = navReady && !incompleteOnboarding/)
    expect(source).toMatch(/showEquipment =[\s\S]*!incompleteOnboarding/)
  })

  it('limits activePage to dashboard, equipment, and profile', () => {
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