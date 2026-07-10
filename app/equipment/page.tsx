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
  FUTURE_FEATURES,
} from '@/types/equipment'
import { formatDimensionDisplay, formatRigSummaryLine } from '@/lib/parse-dimension'
import { formatLicensePlateDisplay } from '@/lib/license-plate'
import { normalizeLicensePlateState } from '@/lib/us-states'
import DimensionInput from '@/components/DimensionInput'
import LicensePlateFields from '@/components/LicensePlateFields'

type Tab = 'tractors' | 'trailers' | 'builder' | 'saved'

/** Mobile-first contrast: stronger borders/text on small screens; softer from sm: up (matches permit-test / portal-assist). */
const fieldControlClass =
  'border border-gray-500 sm:border-gray-300 text-gray-900 placeholder:text-gray-500 bg-white'
const inputClass = `${fieldControlClass} rounded p-1.5 w-full text-sm`
const inputMtClass = `${inputClass} mt-0.5`
const selectClass = `${fieldControlClass} rounded-xl p-3 text-sm w-full`
const textareaClass = `${fieldControlClass} rounded-xl p-2 text-sm`
const buttonSecondaryClass =
  'border border-gray-500 sm:border-gray-300 text-gray-900 rounded-lg text-sm hover:bg-gray-50 disabled:opacity-50'
const buttonPrimaryClass = 'bg-black text-white rounded-lg text-sm hover:bg-gray-900'
const buttonSuccessClass =
  'bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-medium disabled:bg-gray-500 disabled:text-white'
