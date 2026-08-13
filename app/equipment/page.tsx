'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import AppHeader from '@/components/AppHeader'
import ActiveCarrierBanner from '@/components/ActiveCarrierBanner'
import { useOrganizationContext } from '@/lib/organization-context'
import {
  equipmentOrganizationIdForSave,
  equipmentProfilesLoadOrFilter,
  shouldUseOrganizationEquipmentFilter,
} from '@/lib/equipment-persistence'
import {
  fetchCarrierPrimaryOwnerUserId,
  resolveEquipmentScope,
} from '@/lib/service-mode-scope'
import VehicleDiagram from '@/components/VehicleDiagram'
import TractorGraphic from '@/components/TractorGraphic'
import type { Tractor, Trailer, RigConfiguration } from '@/types/equipment'
import {
  computeRigDimensions,
  computeRigEmptyWeightLbs,
  primaryTrailerDimensions,
  sortRigsForDisplay,
} from '@/types/equipment'
import { formatDimensionDisplay } from '@/lib/parse-dimension'
import { formatLicensePlateDisplay } from '@/lib/license-plate'
import { normalizeLicensePlateState } from '@/lib/us-states'
import DimensionInput from '@/components/DimensionInput'
import LicensePlateFields from '@/components/LicensePlateFields'
import {
  DEFAULT_TRAILER_TYPES,
  TRAILER_TYPE_COUPLING_HINT,
  TRAILER_TYPE_MAIN_HINT,
  formatTrailerTypeLabel,
  getTrailerTypeOptions,
  isKingpinBoosterTrailerType,
  isRearPinTrailerType,
  mergeTrailerTypeOptions,
  saveCustomTrailerType,
} from '@/lib/trailer-types'
import {
  AXLE_GROUP_LABELS,
  assignAxleGroups,
  formatAxleGroupSummaryLine,
  normalizeAxleSpacingSlots,
  type AxleGroupType,
} from '@/lib/axle-groups'

type Tab = 'tractors' | 'trailers' | 'rigs'

/** Mobile-first contrast: stronger borders/text on small screens; softer from sm: up (matches permit-test / portal-assist). */
const fieldControlClass =
  'border border-gray-500 sm:border-gray-300 text-gray-900 placeholder:text-gray-500 bg-white'
const inputClass = `${fieldControlClass} rounded p-1.5 w-full text-sm`
const inputMtClass = `${inputClass} mt-0.5`
const selectClass = `${fieldControlClass} rounded-xl p-3 text-sm w-full`
const textareaClass = `${fieldControlClass} rounded-xl p-2 text-sm`
const buttonSecondaryClass =
  'inline-flex items-center justify-center min-h-[44px] px-4 py-2 border border-gray-500 sm:border-gray-300 bg-white text-gray-900 rounded-lg text-sm font-medium hover:bg-gray-50 disabled:opacity-50 touch-manipulation'
const buttonPrimaryClass =
  'inline-flex items-center justify-center min-h-[44px] px-4 py-2 bg-black text-white rounded-lg text-sm font-medium hover:bg-gray-900 touch-manipulation'
const buttonSuccessClass =
  'inline-flex items-center justify-center min-h-[44px] px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-medium disabled:bg-gray-500 disabled:text-white touch-manipulation'
const fieldLabelTinyClass = 'text-[11px] text-gray-600 sm:text-gray-500'
const fieldLabelSectionClass = 'block text-xs font-semibold text-gray-600 sm:text-gray-500 mb-1'
const fieldLabelMediumClass = 'text-xs font-medium text-gray-600 sm:text-gray-500'
/** Hints softer than labels so instructional chrome does not dominate */
const fieldHintTinyClass = 'text-[10px] text-gray-500'
/** Body/meta data slightly stronger than pure field hints */
const mutedTextClass = 'text-gray-600 sm:text-gray-500'
const bodyTextClass = 'text-gray-700 sm:text-gray-600'
const dividerBorderClass = 'border-gray-300 sm:border-gray-200'
const checkboxClass = 'h-4 w-4 rounded accent-emerald-700 border-gray-500 sm:border-gray-300'
const editorShellClass =
  'mb-6 bg-white border border-emerald-300 sm:border-emerald-200 rounded-2xl p-4 sm:p-5'
const cardClass = 'bg-white border border-gray-300 sm:border-gray-200 rounded-2xl p-4 sm:p-5'
const cardItemClass = 'bg-white border border-gray-300 sm:border-gray-200 rounded-xl p-4 text-sm'
const cardPanelClass = 'bg-white border border-gray-300 sm:border-gray-200 rounded-2xl p-4 sm:p-5'
/** Soft metric chips — visual hierarchy only, not a compliance engine */
const metricChipClass =
  'inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-50 text-emerald-900 border border-emerald-200'
const metricChipMutedClass =
  'inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-gray-100 text-gray-700 border border-gray-300 sm:border-gray-200'

