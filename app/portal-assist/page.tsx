'use client'

import { useState, useEffect, useRef } from 'react'
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
  openStatePortals,
  resolveInitialPortalState,
  buildPortalClipboardPacket,
  buildPortalCompletenessChecklist,
  resolvePortalFieldLabel,
  VEHICLE_IDENTITY_PREFILL_KEYS,
  hasPrefillValue,
  PORTAL_TRIP_TYPES,
  buildMoFilingSteps,
  buildMoFilingStepClipboard,
  getMoPortalFieldLabel,
  getMoStepPrefillKeysWithValues,
  isMoMultiStatePrefill,
  MO_PAY_LAST_NOTE,
  MO_FEE_DISPLAY_NOTE,
  type RouteComparison,
  type PortalSubmissionRecord,
  type PrefillPackage,
  type PortalTripType,
  type MoFilingStep,
} from '@/lib/portal-assistant'
import { getPlaybook } from '@/lib/portal-playbooks'
import { formatLoadDisplay } from '@/lib/parse-dimension'
import {
  formatPortalAddress,
  resolvePortalAddressParts,
} from '@/lib/format-address'
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
  /** Full NL query / resolved street when saved with the request. */
  origin_query?: string | null
  destination_query?: string | null
  origin_street?: string | null
  destination_street?: string | null
  origin_zip?: string | null
  destination_zip?: string | null
  /** Nested loadDetails-style stops when present. */
  origin?: {
    query?: string
    street?: string
    city?: string
    state?: string
    zip?: string
  } | null
  destination?: {
    query?: string
    street?: string
    city?: string
    state?: string
    zip?: string
  } | null
  weight: number
  length: number
  width: number
  height: number
  route_corridor: string[] | null
  permit_required_states: string[] | null
  /** Geometry-aligned border crossings (snake_case DB-style or camelCase agent-style). */
  border_crossings?: Array<{
    fromState: string
    toState: string
    entry: { lat: number; lon: number; highway?: string }
    exit: { lat: number; lon: number; highway?: string }
  }> | null
  borderCrossings?: Array<{
    fromState: string
    toState: string
    entry: { lat: number; lon: number; highway?: string }
    exit: { lat: number; lon: number; highway?: string }
  }> | null
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
 * Portal Assist — prefill, credentials, approval gate, portal launch, output parse, PDF artifacts.
 * State list is config-driven via STATE_PORTAL_CONFIGS (49 states; HI excluded).
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
/** Soft muted tone for hints (size applied at call site or via fieldHintClass) */
const fieldHintToneClass = 'text-gray-500'
/** Hints/instructions: softer gray-500 so chrome does not compete with content */
const fieldHintClass = `text-xs ${fieldHintToneClass}`
const fieldHintTinyClass = `text-[10px] ${fieldHintToneClass}`
/** Section field labels stay slightly stronger than pure hints (matches permit-test hierarchy) */
const fieldLabelClass = 'text-xs text-gray-600 sm:text-gray-500'
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
  /**
   * Per-state force re-prompt after regenerate / trip-type change.
   * Survives state switch until that state is re-approved (not cleared by applyPortalState).
   */
  const [forceReapproveStates, setForceReapproveStates] = useState<ReadonlySet<string>>(
    () => new Set()
  )

  const addForceReapprove = (st: string) => {
    setForceReapproveStates((prev) => {
      if (prev.has(st)) return prev
      const next = new Set(prev)
      next.add(st)
      return next
    })
  }

  const removeForceReapprove = (st: string) => {
    setForceReapproveStates((prev) => {
      if (!prev.has(st)) return prev
      const next = new Set(prev)
      next.delete(st)
      return next
    })
  }

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
  /**
   * Corridor states checked for bulk "Approve selected states".
   * Defaults to all portalStatesForRequest when a request loads; user may uncheck.
   */
  const [bulkSelectedStates, setBulkSelectedStates] = useState<ReadonlySet<string>>(
    () => new Set()
  )

  const [parseError, setParseError] = useState<string | null>(null)
  const [savingSubmission, setSavingSubmission] = useState(false)
  const [launchHint, setLaunchHint] = useState<string | null>(null)
  /** Post-click feedback under Launch all (separate from pre-load launchHint). */
  const [corridorLaunchHint, setCorridorLaunchHint] = useState<string | null>(null)
  const [isReviewStep, setIsReviewStep] = useState(false)

  /** Filing kit: trip type for prefill + copy packet (default Single trip). */
  const [tripType, setTripType] = useState<PortalTripType>('Single trip')
  /** Which copy control last succeeded (`all` or field key) — brief "Copied" feedback. */
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  /** Clipboard status for aria-live (success or fail). */
  const [copyStatus, setCopyStatus] = useState<string | null>(null)
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** Portal launch panel — scroll/focus target after Approve & Record. */
  const portalLaunchPanelRef = useRef<HTMLDivElement | null>(null)
  const portalLaunchHeadingRef = useRef<HTMLHeadingElement | null>(null)

  const router = useRouter()

  // Clear copy feedback timer on unmount
  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current)
    }
  }, [])

  const portalStatesForRequest = request
    ? getPortalStatesForAnalysis({
        routeCorridor: request.route_corridor,
        permitRequiredStates: request.permit_required_states,
      })
    : []

  // Default bulk checklist to full corridor when request loads (or corridor identity changes).
  useEffect(() => {
    if (!request) {
      setBulkSelectedStates(new Set())
      return
    }
    setBulkSelectedStates(new Set(portalStatesForRequest))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally reset on request id / corridor join only
  }, [request?.id, portalStatesForRequest.join(',')])

  /**
   * Single source of truth for human approval of a state:
   * current-session gate (isApproved + selected) OR submissions.human_approved.
   * forceReapproveStates (per state) suppresses DB approval after regenerate / trip-type change
   * until that state is re-approved — survives switch away/back.
   * Used for pills, gate UX, post-approve hint, and persist paths.
   */
  const isStateHumanApproved = (st: string): boolean => {
    if (forceReapproveStates.has(st)) return false
    if (st === selectedState && isApproved) return true
    const sub = submissions.find(
      (s) => s.permit_request_id === request?.id && s.state_code === st
    )
    return !!sub?.human_approved
  }

  // Corridor/permit states first (origin → destination), then remaining configs A–Z.
  const corridorStateSet = new Set(portalStatesForRequest)
  const orderedStateCodes = [
    ...portalStatesForRequest.filter((s) => STATE_PORTAL_CONFIGS[s]),
    ...allStateCodes
      .filter((s) => !corridorStateSet.has(s))
      .sort((a, b) => a.localeCompare(b)),
  ]
  const filteredStateCodes = orderedStateCodes.filter((state) => {
    if (!stateQuery) return true
    const c = STATE_PORTAL_CONFIGS[state]
    const q = stateQuery.toUpperCase()
    return state.includes(q) || (c?.name || '').toUpperCase().includes(q)
  })

  const applyPortalState = (
    req: PermitRequest,
    state: string,
    opts?: { showLaunchHint?: boolean; resetTripType?: boolean }
  ) => {
    if (!STATE_PORTAL_CONFIGS[state]) {
      setPageError(`Config for ${state} missing. Add it in lib/portal-assistant.ts (config-driven).`)
      return
    }
    const effectiveTripType: PortalTripType = opts?.resetTripType ? 'Single trip' : tripType
    if (opts?.resetTripType) {
      setTripType('Single trip')
      // New request load — clear all per-state re-prompt overrides
      setForceReapproveStates(new Set())
    }
    setSelectedState(state)
    setPrefill(generatePortalPrefill(req, state, { tripType: effectiveTripType }))
    setIsApproved(false)
    // Do not clear forceReapproveStates on state switch — per-state overrides must stick
    setRouteComparison(null)
    setSubmissionRecord(null)
    setApprovalChecked(false)
    setApprovalNotes('')
    setApprovalError(null)
    setCredentialError(null)
    setParseError(null)
    setPdfError(null)
    setCopiedKey(null)
    setCopyStatus(null)

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
      // New request → reset trip type to Single trip
      applyPortalState(loaded, initialState, {
        showLaunchHint: !opts?.reviewStep,
        resetTripType: true,
      })
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
      // Sample geometry-aligned crossings so demo portal prefill shows entry/exit
      border_crossings: [
        {
          fromState: 'TX',
          toState: 'OK',
          entry: { lat: 33.84, lon: -96.66, highway: 'US-75' },
          exit: { lat: 36.75, lon: -96.0, highway: 'US-75' },
        },
        {
          fromState: 'OK',
          toState: 'MO',
          entry: { lat: 36.99, lon: -94.62, highway: 'I-44' },
          exit: { lat: 38.5, lon: -90.5, highway: 'I-44' },
        },
        {
          fromState: 'MO',
          toState: 'IL',
          entry: { lat: 38.63, lon: -90.18, highway: 'I-55' },
          exit: { lat: 41.8, lon: -87.7, highway: 'I-55' },
        },
      ],
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
    applyPortalState(demoRequest, resolveInitialPortalState(demoRequest), {
      resetTripType: true,
    })
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

  /** Explicit user action: open all corridor state portals after reviewing prefill. */
  const handleLaunchCorridorPortals = () => {
    if (!request || portalStatesForRequest.length === 0) return
    const states = portalStatesForRequest
    openStatePortals(states, { staggerMs: 0 })
    const n = states.length
    setCorridorLaunchHint(
      `Opened ${n} corridor portal tab${n === 1 ? '' : 's'}.`
    )
  }

  /** Open one state portal tab + same feedback strip as Launch all. */
  const handleOpenStatePortal = (st: string) => {
    openStatePortals([st], { staggerMs: 0 })
    setCorridorLaunchHint(`Opened ${st} portal tab.`)
  }

  /**
   * After approve success: wait for layout (gate collapses), then scroll/focus launch panel.
   * Respects prefers-reduced-motion; no auto-open of portal tabs.
   */
  const scrollFocusPortalLaunch = () => {
    const reduceMotion =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const behavior: ScrollBehavior = reduceMotion ? 'auto' : 'smooth'
    const run = () => {
      portalLaunchPanelRef.current?.scrollIntoView({ behavior, block: 'start' })
      const openBtn = document.querySelector<HTMLElement>(
        `[data-testid="open-portal-${selectedState}"]`
      )
      if (openBtn) {
        openBtn.focus({ preventScroll: true })
      } else {
        portalLaunchHeadingRef.current?.focus({ preventScroll: true })
      }
    }
    // Double rAF so isApproved re-render paints before measuring scroll target
    requestAnimationFrame(() => {
      requestAnimationFrame(run)
    })
  }

  /**
   * Shared POST path for human approval of one state.
   * Used by single-state gate and bulk "Approve selected states" — keeps payloads identical.
   * Always generates/records per-state prefill (borders/entry/exit differ by state).
   */
  const recordStateApproval = async (
    stateCode: string,
    prefillPkg: PrefillPackage,
    opts?: { notes?: string }
  ): Promise<PortalSubmissionRecord> => {
    if (!request) throw new Error('No request loaded')

    const recordBase = createPortalSubmissionRecord(
      request.id,
      stateCode,
      prefillPkg,
      undefined,
      { humanApproved: true }
    )

    const record: PortalSubmissionRecord = {
      ...recordBase,
      status: 'prefilled',
      user_notes: (opts?.notes ?? approvalNotes).trim() || null,
      pdf_reference: currentPdfReference,
    }

    const supabase = createClient()
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) throw new Error('Auth required')

    const res = await fetch('/api/portal-submissions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
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

    return record
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
      const record = await recordStateApproval(selectedState, prefill, {
        notes: approvalNotes,
      })

      setIsApproved(true)
      removeForceReapprove(selectedState)
      setSubmissionRecord(record)

      // Refresh submissions so pills update immediately (yellow for prefilled)
      if (request) await loadSubmissionsForRequest(request.id)

      console.log('[portal-assist] HUMAN APPROVED + recorded submission for', selectedState, 'human_approved=true')

      // Snap focus to portal launch area so user is not stranded on the approval banner
      scrollFocusPortalLaunch()
    } catch (e: any) {
      console.error('[portal-assist] approve gate error', e)
      setApprovalError(e.message || 'Approval record failed.')
    } finally {
      setApproving(false)
    }
  }

  /**
   * Bulk approve: one review gate, per-state generatePortalPrefill + recordStateApproval.
   * Skips already human-approved states (idempotent). No auto-open of portal tabs.
   */
  const handleBulkApproveSelected = async () => {
    if (!request) return
    if (!approvalChecked) {
      setApprovalError('Please check the review confirmation box to proceed.')
      return
    }

    // Batch payload = corridor states still checked by the user
    const selected = portalStatesForRequest.filter((st) => bulkSelectedStates.has(st))
    if (selected.length === 0) {
      setApprovalError('Select at least one state to approve.')
      return
    }

    // Skip states already human-approved (session + submissions; force-reapprove still needs POST)
    const toApprove = selected.filter((st) => !isStateHumanApproved(st))
    if (toApprove.length === 0) {
      setApprovalError(null)
      scrollFocusPortalLaunch()
      return
    }

    setApproving(true)
    setApprovalError(null)

    const succeeded: string[] = []
    const failed: Array<{ state: string; error: string }> = []

    try {
      for (const st of toApprove) {
        try {
          // Per-state prefill — do not reuse one package under every state_code
          const stPrefill = generatePortalPrefill(request, st, { tripType })
          const record = await recordStateApproval(st, stPrefill, {
            notes: approvalNotes,
          })
          removeForceReapprove(st)
          if (st === selectedState) {
            setIsApproved(true)
            setSubmissionRecord(record)
            setPrefill(stPrefill)
          }
          succeeded.push(st)
          console.log(
            '[portal-assist] HUMAN APPROVED + recorded submission for',
            st,
            'human_approved=true (bulk)'
          )
        } catch (e: any) {
          failed.push({ state: st, error: e?.message || 'Approval record failed.' })
          console.error('[portal-assist] bulk approve failed for', st, e)
        }
      }

      await loadSubmissionsForRequest(request.id)

      if (failed.length > 0) {
        const okPart =
          succeeded.length > 0 ? `Approved: ${succeeded.join(', ')}. ` : 'No states approved. '
        const failPart = `Failed: ${failed.map((f) => `${f.state} (${f.error})`).join('; ')}`
        setApprovalError(okPart + failPart)
      }

      if (succeeded.length > 0) {
        scrollFocusPortalLaunch()
      }
    } catch (e: any) {
      console.error('[portal-assist] bulk approve error', e)
      setApprovalError(e.message || 'Bulk approval failed.')
    } finally {
      setApproving(false)
    }
  }

  const toggleBulkState = (st: string, checked: boolean) => {
    setBulkSelectedStates((prev) => {
      const next = new Set(prev)
      if (checked) next.add(st)
      else next.delete(st)
      return next
    })
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

      const stateApproved = isStateHumanApproved(selectedState)
      const record: any = {
        ...base,
        human_approved: stateApproved,
        pdf_reference: currentPdfReference,
        raw_portal_output: portalOutput,
        // Improve status for pill colors: if parsed approved or we have pdf → green path
        status: (parsed.status === 'approved' || currentPdfReference) ? 'pdf-received' : (stateApproved ? 'submitted' : 'submitted'),
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
      const stateApproved = isStateHumanApproved(selectedState)
      if (submissionRecord || stateApproved) {
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
                human_approved: stateApproved,
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
  /** Gate / hint / banners — same source of truth as green open pills. */
  const selectedIsHumanApproved = isStateHumanApproved(selectedState)
  /** Selected-state open CTA when no corridor pills cover it (empty corridor or off-corridor selection). */
  const selectedInCorridor = portalStatesForRequest.includes(selectedState)
  const showSelectedOpenFallback =
    !request || portalStatesForRequest.length === 0 || !selectedInCorridor
  /** Bulk approve checklist: checked corridor states (batch payload source). */
  const bulkSelectedCount = portalStatesForRequest.filter((st) =>
    bulkSelectedStates.has(st)
  ).length
  /** Checked states that still need a human-approval POST. */
  const bulkPendingCount = portalStatesForRequest.filter(
    (st) => bulkSelectedStates.has(st) && !isStateHumanApproved(st)
  ).length
  /** Show amber confirmation when single-state or bulk still has work. */
  const showApprovalConfirm =
    !selectedIsHumanApproved || bulkPendingCount > 0
  /** PortalPlaybook when registered for selected state (MO today; NE/KS later). */
  const playbook = getPlaybook(selectedState)
  const payLastNote = playbook?.notes?.payLast || MO_PAY_LAST_NOTE
  const feeDisplayNote = playbook?.notes?.feeDisplay || MO_FEE_DISPLAY_NOTE
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
    if (isStateHumanApproved(selectedState)) {
      const confirmed = window.confirm(
        'Regenerating will clear your approval for this state. Continue?'
      )
      if (!confirmed) return
    }
    applyPortalState(request, selectedState)
    // Per-state re-prompt: survives switch away/back until this state is re-approved
    addForceReapprove(selectedState)
  }

  /** Brief clipboard feedback for per-field or copy-all controls (aria-live + fail message). */
  const copyToClipboard = async (key: string, text: string) => {
    const value = String(text ?? '').trim()
    if (!value || value === '—') return
    if (copyTimeoutRef.current) {
      clearTimeout(copyTimeoutRef.current)
      copyTimeoutRef.current = null
    }
    try {
      await navigator.clipboard.writeText(value)
      setCopiedKey(key)
      setCopyStatus('Copied')
      copyTimeoutRef.current = setTimeout(() => {
        setCopiedKey((current) => (current === key ? null : current))
        setCopyStatus(null)
        copyTimeoutRef.current = null
      }, 1500)
    } catch {
      setCopiedKey(null)
      setCopyStatus('Copy failed — clipboard permission denied or unavailable')
      copyTimeoutRef.current = setTimeout(() => {
        setCopyStatus(null)
        copyTimeoutRef.current = null
      }, 3000)
    }
  }

  const handleCopyAllFields = async () => {
    const stateConfig = STATE_PORTAL_CONFIGS[selectedState]
    if (!prefill || !stateConfig) return
    const packet = buildPortalClipboardPacket(prefill, stateConfig, { tripType })
    await copyToClipboard('all', packet)
  }

  const handleCopyMoStep = async (step: MoFilingStep) => {
    if (!prefill) return
    const packet = buildMoFilingStepClipboard(prefill, step, { tripType })
    if (!packet) {
      setCopiedKey(null)
      setCopyStatus('Nothing to copy for this step yet')
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current)
      copyTimeoutRef.current = setTimeout(() => {
        setCopyStatus(null)
        copyTimeoutRef.current = null
      }, 2000)
      return
    }
    await copyToClipboard(`mo-step-${step.id}`, packet)
  }

  const handleTripTypeChange = (next: PortalTripType) => {
    if (next === tripType) return
    setTripType(next)
    setPrefill((prev) =>
      prev
        ? {
            ...prev,
            generatedFields: { ...prev.generatedFields, trip_type: next },
          }
        : prev
    )
    // Trip type is part of the filing package — clear approval like regenerate (per-state)
    setIsApproved(false)
    addForceReapprove(selectedState)
    setApprovalChecked(false)
    setApprovalNotes('')
    setApprovalError(null)
    setSubmissionRecord(null)
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader user={user} />

      <main className="max-w-7xl mx-auto px-6 py-8">
        <div className="mb-6">
          <h1 className="text-3xl font-semibold tracking-tight text-gray-900">Portal Assist</h1>
          <p className={`${bodyTextClass} mt-1`}>
            Secure prefill and assisted submission for state DOT OSOW portals.
          </p>
          <p className={`${fieldHintTinyClass} mt-1`}>
            Add a state: one entry in <code>STATE_PORTAL_CONFIGS</code> (<code>lib/portal-assistant.ts</code>).
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
            <div>
              Review the prefill below, then launch all corridor portals or open one state at a time.
            </div>
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
                aria-label="Filter state portals by code or name. Click an entry to select it."
              />
              {/* Corridor-first ordered list (portalStatesForRequest), then remaining states A–Z; filter after order; muted non-corridor */}
              <div id="state-portal-list" className="mt-1 w-full max-w-xs border border-gray-500 sm:border-gray-300 rounded-xl bg-white shadow-sm max-h-52 overflow-y-auto text-xs text-gray-900">
                {!stateQuery && portalStatesForRequest.length > 0 && (
                  <div className="px-3 py-0.5 text-[10px] uppercase tracking-wide text-gray-500 bg-gray-50 border-b border-gray-200">Corridor</div>
                )}
                {filteredStateCodes.map((state, idx) => {
                  const c = STATE_PORTAL_CONFIGS[state]
                  const display = `${state} — ${c.name}`
                  const isCurrent = state === selectedState
                  const isCorridor = corridorStateSet.has(state)
                  const showAllStatesDivider =
                    !stateQuery &&
                    portalStatesForRequest.length > 0 &&
                    idx > 0 &&
                    isCorridor === false &&
                    corridorStateSet.has(filteredStateCodes[idx - 1])
                  return (
                    <div key={state}>
                      {showAllStatesDivider && (
                        <div className="px-3 py-0.5 text-[10px] uppercase tracking-wide text-gray-500 bg-gray-50 border-b border-gray-200 border-t">All states</div>
                      )}
                      <div
                        onClick={() => {
                          handleStateChange(state)
                          setStateQuery('')
                          setIsExpanded(false)
                        }}
                        className={`px-3 py-1 cursor-pointer hover:bg-gray-100 font-mono border-b border-gray-300 sm:border-gray-200 last:border-b-0 ${
                          isCurrent
                            ? 'bg-gray-100 font-semibold text-gray-900'
                            : isCorridor
                              ? 'text-gray-900 font-medium'
                              : 'text-gray-500'
                        }`}
                        title={`Select ${display}`}
                      >
                        {display}
                      </div>
                    </div>
                  )
                })}
                {stateQuery && filteredStateCodes.length === 0 && (
                  <div className={`px-3 py-1 ${fieldHintClass}`}>No matches. Clear to see all 49.</div>
                )}
              </div>
              <div className={`${fieldHintTinyClass} mt-1`}>49 states (except HI). Click to expand; selection updates the right panel.</div>
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

              {requestLoading && <div className={`text-sm ${fieldHintToneClass}`}>Loading request…</div>}
              {requestError && <ErrorDisplay message={requestError} variant="inline" onRetry={() => { /* re-trigger via url if wanted */ }} />}

              {!request ? (
                <div className={`text-sm ${bodyTextClass}`}>
                  No request loaded. Use Load Demo, or open from <a href="/history" className="underline text-gray-900">History</a> → Launch Portal Assist.
                </div>
              ) : (
                <div className="text-sm space-y-3">
                  <div>
                    <span className={`${fieldLabelClass} block`}>ROUTE</span>
                    <span className="font-medium text-gray-900 break-words">
                      {formatPortalAddress(resolvePortalAddressParts(request, 'origin')) || '—'}
                      {' → '}
                      {formatPortalAddress(resolvePortalAddressParts(request, 'destination')) ||
                        '—'}
                    </span>
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
                    <div className="text-[10px] text-emerald-800 sm:text-emerald-700">Loaded from saved analysis</div>
                  )}
                  {!isRealRequest && request && (
                    <div className="text-[10px] text-amber-800 sm:text-amber-700">Demo data — verify prefill in final review</div>
                  )}
                </div>
              )}
            </div>

            {/* 2. Final Review — generated prefill + carrier/driver/load/equipment before portal submission */}
            {prefill && config && (
              <div className={cardClass}>
                <h2 className="font-semibold text-gray-900">2. Final Review — Generated Prefill for {config.name}</h2>
                <p className={`${fieldHintClass} mt-1 mb-2`}>
                  Confirm carrier, driver, load, and equipment before portal entry.
                </p>

                {/* Filing workflow strip — copy-ready kit, not RPA (no Step N to avoid clashing with section numbers) */}
                <div
                  className={`${fieldHintClass} mb-4 flex flex-wrap items-center gap-x-1.5 gap-y-1`}
                  data-testid="filing-workflow-strip"
                >
                  <span className="font-medium text-gray-600 sm:text-gray-500">Filing steps:</span>
                  <span>Review prefill</span>
                  <span aria-hidden="true">→</span>
                  <span>Copy fields</span>
                  <span aria-hidden="true">→</span>
                  <span>Open portal</span>
                  <span aria-hidden="true">→</span>
                  <span>Paste &amp; pay on state site</span>
                </div>

                {/* Trip type near MO step 2 (permit type) and generic copy packet */}
                <div className="mb-4" data-testid="trip-type-control">
                  <span className={`${fieldLabelClass} block mb-2`}>TRIP TYPE</span>
                  <div className="flex flex-wrap gap-2">
                    {PORTAL_TRIP_TYPES.map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => handleTripTypeChange(t)}
                        className={`px-3 py-1.5 rounded-lg text-sm font-medium border ${
                          tripType === t
                            ? 'bg-gray-900 text-white border-gray-900'
                            : `${buttonSecondaryClass}`
                        }`}
                        aria-pressed={tripType === t}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                  {tripType === 'Annual' && (
                    <p className={`${fieldHintTinyClass} mt-1`}>
                      Annual — not auto-matched yet; use for manual portal selection.
                    </p>
                  )}
                  {selectedState === 'MO' && (
                    <p className={`${fieldHintTinyClass} mt-1`}>
                      Guidance for Single Trip selection and application tips in Copy all.
                    </p>
                  )}
                </div>

                {/* MO-only: MoDOT Carrier Express playbook v3 — enums, Trip→Payment, pay-last (not RPA).
                    Steps/labels driven by PortalPlaybook data when getPlaybook(selectedState) is present. */}
                {selectedState === 'MO' && playbook && (
                  <div className="mb-4 space-y-4" data-testid="mo-playbook">
                    <div data-testid="mo-filing-steps">
                      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                        <span className={`${fieldLabelClass} block`}>
                          MODOT CARRIER EXPRESS STEPS
                        </span>
                        <div className="flex flex-wrap items-center gap-2">
                          {(playbook.portalUrl || config.portalUrl) && (
                            <a
                              href={playbook.portalUrl || config.portalUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className={`${fieldHintTinyClass} underline hover:text-gray-700`}
                              data-testid="mo-portal-link"
                            >
                              Open Carrier Express
                            </a>
                          )}
                          {(playbook.infoUrl || config.infoUrl) && (
                            <a
                              href={playbook.infoUrl || config.infoUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className={`${fieldHintTinyClass} underline hover:text-gray-700`}
                              data-testid="mo-info-link"
                            >
                              modot.org help
                            </a>
                          )}
                        </div>
                      </div>
                      <p className={`${fieldHintTinyClass} mb-2`}>
                        Path mapped from live Carrier Express Single Trip screens (v3 enums +
                        Trip through Payment; PortalPlaybook schema). Copy per step or use Copy
                        all, then paste into MoDOT — copy-assist only (no RPA). Guides on{' '}
                        {(playbook.infoUrl || config.infoUrl) ? (
                          <a
                            href={playbook.infoUrl || config.infoUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="underline hover:text-gray-700"
                          >
                            modot.org
                          </a>
                        ) : (
                          'modot.org'
                        )}
                        .
                      </p>
                      {isMoMultiStatePrefill(prefill) &&
                        playbook.flags?.payLastIfMultiState !== false && (
                        <div
                          role="status"
                          data-testid="mo-pay-last-banner"
                          className="mb-2 rounded-lg border border-amber-600 sm:border-amber-400 bg-amber-50 px-3 py-2 text-sm text-amber-950"
                        >
                          <div className="font-medium">{payLastNote}</div>
                          <div className={`${fieldHintTinyClass} mt-0.5 text-amber-900`}>
                            {feeDisplayNote}
                          </div>
                        </div>
                      )}
                      <div
                        role="status"
                        aria-live="polite"
                        data-testid="mo-copy-status"
                        className={`${fieldHintTinyClass} mb-2 min-h-[1rem] ${
                          copyStatus &&
                          (copyStatus.startsWith('Copy failed') ||
                            copyStatus.startsWith('Nothing to copy'))
                            ? 'text-amber-800 sm:text-amber-700'
                            : ''
                        }`}
                      >
                        {copyStatus || ''}
                      </div>
                      <ol className="space-y-2 text-sm list-none pl-0">
                        {buildMoFilingSteps(prefill).map((step) => {
                          // Only list prefill keys that currently have values (no empty border noise)
                          const keysWithValues = getMoStepPrefillKeysWithValues(
                            prefill,
                            step,
                            { tripType }
                          )
                          const keysHint =
                            keysWithValues.length > 0
                              ? keysWithValues
                                  .map((k) => getMoPortalFieldLabel(k))
                                  .join(', ')
                              : null
                          const stepPacket =
                            step.prefillKeys.length > 0
                              ? buildMoFilingStepClipboard(prefill, step, { tripType })
                              : ''
                          return (
                            <li
                              key={step.id}
                              className="rounded-xl border border-gray-500 sm:border-gray-300 bg-gray-50 p-3"
                              data-mo-step={step.id}
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="font-medium text-gray-900">
                                    {step.stepNumber}. {step.title}
                                  </div>
                                  {keysHint && (
                                    <div className={`${fieldHintTinyClass} mt-0.5`}>
                                      Prefill: {keysHint}
                                    </div>
                                  )}
                                  {step.guidance && step.guidance.length > 0 && (
                                    <ul
                                      className={`${fieldHintTinyClass} mt-1 list-disc pl-4 space-y-0.5`}
                                      data-testid={`mo-step-guidance-${step.id}`}
                                    >
                                      {step.guidance.map((line) => (
                                        <li key={line}>{line}</li>
                                      ))}
                                    </ul>
                                  )}
                                </div>
                                {stepPacket ? (
                                  <button
                                    type="button"
                                    onClick={() => handleCopyMoStep(step)}
                                    className={`${fieldHintTinyClass} shrink-0 underline hover:text-gray-700`}
                                    data-testid={`mo-step-copy-${step.id}`}
                                    aria-label={`Copy step ${step.stepNumber}: ${step.title}`}
                                  >
                                    {copiedKey === `mo-step-${step.id}` ? 'Copied' : 'Copy'}
                                  </button>
                                ) : null}
                              </div>
                            </li>
                          )
                        })}
                      </ol>
                    </div>

                    {/* Path overview = same as numbered steps (no duplicate full list) */}
                    <div data-testid="mo-walkthrough">
                      <span className={`${fieldLabelClass} block mb-2`}>
                        CARRIER EXPRESS SINGLE TRIP PATH
                      </span>
                      <p className={`${fieldHintTinyClass} ${bodyTextClass}`}>
                        Same path as numbered steps above (path source of truth). Application
                        enums → Trip Analyze → Review → Payment
                        {isMoMultiStatePrefill(prefill) ? ' (pay-last multi-state)' : ''}.
                        Prefill origin/dest is often city/state only — enter Street Address on
                        MoDOT Trip map when required.
                        {tripType !== 'Single trip' ? (
                          <>
                            {' '}
                            Playbook is Single Trip–focused; selected trip type is{' '}
                            <strong>{tripType}</strong> — adjust MoDOT menus if needed.
                          </>
                        ) : null}
                      </p>
                    </div>

                    {/* Assisted field export — user-driven only; docs in CAPTURE.md */}
                    <details
                      className="rounded-xl border border-gray-400 sm:border-gray-300 bg-white p-3"
                      data-testid="export-fields-help"
                    >
                      <summary
                        className={`${fieldLabelClass} cursor-pointer select-none`}
                      >
                        Export fields (assisted capture)
                      </summary>
                      <div className={`${fieldHintTinyClass} mt-2 space-y-1.5 ${bodyTextClass}`}>
                        <p>
                          Inventory visible labels on a portal page <strong>you</strong> already
                          opened — no auto-fill, no credentials, no crawl. Full bookmarklet and
                          console snippet:{' '}
                          <code className="text-[10px]">lib/portal-playbooks/CAPTURE.md</code>
                        </p>
                        <ol className="list-decimal pl-4 space-y-0.5">
                          <li>Log into {playbook.portalName} yourself and open the form page.</li>
                          <li>Run the CAPTURE.md bookmarklet or console snippet (user click only).</li>
                          <li>
                            Snippet downloads a JSON file (and copies clipboard). Edge may save under
                            Downloads — move into{' '}
                            <code className="text-[10px]">lib/portal-playbooks/captures/</code> if
                            staging (gitignored dumps).
                          </li>
                          <li>
                            Curate into a playbook and set{' '}
                            <code className="text-[10px]">mapsFrom</code> to TruckerOS prefill keys.
                          </li>
                        </ol>
                      </div>
                    </details>
                  </div>
                )}

                {/* Completeness checklist (pass/warn) + copy-all nearby */}
                {(() => {
                  const checklist = buildPortalCompletenessChecklist(prefill, config)
                  return (
                    <div className="mb-4" data-testid="completeness-checklist">
                      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                        <span className={`${fieldLabelClass} block`}>FILING COMPLETENESS</span>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={fieldHintTinyClass}>
                            {checklist.passCount} ready
                            {checklist.warnCount > 0 ? ` · ${checklist.warnCount} to fix` : ''}
                            {checklist.softWarnCount > 0
                              ? ` · ${checklist.softWarnCount} optional`
                              : ''}
                          </span>
                          <button
                            type="button"
                            onClick={handleCopyAllFields}
                            className={`px-3 py-1.5 ${buttonSecondaryClass}`}
                            data-testid="copy-all-fields"
                            aria-label={`Copy all fields for ${selectedState}`}
                          >
                            {copiedKey === 'all'
                              ? 'Copied'
                              : `Copy all fields for ${selectedState}`}
                          </button>
                        </div>
                      </div>
                      <div
                        role="status"
                        aria-live="polite"
                        data-testid="copy-status"
                        className={`${fieldHintTinyClass} mb-2 min-h-[1rem] ${
                          copyStatus && copyStatus.startsWith('Copy failed')
                            ? 'text-amber-800 sm:text-amber-700'
                            : ''
                        }`}
                      >
                        {copyStatus || ''}
                      </div>
                      <ul className="space-y-1.5 text-sm">
                        {checklist.items.map((item) => (
                          <li
                            key={item.id}
                            className={
                              item.status === 'pass'
                                ? 'text-emerald-800 sm:text-emerald-700'
                                : item.soft
                                  ? 'text-gray-600 sm:text-gray-500'
                                  : 'text-amber-800 sm:text-amber-700'
                            }
                          >
                            <span className="font-medium">
                              {item.status === 'pass' ? '✓' : item.soft ? '○' : '⚠'}{' '}
                              {item.label}
                            </span>
                            {item.status === 'warn' && item.hint && (
                              <span className={`block ${fieldHintTinyClass} pl-4`}>
                                {item.hint}
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )
                })()}

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
                    <div className={`text-sm italic ${fieldHintToneClass}`}>No carrier info saved with this request.</div>
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
                    <div className={`text-sm italic ${fieldHintToneClass}`}>No driver info saved with this request.</div>
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
                <p className={`${fieldHintTinyClass} mb-2`}>
                  Copy individual values or use Copy all above, then paste into the state portal.
                  {selectedState === 'MO'
                    ? ' MO Copy all packet includes full Application + Trip fields; tiles below are a subset.'
                    : ''}
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                  {Object.entries(config.fieldMapping).map(([ourKey, portalLabel]) => {
                    const value = (prefill.generatedFields as any)[ourKey]
                    const display = value != null && value !== '' ? String(value) : '—'
                    return (
                      <div key={ourKey} className="rounded-xl border border-gray-500 sm:border-gray-300 bg-gray-50 p-3">
                        <div className="flex items-start justify-between gap-2 mb-0.5">
                          <div className={fieldLabelTinyClass}>{portalLabel}</div>
                          {display !== '—' && (
                            <button
                              type="button"
                              onClick={() => copyToClipboard(ourKey, display)}
                              className={`${fieldHintTinyClass} shrink-0 underline hover:text-gray-700`}
                              data-copy-field={ourKey}
                              aria-label={`Copy ${portalLabel}`}
                            >
                              {copiedKey === ourKey ? 'Copied' : 'Copy'}
                            </button>
                          )}
                        </div>
                        <div className="font-mono break-words text-gray-900">{display}</div>
                      </div>
                    )
                  })}
                  {/* MO extras not in fieldMapping: load + payment contact tiles (full packet via Copy all) */}
                  {selectedState === 'MO' &&
                    (
                      [
                        'load_description',
                        'contact_name',
                        'carrier_email',
                        'tip_vehicle_type',
                      ] as const
                    ).map((extraKey) => {
                      const raw = (prefill.generatedFields as any)[extraKey]
                      if (!hasPrefillValue(raw)) return null
                      const portalLabel = resolvePortalFieldLabel(
                        extraKey,
                        config,
                        selectedState
                      )
                      const display = String(raw)
                      return (
                        <div
                          key={extraKey}
                          className="rounded-xl border border-gray-500 sm:border-gray-300 bg-gray-50 p-3"
                          data-testid={`mo-extra-field-${extraKey}`}
                        >
                          <div className="flex items-start justify-between gap-2 mb-0.5">
                            <div className={fieldLabelTinyClass}>{portalLabel}</div>
                            <button
                              type="button"
                              onClick={() => copyToClipboard(extraKey, display)}
                              className={`${fieldHintTinyClass} shrink-0 underline hover:text-gray-700`}
                              data-copy-field={extraKey}
                              aria-label={`Copy ${portalLabel}`}
                            >
                              {copiedKey === extraKey ? 'Copied' : 'Copy'}
                            </button>
                          </div>
                          <div className="font-mono break-words text-gray-900">{display}</div>
                        </div>
                      )
                    })}
                  {/* Trip type + extras: MO uses MoDOT labels via resolvePortalFieldLabel(config, state) */}
                  {(prefill.generatedFields as any).trip_type && (
                    <div className="rounded-xl border border-gray-500 sm:border-gray-300 bg-gray-50 p-3">
                      <div className="flex items-start justify-between gap-2 mb-0.5">
                        <div className={fieldLabelTinyClass}>
                          {resolvePortalFieldLabel('trip_type', config, selectedState)}
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            copyToClipboard('trip_type', String((prefill.generatedFields as any).trip_type))
                          }
                          className={`${fieldHintTinyClass} shrink-0 underline hover:text-gray-700`}
                          data-copy-field="trip_type"
                          aria-label={`Copy ${resolvePortalFieldLabel('trip_type', config, selectedState)}`}
                        >
                          {copiedKey === 'trip_type' ? 'Copied' : 'Copy'}
                        </button>
                      </div>
                      <div className="font-mono text-gray-900">{(prefill.generatedFields as any).trip_type}</div>
                    </div>
                  )}
                  {/* Extra rich fields pulled from equipment/cargo */}
                  {(prefill.generatedFields as any).axles && (
                    <div className="rounded-xl border border-gray-500 sm:border-gray-300 bg-gray-50 p-3">
                      <div className="flex items-start justify-between gap-2 mb-0.5">
                        <div className={fieldLabelTinyClass}>
                          {resolvePortalFieldLabel('axles', config, selectedState)}
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            copyToClipboard('axles', String((prefill.generatedFields as any).axles))
                          }
                          className={`${fieldHintTinyClass} shrink-0 underline hover:text-gray-700`}
                          data-copy-field="axles"
                          aria-label={`Copy ${resolvePortalFieldLabel('axles', config, selectedState)}`}
                        >
                          {copiedKey === 'axles' ? 'Copied' : 'Copy'}
                        </button>
                      </div>
                      <div className="font-mono text-gray-900">{(prefill.generatedFields as any).axles}</div>
                    </div>
                  )}
                  {/* Discrete identity in grid; *_ymm combined lines stay in clipboard packet only */}
                  {VEHICLE_IDENTITY_PREFILL_KEYS.filter((k) => !k.endsWith('_ymm')).map(
                    (idKey) => {
                    const raw = (prefill.generatedFields as any)[idKey]
                    if (!hasPrefillValue(raw)) return null
                    const display = String(raw).trim()
                    const portalLabel = resolvePortalFieldLabel(idKey, config, selectedState)
                    return (
                      <div
                        key={idKey}
                        className="rounded-xl border border-gray-500 sm:border-gray-300 bg-gray-50 p-3"
                      >
                        <div className="flex items-start justify-between gap-2 mb-0.5">
                          <div className={fieldLabelTinyClass}>{portalLabel}</div>
                          <button
                            type="button"
                            onClick={() => copyToClipboard(idKey, display)}
                            className={`${fieldHintTinyClass} shrink-0 underline hover:text-gray-700`}
                            data-copy-field={idKey}
                            aria-label={`Copy ${portalLabel}`}
                          >
                            {copiedKey === idKey ? 'Copied' : 'Copy'}
                          </button>
                        </div>
                        <div className="font-mono break-words text-gray-900">{display}</div>
                      </div>
                    )
                  }
                  )}
                  {(prefill.generatedFields as any).vehicle_id && (
                    <div className="rounded-xl border border-gray-500 sm:border-gray-300 bg-gray-50 p-3">
                      <div className="flex items-start justify-between gap-2 mb-0.5">
                        <div className={fieldLabelTinyClass}>
                          {resolvePortalFieldLabel('vehicle_id', config, selectedState)}
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            copyToClipboard(
                              'vehicle_id',
                              String((prefill.generatedFields as any).vehicle_id)
                            )
                          }
                          className={`${fieldHintTinyClass} shrink-0 underline hover:text-gray-700`}
                          data-copy-field="vehicle_id"
                          aria-label={`Copy ${resolvePortalFieldLabel('vehicle_id', config, selectedState)}`}
                        >
                          {copiedKey === 'vehicle_id' ? 'Copied' : 'Copy'}
                        </button>
                      </div>
                      <div className="font-mono text-gray-900">{(prefill.generatedFields as any).vehicle_id}</div>
                    </div>
                  )}
                  {(prefill.generatedFields as any).entry_point && (
                    <div className="rounded-xl border border-gray-500 sm:border-gray-300 bg-gray-50 p-3">
                      <div className="flex items-start justify-between gap-2 mb-0.5">
                        <div className={fieldLabelTinyClass}>
                          {resolvePortalFieldLabel('entry_point', config, selectedState)}
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            copyToClipboard(
                              'entry_point',
                              String((prefill.generatedFields as any).entry_point)
                            )
                          }
                          className={`${fieldHintTinyClass} shrink-0 underline hover:text-gray-700`}
                          data-copy-field="entry_point"
                          aria-label={`Copy ${resolvePortalFieldLabel('entry_point', config, selectedState)}`}
                        >
                          {copiedKey === 'entry_point' ? 'Copied' : 'Copy'}
                        </button>
                      </div>
                      <div className="font-mono break-words text-gray-900">{(prefill.generatedFields as any).entry_point}</div>
                    </div>
                  )}
                  {(prefill.generatedFields as any).exit_point && (
                    <div className="rounded-xl border border-gray-500 sm:border-gray-300 bg-gray-50 p-3">
                      <div className="flex items-start justify-between gap-2 mb-0.5">
                        <div className={fieldLabelTinyClass}>
                          {resolvePortalFieldLabel('exit_point', config, selectedState)}
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            copyToClipboard(
                              'exit_point',
                              String((prefill.generatedFields as any).exit_point)
                            )
                          }
                          className={`${fieldHintTinyClass} shrink-0 underline hover:text-gray-700`}
                          data-copy-field="exit_point"
                          aria-label={`Copy ${resolvePortalFieldLabel('exit_point', config, selectedState)}`}
                        >
                          {copiedKey === 'exit_point' ? 'Copied' : 'Copy'}
                        </button>
                      </div>
                      <div className="font-mono break-words text-gray-900">{(prefill.generatedFields as any).exit_point}</div>
                    </div>
                  )}
                  {((prefill.generatedFields as any).entry_point ||
                    (prefill.generatedFields as any).exit_point) &&
                    (prefill.generatedFields as any).border_summary && (
                    <div className="rounded-xl border border-gray-500 sm:border-gray-300 bg-gray-50 p-3 sm:col-span-2">
                      <div className="flex items-start justify-between gap-2 mb-0.5">
                        <div className={fieldLabelTinyClass}>
                          {resolvePortalFieldLabel('border_summary', config, selectedState)}
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            copyToClipboard(
                              'border_summary',
                              String((prefill.generatedFields as any).border_summary)
                            )
                          }
                          className={`${fieldHintTinyClass} shrink-0 underline hover:text-gray-700`}
                          data-copy-field="border_summary"
                          aria-label={`Copy ${resolvePortalFieldLabel('border_summary', config, selectedState)}`}
                        >
                          {copiedKey === 'border_summary' ? 'Copied' : 'Copy'}
                        </button>
                      </div>
                      <div className="font-mono break-words text-gray-900">{(prefill.generatedFields as any).border_summary}</div>
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
                  <p className={`${fieldHintTinyClass} mt-1`}>Encrypted server-side; never stored in plain text.</p>
                </div>

                {/* Human approval gate + action row — uses isStateHumanApproved (session + submissions) */}
                <div className="mt-6 pt-6 border-t border-gray-300 sm:border-gray-200">
                  <h3 className="font-semibold mb-2 text-sm text-gray-900">
                    Record approval
                    {portalStatesForRequest.length > 1
                      ? ' — shared load data for corridor'
                      : ` for ${selectedState}`}
                  </h3>

                  {/* Bulk corridor checklist — one review, multi-state approve */}
                  {request && portalStatesForRequest.length > 0 && (
                    <div
                      data-testid="bulk-approve-states"
                      className="mb-4 p-3 bg-gray-50 border border-gray-300 sm:border-gray-200 rounded-xl"
                    >
                      <div className="text-sm font-medium text-gray-900 mb-1">States to approve</div>
                      <p className={`${fieldHintClass} mb-2`}>
                        Shared carrier/driver/load/equipment above is the source of truth. Uncheck states to exclude
                        from this batch. Each selected state still gets its own prefill (entry/exit borders).
                      </p>
                      <ul className="space-y-1.5" role="group" aria-label="States to approve">
                        {portalStatesForRequest.map((st) => {
                          const checked = bulkSelectedStates.has(st)
                          const approved = isStateHumanApproved(st)
                          const stStatus = getStateStatus(st)
                          return (
                            <li
                              key={st}
                              className="flex items-center gap-2 text-sm text-gray-900"
                              data-testid={`bulk-approve-row-${st}`}
                            >
                              <label className="flex items-center gap-2 cursor-pointer min-w-0 flex-1">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={(e) => toggleBulkState(st, e.target.checked)}
                                  data-testid={`bulk-approve-state-${st}`}
                                  className="h-4 w-4 accent-emerald-700 border-gray-500 shrink-0"
                                />
                                <span className="font-mono font-semibold">{st}</span>
                              </label>
                              <span
                                className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 ${
                                  approved
                                    ? 'bg-emerald-700 text-white'
                                    : getStatusClasses(stStatus)
                                }`}
                                data-testid={`bulk-approve-status-${st}`}
                              >
                                {approved
                                  ? 'Already approved'
                                  : stStatus === 'red'
                                    ? 'Needed'
                                    : getStatusLabel(stStatus, st)}
                              </span>
                            </li>
                          )
                        })}
                      </ul>
                    </div>
                  )}

                  {selectedIsHumanApproved && (
                    <div className="mb-3 p-3 bg-emerald-50 border border-emerald-300 sm:border-emerald-200 rounded-xl text-sm text-emerald-900 sm:text-emerald-800">
                      ✓ Human approved for {selectedState}. Record created with human_approved=true.
                    </div>
                  )}

                  {showApprovalConfirm ? (
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

                      <div className="mt-3 flex flex-col sm:flex-row flex-wrap gap-2">
                        <button
                          onClick={handleRegeneratePrefill}
                          disabled={!request}
                          className={`px-5 py-2 ${buttonSecondaryClass}`}
                        >
                          Regenerate Prefill
                        </button>
                        {request && portalStatesForRequest.length > 0 && (
                          <button
                            type="button"
                            data-testid="bulk-approve-submit"
                            onClick={handleBulkApproveSelected}
                            disabled={
                              !approvalChecked || approving || bulkSelectedCount === 0
                            }
                            className={`px-5 py-2 ${buttonSuccessClass} rounded-xl`}
                          >
                            {approving
                              ? 'Recording approvals…'
                              : bulkSelectedCount === 0
                                ? 'Approve selected states'
                                : bulkSelectedCount === 1
                                  ? 'Approve 1 state'
                                  : `Approve ${bulkSelectedCount} states`}
                          </button>
                        )}
                        {!selectedIsHumanApproved && (
                          <button
                            onClick={handleApproveGate}
                            disabled={!approvalChecked || approving || !prefill}
                            className={`px-5 py-2 ${buttonSecondaryClass}`}
                            data-testid="approve-single-state"
                          >
                            {approving
                              ? 'Recording approval…'
                              : `Approve & Record for ${selectedState} Submission`}
                          </button>
                        )}
                      </div>
                      {approvalError && (
                        <div className="mt-2">
                          <ErrorDisplay message={approvalError} variant="inline" onRetry={() => setApprovalError(null)} />
                        </div>
                      )}
                      <div className="text-[10px] text-amber-800 sm:text-amber-700 mt-2">
                        Sets human_approved=true on each selected state submission. No automated submit. Already
                        approved states are skipped.
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3">
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
            {/* Portal Actions — scroll/focus target after Approve & Record (scroll-mt clears sticky header) */}
            {config && (
              <div
                ref={portalLaunchPanelRef}
                data-testid="portal-launch-panel"
                className={`${cardClass} scroll-mt-20`}
              >
                <h2
                  ref={portalLaunchHeadingRef}
                  tabIndex={-1}
                  className="font-semibold mb-3 text-gray-900 outline-none focus:ring-2 focus:ring-emerald-600 focus:ring-offset-2 rounded"
                >
                  {config.name} Portal
                </h2>
                {/* Selected-state open when corridor pills do not cover it (no request / empty / off-corridor) */}
                {showSelectedOpenFallback && config.portalUrl && (
                  !request ? (
                    // Real link when no request: middle-click / copy-link / open-in-new-tab work
                    <a
                      href={config.portalUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      data-testid={`open-portal-${selectedState}`}
                      data-human-approved={selectedIsHumanApproved ? 'true' : 'false'}
                      data-open-fallback="true"
                      className={`inline-block px-4 py-2 rounded-lg mb-3 text-sm font-medium ${
                        selectedIsHumanApproved ? buttonSuccessClass : buttonPrimaryClass
                      }`}
                    >
                      Open {selectedState} portal
                    </a>
                  ) : (
                    <button
                      type="button"
                      data-testid={`open-portal-${selectedState}`}
                      data-human-approved={selectedIsHumanApproved ? 'true' : 'false'}
                      data-open-fallback="true"
                      onClick={() => handleOpenStatePortal(selectedState)}
                      className={`inline-block px-4 py-2 rounded-lg mb-3 text-sm font-medium ${
                        selectedIsHumanApproved ? buttonSuccessClass : buttonPrimaryClass
                      }`}
                    >
                      Open {selectedState} portal
                    </button>
                  )
                )}
                {!request && (
                  <button
                    onClick={loadDemoRequest}
                    className={`inline-block px-4 py-2 ${buttonSuccessClass} rounded-lg mb-3 ml-2`}
                  >
                    Load Rich Demo Request for {selectedState}
                  </button>
                )}
                {request && (
                  <div className="mb-3">
                    {selectedIsHumanApproved && (
                      <p
                        data-testid="post-approve-launch-hint"
                        role="status"
                        aria-live="polite"
                        className="mb-2 text-xs text-emerald-900 sm:text-emerald-800"
                      >
                        {selectedState} approved — open portal when ready, or select another corridor
                        state to review.
                      </p>
                    )}
                    {/* Per-corridor-state open pills: muted until human_approved, then emerald; never disabled */}
                    {portalStatesForRequest.length > 0 && (
                      <div
                        data-testid="corridor-open-portals"
                        className="flex flex-wrap gap-2 mb-3"
                        role="group"
                        aria-label="Open individual corridor state portals"
                      >
                        {portalStatesForRequest.map((st) => {
                          const stCfg = STATE_PORTAL_CONFIGS[st]
                          if (!stCfg?.portalUrl) return null
                          const approved = isStateHumanApproved(st)
                          return (
                            <button
                              key={st}
                              type="button"
                              data-testid={`open-portal-${st}`}
                              data-human-approved={approved ? 'true' : 'false'}
                              onClick={() => handleOpenStatePortal(st)}
                              className={`inline-block px-3 py-1.5 text-sm font-medium ${
                                approved ? `${buttonSuccessClass} rounded-lg` : buttonSecondaryClass
                              }`}
                            >
                              Open {st} portal
                            </button>
                          )
                        })}
                      </div>
                    )}
                    {/* Batch CTA stays emerald (batch affordance); individual pills use approval state */}
                    <button
                      type="button"
                      onClick={handleLaunchCorridorPortals}
                      disabled={portalStatesForRequest.length === 0}
                      aria-describedby="launch-corridor-help"
                      className={`inline-block px-4 py-2 ${buttonSuccessClass} rounded-lg`}
                    >
                      Launch all corridor portals ({portalStatesForRequest.length})
                    </button>
                    <p id="launch-corridor-help" className={`mt-1.5 ${fieldHintClass}`}>
                      Review prefill first, then launch all corridor portals in new tabs.
                    </p>
                    {corridorLaunchHint && (
                      <p
                        role="status"
                        aria-live="polite"
                        className="mt-1.5 text-xs text-emerald-800 sm:text-emerald-700"
                      >
                        {corridorLaunchHint}
                      </p>
                    )}
                  </div>
                )}
                <p className={`text-sm ${bodyTextClass} whitespace-pre-wrap`}>{config.instructions}</p>
                {config.typicalRestrictions && config.typicalRestrictions.length > 0 && (
                  <div className="mt-3 text-xs text-amber-800 sm:text-amber-700">
                    Typical restrictions: {config.typicalRestrictions.join(' • ')}
                  </div>
                )}
                {selectedIsHumanApproved && (
                  <div className="mt-3 p-3 bg-emerald-50 border border-emerald-300 sm:border-emerald-200 rounded text-xs text-emerald-900">
                    Ready for manual entry or paste of portal response below.
                  </div>
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
                <div className={`${fieldHintClass} mt-2`}>No PDFs yet — upload after portal response.</div>
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

        <div className={`mt-8 ${fieldHintClass} border-t border-gray-300 sm:border-gray-200 pt-4`}>
          Logged as [portal-assist]. Credentials encrypted server-side. Approval required before human_approved submissions.
        </div>
      </main>
    </div>
  )
}
