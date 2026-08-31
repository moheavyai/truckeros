'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import VehicleDiagram from '@/components/VehicleDiagram'
import EscortRequirementsCard from '@/components/EscortRequirementsCard'
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
import { formatDimensionDisplay, formatRigSummaryLine as buildRigSummaryLine } from '@/lib/parse-dimension'
import { getGrossHeightDisplay } from '@/lib/routing-envelope-display'
import { formatLicensePlateDisplay } from '@/lib/license-plate'
import { normalizeLicensePlateState } from '@/lib/us-states'
import DimensionInput from '@/components/DimensionInput'
import OverhangFeetInput from '@/components/OverhangFeetInput'
import LocationStopInput from '@/components/LocationStopInput'
import ActiveCarrierBanner from '@/components/ActiveCarrierBanner'
import AppHeader from '@/components/AppHeader'
import {
  RouteMapCard,
  ROUTE_MAP_CARD_EMBED_CLASS,
  buildRouteMapModel,
  toRouteMapBuildInput,
} from '@/components/route-map'
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
  formatDriverDetailLine,
  getDriverCdlStatus,
  driverCdlStatusLabel,
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
  DEFAULT_MOVE_TYPE,
  DEFAULT_NUMBER_OF_PIECES,
  LOADED_ARRANGEMENT_LABELS,
  LOADED_ARRANGEMENT_OPTIONS,
  MAX_NUMBER_OF_PIECES,
  MOVE_TYPE_LABELS,
  MOVE_TYPE_OPTIONS,
  applyNumberOfPiecesChange,
  parseAndClampPieces,
  resolveLoadedArrangementForPieces,
  resolvePiecesAndArrangementForSubmit,
  sanitizeNumberOfPieces,
  type LoadedArrangement,
  type LoadedArrangementFormValue,
  type MoveType,
} from '@/lib/load-details-options'
import { buildPermitCargoSnapshot } from '@/lib/permit-cargo-snapshot'
import { canRunRouteAnalysis, NO_TRACTOR_ANALYSIS_HINT } from '@/lib/analysis-readiness'
import {
  EMAIL_VERIFY_APPROVE_TITLE,
  getEmailVerificationStatus,
} from '@/lib/email-verification'
import { isDevEnvironment } from '@/lib/dev-mode'
import {
  formatRoutePreferenceAsSpecialInstructions,
  hasParseableRoutePreference,
  isAvoidHighwayOnlyPreference,
  isStatesOnlyRoutePreference,
  parseRoutePreferenceInput,
} from '@/lib/build-corridor'
import {
  AXLE_GROUP_LABELS,
  MAX_TOTAL_AXLES,
  assignAxleGroups,
  buildCombinationAdjacentSpacingsIn,
  buildRigAxleSnapshot,
  classifyGroupAxleConfig,
  displayGroupWeightLimitLbs,
  distributeWeightSteerFirst,
  distributeWeightToGroup,
  formatAxleGroupSummaryLine,
  resolveAxleGroupsFromConfig,
  resolveDeclaredAxleCount,
  sumGroupWeightLbs,
  withinGroupSpacingsFromCombination,
  type AxleGroupSummary,
} from '@/lib/axle-groups'
import type { MemberProfile, TeamMemberListItem, TeamMemberProfile } from '@/types/member-profile'

type DropStop = LocationStop & { lat?: number; lon?: number }
type StopKey = 'origin' | `drop-${string}`

function dropStopKey(drop: DropStop): StopKey {
  return `drop-${drop.id}`
}

type CargoLoadDetailsPrefill = {
  cargoDescription?: string
  cargoManufacturer?: string
  cargoMakeModel?: string
  cargoSerialNumber?: string
  numberOfPieces?: number
  loadedArrangement?: LoadedArrangementFormValue
  moveType?: MoveType
  loadWeightLbs?: string
  loadLengthFt?: string
  loadWidthFt?: string
  loadHeightFt?: string
}

function optionalPrefillText(value: unknown): string | undefined {
  if (value == null) return undefined
  return String(value)
}

function optionalPrefillDim(value: unknown): string | undefined {
  if (value == null || value === '') return undefined
  if (typeof value === 'number' && !Number.isFinite(value)) return undefined
  return String(value)
}