export default function EquipmentPage() {
  const [user, setUser] = useState<any>(null)
  const [ownOrganizationId, setOwnOrganizationId] = useState<string | null>(null)
  const [loadingAuth, setLoadingAuth] = useState(true)
  const [carrierPrimaryOwnerUserId, setCarrierPrimaryOwnerUserId] = useState<string | null>(null)
  const [carrierPrimaryOwnerError, setCarrierPrimaryOwnerError] = useState<string | null>(null)
  const [loadingPrimaryOwner, setLoadingPrimaryOwner] = useState(false)
  const router = useRouter()
  const { workspaceMode, effectiveOrganizationId } = useOrganizationContext(ownOrganizationId)
  const isServiceModeReadOnly = workspaceMode === 'service'

  const [activeTab, setActiveTab] = useState<Tab>('rigs')
  const [rigBuilderOpen, setRigBuilderOpen] = useState(false)
  const [hasChosenTab, setHasChosenTab] = useState(false)

  // Data
  const [tractors, setTractors] = useState<Tractor[]>([])
  const [trailers, setTrailers] = useState<Trailer[]>([])
  /** Smart trailer-type dropdown options (defaults + localStorage customs). Hydrate on client to avoid SSR mismatch. */
  const [trailerTypeOptions, setTrailerTypeOptions] = useState<string[]>(() =>
    // Defaults only on first paint (SSR-safe); customs load in useEffect.
    mergeTrailerTypeOptions(DEFAULT_TRAILER_TYPES, [])
  )
  useEffect(() => {
    setTrailerTypeOptions(getTrailerTypeOptions())
  }, [])
  const [rigs, setRigs] = useState<RigConfiguration[]>([])

  const [loading, setLoading] = useState(false)

  // Current editor states
  const [editingTractor, setEditingTractor] = useState<Partial<Tractor> | null>(null)
  const [editingTrailer, setEditingTrailer] = useState<Partial<Trailer> | null>(null)

  // Rig Builder state
  const [selectedTractorId, setSelectedTractorId] = useState<string>('')
  const [selectedTrailerIds, setSelectedTrailerIds] = useState<string[]>([])
  const [rigName, setRigName] = useState('')
  const [builderNote, setBuilderNote] = useState('')
  const [loadedRigId, setLoadedRigId] = useState<string | null>(null)
  const [settingDefaultRigId, setSettingDefaultRigId] = useState<string | null>(null)

  // First visit / empty fleet: land on the next missing step (tractor → trailer → rigs).
  useEffect(() => {
    if (loading || loadingAuth || hasChosenTab) return
    if (tractors.length === 0) {
      setActiveTab('tractors')
      return
    }
    if (trailers.length === 0) {
      setActiveTab('trailers')
      return
    }
    setActiveTab('rigs')
    if (rigs.length === 0) setRigBuilderOpen(true)
  }, [loading, loadingAuth, hasChosenTab, tractors.length, trailers.length, rigs.length])

  // Derived for builder
  const currentTractor = tractors.find((t) => t.id === selectedTractorId) || null
  const currentTrailers = selectedTrailerIds
    .map((id) => trailers.find((tr) => tr.id === id))
    .filter(Boolean) as Trailer[]

  const dims = computeRigDimensions(currentTractor, currentTrailers)

  // Auth guard (consistent with dashboard + permit-test)
  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) {
        router.push('/login')
      } else {
        setUser(session.user)
        const { data: profile } = await supabase
          .from('member_profiles')
          .select('organization_id')
          .eq('user_id', session.user.id)
          .maybeSingle()
        if (profile?.organization_id) {
          setOwnOrganizationId(profile.organization_id)
        }
      }
      setLoadingAuth(false)
    })
    const { data: listener } = supabase.auth.onAuthStateChange((_, session) => {
      if (!session) router.push('/login')
      else setUser(session.user)
    })
    return () => listener.subscription.unsubscribe()
  }, [router])

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
      })
      .finally(() => setLoadingPrimaryOwner(false))
  }, [user, workspaceMode, effectiveOrganizationId])

  // Load all equipment on auth and when service-mode carrier scope changes
  useEffect(() => {
    if (!loadingAuth && user) {
      loadAll()
    }
  }, [loadingAuth, user, workspaceMode, effectiveOrganizationId, carrierPrimaryOwnerUserId])

  async function loadAll() {
    setLoading(true)
    const supabase = createClient()
    try {
      if (workspaceMode === 'service' && !effectiveOrganizationId) {
        setTractors([])
        setTrailers([])
        setRigs([])
        return
      }

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
        setRigs([])
        return
      }

      let query = supabase.from('equipment_profiles').select('*').order('created_at', { ascending: false })

      if (shouldUseOrganizationEquipmentFilter(scope) && scope.organizationId && scope.rigOwnerUserId) {
        query = query.or(
          equipmentProfilesLoadOrFilter(scope.organizationId, scope.rigOwnerUserId)
        )
      } else if (scope.rigOwnerUserId) {
        query = query.eq('user_id', scope.rigOwnerUserId)
      } else {
        setTractors([])
        setTrailers([])
        setRigs([])
        return
      }

      const { data, error } = await query

      if (error) {
        console.warn('equipment_profiles load', error)
        setTractors([])
        setTrailers([])
        setRigs([])
        return
      }

      const rows = (data || []) as any[]

      // Decode structured payload carried in notes (RIGBUILDER marker) so we persist rich
      // Tractor/Trailer/Rig fields using the *existing* equipment_profiles table (no new tables).
      // Legacy rows (from permit-test "save profile") have plain notes and are ignored here.
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

      // Tractors (only our new structured rows)
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
          // trailer_type = equipment class; legacy column trailer_make stored type, not manufacturer
          trailer_type: d.meta.trailer_type ?? d.row.trailer_make ?? null,
          license_plate: d.meta.license_plate ?? d.row.license_plate ?? null,
          license_plate_state: normalizeLicensePlateState(d.meta.license_plate_state ?? d.row.license_plate_state) ?? null,
          vin: d.meta.vin ?? d.row.vin ?? null,
          empty_weight_lbs: d.meta.empty_weight_lbs ?? null,
          width_ft: d.meta.width_ft ?? null,
          deck_height_ft: d.meta.deck_height_ft ?? null,
          // Manufacturer identity: same year/make/model columns as write path (never trailer_*)
          make: d.meta.make ?? d.row.make ?? null,
          model: d.meta.model ?? d.row.model ?? null,
          year: d.meta.year ?? d.row.year ?? null,
          notes: d.plainNotes || null,
          created_at: d.row.created_at,
          updated_at: d.row.updated_at,
        })) as Trailer[]
      )

      // Legacy rigs from equipment_profiles (type=rig in RIGBUILDER JSON) for backward compat
      const rigsDecoded = decoded.filter((d) => d.meta.type === 'rig')
      const legacyRigs = rigsDecoded.map((d) => ({
        id: d.row.id,
        user_id: d.row.user_id,
        rig_name: d.meta.rig_name || d.row.profile_name || '',
        tractor_id: d.meta.tractor_id || '',
        trailer_ids: Array.isArray(d.meta.trailer_ids) ? d.meta.trailer_ids : [],
        computed_total_length_ft: d.meta.computed_total_length_ft ?? null,
        computed_total_axles: d.meta.computed_total_axles ?? null,
        computed_kingpin_to_last_axle_ft: d.meta.computed_kingpin_to_last_axle_ft ?? null,
        // _notes is how the RIGBUILDER structured payload (and tractor/trailer saves) stores the plain note text
        notes: d.meta.notes ?? d.meta._notes ?? d.plainNotes ?? null,
        is_default: d.meta.is_default ?? false,
        source: 'legacy' as const,
        created_at: d.row.created_at,
        updated_at: d.row.updated_at,
      })) as RigConfiguration[]

      // Load proper rig compositions from the dedicated rig_configurations table
      // (new saves from Rig Builder; avoids the type CHECK constraint entirely).
      // tractor_id / trailer_ids currently reference equipment_profiles rows (active source of truth).
      // Will become FKs into dedicated tables after the profile migration.
      let properRigs: RigConfiguration[] = []
      try {
        if (scope.canLoadRigs && scope.rigOwnerUserId) {
          const { data: rigRows, error: rigErr } = await supabase
            .from('rig_configurations')
            .select('*')
            .eq('user_id', scope.rigOwnerUserId)
            .order('created_at', { ascending: false })
          if (rigErr) {
            if (!isMissingRelation(rigErr)) console.warn('[equipment] rig_configurations load error', rigErr)
          } else if (rigRows) {
            properRigs = (rigRows as any[]).map((r) => ({
              id: r.id,
              user_id: r.user_id,
              rig_name: r.rig_name || '',
              tractor_id: r.tractor_id || '',
              trailer_ids: Array.isArray(r.trailer_ids) ? r.trailer_ids : [],
              computed_total_length_ft: r.computed_total_length_ft ?? null,
              computed_total_axles: r.computed_total_axles ?? null,
              computed_kingpin_to_last_axle_ft: r.computed_kingpin_to_last_axle_ft ?? null,
              notes: r.notes || null,
              is_default: r.is_default ?? false,
              source: 'rig_configurations' as const,
              created_at: r.created_at,
              updated_at: r.updated_at,
            })) as RigConfiguration[]
          }
        }
      } catch (e) {
        if (!isMissingRelation(e)) console.warn('[equipment] rig_configurations load skipped (unexpected error)', e)
      }

      // Merge legacy + proper rigs, deduping by id (prefer first occurrence)
      const rigMap = new Map<string, RigConfiguration>()
      ;[...legacyRigs, ...properRigs].forEach((r) => {
        if (!rigMap.has(r.id)) rigMap.set(r.id, r)
      })
      const merged = Array.from(rigMap.values())
      // Deterministic newest-first ordering across both sources (review feedback)
      merged.sort((a, b) => {
        const ta = a.created_at ? Date.parse(a.created_at) : 0
        const tb = b.created_at ? Date.parse(b.created_at) : 0
        return tb - ta
      })
      setRigs(merged)
    } finally {
      setLoading(false)
    }
  }

  // Robust save helpers (single source for axle TEXT[] + profile_name safety).
  // Handles every edge case from the axle input (string with spaces/commas/empties/"", arrays, nulls, garbage)
  // and guarantees profile_name is always a trimmed non-empty string for the NOT NULL column.
  // Type remains hardcoded per save function (provably driven by activeTab + startNew* + JSX conditional render of editors/buttons).
  // No UI, onChange, or editing-state changes.
  /**
   * Parse axle spacings preserving labeled gap indices (1-2, 2-3, …).
   * Cleared / invalid middle slots stay 0 — never compact (that shifts later labels).
   * When expectedLength is set, pad/truncate to that slot count.
   */
  function normalizeAxleSpacings(input: any, expectedLength?: number | null): number[] {
    return normalizeAxleSpacingSlots(input, expectedLength)
  }

  /**
   * Single source of truth for all profile/rig name sanitization (tractor, trailer, rig_name).
   * Used by saveTractor, saveTrailer, and saveCurrentRig. Always returns a trimmed string.
   */
  function safeProfileName(input: any): string {
    return ((input ?? '') + '').trim()
  }

  /** Trimmed string or null — cleared identity fields must not stick as "". */
  function emptyToNull(input: any): string | null {
    if (input == null) return null
    const s = String(input).trim()
    return s ? s : null
  }

  /** Integer model year in [1900, 2100], else null (no decimals / absurd years). */
  function parseEquipmentYear(input: any): number | null {
    if (input == null || input === '') return null
    const n = typeof input === 'number' ? input : parseInt(String(input).trim(), 10)
    if (!Number.isFinite(n)) return null
    const y = Math.trunc(n)
    if (y < 1900 || y > 2100) return null
    return y
  }

  function axleSpacingForDb(input: any): string[] | null {
    // Preserve middle zeros as "0"; strip only trailing empties for compact storage.
    const nums = normalizeAxleSpacings(input)
    if (nums.length === 0) return null
    // Return native JS string[] so the Supabase client serializes to Postgres text[].
    return nums.map((n) => String(n > 0 ? n : 0))
  }

  function getAxleSpacingLabel(
    isTractor: boolean,
    numAxles: number | null | undefined,
    idx: number,
    trailerType?: string | null
  ) {
    const n = Math.max(isTractor ? 3 : 2, Number(numAxles) || (isTractor ? 3 : 2))
    if (!isTractor) {
      const roleSummary = assignAxleGroups(null, [{ num_axles: n, trailer_type: trailerType }])
      const gType: AxleGroupType = roleSummary.axleTypes[0] || 'trailer'
      const groupLabel = AXLE_GROUP_LABELS[gType]
      return {
        main: `${idx + 1}-${idx + 2}`,
        desc: `${groupLabel}: between axles ${idx + 1} & ${idx + 2}`,
      }
    }
    // Tractor: full consecutive gaps for all axles (steer + drives)
    if (idx === 0) {
      return {
        main: '1-2',
        desc: 'Steer → Drives (group gap)',
      }
    }
    const d1 = idx   // drive index for the "from"
    const d2 = idx + 1
    return {
      main: `${idx + 1}-${idx + 2}`,
      desc: `Drives: between axles ${d1 + 1}–${d2 + 1}`,
    }
  }

  function resizeAxleSpacings(current: any, newNum: number | null, isTractor: boolean): number[] {
    const n = Math.max(isTractor ? 2 : 1, Number(newNum) || (isTractor ? 3 : 2))
    const expected = Math.max(0, n - 1) // full inter-axle gaps (tractor includes 1-2 steer→drive)
    // Free-length parse first (preserves middle zeros). Do NOT pad with zeros then seed —
    // zero-pad makes the seed loop a no-op and leaves new gaps empty.
    const prev = normalizeAxleSpacingSlots(current)
    const out: number[] = []
    for (let i = 0; i < expected; i++) {
      if (i < prev.length) {
        // Keep existing slot values including explicit cleared zeros
        out.push(prev[i] > 0 ? prev[i] : 0)
      } else {
        // NEW slot only — tractor 1-2 seeds 220"; later tractor gaps 48"; trailer 49"
        if (isTractor && i === 0) out.push(220)
        else out.push(isTractor ? 48 : 49)
      }
    }
    return out
  }

  function computeWheelbase(spacings: any): number | null {
    const s = normalizeAxleSpacings(spacings)
    if (s.length < 1) return null
    const s12 = s[0] || 0
    const s23 = s[1] || 0
    // Need a positive 1-2 gap for a meaningful wheelbase
    if (!(s12 > 0)) return null
    const wb = s12 + (s23 > 0 ? s23 / 2 : 0)
    return wb > 0 ? Math.round(wb * 10) / 10 : null
  }

  // Dynamic, clearly-labeled axle spacing inputs.
  // For tractors: (num_axles - 1) fields starting with 1-2 (Steer to 1st Drive), then 2-3, 3-4…
  // For trailers: optional kingpin→1st axle + (num_axles - 1) inter-axle 1-2, 2-3… by role group.
  // Wheelbase for tractor is auto-computed in real time from the first two spacings.
  function AxleSpacingsInputs({
    numAxles,
    spacings,
    onChangeSpacing,
    isTractor,
    trailerType,
    kingpinToFirstAxleIn,
    onChangeKingpinToFirst,
    hasLiftAxle,
  }: {
    numAxles: number | null | undefined
    spacings: any
    onChangeSpacing: (idx: number, value: number | null) => void
    isTractor: boolean
    trailerType?: string | null
    kingpinToFirstAxleIn?: number | null
    onChangeKingpinToFirst?: (value: number | null) => void
    hasLiftAxle?: boolean | null
  }) {
    const n = Number(numAxles) || (isTractor ? 3 : 2)
    const expected = Math.max(0, n - 1)
    if (expected <= 0 && isTractor) return null
    // Fixed-length slots so clearing gap 2-3 does not shift 3-4 into the 2-3 field.
    const arr = normalizeAxleSpacings(spacings, expected)
    const groupLine = isTractor
      ? formatAxleGroupSummaryLine(assignAxleGroups({ num_axles: n }, []))
      : formatAxleGroupSummaryLine(assignAxleGroups(null, [{ num_axles: n, trailer_type: trailerType }]))
    const rearPin = !isTractor && isRearPinTrailerType(trailerType)
    const kpLabel = rearPin ? 'Pin → 1st Axle (in)' : 'Kingpin → 1st Axle (in)'
    return (
      <div className="md:col-span-3">
        <label className={fieldLabelTinyClass}>
          {isTractor ? 'Tractor axle spacings (inches)' : 'Trailer axle geometry (inches)'}
        </label>
        <div className={`${fieldHintTinyClass} mt-0.5 mb-1`}>
          {groupLine}
          {hasLiftAxle ? ' · Lift axle' : ''}
        </div>
        {!isTractor && onChangeKingpinToFirst && (
          <div className="mb-2 max-w-[11rem]">
            <div className={`${fieldHintTinyClass} leading-tight`}>{kpLabel}</div>
            <div className={`${fieldHintTinyClass} leading-tight mb-0.5`}>
              {rearPin ? 'Rear pin to first axle center' : 'Kingpin to first axle center'}
            </div>
            <input
              type="number"
              value={kingpinToFirstAxleIn && kingpinToFirstAxleIn > 0 ? kingpinToFirstAxleIn : ''}
              onChange={(e) => {
                const val = e.target.value.trim() === '' ? null : parseFloat(e.target.value)
                onChangeKingpinToFirst(val && Number.isFinite(val) && val > 0 ? val : null)
              }}
              placeholder="480"
              className={inputClass}
            />
          </div>
        )}
        {expected > 0 && (
          <div className="mt-1 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
            {Array.from({ length: expected }).map((_, idx) => {
              const { main, desc } = getAxleSpacingLabel(isTractor, n, idx, trailerType)
              const v = arr[idx]
              return (
                <div key={idx}>
                  <div className={`${fieldHintTinyClass} leading-tight font-medium text-gray-700`}>{main}</div>
                  <div className={`${fieldHintTinyClass} leading-tight mb-0.5`}>{desc}</div>
                  <input
                    type="number"
                    value={v && v > 0 ? v : ''}
                    onChange={(e) => {
                      const val = e.target.value.trim() === '' ? null : parseFloat(e.target.value)
                      onChangeSpacing(idx, val && Number.isFinite(val) && val > 0 ? val : null)
                    }}
                    placeholder={String(isTractor ? (idx === 0 ? 220 : 48) : 49)}
                    className={inputClass}
                  />
                </div>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  // Tiny centralized predicate so "missing optional table" handling is not duplicated
  // (addresses review feedback on loadAll + deleteRig observability for rig_configurations).
  function isMissingRelation(e: any): boolean {
    return /does not exist|relation.*does not/i.test(String(e?.message || e || ''))
  }

  // ========== TRACTOR CRUD ==========
  function startNewTractor() {
    if (isServiceModeReadOnly) return
    setEditingTractor({
      profile_name: '',
      overall_length_ft: 28,
      num_axles: 3,
      steer_axle_setback_in: 36,
      wheelbase_in: 220,
      axle_spacings: [220, 48],
      fifth_wheel_from_rear_in: 24,
      unit_number: '',
      license_plate: '',
      license_plate_state: '',
      make: '',
      model: '',
    })
    setActiveTab('tractors')
  }

  async function saveTractor() {
    if (isServiceModeReadOnly) return
    if (!safeProfileName(editingTractor?.profile_name)) {
      alert('Profile name is required')
      return
    }
    const supabase = createClient()

    let payloadData: any = { ...editingTractor }
    // Use the single robust normalizer (handles string/ array /null /garbage / all the examples in task)
    payloadData.axle_spacings = normalizeAxleSpacings(payloadData.axle_spacings)
    payloadData.license_plate = (payloadData.license_plate || '').trim().toUpperCase() || null
    payloadData.license_plate_state = normalizeLicensePlateState(payloadData.license_plate_state)

    // Tractor-specific: ensure Wheelbase is always the real-time auto-calculated value
    // from the individual axle spacing fields the user entered (1-2 + 2-3/2 for tandem center).
    // The axle_spacings array stores the full list of individual spacings.
    if (payloadData.axle_spacings && payloadData.axle_spacings.length > 0) {
      const wb = computeWheelbase(payloadData.axle_spacings)
      if (wb != null) payloadData.wheelbase_in = wb
    }

    const plainNotes = payloadData.notes || ''
    const identityYear = parseEquipmentYear(payloadData.year)
    const identityMake = emptyToNull(payloadData.make)
    const identityModel = emptyToNull(payloadData.model)
    const identityVin = emptyToNull(payloadData.vin)
    const structured = {
      _v: 1,
      type: 'tractor',
      overall_length_ft: payloadData.overall_length_ft ?? null,
      num_axles: payloadData.num_axles ?? null,
      steer_axle_setback_in: payloadData.steer_axle_setback_in ?? null,
      wheelbase_in: payloadData.wheelbase_in ?? null,
      axle_spacings: payloadData.axle_spacings ?? null,
      fifth_wheel_from_rear_in: payloadData.fifth_wheel_from_rear_in ?? null,
      unit_number: emptyToNull(payloadData.unit_number),
      license_plate: payloadData.license_plate ?? null,
      license_plate_state: payloadData.license_plate_state ?? null,
      vin: identityVin,
      empty_weight_lbs: payloadData.empty_weight_lbs ?? null,
      year: identityYear,
      make: identityMake,
      model: identityModel,
      _notes: plainNotes,
    }

    const organizationId = equipmentOrganizationIdForSave(ownOrganizationId)

    const dbPayload: any = {
      user_id: user.id,
      type: 'tractor',
      name: safeProfileName(payloadData.profile_name),
      profile_name: safeProfileName(payloadData.profile_name),
      unit_number: emptyToNull(payloadData.unit_number),
      license_plate: payloadData.license_plate || null,
      license_plate_state: payloadData.license_plate_state || null,
      vin: identityVin,
      year: identityYear,
      make: identityMake,
      model: identityModel,
      axles: payloadData.num_axles || null,
      axle_spacing: axleSpacingForDb(payloadData.axle_spacings),
      notes: `RIGBUILDER:v1:${JSON.stringify(structured)}`,
    }
    if (organizationId) {
      dbPayload.organization_id = organizationId
    }

    const { error } = editingTractor.id
      ? await supabase.from('equipment_profiles').update(dbPayload).eq('id', editingTractor.id)
      : await supabase.from('equipment_profiles').insert(dbPayload)

    if (error) {
      alert('Save failed: ' + error.message)
      return
    }
    setEditingTractor(null)
    await loadAll()
  }

  async function deleteTractor(id: string) {
    if (isServiceModeReadOnly) return
    if (!confirm('Delete this tractor profile? (Any rigs using it will need updating)')) return
    const supabase = createClient()
    const { error } = await supabase
      .from('equipment_profiles')
      .delete()
      .eq('user_id', user.id)
      .eq('id', id)
    if (error) {
      alert('Delete failed: ' + error.message)
      return
    }
    await loadAll()
  }

  // ========== TRAILER CRUD ==========
  function startNewTrailer() {
    if (isServiceModeReadOnly) return
    setEditingTrailer({
      profile_name: '',
      overall_length_ft: 53,
      kingpin_distance_from_front_in: 36,
      num_axles: 2,
      axle_spacings: [49],
      kingpin_to_first_axle_in: 480,
      has_lift_axle: false,
      is_extendable: false,
      extendable_extra_ft: 0,
      trailer_type: 'Flatbed',
    })
    setActiveTab('trailers')
  }

  async function saveTrailer() {
    if (isServiceModeReadOnly) return
    if (!safeProfileName(editingTrailer?.profile_name)) {
      alert('Profile name is required')
      return
    }
    const supabase = createClient()

    let payloadData: any = { ...editingTrailer }
    // Use the single robust normalizer (handles string/ array /null /garbage / all the examples in task)
    payloadData.axle_spacings = normalizeAxleSpacings(payloadData.axle_spacings)
    payloadData.license_plate = (payloadData.license_plate || '').trim().toUpperCase() || null
    payloadData.license_plate_state = normalizeLicensePlateState(payloadData.license_plate_state)
    // Smart trailer types: normalize + persist new user-typed entries to local list
    if (payloadData.trailer_type) {
      payloadData.trailer_type = saveCustomTrailerType(payloadData.trailer_type)
      setTrailerTypeOptions(getTrailerTypeOptions())
    }

    const plainNotes = payloadData.notes || ''
    // Manufacturer identity only — never copy trailer_type into make
    const identityYear = parseEquipmentYear(payloadData.year)
    const identityMake = emptyToNull(payloadData.make)
    const identityModel = emptyToNull(payloadData.model)
    const identityVin = emptyToNull(payloadData.vin)
    const structured = {
      _v: 1,
      type: 'trailer',
      overall_length_ft: payloadData.overall_length_ft ?? null,
      kingpin_distance_from_front_in: payloadData.kingpin_distance_from_front_in ?? null,
      num_axles: payloadData.num_axles ?? null,
      axle_spacings: payloadData.axle_spacings ?? null,
      kingpin_to_first_axle_in: payloadData.kingpin_to_first_axle_in ?? null,
      has_lift_axle: !!payloadData.has_lift_axle,
      is_extendable: !!payloadData.is_extendable,
      extendable_extra_ft: payloadData.extendable_extra_ft ?? 0,
      trailer_type: formatTrailerTypeLabel(payloadData.trailer_type) || payloadData.trailer_type || null,
      license_plate: payloadData.license_plate ?? null,
      license_plate_state: payloadData.license_plate_state ?? null,
      vin: identityVin,
      empty_weight_lbs: payloadData.empty_weight_lbs ?? null,
      width_ft: payloadData.width_ft ?? null,
      deck_height_ft: payloadData.deck_height_ft ?? null,
      make: identityMake,
      model: identityModel,
      year: identityYear,
      _notes: plainNotes,
    }

    const organizationId = equipmentOrganizationIdForSave(ownOrganizationId)

    const dbPayload: any = {
      user_id: user.id,
      type: 'trailer',
      name: safeProfileName(payloadData.profile_name),
      profile_name: safeProfileName(payloadData.profile_name),
      // Manufacturer make only — never fall back to trailer_type (equipment class)
      make: identityMake,
      license_plate: payloadData.license_plate || null,
      license_plate_state: payloadData.license_plate_state || null,
      vin: identityVin,
      model: identityModel,
      year: identityYear,
      length_ft: payloadData.overall_length_ft || null,
      axles: payloadData.num_axles || null,
      axle_spacing: axleSpacingForDb(payloadData.axle_spacings),
      notes: `RIGBUILDER:v1:${JSON.stringify(structured)}`,
    }
    if (organizationId) {
      dbPayload.organization_id = organizationId
    }

    const { error } = editingTrailer.id
      ? await supabase.from('equipment_profiles').update(dbPayload).eq('id', editingTrailer.id)
      : await supabase.from('equipment_profiles').insert(dbPayload)

    if (error) {
      alert('Save failed: ' + error.message)
      return
    }
    setEditingTrailer(null)
    await loadAll()
  }

  async function deleteTrailer(id: string) {
    if (isServiceModeReadOnly) return
    if (!confirm('Delete this trailer profile?')) return
    const supabase = createClient()
    const { error } = await supabase
      .from('equipment_profiles')
      .delete()
      .eq('user_id', user.id)
      .eq('id', id)
    if (error) {
      alert('Delete failed: ' + error.message)
      return
    }
    await loadAll()
  }

  // ========== RIG BUILDER ==========
  function addTrailerToBuild(id: string) {
    if (!selectedTrailerIds.includes(id)) {
      setSelectedTrailerIds([...selectedTrailerIds, id])
    }
  }
  function removeTrailerFromBuild(idx: number) {
    setSelectedTrailerIds(selectedTrailerIds.filter((_, i) => i !== idx))
  }
  function clearBuilder() {
    setSelectedTractorId('')
    setSelectedTrailerIds([])
    setRigName('')
    setBuilderNote('')
    setLoadedRigId(null)
  }

  async function setDefaultRig(rigId: string) {
    if (isServiceModeReadOnly) return
    const rig = rigs.find((r) => r.id === rigId)
    if (!rig) return
    if (rig.source !== 'rig_configurations') {
      alert('Default rig can only be set on saved configurations in the rig database. Re-save this rig from the builder.')
      return
    }
    setSettingDefaultRigId(rigId)
    const supabase = createClient()
    try {
      const { error: clearErr } = await supabase
        .from('rig_configurations')
        .update({ is_default: false })
        .eq('user_id', user.id)
        .eq('is_default', true)
      if (clearErr && !isMissingRelation(clearErr)) throw clearErr

      const { error: setErr } = await supabase
        .from('rig_configurations')
        .update({ is_default: true })
        .eq('user_id', user.id)
        .eq('id', rigId)
      if (setErr) {
        const isUniqueViolation =
          setErr.code === '23505' || /unique|duplicate key/i.test(setErr.message || '')
        if (isUniqueViolation) {
          alert(
            'Another rig was set as default at the same time. Refresh the page and try again if needed.'
          )
          await loadAll()
          return
        }
        throw setErr
      }

      setRigs((prev) =>
        prev.map((r) => ({
          ...r,
          is_default: r.id === rigId,
        }))
      )
      void loadAll()
    } catch (e: any) {
      alert('Failed to set default rig: ' + (e?.message || e))
    } finally {
      setSettingDefaultRigId(null)
    }
  }

  function loadRigIntoPermitAgent(rig: RigConfiguration) {
    router.push(`/permit-test?rigId=${encodeURIComponent(rig.id)}`)
  }

  async function saveCurrentRig() {
    if (isServiceModeReadOnly) return
    if (!selectedTractorId || selectedTrailerIds.length === 0) {
      alert('Select a tractor and at least one trailer')
      return
    }
    // safeProfileName is the single source of truth for all name sanitization (see its definition + JSDoc).
    const name = safeProfileName(rigName || `${currentTractor?.profile_name || 'Rig'} + ${currentTrailers.length} trailer(s)`) || 'Rig Configuration'
    const supabase = createClient()

    // Save directly to the dedicated rig_configurations table (ensured by migration 012).
    // This completely bypasses equipment_profiles and its type CHECK constraint
    // (which only permits 'tractor'/'trailer' or NULL on the live DB).
    // tractor_id / trailer_ids currently reference equipment_profiles rows (the active source of truth for the Rig Builder).
    // Will become FKs into dedicated tractors/trailers tables after the profile migration.
    // no hard FK today per the relaxed design in 012 so inserts succeed.
    // trailer_ids is jsonb array preserving order. Computed fields are cached for selectors/diagrams.
    // Always populate the three computed_* columns the UI and permit snapshots expect.
    // The kingpin-to-last-axle value is the distance from the first kingpin to the rear of the rig.
    const kingpinToLastAxleFt = dims.kingpinPositionsFt.length
      ? dims.totalLengthFt - dims.kingpinPositionsFt[0]
      : null;

    const rigPayload = {
      rig_name: name,
      name: name,
      tractor_id: selectedTractorId,
      trailer_ids: selectedTrailerIds,
      computed_total_length_ft: dims.totalLengthFt,
      computed_total_axles: dims.totalAxles,
      computed_kingpin_to_last_axle_ft: kingpinToLastAxleFt,
      notes: builderNote.trim() || null,
    }

    const editingExisting =
      loadedRigId && rigs.find((r) => r.id === loadedRigId)?.source === 'rig_configurations'

    const { error } = editingExisting
      ? await supabase
          .from('rig_configurations')
          .update(rigPayload)
          .eq('id', loadedRigId!)
          .eq('user_id', user.id)
      : await supabase.from('rig_configurations').insert({
          user_id: user.id,
          ...rigPayload,
        })

    if (error) {
      alert('Failed to save rig: ' + error.message)
      return
    }
    alert(editingExisting ? `Updated rig "${name}"` : `Saved rig "${name}"`)
    await loadAll()
    setActiveTab('rigs'); setRigBuilderOpen(false)
    clearBuilder()
  }

  async function deleteRig(id: string) {
    if (isServiceModeReadOnly) return
    if (!confirm('Delete this saved rig configuration?')) return
    const supabase = createClient()
    // Support both legacy rigs (in equipment_profiles) and optional rig_configurations table.
    // Ignore "table does not exist" errors for the optional table so deletes of legacy rigs
    // continue to work even if rig_configurations was never created.
    let delError: any = null
    try {
      const { error: e1 } = await supabase
        .from('rig_configurations')
        .delete()
        .eq('user_id', user.id)
        .eq('id', id)
      if (e1 && !isMissingRelation(e1)) delError = e1
    } catch (e) {
      if (!isMissingRelation(e)) delError = e
    }
    try {
      const { error: e2 } = await supabase
        .from('equipment_profiles')
        .delete()
        .eq('user_id', user.id)
        .eq('id', id)
      if (e2) delError = e2 // equipment_profiles must exist
    } catch (e) {
      delError = e
    }
    if (delError) {
      alert('Delete failed: ' + (delError.message || delError))
      return
    }
    await loadAll()
  }

  function loadRigIntoBuilder(rig: RigConfiguration) {
    setSelectedTractorId(rig.tractor_id)
    setSelectedTrailerIds(rig.trailer_ids || [])
    setRigName(rig.rig_name)
    setBuilderNote(rig.notes || '')
    setLoadedRigId(rig.id)
    setActiveTab('rigs'); setRigBuilderOpen(true)
    window.scrollTo({ top: 120, behavior: 'smooth' })
  }

  function renderDefaultRigButton(rig: RigConfiguration, className = '') {
    if (isServiceModeReadOnly) return null
    const isDefault = !!rig.is_default
    const canSetDefault = rig.source === 'rig_configurations'
    const busy = settingDefaultRigId === rig.id
    if (isDefault) return null
    return (
      <button
        type="button"
        onClick={() => setDefaultRig(rig.id)}
        disabled={!canSetDefault || busy}
        title={canSetDefault ? 'Use this rig automatically in Permit Agent' : 'Re-save from Rig Builder to enable default'}
        className={`${buttonSecondaryClass} ${className}`}
      >
        {busy ? 'Saving…' : 'Make default'}
      </button>
    )
  }

  // ========== RENDER ==========
  if (loadingAuth) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="w-14 h-14 bg-black rounded-xl flex items-center justify-center mx-auto mb-4">
            <span className="text-white text-3xl font-bold tracking-tighter">T</span>
          </div>
          <p className="text-gray-700">Loading equipment manager…</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader user={user} activePage="equipment" ownOrganizationId={ownOrganizationId} />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8 min-w-0">
        <ActiveCarrierBanner ownOrganizationId={ownOrganizationId} />
        {isServiceModeReadOnly && (
          <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Service Mode: equipment is read-only. Switch to Carrier Mode in the workspace bar to add or edit tractors, trailers, and rigs.
          </div>
        )}
        {workspaceMode === 'service' && !effectiveOrganizationId && (
          <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Select a carrier in the workspace bar above to view that carrier&apos;s equipment.
          </div>
        )}
        {workspaceMode === 'service' && effectiveOrganizationId && loadingPrimaryOwner && (
          <p className="mb-4 text-sm text-gray-600">Resolving carrier equipment owner…</p>
        )}
        {workspaceMode === 'service' && effectiveOrganizationId && carrierPrimaryOwnerError && (
          <p className="mb-4 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            Could not load carrier rigs: {carrierPrimaryOwnerError}. Tractor/trailer profiles may still load by organization.
          </p>
        )}
        {/* Header — New Analysis only; History lives in AppHeader when on this page */}
        <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Equipment</p>
            <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-gray-900 mt-1">
              Equipment &amp; Rig Builder
            </h1>
            <p className={`${bodyTextClass} mt-2 text-sm sm:text-[15px] max-w-2xl`}>
              Add your tractor and trailer, then build a rig for OSOW dimensions.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 sm:gap-3 shrink-0">
            <a href="/permit-test" className={buttonPrimaryClass}>New Analysis →</a>
          </div>
        </div>

        {/* Tabs */}
        <div className={`flex gap-1 border-b ${dividerBorderClass} mb-6`}>
          {([
            { k: 'tractors', label: 'Tractors' },
            { k: 'trailers', label: 'Trailers' },
            { k: 'rigs', label: 'Rigs' },
          ] as const).map((t) => (
            <button
              key={t.k}
              onClick={() => {
                setHasChosenTab(true)
                setActiveTab(t.k)
                if (t.k === 'rigs' && rigs.length === 0) setRigBuilderOpen(true)
              }}
              className={`min-h-[44px] px-5 py-2.5 text-sm font-medium border-b-2 transition-all touch-manipulation ${
                activeTab === t.k
                  ? 'border-emerald-600 text-emerald-700'
                  : 'border-transparent text-gray-700 sm:text-gray-600 hover:text-gray-900'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* RIG BUILDER TAB */}
        {activeTab === 'rigs' && rigBuilderOpen && (
          <div className="space-y-6">
            <div className={cardClass}>
              <h2 className="font-semibold text-xl tracking-tight mb-1">Build a Combination</h2>
              <p className={`text-sm ${bodyTextClass} mb-4`}>
                Pick a tractor and trailers — length and axle layout update from 5th-wheel / kingpin geometry.
              </p>

              <div className="grid md:grid-cols-2 gap-4 mb-4">
                {/* Tractor picker */}
                <div>
                  <label className={fieldLabelSectionClass}>TRACTOR / POWER UNIT</label>
                  <select
                    value={selectedTractorId}
                    onChange={(e) => setSelectedTractorId(e.target.value)}
                    className={selectClass}
                  >
                    <option value="">— Select tractor —</option>
                    {tractors.map((t) => {
                      const plate = formatLicensePlateDisplay(t.license_plate, t.license_plate_state)
                      return (
                        <option key={t.id} value={t.id}>
                          {t.profile_name}{t.unit_number ? ` (#${t.unit_number})` : ''}{plate ? ` • ${plate}` : ''} — {t.overall_length_ft || '?'} ft
                        </option>
                      )
                    })}
                  </select>
                  {tractors.length === 0 && <p className="text-xs text-amber-800 sm:text-amber-700 mt-1">No tractors yet. Add one in the Tractors tab.</p>}
                </div>

                {/* Trailer picker */}
                <div>
                  <label className={fieldLabelSectionClass}>ADD TRAILER(S)</label>
                  <div className="flex gap-2">
                    <select
                      onChange={(e) => { if (e.target.value) addTrailerToBuild(e.target.value); e.target.value = '' }}
                      className={`flex-1 ${selectClass}`}
                    >
                      <option value="">— Select trailer to add —</option>
                      {trailers
                        .filter((tr) => !selectedTrailerIds.includes(tr.id))
                        .map((tr) => {
                          const plate = formatLicensePlateDisplay(tr.license_plate, tr.license_plate_state)
                          return (
                            <option key={tr.id} value={tr.id}>
                              {tr.profile_name}{plate ? ` • ${plate}` : ''} — {tr.overall_length_ft || '?'} ft
                            </option>
                          )
                        })}
                    </select>
                    {!isServiceModeReadOnly && (
                      <button onClick={startNewTrailer} className={`${buttonSuccessClass} rounded-xl`}>+ New Trailer</button>
                    )}
                  </div>
                </div>
              </div>

              {/* Selected trailers chips */}
              {selectedTrailerIds.length > 0 && (
                <div className="mb-4">
                  <div className={fieldLabelSectionClass}>CURRENT COMBINATION ({selectedTrailerIds.length} trailer{selectedTrailerIds.length > 1 ? 's' : ''})</div>
                  <div className="flex flex-wrap gap-2">
                    {currentTrailers.map((tr, idx) => {
                      const plate = formatLicensePlateDisplay(tr.license_plate, tr.license_plate_state)
                      return (
                        <div key={idx} className="inline-flex items-center gap-1.5 bg-emerald-50 border border-emerald-200 text-emerald-800 px-3 py-1 rounded-full text-sm">
                          {tr.profile_name}{plate ? ` • ${plate}` : ''}
                          <button onClick={() => removeTrailerFromBuild(idx)} className="text-emerald-700 hover:text-red-600 ml-1">×</button>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {(currentTractor || currentTrailers.length > 0) && (
                <div className={`mb-4 grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] ${bodyTextClass}`}>
                  {currentTractor && (
                    <div className="bg-gray-50 border border-gray-300 sm:border-gray-200 rounded-lg px-3 py-2">
                      <span className="font-semibold text-gray-700">Tractor plate:</span>{' '}
                      <span className="font-mono text-gray-900">
                        {formatLicensePlateDisplay(currentTractor.license_plate, currentTractor.license_plate_state) || '—'}
                      </span>
                    </div>
                  )}
                  {currentTrailers.map((tr, idx) => {
                    const plate = formatLicensePlateDisplay(tr.license_plate, tr.license_plate_state)
                    return (
                      <div key={tr.id || idx} className="bg-gray-50 border border-gray-300 sm:border-gray-200 rounded-lg px-3 py-2">
                        <span className="font-semibold text-gray-700">Trailer {idx + 1} plate:</span>{' '}
                        <span className="font-mono text-gray-900">{plate || '—'}</span>
                        {tr.has_lift_axle ? (
                          <span className="ml-1 text-amber-800">· Lift axle</span>
                        ) : null}
                      </div>
                    )
                  })}
                  <div className="sm:col-span-2 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 text-emerald-900">
                    <span className="font-semibold">Axle groups:</span>{' '}
                    {formatAxleGroupSummaryLine(
                      assignAxleGroups(currentTractor || null, currentTrailers)
                    )}
                  </div>
                </div>
              )}

              {/* Live Diagram + Numbers - supports tractor-only, trailer-only, or full rig */}
              {(() => {
                const hasTractor = !!currentTractor;
                const hasTrailers = currentTrailers.length > 0;
                if (hasTractor && !hasTrailers) {
                  // Tractor-only: use shared graphic directly (consistent visual, appropriate size for builder)
                  const previewTractor = currentTractor;
                  return (
                    <div className="mt-2">
                      <TractorGraphic
                        tractor={previewTractor}
                        height={110}
                        className="w-full max-w-[520px] border border-gray-300 sm:border-gray-200 rounded-2xl bg-white p-1"
                      />
                    </div>
                  );
                }
                if (hasTractor || hasTrailers) {
                  const previewTractor = hasTractor ? currentTractor : null;
                  return (
                    <div className="mt-2">
                      <VehicleDiagram
                        tractor={previewTractor}
                        trailers={currentTrailers}
                      />
                    </div>
                  );
                }
                return (
                  <div className={`border border-dashed border-gray-500 sm:border-gray-300 rounded-2xl p-8 text-center ${mutedTextClass} bg-white`}>
                    Select a tractor and/or one or more trailers above to see the live graphical preview and auto-calculated dimensions.
                  </div>
                );
              })()}

              {/* Save controls */}
              {!isServiceModeReadOnly && (
              <div className="mt-5 grid md:grid-cols-[1fr,auto] gap-3 items-end">
                <div>
                  <label className={fieldLabelMediumClass}>Rig Name (saved for quick selection in analyses)</label>
                  <input
                    value={rigName}
                    onChange={(e) => setRigName(e.target.value)}
                    placeholder="e.g. KW T680 + 53' Flatbed"
                    className={`mt-1 w-full ${fieldControlClass} p-3 rounded-xl text-sm`}
                  />
                  <textarea
                    value={builderNote}
                    onChange={(e) => setBuilderNote(e.target.value)}
                    placeholder="Notes (optional) — e.g. 'Steerable lift on trailer 2, used for bridge kits'"
                    className={`mt-2 w-full ${textareaClass} h-16`}
                  />
                </div>
                <div className="flex flex-col gap-2 items-stretch sm:items-end">
                  <div className="flex gap-2">
                    <button onClick={clearBuilder} className={`${buttonSecondaryClass} rounded-xl`}>Clear</button>
                    <button
                      onClick={saveCurrentRig}
                      disabled={!selectedTractorId || selectedTrailerIds.length === 0}
                      className={`${buttonSuccessClass} font-semibold rounded-xl`}
                    >
                      {loadedRigId && rigs.find((r) => r.id === loadedRigId)?.source === 'rig_configurations'
                        ? 'Update Rig Configuration'
                        : 'Save Rig Configuration'}
                    </button>
                  </div>
                  {loadedRigId && (() => {
                    const loadedRig = rigs.find((r) => r.id === loadedRigId)
                    if (!loadedRig) return null
                    return renderDefaultRigButton(loadedRig, 'w-full sm:w-auto text-center')
                  })()}
                </div>
              </div>
              )}
            </div>
          </div>
        )}

        {/* TRACTORS TAB */}
        {activeTab === 'tractors' && (
          <div>
            <div className="flex justify-between items-center mb-3">
              <div className="font-semibold">My Tractors ({tractors.length})</div>
              {!isServiceModeReadOnly && (
                <button onClick={startNewTractor} className={buttonPrimaryClass}>+ New Tractor Profile</button>
              )}
            </div>

            {editingTractor && !isServiceModeReadOnly && (
              <div className={editorShellClass}>
                <div className="font-semibold text-base tracking-tight mb-3">Tractor profile</div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
                  {[
                    ['Profile Name *', 'profile_name', 'text'],
                    ['# Axles (3–6)', 'num_axles', 'number'],
                    ['Steer Axle Setback (in)', 'steer_axle_setback_in', 'number'],
                    ['Wheelbase (auto-calculated, in)', 'wheelbase_in', 'number'],
                    ['5th Wheel from Rear (in)', 'fifth_wheel_from_rear_in', 'number'],
                    ['Unit #', 'unit_number', 'text'],
                    ['Tractor VIN', 'vin', 'text'],
                    ['Empty Weight (lbs)', 'empty_weight_lbs', 'number'],
                    ['Year', 'year', 'number'],
                    ['Make', 'make', 'text'],
                    ['Model', 'model', 'text'],
                  ].map(([label, key, type]) => (
                    <div key={key}>
                      <label className={fieldLabelTinyClass}>{label}</label>
                      {key === 'wheelbase_in' ? (
                        <input
                          type="number"
                          value={computeWheelbase(editingTractor.axle_spacings) ?? (editingTractor as any)[key] ?? ''}
                          readOnly
                          className={`${inputMtClass} bg-gray-100 text-gray-700 cursor-not-allowed`}
                          title="Auto-calculated from axle spacings: 1-2 + (2-3 / 2) — center of tandem drive group for 5th wheel positioning"
                        />
                      ) : (
                        <input
                          type={type as any}
                          value={(editingTractor as any)[key] ?? ''}
                          onChange={(e) => {
                            if (key === 'year') {
                              const raw = e.target.value
                              if (raw === '') {
                                setEditingTractor({ ...editingTractor, year: null })
                                return
                              }
                              const n = parseInt(raw, 10)
                              setEditingTractor({
                                ...editingTractor,
                                year: Number.isFinite(n) ? n : null,
                              })
                              return
                            }
                            const v = type === 'number' ? parseFloat(e.target.value) || null : e.target.value
                            if (key === 'num_axles') {
                              const numVal = Number(v) || null
                              const resized = resizeAxleSpacings(editingTractor.axle_spacings, numVal, true)
                              const wb = computeWheelbase(resized)
                              setEditingTractor({ ...editingTractor, num_axles: numVal, axle_spacings: resized, wheelbase_in: wb })
                            } else {
                              setEditingTractor({ ...editingTractor, [key]: v })
                            }
                          }}
                          min={key === 'year' ? 1900 : undefined}
                          max={key === 'year' ? 2100 : undefined}
                          step={key === 'year' ? 1 : undefined}
                          className={inputMtClass}
                        />
                      )}
                    </div>
                  ))}
                  <DimensionInput
                    label="Overall Length"
                    value={editingTractor.overall_length_ft ?? ''}
                    onChange={(ft) => setEditingTractor({ ...editingTractor, overall_length_ft: ft })}
                    placeholder={`e.g. 28' 0" or 336"`}
                  />
                  <LicensePlateFields
                    idPrefix={`tractor-${editingTractor.id ?? 'new'}`}
                    plate={editingTractor.license_plate}
                    state={editingTractor.license_plate_state}
                    onPlateChange={(value) =>
                      setEditingTractor((prev) => (prev ? { ...prev, license_plate: value } : prev))
                    }
                    onStateChange={(value) =>
                      setEditingTractor((prev) =>
                        prev
                          ? {
                              ...prev,
                              license_plate_state:
                                normalizeLicensePlateState(value) ?? (value ? value.toUpperCase() : ''),
                            }
                          : prev
                      )
                    }
                  />
                  <AxleSpacingsInputs
                    numAxles={editingTractor.num_axles}
                    spacings={editingTractor.axle_spacings}
                    onChangeSpacing={(idx, val) => {
                      const n = Number(editingTractor.num_axles) || 3
                      const expected = Math.max(0, n - 1)
                      const curr = normalizeAxleSpacings(editingTractor.axle_spacings, expected)
                      const next = [...curr]
                      next[idx] = val ?? 0
                      const wb = computeWheelbase(next)
                      setEditingTractor({ ...editingTractor, axle_spacings: next, wheelbase_in: wb })
                    }}
                    isTractor
                  />
                </div>

                {/* Compact preview in edit view */}
                <div className={`mt-3 pt-2 border-t ${dividerBorderClass}`}>
                  <div className={`${fieldHintTinyClass} mb-1`}>Live preview</div>
                  <VehicleDiagram
                    tractor={editingTractor}
                    trailers={[]}
                    compact
                    height={36}
                    className="w-full max-w-[200px]"
                  />
                </div>

                <div className="flex gap-2 mt-4">
                  <button onClick={() => setEditingTractor(null)} className={`${buttonSecondaryClass} rounded`}>Cancel</button>
                  <button onClick={saveTractor} className={`${buttonSuccessClass} rounded`}>Save Tractor</button>
                </div>
              </div>
            )}

            <div className="grid md:grid-cols-2 gap-3">
              {tractors.map((t) => (
                <div key={t.id} className={`${cardItemClass} flex flex-col`}>
                  <div className="font-semibold text-base tracking-tight text-gray-900">{t.profile_name}</div>
                  <div className={`${mutedTextClass} text-xs mt-0.5 mb-2`}>
                    {t.unit_number ? `#${t.unit_number} · ` : ''}
                    {[t.year, t.make, t.model].filter(Boolean).join(' ') || 'Tractor'}
                  </div>

                  <div className="flex flex-wrap gap-1.5 mb-2">
                    <span className={metricChipClass}>
                      {t.overall_length_ft
                        ? formatDimensionDisplay(Number(t.overall_length_ft))
                        : '?'}{' '}
                      long
                    </span>
                    <span className={metricChipMutedClass}>{t.num_axles || 3} axles</span>
                    {t.wheelbase_in ? (
                      <span className={metricChipMutedClass}>WB {t.wheelbase_in} in</span>
                    ) : null}
                  </div>

                  <div className={`${bodyTextClass} text-xs space-y-0.5`}>
                    <div className={fieldHintTinyClass}>
                      {formatAxleGroupSummaryLine(assignAxleGroups({ num_axles: t.num_axles || 3 }, []))}
                    </div>
                    <div>5th wheel: {t.fifth_wheel_from_rear_in || '—'} in from rear</div>
                    {formatLicensePlateDisplay(t.license_plate, t.license_plate_state) && (
                      <div>Plate: {formatLicensePlateDisplay(t.license_plate, t.license_plate_state)}</div>
                    )}
                    {t.vin && <div>VIN: {t.vin}</div>}
                    {t.empty_weight_lbs ? (
                      <div>Empty: {Number(t.empty_weight_lbs).toLocaleString()} lbs</div>
                    ) : null}
                  </div>

                  {/* Tractor graphic preview (now consistent via shared component) */}
                  <div className="mt-2 flex justify-center">
                    <TractorGraphic
                      tractor={t}
                      height={30}
                      className="w-full max-w-[130px]"
                    />
                  </div>

                  {!isServiceModeReadOnly && (
                    <div className="mt-auto pt-3 flex gap-2 text-xs">
                      <button onClick={() => setEditingTractor(t)} className="text-emerald-700 hover:underline">Edit</button>
                      <button onClick={() => deleteTractor(t.id)} className="text-red-600 hover:underline">Delete</button>
                    </div>
                  )}
                </div>
              ))}
              {tractors.length === 0 && <div className={`text-sm ${mutedTextClass} col-span-2`}>No tractors saved yet. Create your first one above.</div>}
            </div>
          </div>
        )}

        {/* TRAILERS TAB */}
        {activeTab === 'trailers' && (
          <div>
            <div className="flex justify-between items-center mb-3">
              <div className="font-semibold">My Trailers ({trailers.length})</div>
              {!isServiceModeReadOnly && (
                <button onClick={startNewTrailer} className={buttonPrimaryClass}>+ New Trailer Profile</button>
              )}
            </div>

            {editingTrailer && !isServiceModeReadOnly && (
              <div className={editorShellClass}>
                <div className="font-semibold text-base tracking-tight mb-3">Trailer profile</div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
                  {(() => {
                    const rearPin = isRearPinTrailerType(editingTrailer.trailer_type)
                    // Flip/stinger pin to rear of RGN — soft-relabel kingpin fields (geometry still stored for v1).
                    // Kingpin → 1st axle lives with AxleSpacingsInputs (geometry block).
                    const kpFromFrontLabel = rearPin
                      ? 'Nose setback (in, optional — rear pin)'
                      : 'Kingpin from Front (in)'
                    return [
                      ['Profile Name *', 'profile_name', 'text'],
                      [kpFromFrontLabel, 'kingpin_distance_from_front_in', 'number'],
                      ['# Axles', 'num_axles', 'number'],
                      ['Trailer VIN', 'vin', 'text'],
                      ['Empty Weight (lbs)', 'empty_weight_lbs', 'number'],
                      ['Extendable Extra (ft)', 'extendable_extra_ft', 'number'],
                      ['Year', 'year', 'number'],
                      ['Make', 'make', 'text'],
                      ['Model', 'model', 'text'],
                    ] as [string, string, string][]
                  })().map(([label, key, type]) => (
                    <div key={key}>
                      <label className={fieldLabelTinyClass}>{label}</label>
                      <input
                        type={type as any}
                        value={(editingTrailer as any)[key] ?? ''}
                        onChange={(e) => {
                        if (key === 'year') {
                          const raw = e.target.value
                          if (raw === '') {
                            setEditingTrailer({ ...editingTrailer, year: null })
                            return
                          }
                          const n = parseInt(raw, 10)
                          setEditingTrailer({
                            ...editingTrailer,
                            year: Number.isFinite(n) ? n : null,
                          })
                          return
                        }
                        const v = type === 'number' ? parseFloat(e.target.value) || null : e.target.value
                        if (key === 'num_axles') {
                          const numVal = Number(v) || null
                          const resized = resizeAxleSpacings(editingTrailer.axle_spacings, numVal, false)
                          setEditingTrailer({ ...editingTrailer, num_axles: numVal, axle_spacings: resized })
                        } else {
                          setEditingTrailer({ ...editingTrailer, [key]: v })
                        }
                      }}
                        min={key === 'year' ? 1900 : undefined}
                        max={key === 'year' ? 2100 : undefined}
                        step={key === 'year' ? 1 : undefined}
                        className={inputMtClass}
                      />
                    </div>
                  ))}
                  <DimensionInput
                    label="Overall Length"
                    value={editingTrailer.overall_length_ft ?? ''}
                    onChange={(ft) => setEditingTrailer({ ...editingTrailer, overall_length_ft: ft })}
                    placeholder={`e.g. 53' 0" or 636"`}
                  />
                  <LicensePlateFields
                    idPrefix={`trailer-${editingTrailer.id ?? 'new'}`}
                    plate={editingTrailer.license_plate}
                    state={editingTrailer.license_plate_state}
                    onPlateChange={(value) =>
                      setEditingTrailer((prev) => (prev ? { ...prev, license_plate: value } : prev))
                    }
                    onStateChange={(value) =>
                      setEditingTrailer((prev) =>
                        prev
                          ? {
                              ...prev,
                              license_plate_state:
                                normalizeLicensePlateState(value) ?? (value ? value.toUpperCase() : ''),
                            }
                          : prev
                      )
                    }
                  />
                  <DimensionInput
                    label="Trailer Width"
                    value={editingTrailer.width_ft ?? ''}
                    onChange={(ft) => setEditingTrailer({ ...editingTrailer, width_ft: ft })}
                  />
                  <DimensionInput
                    label="Deck Height"
                    value={editingTrailer.deck_height_ft ?? ''}
                    onChange={(ft) => setEditingTrailer({ ...editingTrailer, deck_height_ft: ft })}
                  />
                  <div className="md:col-span-2">
                    <label className={fieldLabelTinyClass} htmlFor="trailer-type-input">Trailer Type</label>
                    <input
                      id="trailer-type-input"
                      list="trailer-type-options"
                      value={editingTrailer.trailer_type || ''}
                      onChange={(e) =>
                        setEditingTrailer({ ...editingTrailer, trailer_type: e.target.value })
                      }
                      onBlur={() => {
                        // Format only on blur — custom list persists on Save (avoids abandoned drafts clutter).
                        const formatted = formatTrailerTypeLabel(editingTrailer.trailer_type)
                        if (formatted && formatted !== editingTrailer.trailer_type) {
                          setEditingTrailer((prev) => (prev ? { ...prev, trailer_type: formatted } : prev))
                        }
                      }}
                      placeholder="Flatbed, RGN, Jeep, Flip…"
                      className={inputMtClass}
                    />
                    <datalist id="trailer-type-options">
                      {trailerTypeOptions.map((opt) => (
                        <option key={opt} value={opt} />
                      ))}
                    </datalist>
                    <p className={`${fieldHintTinyClass} mt-1 leading-snug`}>
                      {isRearPinTrailerType(editingTrailer.trailer_type) ||
                      isKingpinBoosterTrailerType(editingTrailer.trailer_type)
                        ? TRAILER_TYPE_COUPLING_HINT
                        : TRAILER_TYPE_MAIN_HINT}
                    </p>
                  </div>
                  <div className="flex items-center gap-4 pt-5 text-sm md:col-span-2">
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input type="checkbox" checked={!!editingTrailer.has_lift_axle} onChange={(e) => setEditingTrailer({ ...editingTrailer, has_lift_axle: e.target.checked })} className={checkboxClass} /> Lift axle
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input type="checkbox" checked={!!editingTrailer.is_extendable} onChange={(e) => setEditingTrailer({ ...editingTrailer, is_extendable: e.target.checked })} className={checkboxClass} /> Extendable
                    </label>
                  </div>
                  <AxleSpacingsInputs
                    numAxles={editingTrailer.num_axles}
                    spacings={editingTrailer.axle_spacings}
                    onChangeSpacing={(idx, val) => {
                      const n = Number(editingTrailer.num_axles) || 2
                      const expected = Math.max(0, n - 1)
                      const curr = normalizeAxleSpacings(editingTrailer.axle_spacings, expected)
                      const next = [...curr]
                      next[idx] = val ?? 0
                      setEditingTrailer({ ...editingTrailer, axle_spacings: next })
                    }}
                    isTractor={false}
                    trailerType={editingTrailer.trailer_type}
                    kingpinToFirstAxleIn={editingTrailer.kingpin_to_first_axle_in}
                    onChangeKingpinToFirst={(val) =>
                      setEditingTrailer({ ...editingTrailer, kingpin_to_first_axle_in: val })
                    }
                    hasLiftAxle={editingTrailer.has_lift_axle}
                  />
                </div>

                {/* Compact preview in edit view */}
                <div className={`mt-3 pt-2 border-t ${dividerBorderClass}`}>
                  <div className={`${fieldHintTinyClass} mb-1`}>Live preview</div>
                  <VehicleDiagram
                    tractor={null}
                    trailers={[editingTrailer]}
                    compact
                    height={28}
                    className="w-full max-w-[160px]"
                  />
                </div>

                <div className="flex gap-2 mt-4">
                  <button onClick={() => setEditingTrailer(null)} className={`${buttonSecondaryClass} rounded`}>Cancel</button>
                  <button onClick={saveTrailer} className={`${buttonSuccessClass} rounded`}>Save Trailer</button>
                </div>
              </div>
            )}

            <div className="grid md:grid-cols-2 gap-3">
              {trailers.map((tr) => (
                <div key={tr.id} className={cardItemClass}>
                  <div className="font-semibold text-base tracking-tight text-gray-900">{tr.profile_name}</div>
                  <div className={`text-xs ${mutedTextClass} mt-0.5 mb-2`}>
                    {tr.trailer_type || 'Trailer'}
                  </div>

                  <div className="flex flex-wrap gap-1.5 mb-2">
                    <span className={metricChipClass}>
                      {tr.overall_length_ft
                        ? formatDimensionDisplay(Number(tr.overall_length_ft))
                        : '?'}{' '}
                      long
                    </span>
                    <span className={metricChipMutedClass}>{tr.num_axles || 2} axles</span>
                    {tr.has_lift_axle ? (
                      <span className={metricChipMutedClass}>Lift axle</span>
                    ) : null}
                    {tr.is_extendable ? (
                      <span className={metricChipMutedClass}>
                        Extendable{tr.extendable_extra_ft ? ` +${tr.extendable_extra_ft} ft` : ''}
                      </span>
                    ) : null}
                  </div>

                  <div className={`${bodyTextClass} text-xs space-y-0.5`}>
                    <div className={fieldHintTinyClass}>
                      {formatAxleGroupSummaryLine(
                        assignAxleGroups(null, [
                          { num_axles: tr.num_axles || 2, trailer_type: tr.trailer_type },
                        ])
                      )}
                    </div>
                    <div>
                      {isRearPinTrailerType(tr.trailer_type) ? (
                        <>Pin / nose: {tr.kingpin_distance_from_front_in || '—'} in · Pin→axle: {tr.kingpin_to_first_axle_in || '—'} in</>
                      ) : (
                        <>Kingpin: {tr.kingpin_distance_from_front_in || '—'} in · KP→axle: {tr.kingpin_to_first_axle_in || '—'} in</>
                      )}
                    </div>
                    {[tr.year, tr.make, tr.model].some(Boolean) && (
                      <div>
                        {[tr.year, tr.make, tr.model].filter(Boolean).join(' ')}
                      </div>
                    )}
                    {formatLicensePlateDisplay(tr.license_plate, tr.license_plate_state) && (
                      <div>Plate: {formatLicensePlateDisplay(tr.license_plate, tr.license_plate_state)}</div>
                    )}
                    {tr.vin && <div>VIN: {tr.vin}</div>}
                    {tr.empty_weight_lbs ? (
                      <div>Empty: {Number(tr.empty_weight_lbs).toLocaleString()} lbs</div>
                    ) : null}
                    {(tr.width_ft || tr.deck_height_ft) ? (
                      <div>
                        {tr.width_ft ? <>Width: {formatDimensionDisplay(Number(tr.width_ft))}</> : null}
                        {tr.width_ft && tr.deck_height_ft ? ' · ' : null}
                        {tr.deck_height_ft ? <>Deck: {formatDimensionDisplay(Number(tr.deck_height_ft))}</> : null}
                      </div>
                    ) : null}
                  </div>

                  {/* Compact graphic preview - restored to bottom centered */}
                  <div className="mt-2 flex justify-center">
                    <VehicleDiagram
                      tractor={null}
                      trailers={[tr]}
                      compact
                      height={38}
                      className="w-[95%] max-w-[165px]"
                    />
                  </div>

                  {!isServiceModeReadOnly && (
                    <div className="mt-3 flex gap-2 text-xs">
                      <button onClick={() => setEditingTrailer(tr)} className="text-emerald-700 hover:underline">Edit</button>
                      <button onClick={() => deleteTrailer(tr.id)} className="text-red-600 hover:underline">Delete</button>
                    </div>
                  )}
                </div>
              ))}
              {trailers.length === 0 && <div className={`text-sm ${mutedTextClass}`}>No trailers saved. Create your first one.</div>}
            </div>
          </div>
        )}

        {/* SAVED RIGS TAB */}
        {activeTab === 'rigs' && (
          <div>
            <div className="flex justify-between mb-3 items-center">
              <div className="font-semibold">{rigs.length === 0 ? 'Rigs' : `Saved Rig Configurations (${rigs.length}) — ready to use in analyses`}</div>
              {!isServiceModeReadOnly && (
                <button
                  onClick={() => {
                    setHasChosenTab(true)
                    setRigBuilderOpen(true)
                  }}
                  className={buttonSecondaryClass}
                >
                  {rigBuilderOpen ? 'Building…' : '+ Build New Rig'}
                </button>
              )}
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              {sortRigsForDisplay(rigs).map((rig) => {
                const tr = tractors.find((t) => t.id === rig.tractor_id)
                const rigTrailers = (rig.trailer_ids || [])
                  .map((id: string) => trailers.find((trr: Trailer) => trr.id === id))
                  .filter(Boolean) as Trailer[]
                const primaryTrailer = primaryTrailerDimensions(rigTrailers)
                const rigEmptyWt = computeRigEmptyWeightLbs(tr, rigTrailers)
                const tractorPlate = formatLicensePlateDisplay(tr?.license_plate, tr?.license_plate_state)
                const trailerPlate = formatLicensePlateDisplay(
                  primaryTrailer.licensePlate,
                  primaryTrailer.licensePlateState
                )
                const plateParts = [tractorPlate, trailerPlate].filter(Boolean)
                const vinParts = [tr?.vin, primaryTrailer.vin].filter(Boolean) as string[]
                return (
                  <div key={rig.id} className={cardPanelClass}>
                    <div className="flex justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <div className="font-semibold text-lg tracking-tight text-gray-900">{rig.rig_name}</div>
                          {rig.is_default && (
                            <span className="text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300">
                              Default
                            </span>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          <span className={metricChipClass}>
                            {rig.computed_total_length_ft
                              ? formatDimensionDisplay(Number(rig.computed_total_length_ft))
                              : '?'}{' '}
                            total
                          </span>
                          <span className={metricChipMutedClass}>
                            {rig.computed_total_axles || '?'} axles
                          </span>
                          {(rig.trailer_ids || []).length > 0 ? (
                            <span className={metricChipMutedClass}>
                              {(rig.trailer_ids || []).length} trailer
                              {(rig.trailer_ids || []).length === 1 ? '' : 's'}
                            </span>
                          ) : null}
                          {rigTrailers.some((t) => t.has_lift_axle) ? (
                            <span className={metricChipMutedClass}>Lift axle</span>
                          ) : null}
                        </div>
                        <div className={`${fieldHintTinyClass} mt-1.5`}>
                          {formatAxleGroupSummaryLine(assignAxleGroups(tr || null, rigTrailers))}
                        </div>
                      </div>
                      {!isServiceModeReadOnly && (
                        <button onClick={() => deleteRig(rig.id)} className="text-xs text-red-600 self-start shrink-0">Delete</button>
                      )}
                    </div>

                    <div className={`mt-3 text-sm ${bodyTextClass}`}>
                      <span className="font-medium text-gray-900">{tr?.profile_name || 'Unknown tractor'}</span>
                      {rigTrailers.length > 0 ? (
                        <span className={mutedTextClass}>
                          {' '}
                          + {rigTrailers.map((t) => t.profile_name).filter(Boolean).join(', ') || 'trailer'}
                        </span>
                      ) : null}
                    </div>

                    <div className={`${bodyTextClass} text-xs mt-2 space-y-0.5`}>
                      {plateParts.length > 0 ? (
                        <div>Plates: {plateParts.join(' / ')}</div>
                      ) : null}
                      {vinParts.length > 0 ? (
                        <div>VIN: {vinParts.join(' / ')}</div>
                      ) : null}
                      {rigEmptyWt ? (
                        <div>Empty: {rigEmptyWt.toLocaleString()} lbs</div>
                      ) : null}
                      {(primaryTrailer.widthFt || primaryTrailer.deckHeightFt) ? (
                        <div>
                          {primaryTrailer.widthFt
                            ? `Width ${formatDimensionDisplay(Number(primaryTrailer.widthFt))}`
                            : null}
                          {primaryTrailer.widthFt && primaryTrailer.deckHeightFt ? ' · ' : null}
                          {primaryTrailer.deckHeightFt
                            ? `Deck ${formatDimensionDisplay(Number(primaryTrailer.deckHeightFt))}`
                            : null}
                        </div>
                      ) : null}
                    </div>

                    {/* Compact graphic preview of the full rig */}
                    <div className="mt-2 flex justify-center">
                      <VehicleDiagram
                        tractor={tr || null}
                        trailers={rigTrailers}
                        compact
                        height={42}
                        className="w-[92%] max-w-[180px]"
                      />
                    </div>

                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      <button
                        onClick={() => loadRigIntoPermitAgent(rig)}
                        className={`${buttonSuccessClass} rounded-lg`}
                      >
                        New Permits
                      </button>
                      {!isServiceModeReadOnly && (
                        <button
                          onClick={() => loadRigIntoBuilder(rig)}
                          className={buttonSecondaryClass}
                        >
                          Edit
                        </button>
                      )}
                      {renderDefaultRigButton(rig)}
                    </div>
                  </div>
                )
              })}
              {rigs.length === 0 && !rigBuilderOpen && (
                <div className={`text-sm ${bodyTextClass} col-span-2 ${cardClass} space-y-3`}>
                  <p className="font-medium text-gray-900">No rigs yet</p>
                  {tractors.length === 0 ? (
                    <p className={mutedTextClass}>
                      Start with a <b>tractor</b> profile, then add a trailer and build your first rig.
                    </p>
                  ) : trailers.length === 0 ? (
                    <p className={mutedTextClass}>
                      You have a tractor — add a <b>trailer</b> next, then build the combination.
                    </p>
                  ) : (
                    <p className={mutedTextClass}>
                      Tractor and trailer are ready. Build your first combination for permit analysis.
                    </p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {tractors.length === 0 && (
                      <button type="button" onClick={() => { setHasChosenTab(true); setActiveTab('tractors') }} className={buttonPrimaryClass}>
                        Add tractor
                      </button>
                    )}
                    {tractors.length > 0 && trailers.length === 0 && (
                      <button type="button" onClick={() => { setHasChosenTab(true); setActiveTab('trailers') }} className={buttonPrimaryClass}>
                        Add trailer
                      </button>
                    )}
                    {tractors.length > 0 && trailers.length > 0 && !isServiceModeReadOnly && (
                      <button type="button" onClick={() => { setHasChosenTab(true); setRigBuilderOpen(true) }} className={buttonPrimaryClass}>
                        Build first rig
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Specialty tool — demoted for most carriers; useful for superloads / axle planning */}
        <a
          href="/axle-optimizer"
          className={`${cardClass} mt-10 mb-2 min-h-[44px] flex items-center justify-between gap-3 hover:bg-gray-50 focus-visible:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-300 transition-colors`}
        >
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-gray-900">Axle Group Optimizer</span>
              <span className="text-[10px] font-semibold uppercase tracking-wide rounded-full bg-gray-100 text-gray-600 px-2 py-0.5">
                Specialty
              </span>
            </div>
            <p className={`${mutedTextClass} text-xs mt-0.5`}>
              Optional tool for superloads and tight axle-group planning — most setups do not need this first.
            </p>
          </div>
          <span className="shrink-0 text-sm font-medium text-gray-900">Open →</span>
        </a>

        {/* Footer help */}
        <p className={`mt-4 text-xs ${mutedTextClass} text-center`}>
          Private to your account — accurate 5th-wheel / kingpin data improves OSOW predictions.
        </p>
      </main>
    </div>
  )
}