const fieldLabelTinyClass = 'text-[11px] text-gray-600 sm:text-gray-500'
const fieldLabelSectionClass = 'block text-xs font-semibold text-gray-600 sm:text-gray-500 mb-1'
const fieldLabelMediumClass = 'text-xs font-medium text-gray-600 sm:text-gray-500'
const fieldHintTinyClass = 'text-[10px] text-gray-600 sm:text-gray-500'
const mutedTextClass = 'text-gray-600 sm:text-gray-500'
const bodyTextClass = 'text-gray-700 sm:text-gray-600'
const dividerBorderClass = 'border-gray-300 sm:border-gray-200'
const checkboxClass = 'h-4 w-4 rounded accent-emerald-700 border-gray-500 sm:border-gray-300'
const editorShellClass = 'mb-6 bg-white border border-emerald-300 sm:border-emerald-200 rounded-2xl p-5'
const cardClass = 'bg-white border border-gray-300 sm:border-gray-200 rounded-2xl p-6'
const cardCompactClass = 'bg-white border border-gray-300 sm:border-gray-200 rounded-xl p-3 text-sm'
const cardItemClass = 'bg-white border border-gray-300 sm:border-gray-200 rounded-xl p-4 text-sm'
const cardPanelClass = 'bg-white border border-gray-300 sm:border-gray-200 rounded-2xl p-5'

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

  const [activeTab, setActiveTab] = useState<Tab>('saved')

  // Data
  const [tractors, setTractors] = useState<Tractor[]>([])
  const [trailers, setTrailers] = useState<Trailer[]>([])
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
  function normalizeAxleSpacings(input: any): number[] {
    if (input == null) return []
    if (typeof input === 'string') {
      return input
        .split(',')
        .map((s: string) => parseFloat(s.trim()))
        .filter((n: number) => Number.isFinite(n) && n > 0)
    }
    if (Array.isArray(input)) {
      return input
        .map((x: any) => parseFloat(String(x).trim()))
        .filter((n: number) => Number.isFinite(n) && n > 0)
    }
    return []
  }

  /**
   * Single source of truth for all profile/rig name sanitization (tractor, trailer, rig_name).
   * Used by saveTractor, saveTrailer, and saveCurrentRig. Always returns a trimmed string.
   */
  function safeProfileName(input: any): string {
    return ((input ?? '') + '').trim()
  }

  function axleSpacingForDb(input: any): string[] | null {
    const nums = normalizeAxleSpacings(input)
    if (nums.length === 0) return null
    // Return native JS string[] (or number[] also works) so the Supabase client correctly
    // serializes to the Postgres text[] column (post-011 migration). Never emit a raw
    // '{...}' literal string — the driver expects the array value for array columns.
    return nums.map((n) => String(n))
  }

  function getAxleSpacingLabel(isTractor: boolean, numAxles: number | null | undefined, idx: number) {
    const n = Math.max(isTractor ? 3 : 2, Number(numAxles) || (isTractor ? 3 : 2))
    if (!isTractor) {
      return {
        main: `${idx + 1}-${idx + 2}`,
        desc: `Between axles ${idx + 1} & ${idx + 2}`
      }
    }
    // Tractor: full consecutive gaps for all axles (steer + drives)
    if (idx === 0) {
      return {
        main: '1-2',
        desc: 'Steer to 1st Drive Axle'
      }
    }
    const d1 = idx   // drive index for the "from"
    const d2 = idx + 1
    return {
      main: `${idx + 1}-${idx + 2}`,
      desc: `Between Drive Axles ${d1}–${d2}`
    }
  }

  function resizeAxleSpacings(current: any, newNum: number | null, isTractor: boolean): number[] {
    const nums = normalizeAxleSpacings(current)
    const n = Math.max(isTractor ? 2 : 1, Number(newNum) || (isTractor ? 3 : 2))
    const expected = Math.max(0, n - 1)  // full inter-axle gaps for both (tractor now includes 1-2 steer-to-drive)
    let out = nums.slice(0, expected)
    const def = isTractor ? 48 : 49
    while (out.length < expected) {
      out.push(out.length > 0 ? out[out.length - 1] : def)
    }
    return out
  }

  function computeWheelbase(spacings: any): number | null {
    const s = normalizeAxleSpacings(spacings)
    if (s.length < 1) return null
    const s12 = s[0] || 0
    const s23 = s[1] || 0
    const wb = s12 + (s23 / 2)
    return wb > 0 ? Math.round(wb * 10) / 10 : null
  }

  // Dynamic, clearly-labeled axle spacing inputs.
  // For tractors: (num_axles - 1) fields starting with 1-2 (Steer to 1st Drive).
  // For trailers: (num_axles - 1) fields.
  // Wheelbase for tractor is auto-computed in real time from the first two spacings.
  function AxleSpacingsInputs({
    numAxles,
    spacings,
    onChangeSpacing,
    isTractor,
  }: {
    numAxles: number | null | undefined
    spacings: any
    onChangeSpacing: (idx: number, value: number | null) => void
    isTractor: boolean
  }) {
    const n = Number(numAxles) || (isTractor ? 3 : 2)
    const expected = Math.max(0, n - 1)
    if (expected <= 0) return null
    const arr = normalizeAxleSpacings(spacings)
    return (
      <div className="md:col-span-3">
        <label className={fieldLabelTinyClass}>Axle Spacings (inches)</label>
        <div className="mt-1 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
          {Array.from({ length: expected }).map((_, idx) => {
            const { main, desc } = getAxleSpacingLabel(isTractor, n, idx)
            const v = arr[idx]
            return (
              <div key={idx}>
                <div className={`${fieldHintTinyClass} leading-tight`}>{main}</div>
                <div className={`${fieldHintTinyClass} leading-tight mb-0.5`}>{desc}</div>
                <input
                  type="number"
                  value={v && v > 0 ? v : ''}
                  onChange={(e) => {
                    const val = e.target.value.trim() === '' ? null : parseFloat(e.target.value)
                    onChangeSpacing(idx, val && Number.isFinite(val) && val > 0 ? val : null)
                  }}
                  placeholder={String(isTractor ? 48 : 49)}
                  className={inputClass}
                />
              </div>
            )
          })}
        </div>
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
    const structured = {
      _v: 1,
      type: 'tractor',
      overall_length_ft: payloadData.overall_length_ft ?? null,
      num_axles: payloadData.num_axles ?? null,
      steer_axle_setback_in: payloadData.steer_axle_setback_in ?? null,
      wheelbase_in: payloadData.wheelbase_in ?? null,
      axle_spacings: payloadData.axle_spacings ?? null,
      fifth_wheel_from_rear_in: payloadData.fifth_wheel_from_rear_in ?? null,
      unit_number: payloadData.unit_number ?? null,
      license_plate: payloadData.license_plate ?? null,
      license_plate_state: payloadData.license_plate_state ?? null,
      vin: payloadData.vin ?? null,
      empty_weight_lbs: payloadData.empty_weight_lbs ?? null,
      year: payloadData.year ?? null,
      make: payloadData.make ?? null,
      model: payloadData.model ?? null,
      _notes: plainNotes,
    }

    const organizationId = equipmentOrganizationIdForSave(ownOrganizationId)

    const dbPayload: any = {
      user_id: user.id,
      type: 'tractor',
      name: safeProfileName(payloadData.profile_name),
      profile_name: safeProfileName(payloadData.profile_name),
      unit_number: payloadData.unit_number || null,
      license_plate: payloadData.license_plate || null,
      license_plate_state: payloadData.license_plate_state || null,
      vin: payloadData.vin || null,
      year: payloadData.year || null,
      make: payloadData.make || null,
      model: payloadData.model || null,
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

    const plainNotes = payloadData.notes || ''
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
      trailer_type: payloadData.trailer_type ?? null,
      license_plate: payloadData.license_plate ?? null,
      license_plate_state: payloadData.license_plate_state ?? null,
      vin: payloadData.vin ?? null,
      empty_weight_lbs: payloadData.empty_weight_lbs ?? null,
      width_ft: payloadData.width_ft ?? null,
      deck_height_ft: payloadData.deck_height_ft ?? null,
      make: payloadData.make ?? null,
      model: payloadData.model ?? null,
      year: payloadData.year ?? null,
      _notes: plainNotes,
    }

    const organizationId = equipmentOrganizationIdForSave(ownOrganizationId)

    const dbPayload: any = {
      user_id: user.id,
      type: 'trailer',
      name: safeProfileName(payloadData.profile_name),
      profile_name: safeProfileName(payloadData.profile_name),
      make: payloadData.make || payloadData.trailer_type || null,
      license_plate: payloadData.license_plate || null,
      license_plate_state: payloadData.license_plate_state || null,
      model: payloadData.model || null,
      year: payloadData.year || null,
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
    setActiveTab('saved')
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
    setActiveTab('builder')
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
        className={`px-4 py-1.5 ${buttonSecondaryClass} ${className}`}
      >
        {busy ? 'Saving…' : 'Make Default Rig'}
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

      <main className="max-w-7xl mx-auto px-6 py-8">
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
        {/* Header */}
        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-gray-900">Equipment &amp; Rig Builder</h1>
            <p className={`${bodyTextClass} mt-1 text-[15px]`}>
              Build and save accurate tractor + trailer profiles. Select combinations for precise OSOW calculations and graphical previews.
            </p>
          </div>
          <div className="flex gap-3">
            <a href="/dashboard" className={`px-4 py-2 ${buttonSecondaryClass}`}>← Dashboard</a>
            <a href="/permit-test" className={`px-4 py-2 ${buttonPrimaryClass}`}>New Analysis →</a>
          </div>
        </div>

        {/* Tabs */}
        <div className={`flex gap-1 border-b ${dividerBorderClass} mb-6`}>
          {([
            { k: 'saved', label: 'Saved Rigs' },
            { k: 'tractors', label: 'Tractors' },
            { k: 'trailers', label: 'Trailers' },
            { k: 'builder', label: 'Rig Builder' },
          ] as const).map((t) => (
            <button
              key={t.k}
              onClick={() => setActiveTab(t.k)}
              className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-all ${
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
        {activeTab === 'builder' && (
          <div className="space-y-6">
            <div className={cardClass}>
              <h2 className="font-semibold text-xl tracking-tight mb-1">Build a Combination</h2>
              <p className={`text-sm ${bodyTextClass} mb-4`}>Pick one tractor + one or more trailers. We auto-calculate overall length and axle layout from 5th-wheel / kingpin alignment.</p>

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
                      <button onClick={startNewTrailer} className={`px-4 py-2 ${buttonSuccessClass} rounded-xl`}>+ New Trailer</button>
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
                      </div>
                    )
                  })}
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
                  <div className={`border border-dashed border-gray-400 sm:border-gray-300 rounded-2xl p-8 text-center ${mutedTextClass} bg-white`}>
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
                    <button onClick={clearBuilder} className={`px-5 py-3 ${buttonSecondaryClass} rounded-xl`}>Clear</button>
                    <button
                      onClick={saveCurrentRig}
                      disabled={!selectedTractorId || selectedTrailerIds.length === 0}
                      className={`px-8 py-3 ${buttonSuccessClass} font-semibold rounded-xl`}
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

            {/* Future placeholders */}
            <div className={`text-[11px] ${mutedTextClass} bg-white border border-gray-300 sm:border-gray-200 rounded-xl p-3`}>
              <strong>Coming soon:</strong> {FUTURE_FEATURES.vinDecoder} • {FUTURE_FEATURES.photos} • {FUTURE_FEATURES.bolImport}
            </div>
          </div>
        )}

        {/* TRACTORS TAB */}
        {activeTab === 'tractors' && (
          <div>
            <div className="flex justify-between items-center mb-3">
              <div className="font-semibold">My Tractors ({tractors.length})</div>
              {!isServiceModeReadOnly && (
                <button onClick={startNewTractor} className={`px-4 py-2 ${buttonPrimaryClass}`}>+ New Tractor Profile</button>
              )}
            </div>

            {editingTractor && !isServiceModeReadOnly && (
              <div className={editorShellClass}>
                <div className="font-semibold mb-3">Tractor Profile</div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
                  {[
                    ['Profile Name *', 'profile_name', 'text'],
                    ['Overall Length (ft)', 'overall_length_ft', 'number'],
                    ['# Axles (3–6)', 'num_axles', 'number'],
                    ['Steer Axle Setback (in)', 'steer_axle_setback_in', 'number'],
                    ['Wheelbase (auto-calculated, in)', 'wheelbase_in', 'number'],
                    ['5th Wheel from Rear (in)', 'fifth_wheel_from_rear_in', 'number'],
                    ['Unit #', 'unit_number', 'text'],
                    ['Tractor VIN', 'vin', 'text'],
                    ['Empty Weight (lbs)', 'empty_weight_lbs', 'number'],
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
                          className={inputMtClass}
                        />
                      )}
                    </div>
                  ))}
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
                      const curr = normalizeAxleSpacings(editingTractor.axle_spacings)
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
                  <button onClick={() => setEditingTractor(null)} className={`px-4 py-2 ${buttonSecondaryClass} rounded`}>Cancel</button>
                  <button onClick={saveTractor} className={`px-5 py-2 ${buttonSuccessClass} rounded`}>Save Tractor</button>
                </div>
              </div>
            )}

            <div className="grid md:grid-cols-2 gap-3">
              {tractors.map((t) => (
                <div key={t.id} className={`${cardCompactClass} flex flex-col`}>
                  <div className="font-semibold text-base">{t.profile_name}</div>
                  <div className={`${mutedTextClass} text-xs mb-1`}>{t.unit_number ? `#${t.unit_number} • ` : ''}{t.make} {t.model} {t.year || ''}</div>

                  <div className={`text-[11px] ${bodyTextClass} space-y-0.5`}>
                    <div>Length: <b>{t.overall_length_ft || '?'} ft</b> • Axles: <b>{t.num_axles || 3}</b></div>
                    <div>5th: {t.fifth_wheel_from_rear_in || '?'} in • WB: {t.wheelbase_in || '?'} in</div>
                    {formatLicensePlateDisplay(t.license_plate, t.license_plate_state) && (
                      <div>Plate: <span className="font-mono">{formatLicensePlateDisplay(t.license_plate, t.license_plate_state)}</span></div>
                    )}
                    {t.vin && <div>VIN: <span className="font-mono">{t.vin}</span></div>}
                    {t.empty_weight_lbs ? (
                      <div>Empty: <b>{Number(t.empty_weight_lbs).toLocaleString()} lbs</b></div>
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
                <button onClick={startNewTrailer} className={`px-4 py-2 ${buttonPrimaryClass}`}>+ New Trailer Profile</button>
              )}
            </div>

            {editingTrailer && !isServiceModeReadOnly && (
              <div className={editorShellClass}>
                <div className="font-semibold mb-3">Trailer Profile</div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
                  {[
                    ['Profile Name *', 'profile_name', 'text'],
                    ['Overall Length (ft)', 'overall_length_ft', 'number'],
                    ['Kingpin from Front (in)', 'kingpin_distance_from_front_in', 'number'],
                    ['# Axles', 'num_axles', 'number'],
                    ['Kingpin → 1st Axle (in)', 'kingpin_to_first_axle_in', 'number'],
                    ['Trailer VIN', 'vin', 'text'],
                    ['Empty Weight (lbs)', 'empty_weight_lbs', 'number'],
                    ['Extendable Extra (ft)', 'extendable_extra_ft', 'number'],
                  ].map(([label, key, type]) => (
                    <div key={key}>
                      <label className={fieldLabelTinyClass}>{label}</label>
                      <input
                        type={type as any}
                        value={(editingTrailer as any)[key] ?? ''}
                        onChange={(e) => {
                        const v = type === 'number' ? parseFloat(e.target.value) || null : e.target.value
                        if (key === 'num_axles') {
                          const numVal = Number(v) || null
                          const resized = resizeAxleSpacings(editingTrailer.axle_spacings, numVal, false)
                          setEditingTrailer({ ...editingTrailer, num_axles: numVal, axle_spacings: resized })
                        } else {
                          setEditingTrailer({ ...editingTrailer, [key]: v })
                        }
                      }}
                        className={inputMtClass}
                      />
                    </div>
                  ))}
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
                  <div>
                    <label className={fieldLabelTinyClass}>Trailer Type</label>
                    <input value={editingTrailer.trailer_type || ''} onChange={(e) => setEditingTrailer({ ...editingTrailer, trailer_type: e.target.value })} className={inputMtClass} />
                  </div>
                  <div className="flex items-center gap-4 pt-5 text-sm">
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
                      const curr = normalizeAxleSpacings(editingTrailer.axle_spacings)
                      const next = [...curr]
                      next[idx] = val ?? 0
                      setEditingTrailer({ ...editingTrailer, axle_spacings: next })
                    }}
                    isTractor={false}
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
                  <button onClick={() => setEditingTrailer(null)} className={`px-4 py-2 ${buttonSecondaryClass} rounded`}>Cancel</button>
                  <button onClick={saveTrailer} className={`px-5 py-2 ${buttonSuccessClass} rounded`}>Save Trailer</button>
                </div>
              </div>
            )}

            <div className="grid md:grid-cols-2 gap-3">
              {trailers.map((tr) => (
                <div key={tr.id} className={cardItemClass}>
                  <div className="font-semibold">{tr.profile_name}</div>
                  <div className={`text-xs ${mutedTextClass}`}>{tr.trailer_type || 'Trailer'} • {tr.overall_length_ft || '?'} ft • {tr.num_axles || 2} axles</div>
                  <div className={`text-[12px] mt-1 ${bodyTextClass} space-y-0.5`}>
                    <div>
                      Kingpin from nose: {tr.kingpin_distance_from_front_in || '?'} in • KP to axle: {tr.kingpin_to_first_axle_in || '?'} in
                      {tr.has_lift_axle && ' • Lift axle'} {tr.is_extendable && ` • Extendable +${tr.extendable_extra_ft || 0} ft`}
                    </div>
                    {formatLicensePlateDisplay(tr.license_plate, tr.license_plate_state) && (
                      <div>Plate: <span className="font-mono">{formatLicensePlateDisplay(tr.license_plate, tr.license_plate_state)}</span></div>
                    )}
                    {tr.vin && <div>VIN: <span className="font-mono">{tr.vin}</span></div>}
                    {tr.empty_weight_lbs ? <div>Empty: <b>{Number(tr.empty_weight_lbs).toLocaleString()} lbs</b></div> : null}
                    {(tr.width_ft || tr.deck_height_ft) ? (
                      <div>
                        {tr.width_ft ? <>Width: <b>{formatDimensionDisplay(Number(tr.width_ft))}</b></> : null}
                        {tr.width_ft && tr.deck_height_ft ? ' • ' : null}
                        {tr.deck_height_ft ? <>Deck: <b>{formatDimensionDisplay(Number(tr.deck_height_ft))}</b></> : null}
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
        {activeTab === 'saved' && (
          <div>
            <div className="flex justify-between mb-3 items-center">
              <div className="font-semibold">Saved Rig Configurations ({rigs.length}) — ready to use in analyses</div>
              {!isServiceModeReadOnly && (
                <button onClick={() => setActiveTab('builder')} className={`text-sm px-3 py-1.5 ${buttonSecondaryClass}`}>+ Build New Rig</button>
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
                const summaryLine = formatRigSummaryLine({
                  name: rig.rig_name,
                  lengthFt: rig.computed_total_length_ft,
                  widthFt: primaryTrailer.widthFt,
                  heightFt: primaryTrailer.deckHeightFt,
                  weightLbs: rigEmptyWt,
                })
                return (
                  <div key={rig.id} className={cardPanelClass}>
                    <div className="flex justify-between">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <div className="font-semibold text-lg tracking-tight">{rig.rig_name}</div>
                          {rig.is_default && (
                            <span className="text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300">
                              Default
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-emerald-700">{rig.computed_total_length_ft?.toFixed(1) || '?'} ft total • {rig.computed_total_axles || '?'} axles</div>
                      </div>
                      {!isServiceModeReadOnly && (
                        <button onClick={() => deleteRig(rig.id)} className="text-xs text-red-600 self-start">Delete</button>
                      )}
                    </div>

                    <div className="mt-2 text-[11px] font-mono text-gray-900 bg-gray-50 border border-gray-300 sm:border-gray-200 rounded-lg px-2 py-1.5">
                      {summaryLine}
                    </div>

                    <div className={`mt-3 text-sm ${bodyTextClass}`}>
                      Tractor: <span className="font-medium text-gray-900">{tr?.profile_name || 'Unknown'}</span><br />
                      Trailers: {(rig.trailer_ids || []).length}
                    </div>

                    <div className={`mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] ${bodyTextClass}`}>
                      <div>Tractor plate: <span className="font-mono text-gray-900">{formatLicensePlateDisplay(tr?.license_plate, tr?.license_plate_state) || '—'}</span></div>
                      <div>Trailer plate: <span className="font-mono text-gray-900">{formatLicensePlateDisplay(primaryTrailer.licensePlate, primaryTrailer.licensePlateState) || '—'}</span></div>
                      <div>Tractor VIN: <span className="font-mono text-gray-900">{tr?.vin || '—'}</span></div>
                      <div>Trailer VIN: <span className="font-mono text-gray-900">{primaryTrailer.vin || '—'}</span></div>
                      <div>Tractor empty: <b>{tr?.empty_weight_lbs ? `${Number(tr.empty_weight_lbs).toLocaleString()} lbs` : '—'}</b></div>
                      <div>Trailer empty: <b>{primaryTrailer.emptyWeightLbs ? `${Number(primaryTrailer.emptyWeightLbs).toLocaleString()} lbs` : '—'}</b></div>
                      <div>Rig empty: <b>{rigEmptyWt ? `${rigEmptyWt.toLocaleString()} lbs` : '—'}</b></div>
                      <div>Trailer width: <b>{primaryTrailer.widthFt ? formatDimensionDisplay(Number(primaryTrailer.widthFt)) : '—'}</b></div>
                      <div>Deck height: <b>{primaryTrailer.deckHeightFt ? formatDimensionDisplay(Number(primaryTrailer.deckHeightFt)) : '—'}</b></div>
                      <div>Rig length: <b>{rig.computed_total_length_ft ? `${Number(rig.computed_total_length_ft).toFixed(1)} ft` : '—'}</b></div>
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
                        className={`text-sm px-4 py-1.5 ${buttonSuccessClass} rounded-lg`}
                      >
                        Load into Permit Agent
                      </button>
                      {!isServiceModeReadOnly && (
                        <button
                          onClick={() => loadRigIntoBuilder(rig)}
                          className={`text-sm px-4 py-1.5 ${buttonSecondaryClass}`}
                        >
                          Edit in Builder
                        </button>
                      )}
                      {renderDefaultRigButton(rig)}
                    </div>
                  </div>
                )
              })}
              {rigs.length === 0 && (
                <div className={`text-sm ${mutedTextClass} col-span-2 ${cardClass}`}>
                  No saved rigs yet. You&apos;re on <b>Saved Rigs</b> — open the <b>Rig Builder</b> tab to create your first tractor + trailer combination.
                </div>
              )}
            </div>
          </div>
        )}

        {/* Footer help */}
        <p className={`mt-10 text-[11px] ${mutedTextClass} text-center`}>
          All measurements are stored privately for your account only. Accurate 5th-wheel / kingpin data produces better OSOW length and axle-group predictions.
        </p>
      </main>
    </div>
  )
}
