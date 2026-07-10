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
  getPortalStatesForAnalysis,
  resolveInitialPortalState,
  type RouteComparison,
  type PortalSubmissionRecord,
  type PrefillPackage
} from '@/lib/portal-assistant'
import { formatLoadDisplay } from '@/lib/parse-dimension'
import { formatPortalEquipmentSnapshot } from '@/lib/portal-equipment-display'
import {
  formatCarrierReviewFields,
  formatDriverReviewFields,
  formatLoadReviewDetails,
} from '@/lib/portal-review-display'

/**
 * Rich PermitRequest shape matching saved DB rows (permit_requests + equipment/cargo snapshots from 009 migration).
 * Used for accurate prefill (axles, vin, overhangs etc) and rich UI details.
 */
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
  equipment?: Record<string, any> | null
  cargo?: Record<string, any> | null
  highways?: string[] | null
  distance_miles?: number | null
  duration_hours?: number | null
  created_at?: string
}

interface PortalSubmission {
  id?: string
  permit_request_id: string
  state_code: string
  status: string
  permit_number: string | null
  portal_fees: number | null
  human_approved: boolean
  pdf_reference?: string | null
  route_comparison?: any
  created_at?: string
}

/**
 * Portal Assist Page — Full Production Implementation
 * 
 * Meets all requirements:
 * - Dedicated professional UI (consistent with history/permit-test: AppHeader, cards, BrandedLoader, ErrorDisplay, red/amber/emerald status)
 * - Dynamic state selector from STATE_PORTAL_CONFIGS (49 states (all except HI); adding state = 1 object)
 * - Secure creds (POST save encrypted; GET returns metadata only — never pw to client)
 * - Prefill from real saved request data (full fields + equipment/cargo)
 * - Output parse + compare (framework) with rich UI
 * - Per-state status pills (exact reuse of history logic: red=needed/no sub, yellow=applied/prefilled/submit, green=pdf/received/approved)
 * - PDF: upload to 'portal-pdfs' Supabase Storage (user/req/state path), store pdf_reference, list/download
 * - Human approval gate (prominent, explicit confirm before record submission with human_approved=true)
 * - Full ?requestId integration from History details modal "Launch Portal Assist" (real fetch via supabase RLS)
 * - Robust: try/catch + ErrorDisplay everywhere, loading states, graceful unsupported, logging [portal-assist]
 * - Config-driven + extensibility notes in UI + lib
 * - Backward compatible (demo still works, existing submissions schema/RLS untouched)
 * 
 * Flow sections: Request Details → Generated Prefill → Credentials (secure) → Human Approval Gate → Portal Actions → Output Paste & Analysis → PDF & Artifacts + status pills
 */

/** Mobile-first contrast: stronger borders/text on small screens; softer from sm: up (matches permit-test). */
const fieldControlClass =
  'border border-gray-500 sm:border-gray-300 text-gray-900 placeholder:text-gray-500 bg-white'
const inputClass = `${fieldControlClass} rounded-lg px-3 py-2 text-sm`
const textareaClass = `${fieldControlClass} rounded-lg p-2 text-sm`
const buttonSecondaryClass =
  'border border-gray-500 sm:border-gray-300 text-gray-900 rounded-xl text-sm font-medium hover:bg-gray-50 disabled:opacity-60'
const buttonPrimaryClass =
  'bg-black text-white rounded-lg text-sm hover:bg-gray-900 disabled:opacity-60'
/** Success/approve CTAs — shared emerald so Approve + Load Demo stay in lockstep. */
const buttonSuccessClass =
  'bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-medium disabled:bg-gray-500 disabled:text-white'
const fieldHintClass = 'text-xs text-gray-600 sm:text-gray-500'
const fieldHintTinyClass = 'text-[10px] text-gray-600 sm:text-gray-500'
/** Labels share hint contrast so field chrome stays in lockstep. */
const fieldLabelClass = fieldHintClass
const fieldLabelTinyClass = 'text-[10px] uppercase tracking-wider text-gray-600 sm:text-gray-500'
const sectionLabelClass = 'text-xs font-medium text-gray-600 sm:text-gray-500 tracking-wider'
/** Body copy: darker on mobile for outdoor readability; softer from sm+. */
const bodyTextClass = 'text-gray-700 sm:text-gray-600'
/** Section cards: stronger outline on mobile (matches permit-test nested panels). */
const cardClass = 'bg-white border border-gray-300 sm:border-gray-200 rounded-2xl p-6'
/** Compact meta panel — same border scale as cardClass, tighter padding for audit chrome. */
const cardMetaClass =
  'bg-white border border-gray-300 sm:border-gray-200 rounded-2xl p-4 text-xs text-gray-700 sm:text-gray-600'

