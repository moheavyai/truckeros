/**
 * Load Details UI tests use static source inspection only (no RTL / DOM rendering),
 * matching the accepted limitation in permit-profile-ui.test.ts.
 *
 * New cargo subfields are asserted only in save-snapshot handlers (handleApproveAndSave /
 * handleApproveSpecificOption). Route-analysis payloads intentionally omit them.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'
import {
  LOADED_ARRANGEMENT_LABELS,
  LOADED_ARRANGEMENT_OPTIONS,
  MOVE_TYPE_LABELS,
  MOVE_TYPE_OPTIONS,
  MULTI_PIECE_DEFAULT_LOADED_ARRANGEMENT,
} from '@/lib/load-details-options'

const permitPagePath = path.join(process.cwd(), 'app', 'permit-test', 'page.tsx')

function readPermitPageSource() {
  return readFileSync(permitPagePath, 'utf8')
}

function loadDetailsSectionSlice(source: string) {
  const start = source.indexOf('3. Load details')
  const end = source.indexOf('Load Dimensions (specific cargo)', start)
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  return source.slice(start, end)
}

function approveAndSaveHandlerSlice(source: string) {
  const start = source.indexOf('const handleApproveAndSave = async () => {')
  const end = source.indexOf('const handleApproveSpecificOption = async', start)
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  return source.slice(start, end)
}

function approveSpecificHandlerSlice(source: string) {
  const start = source.indexOf('const handleApproveSpecificOption = async')
  const end = source.indexOf('const handleRejectAndRestart = () => {', start)
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  return source.slice(start, end)
}

describe('Permit test page — load details cargo fields', () => {
  it('imports load-details-options helpers and cargo snapshot builder', () => {
    const source = readPermitPageSource()

    expect(source).toContain("from '@/lib/load-details-options'")
    expect(source).toContain("from '@/lib/permit-cargo-snapshot'")
    expect(source).toContain('LOADED_ARRANGEMENT_OPTIONS')
    expect(source).toContain('MOVE_TYPE_OPTIONS')
    expect(source).toContain('LOADED_ARRANGEMENT_LABELS')
    expect(source).toContain('MOVE_TYPE_LABELS')
    expect(source).toContain('parseAndClampPieces')
    expect(source).toContain('resolveLoadedArrangementForPieces')
    expect(source).toContain('applyNumberOfPiecesChange')
    expect(source).toContain('resolvePiecesAndArrangementForSubmit')
    expect(source).toContain('buildPermitCargoSnapshot')
    expect(source).toContain('DEFAULT_MOVE_TYPE')
    expect(source).toContain('DEFAULT_NUMBER_OF_PIECES')
    expect(source).toContain('MAX_NUMBER_OF_PIECES')
  })

  it('initializes formData with sensible defaults', () => {
    const source = readPermitPageSource()

    expect(source).toContain('numberOfPieces: DEFAULT_NUMBER_OF_PIECES')
    // Pieces default to 1 → Loaded radios start with nothing selected
    expect(source).toContain(
      'loadedArrangement: resolveLoadedArrangementForPieces(DEFAULT_NUMBER_OF_PIECES, \'\')'
    )
    expect(source).toContain('moveType: DEFAULT_MOVE_TYPE')
  })

  it('renders compact single-row controls under Description', () => {
    const section = loadDetailsSectionSlice(readPermitPageSource())
    const descriptionIdx = section.indexOf('Description — what are you hauling?')
    const manufacturerIdx = section.indexOf('Manufacturer')
    const piecesIdx = section.indexOf('No. of Pieces')
    const loadedIdx = section.indexOf('Loaded:')
    const moveIdx = section.indexOf('Move:')

    expect(descriptionIdx).toBeGreaterThan(-1)
    expect(manufacturerIdx).toBeGreaterThan(descriptionIdx)
    expect(piecesIdx).toBeGreaterThan(descriptionIdx)
    expect(piecesIdx).toBeLessThan(manufacturerIdx)
    expect(loadedIdx).toBeGreaterThan(piecesIdx)
    expect(moveIdx).toBeGreaterThan(loadedIdx)
    expect(section).toContain('flex flex-wrap items-center gap-x-4 gap-y-2')
    expect(section).toContain('type="radio"')
    expect(section).toContain('name="loadedArrangement"')
    expect(section).toContain('name="moveType"')
    expect(section).toContain('aria-label="Loaded arrangement"')
    expect(section).toContain('aria-label="Move type"')
    expect(section).toContain('LOADED_ARRANGEMENT_OPTIONS.map')
    expect(section).toContain('MOVE_TYPE_OPTIONS.map')
    expect(section).toContain('LOADED_ARRANGEMENT_LABELS[option]')
    expect(section).toContain('MOVE_TYPE_LABELS[option]')
    expect(section).toContain('numberOfPiecesDraft')
    expect(section).toContain('parseAndClampPieces')
    // Pieces blur syncs Loaded arrangement (clear at 1, end-to-end at 2+)
    expect(section).toContain('applyNumberOfPiecesChange(p.numberOfPieces, clamped, p.loadedArrangement)')
    // Move type radios unchanged (independent of piece count)
    expect(section).toContain('name="moveType"')

    for (const option of LOADED_ARRANGEMENT_OPTIONS) {
      expect(LOADED_ARRANGEMENT_LABELS[option]).toBeTruthy()
    }
    for (const option of MOVE_TYPE_OPTIONS) {
      expect(MOVE_TYPE_LABELS[option]).toBeTruthy()
    }
    expect(LOADED_ARRANGEMENT_OPTIONS.join()).toContain('side-by-side')
    expect(MULTI_PIECE_DEFAULT_LOADED_ARRANGEMENT).toBe('end-to-end')
    expect(MOVE_TYPE_OPTIONS.join()).toContain('self-propelled')
  })

  it('syncs loadedArrangement with piece count on blur and save; leaves Move alone', () => {
    const source = readPermitPageSource()
    const section = loadDetailsSectionSlice(source)

    // Empty form value → no radio checked; valid option → that radio checked
    expect(section).toContain('checked={formData.loadedArrangement === option}')
    // Loaded radios still free-choice onChange; sync only via pieces change helpers
    expect(section).toContain("onChange={() => setFormData((p) => ({ ...p, loadedArrangement: option }))}")
    expect(section).toContain('applyNumberOfPiecesChange(p.numberOfPieces, clamped, p.loadedArrangement)')

    // Move field must not be driven by piece-count helpers
    const moveOnChangeIdx = section.indexOf("onChange={() => setFormData((p) => ({ ...p, moveType: option }))}")
    expect(moveOnChangeIdx).toBeGreaterThan(-1)
    expect(section).not.toMatch(/moveType:.*applyNumberOfPiecesChange|applyNumberOfPiecesChange.*moveType/)

    const approveSave = approveAndSaveHandlerSlice(source)
    const approveSpecific = approveSpecificHandlerSlice(source)
    for (const handler of [approveSave, approveSpecific]) {
      // Shared submit helper flushes draft pieces + syncs arrangement
      expect(handler).toContain(
        'const piecesPatch = resolvePiecesAndArrangementForSubmit(formData, numberOfPiecesDraft)'
      )
      // cargo snapshot gets both pieces and arrangement from the same patch
      expect(handler).toContain('const cargoFormData = { ...formData, ...piecesPatch }')
      expect(handler).toContain('setFormData((p) => ({ ...p, ...piecesPatch }))')
      expect(handler).not.toContain('moveType: piecesPatch')
      // Move field is not part of piecesPatch application
      expect(handler).not.toMatch(/moveType:\s*piecesPatch/)
    }
  })

  it('persists border_crossings and highways in both approve/save handlers', () => {
    const source = readPermitPageSource()
    const approveSave = approveAndSaveHandlerSlice(source)
    const approveSpecific = approveSpecificHandlerSlice(source)

    // Primary approve path: geometry from primary option
    expect(approveSave).toContain('route_corridor: primary.routeCorridor || []')
    expect(approveSave).toContain('border_crossings: primary.borderCrossings || []')
    expect(approveSave).toContain('highways: primary.highways || []')

    // Specific-option approve path: geometry from selected option
    expect(approveSpecific).toContain('route_corridor: option.routeCorridor || []')
    expect(approveSpecific).toContain('border_crossings: option.borderCrossings || []')
    expect(approveSpecific).toContain('highways: option.highways || []')
  })

  it('uses buildPermitCargoSnapshot in both save handlers only', () => {
    const source = readPermitPageSource()
    const approveSave = approveAndSaveHandlerSlice(source)
    const approveSpecific = approveSpecificHandlerSlice(source)

    expect(approveSave).toContain('resolvePiecesAndArrangementForSubmit(formData, numberOfPiecesDraft)')
    expect(approveSave).toContain('cargo: buildPermitCargoSnapshot(cargoFormData, selectedDriverKey, {')
    expect(approveSave).toContain('organizationId: permitOrganizationId')
    expect(approveSpecific).toContain('resolvePiecesAndArrangementForSubmit(formData, numberOfPiecesDraft)')
    expect(approveSpecific).toContain('cargo: buildPermitCargoSnapshot(cargoFormData, selectedDriverKey, {')
    expect(approveSpecific).toContain('organizationId: permitOrganizationId')

    const analyzeStart = source.indexOf('const analyzePayload = {')
    const analyzeEnd = source.indexOf("setRouteProgressDetail('Running OR-Tools", analyzeStart)
    expect(analyzeStart).toBeGreaterThan(-1)
    expect(analyzeEnd).toBeGreaterThan(analyzeStart)
    const analyzeSlice = source.slice(analyzeStart, analyzeEnd)
    expect(analyzeSlice).not.toContain('buildPermitCargoSnapshot')
    expect(analyzeSlice).not.toContain('numberOfPieces')
  })
})

describe('Permit test page — axle weight distribution', () => {
  function axleWeightsSectionSlice(source: string) {
    const start = source.indexOf('Dynamic axle weights')
    const end = source.indexOf('Routing envelope', start)
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    return source.slice(start, end)
  }

  it('wires distributeWeightSteerFirst for defaults, distribute, and envelope auto-fill', () => {
    const source = readPermitPageSource()
    expect(source).toContain('distributeWeightSteerFirst')
    expect(source).toContain('resolvePermitAxleLayout')
    expect(source).toContain('trimAxleWeightsForSubmit')
    expect(source).toContain('buildRigAxleSnapshot')
    expect(source).toContain('buildSelectedRigSnapshot')
    // Initial form default
    expect(source).toMatch(/axleWeights:\s*distributeWeightSteerFirst\(/)
    // Envelope / axle-count redistribute
    expect(source).toContain('next.axleWeights = distributeWeightSteerFirst(n, gross, groups)')
    // Submit paths truncate weights to current axle count
    expect(source).toContain('trimAxleWeightsForSubmit(')
  })

  it('shows expandable amber group weight inputs matching overhang chrome', () => {
    const section = axleWeightsSectionSlice(readPermitPageSource())
    // Collapsed-by-default details chrome (mobile-friendly) — matches Load Overhangs amber
    expect(section).toContain('<details')
    expect(section).toContain('<summary')
    expect(section).toContain('mb-3 border rounded-lg bg-amber-50 text-sm')
    expect(section).toContain('font-medium text-amber-900')
    expect(section).toContain('Axle Weight Distribution (lbs)')
    expect(section).toContain('Group combined weights')
    expect(section).toContain('sumGroupWeightLbs')
    expect(section).toContain('distributeWeightToGroup')
    expect(section).toContain('classifyGroupAxleConfig')
    expect(section).toContain('buildCombinationAdjacentSpacingsIn')
    expect(section).toContain('withinGroupSpacingsFromCombination')
    expect(section).toContain('displayGroupWeightLimitLbs')
    expect(section).toContain('overLimit')
    expect(section).toContain('overCount')
    expect(section).toContain('even-split')
    expect(section).toContain('steer-first (12k), not')
    expect(section).toContain('aria-labelledby="axle-group-combined-weights-label"')
    expect(section).toContain('aria-describedby={configId}')
    expect(section).toContain('axle-group-weight-')
    expect(section).toContain('Distribute (steer 12k)')
    // Spacing axle counts match assignAxleGroups defaults (tractor 3 / trailer 2)
    expect(section).toContain('resolveDeclaredAxleCount(tractorUnit.num_axles, 3)')
    expect(section).toContain('resolveDeclaredAxleCount(tr?.num_axles, 2)')
    // Gross always synced incl. 0; dual-write weight for envelope
    expect(section).toContain('grossLoadedWeight: newSum')
    expect(section).toContain('weight: newSum')
    expect(section).not.toContain('newSum || prev.grossLoadedWeight')
    // Distribute (steer 12k) dual-writes gross + weight to distributed total
    expect(section).toContain('distributedTotal')
    expect(section).toMatch(/grossLoadedWeight:\s*distributedTotal/)
    expect(section).toMatch(/weight:\s*distributedTotal/)
    // Group total applies on blur only when total changes (preserve unequal per-axle)
    expect(section).toContain('onBlur={(e) => applyGroupTotal(gi, e.target.value)}')
    expect(section).toContain('Math.abs(groupTotal - currentSum) < 0.5')
    expect(section).toContain('defaultValue={groupSum || 0}')
    expect(section).toContain('min-h-[44px]')
    // Per-axle advanced nested edit kept
    expect(section).toContain('Per-axle weights (advanced)')
    expect(section).toContain('htmlFor={inputId}')
    expect(section).toContain('id={inputId}')
    expect(section).toContain('axle-weight-')
    // Primary group fields are editable inputs (not chip-only display)
    expect(section).toContain('applyGroupTotal')
    expect(section).toContain('config.label')
    expect(section).toContain('config.detail')
  })

  it('saves axle groups on cargo snapshot for portal/history prefill', () => {
    const source = readPermitPageSource()
    expect(source).toContain('axleGroups: summary')
    expect(source).toContain('axleGroupSummary: formatAxleGroupSummaryLine(summary)')
  })

  it('wires axle groups into both save handlers and analyze equipment payload', () => {
    const source = readPermitPageSource()
    const approveSave = approveAndSaveHandlerSlice(source)
    const approveSpecific = approveSpecificHandlerSlice(source)
    for (const handler of [approveSave, approveSpecific]) {
      expect(handler).toContain('axleGroups: summary')
      expect(handler).toContain('resolveSubmitWeightLbs(formData)')
    }
    // Analyze / change-route pass precomputed groups so jeep/flip roles survive
    expect(source).toContain('axleGroups: selectedRigSnapshot.axleGroups ?? null')
    expect(source).toContain('resolveSubmitWeightLbs')
    expect(source).toContain('resolveRigBaseLengthFt')
    expect(source).toContain('incompleteEquipment')
    expect(source).toContain('allTrailersEmpty')
  })

  it('redistributes when axle count mismatches weight array length', () => {
    const source = readPermitPageSource()
    expect(source).toContain('axleCountMismatch')
    expect(source).toContain('weightChanged || axleCountMismatch')
  })

  it('clears residual rig envelope when switching to custom dimensions (no rig)', () => {
    const source = readPermitPageSource()
    // Slice only the null/custom branch (before setSelectedRigId(rig.id) for a real rig).
    const start = source.indexOf('function handleSelectRig(rig: RigConfiguration | null)')
    const nullBranchEnd = source.indexOf('setSelectedRigId(rig.id)', start)
    expect(start).toBeGreaterThan(-1)
    expect(nullBranchEnd).toBeGreaterThan(start)
    const nullPath = source.slice(start, nullBranchEnd)

    // Null path clears selection + snapshot
    expect(nullPath).toContain('if (!rig)')
    expect(nullPath).toContain('setSelectedRigId(null)')
    expect(nullPath).toContain('setSelectedRigSnapshot(null)')

    // Clears full set of rig-derived equipment fields so residual envelope cannot stick
    expect(nullPath).toContain("unitNumber: ''")
    expect(nullPath).toContain("vin: ''")
    expect(nullPath).toContain("trailerVin: ''")
    expect(nullPath).toContain("tractorEmptyWeightLbs: ''")
    expect(nullPath).toContain("trailerEmptyWeightLbs: ''")
    expect(nullPath).toContain("rigEmptyWeightLbs: ''")
    expect(nullPath).toContain("trailerWidthFt: ''")
    expect(nullPath).toContain("trailerDeckHeightFt: ''")
    // trailerLengthFt is a number on FormData (default 53) — clear with 0, not ''
    expect(nullPath).toContain('trailerLengthFt: 0')
    expect(nullPath).toContain("year: ''")
    expect(nullPath).toContain("make: ''")
    expect(nullPath).toContain("model: ''")
    expect(nullPath).toContain("trailerMake: ''")
    expect(nullPath).toContain("trailerModel: ''")
    expect(nullPath).toContain("trailerYear: ''")
    expect(nullPath).toContain('kingpinSettingIn: 36')
    expect(nullPath).toContain('axles: 5')

    // Recomputes load-only envelope and writes form envelope outputs
    expect(nullPath).toContain('computeRoutingEnvelope')
    expect(nullPath).toContain('rigLengthFt: Number(next.loadLengthFt) || 0')
    expect(nullPath).toContain('rigEmptyWeightLbs: 0')
    expect(nullPath).toContain('trailerWidthFt: 0')
    expect(nullPath).toContain('deckHeightFt: 0')
    expect(nullPath).toContain('next.length = envelope.lengthFt > 0 ? envelope.lengthFt : 60')
    expect(nullPath).toContain('next.width = envelope.widthFt > 0 ? envelope.widthFt : 8.5')
    expect(nullPath).toContain('next.height = envelope.heightFt > 0 ? envelope.heightFt : 13.5')
    expect(nullPath).toContain('next.weight = gross')
    expect(nullPath).toContain('next.grossLoadedWeight = gross')
    expect(nullPath).toContain(
      'const gross = envelope.weightLbs > 0 ? envelope.weightLbs : 80_000'
    )
    expect(nullPath).toContain('resolvePermitAxleLayout(next.axles, null)')
    expect(nullPath).toContain('distributeWeightSteerFirst')
    expect(nullPath).toContain('next.axleWeights = distributeWeightSteerFirst(n, gross, groups)')

    // Must not wipe pure load detail fields
    expect(nullPath).not.toContain("loadWeightLbs: ''")
    expect(nullPath).not.toContain("loadLengthFt: ''")
    expect(nullPath).not.toContain("loadWidthFt: ''")
    expect(nullPath).not.toContain("loadHeightFt: ''")

    // UI wires empty select value to handleSelectRig(null) and closes picker
    expect(source).toContain('handleSelectRig(null)')
    expect(source).toContain('— Custom dimensions —')
    const selectOnChange = source.slice(
      source.indexOf('value={selectedRigId || \'\''),
      source.indexOf('— Custom dimensions —')
    )
    expect(selectOnChange).toContain('handleSelectRig(null)')
    expect(selectOnChange).toContain('setShowRigPicker(false)')

    // Live envelope: no-rig base is load length only (never trailer default 53)
    expect(source).toContain('function resolveEnvelopeBaseLengthFt')
    expect(source).toMatch(
      /function resolveEnvelopeBaseLengthFt\([\s\S]*?if \(snap\) \{[\s\S]*?return resolveRigBaseLengthFt\(snap, trailerLengthFt\)[\s\S]*?return Number\(loadLengthFt\) \|\| 0/
    )
    expect(source).toMatch(
      /resolveEnvelopeBaseLengthFt\(\s*selectedRigSnapshot,\s*formData\.trailerLengthFt,\s*formData\.loadLengthFt\s*\)/
    )
    // Must not fall back through resolveRigBaseLengthFt(null, trailer…) which yields default 53
    expect(source).not.toMatch(
      /resolveRigBaseLengthFt\(selectedRigSnapshot,\s*formData\.trailerLengthFt\)\s*\|\|/
    )
  })

  it('disables Approve when unverified; analysis path is untouched', () => {
    const source = readPermitPageSource()
    expect(source).toContain('getEmailVerificationStatus')
    expect(source).toContain('EMAIL_VERIFY_APPROVE_TITLE')
    expect(source).toContain('routeRequiresPermit(primary) && !emailVerified')

    const approveSave = approveAndSaveHandlerSlice(source)
    expect(approveSave).toContain('!emailVerified')
    expect(approveSave).toContain("router.push(`/portal-assist?requestId=${requestId}&step=review`)")

    expect(source).toContain('/api/optimize-route')
    const analysisSlice = source.slice(
      source.indexOf('const runRouteAnalysis'),
      source.indexOf('const handleApproveAndSave')
    )
    expect(analysisSlice).not.toContain('emailVerified')
  })
})