import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'

const invitePagePath = path.join(process.cwd(), 'app', 'invite', '[token]', 'page.tsx')

function readInviteSource() {
  return readFileSync(invitePagePath, 'utf8')
}

describe('Invite accept page UX', () => {
  it('shows needsSignIn path and login redirect with token', () => {
    const source = readInviteSource()
    expect(source).toContain('needsSignIn')
    expect(source).toContain('Sign in to view invite')
    expect(source).toMatch(/login\?redirect=\$\{encodeURIComponent\(`\/invite\/\$\{token\}`\)\}/)
  })

  it('resets accepting before login redirect', () => {
    const source = readInviteSource()
    const handler = source.slice(
      source.indexOf('async function handleAccept'),
      source.indexOf('if (loading)')
    )
    expect(handler).toMatch(/if \(!session\?\.user\) \{[\s\S]*setAccepting\(false\)[\s\S]*router\.push/)
  })

  it('only enters service mode for multi-org + eligible roles', () => {
    const source = readInviteSource()
    expect(source).toContain('SERVICE_MODE_ELIGIBLE_ROLES')
    expect(source).toContain('multi_org_join')
    expect(source).toContain('multiOrgJoin && serviceEligible')
    expect(source).toContain('setWorkspaceMode')
    expect(source).toContain('setActiveOrganizationId')
  })

  it('shows success message and delayed navigate with invite=accepted', () => {
    const source = readInviteSource()
    expect(source).toContain('Invite accepted. Taking you to your profile…')
    expect(source).toContain("router.push('/profile?invite=accepted')")
    expect(source).toContain('setTimeout')
  })
})
