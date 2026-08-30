'use client'

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import BrandedLoader from '@/components/BrandedLoader'
import ErrorDisplay from '@/components/ErrorDisplay'
import {
  buildEmailRedirectTo,
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
import { buildConsentPayload } from '@/lib/legal'
import type { User } from '@supabase/supabase-js'

type AuthMode = 'signin' | 'signup' | 'forgot' | 'recovery'

const PASSWORD_HINT = 'Min 8 characters, 1 uppercase, 1 special character'
const CHECK_EMAIL_MESSAGE =
  'Account created. Check your email for the confirmation link (and spam). After you confirm, return here and sign in.'

/** Shared auth field styles — strong mobile borders + readable text/placeholders.
 *  Matches the permit-test mobile contrast pattern so fields stay legible under
 *  OS dark mode, bright sun, and low-end Android screens. */
const authInputClass =
  'border border-gray-500 sm:border-gray-300 p-3 w-full rounded text-gray-900 placeholder:text-gray-500 bg-white'

function validatePassword(password: string): string | null {
  if (password.length < 8) {
    return 'Password must be at least 8 characters.'
  }
  if (!/[A-Z]/.test(password)) {
    return 'Password must include at least one uppercase letter.'
  }
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?`~]/.test(password)) {
    return 'Password must include at least one special character (e.g. !@#$%).'
  }
  return null
}

function isUnconfirmedEmailError(message: string | null | undefined): boolean {
  if (!message) return false
  const lower = message.toLowerCase()
  return lower.includes('email not confirmed') || lower.includes('confirm your email')
}

function humanizeAuthError(message: string): string {
  if (isUnconfirmedEmailError(message)) {
    return 'This account exists but the email is not confirmed yet. Check your inbox (and spam), or resend the confirmation email below.'
  }
  return message
}

function readInitialMode(): AuthMode {
  if (typeof window === 'undefined') return 'signin'
  try {
    const params = new URLSearchParams(window.location.search)
    const mode = (params.get('mode') || '').toLowerCase()
    if (mode === 'signup' || mode === 'create' || mode === 'register') return 'signup'
    if (mode === 'forgot' || mode === 'reset') return 'forgot'
    if (mode === 'recovery') return 'recovery'
  } catch {
    // ignore
  }
  return 'signin'
}

async function recordUserConsent(userId: string) {
  const payload = buildConsentPayload()
  const supabase = createClient()
  const { error } = await supabase.from('user_consents').upsert(
    {
      user_id: userId,
      ...payload,
    },
    { onConflict: 'user_id' }
  )
  if (error) {
    // Non-blocking: consent was still accepted in the UI; log for ops.
    console.warn('[login] failed to persist user_consents', error)
  }
}

export default function LoginPage() {
  const [mode, setMode] = useState<AuthMode>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [acceptedLegal, setAcceptedLegal] = useState(false)
  const [loading, setLoading] = useState(false)
  const [checkingSession, setCheckingSession] = useState(true)
  const [authError, setAuthError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [needsConfirmationResend, setNeedsConfirmationResend] = useState(false)
  const router = useRouter()
  const redirectingRef = useRef(false)
  const modeInitializedRef = useRef(false)
  const recoveryActiveRef = useRef(false)

  useEffect(() => {
    if (modeInitializedRef.current) return
    modeInitializedRef.current = true
    const initial = readInitialMode()
    setMode(initial)
    if (initial === 'recovery') recoveryActiveRef.current = true

    try {
      const params = new URLSearchParams(window.location.search)
      const incomingError = params.get('error_description') || params.get('error')
      if (incomingError) {
        const decoded = decodeURIComponent(incomingError.replace(/\+/g, ' '))
        setAuthError(humanizeAuthError(decoded))
        if (isUnconfirmedEmailError(decoded)) setNeedsConfirmationResend(true)
      }
      if (params.get('confirmed') === '1') {
        setSuccessMessage('Email confirmed. Sign in to continue.')
      }
    } catch {
      // ignore malformed query
    }
  }, [])

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
      if (redirectingRef.current || recoveryActiveRef.current) return
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

    // Recovery links land with tokens in the URL hash; listen for PASSWORD_RECOVERY.
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        recoveryActiveRef.current = true
        setMode('recovery')
        setCheckingSession(false)
        setAuthError(null)
        setSuccessMessage(null)
        setPassword('')
        setConfirmPassword('')
        if (session?.user?.email) setEmail(session.user.email)
        return
      }

      if (session?.user && !recoveryActiveRef.current) {
        void redirectAuthenticated(session.user)
      }
    })

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (recoveryActiveRef.current) {
        setCheckingSession(false)
        return
      }
      if (session?.user) {
        void redirectAuthenticated(session.user)
      } else {
        setCheckingSession(false)
      }
    })

    return () => listener.subscription.unsubscribe()
  }, [redirectAuthenticated])

  const switchMode = (next: AuthMode) => {
    if (next !== 'recovery') recoveryActiveRef.current = false
    setMode(next)
    setAuthError(null)
    setSuccessMessage(null)
    setNeedsConfirmationResend(false)
    setPassword('')
    setConfirmPassword('')
    if (next !== 'signup') setAcceptedLegal(false)
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setAuthError(null)
    setSuccessMessage(null)
    setNeedsConfirmationResend(false)

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
        setAuthError(humanizeAuthError(error.message))
        if (isUnconfirmedEmailError(error.message)) setNeedsConfirmationResend(true)
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
        setNeedsConfirmationResend(true)
      }
    } catch (err: any) {
      const message = err?.message || 'An unexpected error occurred during login.'
      if (message.toLowerCase().includes('fetch')) {
        setAuthError(
          'Unable to connect to the authentication service. Please try again in a moment.'
        )
      } else {
        setAuthError(humanizeAuthError(message))
        if (isUnconfirmedEmailError(message)) setNeedsConfirmationResend(true)
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
    setNeedsConfirmationResend(false)

    const trimmedEmail = email.trim()
    if (!trimmedEmail || !password) {
      setAuthError('Enter an email and password to create your account.')
      setLoading(false)
      return
    }

    const passwordError = validatePassword(password)
    if (passwordError) {
      setAuthError(passwordError)
      setLoading(false)
      return
    }
    if (password !== confirmPassword) {
      setAuthError('Passwords do not match.')
      setLoading(false)
      return
    }
    if (!acceptedLegal) {
      setAuthError('You must agree to the Terms of Service and Privacy Policy to create an account.')
      setLoading(false)
      return
    }

    const supabase = createClient()
    const consent = buildConsentPayload()

    try {
      const pathToPersist = hasExplicitRedirect ? candidatePostLoginPath : null
      persistPostLoginRedirect(pathToPersist)

      const emailRedirectTo =
        typeof window !== 'undefined'
          ? buildEmailRedirectTo(window.location.origin, {
              type: 'signup',
              next: pathToPersist,
            })
          : undefined

      const { data, error } = await supabase.auth.signUp({
        email: trimmedEmail,
        password,
        options: {
          emailRedirectTo,
          data: {
            terms_version: consent.terms_version,
            terms_accepted_at: consent.terms_accepted_at,
            privacy_version: consent.privacy_version,
            privacy_accepted_at: consent.privacy_accepted_at,
          },
        },
      })

      if (error) {
        setAuthError(humanizeAuthError(error.message))
        return
      }

      if (data.session?.user) {
        await recordUserConsent(data.session.user.id)
        await redirectAuthenticated(data.session.user)
        return
      }

      // Email confirmation required — consent is already in user_metadata.
      setSuccessMessage(CHECK_EMAIL_MESSAGE)
      setNeedsConfirmationResend(true)
      setMode('signin')
      setPassword('')
      setConfirmPassword('')
      setAcceptedLegal(false)
    } catch (err: any) {
      const message = err?.message || 'An unexpected error occurred during sign up.'
      if (message.toLowerCase().includes('fetch')) {
        setAuthError(
          'Unable to connect to the authentication service. Please try again in a moment.'
        )
      } else {
        setAuthError(humanizeAuthError(message))
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
        typeof window !== 'undefined'
          ? buildEmailRedirectTo(window.location.origin, { type: 'recovery' })
          : undefined

      const { error } = await supabase.auth.resetPasswordForEmail(trimmedEmail, {
        redirectTo,
      })

      if (error) {
        setAuthError(error.message)
        return
      }

      setSuccessMessage(
        'If an account exists for that email, a reset link is on the way. Check your inbox (and spam), then use the link to set a new password.'
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

  const handleResendConfirmation = async () => {
    const trimmedEmail = email.trim()
    if (!trimmedEmail) {
      setAuthError('Enter the email address you used to create the account, then resend.')
      return
    }

    setLoading(true)
    setAuthError(null)
    setSuccessMessage(null)

    const supabase = createClient()
    try {
      const emailRedirectTo =
        typeof window !== 'undefined'
          ? buildEmailRedirectTo(window.location.origin, { type: 'signup' })
          : undefined

      const { error } = await supabase.auth.resend({
        type: 'signup',
        email: trimmedEmail,
        options: emailRedirectTo ? { emailRedirectTo } : undefined,
      })

      if (error) {
        setAuthError(humanizeAuthError(error.message))
        return
      }

      setSuccessMessage(
        'Confirmation email sent. Check your inbox and spam folder, then use the link to finish signing in.'
      )
      setNeedsConfirmationResend(true)
    } catch (err: any) {
      setAuthError(err?.message || 'Unable to resend confirmation email. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const handleSetNewPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setAuthError(null)
    setSuccessMessage(null)

    const passwordError = validatePassword(password)
    if (passwordError) {
      setAuthError(passwordError)
      setLoading(false)
      return
    }
    if (password !== confirmPassword) {
      setAuthError('Passwords do not match.')
      setLoading(false)
      return
    }

    const supabase = createClient()

    try {
      const { data, error } = await supabase.auth.updateUser({ password })

      if (error) {
        setAuthError(error.message)
        return
      }

      recoveryActiveRef.current = false
      setSuccessMessage('Password updated. Signing you in…')

      if (data.user) {
        await redirectAuthenticated(data.user)
      } else {
        setMode('signin')
        setPassword('')
        setConfirmPassword('')
        setSuccessMessage('Password updated. Please sign in with your new password.')
      }
    } catch (err: any) {
      setAuthError(err?.message || 'Unable to update password. Please try again.')
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
  const isRecovery = mode === 'recovery'
  const showResend =
    needsConfirmationResend && !isRecovery && !isForgot && Boolean(email.trim())

  const title = isRecovery
    ? 'Set a new password'
    : isForgot
      ? 'Reset your password'
      : isSignUp
        ? 'Create your account'
        : 'Welcome back'

  const subtitle = isRecovery
    ? 'Choose a strong password for your MoHeavy AI account.'
    : isForgot
      ? 'Enter your email and we’ll send a reset link.'
      : isSignUp
        ? 'Get started with MoHeavy AI — the operating system for truckers.'
        : 'Sign in to access MoHeavy AI'

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-md px-6">
        <div className="flex justify-center mb-8">
          <a href="/" className="flex items-center gap-2.5">
            <div className="w-9 h-9 bg-black rounded flex items-center justify-center">
              <span className="text-white text-xl font-bold tracking-tighter">M</span>
            </div>
            <span className="text-2xl font-semibold tracking-tight text-gray-900">
              MoHeavy AI
            </span>
          </a>
        </div>

        <div className="bg-white border border-gray-200 rounded-2xl p-8 shadow-sm">
          <h1 className="text-2xl font-semibold tracking-tight mb-1 text-gray-900">{title}</h1>
          <p className="text-gray-600 text-sm mb-6">{subtitle}</p>

          {isUsingPlaceholderEnv && (
            <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-700">
              <strong>Supabase not configured yet.</strong> Check your environment variables.
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

          {/* Recovery: set new password */}
          {isRecovery && (
            <form onSubmit={handleSetNewPassword} className="space-y-4">
              {email && (
                <p className="text-sm text-gray-600">
                  Account: <span className="font-medium text-gray-900">{email}</span>
                </p>
              )}
              <input
                type="password"
                placeholder={`New password (${PASSWORD_HINT})`}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                className={authInputClass}
                required
                minLength={8}
              />
              <input
                type="password"
                placeholder="Confirm new password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                className={authInputClass}
                required
                minLength={8}
              />
              <p className="text-xs text-gray-500">{PASSWORD_HINT}</p>
              <button
                type="submit"
                disabled={loading}
                className="bg-black text-white px-6 py-3 rounded-lg w-full font-semibold hover:bg-gray-900 disabled:bg-gray-400 transition-colors flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <span className="animate-spin">⏳</span> Saving...
                  </>
                ) : (
                  'Save new password'
                )}
              </button>
            </form>
          )}

          {/* Forgot: request reset email */}
          {isForgot && (
            <form onSubmit={handleForgotPassword} className="space-y-4">
              <input
                type="email"
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                className={authInputClass}
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
          )}

          {/* Sign in / Sign up */}
          {!isForgot && !isRecovery && (
            <form onSubmit={isSignUp ? handleSignUp : handleLogin} className="space-y-4">
              <input
                type="email"
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                className={authInputClass}
                required
              />
              <input
                type="password"
                placeholder={isSignUp ? `Password (${PASSWORD_HINT})` : 'Password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={isSignUp ? 'new-password' : 'current-password'}
                className={authInputClass}
                required
                minLength={isSignUp ? 8 : undefined}
              />
              {isSignUp && (
                <>
                  <input
                    type="password"
                    placeholder="Confirm password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    autoComplete="new-password"
                    className={authInputClass}
                    required
                    minLength={8}
                  />
                  <p className="text-xs text-gray-500">{PASSWORD_HINT}</p>

                  <label className="flex items-start gap-3 text-sm text-gray-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={acceptedLegal}
                      onChange={(e) => setAcceptedLegal(e.target.checked)}
                      className="mt-1 h-4 w-4 rounded border-gray-400 text-black focus:ring-black"
                      required
                    />
                    <span>
                      I agree to the{' '}
                      <a
                        href="/legal/terms"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-black underline underline-offset-2"
                      >
                        Terms of Service
                      </a>{' '}
                      and{' '}
                      <a
                        href="/legal/privacy"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-black underline underline-offset-2"
                      >
                        Privacy Policy
                      </a>
                      .
                    </span>
                  </label>
                </>
              )}

              <button
                type="submit"
                disabled={loading || (isSignUp && !acceptedLegal)}
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

              {showResend && (
                <button
                  type="button"
                  onClick={() => void handleResendConfirmation()}
                  disabled={loading}
                  className="text-sm text-gray-700 hover:text-black w-full"
                >
                  Resend confirmation email
                </button>
              )}
            </form>
          )}

          <div className="mt-5 pt-5 border-t border-gray-200 text-center space-y-2">
            {isRecovery ? null : isForgot ? (
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

        <p className="mt-6 text-center text-xs text-gray-500">
          <a href="/legal/terms" className="hover:text-gray-800 underline-offset-2 hover:underline">
            Terms
          </a>
          {' · '}
          <a href="/legal/privacy" className="hover:text-gray-800 underline-offset-2 hover:underline">
            Privacy
          </a>
        </p>
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
