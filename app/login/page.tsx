'use client'

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import BrandedLoader from '@/components/BrandedLoader'
import ErrorDisplay from '@/components/ErrorDisplay'
import {
  clearPostLoginRedirect,
  DEFAULT_POST_LOGIN_PATH,
  persistPostLoginRedirect,
  readRedirectSearchParam,
  resolveClientPostLoginPath,
  resolvePostLoginRedirect,
} from '@/lib/auth-redirect'
import {
  isExplicitPostLoginPath,
  isIncompleteOnboarding,
  ONBOARDING_PATH,
  resolveAuthenticatedLandingPath,
} from '@/lib/onboarding'
import { fetchActorTeamContext } from '@/lib/roster-profile-link'
import type { User } from '@supabase/supabase-js'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [checkingSession, setCheckingSession] = useState(true)
  const [authError, setAuthError] = useState<string | null>(null)
  const router = useRouter()
  const redirectingRef = useRef(false)

  /** Candidate from ?redirect= / storage only (no onboarding check yet). */
  const candidatePostLoginPath = useMemo(() => {
    if (typeof window === 'undefined') return DEFAULT_POST_LOGIN_PATH
    return resolveClientPostLoginPath(window.location.search)
  }, [])

  const hasExplicitRedirect = useMemo(() => {
    if (typeof window === 'undefined') return false
    const queryRaw = readRedirectSearchParam(window.location.search)
    if (queryRaw) {
      const safe = resolvePostLoginRedirect(queryRaw, '')
      if (safe && isExplicitPostLoginPath(safe)) return true
    }
    // Stored signup redirect is already folded into candidatePostLoginPath.
    return isExplicitPostLoginPath(candidatePostLoginPath)
  }, [candidatePostLoginPath])

  /**
   * After auth: honor invite/explicit redirects; otherwise send incomplete
   * first-time accounts to Welcome/profile instead of Dashboard.
   * Onboarding status unknown → fail-closed to profile (not dashboard).
   */
  const resolveLandingPath = useCallback(
    async (user: User): Promise<string> => {
      if (hasExplicitRedirect) {
        return resolveAuthenticatedLandingPath({
          candidatePath: candidatePostLoginPath,
          incompleteOnboarding: false,
          hasExplicitRedirect: true,
        })
      }

      try {
        const supabase = createClient()
        const { data: profile, error: profileError } = await supabase
          .from('member_profiles')
          .select('organization_id, is_primary_owner, user_id')
          .eq('user_id', user.id)
          .maybeSingle()

        if (profileError) {
          console.warn('[login] profile load failed', profileError)
          // Fail-closed: unknown status → Welcome/profile, not Dashboard bounce.
          return ONBOARDING_PATH
        }

        let linkedRoster = null
        let organizationMembership = null
        if (!profile?.organization_id) {
          const teamContext = await fetchActorTeamContext(supabase, user.id, user.email)
          linkedRoster = teamContext.linkedRoster
          organizationMembership = teamContext.organizationMembership
        }

        const incomplete = isIncompleteOnboarding({
          actorEmail: user.email,
          ownProfile: profile ?? null,
          linkedRoster,
          organizationMembership,
        })

        return resolveAuthenticatedLandingPath({
          candidatePath: candidatePostLoginPath,
          incompleteOnboarding: incomplete,
          hasExplicitRedirect: false,
        })
      } catch (error) {
        console.warn('[login] onboarding landing resolution failed', error)
        // Fail-closed to onboarding when status is unknown (Dashboard gate is a secondary recovery).
        return ONBOARDING_PATH
      }
    },
    [candidatePostLoginPath, hasExplicitRedirect]
  )

  const redirectAuthenticated = useCallback(
    async (user: User) => {
      if (redirectingRef.current) return
      redirectingRef.current = true
      try {
        clearPostLoginRedirect()
        const path = await resolveLandingPath(user)
        router.push(path)
      } catch (error) {
        console.warn('[login] redirect failed', error)
        redirectingRef.current = false
        router.push(ONBOARDING_PATH)
      }
    },
    [resolveLandingPath, router]
  )

  /**
   * Redirect already-authenticated users away from the login page.
   * Honors a safe ?redirect= path (e.g. invite accept flow).
   */
  useEffect(() => {
    const supabase = createClient()

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        void redirectAuthenticated(session.user)
      } else {
        setCheckingSession(false)
      }
    })

    // Also listen for auth changes (e.g. user logs in via another tab)
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        void redirectAuthenticated(session.user)
      }
    })

    return () => listener.subscription.unsubscribe()
  }, [redirectAuthenticated])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setAuthError(null)

    const supabase = createClient()

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      })

      if (error) {
        setAuthError(error.message)
        return
      }

      // Explicitly fetch the session to ensure the refresh token is properly stored
      // before redirecting. This helps avoid "Invalid Refresh Token" errors.
      const { data: { session } } = await supabase.auth.getSession()

      if (session?.user) {
        await redirectAuthenticated(session.user)
      } else {
        setAuthError('Login succeeded but no active session was found. Please try again or confirm your email if required.')
      }
    } catch (err: any) {
      // This catches network-level failures such as "Failed to fetch" (TypeError)
      // that occur when Supabase URL/anon key point to a non-existent host (e.g. placeholder values).
      const message = err?.message || 'An unexpected error occurred during login.'
      if (message.toLowerCase().includes('fetch')) {
        setAuthError(
          'Unable to connect to the authentication service. Please verify that .env.local contains your real Supabase Project URL and anon key (not the placeholders from .env.local.example) and restart the dev server with `npm run dev`.'
        )
      } else {
        setAuthError(message)
      }
    } finally {
      setLoading(false)
    }
  }

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setAuthError(null)

    const supabase = createClient()

    try {
      // Keep invite (or other) redirect across email confirmation → login.
      // Do not persist default dashboard — first login will route incomplete users to Welcome.
      const pathToPersist = hasExplicitRedirect ? candidatePostLoginPath : null
      persistPostLoginRedirect(pathToPersist)

      const emailRedirectTo =
        typeof window !== 'undefined'
          ? pathToPersist
            ? `${window.location.origin}/login?redirect=${encodeURIComponent(pathToPersist)}`
            : `${window.location.origin}/login`
          : undefined

      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: emailRedirectTo ? { emailRedirectTo } : undefined,
      })

      if (error) {
        setAuthError(error.message)
      } else {
        alert('Account created! Check your email for the confirmation link. You must confirm before you can log in.')
      }
    } catch (err: any) {
      const message = err?.message || 'An unexpected error occurred during sign up.'
      if (message.toLowerCase().includes('fetch')) {
        setAuthError(
          'Unable to connect to the authentication service. Please verify that .env.local contains your real Supabase Project URL and anon key (not the placeholders from .env.local.example) and restart the dev server with `npm run dev`.'
        )
      } else {
        setAuthError(message)
      }
    } finally {
      setLoading(false)
    }
  }

  // Show branded loading state while we check if the user is already logged in
  if (checkingSession) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <BrandedLoader
          message="Checking authentication..."
          subMessage="Please wait"
        />
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-md px-6">
        {/* Logo */}
        <div className="flex justify-center mb-8">
          <a href="/" className="flex items-center gap-2.5">
            <div className="w-9 h-9 bg-black rounded flex items-center justify-center">
              <span className="text-white text-xl font-bold tracking-tighter">T</span>
            </div>
            <span className="text-2xl font-semibold tracking-tight">TruckerOS</span>
          </a>
        </div>

        {/* Login Card */}
        <div className="bg-white border rounded-2xl p-8 shadow-sm">
          <h1 className="text-2xl font-semibold tracking-tight mb-1">Welcome back</h1>
          <p className="text-gray-600 text-sm mb-6">Sign in to access the Permit Agent</p>

          {/* Placeholder config warning (only visible when .env.local still has example values) */}
          {isUsingPlaceholderEnv && (
            <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-700">
              <strong>Supabase not configured yet.</strong> Your <code>.env.local</code> still contains the placeholder values
              from <code>.env.local.example</code>. Replace <code>NEXT_PUBLIC_SUPABASE_URL</code> and{' '}
              <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> with the real values from your Supabase project, then restart the dev server.
            </div>
          )}

          {/* Auth errors (network "Failed to fetch", invalid credentials, etc.) — replaces the old alert() */}
          {authError && (
            <div className="mb-4">
              <ErrorDisplay message={authError} variant="inline" />
            </div>
          )}

          {/* Login Form */}
          <form onSubmit={handleLogin} className="space-y-4">
            <input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="border p-3 w-full rounded"
            />
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="border p-3 w-full rounded"
            />

            <button
              type="submit"
              disabled={loading}
              className="bg-black text-white px-6 py-3 rounded-lg w-full font-semibold hover:bg-gray-900 disabled:bg-gray-400 transition-colors flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <span className="animate-spin">⏳</span> Logging in...
                </>
              ) : (
                'Sign in'
              )}
            </button>
          </form>

          {/* Sign Up Link */}
          <div className="mt-5 pt-5 border-t text-center">
            <button
              onClick={handleSignUp}
              disabled={loading}
              className="text-sm text-gray-600 hover:text-black"
            >
              Don&apos;t have an account? <span className="font-medium text-black">Create one</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// Detect placeholder Supabase config so we can warn the user before they hit network errors.
// These values come from .env.local at dev server startup (NEXT_PUBLIC_* are inlined for the client).
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''
const isUsingPlaceholderEnv =
  supabaseUrl.includes('your-project.supabase.co') ||
  anonKey === 'your-anon-key' ||
  anonKey.includes('your-anon-key')