/** Map persisted cargo snapshot onto Load details fields. Does not invent envelope dims. */
function cargoSnapshotToLoadDetailsPatch(cargo: unknown): CargoLoadDetailsPrefill {
  if (!cargo || typeof cargo !== 'object') return {}
  const src = cargo as Record<string, unknown>
  const patch: CargoLoadDetailsPrefill = {}

  const description = optionalPrefillText(src.description)
  if (description !== undefined) patch.cargoDescription = description
  const manufacturer = optionalPrefillText(src.manufacturer)
  if (manufacturer !== undefined) patch.cargoManufacturer = manufacturer
  const makeModel = optionalPrefillText(src.makeModel)
  if (makeModel !== undefined) patch.cargoMakeModel = makeModel
  const serialNumber = optionalPrefillText(src.serialNumber)
  if (serialNumber !== undefined) patch.cargoSerialNumber = serialNumber
  if (src.numberOfPieces != null) {
    patch.numberOfPieces = sanitizeNumberOfPieces(src.numberOfPieces)
  }
  if (
    typeof src.loadedArrangement === 'string' &&
    (LOADED_ARRANGEMENT_OPTIONS as readonly string[]).includes(src.loadedArrangement)
  ) {
    patch.loadedArrangement = src.loadedArrangement as LoadedArrangement
  }
  if (
    typeof src.moveType === 'string' &&
    (MOVE_TYPE_OPTIONS as readonly string[]).includes(src.moveType)
  ) {
    patch.moveType = src.moveType as MoveType
  }

  const load = src.load && typeof src.load === 'object' ? (src.load as Record<string, unknown>) : null
  if (load) {
    const weightLbs = optionalPrefillDim(load.weightLbs)
    if (weightLbs !== undefined) patch.loadWeightLbs = weightLbs
    const lengthFt = optionalPrefillDim(load.lengthFt)
    if (lengthFt !== undefined) patch.loadLengthFt = lengthFt
    const widthFt = optionalPrefillDim(load.widthFt)
    if (widthFt !== undefined) patch.loadWidthFt = widthFt
    const heightFt = optionalPrefillDim(load.heightFt)
    if (heightFt !== undefined) patch.loadHeightFt = heightFt
  }

  return patch
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
  'border border-gray-500 sm:border-gray-300 text-gray-900 placeholder:text-gray-400 bg-white'
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

/** True when a trailer object has enough fields to group (not an id-only stub). */
function isRichTrailerUnit(tr: unknown): boolean {
  if (!tr || typeof tr !== 'object') return false
  const t = tr as Record<string, unknown>
  return (
    t.num_axles != null ||
    t.trailer_type != null ||
    t.profile_name != null ||
    t.overall_length_ft != null ||
    t.axle_spacings != null
  )
}

/** True when tractor has geometry/axle fields (not id-only). */
function isRichTractorUnit(tr: unknown): boolean {
  if (!tr || typeof tr !== 'object') return false
  const t = tr as Record<string, unknown>
  return (
    t.num_axles != null ||
    t.profile_name != null ||
    t.overall_length_ft != null ||
    t.axle_spacings != null
  )
}

/**
 * Resolve axle count + groups.
 * Prefer live recompute from rich tractor+trailers; only trust precomputed groups
 * when live equipment is incomplete or missing. Never mix tractor-only groups with
 * full rig.computed_total_axles.
 */
function resolvePermitAxleLayout(
  axles: number | string | null | undefined,
  rigSnapshot: {
    tractor?: unknown
    trailers?: unknown[] | null
    axleGroups?: AxleGroupSummary | null
    totalAxles?: number | null
    incompleteEquipment?: boolean
  } | null | undefined
) {
  const formAxles = Math.max(1, Math.min(MAX_TOTAL_AXLES, Number(axles) || 5))
  const precomputed = rigSnapshot?.axleGroups ?? null
  const tractor = rigSnapshot?.tractor
  const allTrailers = Array.isArray(rigSnapshot?.trailers) ? rigSnapshot!.trailers! : []
  const richTractor = isRichTractorUnit(tractor) ? tractor : null
  const richTrailers = allTrailers.filter(isRichTrailerUnit)

  const liveSummary =
    richTractor || richTrailers.length > 0
      ? assignAxleGroups(
          richTractor as Parameters<typeof assignAxleGroups>[0],
          richTrailers as Parameters<typeof assignAxleGroups>[1]
        )
      : null

  let summary: AxleGroupSummary
  if (liveSummary && liveSummary.totalAxles > 0) {
    // Prefer live recompute when equipment is present.
    // If precomputed exists and disagrees, live wins (avoids stale partial groups).
    if (
      precomputed &&
      precomputed.totalAxles > 0 &&
      precomputed.totalAxles !== liveSummary.totalAxles &&
      rigSnapshot?.incompleteEquipment
    ) {
      // Incomplete hydration: keep larger of live vs precomputed only when precomputed
      // matches declared totalAxles (full-rig cache from save time).
      const declared = Number(rigSnapshot.totalAxles) || 0
      if (declared > 0 && precomputed.totalAxles === declared && liveSummary.totalAxles < declared) {
        summary = precomputed
      } else {
        summary = liveSummary
      }
    } else {
      summary = liveSummary
    }
  } else if (precomputed && precomputed.totalAxles > 0) {
    summary = precomputed
  } else {
    summary = resolveAxleGroupsFromConfig({ axles: formAxles })
  }

  const n =
    summary.totalAxles > 0
      ? Math.min(MAX_TOTAL_AXLES, summary.totalAxles)
      : formAxles
  return { n, groups: summary.groups, summary }
}

/** Live overall length from equipment geometry when possible; else cached/fallback. */
function resolveRigBaseLengthFt(
  snap: {
    tractor?: unknown
    trailers?: unknown[] | null
    overallLengthFt?: number | null
  } | null | undefined,
  trailerLengthFt?: number | string | null
): number {
  if (snap && (isRichTractorUnit(snap.tractor) || (snap.trailers || []).some(isRichTrailerUnit))) {
    const dims = computeRigDimensions(
      isRichTractorUnit(snap.tractor)
        ? (snap.tractor as Parameters<typeof computeRigDimensions>[0])
        : null,
      ((snap.trailers || []).filter(isRichTrailerUnit) as Parameters<
        typeof computeRigDimensions
      >[1]) || []
    )
    if (dims.totalLengthFt > 0) return dims.totalLengthFt
  }
  if (snap?.overallLengthFt != null && Number(snap.overallLengthFt) > 0) {
    return Number(snap.overallLengthFt)
  }
  return Number(trailerLengthFt) || 0
}

/**
 * Routing-envelope base length.
 * Selected rig → equipment geometry (via resolveRigBaseLengthFt).
 * No rig / custom dimensions → load length only (never trailer default 53).
 */
function resolveEnvelopeBaseLengthFt(
  snap: {
    tractor?: unknown
    trailers?: unknown[] | null
    overallLengthFt?: number | null
  } | null | undefined,
  trailerLengthFt?: number | string | null,
  loadLengthFt?: number | string | null
): number {
  if (snap) {
    return resolveRigBaseLengthFt(snap, trailerLengthFt)
  }
  return Number(loadLengthFt) || 0
}

/** Unified gross for analyze / save / UI: prefer grossLoadedWeight when set. */
function resolveSubmitWeightLbs(form: {
  grossLoadedWeight?: number | string | null
  weight?: number | string | null
}): number {
  const gross = Number(form.grossLoadedWeight)
  if (Number.isFinite(gross) && gross > 0) return gross
  const w = Number(form.weight)
  return Number.isFinite(w) && w > 0 ? w : 0
}

/** Build rich rig snapshot for VehicleDiagram + permit equipment JSONB (groups/spacings/lifts). */
function buildSelectedRigSnapshot(
  rig: RigConfiguration,
  fullTractor: Tractor | null,
  fullTrailers: Trailer[]
) {
  const expectedTrailerIds = rig.trailer_ids || []
  const missingTrailerIds = expectedTrailerIds.filter(
    (tid) => !fullTrailers.some((tr) => tr.id === tid)
  )
  const incompleteEquipment =
    (!!rig.tractor_id && !fullTractor) || missingTrailerIds.length > 0

  // Prefer full units; fall back to id stubs only for display linkage (not for grouping).
  const tractor = fullTractor || ({ id: rig.tractor_id } as Partial<Tractor>)
  const trailers =
    fullTrailers.length > 0
      ? fullTrailers
      : expectedTrailerIds.map((tid: string) => ({ id: tid }) as Partial<Trailer>)

  // Groups only from units we actually hydrated (never invent trailer defaults from stubs).
  const axleSnap = buildRigAxleSnapshot(
    fullTractor,
    fullTrailers.length > 0 ? fullTrailers : null
  )

  // Live length when equipment is present; else cached computed value.
  let overallLengthFt: number | null = rig.computed_total_length_ft ?? null
  if (fullTractor || fullTrailers.length > 0) {
    const dims = computeRigDimensions(fullTractor, fullTrailers)
    if (dims.totalLengthFt > 0) overallLengthFt = dims.totalLengthFt
  }

  // totalAxles: when hydration is complete use live groups (or cache).
  // When partial, do NOT pad live tractor-only groups up to full computed_total_axles —
  // that desyncs group layout from weight slots. Prefer live; keep cache only if live empty.
  let totalAxles: number | null = axleSnap.totalAxles > 0 ? axleSnap.totalAxles : null
  if (!incompleteEquipment) {
    totalAxles =
      axleSnap.totalAxles ||
      rig.computed_total_axles ||
      null
  } else if (totalAxles == null) {
    totalAxles = rig.computed_total_axles || null
  }

  // If complete hydration produced groups, store them; if partial, still store live groups
  // but mark incomplete so resolvePermitAxleLayout can prefer precomputed when richer.
  return {
    rigId: rig.id,
    rigName: rig.rig_name,
    overallLengthFt,
    totalAxles,
    tractor,
    trailers,
    axleGroups: axleSnap.groups,
    axleGroupSummary: axleSnap.groupLine,
    tractorSpacingsIn: axleSnap.tractorSpacingsIn,
    trailerSpacingsIn: axleSnap.trailerSpacingsIn,
    kingpinToFirstAxleIn: axleSnap.kingpinToFirstAxleIn,
    trailerHasLiftAxle: axleSnap.trailerHasLiftAxle,
    incompleteEquipment,
    missingTrailerIds,
  }
}

/** Trim axleWeights to current axle count for analyze/optimize payloads. */
function trimAxleWeightsForSubmit(
  axleWeights: unknown,
  axles: number | string | null | undefined,
  rigSnapshot?: { tractor?: unknown; trailers?: unknown[] | null } | null
): number[] | undefined {
  if (!Array.isArray(axleWeights)) return undefined
  const { n } = resolvePermitAxleLayout(axles, rigSnapshot)
  return axleWeights.slice(0, n).map((w) => Number(w) || 0)
}

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
  const [emailVerified, setEmailVerified] = useState(false)
  const [emailVerifyGateError, setEmailVerifyGateError] = useState<string | null>(null)
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
        try {
          const verifyRes = await getEmailVerificationStatus(session.access_token)
          const verifyBody = await verifyRes.json().catch(() => ({}))
          setEmailVerified(Boolean(verifyRes.ok && verifyBody.verified))
        } catch {
          setEmailVerified(false)
        }
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

  // Schema status is admin/dev only — do not auto-check for carriers.

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
    width: 8.5, // legal trailer/rig width when no load details override
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
    // Pieces default to 1 → no Loaded arrangement selected until multi-piece.
    loadedArrangement: resolveLoadedArrangementForPieces(DEFAULT_NUMBER_OF_PIECES, ''),
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
    // Steer-first default: 12k on steer, remainder even on other axles (5-axle @ 80k → 12k + 4×17k).
    axleWeights: distributeWeightSteerFirst(
      5,
      80_000,
      resolveAxleGroupsFromConfig({ axles: 5 }).groups
    ),
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
  // - "Change Route" / Submit New Route: states-only → manualRoute array; highways (or mixed) → specialInstructions prefer path (same as prefs).
  const [manualRoute, setManualRoute] = useState('')
  const [changeRouteError, setChangeRouteError] = useState<string | null>(null)
  const [changeRouteBusy, setChangeRouteBusy] = useState(false)

  // Tier selector for cost estimation (temporary for testing)
  const [selectedTier, setSelectedTier] = useState<'Free' | 'Starter' | 'Pro'>('Starter')

  // Routing engine (kept for payload shape + quick mode force + voice; selector UI replaced by optimizationMode toggle)
  const [routingEngine, setRoutingEngine] = useState<'osrm' | 'graphhopper'>('osrm')
  const optimizationMode = 'ortools' as const

  const [routeProgress, setRouteProgress] = useState<'idle' | 'geocoding' | 'calculating' | 'ready' | 'error'>('idle')
  const [routeProgressDetail, setRouteProgressDetail] = useState('')
  /** When false (Reject & Start Over, or redo prefill), field changes do not auto-run analysis. */
  const [autoRouteEnabled, setAutoRouteEnabled] = useState(true)
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

  // NEW (Intake v2): equipment profile selector (declared early so helpers below can reference safely)
  const [equipmentProfiles, setEquipmentProfiles] = useState<any[]>([])
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null)
  const [loadingProfiles, setLoadingProfiles] = useState(false)

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

  // Re-do / review mode: prefill from a saved permit_request, do not auto-run
  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const requestId = params.get('requestId')
    const mode = params.get('mode')
    if (!requestId) return

    let cancelled = false
    ;(async () => {
      try {
        const supabase = createClient()
        const { data, error } = await supabase
          .from('permit_requests')
          .select('*')
          .eq('id', requestId)
          .maybeSingle()
        if (cancelled || error || !data) return

        const dropsRaw = Array.isArray(data.drops) ? data.drops : []
        const drops =
          dropsRaw.length > 0
            ? dropsRaw.map((d: any, i: number) => ({
                id: String(d.id || `drop-${i + 1}`),
                query: String(d.query || ''),
                street: String(d.street || ''),
                city: String(d.city || ''),
                state: String(d.state || ''),
                zip: String(d.zip || ''),
                lat: typeof d.lat === 'number' ? d.lat : undefined,
                lon: typeof d.lon === 'number' ? d.lon : undefined,
              }))
            : [
                {
                  id: 'drop-1',
                  query: String(data.destination_query || ''),
                  street: '',
                  city: String(data.destination_city || ''),
                  state: String(data.destination_state || ''),
                  zip: '',
                  lat: undefined as number | undefined,
                  lon: undefined as number | undefined,
                },
              ]

        const cargoPatch = cargoSnapshotToLoadDetailsPatch(data.cargo)
        const equipment =
          data.equipment && typeof data.equipment === 'object'
            ? (data.equipment as Record<string, unknown>)
            : null
        const savedRigId =
          (typeof equipment?.selectedRigId === 'string' && equipment.selectedRigId) ||
          (typeof equipment?.profileId === 'string' && equipment.profileId) ||
          ''
        // Same path as ?rigId= — do not clobber an explicit URL rig.
        if (savedRigId && !pendingRigIdRef.current) {
          pendingRigIdRef.current = savedRigId
        }

        setFormData((prev) => ({
          ...prev,
          origin: {
            ...prev.origin,
            // keep stable LocationStop.id required by type
            query: String(data.origin_query || ''),
            street: '',
            city: String(data.origin_city || ''),
            state: String(data.origin_state || ''),
            zip: '',
          },
          drops: drops.map((d: any, i: number) => ({
            ...(prev.drops[i] ? { id: prev.drops[i].id } : {}),
            id: String(d.id || prev.drops[i]?.id || `drop-${i + 1}`),
            query: String(d.query || ''),
            street: String(d.street || ''),
            city: String(d.city || ''),
            state: String(d.state || ''),
            zip: String(d.zip || ''),
            lat: typeof d.lat === 'number' ? d.lat : undefined,
            lon: typeof d.lon === 'number' ? d.lon : undefined,
          })),
          weight: Number(data.weight) || prev.weight,
          length: Number(data.length) || prev.length,
          width: Number(data.width) || prev.width,
          height: Number(data.height) || prev.height,
          ...cargoPatch,
        }))
        setAgentResult(null)
        setResult(null)
        setSavedToDatabase(false)
        if (mode === 'review' || params.has('requestId')) {
          setAutoRouteEnabled(false)
          setRouteProgress('idle')
          setRouteProgressDetail('Review prefilled route, then tap Run analysis')
        }
      } catch (e) {
        console.warn('[permit-test] prefill from requestId failed', e)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const tractorWt = Number(formData.tractorEmptyWeightLbs) || 0
    const trailerWt = Number(formData.trailerEmptyWeightLbs) || 0
    // Prefer sum of tractor + all trailers when both sides present; else rigEmpty field.
    const rigEmpty =
      tractorWt > 0 && trailerWt > 0
        ? tractorWt + trailerWt
        : Number(formData.rigEmptyWeightLbs) || 0
    // Live recompute length from equipment when rich units available (not stale cache only).
    // No-rig / custom dimensions: load length only — never trailer default 53.
    const rigBaseLength = resolveEnvelopeBaseLengthFt(
      selectedRigSnapshot,
      formData.trailerLengthFt,
      formData.loadLengthFt
    )
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

      const { n, groups } = resolvePermitAxleLayout(prev.axles, selectedRigSnapshot)
      const prevWeights = Array.isArray(prev.axleWeights) ? prev.axleWeights : []
      // Keep weight + grossLoadedWeight in lockstep from envelope gross.
      const weightChanged =
        envelope.weightLbs > 0 &&
        (Math.abs(Number(prev.weight) - envelope.weightLbs) > 1 ||
          Math.abs(Number(prev.grossLoadedWeight) - envelope.weightLbs) > 1)
      const axleCountMismatch = prevWeights.length !== n
      const axlesOutOfSync = Number(prev.axles) !== n

      if (weightChanged) {
        next.weight = envelope.weightLbs
        next.grossLoadedWeight = envelope.weightLbs
        changed = true
      }
      // Redistribute when gross envelope changes or axle count/layout no longer matches weights.
      if (weightChanged || axleCountMismatch) {
        const gross = weightChanged
          ? envelope.weightLbs
          : Number(prev.grossLoadedWeight) || Number(prev.weight) || 80_000
        next.axleWeights = distributeWeightSteerFirst(n, gross, groups)
        changed = true
      }
      // Keep form axles aligned with equipment group total when a rig is selected.
      if (axlesOutOfSync && selectedRigSnapshot && n > 0) {
        next.axles = n
        changed = true
      }
      return changed ? next : prev
    })
  }, [
    formData.loadWidthFt, formData.loadHeightFt, formData.loadWeightLbs, formData.loadLengthFt,
    formData.trailerLengthFt, formData.trailerWidthFt, formData.trailerDeckHeightFt,
    formData.tractorEmptyWeightLbs, formData.trailerEmptyWeightLbs, formData.rigEmptyWeightLbs,
    loadOverhangFrontFt, loadOverhangRearFt, selectedRigSnapshot, formData.axles,
  ])

  // Full tractor/trailer objects (decoded from equipment_profiles RIGBUILDER payloads).
  // Required so VehicleDiagram receives overall_length_ft, fifth_wheel, axle data etc. for full rig graphics.
  const [tractors, setTractors] = useState<Tractor[]>([])
  const [trailers, setTrailers] = useState<Trailer[]>([])
  const [tractorsLoaded, setTractorsLoaded] = useState(false)

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
    const rigBaseLength = resolveEnvelopeBaseLengthFt(
      selectedRigSnapshot,
      formData.trailerLengthFt,
      formData.loadLengthFt
    )
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
    // Sum empty weight across ALL trailers (not primary-only) for envelope gross.
    const allTrailersEmpty = fullTrailers.reduce(
      (sum, tr) => sum + (Number(tr?.empty_weight_lbs) || 0),
      0
    )
    const groupSummary = assignAxleGroups(fullTractor, fullTrailers)
    const resolvedAxles =
      groupSummary.totalAxles ||
      (fullTractor && fullTrailers.length === (rig.trailer_ids || []).length
        ? rig.computed_total_axles
        : null) ||
      fullTractor?.num_axles ||
      5
    return {
      unitNumber: fullTractor?.unit_number || '',
      vin: fullTractor?.vin || '',
      trailerVin: primary.vin || '',
      tractorEmptyWeightLbs: fullTractor?.empty_weight_lbs ? String(fullTractor.empty_weight_lbs) : '',
      // Multi-trailer: sum all empty weights so envelope weight is not undercounted.
      trailerEmptyWeightLbs: allTrailersEmpty > 0 ? String(allTrailersEmpty) : '',
      rigEmptyWeightLbs: rigEmpty ? String(rigEmpty) : '',
      trailerWidthFt: primary.widthFt ? String(primary.widthFt) : '',
      trailerDeckHeightFt: primary.deckHeightFt ? String(primary.deckHeightFt) : '',
      year: fullTractor?.year != null ? String(fullTractor.year) : '',
      make: fullTractor?.make || '',
      model: fullTractor?.model || '',
      // Prefer resolved group total so axle-weight UI matches equipment layout.
      axles: resolvedAxles,
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
    setTractorsLoaded(false)
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
    } finally {
      setTractorsLoaded(true)
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
  }

  // NEW Smart Rig Selector handler (v3) — sets snapshot for clean display + submit payload
  function handleSelectRig(rig: RigConfiguration | null) {
    if (!rig) {
      // Custom dimensions / no rig: drop residual equipment envelope so analysis is load-only
      // (self-powered oversize e.g. taxi crane). Keep pure load detail fields.
      setSelectedRigId(null)
      setSelectedRigSnapshot(null)
      setFormData((prev) => {
        const next = {
          ...prev,
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
          trailerMake: '',
          trailerModel: '',
          trailerYear: '',
          // Number field (default 53 when rig selected) — clear to 0, not '' (FormData type)
          trailerLengthFt: 0,
          kingpinSettingIn: 36,
          axleSpacing: '',
          // Synthetic layout when no rig (do not keep previous rig axle count/groups).
          axles: 5,
        }
        const envelope = computeRoutingEnvelope({
          // Self-powered: cargo/load length is the vehicle base length.
          rigLengthFt: Number(next.loadLengthFt) || 0,
          loadOverhangFrontFt,
          loadOverhangRearFt,
          trailerWidthFt: 0,
          loadWidthFt: Number(next.loadWidthFt) || 0,
          deckHeightFt: 0,
          loadHeightFt: Number(next.loadHeightFt) || 0,
          rigEmptyWeightLbs: 0,
          loadWeightLbs: Number(next.loadWeightLbs) || 0,
        })
        next.length = envelope.lengthFt > 0 ? envelope.lengthFt : 60
        next.width = envelope.widthFt > 0 ? envelope.widthFt : 8.5
        next.height = envelope.heightFt > 0 ? envelope.heightFt : 13.5
        const gross = envelope.weightLbs > 0 ? envelope.weightLbs : 80_000
        next.weight = gross
        next.grossLoadedWeight = gross
        const { n, groups } = resolvePermitAxleLayout(next.axles, null)
        next.axles = n
        next.axleWeights = distributeWeightSteerFirst(n, gross, groups)
        return next
      })
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

    // Rich snapshot: VehicleDiagram geometry + axle groups/spacings/lift flags for permit prefill
    const snap = buildSelectedRigSnapshot(rig, fullTractor, fullTrailers)
    setSelectedRigSnapshot(snap)

    const synced = rigFieldsFromEquipment(fullTractor, fullTrailers, rig)
    setFormData((prev) => {
      const next = { ...prev, ...synced }
      const { n, groups } = resolvePermitAxleLayout(next.axles, snap)
      const gross = Number(next.grossLoadedWeight) || Number(next.weight) || 80_000
      next.axles = n
      next.axleWeights = distributeWeightSteerFirst(n, gross, groups)
      return next
    })
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

      const snap = buildSelectedRigSnapshot(currentRig, fullTractor, fullTrailers)
      setSelectedRigSnapshot(snap)
      const synced = rigFieldsFromEquipment(fullTractor, fullTrailers, currentRig)
      setFormData((prev) => {
        const next = { ...prev, ...synced }
        const { n, groups } = resolvePermitAxleLayout(next.axles, snap)
        const gross = Number(next.grossLoadedWeight) || Number(next.weight) || 80_000
        next.axles = n
        next.axleWeights = distributeWeightSteerFirst(n, gross, groups)
        return next
      })
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

  // Ref for scrolling to results after submission
  const resultsRef = useRef<HTMLDivElement>(null)
  const routeMapSectionRef = useRef<HTMLDivElement>(null)

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
    // Clear prior geocode error for this field as soon as user edits
    setErrors((prev) => {
      const errKey = stopKey === 'origin' ? 'origin.query' : `${stopKey}.query`
      if (!prev[errKey] && !prev['geocode']) return prev
      const next = { ...prev }
      delete next[errKey]
      delete next['geocode']
      return next
    })
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

    // Cancel any pending timeout for this key (user still typing)
    if (geocodeTimeoutRef.current[stopKey]) {
      clearTimeout(geocodeTimeoutRef.current[stopKey])
    }

    geocodeTimeoutRef.current[stopKey] = setTimeout(async () => {
      // Re-check readiness after debounce — avoid firing on intermediate spaces/partials
      const latestAddress = getStopFromForm(formDataRef.current, stopKey)
      if (!isAddressReadyForGeocode(latestAddress)) {
        return
      }

      // Only apply cooldown once we are about to actually call the geocoder
      const now = Date.now()
      if (now - (lastGeocodeAttempt.current[stopKey] || 0) < GEOCODE_COOLDOWN_MS) {
        const seconds = Math.ceil(GEOCODE_COOLDOWN_MS / 1000)
        setGeocodeStatus(`Please wait ~${seconds}s before geocoding again`)
        return
      }
      lastGeocodeAttempt.current[stopKey] = now

      setIsGeocoding((prev) => ({ ...prev, [stopKey]: true }))
      setGeocodeStatus(`Geocoding ${stopKey}...`)

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
          // Clear any prior error for this field
          setErrors((prev) => {
            const key = stopKey === 'origin' ? 'origin.query' : `${stopKey}.query`
            if (!prev[key] && !prev['geocode']) return prev
            const next = { ...prev }
            delete next[key]
            delete next['geocode']
            return next
          })
        } else if (isGeocodeFailure(result)) {
          setShowManualCoords((prev) => ({ ...prev, [stopKey]: true }))
          setGeocodeStatus(result.userMessage)
          // Surface failure on the input for border + soft refocus
          const errKey = stopKey === 'origin' ? 'origin.query' : `${stopKey}.query`
          setErrors((prev) => ({ ...prev, [errKey]: result.userMessage || 'Could not geocode — check address' }))
          setRouteProgress((p) => (p === 'geocoding' || p === 'calculating' ? 'error' : p))
          setRouteProgressDetail('Fix the address above, then route will continue')
          // Soft refocus the failed field after a tick so the user can continue typing
          setTimeout(() => {
            const el = document.querySelector(
              stopKey === 'origin'
                ? '#origin-address-section input[type="text"]'
                : `#drops-section [data-drop-id="${String(stopKey).replace('drop-', '')}"] input[type="text"]`
            ) as HTMLInputElement | null
            el?.focus({ preventScroll: true })
          }, 50)
        }
      } catch (error: any) {
        console.error('Geocoding error:', error)
        setShowManualCoords((prev) => ({ ...prev, [stopKey]: true }))
        setGeocodeStatus(GEOCODE_BUSY_MESSAGE)
        const errKey = stopKey === 'origin' ? 'origin.query' : `${stopKey}.query`
        setErrors((prev) => ({ ...prev, [errKey]: GEOCODE_BUSY_MESSAGE }))
        setRouteProgress((p) => (p === 'geocoding' || p === 'calculating' ? 'error' : p))
        setRouteProgressDetail('Fix the address above, then route will continue')
        setTimeout(() => {
          const el = document.querySelector(
            stopKey === 'origin'
              ? '#origin-address-section input[type="text"]'
              : `#drops-section [data-drop-id="${String(stopKey).replace('drop-', '')}"] input[type="text"]`
          ) as HTMLInputElement | null
          el?.focus({ preventScroll: true })
        }, 50)
      } finally {
        setIsGeocoding((prev) => ({ ...prev, [stopKey]: false }))
      }
    }, 1400) // slightly longer debounce so partial street + space does not fire early
  }, [isGeocoding])

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

    if (!canRunRouteAnalysis({ tractorCount: tractors.length })) {
      newErrors['equipment'] = NO_TRACTOR_ANALYSIS_HINT
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

  /**
   * Geocode fingerprint only — avoids refitting the map on every form keystroke.
   * Labels recompute when lat/lon or stop query/city/state change.
   */
  const routeMapFormKey = useMemo(() => {
    const s = syncDestinationFromDrops(formData)
    const dropKey = (s.drops || [])
      .map(
        (d) =>
          `${d.lat ?? ''},${d.lon ?? ''}|${d.city || ''}|${d.state || ''}|${d.query || ''}`
      )
      .join(';')
    return [
      s.originLat ?? '',
      s.originLon ?? '',
      s.destinationLat ?? '',
      s.destinationLon ?? '',
      s.origin.city || '',
      s.origin.state || '',
      s.origin.query || '',
      s.destination.city || '',
      s.destination.state || '',
      s.destination.query || '',
      dropKey,
    ].join('|')
  }, [
    formData.originLat,
    formData.originLon,
    formData.destinationLat,
    formData.destinationLon,
    formData.origin.city,
    formData.origin.state,
    formData.origin.query,
    formData.destination.city,
    formData.destination.state,
    formData.destination.query,
    formData.drops,
  ])

  /** Map v1 view model: thin page adapter → pure toRouteMapBuildInput → buildRouteMapModel. */
  const routeMapModel = useMemo(() => {
    const primary = getPrimary(agentResult, result)
    const formSynced = syncDestinationFromDrops(formData)
    const coordsReady =
      hasValidCoords(formSynced.originLat, formSynced.originLon) &&
      (formSynced.drops || []).every((drop) => hasValidCoords(drop.lat, drop.lon))
    const dimsReady =
      Number(formSynced.weight) > 0 &&
      Number(formSynced.length) > 0 &&
      Number(formSynced.width) > 0 &&
      Number(formSynced.height) > 0

    return buildRouteMapModel(
      toRouteMapBuildInput({
        routeProgress,
        routeProgressDetail,
        primary: primary || null,
        formSynced,
        coordsReady,
        dimsReady,
      })
    )
    // routeMapFormKey + dims fields capture map-relevant form state (not every keystroke).
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional fingerprint deps
  }, [
    agentResult,
    result,
    routeProgress,
    routeProgressDetail,
    routeMapFormKey,
    formData.weight,
    formData.length,
    formData.width,
    formData.height,
  ])

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
      const failedStops: StopKey[] = []
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
          failedStops.push(stopKey)
          setShowManualCoords((prev) => ({ ...prev, [stopKey]: true }))
          setGeocodeStatus(result.userMessage)
        } else {
          failedStops.push(stopKey)
          setShowManualCoords((prev) => ({ ...prev, [stopKey]: true }))
          setGeocodeStatus(GEOCODE_BUSY_MESSAGE)
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

      if (failedStops.length > 0) {
        setRouteProgress('error')
        setRouteProgressDetail('Fix the address above, then route will continue')
        setLoading(false)
        const first = failedStops[0]
        requestAnimationFrame(() => {
          const el =
            document.getElementById(first === 'origin' ? 'origin-address-section' : 'drops-section') ||
            document.querySelector('[data-geocode-manual="true"]')
          el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        })
        return
      }
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
      // Explicit Run may have set calculating already — restore ready if nothing new to run.
      setRouteProgress('ready')
      setRouteProgressDetail('Route ready')
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
        // Prefer grossLoadedWeight when set so scale checks match axle UI / envelope card.
        weight: resolveSubmitWeightLbs(currentData),
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
        axles: Number(currentData.axles) || undefined,
        axleWeights: trimAxleWeightsForSubmit(
          currentData.axleWeights,
          currentData.axles,
          selectedRigSnapshot
        ),
        equipment: selectedRigSnapshot
          ? {
              tractor: selectedRigSnapshot.tractor,
              trailers: selectedRigSnapshot.trailers,
              // Pass precomputed groups so agent keeps jeep/flip roles when trailers are rich.
              axleGroups: selectedRigSnapshot.axleGroups ?? null,
            }
          : undefined,
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
          const reduceMotion =
            typeof window !== 'undefined' &&
            window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
          window.scrollTo({
            top: elementPosition + window.pageYOffset - headerOffset,
            behavior: reduceMotion ? 'auto' : 'smooth',
          })
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
    if (!tractorsLoaded) return
    if (!canRunRouteAnalysis({ tractorCount: tractors.length })) {
      setRouteProgress('idle')
      setRouteProgressDetail(NO_TRACTOR_ANALYSIS_HINT)
      return
    }

    // Manual review mode (reject / redo): never auto-fire; user must click Run analysis
    if (!autoRouteEnabled) {
      setRouteProgress('idle')
      setRouteProgressDetail('Review form, then tap Run analysis')
      return
    }

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
    isGeocoding, manualRoute, autoRouteEnabled, tractorsLoaded, tractors.length,
  ])

  // New function: Approve & Save (Human Approval Gate)
  const handleApproveAndSave = async () => {
    if (!agentResult) return;

    // Always derive the primary option correctly (supports both single and multi-option shapes)
    const primary = getPrimary(agentResult, null)

    if (routeRequiresPermit(primary) && !emailVerified) {
      setEmailVerifyGateError(EMAIL_VERIFY_APPROVE_TITLE)
      return
    }
    setEmailVerifyGateError(null)

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
      const piecesPatch = resolvePiecesAndArrangementForSubmit(formData, numberOfPiecesDraft)
      if (numberOfPiecesDraft != null || piecesPatch.loadedArrangement !== formData.loadedArrangement) {
        setNumberOfPiecesDraft(null)
        setFormData((p) => ({ ...p, ...piecesPatch }))
      }
      const cargoFormData = { ...formData, ...piecesPatch }
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
        // Same weight source as analyze/envelope (prefer grossLoadedWeight).
        weight: resolveSubmitWeightLbs(formData),
        length: formData.length,
        width: formData.width,
        height: formData.height,
        route_corridor: primary.routeCorridor || [],
        border_crossings: primary.borderCrossings || [],
        highways: primary.highways || [],
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
          ...(() => {
            const { summary } = resolvePermitAxleLayout(formData.axles, selectedRigSnapshot)
            return {
              axleGroups: summary,
              axleGroupSummary: formatAxleGroupSummaryLine(summary),
            }
          })(),
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

    if (routeRequiresPermit(option) && !emailVerified) {
      setEmailVerifyGateError(EMAIL_VERIFY_APPROVE_TITLE)
      return
    }
    setEmailVerifyGateError(null)

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
      const piecesPatch = resolvePiecesAndArrangementForSubmit(formData, numberOfPiecesDraft)
      if (numberOfPiecesDraft != null || piecesPatch.loadedArrangement !== formData.loadedArrangement) {
        setNumberOfPiecesDraft(null)
        setFormData((p) => ({ ...p, ...piecesPatch }))
      }
      const cargoFormData = { ...formData, ...piecesPatch }
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
        weight: resolveSubmitWeightLbs(formData),
        length: formData.length,
        width: formData.width,
        height: formData.height,
        route_corridor: option.routeCorridor || [],
        border_crossings: option.borderCrossings || [],
        highways: option.highways || [],
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
          ...(() => {
            const { summary } = resolvePermitAxleLayout(formData.axles, selectedRigSnapshot)
            return {
              axleGroups: summary,
              axleGroupSummary: formatAxleGroupSummaryLine(summary),
            }
          })(),
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
    setChangeRouteError(null)
    setChangeRouteBusy(false)
    setRouteProgress('idle')
    setRouteProgressDetail('Review form, then tap Run analysis')
    // Stop auto-run so dimension/preference edits do not immediately recalculate
    setAutoRouteEnabled(false)
    if (autoRouteTimeoutRef.current) {
      clearTimeout(autoRouteTimeoutRef.current)
      autoRouteTimeoutRef.current = undefined
    }
    // Scroll back to the form for convenience
    const reduceMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' })
  }

  const scrollFocusRouteMap = () => {
    const el = routeMapSectionRef.current
    if (!el) return
    const reduceMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    el.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' })
    el.focus({ preventScroll: true })
  }

  const handleRunAnalysis = () => {
    // Paint calculating chrome before async geocode/optimize so Run feels started.
    setRouteProgress('calculating')
    setRouteProgressDetail('Calculating best route…')
    setAutoRouteEnabled(true)
    void runRouteAnalysis()
    // Double rAF: Review bar hide + status badge paint before measuring scroll target.
    requestAnimationFrame(() => {
      requestAnimationFrame(scrollFocusRouteMap)
    })
  }

  // Handle manual route change (Change Route feature)
  // States-only (bare list) → manual corridor override; highways / verbs → specialInstructions path.
  // Uses changeRouteBusy only (not loading) so Approve never flips to "Saving…" during route update.
  const handleChangeRoute = async () => {
    if (!manualRoute.trim() || changeRouteBusy) return

    const parsed = parseRoutePreferenceInput(manualRoute)
    if (!hasParseableRoutePreference(parsed)) {
      setChangeRouteError(
        'Could not parse route preferences. Try state codes (MO, NE), highways (MO-123, US-160, I-49), avoid AR, or prefer US-160.',
      )
      return
    }
    // Highway-avoid is not geometry-enforced — reject bare avoid-highway-only (no fake success)
    if (isAvoidHighwayOnlyPreference(parsed)) {
      setChangeRouteError(
        'Highway avoid is not enforced yet. Prefer alternate roads (e.g. prefer US-160) or avoid states (e.g. avoid AR).',
      )
      return
    }
    setChangeRouteError(null)

    const statesOnly = isStatesOnlyRoutePreference(parsed)
    const states = parsed.states || []
    const specialInstructions = statesOnly
      ? undefined
      : formatRoutePreferenceAsSpecialInstructions(parsed)

    setChangeRouteBusy(true)
    // Keep Change Route panel open so "Updating route…" is visible

    try {
      // Re-run — if OR-Tools mode, hit /api/optimize-route (same payload shape); else existing analyze-permit. Normalize for or-tools.
      if (optimizationMode === 'ortools') {
        const synced = syncDestinationFromDrops(formData)
        const changePayload: Record<string, unknown> = {
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
          weight: resolveSubmitWeightLbs(formData),
          length: formData.length,
          width: formData.width,
          height: formData.height,
          originLat: synced.originLat,
          originLon: synced.originLon,
          destinationLat: synced.destinationLat,
          destinationLon: synced.destinationLon,
          routingEngine,
          trailerLengthFt: Number(formData.trailerLengthFt) || undefined,
          axles: Number(formData.axles) || undefined,
          axleWeights: trimAxleWeightsForSubmit(
            formData.axleWeights,
            formData.axles,
            selectedRigSnapshot
          ),
          equipment: selectedRigSnapshot
            ? {
                tractor: selectedRigSnapshot.tractor,
                trailers: selectedRigSnapshot.trailers,
                axleGroups: selectedRigSnapshot.axleGroups ?? null,
              }
            : undefined,
          ...permitFormToLoadDetailsCarrierFields(formData),
        }
        if (statesOnly) {
          changePayload.manualRoute = states
        } else if (specialInstructions) {
          // Highway bias / mixed prefs — same path as main form specialInstructions (not corridor override)
          changePayload.specialInstructions = specialInstructions
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
        const analyzeBody: Record<string, unknown> = {
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
          weight: resolveSubmitWeightLbs(formData),
          length: formData.length,
          width: formData.width,
          height: formData.height,
          originLat: synced.originLat,
          originLon: synced.originLon,
          destinationLat: synced.destinationLat,
          destinationLon: synced.destinationLon,
          routingEngine,
          trailerLengthFt: Number(formData.trailerLengthFt) || undefined,
          axles: Number(formData.axles) || undefined,
          axleWeights: trimAxleWeightsForSubmit(
            formData.axleWeights,
            formData.axles,
            selectedRigSnapshot
          ),
          equipment: selectedRigSnapshot
            ? {
                tractor: selectedRigSnapshot.tractor,
                trailers: selectedRigSnapshot.trailers,
                axleGroups: selectedRigSnapshot.axleGroups ?? null,
              }
            : undefined,
          ...permitFormToLoadDetailsCarrierFields(formData),
        }
        if (statesOnly) {
          analyzeBody.manualRoute = states
        } else if (specialInstructions) {
          analyzeBody.specialInstructions = specialInstructions
        }
        const response = await fetch('/api/analyze-permit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(analyzeBody),
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
      setChangeRouteError(null)
      setShowChangeRouteInput(false) // close only on success
    } catch (error: any) {
      setResult({ error: error.message }) // make change-route errors (incl or-tools) surface in nice banner like submit; keep alert secondary for immediate feedback
      alert('Failed to analyze the new route: ' + error.message)
      setShowChangeRouteInput(true) // keep input open on error
    } finally {
      setChangeRouteBusy(false)
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

  // === Authentication Protection ===
  // While we are still checking the Supabase session, show a clean loading state.
  // This prevents any flash of the protected form and ensures unauthenticated
  // users are redirected before they can interact with the page.
  if (loadingAuth) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          {/* MoHeavy brand mark */}
          <div className="w-14 h-14 bg-black rounded-xl flex items-center justify-center mx-auto mb-4 shadow-sm">
            <span className="text-white text-3xl font-bold tracking-tighter">M</span>
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
      <AppHeader user={user} ownOrganizationId={ownOrganizationId} />

      <div
        className={`max-w-3xl mx-auto px-4 sm:px-8 w-full min-w-0 pb-6 sm:pb-8 ${
          !autoRouteEnabled ? 'pt-[9.5rem] sm:pt-24' : 'pt-6'
        }`}
      >
      <ActiveCarrierBanner ownOrganizationId={ownOrganizationId} />

      <div className="mb-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">New Route Analysis</h1>
          
        </div>

        {/* OR-Tools Service Connection Status — dev-only debug chrome (hidden in production) */}
        {isDevEnvironment() && (() => {
          const isOrToolsChecking = checkingOrToolsHealth || ortoolsHealth === null
          const isUnreachable = !isOrToolsChecking && ortoolsHealth?.status === 'unreachable'
          const isHealthProbeTimeout = ortoolsHealth?.message?.toLowerCase().includes('timed out') ?? false
          const unreachableTitle = isHealthProbeTimeout
            ? 'Quick 5s health probe timed out — service may still be running; full optimization can take several minutes. Route analysis may fall back to OSRM.'
            : 'Health probe could not reach OR-Tools — ensure the service is running on port 8000. Route analysis may fall back to OSRM.'
          const bannerTitle = isUnreachable
            ? unreachableTitle
            : ortoolsHealth?.message || undefined
          return (
            <div className="mt-3 space-y-1">
              <div
                className={`px-3 py-1.5 rounded-lg border flex flex-wrap items-center gap-x-2 gap-y-1.5 text-sm ${
                  isOrToolsChecking
                    ? 'bg-gray-50 border-gray-200 text-gray-700'
                    : ortoolsHealth?.connected
                      ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
                      : isUnreachable
                        ? 'bg-amber-50 border-amber-300 text-amber-900'
                        : 'bg-gray-50 border-gray-200 text-gray-700'
                }`}
                title={bannerTitle}
              >
                <div
                  className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                    isOrToolsChecking
                      ? 'bg-gray-400 animate-pulse'
                      : ortoolsHealth?.connected
                        ? 'bg-emerald-500'
                        : isUnreachable
                          ? 'bg-amber-500'
                          : 'bg-gray-400'
                  }`}
                />
                <span className="font-medium shrink-0">
                  {isOrToolsChecking
                    ? 'OR-Tools: Checking…'
                    : ortoolsHealth?.connected
                      ? 'OR-Tools: Connected'
                      : isUnreachable
                        ? 'OR-Tools: Unreachable'
                        : 'OR-Tools: Checking…'}
                </span>
                {!isOrToolsChecking && ortoolsHealth?.connected && (ortoolsHealth.version || ortoolsHealth.buildId) && (
                  <span className="text-xs text-emerald-800 font-mono truncate min-w-0 max-w-[8rem] sm:max-w-xs">
                    v{ortoolsHealth.version || '?'}
                    {ortoolsHealth.buildId ? (
                      <span className="hidden sm:inline">{` · build ${ortoolsHealth.buildId}`}</span>
                    ) : null}
                  </span>
                )}
                {ortoolsHealth?.message && !isOrToolsChecking && !isUnreachable && (
                  <span
                    className="text-xs text-gray-600 truncate min-w-0 max-w-[12rem] sm:max-w-xs"
                    title={ortoolsHealth.message}
                  >
                    — {ortoolsHealth.message}
                  </span>
                )}
                {ortoolsHealth?.message && isUnreachable && (
                  <span
                    className="text-xs text-amber-800 truncate min-w-0 flex-1"
                    title={ortoolsHealth.message}
                  >
                    — {ortoolsHealth.message}
                  </span>
                )}
                <div className="flex flex-wrap items-center gap-1.5 ml-auto">
                  <button
                    type="button"
                    onClick={() => checkOrToolsHealth({ manual: true })}
                    disabled={isOrToolsChecking || healthCheckCooldownRemaining > 0 || restartingOrTools}
                    className="text-xs px-3 py-1.5 min-h-[36px] sm:min-h-0 bg-white border border-gray-300 hover:bg-gray-50 rounded-md disabled:opacity-50 font-medium transition-colors touch-manipulation"
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
                    className="text-xs sm:text-sm px-3 py-1.5 min-h-[36px] sm:min-h-0 bg-indigo-600 hover:bg-indigo-700 text-white rounded-md disabled:opacity-50 font-semibold transition-colors touch-manipulation shadow-sm"
                    title="Kill hung OR-Tools on port 8000 and start a fresh uvicorn process"
                  >
                    {restartingOrTools ? 'Restarting…' : '🔄 Restart OR-Tools Service'}
                  </button>
                </div>
              </div>
              {isUnreachable && (
                <p className="text-xs text-amber-800 px-1" title={unreachableTitle}>
                  Port 8000 · may fall back to OSRM · use Restart
                </p>
              )}
            </div>
          )
        })()}

        {isDevEnvironment() && restartOrToolsMessage && (
          <div className="mt-1.5 px-3 py-1.5 rounded-md border border-indigo-200 bg-indigo-50 text-indigo-900 text-xs">
            {restartOrToolsMessage}
            {!/back online/i.test(restartOrToolsMessage) &&
              !restartOrToolsMessage.includes('restart:ortools') && (
              <span className="text-indigo-700">
                {' '}· fallback: <code className="font-mono bg-white/70 px-1 rounded">npm run restart:ortools</code>
              </span>
            )}
          </div>
        )}

        {/* Load Pilot Voice Agent Status */}
        {(voiceStatus || isListening) && (
          <div className={`mt-2 px-3 py-1.5 rounded-lg text-sm flex items-center gap-2 border ${isListening ? 'bg-blue-50 border-blue-200 text-blue-800' : 'bg-gray-50 border-gray-200 text-gray-700'}`}>
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
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
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
        {tractorsLoaded && !canRunRouteAnalysis({ tractorCount: tractors.length }) && (
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-900">
            {NO_TRACTOR_ANALYSIS_HINT}{' '}
            <a href="/equipment" className="font-semibold underline underline-offset-2">
              Add a tractor
            </a>
          </div>
        )}

        {/* Permit driver & carrier — picker in carrier mode and service mode (carrier from header) */}
        <section className="space-y-4">
          <div>
  <h2 className="text-lg font-semibold text-gray-900">
    {selectedDriverKey
      ? `1. Driver — ${formatDriverSummaryLine(pickPermitCarrierDriverFields(formData))}`
      : '1. Driver'}
  </h2>
            <p className="text-xs text-gray-500 mt-0.5">Driver optional for analysis.</p>
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
                    (() => {
                      const driverFields = pickPermitCarrierDriverFields(formData)
                      const cdlStatus = getDriverCdlStatus(driverFields)
                      const cdlLabel = driverCdlStatusLabel(cdlStatus, driverFields)
                      return (
                    <span className="text-gray-900">
                      {selectedDriverKey === defaultDriverKey && (
                        <span className="text-amber-500 mr-1" title="Default driver">
                          ★
                        </span>
                      )}
                      <span className="font-mono text-xs sm:text-sm tracking-tight">
                        {formatDriverDetailLine(driverFields)}
                      </span>
                      {cdlLabel && (
                        <span
                          className={`ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${
                            cdlStatus === 'expired'
                              ? 'bg-red-100 text-red-800'
                              : 'bg-amber-100 text-amber-800'
                          }`}
                          title={
                            cdlStatus === 'missing'
                              ? 'Add CDL number on the driver profile'
                              : cdlStatus === 'expired'
                                ? 'CDL is past its expiration date'
                                : 'CDL expires within 30 days'
                          }
                        >
                          {cdlLabel}
                        </span>
                      )}
                    </span>
                      )
                    })()
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
                  setShowRigPicker(false)
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
                      setFormData((p) => ({
                        ...p,
                        ...applyNumberOfPiecesChange(p.numberOfPieces, clamped, p.loadedArrangement),
                      }))
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

          {/* Dynamic axle weights — collapsed by default for mobile; group totals primary, per-axle advanced */}
          {(() => {
            const { n, summary: groupSummary } = resolvePermitAxleLayout(
              formData.axles,
              selectedRigSnapshot
            )
            const weights: number[] = formData.axleWeights || []
            const sum = weights.slice(0, n).reduce((a, b) => a + (Number(b) || 0), 0)
            const gross = Number(formData.grossLoadedWeight) || 0
            const groupLine = formatAxleGroupSummaryLine(groupSummary)

            // Spacings from selected rig → tandem vs spread labels per group.
            // Axle counts use the same defaults as assignAxleGroups (tractor 3 / trailer 2)
            // so missing num_axles does not shift spacings onto the wrong groups.
            const tractorUnit = selectedRigSnapshot?.tractor as
              | { num_axles?: number | null }
              | null
              | undefined
            const trailerUnits = Array.isArray(selectedRigSnapshot?.trailers)
              ? (selectedRigSnapshot.trailers as { num_axles?: number | null }[])
              : []
            const tractorAxleCount = tractorUnit
              ? resolveDeclaredAxleCount(tractorUnit.num_axles, 3)
              : 0
            const trailerAxleCounts = trailerUnits.map((tr) =>
              tr != null ? resolveDeclaredAxleCount(tr?.num_axles, 2) : 0
            )
            const comboSpacings = buildCombinationAdjacentSpacingsIn({
              totalAxles: n,
              tractorAxleCount: tractorAxleCount > 0 ? tractorAxleCount : null,
              tractorSpacingsIn: selectedRigSnapshot?.tractorSpacingsIn ?? null,
              trailerAxleCounts,
              trailerSpacingsIn: selectedRigSnapshot?.trailerSpacingsIn ?? null,
            })

            // Precompute config + limits for summary over-count and inputs
            const groupMetas = groupSummary.groups.map((g) => {
              const groupSum = sumGroupWeightLbs(g, weights)
              const withinSp = withinGroupSpacingsFromCombination(g, comboSpacings)
              const config = classifyGroupAxleConfig(g, withinSp)
              const limitLbs = displayGroupWeightLimitLbs(g, config)
              return {
                group: g,
                groupSum,
                config,
                limitLbs,
                overLimit: groupSum > limitLbs,
              }
            })
            const overCount = groupMetas.filter((m) => m.overLimit).length

            /**
             * Even-split group total only when the parsed total differs from the current
             * group sum (within 0.5 lb). Tab-through / blur with unchanged total preserves
             * intentional unequal per-axle weights. Always sync gross + weight when applied.
             */
            const applyGroupTotal = (groupIndex: number, raw: string) => {
              const val = parseFloat(raw)
              const groupTotal = Number.isFinite(val) ? Math.max(0, Math.round(val)) : 0
              setFormData((prev) => {
                const layout = resolvePermitAxleLayout(prev.axles, selectedRigSnapshot)
                const g = layout.groups[groupIndex]
                if (!g) return prev
                const currentSum = Math.round(sumGroupWeightLbs(g, prev.axleWeights))
                // No-op when total unchanged — keep unequal per-axle split.
                if (Math.abs(groupTotal - currentSum) < 0.5) return prev
                const arr = distributeWeightToGroup(
                  prev.axleWeights,
                  g,
                  groupTotal,
                  layout.n
                )
                const newSum = arr
                  .slice(0, layout.n)
                  .reduce((a, b) => a + (Number(b) || 0), 0)
                return {
                  ...prev,
                  axles: layout.n,
                  axleWeights: arr.slice(0, layout.n),
                  // Always write sum (including 0); dual-write weight for envelope parity.
                  grossLoadedWeight: newSum,
                  weight: newSum,
                }
              })
            }

            return (
              <details className="mb-3 border rounded-lg bg-amber-50 text-sm">
                <summary className="cursor-pointer font-medium text-amber-900 p-3 hover:text-amber-950 min-h-[44px]">
                  Axle Weight Distribution (lbs)
                  <span className="font-normal text-amber-800 text-xs sm:ml-2 block sm:inline">
                    {sum > 0 ? `${sum.toLocaleString()} lbs` : '—'}
                    {overCount > 0
                      ? ` · ${overCount} group${overCount === 1 ? '' : 's'} over limit`
                      : ''}
                    {gross > 0 && gross !== sum
                      ? ` · Gross ${gross.toLocaleString()}`
                      : ''}
                  </span>
                </summary>
                <div className="px-3 pb-3">
                  <div className="text-[10px] text-amber-700 mb-2">
                    {groupLine}
                    {gross > 0 ? ` · Gross ${gross.toLocaleString()} lbs` : ''}
                    {sum > 0 && sum !== gross ? ` · Axle sum ${sum.toLocaleString()}` : ''}
                    {' · '}Edit group totals (even-split on blur). Tap per-axle for fine control.
                  </div>

                  <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
                    <div className="text-[10px] text-amber-800">
                      Groups from selected rig (or synthetic layout when no rig)
                    </div>
                    <div className="flex gap-2 text-xs">
                      <button
                        type="button"
                        onClick={() => {
                          const layout = resolvePermitAxleLayout(formData.axles, selectedRigSnapshot)
                          // Prefer current gross/weight; if both 0 after a zero-out, fall back to 80k
                          // so Distribute still produces a usable load and submit weight is non-zero.
                          const g =
                            Number(formData.grossLoadedWeight) || Number(formData.weight) || 80000
                          // Steer fixed at 12k combined; remainder even-split across other axles.
                          const arr = distributeWeightSteerFirst(layout.n, g, layout.groups)
                          const distributedTotal = arr
                            .slice(0, layout.n)
                            .reduce((a, b) => a + (Number(b) || 0), 0)
                          // Dual-write gross + weight so submit/envelope stay aligned after zeroing.
                          setFormData((p) => ({
                            ...p,
                            axles: layout.n,
                            axleWeights: arr,
                            grossLoadedWeight: distributedTotal,
                            weight: distributedTotal,
                          }))
                        }}
                        className="px-2 py-1 border border-amber-300 rounded bg-white hover:bg-amber-100 min-h-[44px] text-amber-950"
                        title="Steer 12,000 lbs; remainder even across other axles"
                      >
                        Distribute (steer 12k)
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const layout = resolvePermitAxleLayout(formData.axles, selectedRigSnapshot)
                          const axleSum = (formData.axleWeights || [])
                            .slice(0, layout.n)
                            .reduce((a: number, b: any) => a + (Number(b) || 0), 0)
                          // Dual-write weight + gross for envelope parity.
                          setFormData((p) => ({
                            ...p,
                            grossLoadedWeight: axleSum,
                            weight: axleSum,
                          }))
                        }}
                        className="px-2 py-1 border border-amber-300 rounded bg-white hover:bg-amber-100 min-h-[44px] text-amber-950"
                      >
                        Axles → Gross
                      </button>
                    </div>
                  </div>

                  {/* Primary UX: editable group combined weights (dynamic from selected rig) */}
                  {groupMetas.length > 0 && (
                    <div className="mb-3">
                      <div
                        className="text-[10px] font-medium text-amber-900 mb-1"
                        id="axle-group-combined-weights-label"
                      >
                        Group combined weights
                      </div>
                      <div
                        className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3"
                        role="group"
                        aria-labelledby="axle-group-combined-weights-label"
                      >
                        {groupMetas.map((meta, gi) => {
                          const { group: g, groupSum, config, limitLbs, overLimit } = meta
                          const inputId = `axle-group-weight-${g.type}-${gi}`
                          const configId = `axle-group-config-${g.type}-${gi}`
                          return (
                            <div
                              key={`${g.type}-${gi}`}
                              className={
                                overLimit
                                  ? 'border border-amber-500 rounded-lg bg-amber-100/80 p-2'
                                  : 'border border-amber-200 rounded-lg bg-white/70 p-2'
                              }
                              title={
                                overLimit
                                  ? `${g.label} over simple legal limit by ${(groupSum - limitLbs).toLocaleString()} lbs · ${config.detail}`
                                  : `${config.detail} · simple legal limit ${limitLbs.toLocaleString()} lbs`
                              }
                            >
                              <label htmlFor={inputId} className="block text-xs font-medium text-amber-950">
                                {g.label}
                                <span className="font-normal text-amber-800">
                                  {' '}
                                  · {config.label}
                                  {g.axleCount > 1
                                    ? ` · ${g.axleCount} axles`
                                    : ' · 1 axle'}
                                </span>
                              </label>
                              <div
                                id={configId}
                                className="text-[10px] text-amber-700 mt-0.5 mb-1"
                              >
                                {config.detail}
                                {config.kind === 'spread' ? ' · limit 20k×axles' : ''}
                              </div>
                              <div className="flex items-center gap-1.5">
                                <input
                                  id={inputId}
                                  type="number"
                                  min={0}
                                  // Apply even-split on blur (not each keystroke) for easier mobile edit.
                                  defaultValue={groupSum || 0}
                                  key={`${g.type}-${gi}-${groupSum}`}
                                  onBlur={(e) => applyGroupTotal(gi, e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      e.preventDefault()
                                      ;(e.target as HTMLInputElement).blur()
                                    }
                                  }}
                                  className={`${inputCompactClass} min-h-[44px]`}
                                  aria-describedby={configId}
                                />
                                <span className="text-[10px] text-amber-800 shrink-0 whitespace-nowrap">
                                  / {limitLbs.toLocaleString()}
                                  {overLimit && (
                                    <span className="ml-1 font-medium text-amber-900">over</span>
                                  )}
                                </span>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                      <p className="text-[10px] text-amber-700 mt-1">
                        Editing a group total even-splits across that group&apos;s axles on blur.
                        Spread groups show 20k×axles; other limits are simple legal defaults (v1).
                        Distribute is steer-first (12k), not capacity-optimized.
                      </p>
                    </div>
                  )}

                  {/* Advanced: per-axle edit (kept for fine control) */}
                  <details className="mb-2 border border-amber-200 rounded-lg bg-white/50">
                    <summary className="cursor-pointer text-xs font-medium text-amber-900 p-2 hover:text-amber-950 min-h-[44px]">
                      Per-axle weights (advanced)
                    </summary>
                    <div className="px-2 pb-2">
                      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
                        {Array.from({ length: n }).map((_, i) => {
                          const gType = groupSummary.axleTypes[i]
                          const groupLabel = gType ? AXLE_GROUP_LABELS[gType] : null
                          const inputId = `axle-weight-${i}`
                          return (
                            <div key={i}>
                              <label htmlFor={inputId} className={fieldLabelTinyClass}>
                                Axle {i + 1}
                                {groupLabel ? ` · ${groupLabel}` : ''}
                              </label>
                              <input
                                id={inputId}
                                type="number"
                                value={weights[i] || 0}
                                onChange={(e) => {
                                  const val = parseFloat(e.target.value) || 0
                                  setFormData((prev) => {
                                    const arr = [...(prev.axleWeights || [])]
                                    // Ensure array covers all shown axles when user edits.
                                    while (arr.length < n) arr.push(0)
                                    arr[i] = val
                                    const newSum = arr
                                      .slice(0, n)
                                      .reduce((a, b) => a + (Number(b) || 0), 0)
                                    return {
                                      ...prev,
                                      axles: n,
                                      axleWeights: arr.slice(0, n),
                                      // Always write sum (including 0); dual-write weight for envelope.
                                      grossLoadedWeight: newSum,
                                      weight: newSum,
                                    }
                                  })
                                }}
                                className={`${inputCompactClass} min-h-[44px]`}
                              />
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  </details>

                  <div className="flex flex-wrap items-center gap-3 text-sm">
                    <div>
                      <label htmlFor="gross-loaded-weight" className="font-medium text-amber-950">
                        Gross Loaded Weight
                      </label>
                      <input
                        id="gross-loaded-weight"
                        type="number"
                        value={gross}
                        onChange={(e) => {
                          const v = parseFloat(e.target.value) || 0
                          setFormData((p) => ({
                            ...p,
                            grossLoadedWeight: v,
                            weight: v,
                          }))
                        }}
                        className={`${fieldControlClass} ml-2 w-28 p-1 rounded min-h-[44px]`}
                      />{' '}
                      <span className="text-amber-900">lbs</span>
                    </div>
                    <div className="text-xs text-amber-800">
                      Sum of shown axles:{' '}
                      <span className="font-mono text-amber-950">{sum.toLocaleString()}</span>
                    </div>
                    {gross !== sum && gross > 0 && (
                      <div className="text-amber-700 text-xs">
                        ⚠ Gross differs from axle sum (normal for 5th-wheel/kingpin load transfer)
                      </div>
                    )}
                  </div>
                </div>
              </details>
            )
          })()}
          <p className={`${fieldHintTinyClass} mt-1`}>Auto-calc / distribute for bridge-law; values captured on save.</p>
        </div>

        {/* Routing envelope — auto-calculated from rig + load; sent to routing/agent */}
        <div className="border border-emerald-200 bg-emerald-50/50 rounded-xl p-4">
          <h2 className="font-semibold mb-1 text-emerald-900">Routing envelope</h2>
          <p className="text-xs text-emerald-800 mb-2">Auto-calculated from rig + load for oversize routing.</p>
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
              <p className={`${fieldHintTinyClass} mt-0.5`}>Trailer width, or max with load width when set</p>
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
          <textarea
            placeholder="E.g. avoid AR, avoid IL, include Corinth MS, prefer I-40 southern, stay on interstates..."
            value={manualRoute}
            onChange={(e) => setManualRoute(e.target.value)}
            className={textareaClass}
            title="Prefer/include vias still apply with drops (placed before the first drop); multi-drop skips automatic corridor via suggestions."
          />
        </div>

        {/* Pickup */}
        <div id="origin-address-section">
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
        </div>

        {/* Drops */}
        <div id="drops-section" className="space-y-4">
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
          {formData.drops.map((drop, idx) => {
            const key = dropStopKey(drop)
            return (
            <div key={drop.id} data-drop-id={drop.id} className="border border-gray-300 sm:border-gray-200 rounded-xl p-3 min-w-0">
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

        {/* Map v1: single Route card (replaces tall progress hero + long corridor preview chrome). */}
        <div
          ref={routeMapSectionRef}
          id="route-map-section"
          tabIndex={-1}
          className="scroll-mt-28 sm:scroll-mt-32 outline-none"
        >
          <RouteMapCard model={routeMapModel} className={ROUTE_MAP_CARD_EMBED_CLASS} />
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
                const reduceMotion =
                  typeof window !== 'undefined' &&
                  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
                window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' })
                // Optional: focus first input after scroll
                setTimeout(() => {
                  const firstInput = document.querySelector('input[placeholder="City"]') as HTMLInputElement
                  firstInput?.focus()
                }, reduceMotion ? 0 : 600)
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
                    {/* Success card when dimensions are legal and no permit is required */}
                    {!routeRequiresPermit(primary) && (
                      <div className="p-4 rounded-xl border-2 border-emerald-300 bg-emerald-50 text-emerald-900 shadow-sm">
                        <div className="flex items-start gap-3">
                          <span className="text-2xl leading-none">✅</span>
                          <div>
                            <div className="font-semibold text-lg">Legal dimensions — no permit required</div>
                            <p className="text-sm mt-1 text-emerald-800">
                              This route stays within standard legal limits for the selected rig and load. Portal Assist is not needed.
                            </p>
                          </div>
                        </div>
                      </div>
                    )}
                    <div className="flex flex-col sm:flex-row justify-center gap-4">
                      <button
                        onClick={handleRejectAndRestart}
                        disabled={loading || changeRouteBusy}
                        className="px-8 py-3 rounded-lg text-lg font-semibold border border-gray-300 text-gray-700 hover:bg-gray-100 disabled:opacity-50"
                      >
                        Reject &amp; Start Over
                      </button>
                      <button
                        onClick={handleApproveAndSave}
                        disabled={
                          loading ||
                          changeRouteBusy ||
                          !routeRequiresPermit(primary) ||
                          (routeRequiresPermit(primary) && !emailVerified)
                        }
                        className={`font-semibold px-8 py-3 rounded-lg text-lg disabled:bg-gray-400 disabled:text-gray-200 disabled:cursor-not-allowed ${
                          routeRequiresPermit(primary)
                            ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                            : 'bg-gray-300 text-gray-500'
                        }`}
                        title={
                          !routeRequiresPermit(primary)
                            ? 'No permit needed — Portal Assist is disabled for legal routes'
                            : !emailVerified
                              ? EMAIL_VERIFY_APPROVE_TITLE
                              : undefined
                        }
                      >
                        {/* Only Approve save uses "Saving…"; change-route uses changeRouteBusy + "Updating route…" */}
                        {loading && !changeRouteBusy ? 'Saving…' : 'Approve & Continue to Portal Assist'}
                      </button>
                      <button
                        onClick={() => {
                          if (showChangeRouteInput) {
                            setShowChangeRouteInput(false)
                            setChangeRouteError(null)
                          } else {
                            setShowChangeRouteInput(true)
                          }
                        }}
                        disabled={loading || changeRouteBusy}
                        className="px-8 py-3 rounded-lg text-lg font-semibold border border-blue-300 text-blue-700 hover:bg-blue-50 disabled:opacity-50"
                      >
                        {showChangeRouteInput ? 'Cancel' : 'Change Route'}
                      </button>
                    </div>
                    {emailVerifyGateError && (
                      <p className="text-center text-sm font-medium text-amber-900" role="status">
                        {emailVerifyGateError}
                      </p>
                    )}

                    {changeRouteBusy && (
                      <p className="text-center text-sm font-medium text-blue-700" role="status" aria-live="polite">
                        Updating route…
                      </p>
                    )}

                    {showChangeRouteInput && (
                      <div className="max-w-md mx-auto">
                        <p className="text-sm text-gray-600 mb-2">
                          Bare state codes (e.g. <code>MO, NE</code>) set a hard corridor.
                          Highways or mixed lists (e.g. <code>MO-123, US160w</code>,{' '}
                          <code>MO, US-160</code>) use prefer/include bias — not a hard state list.
                          Verbs: <code>prefer US-160</code>, <code>avoid AR</code>.
                        </p>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={manualRoute}
                            onChange={(e) => {
                              setManualRoute(e.target.value)
                              if (changeRouteError) setChangeRouteError(null)
                            }}
                            placeholder="MO, NE  or  MO-123, US160w"
                            className={`${fieldControlClass} flex-1 rounded px-3 py-2 text-sm`}
                            onKeyDown={(e) => { if (e.key === 'Enter') handleChangeRoute() }}
                            disabled={changeRouteBusy}
                          />
                          <button
                            onClick={handleChangeRoute}
                            disabled={changeRouteBusy || !manualRoute.trim()}
                            className="bg-blue-600 text-white px-4 py-2 rounded text-sm disabled:bg-gray-400 min-w-[9.5rem]"
                          >
                            {changeRouteBusy ? 'Updating route…' : 'Submit New Route'}
                          </button>
                        </div>
                        {changeRouteError && (
                          <p className="mt-2 text-sm text-red-600" role="alert">
                            {changeRouteError}
                          </p>
                        )}
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
                          const escortDetail = primary.escortDetails?.find(
                            (d: { stateCode?: string }) => d.stateCode === state
                          )
                          const escortHard = escortDetail
                            ? escortDetail.requirementLevel === 'required'
                            : primary.escortRequiredStates?.includes(state)
                          const escortPossible = escortDetail
                            ? escortDetail.requirementLevel === 'may_require'
                            : primary.escortPossibleStates?.includes(state)
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
                                {(escortHard || escortPossible) && (
                                  <div className={`text-[9px] font-semibold ${escortHard ? 'text-red-700' : 'text-orange-600'}`}>
                                    {escortHard ? 'ESCORT REQ' : 'POSSIBLE'}
                                  </div>
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
                        <div className="w-3 h-3 bg-red-700 rounded-full" /> <span className="text-gray-600">Escort required</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <div className="w-3 h-3 bg-orange-500 rounded-full" /> <span className="text-gray-600">Escort possible</span>
                      </div>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1 text-[10px]">{primary.routeCorridor.map((state:string,idx:number)=>{const requires=stateRequiresPermit(primary,state);return <span key={idx} className={`px-1.5 py-0.5 rounded font-mono ${requires?'bg-red-500 text-white':'bg-gray-200 text-gray-700'}`}>{state}{requires?' permit':''}</span>})}</div>
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

                {/* When no permit is required, hide Scale / Restrictions / notes — not needed for legal loads */}
                {routeRequiresPermit(primary) && (
                <>
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
                        const escortDetail = primary.escortDetails?.find(
                          (d: { stateCode?: string }) => d.stateCode === state
                        )
                        const escortHard = escortDetail
                          ? escortDetail.requirementLevel === 'required'
                          : primary.escortRequiredStates?.includes(state)
                        return (
                          <div key={idx} className="border border-red-200 bg-red-50 rounded-lg p-4">
                            <div className="flex items-center justify-between mb-2">
                              <span className="font-bold text-lg text-red-800">{state}</span>
                              <div className="flex gap-1.5">
                                <span className="text-xs px-2 py-0.5 bg-red-200 text-red-700 rounded">PERMIT REQUIRED</span>
                                {escortHard && (
                                  <span className="text-xs px-2 py-0.5 bg-orange-200 text-orange-700 rounded font-medium">ESCORT REQ</span>
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

                {/* Scale / axle-group / corridor weight findings (from permit agent) */}
                {(primary.unableToScale || primary.scaleFindings?.length > 0 || primary.axleGroupSummary || primary.corridorScaleFailedStates?.length > 0) && (
                  <div className="p-4 border rounded-lg bg-white">
                    <h3 className="font-semibold mb-3 text-gray-700">Scale &amp; Axle Groups</h3>
                    {primary.axleGroupSummary && (
                      <div className="text-sm text-gray-700 mb-2">
                        <span className="font-medium">Groups:</span> {primary.axleGroupSummary}
                      </div>
                    )}
                    {primary.unableToScale && (
                      <div className="mb-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800 font-medium">
                        Hard scale limit exceeded — beyond typical OSOW permit group ceilings. Add axles or reduce weight.
                      </div>
                    )}
                    {!primary.unableToScale && primary.scaleFindings?.some((f: { severity?: string }) => f.severity === 'warning') && (
                      <div className="mb-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-900 font-medium">
                        Exceeds non-permit legal limits — overweight permit path (typically allowable on this axle setup; confirm spacing / bridge formula per state).
                      </div>
                    )}
                    {primary.corridorScaleFailedStates?.length > 0 && (
                      <div className="mb-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-900">
                        Corridor hard scale limit exceeded in: <b>{primary.corridorScaleFailedStates.join(', ')}</b>
                      </div>
                    )}
                    {primary.scaleFindings?.length > 0 && (
                      <ul className="text-sm text-gray-800 space-y-1 list-disc list-inside">
                        {primary.scaleFindings.map((f: { severity?: string; message?: string }, i: number) => (
                          <li key={i} className={f.severity === 'failure' ? 'text-red-700' : 'text-amber-800'}>
                            {f.message}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}

                {/* Route Restrictions & Requirements (from strengthened state rules DB) */}
                {(primary.escortRequiredStates?.length > 0 || primary.escortPossibleStates?.length > 0 || primary.escortWarnings?.length > 0 || primary.curfewNotes?.length > 0 || primary.specialNotes?.length > 0) && (
                  <div className="p-4 border rounded-lg bg-white">
                    <h3 className="font-semibold mb-3 text-gray-700">Route Restrictions &amp; Requirements</h3>

                    {/* Escort Summary — structured required vs may-require */}
                    {(primary.escortDetails?.length > 0 ||
                      primary.escortRequiredStates?.length > 0 ||
                      primary.escortPossibleStates?.length > 0 ||
                      primary.escortWarnings?.length > 0) && (
                      <EscortRequirementsCard
                        details={primary.escortDetails}
                        fallbackWarnings={primary.escortWarnings}
                        fallbackStates={[
                          ...(primary.escortRequiredStates || []),
                          ...(primary.escortPossibleStates || []),
                        ]}
                      />
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

                
                </>
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

                      {/* MoHeavy Platform Fee */}
                      <div className="flex justify-between items-baseline mb-3">
                        <span className="text-sm text-gray-600">
                          MoHeavy Platform Fee <span className="text-xs text-gray-600 sm:text-gray-500">({selectedTier})</span>
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
                    ✓ State-specific permit pricing + MoHeavy platform fee
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
                              {(option.escortRequiredStates?.length > 0 || option.escortPossibleStates?.length > 0) &&
                                ` • ${(option.escortRequiredStates?.length || 0) + (option.escortPossibleStates?.length || 0)} escort(s)`}
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
      {isDevEnvironment() && (
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
      )}
      </div>{/* max-w-3xl content shell */}

      {/* Fixed under AppHeader (sticky top-0 z-50, ~56/64px). fixed avoids overflow-x-clip sticky bugs. */}
      {!autoRouteEnabled && (
        <div className="fixed left-0 right-0 z-40 top-14 sm:top-16 border-b-2 border-amber-400 bg-amber-50 shadow-[0_8px_24px_rgba(0,0,0,0.12)]">
          <div className="max-w-3xl mx-auto px-4 py-3 sm:px-8 sm:py-3.5 flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="min-w-0 flex-1">
              <div className="font-semibold text-amber-950 text-sm sm:text-base">Review mode</div>
              <p className="text-xs sm:text-sm text-amber-900 mt-0.5">
                Change any field freely — analysis will not run until you tap Run analysis.
              </p>
            </div>
            <button
              type="button"
              onClick={handleRunAnalysis}
              disabled={loading}
              className="shrink-0 min-h-[44px] px-5 py-2.5 rounded-xl bg-black text-white text-sm font-semibold hover:bg-gray-900 disabled:opacity-50 touch-manipulation"
            >
              {loading ? 'Running…' : 'Run analysis'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}