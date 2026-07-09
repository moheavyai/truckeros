import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'

const loginPagePath = path.join(process.cwd(), 'app', 'login', 'page.tsx')

function readLoginSource() {
  return readFileSync(loginPagePath, 'utf8')
}

describe('Login page redirect handling', () => {
  it('honors safe post-login redirect for invite flow', () => {
    const source = readLoginSource()

    expect(source).toContain('resolveClientPostLoginPath')
    expect(source).toContain('candidatePostLoginPath')
    expect(source).toContain('hasExplicitRedirect')
    expect(source).toContain('resolveAuthenticatedLandingPath')
    // Default path remains dashboard when onboarding is complete
    expect(source).toContain('DEFAULT_POST_LOGIN_PATH')
  })

  it('routes via resolveLandingPath after successful password login', () => {
    const source = readLoginSource()
    const handleLogin = source.slice(
      source.indexOf('const handleLogin'),
      source.indexOf('const handleSignUp')
    )
    expect(handleLogin).toContain('redirectAuthenticated')
    expect(handleLogin).not.toMatch(/router\.push\('\/dashboard'\)/)
  })

  it('checks incomplete onboarding before landing on dashboard', () => {
    const source = readLoginSource()
    expect(source).toContain('isIncompleteOnboarding')
    expect(source).toContain('fetchActorTeamContext')
    expect(source).toContain('resolveLandingPath')
  })

  it('persists only explicit redirects on signup (not default dashboard)', () => {
    const source = readLoginSource()
    expect(source).toContain('persistPostLoginRedirect')
    expect(source).toContain('emailRedirectTo')
    expect(source).toContain('signUp')
    expect(source).toMatch(/pathToPersist = hasExplicitRedirect \? candidatePostLoginPath : null/)
  })

  it('clears persisted redirect after successful login', () => {
    const source = readLoginSource()
    expect(source).toContain('clearPostLoginRedirect')
    expect(source).toMatch(/clearPostLoginRedirect\(\)/)
    expect(source).toContain('redirectAuthenticated')
  })

  it('fails closed to ONBOARDING_PATH when onboarding status is unknown', () => {
    const source = readLoginSource()
    expect(source).toContain('ONBOARDING_PATH')
    expect(source).toMatch(/onboarding landing resolution failed[\s\S]*ONBOARDING_PATH/)
    expect(source).toContain('redirectingRef')
  })

  it('fails closed on profileError branch before team-context fetch', () => {
    const source = readLoginSource()
    expect(source).toContain('profileError')
    expect(source).toMatch(/if \(profileError\) \{[\s\S]*return ONBOARDING_PATH/)
  })
})
