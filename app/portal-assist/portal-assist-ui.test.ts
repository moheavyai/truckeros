import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'

const pagePath = path.join(process.cwd(), 'app', 'portal-assist', 'page.tsx')
const permitPagePath = path.join(process.cwd(), 'app', 'permit-test', 'page.tsx')

function readSource(filePath: string) {
  return readFileSync(filePath, 'utf8')
}

describe('Portal Assist page UX', () => {
  it('pre-loads first corridor state via resolveInitialPortalState on real request load', () => {
    const source = readSource(pagePath)
    expect(source).toContain('resolveInitialPortalState')
    expect(source).toMatch(/applyPortalState\(loaded,\s*initialState/)
  })

  it('formats load dimensions with formatLoadDisplay (not raw decimal feet)', () => {
    const source = readSource(pagePath)
    expect(source).toContain('formatLoadDisplay')
    expect(source).not.toMatch(/request\.length\}'\s*×\s*\{request\.width\}'/)
  })

  it('uses two-box layout: compact Request Summary and Final Review with equipment in review box', () => {
    const source = readSource(pagePath)
    expect(source).toContain('1. Request Summary')
    expect(source).toContain('2. Final Review — Generated Prefill for')
    expect(source).toContain('formatPortalEquipmentSnapshot')
    expect(source).toContain('TRACTOR &amp; TRAILER')
    expect(source).not.toMatch(/1\. Request Details/)
    expect(source).not.toMatch(/EQUIPMENT SNAPSHOT \(from saved analysis\)/)
  })

  it('shows carrier, driver, and load review helpers in Final Review box', () => {
    const source = readSource(pagePath)
    expect(source).toContain("from '@/lib/portal-review-display'")
    expect(source).toContain('formatCarrierReviewFields')
    expect(source).toContain('formatDriverReviewFields')
    expect(source).toContain('formatLoadReviewDetails')
    expect(source).toContain('CARRIER INFO')
    expect(source).toContain('FULL LOAD DETAILS')
    expect(source).toContain('DRIVER')
  })

  it('shows placeholders when carrier or driver info is missing (PAU-4)', () => {
    const source = readSource(pagePath)
    expect(source).toContain('No carrier info saved with this request.')
    expect(source).toContain('No driver info saved with this request.')
  })

  it('places Regenerate Prefill next to Approve button in Final Review action row', () => {
    const source = readSource(pagePath)
    const summaryStart = source.indexOf('1. Request Summary')
    const finalReviewStart = source.indexOf('2. Final Review — Generated Prefill for')
    expect(summaryStart).toBeGreaterThan(-1)
    expect(finalReviewStart).toBeGreaterThan(summaryStart)
    const summaryBox = source.slice(summaryStart, finalReviewStart)
    expect(summaryBox).not.toContain('Regenerate Prefill')
    expect(source).toContain('handleRegeneratePrefill')
    expect(source).toMatch(/Regenerate Prefill[\s\S]*Approve & Record for/)
  })

  it('shows review-step banner when arriving from permit approval flow', () => {
    const source = readSource(pagePath)
    expect(source).toContain("params.get('step') === 'review'")
    expect(source).toContain("params.get('approved') === '1'")
    expect(source).toContain('isReviewStep')
    expect(source).toContain('Analysis approved')
    expect(source).toContain('Review the prefill below, then record and open portals state by state.')
  })

  it('suppresses launch hint when in review step (PAU-2)', () => {
    const source = readSource(pagePath)
    expect(source).toContain('launchHint && !isReviewStep')
  })

  it('limits per-state status pills to corridor/permit states inside Request Summary', () => {
    const source = readSource(pagePath)
    expect(source).toContain('portalStatesForRequest')
    expect(source).toContain('PER-STATE STATUS (corridor)')
    expect(source).not.toMatch(/route_corridor \|\| request\.permit_required_states \|\| allStateCodes/)
  })

  it('renumbers credentials and output sections logically', () => {
    const source = readSource(pagePath)
    expect(source).toContain('3. Portal Credentials (encrypted at rest)')
    expect(source).toContain('4. Portal Output Paste &amp; Analysis')
    expect(source).toContain('5. PDF &amp; Artifacts')
  })

  it('does not show Regenerate Prefill in right column when request is loaded (PAU-5)', () => {
    const source = readSource(pagePath)
    const rightColumnStart = source.indexOf('RIGHT COLUMN: Portal + Output + PDF + Analysis')
    expect(rightColumnStart).toBeGreaterThan(-1)
    const rightColumn = source.slice(rightColumnStart)
    expect(rightColumn).toContain('{!request && (')
    expect(rightColumn).not.toMatch(/\{request \? 'Regenerate Prefill'/)
  })

  it('uses approvalError in approval gate, not credentialError (PAU-3)', () => {
    const source = readSource(pagePath)
    expect(source).toContain('approvalError')
    expect(source).toContain('setApprovalError')
    const approveGateStart = source.indexOf('const handleApproveGate = async () => {')
    const parseOutputStart = source.indexOf('const handleParseOutput = async () => {')
    const approveGate = source.slice(approveGateStart, parseOutputStart)
    expect(approveGate).toContain('setApprovalError')
    expect(approveGate).not.toContain('setCredentialError')
  })

  it('confirms before regenerating after approval (PAU-1)', () => {
    const source = readSource(pagePath)
    expect(source).toContain('window.confirm')
    expect(source).toContain('Regenerating will clear your approval for this state')
    expect(source).toMatch(/if \(isApproved\)[\s\S]*handleRegeneratePrefill/)
  })

  it('includes carrierDriver in demo request', () => {
    const source = readSource(pagePath)
    const demoStart = source.indexOf('const loadDemoRequest = () => {')
    const demoEnd = source.indexOf('const handleStateChange', demoStart)
    const demoBlock = source.slice(demoStart, demoEnd)
    expect(demoBlock).toContain('carrierDriver:')
    expect(demoBlock).toContain('driverFullName')
  })

  it('sends record_approval on approve gate POST', () => {
    const source = readSource(pagePath)
    expect(source).toContain('record_approval: true')
  })

  it('updates parse error copy to Regenerate Prefill in Final Review', () => {
    const source = readSource(pagePath)
    expect(source).toContain("Load a request and click 'Regenerate Prefill' in Final Review first.")
    expect(source).not.toContain("Generate / Regenerate Prefill")
  })
})

describe('Portal Assist mobile contrast classes', () => {
  it('defines centralized field style constants with stronger mobile borders/text', () => {
    const source = readSource(pagePath)

    expect(source).toContain('const fieldControlClass =')
    expect(source).toContain('const inputClass =')
    expect(source).toContain('const textareaClass =')
    expect(source).toContain('const buttonSecondaryClass =')
    expect(source).toContain('const buttonPrimaryClass =')
    expect(source).toContain('const buttonSuccessClass =')
    expect(source).toContain('const fieldHintClass =')
    expect(source).toContain('const fieldHintTinyClass =')
    expect(source).toContain('const fieldLabelClass =')
    expect(source).toContain('const fieldLabelTinyClass =')
    expect(source).toContain('const sectionLabelClass =')
    expect(source).toContain('const bodyTextClass =')
    expect(source).toContain('const cardClass =')
    expect(source).toContain('const cardMetaClass =')

    // Labels share hint contrast (composed, not duplicated string)
    expect(source).toMatch(/const fieldLabelClass = fieldHintClass/)

    expect(source).toMatch(/border-gray-500 sm:border-gray-300/)
    expect(source).toMatch(/text-gray-900/)
    expect(source).toMatch(/placeholder:text-gray-500/)
    expect(source).toMatch(/text-gray-600 sm:text-gray-500/)
    expect(source).toMatch(/text-gray-700 sm:text-gray-600/)
    expect(source).toMatch(/border-gray-300 sm:border-gray-200/)
    expect(source).toContain('`${fieldControlClass}')
    expect(source).toMatch(/bg-emerald-700 hover:bg-emerald-800/)
  })

  it('wires form controls to shared contrast classes (not bare border-only)', () => {
    const source = readSource(pagePath)

    expect(source).toContain('className={`flex-1 ${inputClass}`}')
    expect(source).toContain('className={`mt-3 w-full ${textareaClass} h-16`}')
    expect(source).toContain('className={`w-full ${fieldControlClass} p-3 rounded-xl text-sm min-h-[110px] font-mono`}')
    expect(source).toContain('className={`mt-1 w-full max-w-xs ${fieldControlClass} rounded-xl')
    expect(source).toContain('className={`w-full max-w-xs ${fieldControlClass} rounded-xl')
    expect(source).toContain('className={`px-5 py-2 ${buttonSecondaryClass}`}')
    expect(source).toContain('className={`inline-flex items-center gap-2 px-4 py-2 ${buttonSecondaryClass} cursor-pointer`}')
    expect(source).toContain('className={`px-4 py-2 ${buttonPrimaryClass}`}')
    expect(source).toContain('className={`mt-2 px-5 py-2 ${buttonPrimaryClass} rounded-xl`}')
    expect(source).toContain('className={`px-5 py-2 ${buttonSuccessClass} rounded-xl`}')
    expect(source).toContain('className={`inline-block px-4 py-2 ${buttonSuccessClass} rounded-lg mb-3 ml-2`}')
    expect(source).toContain('className={cardClass}')
    expect(source).toContain('className={cardMetaClass}')
    expect(source).toContain('className={`${fieldHintClass} text-[11px] mt-1`}')

    // Credential inputs must not use bare border-only class strings
    expect(source).not.toMatch(/className="flex-1 border rounded-lg px-3 py-2 text-sm"/)
    expect(source).not.toMatch(/className="w-full border p-3 rounded-xl text-sm min-h-\[110px\] font-mono"/)
    expect(source).not.toMatch(/className="mt-3 w-full border rounded-lg p-2 text-sm h-16"/)
    // Section cards must not use bare border-only (default faint outline)
    expect(source).not.toMatch(/className="bg-white border rounded-2xl p-6"/)
    // Per-state status divider must use tokenized border, not bare border-t
    expect(source).not.toMatch(/className="pt-2 border-t"/)
    expect(source).toContain('className="pt-2 border-t border-gray-300 sm:border-gray-200"')
  })

  it('does not leave faint text-gray-400 on labels or interactive chrome', () => {
    const source = readSource(pagePath)
    const uiGray400 = source.match(/className=\{?[`'"][^`'"]*text-gray-400/g) || []
    expect(uiGray400).toEqual([])
    // Field meta labels use shared stronger contrast class
    expect(source).toContain('className={fieldLabelTinyClass}')
    expect(source).toContain('className={`${fieldLabelClass} block mb-2`}')
  })

  it('keeps primary and success action buttons with readable contrast', () => {
    const source = readSource(pagePath)
    expect(source).toContain("const buttonPrimaryClass =\n  'bg-black text-white")
    expect(source).toContain("const buttonSuccessClass =\n  'bg-emerald-700 hover:bg-emerald-800 text-white")
    // No loose inverted / mid-tone emerald-600 CTAs
    expect(source).not.toMatch(/bg-emerald-600/)
    // Parse uses primary token, not inline gray-900
    expect(source).not.toMatch(/className="mt-2 px-5 py-2 bg-gray-900 text-white/)
  })

  it('locks mobile focus rings, checkbox accent, and status pill contrast', () => {
    const source = readSource(pagePath)
    expect(source).toContain('focus:ring-2 focus:ring-gray-500 sm:focus:ring-1 sm:focus:ring-gray-400')
    expect(source).toContain('accent-emerald-700')
    expect(source).toContain("return 'bg-gray-300 text-gray-800'")
    expect(source).toContain("return 'bg-emerald-700 text-white'")
    expect(source).toContain("return 'bg-amber-500 text-gray-900'")
    // Corridor pills use explicit transparent border (not bare border alone)
    expect(source).toContain('border border-transparent')
    // Selected badge must not force text-white over getStatusClasses (gray pill conflict)
    expect(source).not.toMatch(
      /Selected:[\s\S]{0,120}text-white \$\{getStatusClasses/
    )
    expect(source).toMatch(
      /Selected:[\s\S]{0,80}getStatusClasses\(getStateStatus\(selectedState\)\)/
    )
  })

  it('uses mobile-first semantic panel borders (*-300 sm:*-200)', () => {
    const source = readSource(pagePath)
    expect(source).toContain('border-blue-300 sm:border-blue-200')
    expect(source).toContain('border-emerald-300 sm:border-emerald-200')
    expect(source).toContain('border-amber-300 sm:border-amber-200')
    expect(source).toContain('text-amber-800 sm:text-amber-700')
  })
})

describe('Permit test page — Approve and Launch Portals flow', () => {
  it('uses Approve and Launch Portals label and navigates with step=review', () => {
    const source = readSource(permitPagePath)
    expect(source).toContain('Approve and Launch Portals')
    expect(source).not.toContain('Approve & Open All Portals')
    expect(source).toContain('/portal-assist?requestId=${requestId}&step=review')
  })

  it('handleApproveSpecificOption navigates to portal-assist with step=review', () => {
    const source = readSource(permitPagePath)
    const handlerStart = source.indexOf('const handleApproveSpecificOption = async (option: any) => {')
    const handlerEnd = source.indexOf('// Reject & Start Over', handlerStart)
    const handler = source.slice(handlerStart, handlerEnd)
    expect(handler).toContain('router.push(`/portal-assist?requestId=${requestId}&step=review`)')
  })
})