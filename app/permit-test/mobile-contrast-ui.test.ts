/**
 * Source-inspection tests locking mobile-first contrast patterns on permit-test
 * form fields, hints, and related input components.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'

const permitPagePath = path.join(process.cwd(), 'app', 'permit-test', 'page.tsx')
const overhangPath = path.join(process.cwd(), 'components', 'OverhangFeetInput.tsx')
const dimensionPath = path.join(process.cwd(), 'components', 'DimensionInput.tsx')
const locationPath = path.join(process.cwd(), 'components', 'LocationStopInput.tsx')

function read(filePath: string) {
  return readFileSync(filePath, 'utf8')
}

describe('permit-test mobile contrast classes', () => {
  it('defines centralized field style constants with stronger mobile borders/text', () => {
    const source = read(permitPagePath)

    expect(source).toContain('const fieldControlClass =')
    expect(source).toContain('const inputClass =')
    expect(source).toContain('const inputCompactClass =')
    expect(source).toContain('const selectClass =')
    expect(source).toContain('const textareaClass =')
    expect(source).toContain('const readoutClass =')
    expect(source).toContain('const fieldHintClass =')
    expect(source).toContain('const fieldHintTinyClass =')
    expect(source).toContain('const fieldLabelTinyClass =')

    expect(source).toMatch(/border-gray-500 sm:border-gray-300/)
    expect(source).toMatch(/text-gray-900/)
    expect(source).toMatch(/placeholder:text-gray-500/)
    // Labels stay slightly stronger; hints are softer gray-500 chrome
    expect(source).toMatch(/fieldLabelTinyClass = 'block text-\[10px\] text-gray-600 sm:text-gray-500'/)
    expect(source).toMatch(/fieldHintClass = 'text-xs text-gray-500'/)
    expect(source).toMatch(/fieldHintTinyClass = 'text-\[10px\] text-gray-500'/)
    // Shared base is composed into size variants
    expect(source).toContain('`${fieldControlClass}')
  })

  it('wires form inputs to shared contrast classes (not bare border-only controls)', () => {
    const source = read(permitPagePath)

    expect(source).toContain('className={inputClass}')
    expect(source).toContain('className={inputCompactClass}')
    expect(source).toContain('className={selectClass}')
    expect(source).toContain('className={textareaClass}')
    expect(source).toContain('className={readoutClass}')
    expect(source).toContain('className={fieldLabelTinyClass}')
    expect(source).toContain('className={fieldHintClass}')
  })

  it('uses shared AppHeader (sticky) outside overflow-clipped content shell', () => {
    const source = read(permitPagePath)
    // Outer shell is min-w-0 without overflow-x-clip on the sticky ancestor
    expect(source).toMatch(/className="w-full min-w-0"/)
    // Unified header — sticky lives inside AppHeader, not a page-local <header>
    expect(source).toMatch(/<AppHeader\s+user=\{user\}\s+ownOrganizationId=\{ownOrganizationId\}/)
    expect(source).toContain("import AppHeader from '@/components/AppHeader'")
    // Content shell has responsive padding; clip lives on html/body, not sticky parent
    expect(source).toMatch(/max-w-3xl mx-auto px-4 py-6 sm:px-8 sm:pb-8 w-full min-w-0/)
    // No duplicate page-local header shell
    expect(source).not.toMatch(/<header className="border-b bg-white sticky/)
  })
})

describe('root layout mobile fit', () => {
  it('exports device-width viewport without viewportFit cover', () => {
    const layout = read(path.join(process.cwd(), 'app', 'layout.tsx'))
    expect(layout).toContain('export const viewport')
    expect(layout).toMatch(/width:\s*["']device-width["']/)
    expect(layout).toMatch(/initialScale:\s*1/)
    expect(layout).not.toMatch(/viewportFit\s*:/)
    expect(layout).toContain('overflow-x-clip')
  })

  it('clips horizontal overflow on html/body without max-width 100vw', () => {
    const css = read(path.join(process.cwd(), 'app', 'globals.css'))
    // Avoid /s (dotAll) — not needed; [\s\S] is ES2017-safe
    expect(css).toMatch(/html\s*\{[\s\S]*?overflow-x:\s*clip/)
    expect(css).toMatch(/body\s*\{[\s\S]*?overflow-x:\s*clip/)
    expect(css).not.toMatch(/max-width:\s*100vw/)
  })
})

describe('related permit-test input components — mobile contrast', () => {
  it('OverhangFeetInput uses stronger borders and readable labels without dead placeholders', () => {
    const source = read(overhangPath)
    expect(source).toContain('border-gray-500 sm:border-gray-300')
    expect(source).toContain('text-gray-900')
    expect(source).not.toContain('placeholder:')
    expect(source).toMatch(/text-gray-600 sm:text-gray-500/)
  })

  it('DimensionInput uses stronger borders, labels, and placeholders', () => {
    const source = read(dimensionPath)
    expect(source).toContain('border-gray-500 sm:border-gray-300')
    expect(source).toContain('text-gray-900')
    expect(source).toContain('placeholder:text-gray-500')
    expect(source).toMatch(/text-gray-600 sm:text-gray-500/)
  })

  it('LocationStopInput address and coord fields have readable mobile contrast', () => {
    const source = read(locationPath)
    expect(source).toContain('border-gray-500 sm:border-gray-300')
    expect(source).toContain('text-gray-900')
    expect(source).toContain('placeholder:text-gray-500')
    // Resolved address keeps content contrast; coord meta is softer hint chrome
    expect(source).toMatch(/text-gray-700 sm:text-gray-600/)
    expect(source).toMatch(/text-\[10px\] text-gray-500/)
  })
})
