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

type AuthMode = 'signin' | 'signup' | 'forgot'

function readInitialMode(): AuthMode {
  if (typeof window === 'undefined') return 'signin'
  try {
    const params = new URLSearchParams(window.location.search)
    const mode = (params.get('mode') || '').toLowerCase()
    if (mode === 'signup' || mode === 'create' || mode === 'register') return 'signup'
    if (mode === 'forgot' || mode === 'reset') return 'forgot'
  } catch {
    // ignore
  }
  return 'signin'
}

export default function LoginPage() {
  const [mode, setMode] = useState<AuthMode>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [checkingSession, setCheckingSession] = useState(true)
  const [authError, setAuthError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const router = useRouter()
  const redirectingRef = useRef(false)
  const modeInitializedRef = useRef(false)

  // Honor ?mode=signup / ?mode=forgot from deep links.
  useEffect(() => {
    if (modeInitializedRef.current) return
    modeInitializedRef.current = true
    setMode(readInitialMode())
  }, [])

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
    return isExplicitPostLoginPath(candidatePostLoginPath)
  }, [candidatePostLoginPath])

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

  useEffect(() => {
    const supabase = createClient()

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        void redirectAuthenticated(session.user)
      } else {
        setCheckingSession(false)
      }
    })

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        void redirectAuthenticated(session.user)
      }
    })

    return () => listener.subscription.unsubscribe()
  }, [redirectAuthenticated])

  const switchMode = (next: AuthMode) => {
    setMode(next)
    setAuthError(null)
    setSuccessMessage(null)
    setPassword('')
    setConfirmPassword('')
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setAuthError(null)
    setSuccessMessage(null)

    if (!email.trim() || !password) {
      setAuthError('Enter your email and password to sign in.')
      setLoading(false)
      return
    }

    const supabase = createClient()

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      })

      if (error) {
        setAuthError(error.message)
        return
      }

      const {
        data: { session },
      } = await supabase.auth.getSession()

      if (session?.user) {
        await redirectAuthenticated(session.user)
      } else {
        setAuthError(
          'Login succeeded but no active session was found. Please try again or confirm your email if required.'
        )
      }
    } catch (err: any) {
      const message = err?.message || 'An unexpected error occurred during login.'
      if (message.toLowerCase().includes('fetch')) {
        setAuthError(
          'Unable to connect to the authentication service. Please verify that .env.local contains your real Supabase Project URL and anon key and restart the dev server.'
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
    setSuccessMessage(null)

    const trimmedEmail = email.trim()
    if (!trimmedEmail || !password) {
      setAuthError('Enter an email and password to create your account.')
      setLoading(false)
      return
    }
    if (password.length < 6) {
      setAuthError('Password must be at least 6 characters.')
      setLoading(false)
      return
    }
    if (confirmPassword && password !== confirmPassword) {
      setAuthError('Passwords do not match.')
      setLoading(false)
      return
    }

    const supabase = createClient()

    try {
      const pathToPersist = hasExplicitRedirect ? candidatePostLoginPath : null
      persistPostLoginRedirect(pathToPersist)

      const emailRedirectTo =
        typeof window !== 'undefined'
          ? pathToPersist
            ? `${window.location.origin}/login?redirect=${encodeURIComponent(pathToPersist)}`
            : `${window.location.origin}/login`
          : undefined

      const { data, error } = await supabase.auth.signUp({
        email: trimmedEmail,
        password,
        options: emailRedirectTo ? { emailRedirectTo } : undefined,
      })

      if (error) {
        setAuthError(error.message)
        return
      }

      if (data.session?.user) {
        await redirectAuthenticated(data.session.user)
        return
      }

      setSuccessMessage(
        'Account created. Check your email for the confirmation link. After you confirm, return here and sign in.'
      )
      setMode('signin')
      setPassword('')
      setConfirmPassword('')
    } catch (err: any) {
      const message = err?.message || 'An unexpected error occurred during sign up.'
      if (message.toLowerCase().includes('fetch')) {
        setAuthError(
          'Unable to connect to the authentication service. Please verify that .env.local contains your real Supabase Project URL and anon key and restart the dev server.'
        )
      } else {
        setAuthError(message)
      }
    } finally {
      setLoading(false)
    }
  }

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setAuthError(null)
    setSuccessMessage(null)

    const trimmedEmail = email.trim()
    if (!trimmedEmail) {
      setAuthError('Enter the email address for your account.')
      setLoading(false)
      return
    }

    const supabase = createClient()

    try {
      const redirectTo =
        typeof window !== 'undefined' ? `${window.location.origin}/login` : undefined

      const { error } = await supabase.auth.resetPasswordForEmail(trimmedEmail, {
        redirectTo,
      })

      if (error) {
        setAuthError(error.message)
        return
      }

      setSuccessMessage(
        'If an account exists for that email, a reset link is on the way. Check your inbox (and spam), then return here to sign in with your new password.'
      )
      setMode('signin')
      setPassword('')
    } catch (err: any) {
      const message = err?.message || 'Unable to send reset email. Please try again.'
      if (message.toLowerCase().includes('fetch')) {
        setAuthError(
          'Unable to connect to the authentication service. Please try again in a moment.'
        )
      } else {
        setAuthError(message)
      }
    } finally {
      setLoading(false)
    }
  }

  if (checkingSession) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <BrandedLoader message="Checking authentication..." subMessage="Please wait" />
      </div>
    )
  }

  const isSignUp = mode === 'signup'
  const isForgot = mode === 'forgot'

  const title = isForgot
    ? 'Reset your password'
    : isSignUp
      ? 'Create your account'
      : 'Welcome back'

  const subtitle = isForgot
    ? 'Enter your email and we’ll send a reset link.'
    : isSignUp
      ? 'Get started with MoHeavy AI — the operating system for truckers.'
      : 'Sign in to access MoHeavy AI'

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-md px-6">
        {/* Logo */}
        <div className="flex justify-center mb-8">
          <a href="/" className="flex items-center gap-2.5">
            <div className="w-9 h-9 bg-black rounded flex items-center justify-center">
              <span className="text-white text-xl font-bold tracking-tighter">M</span>
            </div>
            <span className="text-2xl font-semibold tracking-tight">MoHeavy AI</span>
          </a>
        </div>

        {/* Auth Card */}
        <div className="bg-white border rounded-2xl p-8 shadow-sm">
          <h1 className="text-2xl font-semibold tracking-tight mb-1">{title}</h1>
          <p className="text-gray-600 text-sm mb-6">{subtitle}</p>

          {isUsingPlaceholderEnv && (
            <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-700">
              <strong>Supabase not configured yet.</strong> Your <code>.env.local</code> still contains
              the placeholder values from <code>.env.local.example</code>. Replace{' '}
              <code>NEXT_PUBLIC_SUPABASE_URL</code> and <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> with
              the real values from your Supabase project, then restart the dev server.
            </div>
          )}

          {authError && (
            <div className="mb-4">
              <ErrorDisplay message={authError} variant="inline" />
            </div>
          )}

          {successMessage && (
            <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-800">
              {successMessage}
            </div>
          )}

          {/* Forgot password form */}
          {isForgot ? (
            <form onSubmit={handleForgotPassword} className="space-y-4">
              <input
                type="email"
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                className="border p-3 w-full rounded"
                required
              />
              <button
                type="submit"
                disabled={loading}
                className="bg-black text-white px-6 py-3 rounded-lg w-full font-semibold hover:bg-gray-900 disabled:bg-gray-400 transition-colors flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <span className="animate-spin">⏳</span> Sending link...
                  </>
                ) : (
                  'Send reset link'
                )}
              </button>
            </form>
          ) : (
            /* Sign in / Sign up form */
            <form onSubmit={isSignUp ? handleSignUp : handleLogin} className="space-y-4">
              <input
                type="email"
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                className="border p-3 w-full rounded"
                required
              />
              <input
                type="password"
                placeholder={isSignUp ? 'Password (min 6 characters)' : 'Password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={isSignUp ? 'new-password' : 'current-password'}
                className="border p-3 w-full rounded"
                required
                minLength={isSignUp ? 6 : undefined}
              />
              {isSignUp && (
                <input
                  type="password"
                  placeholder="Confirm password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                  className="border p-3 w-full rounded"
                />
              )}

              <button
                type="submit"
                disabled={loading}
                className="bg-black text-white px-6 py-3 rounded-lg w-full font-semibold hover:bg-gray-900 disabled:bg-gray-400 transition-colors flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <span className="animate-spin">⏳</span>{' '}
                    {isSignUp ? 'Creating account...' : 'Signing in...'}
                  </>
                ) : isSignUp ? (
                  'Create account'
                ) : (
                  'Sign in'
                )}
              </button>
            </form>
          )}

          {/* Footer links */}
          <div className="mt-5 pt-5 border-t text-center space-y-2">
            {isForgot ? (
              <button
                type="button"
                onClick={() => switchMode('signin')}
                disabled={loading}
                className="text-sm text-gray-600 hover:text-black"
              >
                Back to <span className="font-medium text-black">Sign in</span>
              </button>
            ) : (
              <>
                {!isSignUp && (
                  <div>
                    <button
                      type="button"
                      onClick={() => switchMode('forgot')}
                      disabled={loading}
                      className="text-sm text-gray-600 hover:text-black"
                    >
                      Forgot password?
                    </button>
                  </div>
                )}
                {isSignUp ? (
                  <button
                    type="button"
                    onClick={() => switchMode('signin')}
                    disabled={loading}
                    className="text-sm text-gray-600 hover:text-black"
                  >
                    Already have an account? <span className="font-medium text-black">Sign in</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => switchMode('signup')}
                    disabled={loading}
                    className="text-sm text-gray-600 hover:text-black"
                  >
                    Don't have an account?{' '}
                    <span className="font-medium text-black">Create one</span>
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''
const isUsingPlaceholderEnv =
  supabaseUrl.includes('your-project.supabase.co') ||
  anonKey === 'your-anon-key' ||
  anonKey.includes('your-anon-key')
