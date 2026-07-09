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
} from '@/lib/load-details-options'

const permitPagePath = path.join(process.cwd(), 'app', 'permit-test', 'page.tsx')

function readPermitPageSource() {
  return readFileSync(permitPagePath, 'utf8')
}

function loadDetailsSectionSlice(source: string) {
  const start = source.indexOf('Load Details (Cargo, Axle Weights, Overhangs)')
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
    expect(source).toContain('resolvePiecesForSubmit')
    expect(source).toContain('buildPermitCargoSnapshot')
    expect(source).toContain('DEFAULT_LOADED_ARRANGEMENT')
    expect(source).toContain('DEFAULT_MOVE_TYPE')
    expect(source).toContain('DEFAULT_NUMBER_OF_PIECES')
    expect(source).toContain('MAX_NUMBER_OF_PIECES')
  })

  it('initializes formData with sensible defaults', () => {
    const source = readPermitPageSource()

    expect(source).toContain('numberOfPieces: DEFAULT_NUMBER_OF_PIECES')
    expect(source).toContain('loadedArrangement: DEFAULT_LOADED_ARRANGEMENT')
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

    for (const option of LOADED_ARRANGEMENT_OPTIONS) {
      expect(LOADED_ARRANGEMENT_LABELS[option]).toBeTruthy()
    }
    for (const option of MOVE_TYPE_OPTIONS) {
      expect(MOVE_TYPE_LABELS[option]).toBeTruthy()
    }
    expect(LOADED_ARRANGEMENT_OPTIONS.join()).toContain('side-by-side')
    expect(MOVE_TYPE_OPTIONS.join()).toContain('self-propelled')
  })

  it('uses buildPermitCargoSnapshot in both save handlers only', () => {
    const source = readPermitPageSource()
    const approveSave = approveAndSaveHandlerSlice(source)
    const approveSpecific = approveSpecificHandlerSlice(source)

    expect(approveSave).toContain('resolvePiecesForSubmit(formData, numberOfPiecesDraft)')
    expect(approveSave).toContain('cargo: buildPermitCargoSnapshot(cargoFormData, selectedDriverKey, {')
    expect(approveSave).toContain('organizationId: permitOrganizationId')
    expect(approveSpecific).toContain('resolvePiecesForSubmit(formData, numberOfPiecesDraft)')
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