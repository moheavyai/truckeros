import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'

const carriersPagePath = path.join(process.cwd(), 'app', 'carriers', 'page.tsx')

function readCarriersSource() {
  return readFileSync(carriersPagePath, 'utf8')
}

describe('Carriers page UI', () => {
  it('lists accessible carriers and supports selection', () => {
    const source = readCarriersSource()

    expect(source).toContain('Accessible carriers')
    expect(source).toContain('accessibleCarriers.map')
    expect(source).toContain('setActiveOrganizationId')
    expect(source).toContain("'Select'")
    expect(source).toContain("'Selected'")
  })

  it('includes Add Carrier form for eligible roles with connection invite API', () => {
    const source = readCarriersSource()

    expect(source).toContain('Add Carrier')
    expect(source).toContain('canCreateCarrierConnectionInvite')
    expect(source).toContain('membershipRoles')
    expect(source).toContain('/api/carrier-connection-invites')
    expect(source).toContain('company_name')
    expect(source).toContain('invite_email')
    expect(source).toContain('invite_phone')
    expect(source).toContain('Save & Send Invite')
    expect(source).toContain('Pending connection invites')
    expect(source).toContain('Shareable invite link')
    expect(source).toContain('Invite email is required')
  })

  it('gates full UI until service mode is known', () => {
    const source = readCarriersSource()
    expect(source).toContain('contextLoading')
    expect(source).toContain("workspaceMode !== 'service'")
    expect(source).toContain('Loading carriers…')
  })

  it('wires pending invite revoke confirm, copy link, and expiry filter', () => {
    const source = readCarriersSource()
    expect(source).toContain('filterActivePendingCarrierConnectionInvites')
    expect(source).toContain('window.confirm')
    expect(source).toContain('handleRevokeInvite')
    expect(source).toContain('handleCopyInviteLink')
    expect(source).toContain('Copy link')
    expect(source).toContain('invitesListError')
  })

  it('surfaces feedback near form top and validates email client-side', () => {
    const source = readCarriersSource()
    expect(source).toContain('feedbackBanner')
    expect(source).toContain('Invite email is required so the carrier owner can accept securely')
    expect(source).toContain('mb-6 rounded-xl')
  })

  it('includes request access form wired to carrier-link-requests API', () => {
    const source = readCarriersSource()

    expect(source).toContain('Request access')
    expect(source).toContain('/api/carrier-link-requests')
    expect(source).toContain('target_usdot')
    expect(source).toContain('target_email')
    expect(source).toContain('Request Access')
  })

  it('uses AppHeader with carriers activePage and organization context', () => {
    const source = readCarriersSource()

    expect(source).toContain(
      '<AppHeader user={user} activePage="carriers" ownOrganizationId={ownProfile?.organization_id} />'
    )
    expect(source).toContain('useOrganizationContext')
    expect(source).toContain("router.replace('/dashboard')")
  })
})
