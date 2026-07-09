import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'
import { getGrossHeightDisplay, LEGAL_HEIGHT_FT } from './routing-envelope-display'

describe('getGrossHeightDisplay', () => {
  it('returns empty display for zero or missing height', () => {
    expect(getGrossHeightDisplay(0)).toEqual({
      displayText: '',
      helperText: '',
      showLegalBadge: false,
      isOversize: false,
    })
  })

  it('shows standard legal height when calculated height is at legal limit', () => {
    const display = getGrossHeightDisplay(LEGAL_HEIGHT_FT)
    expect(display.displayText).toBe(`13' 6"`)
    expect(display.helperText).toBe('Standard legal height')
    expect(display.showLegalBadge).toBe(true)
    expect(display.isOversize).toBe(false)
  })

  it('shows standard legal height when calculated height is below legal limit', () => {
    const display = getGrossHeightDisplay(10.5)
    expect(display.displayText).toBe(`13' 6"`)
    expect(display.helperText).toBe('Standard legal height')
    expect(display.showLegalBadge).toBe(true)
    expect(display.isOversize).toBe(false)
  })

  it('shows actual calculated height when above legal limit', () => {
    const display = getGrossHeightDisplay(14.5)
    expect(display.displayText).toBe(`14' 6"`)
    expect(display.helperText).toBe('Deck + load (oversize)')
    expect(display.showLegalBadge).toBe(false)
    expect(display.isOversize).toBe(true)
  })

  it('treats heights just over 13.5 ft as oversize', () => {
    const display = getGrossHeightDisplay(13.51)
    expect(display.displayText).toBe(`13' 6"`)
    expect(display.helperText).toBe('Deck + load (oversize)')
    expect(display.isOversize).toBe(true)
    expect(display.showLegalBadge).toBe(false)
  })
})

describe('permit-test routing envelope gross height UI', () => {
  it('uses display helper without exposing low deck+load helper copy', () => {
    const filePath = path.join(process.cwd(), 'app', 'permit-test', 'page.tsx')
    const source = readFileSync(filePath, 'utf8')

    expect(source).toContain('getGrossHeightDisplay(formData.height)')
    expect(source).not.toContain('Deck height + load height')
    expect(source).toContain('heightDisplay.showLegalBadge')
    expect(source).toContain('(legal)')
    expect(source).toContain('heightDisplay.helperText')
  })
})

describe('permit-test inline header nav', () => {
  it('shows Dashboard and History only (no badge, no New Analysis)', () => {
    const filePath = path.join(process.cwd(), 'app', 'permit-test', 'page.tsx')
    const source = readFileSync(filePath, 'utf8')

    const header = source.slice(
      source.indexOf('{/* Professional Header */}'),
      source.indexOf('New Route Analysis')
    )

    expect(header).toMatch(/href="\/dashboard"/)
    expect(header).toMatch(/href="\/equipment"/)
    expect(header).toMatch(/href="\/history"/)
    expect(header).not.toContain('Permit Agent')
    expect(header).not.toMatch(/href="\/permit-test"/)
    expect(header).not.toContain('New Analysis')
    expect(header).not.toMatch(/href="\/portal-assist"/)
  })
})