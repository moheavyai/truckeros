'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

export default function Dashboard() {
  const [user, setUser] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [recentRequests, setRecentRequests] = useState<any[]>([])
  const router = useRouter()

  /**
   * Authentication Guard (client-side) + Initial Data Load
   *
   * - Checks for a valid Supabase session on mount.
   * - Redirects unauthenticated users to /login immediately.
   * - Once authenticated, fetches the user's recent permit requests.
   * - Listens for auth changes (logout in another tab, token expiry, etc.).
   * - Keeps the page behind a loading state until auth is confirmed.
   * - Consistent protection pattern with /permit-test and other protected routes.
   */
  useEffect(() => {
    const supabase = createClient()

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) {
        router.push('/login')
      } else {
        setUser(session.user)

        // Fetch real recent requests (only after confirming the user is logged in)
        const { data: requests } = await supabase
          .from('permit_requests')
          .select('*')
          .eq('user_id', session.user.id)
          .order('created_at', { ascending: false })
          .limit(5)

        if (requests) {
          setRecentRequests(requests)
        }
      }
      setLoading(false)
    })

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (!session) {
        router.push('/login')
      } else {
        setUser(session.user)
      }
    })

    return () => listener.subscription.unsubscribe()
  }, [router])

  const handleLogout = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  // === Authentication Protection ===
  // Show a clean, branded loading state while verifying the user's session.
  // This prevents any flash of protected content and provides good UX.
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          {/* TruckerOS brand mark */}
          <div className="w-14 h-14 bg-black rounded-xl flex items-center justify-center mx-auto mb-4 shadow-sm">
            <span className="text-white text-3xl font-bold tracking-tighter">T</span>
          </div>
          <p className="text-gray-700 font-semibold text-lg">Checking authentication...</p>
          <p className="text-gray-500 text-sm mt-1">Please wait while we verify your session</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Professional Header */}
      <header className="bg-white border-b sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <a href="/" className="flex items-center gap-2.5">
              <div className="w-8 h-8 bg-black rounded flex items-center justify-center">
                <span className="text-white text-lg font-bold tracking-tighter">T</span>
              </div>
              <div>
                <span className="text-xl font-semibold tracking-tight">TruckerOS</span>
              </div>
            </a>
            <span className="text-xs px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full font-medium">Permit Agent</span>
          </div>

          <div className="flex items-center gap-4 text-sm">
            <a href="/dashboard" className="text-gray-700 hover:text-black font-medium">Dashboard</a>
            <a href="/permit-test" className="text-gray-700 hover:text-black font-medium">New Analysis</a>
            <a href="/history" className="text-gray-700 hover:text-black font-medium">History</a>
            <div className="w-px h-4 bg-gray-300 mx-1" />
            {user && (
              <span className="text-gray-600 hidden md:inline">{user.email}</span>
            )}
            <button 
              onClick={handleLogout} 
              className="px-4 py-1.5 text-sm border border-gray-300 hover:bg-gray-50 rounded-lg transition-colors"
            >
              Logout
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-10">
        {/* Welcome Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-semibold tracking-tight text-gray-900">
            Welcome back{user?.email ? `, ${user.email.split('@')[0]}` : ''}
          </h1>
          <p className="text-gray-600 mt-1.5 text-[15px]">
            Get accurate, route-specific permit intelligence in seconds.
          </p>
        </div>

        {/* Primary CTA */}
        <div className="mb-10">
          <a
            href="/permit-test"
            className="group inline-flex items-center gap-3 bg-black hover:bg-gray-900 text-white px-8 py-4 rounded-xl text-base font-semibold transition-all active:scale-[0.985]"
          >
            <span>Start New Route Analysis</span>
            <span className="text-xl group-hover:translate-x-0.5 transition">→</span>
          </a>
          <p className="text-sm text-gray-500 mt-2 ml-1">Analyze load dimensions against real state and provincial rules</p>
        </div>

        {/* Stats + Quick Cards */}
        <div className="grid md:grid-cols-3 gap-6 mb-10">
          <div className="bg-white border rounded-2xl p-6">
            <div className="text-sm text-gray-500 mb-1">Total Analyses</div>
            <div className="text-4xl font-semibold tracking-tighter">12</div>
            <div className="text-xs text-emerald-600 mt-2">↑ 4 this week</div>
          </div>
          <div className="bg-white border rounded-2xl p-6">
            <div className="text-sm text-gray-500 mb-1">Permits Required</div>
            <div className="text-4xl font-semibold tracking-tighter">8</div>
            <div className="text-xs text-gray-500 mt-2">67% of recent routes</div>
          </div>
          <div className="bg-white border rounded-2xl p-6">
            <div className="text-sm text-gray-500 mb-1">Escorts Flagged</div>
            <div className="text-4xl font-semibold tracking-tighter">5</div>
            <div className="text-xs text-orange-600 mt-2">Across 3 states</div>
          </div>
        </div>

        {/* Main Content Grid */}
        <div className="grid lg:grid-cols-3 gap-6">
          {/* Recent Activity */}
          <div className="lg:col-span-2 bg-white border rounded-2xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-lg tracking-tight">Recent Analyses</h2>
              <a href="/history" className="text-sm text-gray-600 hover:text-black">View all →</a>
            </div>

            <div className="divide-y">
              {recentRequests.length > 0 ? (
                recentRequests.map((req, index) => {
                  const permitCount = req.permit_required_states?.length || 0
                  const date = req.created_at ? new Date(req.created_at).toLocaleDateString() : ''

                  return (
                    <div key={index} className="py-4 flex items-center justify-between text-sm">
                      <div>
                        <div className="font-medium text-gray-900">
                          {req.origin_city}, {req.origin_state} → {req.destination_city}, {req.destination_state}
                        </div>
                        <div className="text-gray-500 text-xs mt-0.5">
                          {req.weight?.toLocaleString()} lbs • {req.length} ft
                        </div>
                      </div>
                      <div className="text-right">
                        <div className={`${permitCount > 0 ? 'text-orange-600' : 'text-emerald-600'} font-medium text-xs`}>
                          {permitCount > 0 ? `${permitCount} State${permitCount > 1 ? 's' : ''} Require Permit` : 'No Permit Required'}
                        </div>
                        <div className="text-gray-400 text-xs">{date}</div>
                      </div>
                    </div>
                  )
                })
              ) : (
                <div className="py-6 text-center text-sm text-gray-500">
                  No analyses yet. Run your first route analysis to see history here.
                </div>
              )}
            </div>

            {recentRequests.length > 0 && (
              <div className="pt-4 text-xs text-gray-500 border-t">
                Showing your last {recentRequests.length} saved analyses.
              </div>
            )}
          </div>

          {/* Tips / Guidance */}
          <div className="bg-white border rounded-2xl p-6">
            <h2 className="font-semibold text-lg tracking-tight mb-4">Pro Tips</h2>
            <div className="space-y-4 text-sm">
              <div className="flex gap-3">
                <div className="text-lg">🛣️</div>
                <div>
                  <div className="font-medium">Use real coordinates</div>
                  <div className="text-gray-600 text-xs">Geocoding your origin and destination gives the most accurate corridor.</div>
                </div>
              </div>
              <div className="flex gap-3">
                <div className="text-lg">❄️</div>
                <div>
                  <div className="font-medium">Check seasonal restrictions</div>
                  <div className="text-gray-600 text-xs">Northern routes often have spring frost laws that reduce allowable weights.</div>
                </div>
              </div>
              <div className="flex gap-3">
                <div className="text-lg">🚛</div>
                <div>
                  <div className="font-medium">Review escort requirements</div>
                  <div className="text-gray-600 text-xs">Some states require escorts even before permits are triggered.</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
