/**
 * Carrier context UI tests use static source inspection.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'

const contextBarPath = path.join(process.cwd(), 'components', 'CarrierContextBar.tsx')
const selectorPath = path.join(process.cwd(), 'components', 'CarrierSelector.tsx')
const bannerPath = path.join(process.cwd(), 'components', 'ActiveCarrierBanner.tsx')
const headerPath = path.join(process.cwd(), 'components', 'AppHeader.tsx')
const orgContextPath = path.join(process.cwd(), 'lib', 'organization-context.ts')

function read(pathname: string) {
  return readFileSync(pathname, 'utf8')
}

describe('Carrier context UI — service mode', () => {
  it('CarrierContextBar renders mode toggle and CarrierSelector in service mode', () => {
    const source = read(contextBarPath)

    expect(source).toContain('Carrier Mode')
    expect(source).toContain('Service Mode')
    expect(source).toContain("workspaceMode === 'service'")
    expect(source).toContain('<CarrierSelector')
    expect(source).toContain('setActiveOrganization')
    expect(source).toContain('canEnterServiceMode')
    expect(source).toContain('filterServiceModeCarriers')
    expect(source).toContain('Requires Permit Clerk access on a carrier')
    expect(source).not.toContain('Requires Permit Clerk, Owner, or Admin access on a carrier')
    expect(source).not.toContain('Change carrier')
  })

  it('CarrierSelector provides searchable carrier list with summary chip', () => {
    const source = read(selectorPath)

    expect(source).toContain('filterAccessibleCarriers')
    expect(source).toContain('Search carriers')
    expect(source).toContain('Manage carriers')
    expect(source).toContain('organizationDisplayName')
    expect(source).toContain('USDOT')
    expect(source).toContain('membership_role')
    expect(source).toContain('onSelect')
    expect(source).toContain('onKeyDown')
    expect(source).toContain("event.key === 'Escape'")
    expect(source).toContain('ArrowDown')
  })

  it('ActiveCarrierBanner references header picker and scoped org context', () => {
    const source = read(bannerPath)

    expect(source).toContain('workspace bar above')
    expect(source).toContain('Viewing data for')
    expect(source).not.toContain('TODO')
  })

  it('AppHeader shows Carriers nav link in service mode', () => {
    const source = read(headerPath)

    expect(source).toContain("workspaceMode === 'service'")
    expect(source).toContain("navLink('/carriers', 'Carriers'")
  })

  it('organization-context auto-selects first carrier in service mode', () => {
    const source = read(orgContextPath)

    expect(source).toContain('auto-select first carrier when entering service mode')
    expect(source).toContain('decideServiceModeActiveOrganizationUpdate')
    expect(source).toContain('carriersLoadedForUser')
    expect(source).toContain('accessibleOrganizationIdsKey')
    expect(source).toContain('parseAccessibleOrganizationIdsKey')
    expect(source).toContain('firstEligibleCarrierId')
    expect(source).toContain('serviceModeCarriers[0]')
    expect(source).toContain("decision.action === 'none'")
    expect(source).toContain('areAccessibleCarrierListsEqual')
    expect(source).toContain('filterServiceModeCarriers')
    expect(source).toContain("applyWorkspaceMode('carrier')")
    // Effect deps use key (not array identity) + only act after load for user.
    expect(source).toContain('accessibleOrganizationIdsKey,')
    expect(source).toContain('carriersLoadedForUser,')
  })
})