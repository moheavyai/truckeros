'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import AppHeader from '@/components/AppHeader'
import VehicleDiagram from '@/components/VehicleDiagram'
import TractorGraphic from '@/components/TractorGraphic'
import type { Tractor, Trailer, RigConfiguration } from '@/types/equipment'
import { computeRigDimensions, FUTURE_FEATURES } from '@/types/equipment'

type Tab = 'tractors' | 'trailers' | 'builder' | 'saved'

export default function EquipmentPage() {
  const [user, setUser] = useState<any>(null)
  const [loadingAuth, setLoadingAuth] = useState(true)
  const router = useRouter()

  const [activeTab, setActiveTab] = useState<Tab>('builder')

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

  // Derived for builder
  const currentTractor = tractors.find((t) => t.id === selectedTractorId) || null
  const currentTrailers = selectedTrailerIds
    .map((id) => trailers.find((tr) => tr.id === id))
    .filter(Boolean) as Trailer[]

  const dims = computeRigDimensions(currentTractor, currentTrailers)

  // Auth guard (consistent with dashboard + permit-test)
  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) {
        router.push('/login')
      } else {
        setUser(session.user)
      }
      setLoadingAuth(false)
    })
    const { data: listener } = supabase.auth.onAuthStateChange((_, session) => {
      if (!session) router.push('/login')
      else setUser(session.user)
    })
    return () => listener.subscription.unsubscribe()
  }, [router])

  // Load all equipment on auth
  useEffect(() => {
    if (!loadingAuth && user) {
      loadAll()
    }
  }, [loadingAuth, user])

  async function loadAll() {
    setLoading(true)
    const supabase = createClient()
    try {
      const { data, error } = await supabase
        .from('equipment_profiles')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })

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
          vin: d.meta.vin ?? d.row.vin ?? null,
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
        created_at: d.row.created_at,
        updated_at: d.row.updated_at,
      })) as RigConfiguration[]

      // Load proper rig compositions from the dedicated rig_configurations table
      // (new saves from Rig Builder; avoids the type CHECK constraint entirely).
      // tractor_id / trailer_ids currently reference equipment_profiles rows (active source of truth).
      // Will become FKs into dedicated tables after the profile migration.
      let properRigs: RigConfiguration[] = []
      try {
        const { data: rigRows, error: rigErr } = await supabase
          .from('rig_configurations')
          .select('*')
          .eq('user_id', user.id)
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
            created_at: r.created_at,
            updated_at: r.updated_at,
          })) as RigConfiguration[]
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
        <label className="text-[11px] text-gray-600">Axle Spacings (inches)</label>
        <div className="mt-1 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
          {Array.from({ length: expected }).map((_, idx) => {
            const { main, desc } = getAxleSpacingLabel(isTractor, n, idx)
            const v = arr[idx]
            return (
              <div key={idx}>
                <div className="text-[10px] text-gray-600 leading-tight">{main}</div>
                <div className="text-[9px] text-gray-500 leading-tight mb-0.5">{desc}</div>
                <input
                  type="number"
                  value={v && v > 0 ? v : ''}
                  onChange={(e) => {
                    const val = e.target.value.trim() === '' ? null : parseFloat(e.target.value)
                    onChangeSpacing(idx, val && Number.isFinite(val) && val > 0 ? val : null)
                  }}
                  placeholder={String(isTractor ? 48 : 49)}
                  className="border p-1.5 rounded w-full text-sm"
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
    setEditingTractor({
      profile_name: '',
      overall_length_ft: 28,
      num_axles: 3,
      steer_axle_setback_in: 36,
      wheelbase_in: 220,
      axle_spacings: [220, 48],
      fifth_wheel_from_rear_in: 24,
      unit_number: '',
      make: '',
      model: '',
    })
    setActiveTab('tractors')
  }

  async function saveTractor() {
    if (!safeProfileName(editingTractor?.profile_name)) {
      alert('Profile name is required')
      return
    }
    const supabase = createClient()

    let payloadData: any = { ...editingTractor }
    // Use the single robust normalizer (handles string/ array /null /garbage / all the examples in task)
    payloadData.axle_spacings = normalizeAxleSpacings(payloadData.axle_spacings)

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
      vin: payloadData.vin ?? null,
      year: payloadData.year ?? null,
      make: payloadData.make ?? null,
      model: payloadData.model ?? null,
      _notes: plainNotes,
    }

    const dbPayload: any = {
      user_id: user.id,
      type: 'tractor',
      name: safeProfileName(payloadData.profile_name),
      profile_name: safeProfileName(payloadData.profile_name),
      unit_number: payloadData.unit_number || null,
      vin: payloadData.vin || null,
      year: payloadData.year || null,
      make: payloadData.make || null,
      model: payloadData.model || null,
      axles: payloadData.num_axles || null,
      axle_spacing: axleSpacingForDb(payloadData.axle_spacings),
      notes: `RIGBUILDER:v1:${JSON.stringify(structured)}`,
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
    if (!safeProfileName(editingTrailer?.profile_name)) {
      alert('Profile name is required')
      return
    }
    const supabase = createClient()

    let payloadData: any = { ...editingTrailer }
    // Use the single robust normalizer (handles string/ array /null /garbage / all the examples in task)
    payloadData.axle_spacings = normalizeAxleSpacings(payloadData.axle_spacings)

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
      make: payloadData.make ?? null,
      model: payloadData.model ?? null,
      year: payloadData.year ?? null,
      _notes: plainNotes,
    }

    const dbPayload: any = {
      user_id: user.id,
      type: 'trailer',
      name: safeProfileName(payloadData.profile_name),
      profile_name: safeProfileName(payloadData.profile_name),
      make: payloadData.make || payloadData.trailer_type || null,
      model: payloadData.model || null,
      year: payloadData.year || null,
      length_ft: payloadData.overall_length_ft || null,
      axles: payloadData.num_axles || null,
      axle_spacing: axleSpacingForDb(payloadData.axle_spacings),
      notes: `RIGBUILDER:v1:${JSON.stringify(structured)}`,
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
  }

  async function saveCurrentRig() {
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

    const { error } = await supabase.from('rig_configurations').insert({
      user_id: user.id,
      rig_name: name,
      name: name,
      tractor_id: selectedTractorId,
      trailer_ids: selectedTrailerIds,
      computed_total_length_ft: dims.totalLengthFt,
      computed_total_axles: dims.totalAxles,
      computed_kingpin_to_last_axle_ft: kingpinToLastAxleFt,
      notes: builderNote.trim() || null,
    })
    if (error) {
      alert('Failed to save rig: ' + error.message)
      return
    }
    alert(`Saved rig "${name}"`)
    await loadAll()
    setActiveTab('saved')
    clearBuilder()
  }

  async function deleteRig(id: string) {
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
    setActiveTab('builder')
    window.scrollTo({ top: 120, behavior: 'smooth' })
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
      <AppHeader user={user} activePage="equipment" />

      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-gray-900">Equipment &amp; Rig Builder</h1>
            <p className="text-gray-600 mt-1 text-[15px]">
              Build and save accurate tractor + trailer profiles. Select combinations for precise OSOW calculations and graphical previews.
            </p>
          </div>
          <div className="flex gap-3">
            <a href="/dashboard" className="px-4 py-2 text-sm border rounded-lg hover:bg-white">← Dashboard</a>
            <a href="/permit-test" className="px-4 py-2 text-sm bg-black text-white rounded-lg hover:bg-gray-900">New Analysis →</a>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b mb-6">
          {([
            { k: 'builder', label: 'Rig Builder' },
            { k: 'tractors', label: 'Tractors' },
            { k: 'trailers', label: 'Trailers' },
            { k: 'saved', label: 'Saved Rigs' },
          ] as const).map((t) => (
            <button
              key={t.k}
              onClick={() => setActiveTab(t.k)}
              className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-all ${
                activeTab === t.k
                  ? 'border-emerald-600 text-emerald-700'
                  : 'border-transparent text-gray-600 hover:text-gray-900'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* RIG BUILDER TAB */}
        {activeTab === 'builder' && (
          <div className="space-y-6">
            <div className="bg-white border rounded-2xl p-6">
              <h2 className="font-semibold text-xl tracking-tight mb-1">Build a Combination</h2>
              <p className="text-sm text-gray-600 mb-4">Pick one tractor + one or more trailers. We auto-calculate overall length and axle layout from 5th-wheel / kingpin alignment.</p>

              <div className="grid md:grid-cols-2 gap-4 mb-4">
                {/* Tractor picker */}
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">TRACTOR / POWER UNIT</label>
                  <select
                    value={selectedTractorId}
                    onChange={(e) => setSelectedTractorId(e.target.value)}
                    className="w-full border border-gray-300 rounded-xl p-3 text-sm"
                  >
                    <option value="">— Select tractor —</option>
                    {tractors.map((t) => (
                      <option key={t.id} value={t.id}>{t.profile_name} {t.unit_number ? `(#${t.unit_number})` : ''} — {t.overall_length_ft || '?'} ft</option>
                    ))}
                  </select>
                  {tractors.length === 0 && <p className="text-xs text-amber-600 mt-1">No tractors yet. Add one in the Tractors tab.</p>}
                </div>

                {/* Trailer picker */}
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">ADD TRAILER(S)</label>
                  <div className="flex gap-2">
                    <select
                      onChange={(e) => { if (e.target.value) addTrailerToBuild(e.target.value); e.target.value = '' }}
                      className="flex-1 border border-gray-300 rounded-xl p-3 text-sm"
                    >
                      <option value="">— Select trailer to add —</option>
                      {trailers
                        .filter((tr) => !selectedTrailerIds.includes(tr.id))
                        .map((tr) => (
                          <option key={tr.id} value={tr.id}>{tr.profile_name} — {tr.overall_length_ft || '?'} ft</option>
                        ))}
                    </select>
                    <button onClick={startNewTrailer} className="px-4 py-2 bg-emerald-600 text-white rounded-xl text-sm font-medium">+ New Trailer</button>
                  </div>
                </div>
              </div>

              {/* Selected trailers chips */}
              {selectedTrailerIds.length > 0 && (
                <div className="mb-4">
                  <div className="text-xs font-semibold text-gray-600 mb-1">CURRENT COMBINATION ({selectedTrailerIds.length} trailer{selectedTrailerIds.length > 1 ? 's' : ''})</div>
                  <div className="flex flex-wrap gap-2">
                    {currentTrailers.map((tr, idx) => (
                      <div key={idx} className="inline-flex items-center gap-1.5 bg-emerald-50 border border-emerald-200 text-emerald-800 px-3 py-1 rounded-full text-sm">
                        {tr.profile_name}
                        <button onClick={() => removeTrailerFromBuild(idx)} className="text-emerald-600 hover:text-red-600 ml-1">×</button>
                      </div>
                    ))}
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
                        className="w-full max-w-[520px] border border-gray-200 rounded-2xl bg-white p-1"
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
                  <div className="border border-dashed rounded-2xl p-8 text-center text-gray-500 bg-white">
                    Select a tractor and/or one or more trailers above to see the live graphical preview and auto-calculated dimensions.
                  </div>
                );
              })()}

              {/* Save controls */}
              <div className="mt-5 grid md:grid-cols-[1fr,auto] gap-3 items-end">
                <div>
                  <label className="text-xs font-medium text-gray-600">Rig Name (saved for quick selection in analyses)</label>
                  <input
                    value={rigName}
                    onChange={(e) => setRigName(e.target.value)}
                    placeholder="e.g. KW T680 + 53' Flatbed"
                    className="mt-1 w-full border p-3 rounded-xl text-sm"
                  />
                  <textarea
                    value={builderNote}
                    onChange={(e) => setBuilderNote(e.target.value)}
                    placeholder="Notes (optional) — e.g. 'Steerable lift on trailer 2, used for bridge kits'"
                    className="mt-2 w-full border p-2 rounded-xl text-sm h-16"
                  />
                </div>
                <div className="flex gap-2">
                  <button onClick={clearBuilder} className="px-5 py-3 border rounded-xl text-sm">Clear</button>
                  <button
                    onClick={saveCurrentRig}
                    disabled={!selectedTractorId || selectedTrailerIds.length === 0}
                    className="px-8 py-3 bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-300 text-white font-semibold rounded-xl text-sm"
                  >
                    Save Rig Configuration
                  </button>
                </div>
              </div>
            </div>

            {/* Future placeholders */}
            <div className="text-[11px] text-gray-500 bg-white border rounded-xl p-3">
              <strong>Coming soon:</strong> {FUTURE_FEATURES.vinDecoder} • {FUTURE_FEATURES.photos} • {FUTURE_FEATURES.bolImport}
            </div>
          </div>
        )}

        {/* TRACTORS TAB */}
        {activeTab === 'tractors' && (
          <div>
            <div className="flex justify-between items-center mb-3">
              <div className="font-semibold">My Tractors ({tractors.length})</div>
              <button onClick={startNewTractor} className="px-4 py-2 bg-black text-white text-sm rounded-lg">+ New Tractor Profile</button>
            </div>

            {editingTractor && (
              <div className="mb-6 bg-white border border-emerald-200 rounded-2xl p-5">
                <div className="font-semibold mb-3">Tractor Profile</div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
                  {[
                    ['Profile Name *', 'profile_name', 'text'],
                    ['Overall Length (ft)', 'overall_length_ft', 'number'],
                    ['# Axles (3–6)', 'num_axles', 'number'],
                    ['Steer Axle Setback (in)', 'steer_axle_setback_in', 'number'],
                    ['Wheelbase (auto-calculated, in)', 'wheelbase_in', 'number'],
                    ['5th Wheel from Rear (in)', 'fifth_wheel_from_rear_in', 'number'],
                    ['Unit #', 'unit_number', 'text'],
                    ['Make', 'make', 'text'],
                    ['Model', 'model', 'text'],
                  ].map(([label, key, type]) => (
                    <div key={key}>
                      <label className="text-[11px] text-gray-600">{label}</label>
                      {key === 'wheelbase_in' ? (
                        <input
                          type="number"
                          value={computeWheelbase(editingTractor.axle_spacings) ?? (editingTractor as any)[key] ?? ''}
                          readOnly
                          className="border p-2 rounded w-full mt-0.5 bg-gray-100 text-gray-600 cursor-not-allowed"
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
                          className="border p-2 rounded w-full mt-0.5"
                        />
                      )}
                    </div>
                  ))}
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
                <div className="mt-3 pt-2 border-t">
                  <div className="text-[10px] text-gray-500 mb-1">Live preview</div>
                  <VehicleDiagram
                    tractor={editingTractor}
                    trailers={[]}
                    compact
                    height={36}
                    className="w-full max-w-[200px]"
                  />
                </div>

                <div className="flex gap-2 mt-4">
                  <button onClick={() => setEditingTractor(null)} className="px-4 py-2 border rounded">Cancel</button>
                  <button onClick={saveTractor} className="px-5 py-2 bg-emerald-600 text-white rounded">Save Tractor</button>
                </div>
              </div>
            )}

            <div className="grid md:grid-cols-2 gap-3">
              {tractors.map((t) => (
                <div key={t.id} className="bg-white border rounded-xl p-3 text-sm flex flex-col">
                  <div className="font-semibold text-base">{t.profile_name}</div>
                  <div className="text-gray-500 text-xs mb-1">{t.unit_number ? `#${t.unit_number} • ` : ''}{t.make} {t.model} {t.year || ''}</div>

                  <div className="text-[11px] text-gray-600 space-y-0.5">
                    <div>Length: <b>{t.overall_length_ft || '?'} ft</b> • Axles: <b>{t.num_axles || 3}</b></div>
                    <div>5th: {t.fifth_wheel_from_rear_in || '?'} in • WB: {t.wheelbase_in || '?'} in</div>
                  </div>

                  {/* Tractor graphic preview (now consistent via shared component) */}
                  <div className="mt-2 flex justify-center">
                    <TractorGraphic
                      tractor={t}
                      height={30}
                      className="w-full max-w-[130px]"
                    />
                  </div>

                  <div className="mt-auto pt-3 flex gap-2 text-xs">
                    <button onClick={() => setEditingTractor(t)} className="text-emerald-700 hover:underline">Edit</button>
                    <button onClick={() => deleteTractor(t.id)} className="text-red-600 hover:underline">Delete</button>
                  </div>
                </div>
              ))}
              {tractors.length === 0 && <div className="text-sm text-gray-500 col-span-2">No tractors saved yet. Create your first one above.</div>}
            </div>
          </div>
        )}

        {/* TRAILERS TAB */}
        {activeTab === 'trailers' && (
          <div>
            <div className="flex justify-between items-center mb-3">
              <div className="font-semibold">My Trailers ({trailers.length})</div>
              <button onClick={startNewTrailer} className="px-4 py-2 bg-black text-white text-sm rounded-lg">+ New Trailer Profile</button>
            </div>

            {editingTrailer && (
              <div className="mb-6 bg-white border border-emerald-200 rounded-2xl p-5">
                <div className="font-semibold mb-3">Trailer Profile</div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
                  {[
                    ['Profile Name *', 'profile_name', 'text'],
                    ['Overall Length (ft)', 'overall_length_ft', 'number'],
                    ['Kingpin from Front (in)', 'kingpin_distance_from_front_in', 'number'],
                    ['# Axles', 'num_axles', 'number'],
                    ['Kingpin → 1st Axle (in)', 'kingpin_to_first_axle_in', 'number'],
                    ['Extendable Extra (ft)', 'extendable_extra_ft', 'number'],
                  ].map(([label, key, type]) => (
                    <div key={key}>
                      <label className="text-[11px] text-gray-600">{label}</label>
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
                        className="border p-2 rounded w-full mt-0.5"
                      />
                    </div>
                  ))}
                  <div>
                    <label className="text-[11px] text-gray-600">Trailer Type</label>
                    <input value={editingTrailer.trailer_type || ''} onChange={(e) => setEditingTrailer({ ...editingTrailer, trailer_type: e.target.value })} className="border p-2 rounded w-full mt-0.5" />
                  </div>
                  <div className="flex items-center gap-4 pt-5 text-sm">
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input type="checkbox" checked={!!editingTrailer.has_lift_axle} onChange={(e) => setEditingTrailer({ ...editingTrailer, has_lift_axle: e.target.checked })} /> Lift axle
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input type="checkbox" checked={!!editingTrailer.is_extendable} onChange={(e) => setEditingTrailer({ ...editingTrailer, is_extendable: e.target.checked })} /> Extendable
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
                <div className="mt-3 pt-2 border-t">
                  <div className="text-[10px] text-gray-500 mb-1">Live preview</div>
                  <VehicleDiagram
                    tractor={null}
                    trailers={[editingTrailer]}
                    compact
                    height={28}
                    className="w-full max-w-[160px]"
                  />
                </div>

                <div className="flex gap-2 mt-4">
                  <button onClick={() => setEditingTrailer(null)} className="px-4 py-2 border rounded">Cancel</button>
                  <button onClick={saveTrailer} className="px-5 py-2 bg-emerald-600 text-white rounded">Save Trailer</button>
                </div>
              </div>
            )}

            <div className="grid md:grid-cols-2 gap-3">
              {trailers.map((tr) => (
                <div key={tr.id} className="bg-white border rounded-xl p-4 text-sm">
                  <div className="font-semibold">{tr.profile_name}</div>
                  <div className="text-xs text-gray-500">{tr.trailer_type || 'Trailer'} • {tr.overall_length_ft || '?'} ft • {tr.num_axles || 2} axles</div>
                  <div className="text-[12px] mt-1 text-gray-600">
                    Kingpin from nose: {tr.kingpin_distance_from_front_in || '?'} in • KP to axle: {tr.kingpin_to_first_axle_in || '?'} in
                    {tr.has_lift_axle && ' • Lift axle'} {tr.is_extendable && ` • Extendable +${tr.extendable_extra_ft || 0} ft`}
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

                  <div className="mt-3 flex gap-2 text-xs">
                    <button onClick={() => setEditingTrailer(tr)} className="text-emerald-700 hover:underline">Edit</button>
                    <button onClick={() => deleteTrailer(tr.id)} className="text-red-600 hover:underline">Delete</button>
                  </div>
                </div>
              ))}
              {trailers.length === 0 && <div className="text-sm text-gray-500">No trailers saved. Create your first one.</div>}
            </div>
          </div>
        )}

        {/* SAVED RIGS TAB */}
        {activeTab === 'saved' && (
          <div>
            <div className="flex justify-between mb-3 items-center">
              <div className="font-semibold">Saved Rig Configurations ({rigs.length}) — ready to use in analyses</div>
              <button onClick={() => setActiveTab('builder')} className="text-sm px-3 py-1.5 border rounded-lg">+ Build New Rig</button>
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              {rigs.map((rig) => {
                const tr = tractors.find((t) => t.id === rig.tractor_id)
                const rigTrailers = (rig.trailer_ids || [])
                  .map((id: string) => trailers.find((trr: Trailer) => trr.id === id))
                  .filter(Boolean) as Trailer[]
                return (
                  <div key={rig.id} className="bg-white border rounded-2xl p-5">
                    <div className="flex justify-between">
                      <div>
                        <div className="font-semibold text-lg tracking-tight">{rig.rig_name}</div>
                        <div className="text-xs text-emerald-700">{rig.computed_total_length_ft?.toFixed(1) || '?'} ft total • {rig.computed_total_axles || '?'} axles</div>
                      </div>
                      <button onClick={() => deleteRig(rig.id)} className="text-xs text-red-500 self-start">Delete</button>
                    </div>

                    <div className="mt-3 text-sm text-gray-600">
                      Tractor: <span className="font-medium text-gray-800">{tr?.profile_name || 'Unknown'}</span><br />
                      Trailers: {(rig.trailer_ids || []).length}
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

                    <button
                      onClick={() => loadRigIntoBuilder(rig)}
                      className="mt-4 text-sm px-4 py-1.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700"
                    >
                      Load into Builder / Preview
                    </button>
                  </div>
                )
              })}
              {rigs.length === 0 && (
                <div className="text-sm text-gray-500 col-span-2 bg-white border rounded-2xl p-6">
                  No saved rigs yet. Use the <b>Rig Builder</b> tab to create your first tractor + trailer combination.
                </div>
              )}
            </div>
          </div>
        )}

        {/* Footer help */}
        <p className="mt-10 text-[11px] text-gray-500 text-center">
          All measurements are stored privately for your account only. Accurate 5th-wheel / kingpin data produces better OSOW length and axle-group predictions.
        </p>
      </main>
    </div>
  )
}
