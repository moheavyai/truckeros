'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import AppHeader from '@/components/AppHeader'
import BrandedLoader from '@/components/BrandedLoader'
import ErrorDisplay from '@/components/ErrorDisplay'
import { getRestrictionsForCorridor } from '@/lib/dot-corridor-restrictions'

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
  highways: string[] | null
  permit_required_states: string[] | null
  requires_permit: boolean | null
  reasons: string[] | null
  notes: string[] | null
  estimated_cost: number | null
  distance_miles: number | null
  duration_hours: number | null
  cost_breakdown?: any
}

interface PortalSubmission {
  id: string
  permit_request_id: string
  state_code: string
  status: string
  permit_number: string | null
  portal_fees: number | null
  human_approved: boolean
  created_at: string
  route_comparison?: any
}

export default function HistoryPage() {
  const [user, setUser] = useState<any>(null)
  const [requests, setRequests] = useState<PermitRequest[]>([])
  const [submissions, setSubmissions] = useState<PortalSubmission[]>([])
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

        // Fetch user's permit history
        const { data: prData, error: prError } = await supabase
          .from('permit_requests')
          .select('*')
          .eq('user_id', session.user.id)
          .order('created_at', { ascending: false })
          .limit(100)

        if (!prError && prData) {
          const requests = prData as PermitRequest[]
          setRequests(requests)

          // Fetch associated portal submissions
          if (requests.length > 0) {
            const requestIds = requests.map(r => r.id)
            const { data: subData } = await supabase
              .from('portal_submissions')
              .select('*')
              .in('permit_request_id', requestIds)
              .order('created_at', { ascending: false })

            if (subData) {
              setSubmissions(subData as PortalSubmission[])
            }
          }
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
      <div className="min-h-screen bg-gray-50">
        <AppHeader />
        <BrandedLoader 
          message="Loading your analysis history..." 
          subMessage="Fetching your previous permit requests and portal submissions"
        />
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
      <AppHeader user={user} activePage="history" />

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
                          <a
                            href={`/portal-assist?requestId=${req.id}`}
                            className="text-sm px-3 py-1.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition"
                          >
                            Portal Assist
                          </a>
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

              {/* Enhanced Highway-level visualization (matches live results style) */}
              {selectedRequest.highways && selectedRequest.highways.length > 0 && (
                <div className="p-4 border-2 border-blue-100 rounded-xl bg-blue-50">
                  <div className="flex items-center justify-between mb-2">
                    <div className="font-semibold text-blue-900 text-sm">Key Highways / Interstates</div>
                    <span className="text-[10px] px-2 py-0.5 bg-blue-200 text-blue-800 rounded-full font-medium">From routing engine</span>
                  </div>

                  {(() => {
                    // Compute relevant DOT restrictions for this saved request
                    const relevantRestrictions = getRestrictionsForCorridor(
                      selectedRequest.route_corridor || [],
                      selectedRequest.highways || []
                    )

                    return (
                      <div className="flex flex-wrap gap-1.5">
                        {selectedRequest.highways.map((hwy: string, i: number) => {
                          // Check if this highway is mentioned in any relevant restriction
                          const hasRestriction = relevantRestrictions.some(r =>
                            r.highway.toLowerCase().includes(hwy.toLowerCase().replace(/\s/g, '')) ||
                            r.description.toLowerCase().includes(hwy.toLowerCase())
                          )

                          return (
                            <span
                              key={i}
                              className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium border transition-all ${
                                hasRestriction
                                  ? 'bg-amber-100 text-amber-900 border-amber-300'
                                  : 'bg-white text-blue-800 border-blue-200'
                              }`}
                              title={hasRestriction ? "This highway has known restrictions in the loaded DOT data" : ""}
                            >
                              {hwy}
                              {hasRestriction && <span className="ml-1 text-amber-600">⚠</span>}
                            </span>
                          )
                        })}
                      </div>
                    )
                  })()}

                  <p className="text-[10px] text-blue-700 mt-2">
                    Amber = highway matches known restrictions from State DOT open data.
                  </p>
                </div>
              )}

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

              {/* Portal Submissions (new unified view) */}
              {(() => {
                const related = submissions.filter(s => s.permit_request_id === selectedRequest.id)
                if (related.length === 0) return null

                return (
                  <div>
                    <div className="text-gray-500 text-xs mb-2">PORTAL SUBMISSIONS</div>
                    <div className="space-y-2">
                      {related.map((sub, i) => (
                        <div key={i} className="p-3 bg-gray-50 border rounded text-xs">
                          <div className="flex justify-between">
                            <span className="font-semibold">{sub.state_code}</span>
                            <span className={`px-2 rounded ${sub.human_approved ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                              {sub.status}
                            </span>
                          </div>
                          {sub.permit_number && <div>Permit #: <strong>{sub.permit_number}</strong></div>}
                          {sub.portal_fees != null && <div>Fees: ${sub.portal_fees}</div>}
                          <div className="text-[10px] text-gray-500 mt-1">{new Date(sub.created_at).toLocaleString()}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })()}

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
