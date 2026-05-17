'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [checkingSession, setCheckingSession] = useState(true)
  const router = useRouter()

  /**
   * Redirect already-authenticated users away from the login page.
   * This provides a consistent experience across the app:
   * - Protected pages (/dashboard, /permit-test) redirect unauthenticated users to /login.
   * - The login page redirects authenticated users to /dashboard.
   */
  useEffect(() => {
    const supabase = createClient()

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        router.push('/dashboard')
      } else {
        setCheckingSession(false)
      }
    })

    // Also listen for auth changes (e.g. user logs in via another tab)
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (session) {
        router.push('/dashboard')
      }
    })

    return () => listener.subscription.unsubscribe()
  }, [router])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    const supabase = createClient()

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (error) {
      alert(error.message)
      setLoading(false)
      return
    }

    // Explicitly fetch the session to ensure the refresh token is properly stored
    // before redirecting. This helps avoid "Invalid Refresh Token" errors.
    const { data: { session } } = await supabase.auth.getSession()

    if (session) {
      router.push('/dashboard')
    } else {
      alert('Login succeeded but no active session was found. Please try again or confirm your email if required.')
    }

    setLoading(false)
  }

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    const supabase = createClient()

    const { error } = await supabase.auth.signUp({
      email,
      password,
    })

    if (error) {
      alert(error.message)
    } else {
      alert('Account created! Check your email for the confirmation link. You must confirm before you can log in.')
    }

    setLoading(false)
  }

  // Show branded loading state while we check if the user is already logged in
  if (checkingSession) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="w-14 h-14 bg-black rounded-xl flex items-center justify-center mx-auto mb-4 shadow-sm">
            <span className="text-white text-3xl font-bold tracking-tighter">T</span>
          </div>
          <p className="text-gray-700 font-semibold text-lg">Checking authentication...</p>
          <p className="text-gray-500 text-sm mt-1">Please wait</p>
        </div>
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
              className="bg-black text-white px-6 py-3 rounded-lg w-full font-semibold hover:bg-gray-900 disabled:bg-gray-400 transition-colors"
            >
              {loading ? 'Logging in...' : 'Sign in'}
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