export default function PortalAssistPage() {
  const [user, setUser] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [pageError, setPageError] = useState<string | null>(null)

  // Dynamic from config — true extensibility (no hard-coded lists elsewhere)
  const allStateCodes = Object.keys(STATE_PORTAL_CONFIGS)
  const [selectedState, setSelectedState] = useState<string>('TX')
  const [stateQuery, setStateQuery] = useState('')
  const [isExpanded, setIsExpanded] = useState(false)

  const [request, setRequest] = useState<PermitRequest | null>(null)
  const [requestLoading, setRequestLoading] = useState(false)
  const [requestError, setRequestError] = useState<string | null>(null)

  const [prefill, setPrefill] = useState<PrefillPackage | null>(null)
  const [portalOutput, setPortalOutput] = useState('')
  const [parsedOutput, setParsedOutput] = useState<any>(null)

  // Rich framework state
  const [routeComparison, setRouteComparison] = useState<RouteComparison | null>(null)
  const [submissionRecord, setSubmissionRecord] = useState<PortalSubmissionRecord | null>(null)
  const [isApproved, setIsApproved] = useState(false)

  // Creds (secure: never hold plain pw client-side)
  const [savingCreds, setSavingCreds] = useState(false)
  const [credentialError, setCredentialError] = useState<string | null>(null)
  const [hasCredentials, setHasCredentials] = useState(false)
  const [credUsername, setCredUsername] = useState<string>('')

  // Submissions for this request (drives per-state status pills)
  const [submissions, setSubmissions] = useState<PortalSubmission[]>([])

  // PDF artifacts (client list + current pending reference for next record)
  const [pdfUploading, setPdfUploading] = useState(false)
  const [pdfError, setPdfError] = useState<string | null>(null)
  const [attachedPdfs, setAttachedPdfs] = useState<Array<{ name: string; url: string; path: string }>>([])
  const [currentPdfReference, setCurrentPdfReference] = useState<string | null>(null)

  // Approval gate UI
  const [approvalChecked, setApprovalChecked] = useState(false)
  const [approvalNotes, setApprovalNotes] = useState('')
  const [approving, setApproving] = useState(false)
  const [approvalError, setApprovalError] = useState<string | null>(null)

  const [parseError, setParseError] = useState<string | null>(null)
  const [savingSubmission, setSavingSubmission] = useState(false)
  const [launchHint, setLaunchHint] = useState<string | null>(null)
  const [isReviewStep, setIsReviewStep] = useState(false)

  const router = useRouter()

  const portalStatesForRequest = request
    ? getPortalStatesForAnalysis({
        routeCorridor: request.route_corridor,
        permitRequiredStates: request.permit_required_states,
      })
    : []

  const applyPortalState = (req: PermitRequest, state: string, opts?: { showLaunchHint?: boolean }) => {
    if (!STATE_PORTAL_CONFIGS[state]) {
      setPageError(`Config for ${state} missing. Add it in lib/portal-assistant.ts (config-driven).`)
      return
    }
    setSelectedState(state)
    setPrefill(generatePortalPrefill(req, state))
    setIsApproved(false)
    setRouteComparison(null)
    setSubmissionRecord(null)
    setApprovalChecked(false)
    setApprovalNotes('')
    setApprovalError(null)
    setCredentialError(null)
    setParseError(null)
    setPdfError(null)

    if (opts?.showLaunchHint) {
      const corridor = (req.route_corridor || []).join(' → ')
      setLaunchHint(
        corridor
          ? `Pre-loaded ${state} — first state in your corridor (${corridor}). Review prefill, then open the portal.`
          : `Pre-loaded ${state} from your saved analysis. Review prefill, then open the portal.`
      )
    }

    void checkCredentialsForState(state)
  }

  // Load auth + optional ?requestId (from History details modal "Launch Portal Assist") or support demo
  useEffect(() => {
    const supabase = createClient()

    const load = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) {
          router.push('/login')
          return
        }
        setUser(session.user)

        // Parse requestId + review step from URL without useSearchParams (avoids extra Suspense)
        let requestId: string | null = null
        let reviewStep = false
        if (typeof window !== 'undefined') {
          const params = new URLSearchParams(window.location.search)
          requestId = params.get('requestId')
          reviewStep = params.get('step') === 'review' || params.get('approved') === '1'
        }

        if (reviewStep) {
          setIsReviewStep(true)
        }

        if (requestId) {
          console.log('[portal-assist] Loading real permit request from History modal Launch Portal Assist:', requestId)
          await loadRealRequest(requestId, session.access_token, { reviewStep })
        } else {
          console.log('[portal-assist] No requestId — ready for demo or manual load.')
        }
      } catch (e: any) {
        console.error('[portal-assist] Auth/init error', e)
        setPageError('Failed to initialize. Please log in again.')
      } finally {
        setLoading(false)
      }
    }

    load()

    // Basic auth listener (consistent with other pages)
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (!session) router.push('/login')
    })
    return () => listener.subscription.unsubscribe()
  }, [router])

  // Load a real saved request (full data incl. equipment/cargo) via client Supabase (RLS enforces ownership)
  const loadRealRequest = async (
    requestId: string,
    accessToken?: string,
    opts?: { reviewStep?: boolean }
  ) => {
    setRequestLoading(true)
    setRequestError(null)
    setPageError(null)

    try {
      const supabase = createClient()
      const { data, error } = await supabase
        .from('permit_requests')
        .select('*')
        .eq('id', requestId)
        .single()

      if (error || !data) {
        throw new Error(error?.message || 'Request not found or access denied')
      }

      const loaded = data as PermitRequest
      setRequest(loaded)
      setPortalOutput('')
      setParsedOutput(null)

      const initialState = resolveInitialPortalState(loaded)
      applyPortalState(loaded, initialState, { showLaunchHint: !opts?.reviewStep })
      if (opts?.reviewStep) {
        setIsReviewStep(true)
      }

      // Load existing submissions for status pills + history
      await loadSubmissionsForRequest(loaded.id)

      console.log('[portal-assist] Loaded real request', loaded.id, 'corridor:', loaded.route_corridor, 'permitStates:', loaded.permit_required_states)
    } catch (e: any) {
      console.error('[portal-assist] loadRealRequest failed', e)
      setRequestError(e.message || 'Could not load permit request.')
      setRequest(null)
    } finally {
      setRequestLoading(false)
    }
  }

  const loadSubmissionsForRequest = async (reqId: string) => {
    try {
      const supabase = createClient()
      const { data } = await supabase
        .from('portal_submissions')
        .select('*')
        .eq('permit_request_id', reqId)
        .order('created_at', { ascending: false })

      const subs = (data || []) as PortalSubmission[]
      setSubmissions(subs)
      console.log('[portal-assist] Loaded', subs.length, 'prior portal submissions for status tracking')
    } catch (e) {
      console.warn('[portal-assist] Could not load prior submissions (non-fatal for status)', e)
    }
  }

  // Demo request with rich equipment/cargo to exercise full prefill + vehicle fields
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
      equipment: {
        unit_number: 'PETE-4721',
        vin: '1XPBDP9X5HD123456',
        axles: 6,
        kingpin_setting_in: 36,
        trailer_length_ft: 53,
      },
      cargo: {
        description: 'Oversized machinery',
        overhang_front_ft: 3,
        overhang_rear_ft: 5,
        carrierDriver: {
          companyName: 'Demo Heavy Haul LLC',
          usdotNumber: '1234567',
          mcNumber: 'MC-482910',
          carrierAddress: '1200 Industrial Blvd, Houston, TX',
          carrierPhone: '713-555-0100',
          carrierEmail: 'dispatch@demoheavyhaul.com',
          driverFullName: 'Alex Rivera',
          cdlNumber: 'TX12345678',
          cdlState: 'TX',
          driverPhone: '713-555-0200',
        },
      },
      distance_miles: 1080,
      duration_hours: 18.5,
    }
    setRequest(demoRequest)
    setPortalOutput('')
    setParsedOutput(null)
    setSubmissions([]) // fresh demo
    setLaunchHint(null)
    applyPortalState(demoRequest, resolveInitialPortalState(demoRequest))
    setAttachedPdfs([])
    setCurrentPdfReference(null)
    setHasCredentials(false)
    setCredUsername('')
    setRequestError(null)

    console.log('[portal-assist] Demo request loaded (rich equipment/cargo for prefill test)')
  }

  // Dynamic state change — works for any in config
  const handleStateChange = (state: string) => {
    setLaunchHint(null)
    if (request) {
      applyPortalState(request, state)
      return
    }
    if (!STATE_PORTAL_CONFIGS[state]) {
      setPageError(`Config for ${state} missing. Add it in lib/portal-assistant.ts (config-driven).`)
      return
    }
    setSelectedState(state)
    setCredentialError(null)
    setParseError(null)
    setPdfError(null)
    void checkCredentialsForState(state)
  }

  // Secure creds check — uses fixed GET that returns only hasCredentials + username
  const checkCredentialsForState = async (stateCode: string) => {
    try {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return

      const res = await fetch(`/api/portal-credentials?state=${stateCode}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })

      if (res.ok) {
        const d = await res.json()
        setHasCredentials(!!d.hasCredentials)
        setCredUsername(d.username || '')
      } else {
        setHasCredentials(false)
        setCredUsername('')
      }
    } catch {
      setHasCredentials(false)
      setCredUsername('')
    }
  }

  // Secure form-based save (replaces old prompt()). Never keeps pw in state after POST.
  const handleSaveCredentials = async (username: string, password: string) => {
    if (!username || !password) {
      setCredentialError('Username and password are required.')
      return
    }

    setSavingCreds(true)
    setCredentialError(null)

    try {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('No session')

      const res = await fetch('/api/portal-credentials', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ stateCode: selectedState, username, password }),
      })

      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(json.error || 'Failed to save credentials securely.')
      }

      setHasCredentials(true)
      setCredUsername(username)
      console.log('[portal-assist] Credentials saved (encrypted server-side) for', selectedState)
      // Clear any form pw fields in parent by not storing them
    } catch (e: any) {
      setCredentialError(e.message || 'Network error while saving credentials.')
    } finally {
      setSavingCreds(false)
    }
  }

  // Prominent HUMAN APPROVAL GATE — records submission with human_approved + status
  const handleApproveGate = async () => {
    if (!prefill || !request) return
    if (!approvalChecked) {
      setApprovalError('Please check the review confirmation box to proceed.')
      return
    }

    setApproving(true)
    setApprovalError(null)

    try {
      const recordBase = createPortalSubmissionRecord(
        request.id,
        selectedState,
        prefill,
        undefined,
        { humanApproved: true }
      )

      const record: PortalSubmissionRecord = {
        ...recordBase,
        status: 'prefilled',
        user_notes: approvalNotes.trim() || null,
        pdf_reference: currentPdfReference,
      }

      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Auth required')

      const res = await fetch('/api/portal-submissions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          ...record,
          record_approval: true,
          raw_portal_output: null,
        }),
      })

      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || 'Failed to record approved prefill submission')
      }

      setIsApproved(true)
      setSubmissionRecord(record)

      // Refresh submissions so pills update immediately (yellow for prefilled)
      if (request) await loadSubmissionsForRequest(request.id)

      console.log('[portal-assist] HUMAN APPROVED + recorded submission for', selectedState, 'human_approved=true')
    } catch (e: any) {
      console.error('[portal-assist] approve gate error', e)
      setApprovalError(e.message || 'Approval record failed.')
    } finally {
      setApproving(false)
    }
  }

  // Parse + Compare using framework. Persists (with human_approved if gate passed). Updates status pills.
  const handleParseOutput = async () => {
    setParseError(null)
    if (!portalOutput.trim() || !request || !prefill) {
      setParseError("Load a request and click 'Regenerate Prefill' in Final Review first.")
      return
    }

    setSavingSubmission(true)

    try {
      const parsed = parsePortalOutput(selectedState, portalOutput)
      setParsedOutput(parsed)

      const comparison = compareRecommendedVsPortalRoute(
        request.route_corridor,
        parsed.route_corridor || []   // note: parser currently doesn't populate route_corridor from text; compare falls back gracefully
      )
      setRouteComparison(comparison)

      // Build record — preserve approval if gate passed
      const base = createPortalSubmissionRecord(
        request.id,
        selectedState,
        prefill,
        { ...parsed, route_corridor: parsed.route_corridor || [] }
      )

      const record: any = {
        ...base,
        human_approved: isApproved,
        pdf_reference: currentPdfReference,
        raw_portal_output: portalOutput,
        // Improve status for pill colors: if parsed approved or we have pdf → green path
        status: (parsed.status === 'approved' || currentPdfReference) ? 'pdf-received' : (isApproved ? 'submitted' : 'submitted'),
      }

      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()

      if (session) {
        const res = await fetch('/api/portal-submissions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`,
          },
          body: JSON.stringify(record),
        })
        if (!res.ok) {
          const j = await res.json().catch(() => ({}))
          console.warn('[portal-assist] persist submission non-fatal:', j.error)
        }
      }

      setSubmissionRecord(record as PortalSubmissionRecord)

      // Refresh for live pill update (green if we set pdf-received etc)
      if (request) await loadSubmissionsForRequest(request.id)

      console.log('[portal-assist] Parsed & compared. similarity=', comparison.similarity, 'rec=', comparison.recommendation)
    } catch (e: any) {
      console.error('[portal-assist] parse error', e)
      setParseError(e.message || 'Parse & compare failed.')
    } finally {
      setSavingSubmission(false)
    }
  }

  // PDF support: upload to Supabase Storage 'portal-pdfs', store path as pdf_reference
  const handlePdfUpload = async (file: File) => {
    if (!file || !file.name.toLowerCase().endsWith('.pdf')) {
      setPdfError('Please select a .pdf file.')
      return
    }
    if (!user) {
      setPdfError('Login required for upload.')
      return
    }

    setPdfUploading(true)
    setPdfError(null)

    try {
      const supabase = createClient()
      const reqId = request?.id || 'demo'
      const safeName = file.name.replace(/[^a-zA-Z0-9_.-]/g, '_')
      const path = `${user.id}/${reqId}/${selectedState}/${Date.now()}-${safeName}`

      const { error: upErr } = await supabase.storage
        .from('portal-pdfs')
        .upload(path, file, { upsert: false, contentType: 'application/pdf' })

      if (upErr) {
        // Graceful: common case = bucket not created or policy missing
        console.error('[portal-assist] Storage upload error (may need bucket creation)', upErr)
        throw new Error(`Upload failed: ${upErr.message}. Create 'portal-pdfs' bucket in Supabase Dashboard (Storage) with RLS policy allowing auth users to upload to their own prefix.`)
      }

      // Get usable URL (prefer signed (1h) over public for security per review; fallback to getPublicUrl)
      let url = ''
      try {
        const signed = await supabase.storage.from('portal-pdfs').createSignedUrl(path, 60 * 60)
        url = signed.data?.signedUrl || ''
      } catch {}
      if (!url) {
        const pub = supabase.storage.from('portal-pdfs').getPublicUrl(path)
        url = pub.data.publicUrl
      }

      // Store local for UI list + current reference for next record
      const newPdf = { name: file.name, url, path }
      setAttachedPdfs(prev => [newPdf, ...prev])
      setCurrentPdfReference(path)

      // If we already have a submission record or approved, optionally update it with pdf ref
      if (submissionRecord || isApproved) {
        try {
          const { data: { session } } = await supabase.auth.getSession()
          if (session && request) {
            await fetch('/api/portal-submissions', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
              body: JSON.stringify({
                permit_request_id: request.id,
                state_code: selectedState,
                status: 'pdf-received',
                human_approved: isApproved,
                pdf_reference: path,
                our_recommended_corridor: prefill?.routeCorridor || [],
                portal_returned_corridor: null,
                route_comparison: routeComparison,
                permit_number: parsedOutput?.permitNumber || null,
                portal_restrictions: parsedOutput?.restrictions || [],
              }),
            })
            await loadSubmissionsForRequest(request.id)
          }
        } catch (e) { console.warn('[portal-assist] pdf update to submission non-fatal', e) }
      }

      console.log('[portal-assist] PDF uploaded to storage:', path)
    } catch (e: any) {
      setPdfError(e.message || 'PDF upload failed.')
    } finally {
      setPdfUploading(false)
    }
  }

  // Helper: get status for a given state code (exact color logic shared with history page; status logic aligned (smallest change; full shared util out of scope for minimal fix))
  const getStateStatus = (st: string): 'red' | 'yellow' | 'green' | 'gray' => {
    const sub = submissions.find(s => s.permit_request_id === request?.id && s.state_code === st)
    if (sub) {
      const sl = (sub.status || '').toLowerCase()
      if (sl.includes('pdf') || sl.includes('received') || sl.includes('complete') || sl.includes('approved')) return 'green'
      if (sl.includes('applied') || sl.includes('apply') || sl.includes('pending') || sl.includes('submit') || sl.includes('prefilled')) return 'yellow'
      return 'gray'
    }
    if ((request?.permit_required_states || []).includes(st)) return 'red'
    return 'gray'
  }

  const getStatusClasses = (status: 'red' | 'yellow' | 'green' | 'gray') => {
    // Mobile outdoor readability: dark text on mid yellow; emerald-700 matches success CTAs
    if (status === 'green') return 'bg-emerald-700 text-white'
    if (status === 'yellow') return 'bg-amber-500 text-gray-900'
    if (status === 'red') return 'bg-red-500 text-white'
    return 'bg-gray-300 text-gray-800'
  }

  const getStatusLabel = (status: 'red' | 'yellow' | 'green' | 'gray', st: string) => {
    if (status === 'green') return 'PDF received'
    if (status === 'yellow') return 'Applied / pending'
    if (status === 'red') return 'Permit needed'
    return st
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <AppHeader />
        <BrandedLoader 
          message="Loading Portal Assistant..." 
          subMessage="Preparing secure prefill, credentials vault, and status tracking"
        />
      </div>
    )
  }

  const config = STATE_PORTAL_CONFIGS[selectedState] || null
  const isRealRequest = !!request && !request.id.startsWith('demo-')
  const loadDisplay = request
    ? formatLoadDisplay({
        weightLbs: request.weight,
        lengthFt: request.length,
        widthFt: request.width,
        heightFt: request.height,
      })
    : null
  const equipmentSnapshot = request
    ? formatPortalEquipmentSnapshot(request.equipment, request.cargo)
    : null
  const carrierDriver = request?.cargo?.carrierDriver as Record<string, any> | undefined
  const carrierFields = formatCarrierReviewFields(carrierDriver)
  const driverFields = formatDriverReviewFields(carrierDriver)
  const loadReview = request
    ? formatLoadReviewDetails(request, request.equipment, request.cargo)
    : null

  const handleRegeneratePrefill = () => {
    if (!request) return
    if (isApproved) {
      const confirmed = window.confirm(
        'Regenerating will clear your approval for this state. Continue?'
      )
      if (!confirmed) return
    }
    applyPortalState(request, selectedState)
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader user={user} />

      <main className="max-w-7xl mx-auto px-6 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-semibold tracking-tight text-gray-900">Portal Assist</h1>
          <p className={`${bodyTextClass} mt-1.5`}>
            Secure prefill, human-approved assisted submission, output parsing, PDF storage, and per-state status tracking for DOT OSOW portals.
          </p>
          <p className={`${fieldHintClass} text-[11px] mt-1`}>
            Config-driven: To add any of the remaining states (or the remaining 49; HI excluded by design), add one entry to <code>STATE_PORTAL_CONFIGS</code> in <code>lib/portal-assistant.ts</code>. Selector, prefill, status, and persistence update automatically. No other code changes required.
          </p>
        </div>

        {/* Global errors */}
        {pageError && (
          <div className="mb-6">
            <ErrorDisplay message={pageError} variant="inline" />
          </div>
        )}

        {isReviewStep && (
          <div className="mb-6 p-4 bg-blue-50 border border-blue-300 sm:border-blue-200 rounded-2xl text-sm text-blue-900">
            <div className="font-semibold mb-0.5">Analysis approved</div>
            <div>Review the prefill below, then record and open portals state by state.</div>
          </div>
        )}

        {launchHint && !isReviewStep && (
          <div className="mb-6 p-4 bg-emerald-50 border border-emerald-300 sm:border-emerald-200 rounded-2xl text-sm text-emerald-900">
            <div className="font-medium mb-0.5">Ready for portal submission</div>
            <div>{launchHint}</div>
          </div>
        )}

        {/* State Selector — fully dynamic from exported config (extensible) */}
        <div className="mb-6">
          <div className={`${sectionLabelClass} mb-2`}>SELECT STATE PORTAL</div>
          <div
            role="button"
            tabIndex={0}
            aria-expanded={isExpanded}
            aria-controls="state-portal-list"
            onClick={() => setIsExpanded(!isExpanded)}
            onFocus={() => setIsExpanded(true)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                setIsExpanded(!isExpanded)
              }
            }}
            className={`w-full max-w-xs ${fieldControlClass} rounded-xl px-3 py-2 text-sm font-medium hover:bg-gray-50 cursor-pointer flex items-center justify-between focus:outline-none focus:ring-2 focus:ring-gray-500 sm:focus:ring-1 sm:focus:ring-gray-400`}
            title="Click or press Enter/Space to expand/collapse the state selector list (compact by default to save space)"
          >
            <span>{selectedState && config ? `${selectedState} — ${config.name}` : 'Select state (49 available)'}</span>
            <span aria-hidden="true" className="text-gray-700 sm:text-gray-500 text-xs">{isExpanded ? '▲' : '▼'}</span>
          </div>
          {isExpanded && (
            <>
              <input
                type="text"
                value={stateQuery}
                onChange={(e) => setStateQuery(e.target.value)}
                className={`mt-1 w-full max-w-xs ${fieldControlClass} rounded-xl px-4 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-gray-500 sm:focus:ring-1 sm:focus:ring-gray-400`}
                placeholder="Type to filter (e.g. CA, New York, NY) — 49 states"
                aria-label="Searchable state portal selector. Type to filter the visible list of all 49 states (except HI) with nice names. Click any entry to select via handleStateChange."
              />
              {/* Filtered list (shown only when expanded for compact-by-default; live filter on type; CODE — Name from STATE_PORTAL_CONFIGS; click selects via handleStateChange + auto-collapses) */}
              <div id="state-portal-list" className="mt-1 w-full max-w-xs border border-gray-500 sm:border-gray-300 rounded-xl bg-white shadow-sm max-h-52 overflow-y-auto text-xs text-gray-900">
                {allStateCodes
                  .filter((state) => {
                    if (!stateQuery) return true
                    const c = STATE_PORTAL_CONFIGS[state]
                    const q = stateQuery.toUpperCase()
                    return state.includes(q) || (c?.name || '').toUpperCase().includes(q)
                  })
                  .map((state) => {
                    const c = STATE_PORTAL_CONFIGS[state]
                    const display = `${state} — ${c.name}`
                    const isCurrent = state === selectedState
                    return (
                      <div
                        key={state}
                        onClick={() => {
                          handleStateChange(state)
                          setStateQuery('')
                          setIsExpanded(false)
                        }}
                        className={`px-3 py-1 cursor-pointer hover:bg-gray-100 font-mono border-b border-gray-300 sm:border-gray-200 last:border-b-0 ${isCurrent ? 'bg-gray-100 font-semibold' : ''}`}
                        title={`Select ${display}`}
                      >
                        {display}
                      </div>
                    )
                  })}
                {stateQuery && allStateCodes.filter((s) => {
                  const c = STATE_PORTAL_CONFIGS[s]
                  const q = stateQuery.toUpperCase()
                  return s.includes(q) || (c?.name || '').toUpperCase().includes(q)
                }).length === 0 && (
                  <div className={`px-3 py-1 ${fieldHintClass}`}>No matches. Clear to see all 49.</div>
                )}
              </div>
              <div className="text-[10px] text-emerald-800 sm:text-emerald-700 mt-1">49 states supported (all except HI). Extensible with one object. Compact header by default — click/focus to expand list (filter/scroll/click). Selection auto-collapses + updates right panel immediately.</div>
            </>
          )}
        </div>

        <div className="grid lg:grid-cols-12 gap-6">
          {/* LEFT COLUMN: Request Summary + Final Review */}
          <div className="lg:col-span-7 space-y-6">
            {/* 1. Request Summary — compact high-level overview only */}
            <div className={cardClass}>
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-semibold text-gray-900">1. Request Summary</h2>
                {!isRealRequest && !request && (
                  <button
                    onClick={loadDemoRequest}
                    className={`text-sm px-4 py-1.5 ${buttonPrimaryClass}`}
                  >
                    Load Rich Demo Request
                  </button>
                )}
              </div>

              {requestLoading && <div className={`text-sm ${fieldHintClass}`}>Loading request…</div>}
              {requestError && <ErrorDisplay message={requestError} variant="inline" onRetry={() => { /* re-trigger via url if wanted */ }} />}

              {!request ? (
                <div className={`text-sm ${bodyTextClass}`}>
                  No request loaded. Click "Load Rich Demo Request" above, or open this page from <a href="/history" className="underline text-gray-900">History</a> via View → Launch Portal Assist in the analysis details modal (passes ?requestId).
                </div>
              ) : (
                <div className="text-sm space-y-3">
                  <div>
                    <span className={`${fieldLabelClass} block`}>ROUTE</span>
                    <span className="font-medium text-gray-900">{request.origin_city}, {request.origin_state} → {request.destination_city}, {request.destination_state}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-x-6">
                    <div>
                      <span className={`${fieldLabelClass} block`}>LOAD ENVELOPE</span>
                      <span className="font-mono tabular-nums text-gray-900">{loadDisplay?.weight} — {loadDisplay?.dimensionsLine}</span>
                    </div>
                    <div>
                      <span className={`${fieldLabelClass} block`}>CORRIDOR</span>
                      <span className="font-mono text-gray-900">{(request.route_corridor || []).join(' → ') || '—'}</span>
                    </div>
                  </div>

                  {request.permit_required_states && request.permit_required_states.length > 0 && (
                    <div>
                      <span className={`${fieldLabelClass} block`}>PERMITS REQUIRED IN</span>
                      <span className="font-medium text-red-700">{request.permit_required_states.join(', ')}</span>
                    </div>
                  )}

                  <div className="pt-2 border-t border-gray-300 sm:border-gray-200">
                    <div className="flex items-center justify-between mb-2">
                      <span className={fieldLabelClass}>PER-STATE STATUS (corridor)</span>
                      <span className={fieldHintTinyClass}>Red = needed • Yellow = applied • Green = PDF</span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {(portalStatesForRequest.length > 0 ? portalStatesForRequest : (request.route_corridor || request.permit_required_states || [])).map((st: string, i: number) => {
                        const stStatus = getStateStatus(st)
                        return (
                          <span
                            key={i}
                            onClick={() => handleStateChange(st)}
                            className={`px-2 py-px text-[10px] rounded font-mono cursor-pointer border border-transparent ${getStatusClasses(stStatus)} ${selectedState === st ? 'ring-2 ring-offset-1 ring-black' : ''}`}
                            title={getStatusLabel(stStatus, st)}
                          >
                            {st}
                          </span>
                        )
                      })}
                    </div>
                    <div className="mt-2 text-xs">
                      Selected: <span className={`inline px-1.5 py-px rounded font-mono ${getStatusClasses(getStateStatus(selectedState))}`}>{selectedState}</span>
                      {' '}
                      <span className={bodyTextClass}>{getStatusLabel(getStateStatus(selectedState), selectedState)}</span>
                    </div>
                  </div>

                  {isRealRequest && (
                    <div className="text-[10px] text-emerald-800 sm:text-emerald-700">Loaded from saved analysis (full snapshots available in final review below)</div>
                  )}
                  {!isRealRequest && request && (
                    <div className="text-[10px] text-amber-800 sm:text-amber-700">Demo data — use final review below to verify prefill before portal entry</div>
                  )}
                </div>
              )}
            </div>

            {/* 2. Final Review — generated prefill + carrier/driver/load/equipment before portal submission */}
            {prefill && config && (
              <div className={cardClass}>
                <h2 className="font-semibold text-gray-900">2. Final Review — Generated Prefill for {config.name}</h2>
                <p className={`text-sm ${bodyTextClass} mt-1 mb-4`}>
                  Last human review before portal submission. Confirm carrier, driver, load, and equipment match what you will enter in the state portal.
                </p>

                <div className="mb-4">
                  <span className={`${fieldLabelClass} block mb-2`}>CARRIER INFO</span>
                  {carrierFields.length > 0 ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                      {carrierFields.map((f) => (
                        <div key={f.label}>
                          <span className={fieldLabelTinyClass}>{f.label}</span>
                          <div className="font-medium text-gray-900">{f.value}</div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className={`text-sm italic ${fieldHintClass}`}>No carrier info saved with this request.</div>
                  )}
                </div>

                <div className="mb-4">
                  <span className={`${fieldLabelClass} block mb-2`}>DRIVER</span>
                  {driverFields.length > 0 ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                      {driverFields.map((f) => (
                        <div key={f.label}>
                          <span className={fieldLabelTinyClass}>{f.label}</span>
                          <div className="font-medium text-gray-900">{f.value}</div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className={`text-sm italic ${fieldHintClass}`}>No driver info saved with this request.</div>
                  )}
                </div>

                {loadReview && (
                  <div className="mb-4">
                    <span className={`${fieldLabelClass} block mb-2`}>FULL LOAD DETAILS</span>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                      <div>
                        <span className={fieldLabelTinyClass}>Weight</span>
                        <div className="font-mono tabular-nums font-medium text-gray-900">{loadReview.weight}</div>
                      </div>
                      <div>
                        <span className={fieldLabelTinyClass}>L × W × H</span>
                        <div className="font-mono tabular-nums font-medium text-gray-900">{loadReview.dimensionsLine}</div>
                      </div>
                      {loadReview.overhang && (
                        <div>
                          <span className={fieldLabelTinyClass}>Overhang</span>
                          <div className="font-medium text-gray-900">{loadReview.overhang}</div>
                        </div>
                      )}
                      {loadReview.cargoDescription && (
                        <div>
                          <span className={fieldLabelTinyClass}>Cargo description</span>
                          <div className="font-medium text-gray-900">{loadReview.cargoDescription}</div>
                        </div>
                      )}
                      {loadReview.numberOfPieces && (
                        <div>
                          <span className={fieldLabelTinyClass}>Pieces</span>
                          <div className="font-medium text-gray-900">{loadReview.numberOfPieces}</div>
                        </div>
                      )}
                      {loadReview.loadedArrangement && (
                        <div>
                          <span className={fieldLabelTinyClass}>Loaded</span>
                          <div className="font-medium text-gray-900">{loadReview.loadedArrangement}</div>
                        </div>
                      )}
                      {loadReview.moveType && (
                        <div>
                          <span className={fieldLabelTinyClass}>Move</span>
                          <div className="font-medium text-gray-900">{loadReview.moveType}</div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {equipmentSnapshot?.hasContent && (
                  <div className="mb-4 space-y-2">
                    <span className={`${fieldLabelClass} block`}>TRACTOR &amp; TRAILER</span>
                    {equipmentSnapshot.rigLine && (
                      <div>
                        <span className={fieldLabelTinyClass}>Rig</span>
                        <div className="font-medium text-sm text-gray-900">{equipmentSnapshot.rigLine}</div>
                      </div>
                    )}
                    {equipmentSnapshot.tractorLine && (
                      <div>
                        <span className={fieldLabelTinyClass}>Tractor</span>
                        <div className="font-medium text-sm text-gray-900">{equipmentSnapshot.tractorLine}</div>
                      </div>
                    )}
                    {equipmentSnapshot.trailerLines.length > 0 && (
                      <div>
                        <span className={fieldLabelTinyClass}>
                          Trailer{equipmentSnapshot.trailerLines.length > 1 ? 's' : ''}
                        </span>
                        <ul className="font-medium text-sm space-y-0.5 text-gray-900">
                          {equipmentSnapshot.trailerLines.map((line, i) => (
                            <li key={i}>{line}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {equipmentSnapshot.legacyLine && (
                      <div className="font-medium text-sm text-gray-900">{equipmentSnapshot.legacyLine}</div>
                    )}
                  </div>
                )}

                <span className={`${fieldLabelClass} block mb-2`}>PORTAL FIELD MAPPING</span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                  {Object.entries(config.fieldMapping).map(([ourKey, portalLabel]) => (
                    <div key={ourKey} className="rounded-xl border border-gray-500 sm:border-gray-300 bg-gray-50 p-3">
                      <div className={`${fieldLabelTinyClass} mb-0.5`}>{portalLabel}</div>
                      <div className="font-mono break-words text-gray-900">{(prefill.generatedFields as any)[ourKey] ?? '—'}</div>
                    </div>
                  ))}
                  {/* Extra rich fields pulled from equipment/cargo */}
                  {(prefill.generatedFields as any).axles && (
                    <div className="rounded-xl border border-gray-500 sm:border-gray-300 bg-gray-50 p-3">
                      <div className={`${fieldLabelTinyClass} mb-0.5`}>Axles (from equip)</div>
                      <div className="font-mono text-gray-900">{(prefill.generatedFields as any).axles}</div>
                    </div>
                  )}
                  {(prefill.generatedFields as any).vehicle_id && (
                    <div className="rounded-xl border border-gray-500 sm:border-gray-300 bg-gray-50 p-3">
                      <div className={`${fieldLabelTinyClass} mb-0.5`}>Vehicle / VIN (from equip)</div>
                      <div className="font-mono text-gray-900">{(prefill.generatedFields as any).vehicle_id}</div>
                    </div>
                  )}
                </div>

                {prefill.approvalNotes && prefill.approvalNotes.length > 0 && (
                  <div className="mt-4 p-3 bg-amber-50 border border-amber-300 sm:border-amber-200 rounded-xl text-sm">
                    <div className="font-medium text-amber-900 sm:text-amber-800 mb-1">Notes from prefill generator</div>
                    <ul className="list-disc pl-5 text-amber-800 sm:text-amber-700 text-sm">
                      {prefill.approvalNotes.map((n: string, i: number) => <li key={i}>{n}</li>)}
                    </ul>
                  </div>
                )}

                {/* 3. Credentials — nice form, secure, hasCredentials check, never plain pw */}
                <div className="mt-6 pt-6 border-t border-gray-300 sm:border-gray-200">
                  <h3 className="font-semibold mb-2 text-sm text-gray-900">3. Portal Credentials (encrypted at rest)</h3>
                  {hasCredentials ? (
                    <div className="text-sm mb-3 text-emerald-800 sm:text-emerald-700">✓ Credentials saved for {selectedState} (username: {credUsername || 'saved'})</div>
                  ) : (
                    <div className={`text-sm mb-3 ${bodyTextClass}`}>No credentials on file for {selectedState}.</div>
                  )}

                  {/* Simple secure form (no prompt()) */}
                  <div className="flex flex-col sm:flex-row gap-2">
                    <input
                      type="text"
                      placeholder="Portal username"
                      className={`flex-1 ${inputClass}`}
                      id="cred-username"
                      autoComplete="off"
                    />
                    <input
                      type="password"
                      placeholder="Portal password"
                      className={`flex-1 ${inputClass}`}
                      id="cred-password"
                      autoComplete="new-password"
                    />
                    <button
                      onClick={() => {
                        const u = (document.getElementById('cred-username') as HTMLInputElement)?.value?.trim()
                        const p = (document.getElementById('cred-password') as HTMLInputElement)?.value
                        if (u && p) {
                          handleSaveCredentials(u, p)
                          // clear fields after attempt
                          ;(document.getElementById('cred-username') as HTMLInputElement).value = ''
                          ;(document.getElementById('cred-password') as HTMLInputElement).value = ''
                        } else {
                          setCredentialError('Enter both username and password.')
                        }
                      }}
                      disabled={savingCreds}
                      className={`px-4 py-2 ${buttonPrimaryClass}`}
                    >
                      {savingCreds ? 'Saving…' : 'Save Securely'}
                    </button>
                  </div>

                  {credentialError && (
                    <div className="mt-2">
                      <ErrorDisplay message={credentialError} variant="inline" onRetry={() => setCredentialError(null)} />
                    </div>
                  )}
                  <p className={`${fieldHintTinyClass} mt-1`}>Encrypted server-side with AES-256-GCM. Never sent or stored in plain text. GET returns metadata only.</p>
                </div>

                {/* Human approval gate + action row */}
                <div className="mt-6 pt-6 border-t border-gray-300 sm:border-gray-200">
                  <h3 className="font-semibold mb-2 text-sm text-gray-900">Record approval for {selectedState}</h3>

                  {!isApproved ? (
                    <div className="p-4 bg-amber-50 border border-amber-300 sm:border-amber-200 rounded-2xl">
                      <label className="flex items-start gap-3 text-sm text-gray-900 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={approvalChecked}
                          onChange={(e) => setApprovalChecked(e.target.checked)}
                          className="mt-1 h-4 w-4 accent-emerald-700 border-gray-500"
                        />
                        <span>
                          I have personally reviewed the prefill data (dimensions, corridor, vehicle/equipment details, state-specific notes), the target portal instructions, and any route differences. I approve this for portal submission on behalf of the carrier.
                        </span>
                      </label>

                      <textarea
                        value={approvalNotes}
                        onChange={(e) => setApprovalNotes(e.target.value)}
                        placeholder="Optional notes for audit (e.g. reviewed bridge list 2026-06-07)"
                        className={`mt-3 w-full ${textareaClass} h-16`}
                      />

                      <div className="mt-3 flex flex-col sm:flex-row gap-2">
                        <button
                          onClick={handleRegeneratePrefill}
                          disabled={!request}
                          className={`px-5 py-2 ${buttonSecondaryClass}`}
                        >
                          Regenerate Prefill
                        </button>
                        <button
                          onClick={handleApproveGate}
                          disabled={!approvalChecked || approving || !prefill}
                          className={`px-5 py-2 ${buttonSuccessClass} rounded-xl`}
                        >
                          {approving ? 'Recording approval…' : `Approve & Record for ${selectedState} Submission`}
                        </button>
                      </div>
                      {approvalError && (
                        <div className="mt-2">
                          <ErrorDisplay message={approvalError} variant="inline" onRetry={() => setApprovalError(null)} />
                        </div>
                      )}
                      <div className="text-[10px] text-amber-800 sm:text-amber-700 mt-2">This sets human_approved=true and creates/updates the portal_submissions record (status prefilled/submitted). No automated submit occurs.</div>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="p-3 bg-emerald-50 border border-emerald-300 sm:border-emerald-200 rounded-xl text-sm text-emerald-900 sm:text-emerald-800">
                        ✓ Human approved for {selectedState}. Record created with human_approved=true.
                      </div>
                      <button
                        onClick={handleRegeneratePrefill}
                        disabled={!request}
                        className={`px-5 py-2 ${buttonSecondaryClass}`}
                      >
                        Regenerate Prefill
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* RIGHT COLUMN: Portal + Output + PDF + Analysis */}
          <div className="lg:col-span-5 space-y-6">
            {/* Portal Actions */}
            {config && (
              <div className={cardClass}>
                <h2 className="font-semibold mb-3 text-gray-900">{config.name} Portal</h2>
                <a
                  href={config.portalUrl}
                  target="_blank"
                  rel="noreferrer"
                  className={`inline-block text-sm px-4 py-2 ${buttonPrimaryClass} mb-3`}
                >
                  Open Real {selectedState} Portal →
                </a>
                {!request && (
                  <button
                    onClick={loadDemoRequest}
                    className={`inline-block px-4 py-2 ${buttonSuccessClass} rounded-lg mb-3 ml-2`}
                  >
                    Load Rich Demo Request for {selectedState}
                  </button>
                )}
                <p className={`text-sm ${bodyTextClass} whitespace-pre-wrap`}>{config.instructions}</p>
                {config.typicalRestrictions && config.typicalRestrictions.length > 0 && (
                  <div className="mt-3 text-xs text-amber-800 sm:text-amber-700">
                    Typical restrictions: {config.typicalRestrictions.join(' • ')}
                  </div>
                )}
                {isApproved && (
                  <div className="mt-3 p-3 bg-emerald-50 border border-emerald-300 sm:border-emerald-200 rounded text-xs text-emerald-900">Approved — ready for your manual entry or paste of portal response below.</div>
                )}
              </div>
            )}

            {/* 4. Output Paste & Analysis */}
            <div className={cardClass}>
              <h2 className="font-semibold mb-3 text-gray-900">4. Portal Output Paste &amp; Analysis</h2>
              <textarea
                value={portalOutput}
                onChange={(e) => setPortalOutput(e.target.value)}
                placeholder="Paste confirmation email/text, permit number, status, restrictions, or route notes returned by the state portal (e.g. 'PERMIT #TX-OSOW-987654 APPROVED. Route: TX-OK-MO-IL ...')"
                className={`w-full ${fieldControlClass} p-3 rounded-xl text-sm min-h-[110px] font-mono`}
              />
              <button
                onClick={handleParseOutput}
                disabled={!prefill || savingSubmission}
                className={`mt-2 px-5 py-2 ${buttonPrimaryClass} rounded-xl`}
              >
                {savingSubmission ? 'Parsing &amp; Recording…' : 'Parse & Compare'}
              </button>

              {parseError && <div className="mt-2"><ErrorDisplay message={parseError} variant="inline" /></div>}

              {routeComparison && (
                <div className="mt-4 p-4 bg-gray-50 border border-gray-300 sm:border-gray-200 rounded-2xl text-sm text-gray-900">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="font-semibold text-gray-900">Route Comparison</div>
                    <span className="font-mono text-xl font-bold tabular-nums text-gray-900">{routeComparison.similarity}%</span>
                    <span className={`px-2 py-0.5 rounded text-xs font-semibold uppercase tracking-wider ${
                      routeComparison.recommendation === 'accept' ? 'bg-emerald-100 text-emerald-800' :
                      routeComparison.recommendation === 'review' ? 'bg-yellow-100 text-yellow-800' :
                      'bg-red-100 text-red-800'
                    }`}>{routeComparison.recommendation}</span>
                  </div>
                  <div className={bodyTextClass}>{routeComparison.notes}</div>

                  {routeComparison.differences.length > 0 && (
                    <div className="mt-2">
                      <div className={`font-medium mb-1 ${fieldLabelClass}`}>DIFFS FLAGGED</div>
                      <ul className="list-disc pl-5 text-xs text-gray-800 sm:text-gray-700 space-y-0.5">
                        {routeComparison.differences.map((d, i) => <li key={i}>{d}</li>)}
                      </ul>
                    </div>
                  )}

                  {submissionRecord && (
                    <div className={`mt-3 pt-3 border-t border-gray-300 sm:border-gray-200 ${fieldHintTinyClass}`}>
                      Submission persisted (status: {submissionRecord.status}, human_approved: {String(submissionRecord.human_approved)})
                    </div>
                  )}
                </div>
              )}

              {parsedOutput && (
                <div className={`mt-3 text-xs ${bodyTextClass} border-t border-gray-300 sm:border-gray-200 pt-3`}>
                  Parsed: permit #{parsedOutput.permitNumber || '—'} • status {parsedOutput.status} • restrictions: {(parsedOutput.restrictions || []).length}
                </div>
              )}
            </div>

            {/* 5. PDF & Artifacts */}
            <div className={cardClass}>
              <h2 className="font-semibold mb-3 text-gray-900">5. PDF &amp; Artifacts</h2>

              <label className={`inline-flex items-center gap-2 px-4 py-2 ${buttonSecondaryClass} cursor-pointer`}>
                <input
                  type="file"
                  accept="application/pdf"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) handlePdfUpload(f)
                    e.target.value = '' // reset
                  }}
                  disabled={pdfUploading}
                />
                {pdfUploading ? 'Uploading to secure storage…' : 'Upload Permit PDF (to portal-pdfs bucket)'}
              </label>

              {pdfError && <div className="mt-2"><ErrorDisplay message={pdfError} variant="inline" /></div>}

              {attachedPdfs.length > 0 && (
                <div className="mt-4 space-y-2">
                  {attachedPdfs.map((p, idx) => (
                    <div key={idx} className="flex items-center justify-between text-sm border border-gray-500 sm:border-gray-300 rounded-lg px-3 py-2 bg-gray-50 text-gray-900">
                      <span className="truncate pr-2">{p.name}</span>
                      <a
                        href={p.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-emerald-700 underline text-xs"
                      >
                        Download / View
                      </a>
                    </div>
                  ))}
                  <div className={fieldHintTinyClass}>PDF reference stored with next submission record (used for status green + audit).</div>
                </div>
              )}

              {!attachedPdfs.length && (
                <div className={`${fieldHintClass} mt-2`}>No PDFs attached yet for this state. Upload after portal response for full record.</div>
              )}
            </div>

            {/* Current submission record summary */}
            {submissionRecord && (
              <div className={cardMetaClass}>
                <div className="font-semibold mb-1 text-gray-900">Latest Submission Record (local + persisted)</div>
                <div>State: {submissionRecord.state_code} • Status: {submissionRecord.status} • Approved: {String(submissionRecord.human_approved)}</div>
                {submissionRecord.permit_number && <div>Permit #: {submissionRecord.permit_number}</div>}
                {submissionRecord.pdf_reference && <div>PDF ref: {submissionRecord.pdf_reference}</div>}
              </div>
            )}
          </div>
        </div>

        <div className={`mt-8 text-xs ${fieldHintClass} border-t border-gray-300 sm:border-gray-200 pt-4`}>
          All actions are logged with [portal-assist] prefix. Credentials use server-only AES (env PORTAL_CREDENTIALS_ENCRYPTION_KEY). Human approval gate is enforced before any submission record with human_approved. Full backward compatibility with existing history links, submissions table, and RLS.
        </div>
      </main>
    </div>
  )
}
