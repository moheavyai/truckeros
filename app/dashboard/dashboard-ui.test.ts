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
