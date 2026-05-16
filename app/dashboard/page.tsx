'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'

export default function Dashboard() {
  const [user, setUser] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const router = useRouter()

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) {
        router.push('/login')
      } else {
        setUser(session.user)
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
    await supabase.auth.signOut()
    router.push('/login')
  }

  if (loading) {
    return <div className="p-8">Loading...</div>
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
              <a href="/permit-test" className="text-sm text-gray-600 hover:text-black">View all →</a>
            </div>

            <div className="divide-y">
              {[1,2,3].map((i) => (
                <div key={i} className="py-4 flex items-center justify-between text-sm">
                  <div>
                    <div className="font-medium text-gray-900">Calvert, AL → Lincoln, NE</div>
                    <div className="text-gray-500 text-xs mt-0.5">9.67 ft wide • 13.5 ft tall • 80,000 lbs</div>
                  </div>
                  <div className="text-right">
                    <div className="text-emerald-600 font-medium text-xs">No Permit Required</div>
                    <div className="text-gray-400 text-xs">2 days ago</div>
                  </div>
                </div>
              ))}
            </div>

            <div className="pt-4 text-xs text-gray-500 border-t">
              Full history and saved requests coming soon.
            </div>
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
