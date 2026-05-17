'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

interface PermitRequest {
  id: string
  created_at: string
  origin_city: string
  origin_state: string
  destination_city: string
  destination_state: string
  weight: number
  length: number
  width: number
  height: number
  route_corridor: string[] | null
  permit_required_states: string[] | null
  requires_permit: boolean | null
  reasons: string[] | null
  notes: string[] | null
  estimated_cost: number | null
  distance_miles: number | null
  duration_hours: number | null
  cost_breakdown?: any
}

export default function HistoryPage() {
  const [user, setUser] = useState<any>(null)
  const [requests, setRequests] = useState<PermitRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedRequest, setSelectedRequest] = useState<PermitRequest | null>(null)
  const router = useRouter()

  /**
   * Authentication Guard + Data Fetch
   * Consistent with Dashboard and Permit Test pages.
   */
  useEffect(() => {
    const supabase = createClient()

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) {
        router.push('/login')
      } else {
        setUser(session.user)

        // Fetch user's permit history (RLS also enforces this, but explicit filter is clear)
        const { data, error } = await supabase
          .from('permit_requests')
          .select('*')
          .eq('user_id', session.user.id)
          .order('created_at', { ascending: false })
          .limit(100)

        if (!error && data) {
          setRequests(data as PermitRequest[])
        }
      }
      setLoading(false)
    })

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (!session) {
        router.push('/login')
      }
    })

    return () => listener.subscription.unsubscribe()
  }, [router])

  const handleLogout = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  // Branded loading state (consistent across app)
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="w-14 h-14 bg-black rounded-xl flex items-center justify-center mx-auto mb-4 shadow-sm">
            <span className="text-white text-3xl font-bold tracking-tighter">T</span>
          </div>
          <p className="text-gray-700 font-semibold text-lg">Checking authentication...</p>
          <p className="text-gray-500 text-sm mt-1">Loading your analysis history</p>
        </div>
      </div>
    )
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
  }

  const getPermitStatus = (req: PermitRequest) => {
    const count = req.permit_required_states?.length || 0
    if (count > 0) {
      return {
        text: `${count} State${count > 1 ? 's' : ''} Require Permit`,
        color: 'text-orange-600 bg-orange-50 border-orange-200',
      }
    }
    return {
      text: 'No Permit Required',
      color: 'text-emerald-600 bg-emerald-50 border-emerald-200',
    }
  }

  const formatCorridor = (corridor: string[] | null) => {
    if (!corridor || corridor.length === 0) return '—'
    if (corridor.length <= 5) return corridor.join(' → ')
    return `${corridor.slice(0, 3).join(' → ')} → ... (${corridor.length} states)`
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Consistent Header */}
      <header className="border-b bg-white sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <a href="/" className="flex items-center gap-2.5">
              <div className="w-8 h-8 bg-black rounded flex items-center justify-center">
                <span className="text-white text-lg font-bold tracking-tighter">T</span>
              </div>
              <span className="text-xl font-semibold tracking-tight">TruckerOS</span>
            </a>
            <span className="text-xs px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full font-medium">Permit Agent</span>
          </div>

          <div className="flex items-center gap-4 text-sm">
            <a href="/dashboard" className="text-gray-700 hover:text-black font-medium">Dashboard</a>
            <a href="/permit-test" className="text-gray-700 hover:text-black font-medium">New Analysis</a>
            <a href="/history" className="text-black font-semibold">History</a>
            <div className="w-px h-4 bg-gray-300 mx-1" />
            {user && (
              <span className="text-gray-600 hidden md:inline text-sm">{user.email}</span>
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
        <div className="mb-8">
          <h1 className="text-3xl font-semibold tracking-tight text-gray-900">Analysis History</h1>
          <p className="text-gray-600 mt-1.5">All your previous OSOW permit analyses</p>
        </div>

        {/* Main Content */}
        <div className="bg-white border rounded-2xl shadow-sm overflow-hidden">
          {requests.length === 0 ? (
            <div className="p-12 text-center">
              <div className="mx-auto w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mb-4">
                <span className="text-3xl">📋</span>
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-2">No analyses yet</h3>
              <p className="text-gray-600 mb-6">Start your first route analysis to see it appear here.</p>
              <a
                href="/permit-test"
                className="inline-flex items-center gap-2 bg-black hover:bg-gray-900 text-white px-6 py-3 rounded-xl font-semibold transition"
              >
                Start New Analysis →
              </a>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="text-left px-6 py-4 font-semibold text-gray-700">Date</th>
                    <th className="text-left px-6 py-4 font-semibold text-gray-700">Route</th>
                    <th className="text-left px-6 py-4 font-semibold text-gray-700">Load</th>
                    <th className="text-left px-6 py-4 font-semibold text-gray-700">Corridor</th>
                    <th className="text-left px-6 py-4 font-semibold text-gray-700">Status</th>
                    <th className="text-right px-6 py-4 font-semibold text-gray-700">Est. Cost</th>
                    <th className="w-20"></th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {requests.map((req) => {
                    const status = getPermitStatus(req)
                    const corridor = formatCorridor(req.route_corridor)

                    return (
                      <tr key={req.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-6 py-4 text-gray-600 whitespace-nowrap">
                          {formatDate(req.created_at)}
                        </td>
                        <td className="px-6 py-4">
                          <div className="font-medium text-gray-900">
                            {req.origin_city}, {req.origin_state} → {req.destination_city}, {req.destination_state}
                          </div>
                        </td>
                        <td className="px-6 py-4 text-gray-600">
                          {req.weight?.toLocaleString()} lbs<br />
                          <span className="text-xs">
                            {req.length}' × {req.width}' × {req.height}'
                          </span>
                        </td>
                        <td className="px-6 py-4 text-gray-600 max-w-[220px] truncate" title={corridor}>
                          {corridor}
                        </td>
                        <td className="px-6 py-4">
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${status.color}`}>
                            {status.text}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-right font-semibold text-gray-900">
                          {req.estimated_cost ? `$${req.estimated_cost}` : '—'}
                        </td>
                        <td className="px-6 py-4 text-right">
                          <button
                            onClick={() => setSelectedRequest(req)}
                            className="text-sm px-3 py-1.5 border border-gray-300 hover:bg-gray-100 rounded-lg text-gray-700 transition"
                          >
                            View
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <p className="text-xs text-gray-500 mt-4 text-center">
          Showing your most recent {requests.length} analyses. Data is private and secured by Row Level Security.
        </p>
      </main>

      {/* Details Modal */}
      {selectedRequest && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-auto shadow-xl">
            <div className="sticky top-0 bg-white border-b px-6 py-4 flex items-center justify-between">
              <h3 className="font-semibold text-lg">Analysis Details</h3>
              <button
                onClick={() => setSelectedRequest(null)}
                className="text-gray-500 hover:text-gray-900 text-2xl leading-none"
              >
                ×
              </button>
            </div>

            <div className="p-6 space-y-6 text-sm">
              {/* Route Summary */}
              <div>
                <div className="text-gray-500 text-xs mb-1">ROUTE</div>
                <div className="font-semibold text-lg">
                  {selectedRequest.origin_city}, {selectedRequest.origin_state} → {selectedRequest.destination_city}, {selectedRequest.destination_state}
                </div>
                <div className="text-gray-500 mt-1">
                  {formatDate(selectedRequest.created_at)}
                </div>
              </div>

              {/* Load Details */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-gray-500 text-xs mb-1">LOAD DIMENSIONS</div>
                  <div className="font-medium">
                    {selectedRequest.weight?.toLocaleString()} lbs<br />
                    {selectedRequest.length}' × {selectedRequest.width}' × {selectedRequest.height}'
                  </div>
                </div>
                <div>
                  <div className="text-gray-500 text-xs mb-1">ESTIMATED</div>
                  <div className="font-medium">
                    {selectedRequest.distance_miles ? `${selectedRequest.distance_miles} miles` : '—'}<br />
                    {selectedRequest.duration_hours ? `~${selectedRequest.duration_hours} hrs` : ''}
                  </div>
                </div>
              </div>

              {/* Corridor */}
              <div>
                <div className="text-gray-500 text-xs mb-1">ROUTE CORRIDOR</div>
                <div className="flex flex-wrap gap-1">
                  {(selectedRequest.route_corridor || []).map((state, i) => (
                    <span key={i} className="px-2 py-0.5 bg-gray-100 rounded text-xs font-mono">
                      {state}
                    </span>
                  ))}
                </div>
              </div>

              {/* Permit Status */}
              <div>
                <div className="text-gray-500 text-xs mb-1">PERMIT STATUS</div>
                <div className={`inline-block px-3 py-1 rounded-lg text-sm font-medium ${getPermitStatus(selectedRequest).color}`}>
                  {getPermitStatus(selectedRequest).text}
                </div>
              </div>

              {/* Reasons */}
              {selectedRequest.reasons && selectedRequest.reasons.length > 0 && (
                <div>
                  <div className="text-gray-500 text-xs mb-2">WHY PERMITS WERE REQUIRED</div>
                  <ul className="list-disc pl-5 space-y-1 text-gray-700">
                    {selectedRequest.reasons.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Notes & Restrictions */}
              {selectedRequest.notes && selectedRequest.notes.length > 0 && (
                <div>
                  <div className="text-gray-500 text-xs mb-2">ADDITIONAL NOTES</div>
                  <ul className="list-disc pl-5 space-y-1 text-gray-700">
                    {selectedRequest.notes.map((n, i) => (
                      <li key={i}>{n}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Cost */}
              {selectedRequest.estimated_cost != null && (
                <div className="pt-4 border-t flex justify-between items-center">
                  <span className="font-medium">Estimated Total Cost</span>
                  <span className="text-2xl font-bold">${selectedRequest.estimated_cost}</span>
                </div>
              )}
            </div>

            <div className="border-t px-6 py-4 flex justify-end gap-3">
              <button
                onClick={() => setSelectedRequest(null)}
                className="px-5 py-2 text-sm border rounded-lg hover:bg-gray-50"
              >
                Close
              </button>
              <a
                href="/permit-test"
                className="px-5 py-2 text-sm bg-black text-white rounded-lg hover:bg-gray-900"
              >
                Run New Analysis
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
