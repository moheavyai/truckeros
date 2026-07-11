/**
 * Equipment page service-mode scope tests use static source inspection.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'

const equipmentPagePath = path.join(process.cwd(), 'app', 'equipment', 'page.tsx')

function readEquipmentSource() {
  return readFileSync(equipmentPagePath, 'utf8')
}

describe('Equipment page — service mode scoping', () => {
  it('skips equipment loads without a selected carrier in service mode', () => {
    const source = readEquipmentSource()

    expect(source).toContain('isServiceModeReadOnly')
    expect(source).toContain("workspaceMode === 'service' && !effectiveOrganizationId")
    expect(source).toContain('resolveEquipmentScope')
    expect(source).toContain('canLoadEquipment')
    expect(source).toContain('canLoadRigs')
    expect(source).toContain('rigOwnerUserId')
    expect(source).toContain('equipmentProfilesLoadOrFilter')
    expect(source).toContain('equipmentOrganizationIdForSave')
  })

  it('blocks create/edit/delete actions in service mode', () => {
    const source = readEquipmentSource()

    expect(source).toContain('if (isServiceModeReadOnly) return')
    expect(source).toContain('equipment is read-only')
    expect(source).toContain('result.userId')
    expect(source).toContain('carrierPrimaryOwnerError')
    expect(source).toContain('loadingPrimaryOwner')
    expect(source).toContain('saveTractor')
    expect(source).toContain('saveTrailer')
    expect(source).toContain('saveCurrentRig')
    expect(source).toContain('deleteRig')
  })

  it('shows empty-state CTA when no carrier is selected', () => {
    const source = readEquipmentSource()

    expect(source).toContain('Select a carrier in the workspace bar above')
  })
})

describe('Equipment page — mobile contrast classes', () => {
  it('defines centralized field style constants with stronger mobile borders/text', () => {
    const source = readEquipmentSource()

    expect(source).toContain('const fieldControlClass =')
    expect(source).toContain('const inputClass =')
    expect(source).toContain('const inputMtClass =')
    expect(source).toContain('const selectClass =')
    expect(source).toContain('const textareaClass =')
    expect(source).toContain('const buttonSecondaryClass =')
    expect(source).toContain('const buttonPrimaryClass =')
    expect(source).toContain('const buttonSuccessClass =')
    expect(source).toContain('const fieldLabelTinyClass =')
    expect(source).toContain('const fieldLabelSectionClass =')
    expect(source).toContain('const fieldLabelMediumClass =')
    expect(source).toContain('const fieldHintTinyClass =')
    expect(source).toContain('const mutedTextClass =')
    expect(source).toContain('const bodyTextClass =')
    expect(source).toContain('const dividerBorderClass =')
    expect(source).toContain('const checkboxClass =')
    expect(source).toContain('const editorShellClass =')
    expect(source).toContain('const cardClass =')
    expect(source).toContain('const cardCompactClass =')
    expect(source).toContain('const cardItemClass =')
    expect(source).toContain('const cardPanelClass =')

    expect(source).toMatch(/border-gray-500 sm:border-gray-300/)
    expect(source).toMatch(/text-gray-900/)
    expect(source).toMatch(/placeholder:text-gray-500/)
    // Labels keep stronger mobile contrast; hints softer; muted body meta mid-strength
    expect(source).toMatch(/fieldLabelTinyClass = 'text-\[11px\] text-gray-600 sm:text-gray-500'/)
    expect(source).toMatch(/fieldHintTinyClass = 'text-\[10px\] text-gray-500'/)
    expect(source).toMatch(/mutedTextClass = 'text-gray-600 sm:text-gray-500'/)
    expect(source).toMatch(/text-gray-700 sm:text-gray-600/)
    expect(source).toMatch(/border-gray-300 sm:border-gray-200/)
    expect(source).toMatch(/border-emerald-300 sm:border-emerald-200/)
    expect(source).toMatch(/accent-emerald-700/)
    expect(source).toContain('`${fieldControlClass}')
    expect(source).toMatch(/bg-emerald-700 hover:bg-emerald-800/)
    expect(source).toMatch(/disabled:bg-gray-500 disabled:text-white/)
    // Secondary buttons include white fill + 44px touch target
    expect(source).toMatch(/buttonSecondaryClass =[\s\S]*?bg-white/)
    expect(source).toMatch(/buttonSecondaryClass =[\s\S]*?min-h-\[44px\]/)
    expect(source).toMatch(/buttonSecondaryClass =[\s\S]*?touch-manipulation/)
  })

  it('page header links New Analysis only (History lives in AppHeader; no Dashboard)', () => {
    const source = readEquipmentSource()
    const headerStart = source.indexOf('Equipment &amp; Rig Builder')
    expect(headerStart).toBeGreaterThan(-1)
    const headerSlice = source.slice(headerStart, headerStart + 700)
    expect(headerSlice).toContain('href="/permit-test"')
    expect(headerSlice).toContain('New Analysis')
    // AppHeader owns History when activePage=equipment — no dual page-level History CTA
    expect(headerSlice).not.toContain('href="/history"')
    expect(headerSlice).not.toContain('History')
    expect(headerSlice).not.toContain('href="/dashboard"')
    expect(headerSlice).not.toContain('← Dashboard')
    expect(headerSlice).toMatch(/className=\{buttonPrimaryClass\}/)
    expect(source).toMatch(/const buttonPrimaryClass =[\s\S]*?min-h-\[44px\]/)
    expect(source).toMatch(/const buttonSecondaryClass =[\s\S]*?min-h-\[44px\]/)
  })

  it('wires form controls and cards to shared contrast classes', () => {
    const source = readEquipmentSource()

    expect(source).toContain('className={inputClass}')
    expect(source).toContain('className={inputMtClass}')
    expect(source).toContain('className={selectClass}')
    expect(source).toContain('className={cardClass}')
    expect(source).toContain('className={cardItemClass}')
    expect(source).toContain('className={cardPanelClass}')
    expect(source).toContain('className={editorShellClass}')
    expect(source).toContain('className={checkboxClass}')
    expect(source).toContain('className={fieldLabelTinyClass}')
    expect(source).toContain('className={fieldLabelSectionClass}')
    expect(source).toContain('className={fieldLabelMediumClass}')
    expect(source).toContain('className={`mt-2 w-full ${textareaClass} h-16`}')
    expect(source).toContain('className={`mt-1 w-full ${fieldControlClass} p-3 rounded-xl text-sm`}')
    expect(source).toContain('className={`flex-1 ${selectClass}`}')
    // Buttons use shared tokens (padding lives in the token — no stacked px/py)
    expect(source).toContain('className={buttonPrimaryClass}')
    expect(source).toContain('className={buttonSecondaryClass}')
    expect(source).toContain('className={`${buttonSuccessClass} rounded`}')
    expect(source).toContain('className={`${buttonSecondaryClass} rounded`}')
    expect(source).toContain('className={`flex gap-1 border-b ${dividerBorderClass} mb-6`}')
    expect(source).toContain('className={`mt-3 pt-2 border-t ${dividerBorderClass}`}')
    // Empty preview dashed chrome is mobile-stronger
    expect(source).toMatch(/border-dashed border-gray-500 sm:border-gray-300/)
    // Success CTA includes 44px touch target (New Permits, Save, etc.)
    expect(source).toMatch(/buttonSuccessClass =[\s\S]*?min-h-\[44px\]/)
    expect(source).toMatch(/buttonSuccessClass =[\s\S]*?touch-manipulation/)

    // No bare faint border-only compact inputs left in editors
    expect(source).not.toMatch(/className="border p-1\.5 rounded w-full/)
    // Editor shells use mobile-stronger emerald borders (not fixed emerald-200 only)
    expect(source).not.toMatch(/className="mb-6 bg-white border border-emerald-200 rounded-2xl p-5"/)
    // Save Rig must not override success disabled styles with gray-300
    expect(source).not.toMatch(/buttonSuccessClass\}[^`]*disabled:bg-gray-300/)
    // No bare border-t / border-b utilities without gray scale tokens
    // (end-of-class boundary so border-blue / border-b-2 do not match)
    const bareDividers =
      source.match(
        /className=["'`][^"'`]*\b(border-t|border-b)(?=[\s"'`]|$)(?![^"'`]*(border-gray|\$\{dividerBorderClass|\$\{softDividerBorderClass))/g
      ) || []
    expect(bareDividers).toEqual([])
    // Avoid low-contrast gray-400 text on the equipment shell
    const faintUi = source.match(/className=\{?[`'"][^`'"]*text-gray-400/g) || []
    expect(faintUi).toEqual([])
    // Inverted sm pairs (faint first) should not appear for field chrome
    expect(source).not.toMatch(/border-gray-300 sm:border-gray-500/)
    expect(source).not.toMatch(/text-gray-500 sm:text-gray-600/)
    // No dead padding stacks on secondary/primary/success tokens (padding lives in tokens)
    expect(source).not.toMatch(/className=\{`px-4 py-1\.5 \$\{buttonSecondaryClass/)
    expect(source).not.toMatch(/className=\{`text-sm px-4 py-1\.5 \$\{buttonSuccessClass/)
    expect(source).not.toMatch(/className=\{`px-5 py-3 \$\{buttonSecondaryClass/)
    expect(source).not.toMatch(/className=\{`px-8 py-3 \$\{buttonSuccessClass/)
    expect(source).not.toMatch(/className=\{`text-sm px-3 py-1\.5 \$\{buttonSecondaryClass/)
    // Clear / Save Rig / Build New Rig use tokens without padding overrides
    expect(source).toContain('className={`${buttonSecondaryClass} rounded-xl`}')
    expect(source).toContain('className={`${buttonSuccessClass} font-semibold rounded-xl`}')
    expect(source).toMatch(/setActiveTab\('builder'\)[\s\S]{0,80}className=\{buttonSecondaryClass\}/)
  })

  it('keeps fieldControlClass token parity with LicensePlateFields', () => {
    const equipment = readEquipmentSource()
    const lpf = readFileSync(
      path.join(process.cwd(), 'components', 'LicensePlateFields.tsx'),
      'utf8'
    )
    const tokenRe =
      /const fieldControlClass =\s*\n?\s*'([^']+)'/
    const eq = equipment.match(tokenRe)?.[1]
    const lp = lpf.match(tokenRe)?.[1]
    expect(eq).toBeTruthy()
    expect(lp).toBe(eq)
    expect(lpf).toContain("const fieldLabelTinyClass = 'text-[11px] text-gray-600 sm:text-gray-500'")
  })
})