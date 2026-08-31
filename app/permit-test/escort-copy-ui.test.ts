/**
 * Escort chip/card copy — static source inspection (same limitation as permit-profile-ui.test.ts).
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'

const permitPagePath = path.join(process.cwd(), 'app', 'permit-test', 'page.tsx')
const cardPath = path.join(process.cwd(), 'components', 'EscortRequirementsCard.tsx')

describe('Permit test escort copy', () => {
  it('uses ESCORT REQ / POSSIBLE chips and never ESCORT NEEDED', () => {
    const source = readFileSync(permitPagePath, 'utf8')
    expect(source).toContain('ESCORT REQ')
    expect(source).toContain("'POSSIBLE'")
    expect(source).not.toContain('ESCORT NEEDED')
    expect(source).not.toContain('ESCORT?')
    expect(source).toContain('Escort possible')
    expect(source).toContain('Escort required')
  })

  it('card titles relocates copy without Type/Position/Needed', () => {
    const source = readFileSync(cardPath, 'utf8')
    expect(source).toContain("'Escorts required'")
    expect(source).toContain("'Escorts possible'")
    expect(source).toContain('Chase on 4-lane · lead on 2-lane')
    expect(source).toContain('Height pole on lead')
    expect(source).toContain('Law enforcement required')
    expect(source).not.toContain('ESCORT NEEDED')
    expect(source).not.toContain('Type:')
    expect(source).not.toContain('Position:')
    expect(source).not.toContain('civilian')
  })
})
