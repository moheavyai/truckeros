import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'

const dashboardPagePath = path.join(process.cwd(), 'app', 'dashboard', 'page.tsx')

function readDashboardSource() {
  return readFileSync(dashboardPagePath, 'utf8')
}

describe('Dashboard page — onboarding + role tools', () => {
  it('redirects incomplete onboarding users to profile welcome', () => {
    const source = readDashboardSource()
    expect(source).toContain('isIncompleteOnboarding')
    expect(source).toContain('ONBOARDING_PATH')
    expect(source).toMatch(/router\.replace\(ONBOARDING_PATH\)/)
  })

  it('filters tools with getVisibleDashboardTools and resolveNavActor', () => {
    const source = readDashboardSource()
    expect(source).toContain('getVisibleDashboardTools')
    expect(source).toContain('resolveNavActor')
    expect(source).toContain('getDashboardSetupCtas')
    expect(source).toContain('shouldShowEquipmentNav')
  })

  it('does not hardcode only equipment and permit CTAs without role checks', () => {
    const source = readDashboardSource()
    expect(source).toContain('primaryTool')
    expect(source).toContain('secondaryTools')
    expect(source).toMatch(/tools\.length === 0/)
  })

  it('welcome CTAs keep route analysis and omit Equipment/History/Profile (header owns those)', () => {
    const source = readDashboardSource()
    // Welcome tools strip header destinations before primary/secondary split
    expect(source).toMatch(
      /welcomeTools = tools\.filter\([\s\S]*t\.id !== 'equipment'[\s\S]*t\.id !== 'history'[\s\S]*t\.id !== 'profile'/
    )
    expect(source).toContain("t.id !== 'equipment'")
    expect(source).toContain("t.id !== 'history'")
    expect(source).toContain("t.id !== 'profile'")
    // Prefer permit_analysis as primary; never fall back to tools[0] from full list
    expect(source).toMatch(
      /primaryTool =\s*welcomeTools\.find\(\(t\) => t\.id === 'permit_analysis'\)/
    )
    expect(source).not.toMatch(/primaryTool = tools\.find/)
    expect(source).not.toMatch(/tools\[0\]/)
    // Secondary is remaining welcome tools (e.g. carriers in service mode)
    expect(source).toMatch(
      /secondaryTools = welcomeTools\.filter\(\(t\) => t\.id !== primaryTool\?\.id\)/
    )
    // Full tools still used for stats / recent activity
    expect(source).toMatch(/tools\.some\(\(t\) => t\.id === 'history' \|\| t\.id === 'permit_analysis'\)/)
    expect(source).toContain('getVisibleDashboardTools')
  })

  it('honors guided dismiss and admin setup eligibility for finish-setup banner', () => {
    const source = readDashboardSource()
    expect(source).toContain('readOnboardingGuidedDismissed')
    expect(source).toContain('guidedDismissed')
    expect(source).toContain('canSeeSetupGuidance')
    expect(source).toContain('dismissedGuidedSteps')
    expect(source).toContain('Recent analyses')
  })

  it('keeps loading shell on incomplete redirect and fails closed to profile on load error', () => {
    const source = readDashboardSource()
    const incompleteBlock = source.slice(
      source.indexOf('if (incomplete) {'),
      source.indexOf('if (incomplete) {') + 200
    )
    // Incomplete: replace without settling loading (no tools flash)
    expect(incompleteBlock).toContain('router.replace(ONBOARDING_PATH)')
    expect(incompleteBlock).toContain('return')
    expect(incompleteBlock).not.toContain('setLoading(false)')
    // Catch fail-closed
    expect(source).toMatch(
      /\[dashboard\] load failed[\s\S]*router\.replace\(ONBOARDING_PATH\)/
    )
    // Successful path settles loading
    expect(source).toMatch(/if \(!cancelled\) setLoading\(false\)/)
    expect(source).toContain('Recent saved runs')
  })

  it('recomputes nav actor when workspaceMode or activeOrganizationId changes', () => {
    const source = readDashboardSource()
    expect(source).toContain('activeOrganizationId')
    expect(source).toMatch(/workspaceMode[\s\S]*activeOrganizationId[\s\S]*resolveNavActor/)
  })

  it('sets ownOrganizationId from home profile only, not effective Service Mode org', () => {
    const source = readDashboardSource()
    expect(source).toContain('typedProfile?.organization_id')
    expect(source).toContain('setOwnOrganizationId(typedProfile.organization_id)')
    // Must not reassign home from resolved (active) org after nav resolve
    expect(source).not.toMatch(
      /setNavActor\(\{[\s\S]*?\}\)\s*\n\s*if \(resolved\.organizationId\) \{\s*\n\s*setOwnOrganizationId\(resolved\.organizationId\)/
    )
    expect(source).toContain('ownOrganizationId is home only')
  })
})

describe('Dashboard page — mobile contrast classes', () => {
  it('defines centralized contrast tokens for buttons, body text, and cards', () => {
    const source = readDashboardSource()

    expect(source).toContain('const buttonSecondaryClass =')
    expect(source).toContain('const buttonPrimaryClass =')
    expect(source).toContain('const mutedTextClass =')
    expect(source).toContain('const bodyTextClass =')
    expect(source).toContain('const cardClass =')

    expect(source).toMatch(/border-gray-500 sm:border-gray-300/)
    expect(source).toMatch(/text-gray-600 sm:text-gray-500/)
    expect(source).toMatch(/text-gray-700 sm:text-gray-600/)
    expect(source).toMatch(/border-gray-300 sm:border-gray-200/)
    expect(source).toMatch(/border-gray-200 sm:border-gray-100/)
    expect(source).toMatch(/text-gray-900/)
  })

  it('wires CTAs, stats cards, and list chrome to shared contrast classes', () => {
    const source = readDashboardSource()

    expect(source).toContain('className={buttonPrimaryClass}')
    expect(source).toContain('className={buttonSecondaryClass}')
    expect(source).toContain('className={cardClass}')
    expect(source).toContain('className={`lg:col-span-2 ${cardClass}`}')
    expect(source).toContain('className={`${mutedTextClass} text-xs`}')
    expect(source).toContain('className={`${bodyTextClass} text-xs`}')
    expect(source).toContain('border-t border-gray-200 sm:border-gray-100')
    expect(source).toContain('divide-y divide-gray-200 sm:divide-gray-100')

    // No bare low-contrast gray-400 date/meta text
    const faintUi = source.match(/className=\{?[`'"][^`'"]*text-gray-400/g) || []
    expect(faintUi).toEqual([])
    // Secondary tool buttons no longer use faint gray-300-only borders
    expect(source).not.toMatch(
      /className="inline-flex items-center gap-3 border border-gray-300 hover:bg-white/
    )
    // No inverted sm contrast pairs
    expect(source).not.toMatch(/border-gray-300 sm:border-gray-500/)
    expect(source).not.toMatch(/text-gray-500 sm:text-gray-600/)
    // Bare border-t without gray token should not appear
    const bareDividers =
      source.match(
        /className=["'`][^"'`]*\bborder-t(?=[\s"'`]|$)(?![^"'`]*border-gray)/g
      ) || []
    expect(bareDividers).toEqual([])
  })
})
