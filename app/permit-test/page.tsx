'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import VehicleDiagram from '@/components/VehicleDiagram'
import type { RigConfiguration, Tractor, Trailer } from '@/types/equipment'
import {
  computeRigDimensions,
  computeRigEmptyWeightLbs,
  computeRoutingEnvelope,
  primaryTrailerDimensions,
} from '@/types/equipment'
import {
  fetchGeocodeWithRetry,
  isAddressReadyForGeocode,
  GEOCODE_BUSY_MESSAGE,
  isGeocodeFailure,
  type GeocodeSuccess,
} from '@/lib/geocode-client'
import {
  applyGeocodeToStop,
  buildGeocodeQuery,
  createEmptyStop,
  hasValidCoords,
  MAX_DROPS,
  syncDestinationFromDrops,
  type LocationStop,
} from '@/lib/location-stop'
import { formatHighwayForDisplay, formatHighwaysForDisplay } from '@/lib/format-highway-display'
import { getPortalStatesForAnalysis, openStatePortals } from '@/lib/portal-assistant'
import { formatDimensionDisplay, formatRigSummaryLine as buildRigSummaryLine } from '@/lib/parse-dimension'
import { getGrossHeightDisplay } from '@/lib/routing-envelope-display'
import { formatLicensePlateDisplay } from '@/lib/license-plate'
import { normalizeLicensePlateState } from '@/lib/us-states'
import DimensionInput from '@/components/DimensionInput'
import OverhangFeetInput from '@/components/OverhangFeetInput'
import LocationStopInput from '@/components/LocationStopInput'
import ActiveCarrierBanner from '@/components/ActiveCarrierBanner'
import CarrierContextBar from '@/components/CarrierContextBar'
import {
  buildOrganizationTeamMemberList,
  buildTeamMemberList,
  isPrimaryOwner,
} from '@/lib/member-profile-permissions'
import { useOrganizationContext } from '@/lib/organization-context'
import {
  fetchCarrierPrimaryOwnerUserId,
  resolveEquipmentScope,
  resolvePermitOrganizationId,
} from '@/lib/service-mode-scope'
import { US_STATE_OPTIONS } from '@/lib/us-states'
import {
  buildDriverSelectOptions,
  driverSelectionKey,
  EMPTY_PERMIT_CARRIER_DRIVER_FIELDS,
  formatDriverSummaryLine,
  clearDefaultPermitDriverKey,
  getDefaultPermitDriverKey,
  memberProfileToPermitAutofill,
  mergePermitAutofillPatch,
  parseDriverSelectionKey,
  permitFormToLoadDetailsCarrierFields,
  pickPermitCarrierDriverFields,
  resolveDriverProfileForSelection,
  resolveOrgCarrierProfileForAutofill,
  setDefaultPermitDriverKey,
  sortDriverSelectOptionsWithDefault,
} from '@/lib/permit-profile-autofill'
import {
  DEFAULT_LOADED_ARRANGEMENT,
  DEFAULT_MOVE_TYPE,
  DEFAULT_NUMBER_OF_PIECES,
  LOADED_ARRANGEMENT_LABELS,
  LOADED_ARRANGEMENT_OPTIONS,
  MAX_NUMBER_OF_PIECES,
  MOVE_TYPE_LABELS,
  MOVE_TYPE_OPTIONS,
  parseAndClampPieces,
  resolvePiecesForSubmit,
} from '@/lib/load-details-options'
import { buildPermitCargoSnapshot } from '@/lib/permit-cargo-snapshot'
import { isDevEnvironment } from '@/lib/dev-mode'
import type { MemberProfile, TeamMemberListItem, TeamMemberProfile } from '@/types/member-profile'

type DropStop = LocationStop & { lat?: number; lon?: number }
type StopKey = 'origin' | `drop-${string}`

function dropStopKey(drop: DropStop): StopKey {
  return `drop-${drop.id}`
}

type PermitPrimary = {
  permitReady?: boolean
  permitRequiredStates?: string[]
  permitWarnings?: string[]
  message?: string
}

/** OR-Tools permitReady=true means permits ARE required (oversize / review needed). */
function routeRequiresPermit(primary: PermitPrimary | null | undefined): boolean {
  if (!primary) return false
  if (primary.permitReady === true) return true
  if ((primary.permitRequiredStates?.length || 0) > 0) return true
  if (Array.isArray(primary.permitWarnings) && primary.permitWarnings.length > 0) return true
  return false
}

function stateRequiresPermit(primary: PermitPrimary | null | undefined, state: string): boolean {
  if (!primary) return false
  if (primary.permitReady === true) return true
  if (Array.isArray(primary.permitWarnings) && primary.permitWarnings.length > 0) return true
  return primary.permitRequiredStates?.includes(state) ?? false
}

/** Form controls — stronger borders/text on mobile; softer from sm+ */
const fieldControlClass =
  'border border-gray-500 sm:border-gray-300 text-gray-900 placeholder:text-gray-500 bg-white'
const inputClass = `${fieldControlClass} rounded w-full p-2`
const inputCompactClass = `${fieldControlClass} rounded w-full text-sm p-1.5`
const selectClass = `${fieldControlClass} p-2 rounded-lg text-sm w-full`
const textareaClass = `${fieldControlClass} rounded w-full text-sm p-3 min-h-[60px] resize-y`
const readoutClass = `${fieldControlClass} p-2 rounded w-full text-sm font-mono`
/** Hints/instructions: softer than labels so chrome does not compete with content */
const fieldHintClass = 'text-xs text-gray-500'
const fieldHintTinyClass = 'text-[10px] text-gray-500'
/** Field labels stay slightly stronger than hints for scannability */
const fieldLabelTinyClass = 'block text-[10px] text-gray-600 sm:text-gray-500'

