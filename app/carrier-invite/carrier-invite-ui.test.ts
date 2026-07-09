import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'

const invitePagePath = path.join(
  process.cwd(),
  'app',
  'carrier-invite',
  '[token]',
  'page.tsx'
)

function readSource() {
  return readFileSync(invitePagePath, 'utf8')
}

describe('Carrier invite accept page UX', () => {
  it('loads preview from carrier-connection-invites accept API', () => {
    const source = readSource()
    expect(source).toContain('/api/carrier-connection-invites/accept')
    expect(source).toContain('Carrier Connection')
    expect(source).toContain('Accept connection')
  })

  it('requires sign-in with login redirect including token', () => {
    const source = readSource()
    expect(source).toContain('needsSignIn')
    expect(source).toMatch(
      /login\?redirect=\$\{encodeURIComponent\(`\/carrier-invite\/\$\{token\}`\)\}/
    )
  })

  it('sets carrier mode after accept and navigates to profile', () => {
    const source = readSource()
    expect(source).toContain("setWorkspaceMode('carrier')")
    expect(source).toContain('setActiveOrganizationId')
    expect(source).toContain("router.push('/profile?carrier_connection=accepted')")
  })

  it('guards loadInvite with try/catch and error state', () => {
    const source = readSource()
    expect(source).toContain('Failed to load invite. Please try again.')
    expect(source).toMatch(/async function loadInvite[\s\S]*try \{/)
    expect(source).toMatch(/catch \{\s*if \(!cancelled\)/)
  })
})
