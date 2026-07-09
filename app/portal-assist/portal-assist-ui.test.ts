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