export default function PermitTestPage() {
  const [user, setUser] = useState<any>(null)
  const [ownOrganizationId, setOwnOrganizationId] = useState<string | null>(null)
  const [ownProfile, setOwnProfile] = useState<MemberProfile | null>(null)
  const [teamMembers, setTeamMembers] = useState<TeamMemberListItem[]>([])
  const [orgMemberRows, setOrgMemberRows] = useState<MemberProfile[]>([])
  const [teamRosterRows, setTeamRosterRows] = useState<TeamMemberProfile[]>([])
  const [selectedDriverKey, setSelectedDriverKey] = useState('')
  const [defaultDriverKey, setDefaultDriverKey] = useState<string | null>(null)
  const [showDriverPicker, setShowDriverPicker] = useState(false)
  const [loadingDrivers, setLoadingDrivers] = useState(false)
  const autoSelectDriverDoneRef = useRef(false)
  const [loadingAuth, setLoadingAuth] = useState(true)
  const router = useRouter()
  const { workspaceMode, effectiveOrganizationId, activeOrganization } =
    useOrganizationContext(ownOrganizationId)
  const [carrierPrimaryOwnerUserId, setCarrierPrimaryOwnerUserId] = useState<string | null>(null)
  const [carrierPrimaryOwnerError, setCarrierPrimaryOwnerError] = useState<string | null>(null)
  const [loadingPrimaryOwner, setLoadingPrimaryOwner] = useState(false)

  const permitOrganizationId = resolvePermitOrganizationId({
    workspaceMode,
    ownOrganizationId,
    effectiveOrganizationId,
  })

  const loadPermitTeamData = useCallback(
    async (
      supabase: ReturnType<typeof createClient>,
      userId: string,
      profile: MemberProfile | null,
      scopedOrganizationId: string | null
    ) => {
      setLoadingDrivers(true)
      try {
        let members: MemberProfile[] = profile ? [profile] : []
        let roster: TeamMemberProfile[] = []

        if (workspaceMode === 'service' && !scopedOrganizationId) {
          setOrgMemberRows([])
          setTeamRosterRows([])
          setTeamMembers([])
          return
        }

        if (workspaceMode === 'service' && scopedOrganizationId) {
          const [{ data: orgMembers }, { data: rosterRows }] = await Promise.all([
            supabase.from('member_profiles').select('*').eq('organization_id', scopedOrganizationId),
            supabase
              .from('team_member_profiles')
              .select('*')
              .eq('organization_id', scopedOrganizationId)
              .order('created_at', { ascending: true }),
          ])

          if (orgMembers) members = orgMembers as MemberProfile[]
          if (rosterRows) roster = rosterRows as TeamMemberProfile[]

          setOrgMemberRows(members)
          setTeamRosterRows(roster)
          setTeamMembers(buildOrganizationTeamMemberList(members, roster, userId))
          return
        }

        if (profile?.organization_id && isPrimaryOwner(profile)) {
          const [{ data: orgMembers }, { data: rosterRows }] = await Promise.all([
            supabase.from('member_profiles').select('*').eq('organization_id', profile.organization_id),
            supabase
              .from('team_member_profiles')
              .select('*')
              .eq('organization_id', profile.organization_id)
              .order('created_at', { ascending: true }),
          ])

          if (orgMembers) members = orgMembers as MemberProfile[]
          if (rosterRows) roster = rosterRows as TeamMemberProfile[]
        }

        setOrgMemberRows(members)
        setTeamRosterRows(roster)
        setTeamMembers(buildTeamMemberList(profile, members, roster, userId))
      } finally {
        setLoadingDrivers(false)
      }
    },
    [workspaceMode]
  )

  /**
   * Authentication Guard (client-side)
   *
   * - Runs on mount and listens for auth changes.
   * - If no valid Supabase session exists, immediately redirects to /login.
   * - Sets `user` state only for authenticated users.
   * - `loadingAuth` keeps the page in a loading state until we have a definitive answer.
   * - This pattern is consistent with the Dashboard and other protected routes.
   */
  useEffect(() => {
    const supabase = createClient()

    // Initial session check (handles direct URL access / page refresh)
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) {
        router.push('/login')
      } else {
        setUser(session.user)
        const { data: profile } = await supabase
          .from('member_profiles')
          .select('*')
          .eq('user_id', session.user.id)
          .maybeSingle()
        if (profile) {
          const loadedProfile = profile as MemberProfile
          setOwnProfile(loadedProfile)
          if (loadedProfile.organization_id) {
            setOwnOrganizationId(loadedProfile.organization_id)
          }
        }
      }
      setLoadingAuth(false)
    })

    // Real-time listener for login/logout in other tabs or token expiry
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (!session) {
        router.push('/login')
      } else {
        setUser(session.user)
      }
    })

    return () => listener.subscription.unsubscribe()
  }, [router])

  useEffect(() => {
    if (!user || loadingAuth) return

    const supabase = createClient()
    void loadPermitTeamData(supabase, user.id, ownProfile, permitOrganizationId)
  }, [user, loadingAuth, ownProfile, permitOrganizationId, loadPermitTeamData])

  useEffect(() => {
    if (!user || workspaceMode !== 'service' || !effectiveOrganizationId) {
      setCarrierPrimaryOwnerUserId(null)
      setCarrierPrimaryOwnerError(null)
      setLoadingPrimaryOwner(false)
      return
    }

    setLoadingPrimaryOwner(true)
    setCarrierPrimaryOwnerError(null)
    const supabase = createClient()
    void fetchCarrierPrimaryOwnerUserId(supabase, effectiveOrganizationId)
      .then((result) => {
        setCarrierPrimaryOwnerUserId(result.userId)
        setCarrierPrimaryOwnerError(result.error)
        if (result.userId) {
          autoSelectRigDoneRef.current = false
        }
      })
      .finally(() => setLoadingPrimaryOwner(false))
  }, [user, workspaceMode, effectiveOrganizationId])

  // Auto-check migration status once user is authenticated
  useEffect(() => {
    if (!loadingAuth && user) {
      checkMigrationStatus()
    }
  }, [loadingAuth, user])

  // NEW: Load the carrier's saved equipment profiles + new smart rigs
  // Also load decoded tractors/trailers so Rig Selector can show full (tractor+trailer) VehicleDiagram previews.
  useEffect(() => {
    if (!loadingAuth && user) {
      loadEquipmentProfiles()
      loadRigs()
      loadRigTractorsAndTrailers()
    }
  }, [loadingAuth, user, workspaceMode, effectiveOrganizationId, carrierPrimaryOwnerUserId])

  const [formData, setFormData] = useState({
    origin: createEmptyStop(),
    drops: [createEmptyStop()] as DropStop[],
    destination: createEmptyStop(),
    weight: 80000,
    length: 60,
    width: 9.67,
    height: 13.5,
    originLat: undefined as number | undefined,
    originLon: undefined as number | undefined,
    destinationLat: undefined as number | undefined,
    destinationLon: undefined as number | undefined,

    // NEW (Intake Form v2): equipment rig + cargo details per task + migration 009.
    // Use '' for optional text/numeric fields (avoids "Year: 0" display bugs). Numbers only where they have real defaults.
    unitNumber: '',
    vin: '',
    trailerVin: '',
    tractorEmptyWeightLbs: '',
    trailerEmptyWeightLbs: '',
    rigEmptyWeightLbs: '',
    trailerWidthFt: '',
    trailerDeckHeightFt: '',
    year: '',
    make: '',
    model: '',
    axles: 5,
    axleSpacing: '',
    tireWidthIn: 11,
    registeredGvwLbs: 80000,
    kingpinSettingIn: 36,
    trailerMake: '',
    trailerModel: '',
    trailerYear: '',
    trailerLengthFt: 53,
    cargoDescription: '',
    numberOfPieces: DEFAULT_NUMBER_OF_PIECES,
    loadedArrangement: DEFAULT_LOADED_ARRANGEMENT,
    moveType: DEFAULT_MOVE_TYPE,
    cargoMakeModel: '',
    cargoSerialNumber: '',
    cargoManufacturer: '',
    // NEW: Specific load dimensions (distinct from top-level routing envelope fields).
    // Static capture only for now — no calculations or validation.
    loadWeightLbs: '',
    loadLengthFt: '',
    loadWidthFt: '',
    loadHeightFt: '',
    axleWeights: [16000, 16000, 16000, 16000, 16000],
    grossLoadedWeight: 80000,

    ...EMPTY_PERMIT_CARRIER_DRIVER_FIELDS,
  })

  const driverSelectOptions = sortDriverSelectOptionsWithDefault(
    buildDriverSelectOptions(teamMembers),
    defaultDriverKey
  )

  useEffect(() => {
    setDefaultDriverKey(getDefaultPermitDriverKey(permitOrganizationId))
  }, [permitOrganizationId])

  useEffect(() => {
    autoSelectDriverDoneRef.current = false
  }, [workspaceMode, permitOrganizationId])

  // Drop stale driver selection when roster reloads or member is removed
  useEffect(() => {
    if (!selectedDriverKey) return
    const stillValid = driverSelectOptions.some(
      (option) => driverSelectionKey(option) === selectedDriverKey
    )
    if (!stillValid) {
      setSelectedDriverKey('')
      setShowDriverPicker(false)
      setFormData((prev) => ({ ...prev, ...EMPTY_PERMIT_CARRIER_DRIVER_FIELDS }))
      autoSelectDriverDoneRef.current = false
    }
  }, [driverSelectOptions, selectedDriverKey])

  // Reconcile stored default when roster changes (e.g. driver removed or role changed)
  useEffect(() => {
    if (!defaultDriverKey || loadingDrivers) return
    const defaultStillValid = driverSelectOptions.some(
      (option) => driverSelectionKey(option) === defaultDriverKey
    )
    if (!defaultStillValid) {
      clearDefaultPermitDriverKey(permitOrganizationId)
      setDefaultDriverKey(null)
    }
  }, [driverSelectOptions, defaultDriverKey, loadingDrivers, permitOrganizationId])

  // Reset driver picker state when switching workspace or scoped carrier
  useEffect(() => {
    setSelectedDriverKey('')
    setShowDriverPicker(false)
    setFormData((prev) => ({ ...prev, ...EMPTY_PERMIT_CARRIER_DRIVER_FIELDS }))
    autoSelectDriverDoneRef.current = false
  }, [workspaceMode, effectiveOrganizationId])

  const handleDriverSelect = (compositeKey: string) => {
    if (!compositeKey) {
      setSelectedDriverKey('')
      setFormData((prev) => ({ ...prev, ...EMPTY_PERMIT_CARRIER_DRIVER_FIELDS }))
      setShowDriverPicker(false)
      return
    }

    setSelectedDriverKey(compositeKey)
    setShowDriverPicker(false)
    const selection = parseDriverSelectionKey(compositeKey)
    if (!selection) return

    const profileRow = resolveDriverProfileForSelection(
      selection,
      orgMemberRows,
      teamRosterRows,
      ownProfile
    )
    const carrierSource =
      workspaceMode === 'service'
        ? resolveOrgCarrierProfileForAutofill(null, orgMemberRows)
        : resolveOrgCarrierProfileForAutofill(ownProfile, orgMemberRows)
    const patch = memberProfileToPermitAutofill(profileRow, { carrierSource })
    setFormData((prev) => ({
      ...prev,
      ...mergePermitAutofillPatch(pickPermitCarrierDriverFields(prev), patch),
    }))
  }

  const handleSetDefaultDriver = () => {
    if (!selectedDriverKey || !permitOrganizationId) return
    setDefaultPermitDriverKey(permitOrganizationId, selectedDriverKey)
    setDefaultDriverKey(selectedDriverKey)
  }

  const showDriverPickerUi =
    workspaceMode === 'carrier' ||
    (workspaceMode === 'service' && Boolean(effectiveOrganizationId))

  // Auto-select default driver on load (carrier mode or service mode with selected carrier)
  useEffect(() => {
    if (!showDriverPickerUi) return
    if (loadingDrivers) return
    if (driverSelectOptions.length === 0) return
    if (selectedDriverKey) return
    if (autoSelectDriverDoneRef.current) return

    autoSelectDriverDoneRef.current = true
    const storedDefault = getDefaultPermitDriverKey(permitOrganizationId)
    const defaultOption = storedDefault
      ? driverSelectOptions.find((option) => driverSelectionKey(option) === storedDefault)
      : null
    const keyToSelect = defaultOption
      ? storedDefault!
      : driverSelectionKey(driverSelectOptions[0])
    handleDriverSelect(keyToSelect)
  }, [
    showDriverPickerUi,
    loadingDrivers,
    driverSelectOptions,
    selectedDriverKey,
    permitOrganizationId,
  ])

  const [result, setResult] = useState<any>(null)
  const [numberOfPiecesDraft, setNumberOfPiecesDraft] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [geocodeStatus, setGeocodeStatus] = useState('')
  const [isGeocoding, setIsGeocoding] = useState<Record<string, boolean>>({})
  const [showManualCoords, setShowManualCoords] = useState<Record<string, boolean>>({})

  // Per-field cooldown to protect against Nominatim rate limits
  const lastGeocodeAttempt = useRef<Record<string, number>>({})
  const GEOCODE_COOLDOWN_MS = 5000 // 5 seconds between geocoding attempts per field (helps with Nominatim limits)

  const ORTOOLS_TIMEOUT_MS = 300000 // 300 seconds (5 minutes) for OR-Tools calls (longer routes + solver can take time; fixes "This operation was aborted" when proxy/backend is slow)

  // Always keep the latest formData in a ref to avoid stale closures in debounced functions
  const formDataRef = useRef(formData)
  formDataRef.current = formData

  const [errors, setErrors] = useState<Record<string, string>>({})

  // Database migration status
  const [migrationStatus, setMigrationStatus] = useState<any>(null)
  const [checkingMigration, setCheckingMigration] = useState(false)

  // OR-Tools service connection status
  const [ortoolsHealth, setOrToolsHealth] = useState<{
    connected: boolean
    status: 'connected' | 'unreachable'
    message?: string
    version?: string | null
    buildId?: string | null
  } | null>(null)
  const [checkingOrToolsHealth, setCheckingOrToolsHealth] = useState(false)
  const [healthCheckCooldownRemaining, setHealthCheckCooldownRemaining] = useState(0)
  const [restartingOrTools, setRestartingOrTools] = useState(false)
  const [restartOrToolsMessage, setRestartOrToolsMessage] = useState<string | null>(null)

  // Agent result + approval gate
  const [agentResult, setAgentResult] = useState<any>(null)
  const [savedToDatabase, setSavedToDatabase] = useState(false)

  // Change Route feature
  const [showChangeRouteInput, setShowChangeRouteInput] = useState(false)
  // manualRoute (string) is intentionally overloaded for minimal scope:
  // - Free-text prefs/specialInstructions (textarea + voice 'preferences') → sent as specialInstructions on main submit (affects ranking in buildIntelligentCorridor).
  // - Comma-separated 2-letter states for explicit "Change Route" override → parsed to array and sent as manualRoute (bypasses intelligent + prefs entirely; precedence preserved in agent).
  // Help text updated only on prefs textarea; parsing in handleChangeRoute filters to valid codes (often [] for natural language prefs text).
  const [manualRoute, setManualRoute] = useState('')

  // Tier selector for cost estimation (temporary for testing)
  const [selectedTier, setSelectedTier] = useState<'Free' | 'Starter' | 'Pro'>('Starter')

  // Routing engine (kept for payload shape + quick mode force + voice; selector UI replaced by optimizationMode toggle)
  const [routingEngine, setRoutingEngine] = useState<'osrm' | 'graphhopper'>('osrm')
  const optimizationMode = 'ortools' as const

  const [routeProgress, setRouteProgress] = useState<'idle' | 'geocoding' | 'calculating' | 'ready' | 'error'>('idle')
  const [routeProgressDetail, setRouteProgressDetail] = useState('')
  const [showRigPicker, setShowRigPicker] = useState(false)
  const [showRigDetails, setShowRigDetails] = useState(false)
  const [showRouteDetails, setShowRouteDetails] = useState(false)
  const [highwaysExpanded, setHighwaysExpanded] = useState(false)
  const [savedRequestId, setSavedRequestId] = useState<string | null>(null)
  const autoRouteTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const lastRouteFingerprintRef = useRef<string>('')
  const routeAnalysisAbortRef = useRef(0)
  const ortoolsHealthCheckIdRef = useRef(0)
  const ortoolsHealthAbortRef = useRef<AbortController | null>(null)
  const hasCheckedHealthRef = useRef(false)
  const isMountedRef = useRef(true)
  const lastHealthCheckClickRef = useRef(0)
  const healthCheckCooldownTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const restartPollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const checkOrToolsHealthRef = useRef<
    ((options?: { manual?: boolean; skipCooldown?: boolean }) => Promise<{ connected: boolean } | null>) | null
  >(null)
  const HEALTH_CHECK_COOLDOWN_MS = 10_000
  const RESTART_HEALTH_POLL_DELAYS_MS = [3000, 6000, 10000, 15000] as const

  const LEGAL_GROSS_LBS = 80000

  // NEW (Intake v2): equipment profile selector + Quick Route Glance state (declared early so helpers below can reference safely)
  const [equipmentProfiles, setEquipmentProfiles] = useState<any[]>([])
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null)
  const [loadingProfiles, setLoadingProfiles] = useState(false)
  const [glance, setGlance] = useState<any>(null)

  // NEW Smart Rig Builder integration (v3): separate tractors/trailers/rigs from /equipment
  const [rigs, setRigs] = useState<RigConfiguration[]>([])
  const [selectedRigId, setSelectedRigId] = useState<string | null>(null)
  const [selectedRigSnapshot, setSelectedRigSnapshot] = useState<any>(null)
  const [loadingRigs, setLoadingRigs] = useState(false)
  const [loadOverhangFrontFt, setLoadOverhangFrontFt] = useState<number>(0)
  const [loadOverhangRearFt, setLoadOverhangRearFt] = useState<number>(0)
  // NEW: Split of front overhang per requirements (Rig = contributes to envelope; Trailer = permit info only)
  const [loadOverhangFrontTrailerFt, setLoadOverhangFrontTrailerFt] = useState<number>(0)
  const pendingRigIdRef = useRef<string | null>(null)
  const autoSelectRigDoneRef = useRef(false)

  useEffect(() => {
    setSelectedRigId(null)
    setSelectedRigSnapshot(null)
    setSelectedProfileId(null)
    autoSelectRigDoneRef.current = false
  }, [effectiveOrganizationId, workspaceMode])

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search)
      pendingRigIdRef.current = params.get('rigId')
    }
  }, [])

  useEffect(() => {
    const tractorWt = Number(formData.tractorEmptyWeightLbs) || 0
    const trailerWt = Number(formData.trailerEmptyWeightLbs) || 0
    const rigEmpty =
      tractorWt > 0 && trailerWt > 0
        ? tractorWt + trailerWt
        : Number(formData.rigEmptyWeightLbs) || 0
    const rigBaseLength =
      selectedRigSnapshot?.overallLengthFt ?? (Number(formData.trailerLengthFt) || 0)
    const envelope = computeRoutingEnvelope({
      rigLengthFt: rigBaseLength,
      loadOverhangFrontFt,
      loadOverhangRearFt,
      trailerWidthFt: Number(formData.trailerWidthFt) || 0,
      loadWidthFt: Number(formData.loadWidthFt) || 0,
      deckHeightFt: Number(formData.trailerDeckHeightFt) || 0,
      loadHeightFt: Number(formData.loadHeightFt) || 0,
      rigEmptyWeightLbs: rigEmpty,
      loadWeightLbs: Number(formData.loadWeightLbs) || 0,
    })
    setFormData((prev) => {
      const next = { ...prev }
      let changed = false
      if (tractorWt > 0 && trailerWt > 0 && String(next.rigEmptyWeightLbs) !== String(rigEmpty)) {
        next.rigEmptyWeightLbs = String(rigEmpty)
        changed = true
      }
      if (envelope.lengthFt > 0 && Math.abs(next.length - envelope.lengthFt) > 0.01) {
        next.length = envelope.lengthFt
        changed = true
      }
      if (envelope.widthFt > 0 && Math.abs(next.width - envelope.widthFt) > 0.01) {
        next.width = envelope.widthFt
        changed = true
      }
      if (envelope.heightFt > 0 && Math.abs(next.height - envelope.heightFt) > 0.01) {
        next.height = envelope.heightFt
        changed = true
      }
      if (envelope.weightLbs > 0 && Math.abs(next.weight - envelope.weightLbs) > 1) {
        next.weight = envelope.weightLbs
        next.grossLoadedWeight = envelope.weightLbs
        changed = true
        const n = Math.max(1, Math.min(12, Number(prev.axles) || 5))
        next.axleWeights = Array.from({ length: n }, () => Math.round(envelope.weightLbs / n))
      }
      return changed ? next : prev
    })
  }, [
    formData.loadWidthFt, formData.loadHeightFt, formData.loadWeightLbs, formData.trailerLengthFt,
    formData.trailerWidthFt, formData.trailerDeckHeightFt, formData.tractorEmptyWeightLbs,
    formData.trailerEmptyWeightLbs, formData.rigEmptyWeightLbs, loadOverhangFrontFt, loadOverhangRearFt,
    selectedRigSnapshot?.overallLengthFt, formData.axles,
  ])

  // Full tractor/trailer objects (decoded from equipment_profiles RIGBUILDER payloads).
  // Required so VehicleDiagram receives overall_length_ft, fifth_wheel, axle data etc. for full rig graphics.
  const [tractors, setTractors] = useState<Tractor[]>([])
  const [trailers, setTrailers] = useState<Trailer[]>([])

  // === Load Pilot Voice Agent (Week 1 Item 6) ===
  // Uses Web Speech API (SpeechRecognition + SpeechSynthesis)
  const [isListening, setIsListening] = useState(false)
  const [voiceStatus, setVoiceStatus] = useState('')
  const [voiceField, setVoiceField] = useState<string | null>(null)
  const recognitionRef = useRef<any>(null)

  // Simple spoken number parser (supports "eighty thousand", "120000", etc.)
  function parseSpokenNumber(text: string): number {
    const lower = text.toLowerCase()
    const digitMatch = lower.match(/(\d[\d,]*)/)
    if (digitMatch) return parseInt(digitMatch[1].replace(/,/g, ''))

    const wordMap: Record<string, number> = {
      zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
      eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
      twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
      hundred: 100, thousand: 1000, 'one hundred thousand': 100000, 'one hundred twenty thousand': 120000
    }

    let value = 0
    Object.keys(wordMap).forEach(word => {
      if (lower.includes(word)) value += wordMap[word]
    })
    if (lower.includes('thousand') && value < 1000) value *= 1000
    if (lower.includes('hundred') && value < 100) value *= 100

    return value || 0
  }

  function speak(text: string) {
    if ('speechSynthesis' in window) {
      const utterance = new SpeechSynthesisUtterance(text)
      utterance.rate = 0.95
      window.speechSynthesis.speak(utterance)
    }
  }

  function startVoiceInput(field: string) {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SpeechRecognition) {
      alert('Voice input is not supported in this browser. Please use Chrome, Edge, or Safari.')
      return
    }

    const rec = new SpeechRecognition()
    rec.continuous = false
    rec.interimResults = false
    rec.lang = 'en-US'

    recognitionRef.current = rec
    setVoiceField(field)
    setIsListening(true)
    setVoiceStatus(`🎤 Listening for ${field}... Speak clearly`)

    rec.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript.trim()
      setVoiceStatus(`Heard: "${transcript}" — processing...`)
      applyVoiceToField(field, transcript)
    }

    rec.onerror = (event: any) => {
      setVoiceStatus(`Voice error: ${event.error}. Please try again.`)
      setIsListening(false)
      setVoiceField(null)
    }

    rec.onend = () => {
      setIsListening(false)
      setVoiceField(null)
      // Clear status after a moment
      setTimeout(() => setVoiceStatus(''), 1800)
    }

    try {
      rec.start()
    } catch (e) {
      setVoiceStatus('Could not start microphone. Check browser permissions.')
      setIsListening(false)
    }
  }

  function applyVoiceToField(field: string, transcript: string) {
    const text = transcript.toLowerCase()

    if (field === 'origin' || field.startsWith('drop-')) {
      const spoken = transcript.trim()
      if (field === 'origin') {
        updateStopQuery('origin', spoken)
        setTimeout(() => debouncedGeocodeStop('origin'), 300)
      } else {
        const dropId = field.replace('drop-', '')
        const stopKey = `drop-${dropId}` as StopKey
        updateStopQuery(stopKey, spoken)
        setTimeout(() => debouncedGeocodeStop(stopKey), 300)
      }
      speak(`Set ${field} to ${spoken || 'location'}.`)

    } else if (['weight', 'length', 'width', 'height', 'axles', 'registeredGvwLbs', 'kingpinSettingIn', 'tireWidthIn', 'trailerLengthFt', 'grossLoadedWeight', 'loadWeightLbs', 'loadLengthFt', 'loadWidthFt', 'loadHeightFt'].includes(field)) {
      const num = parseSpokenNumber(text)
      if (num > 0) {
        setFormData(prev => ({ ...prev, [field]: num }))
        speak(`${field} set to ${num}.`)
      } else {
        setVoiceStatus('Could not understand the number. Please try again.')
      }
    } else if (['unitNumber', 'vin', 'make', 'model', 'axleSpacing', 'cargoDescription', 'cargoMakeModel', 'cargoSerialNumber', 'cargoManufacturer', 'trailerMake', 'trailerModel', 'year', 'trailerYear'].includes(field)) {
      // Text / mixed fields: take transcript (light cleanup for spoken filler)
      const cleaned = transcript.replace(/\b(the|a|an|please|set|to|for|my)\b/gi, '').trim()
      setFormData(prev => ({ ...prev, [field]: cleaned || transcript }))
      speak(`${field} noted.`)
    } else if (field === 'preferences') {
      // For route preferences / special instructions
      setManualRoute(transcript)
      speak(`Route preference noted: ${transcript}`)
    }
  }

  // Voice confirmation: reads back the current form values
  function confirmWithVoice() {
    const engineLabel = 'Full OR-Tools Optimization'
    const dropSummary = formData.drops.map((d, i) => `Drop ${i + 1}: ${d.query || d.city || 'unset'}`).join('. ')
    const summary = `Pickup: ${formData.origin.query || formData.origin.city || 'unset'}. ${dropSummary}. Weight: ${formData.weight} pounds. Length: ${formData.length} feet. Axles: ${formData.axles}. Gross: ${formData.grossLoadedWeight}. Routing: ${engineLabel}.`
    speak(summary)
    setVoiceStatus('Load Pilot is reading back your details...')
    setTimeout(() => setVoiceStatus(''), 6000)
  }

  // === NEW (Intake v2) real helpers — smallest implementation that satisfies the requirements ===
  // Follows exact existing Supabase client pattern used elsewhere in this file and in history/page.tsx.

  async function loadEquipmentProfiles() {
    if (!user) return
    setLoadingProfiles(true)
    try {
      const supabase = createClient()
      const scope = resolveEquipmentScope({
        workspaceMode,
        ownUserId: user.id,
        ownOrganizationId,
        effectiveOrganizationId,
        carrierPrimaryOwnerUserId,
      })

      if (!scope.canLoadEquipment) {
        setEquipmentProfiles([])
        return
      }

      let query = supabase.from('equipment_profiles').select('*').order('created_at', { ascending: false })

      if (scope.organizationId) {
        query = query.eq('organization_id', scope.organizationId)
      } else if (scope.rigOwnerUserId) {
        query = query.eq('user_id', scope.rigOwnerUserId)
      } else {
        setEquipmentProfiles([])
        return
      }

      const { data, error } = await query
      if (!error) setEquipmentProfiles(data || [])
    } catch (e) {
      console.warn('[intake] loadEquipmentProfiles failed (RLS or table missing?):', e)
    } finally {
      setLoadingProfiles(false)
    }
  }

  // NEW: Load saved rig configurations (from smart Rig Builder) for the top-of-form selector
  async function loadRigs() {
    if (!user) return
    setLoadingRigs(true)
    try {
      const supabase = createClient()
      const scope = resolveEquipmentScope({
        workspaceMode,
        ownUserId: user.id,
        ownOrganizationId,
        effectiveOrganizationId,
        carrierPrimaryOwnerUserId,
      })

      if (!scope.canLoadRigs || !scope.rigOwnerUserId) {
        setRigs([])
        return
      }

      const { data, error } = await supabase
        .from('rig_configurations')
        .select('*')
        .eq('user_id', scope.rigOwnerUserId)
        .order('created_at', { ascending: false })
      if (!error) {
        const loaded = ((data as any) || []).map((r: any) => ({
          ...r,
          is_default: r.is_default ?? false,
        })) as RigConfiguration[]
        setRigs(loaded)
        if (loaded.length > 0 && !selectedRigId && !autoSelectRigDoneRef.current) {
          autoSelectRigDoneRef.current = true
          const urlRigId = pendingRigIdRef.current
          const urlRig = urlRigId ? loaded.find((r) => r.id === urlRigId) : null
          const defaultRig = loaded.find((r) => r.is_default)
          const rigToSelect = urlRig || defaultRig || loaded[0]
          handleSelectRig(rigToSelect)
        }
      }
    } catch (e) {
      console.warn('[intake] loadRigs failed:', e)
    } finally {
      setLoadingRigs(false)
    }
  }

  function formatRigSummaryLine(): string {
    const tractorWt = Number(formData.tractorEmptyWeightLbs) || 0
    const trailerWt = Number(formData.trailerEmptyWeightLbs) || 0
    const rigEmpty =
      tractorWt > 0 && trailerWt > 0
        ? tractorWt + trailerWt
        : Number(formData.rigEmptyWeightLbs) || 0
    const rigBaseLength =
      selectedRigSnapshot?.overallLengthFt ?? (Number(formData.trailerLengthFt) || 0)
    const envelope = computeRoutingEnvelope({
      rigLengthFt: rigBaseLength,
      loadOverhangFrontFt,
      loadOverhangRearFt,
      trailerWidthFt: Number(formData.trailerWidthFt) || 0,
      loadWidthFt: Number(formData.loadWidthFt) || 0,
      deckHeightFt: Number(formData.trailerDeckHeightFt) || 0,
      loadHeightFt: Number(formData.loadHeightFt) || 0,
      rigEmptyWeightLbs: rigEmpty,
      loadWeightLbs: Number(formData.loadWeightLbs) || 0,
    })
    return buildRigSummaryLine({
      name: selectedRigSnapshot?.rigName || 'Custom rig',
      lengthFt: envelope.lengthFt || null,
      widthFt: envelope.widthFt || null,
      heightFt: envelope.heightFt || null,
      weightLbs: envelope.weightLbs || null,
    })
  }

  function rigFieldsFromEquipment(
    fullTractor: Tractor | null,
    fullTrailers: Trailer[],
    rig: RigConfiguration
  ) {
    const primary = primaryTrailerDimensions(fullTrailers)
    const rigEmpty = computeRigEmptyWeightLbs(fullTractor, fullTrailers)
    return {
      unitNumber: fullTractor?.unit_number || '',
      vin: fullTractor?.vin || '',
      trailerVin: primary.vin || '',
      tractorEmptyWeightLbs: fullTractor?.empty_weight_lbs ? String(fullTractor.empty_weight_lbs) : '',
      trailerEmptyWeightLbs: primary.emptyWeightLbs ? String(primary.emptyWeightLbs) : '',
      rigEmptyWeightLbs: rigEmpty ? String(rigEmpty) : '',
      trailerWidthFt: primary.widthFt ? String(primary.widthFt) : '',
      trailerDeckHeightFt: primary.deckHeightFt ? String(primary.deckHeightFt) : '',
      year: fullTractor?.year != null ? String(fullTractor.year) : '',
      make: fullTractor?.make || '',
      model: fullTractor?.model || '',
      axles: rig.computed_total_axles || fullTractor?.num_axles || 5,
      trailerMake: fullTrailers[0]?.make || fullTrailers[0]?.trailer_type || '',
      trailerModel: fullTrailers[0]?.model || '',
      trailerYear: fullTrailers[0]?.year != null ? String(fullTrailers[0].year) : '',
      trailerLengthFt: primary.lengthFt || fullTrailers[0]?.overall_length_ft || 53,
    }
  }

  function buildRouteSummarySentence(primary: any): string {
    const corridor = (primary?.routeCorridor || []).join('-')
    const miles = primary?.distanceMiles ? `${Math.round(primary.distanceMiles).toLocaleString()} miles` : null
    const permitStates = primary?.permitRequiredStates || []
    const permitCount = permitStates.length
    const cost = primary?.estimatedCost != null ? `$${Math.round(primary.estimatedCost).toLocaleString()} estimated` : null
    const parts = [
      corridor ? `Recommended route through ${corridor}` : 'Recommended route calculated',
      miles,
      permitCount > 0 ? `Permits needed in ${permitCount} state${permitCount === 1 ? '' : 's'}` : 'No permits flagged',
      cost,
    ].filter(Boolean)
    return parts.join(' • ')
  }

  // NEW: Load + decode the structured tractor/trailer rows from equipment_profiles.
  // This gives us the rich fields (overall_length_ft, fifth_wheel_from_rear_in, kingpin distances, axle_spacings etc.)
  // that VehicleDiagram + computeRigDimensions require to render a *full* tractor + trailer rig instead of falling back to trailer-only.
  async function loadRigTractorsAndTrailers() {
    if (!user) return
    try {
      const supabase = createClient()
      const scope = resolveEquipmentScope({
        workspaceMode,
        ownUserId: user.id,
        ownOrganizationId,
        effectiveOrganizationId,
        carrierPrimaryOwnerUserId,
      })

      if (!scope.canLoadEquipment) {
        setTractors([])
        setTrailers([])
        return
      }

      let query = supabase.from('equipment_profiles').select('*').order('created_at', { ascending: false })

      if (scope.organizationId) {
        query = query.eq('organization_id', scope.organizationId)
      } else if (scope.rigOwnerUserId) {
        query = query.eq('user_id', scope.rigOwnerUserId)
      } else {
        setTractors([])
        setTrailers([])
        return
      }

      const { data, error } = await query

      if (error) {
        console.warn('[permit-test] loadRigTractorsAndTrailers failed:', error)
        return
      }

      const rows = (data || []) as any[]

      const decoded = rows.map((row) => {
        let meta: any = {}
        let plainNotes = row.notes || ''
        if (typeof row.notes === 'string' && row.notes.startsWith('RIGBUILDER:v1:')) {
          try {
            const jsonPart = row.notes.slice('RIGBUILDER:v1:'.length)
            meta = JSON.parse(jsonPart) || {}
            plainNotes = meta._notes || ''
          } catch (e) {
            console.warn('decode RIGBUILDER payload failed for row', row.id, e)
          }
        }
        return { row, meta, plainNotes }
      })

      // Tractors (exact shape expected by types/equipment.ts + VehicleDiagram)
      const tractorsDecoded = decoded.filter((d) => d.meta.type === 'tractor')
      setTractors(
        tractorsDecoded.map((d) => ({
          id: d.row.id,
          user_id: d.row.user_id,
          profile_name: d.row.profile_name || '',
          overall_length_ft: d.meta.overall_length_ft ?? null,
          num_axles: d.meta.num_axles ?? null,
          steer_axle_setback_in: d.meta.steer_axle_setback_in ?? null,
          wheelbase_in: d.meta.wheelbase_in ?? null,
          axle_spacings: Array.isArray(d.meta.axle_spacings) ? d.meta.axle_spacings : [],
          fifth_wheel_from_rear_in: d.meta.fifth_wheel_from_rear_in ?? null,
          unit_number: d.meta.unit_number ?? d.row.unit_number ?? null,
          license_plate: d.meta.license_plate ?? d.row.license_plate ?? null,
          license_plate_state: normalizeLicensePlateState(d.meta.license_plate_state ?? d.row.license_plate_state) ?? null,
          vin: d.meta.vin ?? d.row.vin ?? null,
          empty_weight_lbs: d.meta.empty_weight_lbs ?? null,
          year: d.meta.year ?? d.row.year ?? null,
          make: d.meta.make ?? d.row.make ?? null,
          model: d.meta.model ?? d.row.model ?? null,
          notes: d.plainNotes || null,
          created_at: d.row.created_at,
          updated_at: d.row.updated_at,
        })) as Tractor[]
      )

      // Trailers
      const trailersDecoded = decoded.filter((d) => d.meta.type === 'trailer')
      setTrailers(
        trailersDecoded.map((d) => ({
          id: d.row.id,
          user_id: d.row.user_id,
          profile_name: d.row.profile_name || '',
          overall_length_ft: d.meta.overall_length_ft ?? d.row.trailer_length_ft ?? null,
          kingpin_distance_from_front_in: d.meta.kingpin_distance_from_front_in ?? null,
          num_axles: d.meta.num_axles ?? null,
          axle_spacings: Array.isArray(d.meta.axle_spacings) ? d.meta.axle_spacings : [],
          kingpin_to_first_axle_in: d.meta.kingpin_to_first_axle_in ?? null,
          has_lift_axle: !!d.meta.has_lift_axle,
          is_extendable: !!d.meta.is_extendable,
          extendable_extra_ft: d.meta.extendable_extra_ft ?? 0,
          trailer_type: d.meta.trailer_type ?? d.row.trailer_make ?? null,
          license_plate: d.meta.license_plate ?? d.row.license_plate ?? null,
          license_plate_state: normalizeLicensePlateState(d.meta.license_plate_state ?? d.row.license_plate_state) ?? null,
          vin: d.meta.vin ?? d.row.vin ?? null,
          empty_weight_lbs: d.meta.empty_weight_lbs ?? null,
          width_ft: d.meta.width_ft ?? null,
          deck_height_ft: d.meta.deck_height_ft ?? null,
          make: d.meta.make ?? d.row.trailer_make ?? null,
          model: d.meta.model ?? d.row.trailer_model ?? null,
          year: d.meta.year ?? d.row.trailer_year ?? null,
          notes: d.plainNotes || null,
          created_at: d.row.created_at,
          updated_at: d.row.updated_at,
        })) as Trailer[]
      )
    } catch (e) {
      console.warn('[permit-test] loadRigTractorsAndTrailers unexpected error', e)
    }
  }

  function handleSelectProfile(profile: any) {
    if (!profile) {
      setSelectedProfileId(null)
      return
    }
    setSelectedProfileId(profile.id)
    setFormData(prev => ({
      ...prev,
      unitNumber: profile.unit_number || '',
      vin: profile.vin || '',
      year: profile.year != null ? String(profile.year) : '',
      make: profile.make || '',
      model: profile.model || '',
      axles: profile.axles || 5,
      axleSpacing: profile.axle_spacing || '',
      tireWidthIn: profile.tire_width_in || 11,
      registeredGvwLbs: profile.registered_gvw_lbs || 80000,
      kingpinSettingIn: profile.kingpin_setting_in || 36,
      trailerMake: profile.trailer_make || '',
      trailerModel: profile.trailer_model || '',
      trailerYear: profile.trailer_year != null ? String(profile.trailer_year) : '',
      trailerLengthFt: profile.trailer_length_ft || 53,
    }))
    setGlance(null)
  }

  // NEW Smart Rig Selector handler (v3) — sets snapshot for clean display + submit payload
  function handleSelectRig(rig: RigConfiguration | null) {
    if (!rig) {
      setSelectedRigId(null)
      setSelectedRigSnapshot(null)
      return
    }
    setSelectedRigId(rig.id)

    // Resolve the *full* Tractor + Trailer objects (with overall_length_ft, 5th wheel, kingpin, axle data).
    // This is the root cause of the "only trailer shows" bug: previous code only stored {id: ...}
    // so VehicleDiagram saw tractorLen=0 → treated the whole thing as isTrailerOnly and skipped TractorGraphic.
    const fullTractor = tractors.find((t) => t.id === rig.tractor_id) || null
    const fullTrailers = (rig.trailer_ids || [])
      .map((tid: string) => trailers.find((tr) => tr.id === tid))
      .filter(Boolean) as Trailer[]

    // Build rich snapshot (now carries the data VehicleDiagram needs + richer audit trail in permit_requests)
    const snap = {
      rigId: rig.id,
      rigName: rig.rig_name,
      overallLengthFt: rig.computed_total_length_ft,
      totalAxles: rig.computed_total_axles,
      tractor: fullTractor || { id: rig.tractor_id },
      trailers: fullTrailers.length > 0 ? fullTrailers : (rig.trailer_ids || []).map((tid: string) => ({ id: tid })),
    }
    setSelectedRigSnapshot(snap)

    const synced = rigFieldsFromEquipment(fullTractor, fullTrailers, rig)
    setFormData((prev) => ({ ...prev, ...synced }))
    setGlance(null)
  }

  // Safety net: if user selected a rig before the async tractor/trailer load finished,
  // re-hydrate the snapshot as soon as the rich objects become available. No-op otherwise.
  useEffect(() => {
    if (!selectedRigId || !rigs.length) return
    const currentRig = rigs.find((r) => r.id === selectedRigId)
    if (!currentRig) return

    const hasRichTractor = tractors.some((t) => t.id === currentRig.tractor_id)
    const hasAnyTrailerData = (currentRig.trailer_ids || []).length === 0 || trailers.length > 0

    if (hasRichTractor && hasAnyTrailerData) {
      // Re-run the resolution (re-uses the same logic)
      const fullTractor = tractors.find((t) => t.id === currentRig.tractor_id) || null
      const fullTrailers = (currentRig.trailer_ids || [])
        .map((tid: string) => trailers.find((tr) => tr.id === tid))
        .filter(Boolean) as Trailer[]

      const snap = {
        rigId: currentRig.id,
        rigName: currentRig.rig_name,
        overallLengthFt: currentRig.computed_total_length_ft,
        totalAxles: currentRig.computed_total_axles,
        tractor: fullTractor || { id: currentRig.tractor_id },
        trailers: fullTrailers.length > 0 ? fullTrailers : (currentRig.trailer_ids || []).map((tid: string) => ({ id: tid })),
      }
      setSelectedRigSnapshot(snap)
      const synced = rigFieldsFromEquipment(fullTractor, fullTrailers, currentRig)
      setFormData((prev) => ({ ...prev, ...synced }))
    }
  }, [tractors, trailers, selectedRigId, rigs])

  async function saveCurrentAsProfile() {
    if (!user) {
      alert('Log in to save equipment profiles.')
      return
    }
    const suggested = `${formData.make || 'Rig'}${formData.unitNumber ? ' #' + formData.unitNumber : ''}${formData.trailerMake ? ' + ' + formData.trailerMake : ''}`
    const name = prompt('Profile name (e.g. "Pete 389 #4721 + 53 flatbed")', suggested || 'My Equipment Profile')
    if (!name || !name.trim()) return
    try {
      const supabase = createClient()
      const rec: any = {
        user_id: user.id,
        profile_name: name.trim(),
        unit_number: formData.unitNumber || null,
        vin: formData.vin || null,
        year: formData.year ? parseInt(String(formData.year)) : null,
        make: formData.make || null,
        model: formData.model || null,
        axles: formData.axles ? Number(formData.axles) : null,
        // Normalize to Postgres text[] literal so it works after migration 011
        // (the column is now text[]; legacy intake used to send a plain string)
        axle_spacing: formData.axleSpacing
          ? `{${String(formData.axleSpacing)
              .split(',')
              .map((s: string) => s.trim())
              .filter(Boolean)
              .join(',')}}`
          : null,
        tire_width_in: formData.tireWidthIn ? Number(formData.tireWidthIn) : null,
        registered_gvw_lbs: formData.registeredGvwLbs ? Number(formData.registeredGvwLbs) : null,
        kingpin_setting_in: formData.kingpinSettingIn ? Number(formData.kingpinSettingIn) : null,
        trailer_make: formData.trailerMake || null,
        trailer_model: formData.trailerModel || null,
        trailer_year: formData.trailerYear ? parseInt(String(formData.trailerYear)) : null,
        trailer_length_ft: formData.trailerLengthFt ? Number(formData.trailerLengthFt) : null,
      }
      const { error } = await supabase.from('equipment_profiles').insert(rec)
      if (error) throw error
      await loadEquipmentProfiles()
      alert(`Saved "${name}". It will now appear in the selector for future requests.`)
    } catch (e: any) {
      alert('Failed to save profile: ' + (e?.message || e))
    }
  }

  function handleQuickGlance() {
    const synced = syncDestinationFromDrops(formData)
    const o = (synced.origin.state || '').toUpperCase()
    const dropStates = synced.drops.map((d) => (d.state || '?').toUpperCase()).join(' → ')
    const d = (synced.destination.state || '').toUpperCase()
    const corridor = dropStates ? `${o || '?'} → ${dropStates}` : `${o || '?'} → ${d || '?'}`

    // Heuristic major highways for the corridors used in this app (AL-NE demo + common long-haul). Matches History badge style.
    let highways: string[] = ['I-40', 'I-80']
    if ((o === 'AL' && d === 'NE') || (o === 'NE' && d === 'AL')) highways = ['I-65', 'I-70', 'I-80']
    else if (o === 'CA' || d === 'CA') highways = ['I-5', 'I-10', 'I-40']
    else if (o === 'TX' || d === 'TX') highways = ['I-10', 'I-20', 'I-35']

    const w = Number(formData.weight) || 80000
    const isLong = (Number(formData.length) || 60) > 60
    const rough = Math.max(65, Math.round(((w - 80000) / 1500) * 11 + (isLong ? 55 : 0) + 50))

    setGlance({
      corridor,
      highways,
      roughFee: rough,
      note: 'Preview only — rough corridor estimate. Full OR-Tools optimization runs automatically below with live DOT restrictions and accurate highways.',
    })
  }

  // Ref for scrolling to results after submission
  const resultsRef = useRef<HTMLDivElement>(null)

  const getStopFromForm = (data: typeof formData, stopKey: StopKey): LocationStop => {
    if (stopKey === 'origin') return data.origin
    const id = String(stopKey).replace('drop-', '')
    return data.drops.find((d) => d.id === id) || createEmptyStop()
  }

  const bumpGeocodeGeneration = (stopKey: StopKey) => {
    geocodeGenerationRef.current[stopKey] = (geocodeGenerationRef.current[stopKey] || 0) + 1
  }

  const clearGeocodeStateForKey = (stopKey: StopKey) => {
    bumpGeocodeGeneration(stopKey)
    if (geocodeTimeoutRef.current[stopKey]) {
      clearTimeout(geocodeTimeoutRef.current[stopKey])
      delete geocodeTimeoutRef.current[stopKey]
    }
    setIsGeocoding((prev) => {
      const next = { ...prev }
      delete next[stopKey]
      return next
    })
    setShowManualCoords((prev) => {
      const next = { ...prev }
      delete next[stopKey]
      return next
    })
  }

  const applyGeocodeToForm = (stopKey: StopKey, result: GeocodeSuccess) => {
    setFormData((prev) => {
      const currentStop = getStopFromForm(prev, stopKey)
      const applied = applyGeocodeToStop(currentStop, result)
      if (stopKey === 'origin') {
        return {
          ...prev,
          origin: applied,
          originLat: result.lat,
          originLon: result.lon,
        }
      }
      const id = String(stopKey).replace('drop-', '')
      const drops = prev.drops.map((d) =>
        d.id === id ? { ...applied, lat: result.lat, lon: result.lon } : d
      )
      return syncDestinationFromDrops({
        ...prev,
        drops,
        destinationLat: undefined,
        destinationLon: undefined,
      })
    })
  }

  const updateStopQuery = (stopKey: StopKey, query: string) => {
    bumpGeocodeGeneration(stopKey)
    setFormData((prev) => {
      if (stopKey === 'origin') {
        return {
          ...prev,
          origin: { ...prev.origin, query, street: '', city: '', state: '', zip: '' },
          originLat: undefined,
          originLon: undefined,
        }
      }
      const id = String(stopKey).replace('drop-', '')
      const drops = prev.drops.map((d) =>
        d.id === id
          ? { ...d, query, street: '', city: '', state: '', zip: '', lat: undefined, lon: undefined }
          : d
      )
      if (!drops.some((d) => d.id === id)) return prev
      return syncDestinationFromDrops({
        ...prev,
        drops,
        destinationLat: undefined,
        destinationLon: undefined,
      })
    })
    const latest =
      stopKey === 'origin'
        ? { ...formDataRef.current.origin, query }
        : {
            ...(formDataRef.current.drops.find((d) => d.id === String(stopKey).replace('drop-', '')) ||
              createEmptyStop()),
            query,
          }
    if (isAddressReadyForGeocode(latest)) debouncedGeocodeStop(stopKey)
  }

  const updateDropCoords = (idx: number, lat?: number, lon?: number) => {
    setFormData((prev) => {
      const drops = [...prev.drops]
      if (!drops[idx]) return prev
      drops[idx] = { ...drops[idx], lat, lon }
      return syncDestinationFromDrops({ ...prev, drops })
    })
    if (errors['geocode']) {
      const { geocode: _, ...rest } = errors
      setErrors(rest)
    }
  }

  const addDrop = () => {
    setFormData((prev) => {
      if (prev.drops.length >= MAX_DROPS) return prev
      return {
        ...prev,
        drops: [...prev.drops, createEmptyStop()],
      }
    })
  }

  const removeDrop = (dropId: string) => {
    clearGeocodeStateForKey(`drop-${dropId}`)
    setFormData((prev) => {
      if (prev.drops.length <= 1) return prev
      const drops = prev.drops.filter((d) => d.id !== dropId)
      return syncDestinationFromDrops({ ...prev, drops })
    })
  }

  // Debounced geocoding with cooldown protection (uses ref to avoid stale formData)
  const debouncedGeocodeStop = useCallback((stopKey: StopKey) => {
    const currentForm = formDataRef.current
    const address = getStopFromForm(currentForm, stopKey)

    if (isGeocoding[stopKey]) return
    if (!isAddressReadyForGeocode(address)) return

    const now = Date.now()
    if (now - (lastGeocodeAttempt.current[stopKey] || 0) < GEOCODE_COOLDOWN_MS) {
      const seconds = Math.ceil(GEOCODE_COOLDOWN_MS / 1000)
      setGeocodeStatus(`Please wait ~${seconds}s before geocoding again`)
      return
    }

    lastGeocodeAttempt.current[stopKey] = now

    if (geocodeTimeoutRef.current[stopKey]) {
      clearTimeout(geocodeTimeoutRef.current[stopKey])
    }

    geocodeTimeoutRef.current[stopKey] = setTimeout(async () => {
      setIsGeocoding((prev) => ({ ...prev, [stopKey]: true }))
      setGeocodeStatus(`Geocoding ${stopKey}...`)

      const latestAddress = getStopFromForm(formDataRef.current, stopKey)
      if (!isAddressReadyForGeocode(latestAddress)) {
        setIsGeocoding((prev) => ({ ...prev, [stopKey]: false }))
        return
      }

      const queryAtStart = buildGeocodeQuery(latestAddress)
      const generation = (geocodeGenerationRef.current[stopKey] || 0)

      try {
        const result = await fetchGeocodeWithRetry(latestAddress)

        if (geocodeGenerationRef.current[stopKey] !== generation) return
        const latestQuery = buildGeocodeQuery(getStopFromForm(formDataRef.current, stopKey))
        if (latestQuery !== queryAtStart) return

        if (result.ok) {
          applyGeocodeToForm(stopKey, result)
          setShowManualCoords((prev) => ({ ...prev, [stopKey]: false }))
          setGeocodeStatus(`${stopKey} geocoded successfully`)
          if (errors['geocode']) {
            const { geocode: _, ...rest } = errors
            setErrors(rest)
          }
        } else if (isGeocodeFailure(result)) {
          setShowManualCoords((prev) => ({ ...prev, [stopKey]: true }))
          setGeocodeStatus(result.userMessage)
        }
      } catch (error: any) {
        console.error('Geocoding error:', error)
        setShowManualCoords((prev) => ({ ...prev, [stopKey]: true }))
        setGeocodeStatus(GEOCODE_BUSY_MESSAGE)
      } finally {
        setIsGeocoding((prev) => ({ ...prev, [stopKey]: false }))
      }
    }, 1200)
  }, [errors, isGeocoding])

  const geocodeTimeoutRef = useRef<Record<string, NodeJS.Timeout | undefined>>({})
  const geocodeGenerationRef = useRef<Record<string, number>>({})

  // Client-side validation (can accept external data for last-chance geocoding)
  function validateForm(data: any = formData): boolean {
    const newErrors: Record<string, string> = {}
    const synced = syncDestinationFromDrops(data)

    if (!synced.origin.query?.trim() && !synced.origin.city?.trim()) {
      newErrors['origin.query'] = 'Pickup location is required'
    }
    if (!hasValidCoords(synced.originLat, synced.originLon)) {
      newErrors['origin.query'] = newErrors['origin.query'] || 'Please geocode pickup or enter coordinates'
    }

    synced.drops.forEach((drop: DropStop, idx: number) => {
      const errKey = `drop-${drop.id}.query`
      if (!drop.query?.trim() && !drop.city?.trim()) {
        newErrors[errKey] = `Drop ${idx + 1} location is required`
      }
      if (!hasValidCoords(drop.lat, drop.lon)) {
        newErrors[errKey] = newErrors[errKey] || `Please geocode drop ${idx + 1}`
      }
    })

    if (!data.weight || data.weight <= 0) newErrors['weight'] = 'Weight must be greater than 0'
    if (!data.length || data.length <= 0) newErrors['length'] = 'Length must be greater than 0'
    if (!data.width || data.width <= 0) newErrors['width'] = 'Width must be greater than 0'
    if (!data.height || data.height <= 0) newErrors['height'] = 'Height must be greater than 0'

    if (!hasValidCoords(synced.destinationLat, synced.destinationLon)) {
      newErrors['geocode'] = 'Please geocode all stops or enter coordinates manually'
    }

    if (workspaceMode === 'service' && !effectiveOrganizationId) {
      newErrors['carrier'] = 'Please select a carrier in the workspace bar'
    }

    if (showDriverPickerUi && !selectedDriverKey) {
      newErrors['driver'] = 'Please select a driver'
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  // Wrapper used by the last-chance logic
  function validateFormWithData(data: any): boolean {
    return validateForm(data)
  }

  // Small helper for uniform primary derivation (addresses Issue 7 suggestion for maintainability across render/approve sites; no behavior change)
  const getPrimary = (ar: any, r: any) => ar?.options?.[0] || ar || r?.agent

  /** Map /api/optimize-route JSON to the agentResult shape (including OSRM fallback). */
  function normalizeOrToolsToAgentData(optData: any) {
    const primaryOpt = optData.primary || optData
    const altsOpt = Array.isArray(optData.alternatives) ? optData.alternatives : []
    const isFallback = !!optData.fallback
    return {
      status: 'pending_review',
      message: optData.message || (isFallback
        ? 'Optimization timed out - falling back to OSRM'
        : 'Full OR-Tools optimization complete.'),
      options: [primaryOpt, ...altsOpt].filter(Boolean),
      _source: isFallback ? 'osrm-fallback' : 'or-tools',
      fallback: isFallback,
      fallbackReason: optData.fallbackReason || null,
      meta: optData.meta || null,
      loadDetails: optData.loadDetails || null,
    }
  }

  const runRouteAnalysis = async () => {
    if (autoRouteTimeoutRef.current) clearTimeout(autoRouteTimeoutRef.current)
    const runId = ++routeAnalysisAbortRef.current

    setResult(null)
    let currentData = syncDestinationFromDrops(formDataRef.current)

    const stopsToGeocode: StopKey[] = []
    if (!hasValidCoords(currentData.originLat, currentData.originLon) && isAddressReadyForGeocode(currentData.origin)) {
      stopsToGeocode.push('origin')
    }
    currentData.drops.forEach((drop) => {
      if (!hasValidCoords(drop.lat, drop.lon) && isAddressReadyForGeocode(drop)) {
        stopsToGeocode.push(dropStopKey(drop))
      }
    })

    if (stopsToGeocode.length > 0) {
      setRouteProgress('geocoding')
      setRouteProgressDetail('Resolving addresses…')
      setLoading(true)

      const geocodeResults: Partial<Record<StopKey, GeocodeSuccess>> = {}
      for (const stopKey of stopsToGeocode) {
        if (runId !== routeAnalysisAbortRef.current) {
          setLoading(false)
          return
        }
        const address = getStopFromForm(currentData, stopKey)
        const result = await fetchGeocodeWithRetry(address)
        if (result.ok) {
          geocodeResults[stopKey] = result
        } else if (isGeocodeFailure(result)) {
          setShowManualCoords((prev) => ({ ...prev, [stopKey]: true }))
          setGeocodeStatus(result.userMessage)
        }
      }

      let nextData = { ...currentData }
      for (const [stopKey, result] of Object.entries(geocodeResults) as [StopKey, GeocodeSuccess][]) {
        if (stopKey === 'origin') {
          nextData = {
            ...nextData,
            origin: applyGeocodeToStop(nextData.origin, result),
            originLat: result.lat,
            originLon: result.lon,
          }
        } else {
          const id = stopKey.replace('drop-', '')
          const drops = nextData.drops.map((d) =>
            d.id === id ? { ...applyGeocodeToStop(d, result), lat: result.lat, lon: result.lon } : d
          )
          nextData = syncDestinationFromDrops({ ...nextData, drops })
        }
      }
      currentData = nextData
      setFormData(currentData)
      setLoading(false)
    }

    if (runId !== routeAnalysisAbortRef.current) return

    currentData = syncDestinationFromDrops(currentData)

    if (!validateFormWithData(currentData)) {
      setRouteProgress('idle')
      setRouteProgressDetail('')
      return
    }

    const fingerprint = [
      currentData.originLat,
      currentData.originLon,
      ...currentData.drops.flatMap((d) => [d.lat, d.lon]),
      currentData.weight,
      currentData.length,
      currentData.width,
      currentData.height,
      manualRoute,
    ].join('|')

    if (fingerprint === lastRouteFingerprintRef.current && agentResult) {
      return
    }

    lastRouteFingerprintRef.current = fingerprint
    setLoading(true)
    setRouteProgress('calculating')
    setRouteProgressDetail('Calculating best route…')

    try {
      const analyzePayload = {
        origin: currentData.origin,
        destination: currentData.destination,
        drops: currentData.drops.map((d) => ({
          query: d.query,
          street: d.street,
          city: d.city,
          state: d.state,
          zip: d.zip,
          lat: d.lat,
          lon: d.lon,
        })),
        weight: currentData.weight,
        length: currentData.length,
        width: currentData.width,
        height: currentData.height,
        originLat: currentData.originLat,
        originLon: currentData.originLon,
        destinationLat: currentData.destinationLat,
        destinationLon: currentData.destinationLon,
        routingEngine,
        specialInstructions: manualRoute,
        trailerLengthFt: Number(currentData.trailerLengthFt) || undefined,
        ...permitFormToLoadDetailsCarrierFields(currentData),
      }

      setRouteProgressDetail('Running OR-Tools optimization…')
      const startTime = Date.now()
      const optResponse = await fetch('/api/optimize-route', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...analyzePayload, optimizationMode: 'ortools' }),
      })
      console.log(`OR-Tools fetch completed in ${Date.now() - startTime} ms`)

      if (runId !== routeAnalysisAbortRef.current) return

      const optData = await optResponse.json()
      if (!optResponse.ok) {
        throw new Error(optData.error || optData.message || `Route optimization failed (HTTP ${optResponse.status}).`)
      }
      if (optData.status && optData.status !== 'ok') {
        throw new Error(optData.error || optData.message || 'Route optimization failed.')
      }

      const agentData = normalizeOrToolsToAgentData(optData)
      setAgentResult(agentData)
      setSavedToDatabase(false)
      setResult(null)
      setRouteProgress('ready')
      setRouteProgressDetail('Route ready')

      setTimeout(() => {
        if (resultsRef.current) {
          const headerOffset = 80
          const elementPosition = resultsRef.current.getBoundingClientRect().top
          window.scrollTo({ top: elementPosition + window.pageYOffset - headerOffset, behavior: 'smooth' })
        }
      }, 50)
    } catch (error: any) {
      if (runId !== routeAnalysisAbortRef.current) return
      setRouteProgress('error')
      setRouteProgressDetail(error.message || 'Route calculation failed')
      setResult({ error: error.message })
    } finally {
      if (runId === routeAnalysisAbortRef.current) {
        setLoading(false)
        // Dev-only: refresh OR-Tools status banner after analyze runs
        if (isDevEnvironment()) {
          void checkOrToolsHealthRef.current?.()
        }
      }
    }
  }

  useEffect(() => {
    const data = syncDestinationFromDrops(formDataRef.current)
    const addressesReady =
      isAddressReadyForGeocode(data.origin) &&
      data.drops.every((drop) => isAddressReadyForGeocode(drop))
    const coordsReady =
      hasValidCoords(data.originLat, data.originLon) &&
      data.drops.every((drop) => hasValidCoords(drop.lat, drop.lon))
    const dimsReady = data.weight > 0 && data.length > 0 && data.width > 0 && data.height > 0
    const anyGeocoding = Object.values(isGeocoding).some(Boolean)

    if (!addressesReady) {
      setRouteProgress('idle')
      setRouteProgressDetail('')
      return
    }

    if (anyGeocoding) {
      setRouteProgress('geocoding')
      setRouteProgressDetail('Geocoding addresses…')
      return
    }

    if (!coordsReady || !dimsReady) return

    if (autoRouteTimeoutRef.current) clearTimeout(autoRouteTimeoutRef.current)
    autoRouteTimeoutRef.current = setTimeout(() => {
      runRouteAnalysis()
    }, 800)

    return () => {
      if (autoRouteTimeoutRef.current) clearTimeout(autoRouteTimeoutRef.current)
    }
  }, [
    formData.originLat, formData.originLon, formData.destinationLat, formData.destinationLon,
    formData.origin.query, formData.origin.city, formData.origin.state,
    formData.drops,
    formData.weight, formData.length, formData.width, formData.height,
    isGeocoding, manualRoute,
  ])

  // New function: Approve & Save (Human Approval Gate)
  const handleApproveAndSave = async () => {
    if (!agentResult) return;

    // Always derive the primary option correctly (supports both single and multi-option shapes)
    const primary = getPrimary(agentResult, null)

    // Open portals synchronously in the click gesture (before await) to reduce popup blocking
    openStatePortals(getPortalStatesForAnalysis(primary), { staggerMs: 0 })

    setLoading(true)

    try {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        setResult({ error: 'You must be logged in to save' })
        setLoading(false)
        return
      }

      // Note: user_id is no longer sent from the client.
      // The server-side /api/permit-requests endpoint (via lib/permit-requests.ts)
      // always derives the correct user_id from the authenticated JWT for security.
      const syncedSave = syncDestinationFromDrops(formData)
      const resolvedPieces = resolvePiecesForSubmit(formData, numberOfPiecesDraft)
      if (numberOfPiecesDraft != null) {
        setNumberOfPiecesDraft(null)
        setFormData((p) => ({ ...p, numberOfPieces: resolvedPieces }))
      }
      const cargoFormData = { ...formData, numberOfPieces: resolvedPieces }
      const savePayload = {
        origin_city: syncedSave.origin.city,
        origin_state: syncedSave.origin.state,
        destination_city: syncedSave.destination.city,
        destination_state: syncedSave.destination.state,
        origin_query: syncedSave.origin.query,
        destination_query: syncedSave.destination.query,
        drops: syncedSave.drops.map((d) => ({
          id: d.id,
          query: d.query,
          street: d.street,
          city: d.city,
          state: d.state,
          zip: d.zip,
          lat: d.lat,
          lon: d.lon,
        })),
        weight: formData.weight,
        length: formData.length,
        width: formData.width,
        height: formData.height,
        route_corridor: primary.routeCorridor || [],
        permit_required_states: primary.permitRequiredStates || [],
        requires_permit: (primary.permitRequiredStates?.length || 0) > 0,
        reasons: primary.reasons || [],
        notes: primary.notes || [],
        estimated_cost: primary.estimatedCost || 0,
        cost_breakdown: null,
        distance_miles: primary.distanceMiles || null,
        duration_hours: primary.durationHours || null,

        // Rich snapshots (full rig + cargo) so History and analytics see exactly what the carrier submitted
        equipment: {
          // Legacy fields kept for compatibility
          unitNumber: formData.unitNumber, vin: formData.vin, year: formData.year, make: formData.make, model: formData.model,
          axles: formData.axles, axleSpacing: formData.axleSpacing, tireWidthIn: formData.tireWidthIn,
          registeredGvwLbs: formData.registeredGvwLbs, kingpinSettingIn: formData.kingpinSettingIn,
          trailerMake: formData.trailerMake, trailerModel: formData.trailerModel, trailerYear: formData.trailerYear, trailerLengthFt: formData.trailerLengthFt,
          profileId: selectedProfileId,
          // NEW smart rig snapshot (preferred when Rig Selector used)
          rig: selectedRigSnapshot || null,
          selectedRigId,
          // Updated overhang snapshot (front split)
          loadOverhangs: {
            frontOfRigFt: loadOverhangFrontFt,
            frontOfTrailerFt: loadOverhangFrontTrailerFt,
            rearFt: loadOverhangRearFt,
          },
        },
        cargo: buildPermitCargoSnapshot(cargoFormData, selectedDriverKey, {
          organizationId: permitOrganizationId,
        }),
      }

      const saveResponse = await fetch('/api/permit-requests', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(savePayload),
      })

      const saveData = await saveResponse.json()

      if (!saveResponse.ok) throw new Error(saveData.error || 'Failed to save')

      const requestId = saveData.data?.id || saveData.data
      setSavedRequestId(requestId)
      setSavedToDatabase(true)
      setResult({
        agent: primary,
        savedToDatabase: saveData.data,
      })

      if (requestId) {
        router.push(`/portal-assist?requestId=${requestId}&step=review`)
      }
    } catch (error: any) {
      setResult({ error: error.message })
    } finally {
      setLoading(false)
    }
  }

  // Approve a specific route option (from the list of alternatives)
  const handleApproveSpecificOption = async (option: any) => {
    if (!option || !agentResult) return;

    // Open portals synchronously in the click gesture (before await) to reduce popup blocking
    openStatePortals(getPortalStatesForAnalysis(option), { staggerMs: 0 })

    setLoading(true)

    try {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        setResult({ error: 'You must be logged in to save' })
        setLoading(false)
        return
      }

      // Note: user_id is no longer sent from the client.
      // The server-side /api/permit-requests endpoint (via lib/permit-requests.ts)
      // always derives the correct user_id from the authenticated JWT for security.
      const syncedSave = syncDestinationFromDrops(formData)
      const resolvedPieces = resolvePiecesForSubmit(formData, numberOfPiecesDraft)
      if (numberOfPiecesDraft != null) {
        setNumberOfPiecesDraft(null)
        setFormData((p) => ({ ...p, numberOfPieces: resolvedPieces }))
      }
      const cargoFormData = { ...formData, numberOfPieces: resolvedPieces }
      const savePayload = {
        origin_city: syncedSave.origin.city,
        origin_state: syncedSave.origin.state,
        destination_city: syncedSave.destination.city,
        destination_state: syncedSave.destination.state,
        origin_query: syncedSave.origin.query,
        destination_query: syncedSave.destination.query,
        drops: syncedSave.drops.map((d) => ({
          id: d.id,
          query: d.query,
          street: d.street,
          city: d.city,
          state: d.state,
          zip: d.zip,
          lat: d.lat,
          lon: d.lon,
        })),
        weight: formData.weight,
        length: formData.length,
        width: formData.width,
        height: formData.height,
        route_corridor: option.routeCorridor || [],
        permit_required_states: option.permitRequiredStates || [],
        requires_permit: (option.permitRequiredStates?.length || 0) > 0,
        reasons: option.reasons || [],
        notes: option.notes || [],
        estimated_cost: option.estimatedCost || 0,
        cost_breakdown: null,
        distance_miles: option.distanceMiles || null,
        duration_hours: option.durationHours || null,

        // Rich snapshots (full rig + cargo) so History and analytics see exactly what the carrier submitted
        equipment: {
          // Legacy fields kept for compatibility
          unitNumber: formData.unitNumber, vin: formData.vin, year: formData.year, make: formData.make, model: formData.model,
          axles: formData.axles, axleSpacing: formData.axleSpacing, tireWidthIn: formData.tireWidthIn,
          registeredGvwLbs: formData.registeredGvwLbs, kingpinSettingIn: formData.kingpinSettingIn,
          trailerMake: formData.trailerMake, trailerModel: formData.trailerModel, trailerYear: formData.trailerYear, trailerLengthFt: formData.trailerLengthFt,
          profileId: selectedProfileId,
          // NEW smart rig snapshot (preferred when Rig Selector used)
          rig: selectedRigSnapshot || null,
          selectedRigId,
          // Updated overhang snapshot (front split)
          loadOverhangs: {
            frontOfRigFt: loadOverhangFrontFt,
            frontOfTrailerFt: loadOverhangFrontTrailerFt,
            rearFt: loadOverhangRearFt,
          },
        },
        cargo: buildPermitCargoSnapshot(cargoFormData, selectedDriverKey, {
          organizationId: permitOrganizationId,
        }),
      }

      const saveResponse = await fetch('/api/permit-requests', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(savePayload),
      })

      const saveData = await saveResponse.json()

      if (!saveResponse.ok) throw new Error(saveData.error || 'Failed to save')

      // Normalize agentResult so the approved option becomes the primary (options[0])
      const normalizedAgentResult = {
        ...agentResult,
        options: [option],
      }

      const requestId = saveData.data?.id || saveData.data

      setAgentResult(normalizedAgentResult)
      setSavedRequestId(requestId)
      setSavedToDatabase(true)
      setResult({
        agent: option,
        savedToDatabase: saveData.data,
      })

      if (requestId) {
        router.push(`/portal-assist?requestId=${requestId}&step=review`)
      }
    } catch (error: any) {
      setResult({ error: error.message })
    } finally {
      setLoading(false)
    }
  }

  // Reject & Start Over (Human Approval Gate)
  const handleRejectAndRestart = () => {
    setAgentResult(null)
    setSavedToDatabase(false)
    setResult(null)
    setShowChangeRouteInput(false)
    setManualRoute('')
    // Scroll back to the form for convenience
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // Handle manual route change (Change Route feature)
  const handleChangeRoute = async () => {
    if (!manualRoute.trim()) return

    // Parse comma-separated states (e.g. "AL, MS, TN, MO, NE")
    const states = manualRoute
      .split(',')
      .map(s => s.trim().toUpperCase())
      .filter(s => s.length === 2)

    if (states.length === 0) {
      alert('Please enter a valid list of state codes (e.g., AL, MS, TN, MO, NE)')
      return
    }

    setLoading(true)
    setShowChangeRouteInput(false)

    try {
      // Re-run — if OR-Tools mode, hit /api/optimize-route (same payload shape); else existing analyze-permit. Normalize for or-tools.
      if (optimizationMode === 'ortools') {
        const synced = syncDestinationFromDrops(formData)
        const changePayload = {
          origin: synced.origin,
          destination: synced.destination,
          drops: synced.drops.map((d) => ({
            query: d.query,
            street: d.street,
            city: d.city,
            state: d.state,
            zip: d.zip,
            lat: d.lat,
            lon: d.lon,
          })),
          weight: formData.weight,
          length: formData.length,
          width: formData.width,
          height: formData.height,
          originLat: synced.originLat,
          originLon: synced.originLon,
          destinationLat: synced.destinationLat,
          destinationLon: synced.destinationLon,
          routingEngine,
          manualRoute: states,
          trailerLengthFt: Number(formData.trailerLengthFt) || undefined,
          ...permitFormToLoadDetailsCarrierFields(formData),
        }
        const startTime = Date.now()
        console.log('OR-Tools fetch started')
        const optResponse = await fetch('/api/optimize-route', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(changePayload),
        })
        const elapsed = Date.now() - startTime
        console.log('OR-Tools fetch completed in', elapsed, 'ms')
        const optData = await optResponse.json()
        if (!optResponse.ok) {
          console.error('[or-tools] change-route error details:', optData.error || optData.message, optData)
          throw new Error(optData.error || optData.message || 'OR-Tools failed on change route.')
        }
        if (optData.status && optData.status !== 'ok') {
          console.error('[or-tools] change-route non-ok:', optData)
          throw new Error(optData.error || optData.message || 'OR-Tools failed on change route.')
        }
        if (optData.fallback) {
          console.warn('[or-tools] change-route OSRM fallback:', optData.fallbackReason)
        }
        setAgentResult(normalizeOrToolsToAgentData({
          ...optData,
          message: optData.message || (optData.fallback
            ? 'Optimization timed out - falling back to OSRM'
            : 'Full OR-Tools optimization (changed route).'),
        }))
      } else {
        // Existing quick path unchanged. Use explicit payload subset (parity with or-tools changePayload + submit analyzePayload; Issue 11).
        const synced = syncDestinationFromDrops(formData)
        const response = await fetch('/api/analyze-permit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            origin: synced.origin,
            destination: synced.destination,
            drops: synced.drops.map((d) => ({
              id: d.id,
              query: d.query,
              street: d.street,
              city: d.city,
              state: d.state,
              zip: d.zip,
              lat: d.lat,
              lon: d.lon,
            })),
            weight: formData.weight,
            length: formData.length,
            width: formData.width,
            height: formData.height,
            originLat: synced.originLat,
            originLon: synced.originLon,
            destinationLat: synced.destinationLat,
            destinationLon: synced.destinationLon,
            routingEngine,
            manualRoute: states,
            trailerLengthFt: Number(formData.trailerLengthFt) || undefined,
            ...permitFormToLoadDetailsCarrierFields(formData),
          }),
        })

        const newAgentData = await response.json()

        if (!response.ok) {
          const rawError = newAgentData.error || 'Agent failed on new route'
          console.error('[quick] change-route analyze-permit error details:', rawError, newAgentData)
          throw new Error('Permit analysis failed on new route. Please check your inputs or try again.')
        }

        setAgentResult(newAgentData)
      }
      setResult(null) // clear any prior error banner (mirrors submit at 892; addresses Issue 2 + 6)
      setSavedToDatabase(false)
      setManualRoute('')
    } catch (error: any) {
      setResult({ error: error.message }) // make change-route errors (incl or-tools) surface in nice banner like submit; keep alert secondary for immediate feedback
      alert('Failed to analyze the new route: ' + error.message)
      setShowChangeRouteInput(true) // keep input open on error
    } finally {
      setLoading(false)
      // Dev-only: refresh OR-Tools status banner after change-route runs
      if (isDevEnvironment() && optimizationMode === 'ortools') {
        void checkOrToolsHealthRef.current?.()
      }
    }
  }

  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
      ortoolsHealthAbortRef.current?.abort()
      if (healthCheckCooldownTimerRef.current) {
        clearTimeout(healthCheckCooldownTimerRef.current)
      }
      if (restartPollTimeoutRef.current) {
        clearTimeout(restartPollTimeoutRef.current)
        restartPollTimeoutRef.current = null
      }
    }
  }, [])

  const startHealthCheckCooldown = useCallback(() => {
    lastHealthCheckClickRef.current = Date.now()
    setHealthCheckCooldownRemaining(HEALTH_CHECK_COOLDOWN_MS)
    if (healthCheckCooldownTimerRef.current) {
      clearTimeout(healthCheckCooldownTimerRef.current)
    }
    healthCheckCooldownTimerRef.current = setTimeout(() => {
      healthCheckCooldownTimerRef.current = null
      if (isMountedRef.current) setHealthCheckCooldownRemaining(0)
    }, HEALTH_CHECK_COOLDOWN_MS)
  }, [])

  const checkOrToolsHealth = useCallback(async (options?: { manual?: boolean; skipCooldown?: boolean }) => {
    if (options?.manual && !options?.skipCooldown) {
      const elapsed = Date.now() - lastHealthCheckClickRef.current
      if (elapsed < HEALTH_CHECK_COOLDOWN_MS) return null
      startHealthCheckCooldown()
    }

    ortoolsHealthAbortRef.current?.abort()
    const controller = new AbortController()
    ortoolsHealthAbortRef.current = controller
    const runId = ++ortoolsHealthCheckIdRef.current

    if (!isMountedRef.current) return null
    setCheckingOrToolsHealth(true)

    try {
      const res = await fetch('/api/ortools-health', { signal: controller.signal })
      if (runId !== ortoolsHealthCheckIdRef.current || !isMountedRef.current) return null

      if (!res.ok) {
        const unreachable = {
          connected: false,
          status: 'unreachable' as const,
          message: `Health check failed (HTTP ${res.status})`,
        }
        setOrToolsHealth(unreachable)
        return { connected: false }
      }

      const data = await res.json()
      if (runId !== ortoolsHealthCheckIdRef.current || !isMountedRef.current) return null

      const health = {
        connected: Boolean(data.connected),
        status: data.status === 'connected' ? ('connected' as const) : ('unreachable' as const),
        message: typeof data.message === 'string' ? data.message : undefined,
        version: typeof data.version === 'string' ? data.version : null,
        buildId: typeof data.buildId === 'string' ? data.buildId : null,
      }
      setOrToolsHealth(health)
      return { connected: health.connected }
    } catch (e) {
      if (controller.signal.aborted || runId !== ortoolsHealthCheckIdRef.current || !isMountedRef.current) {
        return null
      }
      setOrToolsHealth({
        connected: false,
        status: 'unreachable',
        message: 'Failed to check OR-Tools health',
      })
      return { connected: false }
    } finally {
      if (runId === ortoolsHealthCheckIdRef.current && isMountedRef.current) {
        setCheckingOrToolsHealth(false)
      }
    }
  }, [startHealthCheckCooldown])

  checkOrToolsHealthRef.current = checkOrToolsHealth

  const waitForRestartPollDelay = useCallback((delayMs: number) => {
    return new Promise<void>((resolve) => {
      if (restartPollTimeoutRef.current) {
        clearTimeout(restartPollTimeoutRef.current)
      }
      restartPollTimeoutRef.current = setTimeout(() => {
        restartPollTimeoutRef.current = null
        resolve()
      }, delayMs)
    })
  }, [])

  const restartOrToolsService = useCallback(async () => {
    if (restartingOrTools) return

    setRestartingOrTools(true)
    setRestartOrToolsMessage(null)

    try {
      const res = await fetch('/api/restart-ortools', { method: 'POST' })
      const data = await res.json().catch(() => ({}))

      if (!res.ok) {
        const fallback = typeof data.command === 'string' ? data.command : 'npm run restart:ortools'
        setRestartOrToolsMessage(
          data.message ||
            data.error ||
            `Restart failed (HTTP ${res.status}). Run \`${fallback}\` in a terminal.`
        )
        return
      }

      setRestartOrToolsMessage(
        typeof data.message === 'string'
          ? data.message
          : 'Restart initiated — waiting for service to come back…'
      )

      let lastDelay = 0
      let serviceRecovered = false

      for (const delayMs of RESTART_HEALTH_POLL_DELAYS_MS) {
        const waitMs = delayMs - lastDelay
        lastDelay = delayMs
        await waitForRestartPollDelay(waitMs)
        if (!isMountedRef.current) return

        const result = await checkOrToolsHealth({ skipCooldown: true })
        if (result?.connected) {
          serviceRecovered = true
          setRestartOrToolsMessage('OR-Tools service is back online.')
          break
        }
      }

      if (!serviceRecovered && isMountedRef.current) {
        setRestartOrToolsMessage(
          'Restart initiated, but the service is still unreachable. Try Test Connection again in a few seconds.'
        )
      }
    } catch {
      setRestartOrToolsMessage(
        'Restart request failed. Run `npm run restart:ortools` in a terminal at the repo root.'
      )
    } finally {
      if (restartPollTimeoutRef.current) {
        clearTimeout(restartPollTimeoutRef.current)
        restartPollTimeoutRef.current = null
      }
      if (isMountedRef.current) {
        setRestartingOrTools(false)
      }
    }
  }, [restartingOrTools, checkOrToolsHealth, waitForRestartPollDelay])

  // Auto-check OR-Tools health once per mount after auth (dev-only debug chrome)
  useEffect(() => {
    if (!isDevEnvironment()) return
    if (!loadingAuth && user?.id && !hasCheckedHealthRef.current) {
      hasCheckedHealthRef.current = true
      checkOrToolsHealth()
    }
  }, [loadingAuth, user?.id, checkOrToolsHealth])

  // Re-probe when user returns to tab if service was unreachable (dev-only)
  useEffect(() => {
    if (!isDevEnvironment()) return
    const onFocus = () => {
      if (ortoolsHealth?.status === 'unreachable' && !checkingOrToolsHealth) {
        void checkOrToolsHealth()
      }
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [ortoolsHealth?.status, checkingOrToolsHealth, checkOrToolsHealth])

  // Check if the new columns have been added to permit_requests
  async function checkMigrationStatus() {
    setCheckingMigration(true)
    try {
      const res = await fetch('/api/admin/migrate')
      if (res.status === 401) {
        setMigrationStatus({
          authRequired: true,
          error: 'Admin access required. Sign in with an admin account.',
        })
        return
      }
      if (res.status === 403) {
        setMigrationStatus({
          adminAccessDenied: true,
          error: 'Admin access required. Your account is not authorized for schema management.',
        })
        return
      }
      const data = await res.json()
      setMigrationStatus(data)
    } catch (e) {
      setMigrationStatus({ error: 'Failed to check schema status' })
    } finally {
      setCheckingMigration(false)
    }
  }

  async function applyMigration() {
    const res = await fetch('/api/admin/migrate', { method: 'POST' })
    if (res.status === 401 || res.status === 403) {
      alert('Admin access required to apply migrations.')
      return
    }
    const data = await res.json()

    if (data.applied && data.success) {
      alert('Migration applied successfully. Schema columns are now available.')
    } else if (data.needsManualRun && data.sql) {
      alert('Please run the following SQL in Supabase SQL Editor:\n\n' + data.sql)
    } else if (data.error) {
      alert(`Migration failed: ${data.error}`)
    }
    setTimeout(checkMigrationStatus, 1500)
  }

  const handleLogout = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  // === Authentication Protection ===
  // While we are still checking the Supabase session, show a clean loading state.
  // This prevents any flash of the protected form and ensures unauthenticated
  // users are redirected before they can interact with the page.
  if (loadingAuth) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          {/* TruckerOS brand mark */}
          <div className="w-14 h-14 bg-black rounded-xl flex items-center justify-center mx-auto mb-4 shadow-sm">
            <span className="text-white text-3xl font-bold tracking-tighter">T</span>
          </div>
          <p className="text-gray-700 font-semibold text-lg">Checking authentication...</p>
          <p className="text-gray-600 sm:text-gray-500 text-sm mt-1">Please wait while we verify your session</p>
        </div>
      </div>
    )
  }

  return (
    /* Sticky header must not live under overflow-x-clip (breaks position:sticky). */
    <div className="w-full min-w-0">
      {/* Professional Header — outside clipped content shell */}
      <header className="border-b bg-white sticky top-0 z-50">
        <div className="max-w-3xl mx-auto px-4 sm:px-8 py-3 sm:py-4 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <a href="/" className="flex items-center gap-2 sm:gap-2.5 min-w-0">
              <div className="w-8 h-8 bg-black rounded flex items-center justify-center shrink-0">
                <span className="text-white text-lg font-bold tracking-tighter">T</span>
              </div>
              <span className="text-lg sm:text-xl font-semibold tracking-tight truncate">TruckerOS</span>
            </a>
          </div>

          <div className="flex items-center gap-2 sm:gap-4 text-xs sm:text-sm flex-wrap justify-end max-w-full">
            <a href="/dashboard" className="inline-flex items-center min-h-[40px] px-1.5 font-medium text-gray-700 hover:text-black touch-manipulation">Dashboard</a>
            <a href="/equipment" className="inline-flex items-center min-h-[40px] px-1.5 font-medium text-gray-700 hover:text-black touch-manipulation">Equipment</a>
            <a href="/history" className="inline-flex items-center min-h-[40px] px-1.5 font-medium text-gray-700 hover:text-black touch-manipulation">History</a>
            {workspaceMode === 'service' && (
              <a href="/carriers" className="inline-flex items-center min-h-[40px] px-1.5 font-medium text-gray-700 hover:text-black touch-manipulation">Carriers</a>
            )}
            <div className="w-px h-4 bg-gray-300 mx-0.5 sm:mx-1" />
            {user && <span className="text-gray-600 hidden md:inline text-sm">{user.email}</span>}
            <button 
              onClick={handleLogout} 
              className="inline-flex items-center justify-center min-h-[40px] px-3 sm:px-4 py-2 text-xs sm:text-sm border border-gray-300 hover:bg-gray-50 rounded-lg transition-colors shrink-0 touch-manipulation"
            >
              Logout
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-4 py-6 sm:px-8 sm:pb-8 w-full min-w-0">
      <CarrierContextBar ownOrganizationId={ownOrganizationId} />
      <ActiveCarrierBanner ownOrganizationId={ownOrganizationId} />

      <div className="mb-8">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">New Route Analysis</h1>
          <p className="text-sm text-gray-700 sm:text-gray-600 mt-1.5 leading-relaxed">
            Work top to bottom: choose driver and rig, enter load details, optional route preferences, then pickup and drops.
            Routing and permits run automatically once addresses geocode.
          </p>
        </div>

        {/* OR-Tools Service Connection Status — dev-only debug chrome (hidden in production) */}
        {isDevEnvironment() && (() => {
          const isOrToolsChecking = checkingOrToolsHealth || ortoolsHealth === null
          const isHealthProbeTimeout = ortoolsHealth?.message?.toLowerCase().includes('timed out') ?? false
          return (
            <div
              className={`mt-4 p-4 rounded-xl border flex flex-wrap items-center gap-3 ${
                isOrToolsChecking
                  ? 'bg-gray-50 border-gray-200 text-gray-700'
                  : ortoolsHealth?.connected
                    ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
                    : ortoolsHealth?.status === 'unreachable'
                      ? 'bg-amber-50 border-amber-300 text-amber-900'
                      : 'bg-gray-50 border-gray-200 text-gray-700'
              }`}
            >
              <div className="flex flex-col gap-1 flex-1 min-w-[200px]">
                <div className="flex items-center gap-2">
                  <div
                    className={`w-3 h-3 rounded-full shrink-0 ${
                      isOrToolsChecking
                        ? 'bg-gray-400 animate-pulse'
                        : ortoolsHealth?.connected
                          ? 'bg-emerald-500'
                          : ortoolsHealth?.status === 'unreachable'
                            ? 'bg-amber-500'
                            : 'bg-gray-400'
                    }`}
                  />
                  <span className="font-semibold">
                    {isOrToolsChecking
                      ? 'OR-Tools: Checking…'
                      : ortoolsHealth?.connected
                        ? 'OR-Tools: Connected'
                        : ortoolsHealth?.status === 'unreachable'
                          ? 'OR-Tools: Unreachable'
                          : 'OR-Tools: Checking…'}
                  </span>
                  {ortoolsHealth?.message && !isOrToolsChecking && (
                    <span className="text-xs opacity-80">— {ortoolsHealth.message}</span>
                  )}
                </div>
                {!isOrToolsChecking && ortoolsHealth?.connected && (ortoolsHealth.version || ortoolsHealth.buildId) && (
                  <p className="text-xs opacity-80 pl-5 font-mono">
                    v{ortoolsHealth.version || '?'}
                    {ortoolsHealth.buildId ? ` · build ${ortoolsHealth.buildId}` : ''}
                  </p>
                )}
                {!isOrToolsChecking && ortoolsHealth?.status === 'unreachable' && (
                  <div className="text-xs opacity-80 pl-5 space-y-0.5">
                    <p>
                      {isHealthProbeTimeout
                        ? 'Quick 5s health probe timed out — the service may still be running but busy; full optimization can take several minutes.'
                        : 'Health probe could not reach OR-Tools — ensure the service is running on port 8000.'}
                    </p>
                    <p>Route analysis may still fall back to OSRM corridor routing.</p>
                  </div>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => checkOrToolsHealth({ manual: true })}
                  disabled={isOrToolsChecking || healthCheckCooldownRemaining > 0 || restartingOrTools}
                  className="text-xs px-3 py-1.5 bg-white border border-gray-300 hover:bg-gray-50 rounded-lg disabled:opacity-50 font-medium transition-colors"
                >
                  {isOrToolsChecking
                    ? 'Testing…'
                    : healthCheckCooldownRemaining > 0
                      ? 'Wait 10s'
                      : 'Test Connection'}
                </button>
                <button
                  type="button"
                  onClick={() => void restartOrToolsService()}
                  disabled={restartingOrTools || isOrToolsChecking}
                  className="text-sm px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg disabled:opacity-50 font-semibold shadow-sm transition-colors"
                  title="Kill hung OR-Tools on port 8000 and start a fresh uvicorn process"
                >
                  {restartingOrTools ? 'Restarting…' : '🔄 Restart OR-Tools Service'}
                </button>
              </div>
            </div>
          )
        })()}

        {isDevEnvironment() && restartOrToolsMessage && (
          <div className="mt-2 p-3 rounded-lg border border-indigo-200 bg-indigo-50 text-indigo-900 text-sm">
            {restartOrToolsMessage}
            <span className="block mt-1 text-xs text-indigo-700">
              Manual fallback: <code className="font-mono bg-white/70 px-1 rounded">npm run restart:ortools</code>
            </span>
          </div>
        )}

        {/* Load Pilot Voice Agent Status */}
        {(voiceStatus || isListening) && (
          <div className={`mt-4 p-3 rounded-xl text-sm flex items-center gap-3 border ${isListening ? 'bg-blue-50 border-blue-200 text-blue-800' : 'bg-gray-50 border-gray-200 text-gray-700'}`}>
            <div className={`w-2 h-2 rounded-full ${isListening ? 'bg-blue-500 animate-pulse' : 'bg-gray-400'}`} />
            <span className="font-medium">Load Pilot:</span> {voiceStatus || 'Ready for voice input'}
            {isListening && (
              <button onClick={() => { recognitionRef.current?.stop(); setIsListening(false); setVoiceStatus('') }} className="ml-auto text-xs px-2 py-0.5 bg-white border rounded">
                Stop
              </button>
            )}
          </div>
        )}

        {/* Quick Voice Actions */}
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          <span className="text-gray-500">Load Pilot:</span>
          <button
            type="button"
            onClick={confirmWithVoice}
            className="px-3 py-1.5 min-h-[36px] bg-white border border-gray-300 hover:bg-gray-50 rounded-full text-gray-700 transition flex items-center gap-1 touch-manipulation"
            title="Have Load Pilot read back all current values using text-to-speech"
          >
            🔊 Read back values
          </button>
          <span className="text-gray-500">• Tap 🎤 next to a field for voice input</span>
        </div>
      </div>

      <form onSubmit={(e) => e.preventDefault()} className="space-y-8">
        {/* Form Card Wrapper for polished look */}
        <div className="bg-white border border-gray-200 rounded-2xl p-4 sm:p-6 space-y-8 shadow-sm min-w-0">
        {/* Validation Errors */}
        {Object.keys(errors).length > 0 && (
          <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
            Please fix the following before submitting:
            <ul className="list-disc list-inside mt-1">
              {Object.values(errors).map((err, i) => <li key={i}>{err}</li>)}
            </ul>
          </div>
        )}

        {/* Permit driver & carrier — picker in carrier mode and service mode (carrier from header) */}
        <section className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">1. Driver for this load</h2>
            <p className={`${fieldHintClass} mt-0.5`}>
              Pick who is driving. Carrier details from their profile fill in for permit forms.
            </p>
          </div>

          {workspaceMode === 'service' && !effectiveOrganizationId && (
            <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              Select a carrier in the workspace bar above to load drivers and equipment for that carrier.
            </p>
          )}

          {showDriverPickerUi && (
            <>
              <div className="flex items-center justify-between gap-3 text-sm text-gray-600 py-1">
                <div className="min-w-0">
                  {loadingDrivers ? (
                    <span>Loading drivers…</span>
                  ) : driverSelectOptions.length === 0 ? (
                    <span>
                      {workspaceMode === 'service'
                        ? (
                          <>
                            No drivers on this carrier.{' '}
                            <a href="/carriers" className="text-emerald-700 underline underline-offset-2">
                              Manage carriers
                            </a>
                            {migrationStatus?.needsMigration && (
                              <span className="block text-xs text-amber-700 mt-1">
                                If drivers should exist, ensure migration 024/025 (service-mode RLS) has been applied.
                              </span>
                            )}
                          </>
                        )
                        : (
                          <>
                            No drivers on your team.{' '}
                            <a href="/profile" className="text-emerald-700 underline underline-offset-2">
                              Add drivers on your profile
                            </a>
                          </>
                        )}
                    </span>
                  ) : selectedDriverKey ? (
                    <span className="text-gray-900">
                      {selectedDriverKey === defaultDriverKey && (
                        <span className="text-amber-500 mr-1" title="Default driver">
                          ★
                        </span>
                      )}
                      {formatDriverSummaryLine(pickPermitCarrierDriverFields(formData))}
                    </span>
                  ) : (
                    <span>No driver selected</span>
                  )}
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  {selectedDriverKey && selectedDriverKey !== defaultDriverKey && (
                    <button
                      type="button"
                      onClick={handleSetDefaultDriver}
                      className="text-xs text-gray-600 hover:text-gray-900 border border-gray-300 rounded-lg px-2 py-1 hover:bg-gray-50"
                      title="Use this driver automatically in Permit Agent"
                    >
                      Set as Default
                    </button>
                  )}
                  {driverSelectOptions.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setShowDriverPicker((v) => !v)}
                      className="text-xs text-emerald-700 hover:text-emerald-900 underline underline-offset-2"
                    >
                      {selectedDriverKey ? 'Change Driver' : 'Select Driver'}
                    </button>
                  )}
                </div>
              </div>
              {showDriverPicker && driverSelectOptions.length > 0 && (
                <div className="border border-gray-200 bg-gray-50 rounded-xl p-3 space-y-2">
                  <select
                    id="permit-select-driver"
                    value={selectedDriverKey}
                    onChange={(e) => handleDriverSelect(e.target.value)}
                    className={selectClass}
                  >
                    <option value="">— Select a driver —</option>
                    {driverSelectOptions.map((option) => (
                      <option key={driverSelectionKey(option)} value={driverSelectionKey(option)}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  {workspaceMode === 'carrier' && (
                    <a href="/profile" className={`text-xs text-gray-600 sm:text-gray-500 hover:text-gray-700`}>
                      Manage drivers →
                    </a>
                  )}
                </div>
              )}
            </>
          )}
        </section>

        {workspaceMode === 'service' && effectiveOrganizationId && carrierPrimaryOwnerError && (
          <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            Could not load carrier rigs: {carrierPrimaryOwnerError}. Equipment profiles may still load by organization.
          </p>
        )}

        {workspaceMode === 'service' && effectiveOrganizationId && loadingPrimaryOwner && (
          <p className="text-sm text-gray-600">Resolving carrier equipment owner…</p>
        )}

        {/* Primary rig — auto-loaded; change only when needed */}
        <section className="space-y-2">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">2. Rig</h2>
            <p className={`${fieldHintClass} mt-0.5`}>
              Default rig loads when available. Change only if this load uses different equipment.
            </p>
          </div>
        <div className="flex items-center justify-between text-sm text-gray-600 py-1">
          <div>
            {loadingRigs || loadingPrimaryOwner ? (
              <span>Loading your rig…</span>
            ) : selectedRigSnapshot ? (
              <span className="font-mono text-xs sm:text-sm text-gray-900 tracking-tight">{formatRigSummaryLine()}</span>
            ) : rigs.length === 0 ? (
              <span>
                {workspaceMode === 'service'
                  ? 'No saved rig for this carrier.'
                  : (
                    <>
                      No saved rig —{' '}
                      <a href="/equipment" className="text-emerald-700 underline">
                        add one in Equipment
                      </a>
                    </>
                  )}
              </span>
            ) : (
              <span>Custom dimensions</span>
            )}
          </div>
          <button
            type="button"
            onClick={() => setShowRigPicker((v) => !v)}
            className="text-xs text-emerald-700 hover:text-emerald-900 underline underline-offset-2 min-h-[40px] touch-manipulation"
          >
            Change Rig
          </button>
        </div>
        {showRigPicker && (
          <div className="border border-gray-200 bg-gray-50 rounded-xl p-3 space-y-2">
            <select
              value={selectedRigId || ''}
              onChange={(e) => {
                const id = e.target.value
                if (!id) {
                  handleSelectRig(null)
                  return
                }
                const rig = rigs.find((r: any) => r.id === id)
                if (rig) handleSelectRig(rig as any)
                setShowRigPicker(false)
              }}
              className={selectClass}
              disabled={loadingRigs}
            >
              <option value="">— Custom dimensions —</option>
              {rigs.map((r: any) => (
                <option key={r.id} value={r.id}>
                  {r.rig_name} — {r.computed_total_length_ft?.toFixed(1) || '?'} ft
                </option>
              ))}
            </select>
            <a href="/equipment" className="text-xs text-gray-500 hover:text-gray-700">Manage equipment →</a>
          </div>
        )}

        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => setShowRigDetails((v) => !v)}
            className="text-xs text-gray-600 hover:text-gray-900 underline underline-offset-2"
          >
            {showRigDetails ? 'Hide Rig Details' : 'Show Rig Details'}
          </button>
          <a href="/equipment" className="text-xs text-gray-500 hover:text-emerald-700">Edit in Equipment →</a>
        </div>
        {showRigDetails && (
          <div className="border border-gray-200 rounded-xl p-4 bg-gray-50/80 space-y-3 text-sm">
            <p className={fieldHintClass}>Read-only — edit tractor, trailer, and rig specs in Equipment Management.</p>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-2">
              {[
                ['Tractor plate', formatLicensePlateDisplay(selectedRigSnapshot?.tractor?.license_plate, selectedRigSnapshot?.tractor?.license_plate_state) || '—'],
                ['Trailer plate', formatLicensePlateDisplay(selectedRigSnapshot?.trailers?.[0]?.license_plate, selectedRigSnapshot?.trailers?.[0]?.license_plate_state) || '—'],
                ['Tractor VIN', formData.vin || '—'],
                ['Trailer VIN', formData.trailerVin || '—'],
                ['Tractor empty', formData.tractorEmptyWeightLbs ? `${Number(formData.tractorEmptyWeightLbs).toLocaleString()} lbs` : '—'],
                ['Trailer empty', formData.trailerEmptyWeightLbs ? `${Number(formData.trailerEmptyWeightLbs).toLocaleString()} lbs` : '—'],
                ['Rig empty', formData.rigEmptyWeightLbs ? `${Number(formData.rigEmptyWeightLbs).toLocaleString()} lbs` : '—'],
                ['Trailer width', formData.trailerWidthFt ? formatDimensionDisplay(Number(formData.trailerWidthFt)) : '—'],
                ['Deck height', formData.trailerDeckHeightFt ? formatDimensionDisplay(Number(formData.trailerDeckHeightFt)) : '—'],
                ['Rig length', selectedRigSnapshot?.overallLengthFt ? `${Number(selectedRigSnapshot.overallLengthFt).toFixed(1)} ft` : '—'],
              ].map(([label, val]) => (
                <div key={label}>
                  <div className={fieldHintTinyClass}>{label}</div>
                  <div className="font-mono text-gray-900 sm:text-gray-800">{val}</div>
                </div>
              ))}
            </div>
          </div>
        )}
        </section>

        {geocodeStatus && (
          <div className={`text-sm px-3 py-2 rounded-lg border ${geocodeStatus.includes('successfully') ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-amber-50 border-amber-200 text-amber-900'}`}>
            {geocodeStatus}
          </div>
        )}

        {/* Legacy equipment profile selector (kept for backward compat with old saved profiles).
           The primary path is now the clean Rig Selector at the top of the form (from dedicated Equipment page). */}
        {equipmentProfiles.length > 0 && (
          <div className={`${fieldHintClass} bg-gray-50 border border-gray-300 sm:border-gray-200 rounded p-2`}>
            Legacy profiles available: <select value={selectedProfileId || ''} onChange={(e) => {
              const p = equipmentProfiles.find((x: any) => x.id === e.target.value); if (p) handleSelectProfile(p)
            }} className={`${fieldControlClass} px-1 py-0.5 rounded text-xs`}><option value="">None</option>{equipmentProfiles.map((p: any) => <option key={p.id} value={p.id}>{p.profile_name}</option>)}</select>
          </div>
        )}

        {/* Load Details (Rig + Cargo + Axle weights + Overhangs) — second major decision after Rig Selector */}
        <div>
          <h2 className="text-lg font-semibold mb-1 text-gray-900 flex items-center gap-2">
            3. Load details
            <button type="button" onClick={() => startVoiceInput('cargoDescription')} disabled={isListening} className="text-base p-1 hover:bg-gray-100 rounded" title="Speak cargo description">🎤</button>
          </h2>
          <p className={`${fieldHintClass} mb-2`}>
            Describe the cargo, then enter pieces, arrangement, and axle weights. These drive oversize checks and the routing envelope below.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-gray-800 mb-1">Description — what are you hauling?</label>
              <input
                value={formData.cargoDescription}
                onChange={(e) => setFormData((p) => ({ ...p, cargoDescription: e.target.value }))}
                className={inputClass}
                placeholder="e.g. Oversize transformer on lowboy, 42k lb compressor skid"
              />
            </div>
            <div className="md:col-span-2">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs border border-gray-300 sm:border-gray-200 rounded p-2 bg-gray-50 text-gray-900">
                <div className="flex items-center gap-1.5">
                  <label htmlFor="numberOfPieces" className="font-medium whitespace-nowrap text-gray-800">No. of Pieces</label>
                  <input
                    id="numberOfPieces"
                    type="number"
                    min={1}
                    max={MAX_NUMBER_OF_PIECES}
                    step={1}
                    value={numberOfPiecesDraft ?? String(formData.numberOfPieces)}
                    onChange={(e) => setNumberOfPiecesDraft(e.target.value)}
                    onBlur={(e) => {
                      const clamped = parseAndClampPieces(e.target.value)
                      setFormData((p) => ({ ...p, numberOfPieces: clamped }))
                      setNumberOfPiecesDraft(null)
                    }}
                    className={`${fieldControlClass} rounded w-14 p-1 text-center`}
                  />
                </div>
                <fieldset
                  className="flex flex-wrap items-center gap-x-2 gap-y-1 border-0 p-0 m-0 min-w-0"
                  aria-label="Loaded arrangement"
                >
                  <legend className="font-medium mr-1 shrink-0">Loaded:</legend>
                  {LOADED_ARRANGEMENT_OPTIONS.map((option) => (
                    <label key={option} className="inline-flex items-center gap-1 cursor-pointer whitespace-nowrap">
                      <input
                        type="radio"
                        name="loadedArrangement"
                        value={option}
                        checked={formData.loadedArrangement === option}
                        onChange={() => setFormData((p) => ({ ...p, loadedArrangement: option }))}
                        className="shrink-0"
                      />
                      <span>{LOADED_ARRANGEMENT_LABELS[option]}</span>
                    </label>
                  ))}
                </fieldset>
                <fieldset
                  className="flex flex-wrap items-center gap-x-2 gap-y-1 border-0 p-0 m-0 min-w-0"
                  aria-label="Move type"
                >
                  <legend className="font-medium mr-1 shrink-0">Move:</legend>
                  {MOVE_TYPE_OPTIONS.map((option) => (
                    <label key={option} className="inline-flex items-center gap-1 cursor-pointer whitespace-nowrap">
                      <input
                        type="radio"
                        name="moveType"
                        value={option}
                        checked={formData.moveType === option}
                        onChange={() => setFormData((p) => ({ ...p, moveType: option }))}
                        className="shrink-0"
                      />
                      <span>{MOVE_TYPE_LABELS[option]}</span>
                    </label>
                  ))}
                </fieldset>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-800 mb-1">Manufacturer</label>
              <input value={formData.cargoManufacturer} onChange={(e) => setFormData((p) => ({ ...p, cargoManufacturer: e.target.value }))} className={inputClass} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-800 mb-1">Make / Model / SN</label>
              <input value={formData.cargoMakeModel} onChange={(e) => setFormData((p) => ({ ...p, cargoMakeModel: e.target.value }))} className={inputClass} placeholder="Serial optional" />
            </div>
          </div>

          {/* NEW: Specific Load Dimensions — placed immediately under Manufacturer / Make-Model/SN per requirements.
              These are distinct from the top-level routing envelope (weight/length/width/height at top of form).
              Static capture only for now — no calculations, validation, or auto-sync. */}
          <div className="mb-3">
            <div className="text-xs font-medium mb-1 text-gray-700 sm:text-gray-600">Load Dimensions (specific cargo)</div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div>
                <label className={fieldLabelTinyClass}>Load Weight (lbs)</label>
                <input
                  type="number"
                  value={formData.loadWeightLbs || ''}
                  onChange={(e) => setFormData((p) => ({ ...p, loadWeightLbs: e.target.value }))}
                  className={inputCompactClass}
                  placeholder="e.g. 42000"
                />
              </div>
              <DimensionInput
                label="Load Length"
                value={formData.loadLengthFt || ''}
                onChange={(ft) => setFormData((p) => ({ ...p, loadLengthFt: String(ft) }))}
              />
              <DimensionInput
                label="Load Width"
                value={formData.loadWidthFt || ''}
                onChange={(ft) => setFormData((p) => ({ ...p, loadWidthFt: String(ft) }))}
              />
              <DimensionInput
                label="Load Height"
                value={formData.loadHeightFt || ''}
                onChange={(ft) => setFormData((p) => ({ ...p, loadHeightFt: String(ft) }))}
              />
            </div>
          </div>

          {/* Load overhangs — FRONT SPLIT per requirements:
              - Front of Rig: contributes to overall rig length envelope (used for routing/bridge)
              - Front of Trailer: captured for permit documentation only (no envelope impact)
              - Rear: unchanged, still contributes to envelope */}
          <details className="mb-3 border rounded-lg bg-amber-50 text-sm">
            <summary className="cursor-pointer font-medium text-amber-900 p-3 hover:text-amber-950">
              Load Overhangs
            </summary>
            <div className="px-3 pb-3">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <OverhangFeetInput
                  id="overhang-front-rig"
                  label="Front of Rig Overhang (ft)"
                  sublabel="(envelope)"
                  value={loadOverhangFrontFt}
                  onChange={setLoadOverhangFrontFt}
                />
                <OverhangFeetInput
                  id="overhang-front-trailer"
                  label="Front of Trailer Overhang (ft)"
                  sublabel="(permit info only)"
                  value={loadOverhangFrontTrailerFt}
                  onChange={setLoadOverhangFrontTrailerFt}
                />
                <OverhangFeetInput
                  id="overhang-rear"
                  label="Rear Overhang (ft)"
                  sublabel="(envelope)"
                  value={loadOverhangRearFt}
                  onChange={setLoadOverhangRearFt}
                />
              </div>
              <div className="text-[10px] text-amber-700 mt-1">
                Front-of-rig + rear contribute to effective total length for routing. Trailer-front overhang is recorded for permit documentation only. All values captured in snapshot.
              </div>
            </div>
          </details>

          {/* Dynamic axle weights (driven by axles count) + auto gross + helpers */}
          <div className="border border-gray-300 sm:border-gray-200 rounded-lg p-3 bg-white">
            <div className="flex items-center justify-between mb-2">
              <div className="font-medium text-sm text-gray-900">Axle Weight Distribution (lbs) — auto from gross weight</div>
              <div className="flex gap-2 text-xs">
                <button type="button" onClick={() => {
                  const n = Math.max(1, Math.min(12, Number(formData.axles) || 5))
                  const even = Math.round((Number(formData.grossLoadedWeight) || 80000) / n)
                  const arr = Array.from({ length: n }, () => even)
                  setFormData((p) => ({ ...p, axleWeights: arr }))
                }} className="px-2 py-0.5 border rounded hover:bg-gray-50">Distribute Evenly</button>
                <button type="button" onClick={() => {
                  const sum = (formData.axleWeights || []).slice(0, Math.max(1, Math.min(12, Number(formData.axles) || 5))).reduce((a: number, b: any) => a + (Number(b) || 0), 0)
                  setFormData((p) => ({ ...p, grossLoadedWeight: sum }))
                }} className="px-2 py-0.5 border rounded hover:bg-gray-50">Axles → Gross</button>
              </div>
            </div>

            {(() => {
              const n = Math.max(1, Math.min(12, Number(formData.axles) || 5))
              const weights: number[] = formData.axleWeights || []
              const sum = weights.slice(0, n).reduce((a, b) => a + (Number(b) || 0), 0)
              const gross = Number(formData.grossLoadedWeight) || 0
              return (
                <>
                  <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2 mb-2">
                    {Array.from({ length: n }).map((_, i) => (
                      <div key={i}>
                        <label className={fieldLabelTinyClass}>Axle {i + 1}</label>
                        <input
                          type="number"
                          value={weights[i] || 0}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value) || 0
                            setFormData((prev) => {
                              const arr = [...(prev.axleWeights || [])]
                              arr[i] = val
                              const newSum = arr.slice(0, n).reduce((a, b) => a + (Number(b) || 0), 0)
                              return { ...prev, axleWeights: arr, grossLoadedWeight: newSum || prev.grossLoadedWeight }
                            })
                          }}
                          className={inputCompactClass}
                        />
                      </div>
                    ))}
                  </div>
                  <div className="flex flex-wrap items-center gap-3 text-sm">
                    <div>
                      <span className="font-medium">Gross Loaded Weight</span>
                      <input
                        type="number"
                        value={gross}
                        onChange={(e) => setFormData((p) => ({ ...p, grossLoadedWeight: parseFloat(e.target.value) || 0 }))}
                        className={`${fieldControlClass} ml-2 w-28 p-1 rounded`}
                      /> lbs
                    </div>
                    <div className={fieldHintClass}>Sum of shown axles: <span className="font-mono text-gray-900">{sum.toLocaleString()}</span></div>
                    {gross !== sum && gross > 0 && (
                      <div className="text-amber-600 text-xs">⚠ Gross differs from axle sum (normal for 5th-wheel/kingpin load transfer)</div>
                    )}
                  </div>
                </>
              )
            })()}
          </div>
          <p className={`${fieldHintTinyClass} mt-1`}>Auto-calc + distribute helpers match real carrier bridge-law workflows. Values are captured on save.</p>
        </div>

        {/* Routing envelope — auto-calculated from rig + load; sent to routing/agent */}
        <div className="border border-emerald-200 bg-emerald-50/50 rounded-xl p-4">
          <h2 className="font-semibold mb-1 text-emerald-900">Routing envelope</h2>
          <p className="text-xs text-emerald-800 mb-3">Auto-calculated from rig, overhangs, trailer, and cargo — used for oversize routing (not the load-details form step above).</p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm mb-1 text-gray-800">Gross weight</label>
              <div className={readoutClass}>
                {formData.weight > 0 ? `${formData.weight.toLocaleString()} lbs` : '—'}
                {formData.weight > 0 && formData.weight <= LEGAL_GROSS_LBS && (
                  <span className="text-emerald-600 font-medium ml-1">(legal)</span>
                )}
              </div>
              <p className={`${fieldHintTinyClass} mt-0.5`}>Rig empty + load weight</p>
            </div>
            <div>
              <label className="block text-sm mb-1 text-gray-800">Gross length</label>
              <div className={readoutClass}>
                {formatDimensionDisplay(formData.length) || '—'}
              </div>
              <p className={`${fieldHintTinyClass} mt-0.5`}>Rig length + front rig overhang + rear overhang</p>
            </div>
            <div>
              <label className="block text-sm mb-1 text-gray-800">Gross width</label>
              <div className={readoutClass}>
                {formatDimensionDisplay(formData.width) || '—'}
              </div>
              <p className={`${fieldHintTinyClass} mt-0.5`}>max(trailer width, load width)</p>
            </div>
            <div>
              <label className="block text-sm mb-1 text-gray-800">Gross height</label>
              {(() => {
                const heightDisplay = getGrossHeightDisplay(formData.height)
                return (
                  <>
                    <div className={readoutClass}>
                      {heightDisplay.displayText || '—'}
                      {heightDisplay.showLegalBadge && (
                        <span className="text-emerald-600 font-medium ml-1">(legal)</span>
                      )}
                    </div>
                    {heightDisplay.helperText && (
                      <p className={`${fieldHintTinyClass} mt-0.5`}>{heightDisplay.helperText}</p>
                    )}
                  </>
                )
              })()}
            </div>
          </div>
        </div>

        {/* Special route instructions — before addresses so first auto-optimization includes instructions */}
        <div>
          <h2 className="text-lg font-semibold text-gray-900 mb-1 flex items-center gap-2">
            4. Route preferences (optional)
            <button
              type="button"
              onClick={() => startVoiceInput('preferences')}
              disabled={isListening}
              className="text-base hover:bg-gray-100 p-1 rounded transition disabled:opacity-50"
              title="Speak route preferences (e.g. 'avoid AR, avoid IL, include Corinth MS')"
            >
              🎤
            </button>
          </h2>
          <p className={`${fieldHintClass} mb-2`}>
            Add avoid/prefer rules before addresses so the first optimization uses them
            (e.g. avoid AR, prefer I-40 south). With multiple drops, only avoid-state rules apply—via/include waypoints are ignored.
          </p>
          <textarea
            placeholder="E.g. avoid AR, avoid IL, include Corinth MS, prefer I-40 southern, stay on interstates..."
            value={manualRoute}
            onChange={(e) => setManualRoute(e.target.value)}
            className={textareaClass}
          />
          <p className={`${fieldHintTinyClass} mt-1`}>Enforced in OR-Tools routing. Type or use 🎤.</p>
        </div>

        {/* Pickup */}
        <LocationStopInput
          label="5. Pickup"
          stop={formData.origin}
          lat={formData.originLat}
          lon={formData.originLon}
          isGeocoding={!!isGeocoding.origin}
          showManualCoords={!!showManualCoords.origin}
          errorKey="origin.query"
          errors={errors}
          placeholder="Case IH plant, Grand Island, NE"
          onQueryChange={(query) => updateStopQuery('origin', query)}
          onCoordsChange={(lat, lon) => {
            setFormData((prev) => ({ ...prev, originLat: lat, originLon: lon }))
            if (errors['geocode'] || errors['origin.query']) {
              const { geocode: _g, 'origin.query': _o, ...rest } = errors
              setErrors(rest)
            }
          }}
          onBlurGeocode={() => debouncedGeocodeStop('origin')}
          onToggleManual={() => setShowManualCoords((p) => ({ ...p, origin: !p.origin }))}
          voiceButton={
            <button
              type="button"
              onClick={() => startVoiceInput('origin')}
              disabled={isListening}
              className="text-base hover:bg-gray-100 p-1 rounded transition disabled:opacity-50"
              title="Speak pickup location"
            >
              🎤
            </button>
          }
        />

        {/* Drops */}
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold text-gray-900">6. Drops (deliveries)</h2>
            <button
              type="button"
              onClick={addDrop}
              disabled={formData.drops.length >= MAX_DROPS}
              className="shrink-0 inline-flex items-center justify-center min-h-[44px] px-4 py-2 text-sm font-semibold rounded-lg border border-gray-500 sm:border-gray-300 bg-white text-gray-900 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed touch-manipulation shadow-sm"
            >
              + Add drop{formData.drops.length >= MAX_DROPS ? ` (max ${MAX_DROPS})` : ''}
            </button>
          </div>
          <p className={`${fieldHintClass} -mt-1`}>
            Add each stop in delivery order. The last drop is the final destination. Business names or full street addresses both work.
          </p>
          {formData.drops.map((drop, idx) => {
            const key = dropStopKey(drop)
            return (
            <div key={drop.id} className="border border-gray-300 sm:border-gray-200 rounded-xl p-3 min-w-0">
              <div className="flex flex-wrap items-start justify-between gap-2 min-w-0">
                <div className="flex-1 min-w-0">
                  <LocationStopInput
                    label={`Drop ${idx + 1}${idx === formData.drops.length - 1 ? ' (final)' : ''}`}
                    stop={drop}
                    lat={drop.lat}
                    lon={drop.lon}
                    isGeocoding={!!isGeocoding[key]}
                    showManualCoords={!!showManualCoords[key]}
                    errorKey={`drop-${drop.id}.query`}
                    errors={errors}
                    placeholder={
                      idx === 0
                        ? 'Northern Plains Equipment, 1915 US-2, Minot, ND'
                        : idx === 1
                          ? 'West Plains, 3484 I94 Business Loop E, Dickinson, ND'
                          : 'Full address, business name, or zip'
                    }
                    onQueryChange={(query) => updateStopQuery(key, query)}
                    onCoordsChange={(lat, lon) => updateDropCoords(idx, lat, lon)}
                    onBlurGeocode={() => debouncedGeocodeStop(key)}
                    onToggleManual={() =>
                      setShowManualCoords((p) => ({ ...p, [key]: !p[key] }))
                    }
                    voiceButton={
                      <button
                        type="button"
                        onClick={() => startVoiceInput(key)}
                        disabled={isListening}
                        className="text-base hover:bg-gray-100 p-1 rounded transition disabled:opacity-50"
                        title={`Speak drop ${idx + 1}`}
                      >
                        🎤
                      </button>
                    }
                  />
                </div>
                {formData.drops.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeDrop(drop.id)}
                    className="shrink-0 inline-flex items-center justify-center min-h-[44px] px-3 py-2 text-sm font-medium rounded-lg border border-red-300 text-red-700 bg-white hover:bg-red-50 touch-manipulation"
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>
            )
          })}
        </div>

        {errors['geocode'] && (
          <p className="text-red-500 text-sm">{errors['geocode']}</p>
        )}

        {(routeProgress !== 'idle' || loading) && (
          <div className={`rounded-2xl p-4 border flex items-center gap-3 ${
            routeProgress === 'error' ? 'bg-red-50 border-red-200' : 'bg-blue-50 border-blue-200'
          }`}>
            {loading && routeProgress !== 'error' && (
              <div className="w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin shrink-0" />
            )}
            <div className="min-w-0">
              <p className={`text-sm font-medium ${routeProgress === 'error' ? 'text-red-800' : 'text-blue-900'}`}>
                {routeProgress === 'error' ? 'Route calculation failed' : routeProgressDetail || 'Calculating best route…'}
              </p>
              {routeProgress === 'calculating' && (
                <p className="text-xs text-blue-700 mt-0.5">Best route and permit analysis run automatically when addresses are complete</p>
              )}
            </div>
          </div>
        )}

        {/* Quick Route Glance — optional corridor preview (after addresses; needs origin/dest) */}
        <div className="p-4 border-2 border-blue-100 bg-blue-50 rounded-xl">
          <div className="flex items-center justify-between mb-2">
            <div className="font-semibold text-blue-900 text-sm">Quick Route Glance</div>
            <button
              type="button"
              onClick={handleQuickGlance}
              className="text-xs px-3 py-1 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              Preview Corridor &amp; Fee
            </button>
          </div>
          <p className="text-xs text-blue-700 mb-2">Rough estimate from current origin/dest + load envelope. Full OR-Tools optimization runs automatically when addresses geocode; detailed highways and DOT restrictions appear in results below.</p>

          {glance && (
            <div className="space-y-2 text-sm">
              <div><span className="font-medium text-blue-900">Corridor:</span> <span className="font-mono">{glance.corridor}</span></div>
              <div>
                <span className="font-medium text-blue-900">Est. Major Highways:</span>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {glance.highways.map((h: string, i: number) => (
                    <span key={i} className="inline-flex items-center px-3 py-0.5 rounded-full text-sm font-medium border bg-white text-blue-800 border-blue-200">{formatHighwayForDisplay(h)}</span>
                  ))}
                </div>
              </div>
              <div><span className="font-medium text-blue-900">Rough Fee Estimate:</span> <span className="font-semibold">${glance.roughFee}</span> <span className="text-xs text-blue-600">(varies by exact route &amp; permits)</span></div>
              <div className="text-[10px] text-blue-600 italic">{glance.note}</div>
            </div>
          )}
          {!glance && <div className="text-xs text-blue-600">Click for a quick corridor preview. Optimization starts automatically once pickup and all drops are geocoded.</div>}
        </div>
        </div> {/* End form card */}
      </form>

      {/* Results */}
      {(agentResult || result) && (
        <div ref={resultsRef} className="mt-8 space-y-6">
          {/* Note: richer or-tools sections (Permit Readiness, per-leg highways) may cause minor vertical layout shift vs quick results when present (expected per richer data; Issue 10) */}
          {/* Error display (reused by both quick and or-tools paths on fetch failure) */}
          {result?.error && (
            <div className="p-4 rounded-lg border bg-red-50 border-red-200 text-red-800">
              <div className="font-semibold">Analysis failed</div>
              <div className="text-sm mt-1">{result.error}</div>
            </div>
          )}

          {agentResult?.fallback && !result?.error && (
            <div className="p-4 rounded-lg border bg-amber-50 border-amber-200 text-amber-900">
              <div className="font-semibold">OR-Tools unavailable — OSRM route shown</div>
              <div className="text-sm mt-1">
                {agentResult.message || 'Optimization timed out - falling back to OSRM'}
              </div>
            </div>
          )}

          {/* Edit Request - allows user to go back to the form */}
          <div className="flex justify-end">
            <button
              onClick={() => {
                window.scrollTo({ top: 0, behavior: 'smooth' })
                // Optional: focus first input after scroll
                setTimeout(() => {
                  const firstInput = document.querySelector('input[placeholder="City"]') as HTMLInputElement
                  firstInput?.focus()
                }, 600)
              }}
              className="text-xs px-3 py-1.5 rounded-full border border-gray-300 text-gray-600 hover:bg-gray-50 hover:text-gray-800 transition-colors flex items-center gap-1.5"
            >
              <span>Edit Request</span>
            </button>
          </div>
          {(() => {
            const primary = getPrimary(agentResult, result)
            if (!primary) return null

            const isSaved = savedToDatabase || !!result?.savedToDatabase
            const hasMultipleOptions = !!(agentResult?.options && agentResult.options.length > 1)

            return (
              <>
                {/* Simplified review — one summary line + state pills */}
                <div className="p-5 border border-gray-200 rounded-2xl bg-white shadow-sm space-y-4">
                  <p className="text-base text-gray-800 leading-relaxed">
                    {buildRouteSummarySentence(primary)}
                  </p>
                  {primary.routeCorridor && primary.routeCorridor.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {primary.routeCorridor.map((state: string, index: number) => {
                        const requires = stateRequiresPermit(primary, state)
                        return (
                          <span
                            key={`${state}-${index}`}
                            className={`px-3 py-1.5 rounded-full text-sm font-semibold shadow-sm ${
                              requires
                                ? 'bg-red-500 text-white'
                                : 'bg-emerald-500 text-white'
                            }`}
                          >
                            {state}
                          </span>
                        )
                      })}
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => setShowRouteDetails((v) => !v)}
                    className="text-xs text-gray-600 sm:text-gray-500 hover:text-gray-800 underline underline-offset-2"
                  >
                    {showRouteDetails ? 'Hide details' : 'Show route details'}
                  </button>
                </div>
                {process.env.NODE_ENV !== 'production' && (() => { console.log('[border-coords-prefill]', { borderCrossings: primary?.borderCrossings, legsEntryExit: primary?.legs?.map((l: any) => ({ from: l.from, to: l.to, highways: l.highways })), routeCorridor: primary?.routeCorridor }); return null; })()}

                {/* Approval Gate Buttons + Change Route (only before saving) */}
                {agentResult && !isSaved && (
                  <div className="space-y-4">
                    <div className="flex flex-col sm:flex-row justify-center gap-4">
                      <button
                        onClick={handleRejectAndRestart}
                        disabled={loading}
                        className="px-8 py-3 rounded-lg text-lg font-semibold border border-gray-300 text-gray-700 hover:bg-gray-100 disabled:opacity-50"
                      >
                        Reject &amp; Start Over
                      </button>
                      <button
                        onClick={handleApproveAndSave}
                        disabled={loading}
                        className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold px-8 py-3 rounded-lg text-lg disabled:bg-gray-400"
                      >
                        {loading ? 'Opening portals…' : 'Approve and Launch Portals'}
                      </button>
                      <button
                        onClick={() => setShowChangeRouteInput(!showChangeRouteInput)}
                        disabled={loading}
                        className="px-8 py-3 rounded-lg text-lg font-semibold border border-blue-300 text-blue-700 hover:bg-blue-50 disabled:opacity-50"
                      >
                        {showChangeRouteInput ? 'Cancel' : 'Change Route'}
                      </button>
                    </div>

                    {showChangeRouteInput && (
                      <div className="max-w-md mx-auto">
                        <p className="text-sm text-gray-600 mb-2">
                          Enter a new route as comma-separated state codes (e.g., <code>AL, MS, TN, MO, NE</code>)
                        </p>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={manualRoute}
                            onChange={(e) => setManualRoute(e.target.value)}
                            placeholder="AL, MS, TN, MO, NE"
                            className={`${fieldControlClass} flex-1 rounded px-3 py-2 text-sm`}
                            onKeyDown={(e) => { if (e.key === 'Enter') handleChangeRoute() }}
                          />
                          <button
                            onClick={handleChangeRoute}
                            disabled={loading || !manualRoute.trim()}
                            className="bg-blue-600 text-white px-4 py-2 rounded text-sm disabled:bg-gray-400"
                          >
                            Submit New Route
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Save Success Banner */}
                {isSaved && (
                  <div className="p-4 rounded-lg border bg-emerald-50 border-emerald-200 text-emerald-800">
                    <div className="flex items-center gap-3">
                      <span className="text-2xl">✅</span>
                      <div>
                        <div className="font-semibold text-lg">Permit request saved successfully</div>
                        <div className="text-sm">Data has been stored in the database.</div>
                      </div>
                    </div>
                  </div>
                )}

                {showRouteDetails && primary.routeCorridor && primary.routeCorridor.length > 0 && (
                  <div className="p-5 border-2 border-blue-200 rounded-xl bg-white shadow-sm">
                    <div className="flex justify-between items-start mb-4">
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="font-semibold text-gray-900 text-lg">Primary Recommended Route</h3>
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 font-medium">RECOMMENDED</span>
                        </div>
                        <p className="text-sm text-gray-600 sm:text-gray-500">
                          {primary.routeCorridor.length} states
                          {primary.distanceMiles && ` • ${primary.distanceMiles} miles`}
                          {primary.durationHours && ` • ~${primary.durationHours} hrs`}
                        </p>
                      </div>
                      <div className="text-xs px-3 py-1 bg-gray-100 rounded-full text-gray-600 self-start">
                        {primary.routingEngine === 'graphhopper' ? 'GraphHopper Truck' : agentResult?.fallback ? 'OSRM (fallback)' : (primary.routingEngine?.includes('or-tools') || agentResult?._source === 'or-tools') ? 'Full OR-Tools Optimization' : 'OSRM'} + Nominatim + State DOT
                      </div>
                    </div>

                    {/* Visual Route Line */}
                    <div className="relative py-8 px-2">
                      <div className="absolute top-1/2 left-4 right-4 h-1 bg-gradient-to-r from-blue-200 via-blue-300 to-blue-200 rounded-full -translate-y-1/2" />
                      <div className="relative flex justify-between items-center">
                        {primary.routeCorridor.map((state: string, index: number) => {
                          const requires = stateRequiresPermit(primary, state)
                          const needsEscort = primary.escortRequiredStates?.includes(state)
                          const isFirst = index === 0
                          const isLast = index === primary.routeCorridor.length - 1
                          return (
                            <div key={index} className="flex flex-col items-center z-10 group">
                              <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold shadow-md border-2 transition-all ${requires ? 'bg-red-500 text-white border-red-600' : 'bg-emerald-500 text-white border-emerald-600'} group-hover:scale-110`}>
                                {state}
                              </div>
                              <div className="mt-1.5 text-[10px] font-medium text-center space-y-0.5">
                                <span className={requires ? 'text-red-600' : 'text-emerald-600'}>
                                  {requires ? 'PERMIT' : 'OK'}
                                </span>
                                {needsEscort && (
                                  <div className="text-[9px] font-semibold text-orange-600">ESCORT</div>
                                )}
                              </div>
                              {!isFirst && !isLast && (
                                <div className="absolute top-[38px] w-1.5 h-1.5 bg-white rounded-full border border-gray-300" />
                              )}
                            </div>
                          )
                        })}
                      </div>
                    </div>

                    <div className="flex gap-4 text-xs mt-2 flex-wrap">
                      <div className="flex items-center gap-1.5">
                        <div className="w-3 h-3 bg-emerald-500 rounded-full" /> <span className="text-gray-600">No permit required</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <div className="w-3 h-3 bg-red-500 rounded-full" /> <span className="text-gray-600">Permit required</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <div className="w-3 h-3 bg-orange-500 rounded-full" /> <span className="text-gray-600">Escort required</span>
                      </div>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1 text-[10px]">{primary.routeCorridor.map((state:string,idx:number)=>{const requires=stateRequiresPermit(primary,state);return <span key={idx} className={`px-1.5 py-0.5 rounded font-mono ${requires?'bg-red-500 text-white':'bg-gray-200 text-gray-700'}`}>{state}{requires?' needed':''}</span>})}</div>
                  </div>
                )}

                {/* v0.3 World-Class OR-Tools enforcement (small targeted update): display "Avoids enforced: AR, IL", corridor rationale when present.
                    Only for ortools path (uses the new primary.specialInstructionsEnforced / avoidedStates / chosenCorridorRationale).
                    Makes the recommended Full path visibly superior for real hauls. */}
                {(agentResult?._source === 'or-tools' || (primary.routingEngine || '').includes('or-tools') || primary.specialInstructionsEnforced) &&
                 (primary.avoidedStates?.length > 0 || primary.chosenCorridorRationale) && (
                  <div className="p-3 border border-emerald-200 bg-emerald-50 rounded-lg text-sm">
                    <div className="font-medium text-emerald-800">World-Class OR-Tools: hard enforcement + OSOW-friendly corridor</div>
                    {primary.avoidedStates && primary.avoidedStates.length > 0 && (
                      <div>Avoids enforced: <span className="font-semibold">{primary.avoidedStates.join(', ')}</span></div>
                    )}
                    {primary.chosenCorridorRationale && (
                      <div className="text-[11px] text-emerald-700 mt-0.5">{primary.chosenCorridorRationale}</div>
                    )}
                  </div>
                )}

                {primary.highways && primary.highways.length > 0 && (
                  <details
                    className="p-4 border rounded-lg bg-white"
                    open={highwaysExpanded}
                    onToggle={(e) => setHighwaysExpanded((e.target as HTMLDetailsElement).open)}
                  >
                    <summary className="font-semibold text-gray-700 cursor-pointer select-none">Major Highways</summary>
                    <div className="mt-2">
                    {primary.legs && Array.isArray(primary.legs) && primary.legs.length > 0 ? (
                      <div className="space-y-1 text-sm text-gray-800">
                        {primary.legs.map((leg: any, i: number) => {
                          const fromName = leg.from?.name || 'Start'
                          const toName = leg.to?.name || 'End'
                          const legHighways = Array.isArray(leg.highways) && leg.highways.length ? leg.highways : (primary.highways || [])
                          const hw = formatHighwaysForDisplay(legHighways, leg.distance_m != null ? leg.distance_m / 1609.34 : undefined)
                          return (
                            <div key={i} className="break-words">
                              {fromName} → <span className="font-medium">{hw}</span> → {toName}
                            </div>
                          )
                        })}
                      </div>
                    ) : (
                      <p className="text-sm text-gray-800 break-words">{primary.highways.map((h: string) => formatHighwayForDisplay(h)).join(" → ")}</p>
                    )}
                    </div>
                  </details>
                )}

                {/* Permit Readiness + Warnings (OR-Tools richer fields; only when present for backward compat) */}
                {showRouteDetails && primary.permitReady !== undefined && (
                  <div className="p-4 border rounded-lg bg-white">
                    <h3 className="font-semibold mb-2 text-gray-700">Permit Readiness</h3>
                    <div className="flex items-center gap-2 mb-2">
                      <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${routeRequiresPermit(primary) ? 'bg-red-100 text-red-800' : 'bg-emerald-100 text-emerald-800'}`}>
                        {routeRequiresPermit(primary) ? '✅ Permit Required' : '✅ Permit Ready'}
                      </span>
                    </div>
                    {Array.isArray(primary.permitWarnings) && primary.permitWarnings.length > 0 && (
                      <div>
                        <div className="text-xs font-medium text-amber-700 mb-1">Warnings</div>
                        <ul className="text-sm text-amber-700 list-disc list-inside space-y-0.5">
                          {primary.permitWarnings.map((w: string, i: number) => <li key={i}>{w}</li>)}
                        </ul>
                      </div>
                    )}
                  </div>
                )}

                {/* Per-State Permit Breakdown */}
                {primary.permitRequiredStates && primary.permitRequiredStates.length > 0 && (
                  <div className="p-4 border rounded-lg bg-white">
                    <h3 className="font-semibold mb-4 text-gray-700">Why These States Require Permits</h3>
                    <div className="grid gap-3 md:grid-cols-2">
                      {primary.permitRequiredStates.map((state: string, idx: number) => {
                        const stateReasons = (primary.reasons || []).filter((r: string) => r.startsWith(`${state}:`))
                        const needsEscort = primary.escortRequiredStates?.includes(state)
                        return (
                          <div key={idx} className="border border-red-200 bg-red-50 rounded-lg p-4">
                            <div className="flex items-center justify-between mb-2">
                              <span className="font-bold text-lg text-red-800">{state}</span>
                              <div className="flex gap-1.5">
                                <span className="text-xs px-2 py-0.5 bg-red-200 text-red-700 rounded">PERMIT REQUIRED</span>
                                {needsEscort && (
                                  <span className="text-xs px-2 py-0.5 bg-orange-200 text-orange-700 rounded font-medium">ESCORT NEEDED</span>
                                )}
                              </div>
                            </div>
                            <ul className="text-sm text-red-700 space-y-1 list-disc list-inside">
                              {stateReasons.length > 0 ? (
                                stateReasons.map((reason: string, i: number) => (
                                  <li key={i}>{reason.replace(`${state}: `, '')}</li>
                                ))
                              ) : (
                                <li>Exceeds one or more state thresholds</li>
                              )}
                            </ul>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* Route Restrictions & Requirements (from strengthened state rules DB) */}
                {(primary.escortRequiredStates?.length > 0 || primary.escortWarnings?.length > 0 || primary.curfewNotes?.length > 0 || primary.specialNotes?.length > 0) && (
                  <div className="p-4 border rounded-lg bg-white">
                    <h3 className="font-semibold mb-3 text-gray-700">Route Restrictions &amp; Requirements</h3>

                    {/* Escort Summary */}
                    {(primary.escortRequiredStates?.length > 0 || primary.escortWarnings?.length > 0) && (
                      <div className="mb-3 p-3 bg-orange-50 border border-orange-200 rounded-lg">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-semibold text-orange-800">Escort(s) Likely Required</span>
                          <span className="text-xs px-2 py-0.5 bg-orange-200 text-orange-700 rounded">
                            {(primary.escortRequiredStates?.length || primary.escortWarnings?.length || 0)} state{(primary.escortRequiredStates?.length || primary.escortWarnings?.length || 0) > 1 ? 's' : ''}
                          </span>
                        </div>
                        {primary.escortWarnings?.length > 0 ? (
                          <ul className="text-sm text-orange-700 space-y-1 list-disc list-inside">
                            {primary.escortWarnings.map((warning: string, i: number) => (
                              <li key={i}>{warning}</li>
                            ))}
                          </ul>
                        ) : (
                          <div className="text-sm text-orange-700">
                            {primary.escortRequiredStates.join(' → ')}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Curfew Restrictions */}
                    {primary.curfewNotes?.length > 0 && (
                      <div className="mb-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                        <div className="font-semibold text-amber-800 mb-1">Time / Curfew Restrictions</div>
                        <ul className="text-sm text-amber-700 space-y-1 list-disc list-inside">
                          {primary.curfewNotes.map((note: string, i: number) => (
                            <li key={i}>{note}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Special / Important Notes from State Rules */}
                    {primary.specialNotes?.length > 0 && (
                      <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                        <div className="font-semibold text-blue-800 mb-1">Important Route Notes</div>
                        <ul className="text-sm text-blue-700 space-y-1 list-disc list-inside">
                          {primary.specialNotes.slice(0, 5).map((note: string, i: number) => (
                            <li key={i}>{note}</li>
                          ))}
                          {primary.specialNotes.length > 5 && (
                            <li className="text-blue-600 italic">+ {primary.specialNotes.length - 5} more state-specific notes (see raw data)</li>
                          )}
                        </ul>
                      </div>
                    )}

                    {/* Seasonal / Frost Law Restrictions */}
                    {primary.seasonalWeightRestrictions?.length > 0 && (
                      <div className="p-3 bg-purple-50 border border-purple-200 rounded-lg">
                        <div className="font-semibold text-purple-800 mb-1">Seasonal Weight Restrictions (Frost Laws / Spring Thaw)</div>
                        <ul className="text-sm text-purple-700 space-y-1 list-disc list-inside">
                          {primary.seasonalWeightRestrictions.slice(0, 4).map((note: string, i: number) => (
                            <li key={i}>{note}</li>
                          ))}
                          {primary.seasonalWeightRestrictions.length > 4 && (
                            <li className="text-purple-600 italic">+ {primary.seasonalWeightRestrictions.length - 4} more seasonal notes</li>
                          )}
                        </ul>
                      </div>
                    )}
                  </div>
                )}

                {/* NEW: Corridor Intelligence from real State DOT open data (12 priority states) */}
                {primary.dotRestrictions && primary.dotRestrictions.length > 0 && (
                  <div className="p-4 border-2 border-amber-200 rounded-xl bg-amber-50">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="font-semibold text-amber-900">Corridor Intelligence — State DOT Open Data</span>
                      <span className="text-[10px] px-2 py-0.5 bg-amber-200 text-amber-800 rounded-full font-medium">12 STATES</span>
                    </div>
                    <p className="text-xs text-amber-700 mb-3">
                      Real restrictions pulled from public TxDOT, ODOT, MoDOT, IDOT, TDOT, NCDOT, Caltrans, FDOT and other corridor state sources.
                      These are not generic thresholds — they are known problem locations on primary trucking routes.
                    </p>
                    <ul className="text-sm text-amber-900 space-y-1.5 list-disc list-inside">
                      {primary.dotRestrictions.slice(0, 6).map((note: string, i: number) => (
                        <li key={i}>{note}</li>
                      ))}
                      {primary.dotRestrictions.length > 6 && (
                        <li className="text-amber-700 italic font-medium">+ {primary.dotRestrictions.length - 6} additional corridor-specific restrictions</li>
                      )}
                    </ul>
                    <div className="mt-3 pt-2 border-t border-amber-200 text-[10px] text-amber-600">
                      Sources: State DOT OSOW route planning tools, bridge clearance databases, frost law maps, and permitted route lists.
                    </div>
                  </div>
                )}

                {/* Tier Selector (for cost estimation simulation) */}
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-sm font-medium text-gray-600">Your Plan:</span>
                  <div className="flex rounded-lg border border-gray-300 overflow-hidden text-sm">
                    {(['Free', 'Starter', 'Pro'] as const).map((tier) => (
                      <button
                        key={tier}
                        onClick={() => setSelectedTier(tier)}
                        className={`px-4 py-1.5 transition-colors ${
                          selectedTier === tier
                            ? 'bg-black text-white'
                            : 'bg-white text-gray-700 hover:bg-gray-50'
                        }`}
                      >
                        {tier}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Cost Summary */}
                <div className="p-4 border rounded-lg bg-white">
                  <h3 className="font-semibold mb-3 text-gray-700">Estimated Total Cost</h3>

                  {primary.costBreakdown && (
                    <>
                      {/* State Permit Costs */}
                      <div className="flex justify-between items-baseline mb-2">
                        <span className="text-sm text-gray-600">State Permit Fees</span>
                        <span className="font-medium">
                          ${primary.costBreakdown.baseFee ?? 0}
                        </span>
                      </div>

                      {/* TruckerOS Platform Fee */}
                      <div className="flex justify-between items-baseline mb-3">
                        <span className="text-sm text-gray-600">
                          TruckerOS Platform Fee <span className="text-xs text-gray-600 sm:text-gray-500">({selectedTier})</span>
                        </span>
                        <span className="font-medium text-blue-600">
                          ${(() => {
                            const permitCount = primary.costBreakdown.stateCount || 0
                            if (selectedTier === 'Free') return permitCount * 29
                            return permitCount * 10
                          })()}
                        </span>
                      </div>

                      {/* Grand Total */}
                      <div className="pt-3 border-t flex justify-between items-baseline">
                        <span className="font-semibold text-gray-800">Grand Total</span>
                        <div className="flex items-baseline gap-1">
                          <span className="text-3xl font-bold text-gray-900">
                            ${(() => {
                              const stateCost = primary.costBreakdown.baseFee || 0
                              const permitCount = primary.costBreakdown.stateCount || 0
                              const platformFee = selectedTier === 'Free' ? permitCount * 29 : permitCount * 10
                              return stateCost + platformFee
                            })()}
                          </span>
                          <span className="text-sm text-gray-600 sm:text-gray-500">USD</span>
                        </div>
                      </div>

                      {/* Surcharges breakdown (if any) */}
                      {primary.costBreakdown.surcharges && Object.keys(primary.costBreakdown.surcharges).length > 0 && (
                        <div className="mt-3 text-xs text-gray-600 sm:text-gray-500">
                          Includes dimensional/weight surcharges
                        </div>
                      )}
                    </>
                  )}

                  <div className="mt-3 text-xs text-emerald-600 bg-emerald-50 p-2 rounded">
                    ✓ State-specific permit pricing + TruckerOS platform fee
                  </div>
                </div>

                {/* Notes */}
                {primary.notes && primary.notes.length > 0 && (
                  <div className="p-4 border rounded-lg bg-white">
                    <h3 className="font-semibold mb-2 text-gray-700">Notes</h3>
                    <ul className="text-sm text-gray-600 list-disc list-inside space-y-1">
                      {primary.notes.map((note: string, i: number) => <li key={i}>{note}</li>)}
                    </ul>
                  </div>
                )}

                {/* Other Suggested Routes (shown below primary recommendation) */}
                {hasMultipleOptions && !isSaved && (
                  <div className="mt-2 pt-4 border-t">
                    <h3 className="font-semibold text-base mb-3 text-gray-700">Other Agent-Suggested Routes</h3>
                    <div className="space-y-3">
                      {agentResult.options.slice(1).map((option: any, index: number) => (
                        <div key={index} className="border rounded-lg p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3 bg-white">
                          <div>
                            <div className="font-medium">{option.routeCorridor?.join(' → ') || 'Route'}</div>
                            <div className="text-sm text-gray-600">
                              {option.permitRequiredStates?.length || 0} state(s) require permit
                              {option.escortRequiredStates?.length > 0 && ` • ${option.escortRequiredStates.length} escort(s)`}
                              {' '}• Est. ${option.estimatedCost ?? 0}
                            </div>
                          </div>
                          <button
                            onClick={() => handleApproveSpecificOption(option)}
                            disabled={loading}
                            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded text-sm font-medium disabled:bg-gray-400"
                          >
                            Approve this route
                          </button>
                        </div>
                      ))}
                    </div>
                    <p className="text-xs text-gray-600 sm:text-gray-500 mt-2">These are alternative corridors returned by the routing engine. Review and approve one if the primary is not suitable.</p>
                  </div>
                )}

                {/* Raw Data (collapsible) */}
                <details className="border rounded-lg bg-gray-50 p-4">
                  <summary className="cursor-pointer font-medium text-gray-700 hover:text-gray-900">
                    Show raw agent + database response (for debugging; or-tools results include _source/meta/loadDetails for richer data)
                  </summary>
                  <div className="mt-4 grid md:grid-cols-2 gap-4">
                    <div>
                      <h4 className="text-xs font-semibold text-gray-600 sm:text-gray-500 mb-1">AGENT RESPONSE</h4>
                      <pre className="text-xs bg-white p-3 rounded border overflow-auto max-h-80">
                        {JSON.stringify(agentResult || result?.agent, null, 2)}
                      </pre>
                    </div>
                    {(savedToDatabase || result?.savedToDatabase) && (
                      <div>
                        <h4 className="text-xs font-semibold text-gray-600 sm:text-gray-500 mb-1">SAVED TO SUPABASE</h4>
                        <pre className="text-xs bg-white p-3 rounded border overflow-auto max-h-80">
                          {JSON.stringify(result?.savedToDatabase, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                </details>

                {/* Clear Button */}
                <button
                  onClick={() => {
                    setResult(null)
                    setAgentResult(null)
                    setSavedToDatabase(false)
                    setShowChangeRouteInput(false)
                    setManualRoute('')
                  }}
                  className="text-sm text-gray-600 sm:text-gray-500 hover:text-gray-700 underline"
                >
                  Clear results and test another load
                </button>
              </>
            )
          })()}
        </div>
      )}

      {/* Database Schema Helper - For adding new columns */}
      <div className="mt-12 pt-8 border-t">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-gray-700">Database Schema Status</h3>
            <a href="/admin/db" className="text-xs text-blue-600 hover:underline">Open full admin page →</a>
          </div>
          <button
            onClick={checkMigrationStatus}
            disabled={checkingMigration}
            className="text-xs px-3 py-1 bg-gray-200 hover:bg-gray-300 rounded disabled:opacity-50"
          >
            {checkingMigration ? 'Checking...' : 'Check Status'}
          </button>
        </div>

        {migrationStatus ? (
          <div className="text-sm space-y-2">
            {migrationStatus.authRequired || migrationStatus.adminAccessDenied ? (
              <div className="p-3 bg-red-50 border border-red-200 rounded text-red-700">
                <strong>Admin access required</strong>
                <div className="mt-1">{migrationStatus.error}</div>
              </div>
            ) : !migrationStatus.hasAdmin ? (
              <div className="p-3 bg-gray-100 rounded text-gray-600 text-sm">
                Service role not configured on the server.<br />
                Add <code>SUPABASE_SERVICE_ROLE_KEY</code> to <code>.env.local</code> to enable schema checks.
              </div>
            ) : migrationStatus.columnsExist ? (
              <div className="p-3 bg-green-50 border border-green-200 rounded text-green-700">
                ✅ All required schema columns exist — <code>permit_requests</code> route fields (
                <code>origin_query</code>, <code>destination_query</code>, <code>drops</code>,{' '}
                <code>cost_breakdown</code>, <code>distance_miles</code>, <code>duration_hours</code>
                ), <code>equipment_profiles.license_plate</code> / <code>license_plate_state</code>, and{' '}
                <code>rig_configurations.is_default</code>.
              </div>
            ) : (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded">
                <div className="text-amber-700 mb-2">
                  ⚠️ Migration needed — required columns are missing (
                  <code>permit_requests</code>, <code>equipment_profiles</code>, or{' '}
                  <code>rig_configurations</code>).
                </div>
                {migrationStatus.missingColumns?.length > 0 && (
                  <ul className="mb-2 list-inside list-disc text-xs text-amber-800">
                    {migrationStatus.missingColumns.map((col: string) => (
                      <li key={col}>{col}</li>
                    ))}
                  </ul>
                )}
                <button
                  onClick={applyMigration}
                  className="px-4 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-sm rounded"
                >
                  Show SQL to Apply Migration
                </button>
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-gray-600 sm:text-gray-500">Click &quot;Check Status&quot; to verify permit, equipment, and rig-builder schema columns.</p>
        )}

        <p className="text-xs text-gray-600 sm:text-gray-500 mt-2">
          Covers permit route metadata, equipment license plates, and default rig selection for the Permit Agent.
        </p>
      </div>
      </div>{/* max-w-3xl content shell */}
    </div>
  )
}