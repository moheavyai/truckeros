'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import AppHeader from '@/components/AppHeader'
import BrandedLoader from '@/components/BrandedLoader'
import ErrorDisplay from '@/components/ErrorDisplay'
import { 
  STATE_PORTAL_CONFIGS, 
  generatePortalPrefill, 
  parsePortalOutput,
  compareRecommendedVsPortalRoute,
  createPortalSubmissionRecord,
  type RouteComparison,
  type PortalSubmissionRecord
} from '@/lib/portal-assistant'

interface PermitRequest {
  id: string
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
}

/**
 * Portal Assist Page — Stabilized & Consolidated
 * 
 * Fully consolidated to the new framework functions:
 * - generatePortalPrefill
 * - parsePortalOutput
 * - compareRecommendedVsPortalRoute → rich RouteComparison
 * - createPortalSubmissionRecord
 */
export default function PortalAssistPage() {
  const [user, setUser] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [selectedState, setSelectedState] = useState<'TX' | 'CA' | 'FL' | 'IL'>('TX')
  const [request, setRequest] = useState<PermitRequest | null>(null)
  const [prefill, setPrefill] = useState<any>(null)
  const [portalOutput, setPortalOutput] = useState('')
  const [parsedOutput, setParsedOutput] = useState<any>(null)

  // === Rich comparison + submission record state (from portal-assistant framework) ===
  const [routeComparison, setRouteComparison] = useState<RouteComparison | null>(null)
  const [submissionRecord, setSubmissionRecord] = useState<PortalSubmissionRecord | null>(null)
  const [isApproved, setIsApproved] = useState(false)

  const [savingCreds, setSavingCreds] = useState(false)
  const [credentialError, setCredentialError] = useState<string | null>(null)
  const [hasCredentials, setHasCredentials] = useState(false)
  const router = useRouter()

  const states = ['TX', 'CA', 'FL', 'IL'] as const

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) {
        router.push('/login')
      } else {
        setUser(session.user)
        // In a real flow, you would load a specific request by ID from query params
        // For demo, we'll use a placeholder. In production, pass ?requestId=xxx
      }
      setLoading(false)
    })
  }, [router])

  // Demo: Load a sample request (in real app this comes from History or previous flow)
  const loadDemoRequest = () => {
    const demoRequest: PermitRequest = {
      id: 'demo-' + Date.now(),
      origin_city: 'Houston',
      origin_state: 'TX',
      destination_city: 'Chicago',
      destination_state: 'IL',
      weight: 95000,
      length: 62,
      width: 10.5,
      height: 14.2,
      route_corridor: ['TX', 'OK', 'MO', 'IL'],
      permit_required_states: ['TX', 'IL'],
    }
    setRequest(demoRequest)

    const generatedPrefill = generatePortalPrefill(demoRequest, selectedState)
    setPrefill(generatedPrefill)
    setIsApproved(false)

    // Seed with empty comparison until user pastes portal output
    setRouteComparison(null)
    setSubmissionRecord(null)
  }

  const handleStateChange = (state: 'TX' | 'CA' | 'FL' | 'IL') => {
    setSelectedState(state)
    if (request) {
      const newPrefill = generatePortalPrefill(request, state)
      setPrefill(newPrefill)
      setIsApproved(false)
      setRouteComparison(null)
      setSubmissionRecord(null)
    }
  }

  const handleSaveCredentials = async () => {
    // In production this would open a secure form/modal
    const username = prompt('Enter your username for ' + selectedState + ' portal:')
    const password = prompt('Enter your password (will be encrypted server-side):')
    
    if (!username || !password) return

    setSavingCreds(true)
    setCredentialError(null)

    try {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      
      const res = await fetch('/api/portal-credentials', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ stateCode: selectedState, username, password }),
      })

      if (res.ok) {
        // Success - could show a toast in real app
        setHasCredentials(true)
      } else {
        const err = await res.json().catch(() => ({}))
        setCredentialError(err.error || 'Failed to save credentials securely.')
      }
    } catch (e: any) {
      setCredentialError('Network error while saving credentials. Please try again.')
    }
    setSavingCreds(false)
  }

  const handleApproveAndContinue = () => {
    if (!prefill) return

    const conflicts = prefill.approvalNotes || []
    const confirmed = window.confirm(
      `Confirm you have reviewed the prefill data for ${selectedState} and want to proceed with assisted submission?\n\n` +
      (conflicts.length > 0 ? conflicts.join('\n') : 'No major conflicts detected.')
    )

    if (confirmed) {
      setIsApproved(true)
      alert(`Approved for ${selectedState}. In a full implementation this would trigger server-side prefill + optional automation.`)
    }
  }

  const handleParseOutput = async () => {
    if (!portalOutput.trim() || !request) return

    // Guard: prefill must exist before we can create a submission record
    if (!prefill) {
      alert("Please click 'Generate Prefill' (or 'Regenerate') for the selected state first.")
      return
    }

    const parsed = parsePortalOutput(selectedState, portalOutput)
    setParsedOutput(parsed)

    // Use the powerful comparison function from the framework
    const comparison = compareRecommendedVsPortalRoute(
      request.route_corridor,
      parsed.route_corridor || []
    )
    setRouteComparison(comparison)

    // Create a proper submission record using the new helper
    const record = createPortalSubmissionRecord(
      request.id,
      selectedState,
      prefill,
      parsed
    )
    setSubmissionRecord(record)

    // Persist the submission record
    try {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()

      if (session) {
        await fetch('/api/portal-submissions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            ...record,
            raw_portal_output: portalOutput,
          }),
        })
      }
    } catch (e) {
      console.warn('Failed to persist portal submission (non-blocking)')
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <AppHeader />
        <BrandedLoader 
          message="Loading Portal Assistant..." 
          subMessage="Preparing secure portal tools"
        />
      </div>
    )
  }

  const config = STATE_PORTAL_CONFIGS[selectedState]

  return (
    <div className="max-w-5xl mx-auto p-8">
      <AppHeader user={user} activePage="portal-assist" />

      <header className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Agent-Assisted Portal Submission</h1>
        <p className="text-gray-600 mt-2">Secure prefill and assisted submission for high-volume states</p>
      </header>

      <div className="flex gap-2 mb-6">
        {states.map(state => (
          <button
            key={state}
            onClick={() => handleStateChange(state)}
            className={`px-4 py-2 rounded-lg border text-sm font-medium ${selectedState === state ? 'bg-black text-white' : 'bg-white'}`}
          >
            {state} — {STATE_PORTAL_CONFIGS[state].name.split(' ')[0]}
          </button>
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-8">
        {/* Left: Request + Prefill */}
        <div className="space-y-6">
          <div className="bg-white border rounded-2xl p-6">
            <h2 className="font-semibold mb-4">1. Load Details</h2>
            {!request ? (
              <button onClick={loadDemoRequest} className="bg-blue-600 text-white px-6 py-2 rounded-xl">
                Load Demo Request (Houston → Chicago)
              </button>
            ) : (
              <div className="text-sm space-y-1">
                <div><strong>Route:</strong> {request.origin_city}, {request.origin_state} → {request.destination_city}, {request.destination_state}</div>
                <div><strong>Load:</strong> {request.weight.toLocaleString()} lbs | {request.length}' × {request.width}' × {request.height}'</div>
                <div><strong>Corridor:</strong> {request.route_corridor?.join(' → ')}</div>
              </div>
            )}
          </div>

          {prefill && (
            <div className="bg-white border rounded-2xl p-6">
              <h2 className="font-semibold mb-4">2. Generated Prefill for {selectedState}</h2>
              <pre className="bg-gray-50 p-4 rounded text-xs overflow-auto max-h-64">
                {JSON.stringify(prefill.generatedFields, null, 2)}
              </pre>

              {prefill?.humanApprovalRequired && !isApproved && (
                <div className="mt-4 p-4 bg-amber-50 border border-amber-200 rounded-xl">
                  <p className="font-medium text-amber-800">Human Approval Required</p>

                  {routeComparison && (
                    <div className="mt-1 text-sm">
                      Route Comparison Recommendation: <strong className="uppercase">{routeComparison.recommendation}</strong>
                    </div>
                  )}

                  {(prefill.approvalNotes || []).length > 0 && (
                    <ul className="text-sm text-amber-700 mt-2 list-disc pl-5">
                      {(prefill.approvalNotes || []).map((c: string, i: number) => <li key={i}>{c}</li>)}
                    </ul>
                  )}
                  <button 
                    onClick={handleApproveAndContinue}
                    className="mt-3 bg-amber-600 text-white px-4 py-2 rounded-lg text-sm"
                  >
                    I have reviewed — Approve & Continue
                  </button>
                </div>
              )}

              <button 
                onClick={handleSaveCredentials}
                disabled={savingCreds}
                className="mt-4 text-sm px-4 py-2 border rounded-lg hover:bg-gray-50 disabled:opacity-50"
              >
                {savingCreds ? 'Saving securely...' : `Save ${selectedState} Portal Credentials (Encrypted)`}
              </button>

              {credentialError && (
                <div className="mt-2">
                  <ErrorDisplay 
                    message={credentialError} 
                    variant="inline" 
                    onRetry={handleSaveCredentials}
                    retryLabel="Retry save"
                  />
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right: Portal Actions */}
        <div className="space-y-6">
          <div className="bg-white border rounded-2xl p-6">
            <h2 className="font-semibold mb-4">3. {config.name} Portal</h2>
            <a href={config.portalUrl} target="_blank" className="text-blue-600 hover:underline block mb-2">
              Open {config.name} Portal →
            </a>
            <p className="text-sm text-gray-600 mb-4">{config.instructions}</p>

            {isApproved && (
              <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl text-sm">
                ✓ Approved for assisted submission.
                {routeComparison && (
                  <> (Route similarity: <strong>{routeComparison.similarity}%</strong> — {routeComparison.recommendation})</>
                )}
                <div className="text-xs mt-1 text-emerald-700">In production this would trigger server-side login + prefill using stored credentials.</div>
              </div>
            )}
          </div>

          {/* Output Reader */}
          <div className="bg-white border rounded-2xl p-6">
            <h2 className="font-semibold mb-4">4. Portal Output Reader</h2>
            <textarea
              value={portalOutput}
              onChange={(e) => setPortalOutput(e.target.value)}
              placeholder="Paste the confirmation text, permit number, or restrictions returned by the state portal here..."
              className="w-full border p-3 rounded min-h-[120px] text-sm"
            />
            <button 
              onClick={handleParseOutput} 
              disabled={!prefill}
              className="mt-2 bg-gray-800 text-white px-4 py-2 rounded-lg text-sm disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
              Parse Portal Output
            </button>

            {routeComparison && (
              <div className="mt-4 p-4 bg-gray-50 rounded-xl text-sm border">
                <div className="font-semibold mb-2">Route Comparison</div>

                <div className="flex items-center gap-3 mb-2">
                  <span>Similarity:</span>
                  <span className="font-bold text-lg">{routeComparison.similarity}%</span>
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                    routeComparison.recommendation === 'accept' ? 'bg-emerald-100 text-emerald-700' :
                    routeComparison.recommendation === 'review' ? 'bg-amber-100 text-amber-700' :
                    'bg-red-100 text-red-700'
                  }`}>
                    {routeComparison.recommendation.toUpperCase()}
                  </span>
                </div>

                <div className="text-gray-600 mb-2">{routeComparison.notes}</div>

                {routeComparison.differences.length > 0 && (
                  <div>
                    <div className="font-medium mt-2">Differences:</div>
                    <ul className="list-disc pl-5 text-xs text-gray-700">
                      {routeComparison.differences.map((d: string, i: number) => (
                        <li key={i}>{d}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Submission Record */}
                {submissionRecord && (
                  <div className="mt-3 pt-3 border-t text-xs text-gray-500">
                    Submission record generated (status: {submissionRecord.status}). Ready for persistence.
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="mt-8 text-xs text-gray-500">
        This is the extensible foundation. Real automation (Playwright) + full credential vault integration can be added per state in future iterations.
      </div>
    </div>
  )
}
