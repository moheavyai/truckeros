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
    expect(source).toMatch(/text-gray-600 sm:text-gray-500/)
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
    expect(source).toContain('className={`${fieldHintTinyClass}')

    // Cargo description should use shared inputClass, not bare border
    const descIdx = source.indexOf('Description — what are you hauling?')
    const descSlice = source.slice(descIdx, descIdx + 400)
    expect(descSlice).toContain('className={inputClass}')
    expect(descSlice).not.toMatch(/className="border p-2 rounded w-full"/)

    // Change Route input uses composed fieldControlClass (not bare border)
    const changeRouteIdx = source.indexOf('placeholder="AL, MS, TN, MO, NE"')
    expect(changeRouteIdx).toBeGreaterThan(-1)
    const changeRouteSlice = source.slice(changeRouteIdx, changeRouteIdx + 220)
    expect(changeRouteSlice).toContain('fieldControlClass')
    expect(changeRouteSlice).not.toMatch(/className="flex-1 border rounded/)

    // Size-variant fields compose fieldControlClass
    expect(source).toContain('`${fieldControlClass} rounded w-14 p-1 text-center`')
    expect(source).toContain('`${fieldControlClass} ml-2 w-28 p-1 rounded`')
    expect(source).toContain('`${fieldControlClass} px-1 py-0.5 rounded text-xs`')
  })

  it('does not leave faint text-gray-400 body/hint styles on the form shell', () => {
    const source = read(permitPagePath)
    expect(source).toContain(
      'className="text-gray-600 sm:text-gray-500">• Use the 🎤 buttons below for voice input'
    )
    // No remaining text-gray-400 utility classes in JSX className strings
    const uiClasses = source.match(/className=\{?[`'"][^`'"]*text-gray-400/g) || []
    expect(uiClasses).toEqual([])
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
    expect(source).toMatch(/text-gray-600 sm:text-gray-500/)
    expect(source).toMatch(/text-gray-700 sm:text-gray-600/)
  })
})
