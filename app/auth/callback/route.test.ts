import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'

const callbackPath = path.join(process.cwd(), 'app', 'auth', 'callback', 'route.ts')

function readSource() {
  return readFileSync(callbackPath, 'utf8')
}

describe('auth callback route', () => {
  it('exchanges the PKCE code for a session', () => {
    const source = readSource()
    expect(source).toContain('exchangeCodeForSession')
    expect(source).toContain("searchParams.get('code')")
    expect(source).toContain("from '@/lib/supabase/server'")
  })

  it('sends recovery links to the set-password form instead of the dashboard', () => {
    const source = readSource()
    expect(source).toContain("mode', 'recovery'")
    expect(source).toContain('password_recovery')
  })

  it('surfaces provider errors on /login instead of failing silently', () => {
    const source = readSource()
    expect(source).toContain('error_description')
    expect(source).toContain("searchParams.set('error'")
  })

  it('uses a safe same-origin next path', () => {
    const source = readSource()
    expect(source).toContain('resolveAuthCallbackNext')
  })
})
