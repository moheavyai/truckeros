'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import AppHeader from '@/components/AppHeader'
import BrandedLoader from '@/components/BrandedLoader'

import { formatLoadDisplay } from '@/lib/parse-dimension'

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
  // Support for rich or-tools saved data (permitReady/permitWarnings) so history can show correct status even if permit_required_states not populated in older saves.
  permitReady?: boolean | null
  permitWarnings?: string[] | null
  permit_ready?: boolean | null
  permit_warnings?: string[] | null
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
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
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

  /**
   * Delete a single analysis. portal_submissions cascade via FK ON DELETE CASCADE.
   * Still scopes delete by user_id for defense-in-depth (RLS also enforces ownership).
   */
  const handleDeleteOne = async (id: string) => {
    if (!user?.id || deleting) return
    if (!window.confirm('Delete this analysis? This cannot be undone.')) return

    setDeleting(true)
    setDeleteError(null)
    try {
      const supabase = createClient()
      const { error } = await supabase
        .from('permit_requests')
        .delete()
        .eq('id', id)
        .eq('user_id', user.id)

      if (error) {
        setDeleteError(error.message || 'Failed to delete analysis.')
        return
      }

      setRequests((prev) => prev.filter((r) => r.id !== id))
      setSubmissions((prev) => prev.filter((s) => s.permit_request_id !== id))
    } catch (err: any) {
      setDeleteError(err?.message || 'Failed to delete analysis.')
    } finally {
      setDeleting(false)
    }
  }

  /**
   * Delete the currently loaded analyses only (matches confirm N).
   * Scoped by loaded ids + user_id so we never wipe rows beyond the displayed list
   * (fetch uses .limit(100)). Related portal_submissions cascade via FK ON DELETE CASCADE.
   */
  const handleDeleteAll = async () => {
    if (!user?.id || deleting || requests.length === 0) return
    const ids = requests.map((r) => r.id)
    if (!window.confirm(`Delete ALL ${ids.length} analyses? This cannot be undone.`)) return

    setDeleting(true)
    setDeleteError(null)
    try {
      const supabase = createClient()
      const { error } = await supabase
        .from('permit_requests')
        .delete()
        .in('id', ids)
        .eq('user_id', user.id)

      if (error) {
        setDeleteError(error.message || 'Failed to delete analyses.')
        return
      }

      const idSet = new Set(ids)
      setRequests((prev) => prev.filter((r) => !idSet.has(r.id)))
      setSubmissions((prev) => prev.filter((s) => !idSet.has(s.permit_request_id)))
    } catch (err: any) {
      setDeleteError(err?.message || 'Failed to delete analyses.')
    } finally {
      setDeleting(false)
    }
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
    // Support saved rich data: show "Permit Required" (or the states count) if permitReady true or has warnings (as used in permit-test results).
    // This fixes history incorrectly showing "No Permit Required" / "No Permit Needed" for or-tools cases with permitReady + warnings.
    const hasPermitReady = (req as any).permitReady === true || (req as any).permit_ready === true
    const hasWarnings = (Array.isArray((req as any).permitWarnings) && (req as any).permitWarnings.length > 0) ||
                        (Array.isArray((req as any).permit_warnings) && (req as any).permit_warnings.length > 0)
    if (count > 0 || hasPermitReady || hasWarnings) {
      return {
        text: count > 0 ? `${count} State${count > 1 ? 's' : ''} Require Permit` : 'Permit Required',
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

  const stateChipClass = (req: PermitRequest, st: string) => {
    const sub = submissions.find(s => s.permit_request_id === req.id && s.state_code === st)
    let cls = 'bg-gray-200 text-gray-600'
    if (sub) {
      const sl = (sub.status || '').toLowerCase()
      if (sl.includes('pdf') || sl.includes('received') || sl.includes('complete')) cls = 'bg-emerald-500 text-white'
      else if (sl.includes('applied') || sl.includes('apply') || sl.includes('pending') || sl.includes('submit') || sl.includes('prefilled') || sl.includes('submitted')) cls = 'bg-yellow-500 text-white'
      else cls = 'bg-gray-400 text-white'
    } else if ((req.permit_required_states || []).includes(st)) {
      cls = 'bg-red-500 text-white'
    }
    return cls
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader user={user} />

      <main className="max-w-7xl mx-auto px-4 py-6 sm:px-6 sm:py-10 min-w-0">
        <div className="mb-8 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-gray-900">Analysis History</h1>
            <p className="text-gray-600 mt-1.5">All your previous OSOW permit analyses</p>
          </div>
          {requests.length > 0 && (
            <button
              type="button"
              onClick={handleDeleteAll}
              disabled={deleting}
              className="shrink-0 self-start px-4 py-2 text-sm font-medium text-red-700 border border-red-200 bg-red-50 hover:bg-red-100 rounded-xl transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {deleting ? 'Deleting...' : 'Delete all'}
            </button>
          )}
        </div>

        {deleteError && (
          <div className="mb-4 px-4 py-3 rounded-xl border border-red-200 bg-red-50 text-sm text-red-700" role="alert">
            {deleteError}
          </div>
        )}

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
            <>
              {/* ——— Mobile card list (no horizontal scroll) ——— */}
              <div className="md:hidden divide-y">
                {requests.map((req) => {
                  const status = getPermitStatus(req)
                  const load = formatLoadDisplay({
                    weightLbs: req.weight,
                    lengthFt: req.length,
                    widthFt: req.width,
                    heightFt: req.height,
                  })
                  return (
                    <article key={req.id} className="p-4 space-y-3">
                      {/* Date + cost row */}
                      <div className="flex items-start justify-between gap-3">
                        <time className="text-xs text-gray-500 tabular-nums">
                          {formatDate(req.created_at)}
                        </time>
                        <span className="text-sm font-semibold text-gray-900 tabular-nums shrink-0">
                          {req.estimated_cost != null ? `$${req.estimated_cost}` : '—'}
                        </span>
                      </div>

                      {/* Route under timestamp */}
                      <div className="font-medium text-gray-900 text-sm leading-snug">
                        {req.origin_city}, {req.origin_state} → {req.destination_city}, {req.destination_state}
                      </div>

                      {/* Load compact */}
                      <div className="text-sm text-gray-700">
                        <span className="font-medium text-gray-900">{load.weight}</span>
                        <span className="text-gray-500 font-mono tabular-nums text-xs ml-2">
                          {load.dimensionsLine}
                        </span>
                      </div>

                      {/* Corridor chips + status combined */}
                      <div className="flex flex-wrap items-center gap-1.5">
                        {(req.route_corridor || []).map((st: string, i: number) => (
                          <span
                            key={i}
                            className={`px-1.5 py-0.5 text-[10px] rounded font-mono ${stateChipClass(req, st)}`}
                          >
                            {st}
                          </span>
                        ))}
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border ${status.color}`}
                        >
                          {status.text}
                        </span>
                      </div>

                      {/* Stacked actions — Portal Assist primary; no intermediate View step */}
                      <div className="flex flex-col gap-2 pt-1">
                        <a
                          href={`/portal-assist?requestId=${req.id}`}
                          className="w-full min-h-[44px] inline-flex items-center justify-center text-sm font-semibold bg-emerald-600 text-white hover:bg-emerald-700 rounded-xl transition touch-manipulation"
                        >
                          Portal Assist
                        </a>
                        <button
                          type="button"
                          onClick={() => handleDeleteOne(req.id)}
                          disabled={deleting}
                          className="w-full min-h-[44px] text-sm font-medium border border-red-200 text-red-700 hover:bg-red-50 rounded-xl transition disabled:opacity-50 disabled:cursor-not-allowed touch-manipulation"
                        >
                          {deleting ? 'Deleting...' : 'Delete'}
                        </button>
                        <a
                          href="/permit-test"
                          className="w-full min-h-[44px] inline-flex items-center justify-center text-sm font-medium border border-gray-300 text-gray-800 hover:bg-gray-50 rounded-xl transition touch-manipulation"
                        >
                          Re-run Analysis
                        </a>
                      </div>
                    </article>
                  )
                })}
              </div>

              {/* ——— Desktop table (md+) ——— */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b">
                    <tr>
                      <th className="text-left px-6 py-4 font-semibold text-gray-700">Date</th>
                      <th className="text-left px-6 py-4 font-semibold text-gray-700">Route</th>
                      <th className="text-left px-6 py-4 font-semibold text-gray-700">Load</th>
                      <th className="text-left px-6 py-4 font-semibold text-gray-700">Corridor</th>
                      <th className="text-left px-6 py-4 font-semibold text-gray-700">Status</th>
                      <th className="text-right px-6 py-4 font-semibold text-gray-700">Est. Cost</th>
                      <th className="w-40"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {requests.map((req) => {
                      const status = getPermitStatus(req)
                      const corridor = formatCorridor(req.route_corridor)
                      const load = formatLoadDisplay({
                        weightLbs: req.weight,
                        lengthFt: req.length,
                        widthFt: req.width,
                        heightFt: req.height,
                      })

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
                            <div className="font-medium text-gray-900">{load.weight}</div>
                            <div className="text-xs text-gray-500 mt-0.5 font-mono tabular-nums">
                              {load.dimensionsLine}
                            </div>
                          </td>
                          <td className="px-6 py-4 text-gray-600" title={corridor}>
                            <div className="flex flex-wrap gap-0.5">
                              {(req.route_corridor || []).map((st: string, i: number) => (
                                <span key={i} className={`px-1 py-px text-[9px] rounded font-mono ${stateChipClass(req, st)}`}>
                                  {st}
                                </span>
                              ))}
                            </div>
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
                            <div className="inline-flex flex-wrap items-center justify-end gap-2">
                              <a
                                href={`/portal-assist?requestId=${req.id}`}
                                className="text-sm px-3 py-1.5 bg-emerald-600 text-white hover:bg-emerald-700 rounded-lg font-medium transition"
                              >
                                Portal Assist
                              </a>
                              <button
                                type="button"
                                onClick={() => handleDeleteOne(req.id)}
                                disabled={deleting}
                                className="text-sm px-3 py-1.5 border border-red-200 text-red-700 hover:bg-red-50 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                {deleting ? 'Deleting...' : 'Delete'}
                              </button>
                              <a
                                href="/permit-test"
                                className="text-sm px-3 py-1.5 border border-gray-300 text-gray-700 hover:bg-gray-100 rounded-lg transition"
                              >
                                Re-run
                              </a>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>

        <p className="text-xs text-gray-500 mt-4 text-center">
          Showing your most recent {requests.length} analyses. Data is private and secured by Row Level Security.
        </p>
      </main>

    </div>
  )
}
