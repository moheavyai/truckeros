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