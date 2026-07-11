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
      'className="text-gray-500">• Tap 🎤 next to a field for voice input'
    )
    // No remaining text-gray-400 utility classes in JSX className strings
    const uiClasses = source.match(/className=\{?[`'"][^`'"]*text-gray-400/g) || []
    expect(uiClasses).toEqual([])
  })

  it('makes Add drop a fully visible secondary action on mobile', () => {
    const source = read(permitPagePath)
    const dropsHeading = source.indexOf('6. Drops (deliveries)')
    expect(dropsHeading).toBeGreaterThan(-1)
    const slice = source.slice(dropsHeading - 120, dropsHeading + 650)
    expect(slice).toContain('+ Add drop')
    expect(slice).toContain('min-h-[44px]')
    expect(slice).toContain('font-semibold')
    expect(slice).toContain('border-gray-500 sm:border-gray-300')
    expect(slice).toContain('shrink-0')
    expect(slice).toContain('touch-manipulation')
    expect(slice).toContain('flex flex-wrap items-center justify-between gap-2')
    expect(slice).not.toMatch(/text-xs px-3 py-1 bg-gray-100/)
  })

  it('gives Remove drop a proper mobile touch target', () => {
    const source = read(permitPagePath)
    const rowStart = source.indexOf('formData.drops.map((drop, idx)')
    expect(rowStart).toBeGreaterThan(-1)
    const row = source.slice(rowStart, rowStart + 3200)
    expect(row).toContain('removeDrop(drop.id)')
    expect(row).toContain('min-h-[44px]')
    expect(row).toContain('touch-manipulation')
    expect(row).toContain('border-red-300')
    expect(row).toContain('Remove')
    expect(row).toContain('flex-1 min-w-0')
    expect(row).toContain('flex flex-wrap items-start justify-between gap-2 min-w-0')
    expect(row).not.toMatch(/text-xs text-red-600 hover:underline/)
  })

  it('names routing envelope distinctly from load-details step 3', () => {
    const source = read(permitPagePath)
    expect(source).toContain('3. Load details')
    expect(source).toContain('Routing envelope')
    expect(source).not.toContain('Load Details (Routing Envelope)')
  })

  it('numbers form steps 1–6 including Rig and aligns intro copy', () => {
    const source = read(permitPagePath)
    expect(source).toContain('1. Driver for this load')
    expect(source).toContain('2. Rig')
    expect(source).toContain('3. Load details')
    expect(source).toContain('4. Route preferences (optional)')
    expect(source).toContain('label="5. Pickup"')
    expect(source).toContain('6. Drops (deliveries)')
    expect(source).toMatch(
      /choose driver and rig, enter load details, optional route preferences, then pickup and drops/
    )
    // Primary intro uses body contrast, not soft hint-only gray-500
    expect(source).toMatch(
      /text-sm text-gray-700 sm:text-gray-600 mt-1\.5 leading-relaxed/
    )
  })

  it('keeps sticky header outside overflow-clipped content shell', () => {
    const source = read(permitPagePath)
    // Outer shell is min-w-0 without overflow-x-clip on the sticky ancestor
    expect(source).toMatch(/className="w-full min-w-0"/)
    expect(source).toMatch(/sticky top-0 z-50/)
    // Content shell has responsive padding; clip lives on html/body, not sticky parent
    expect(source).toMatch(/max-w-3xl mx-auto px-4 py-6 sm:px-8 sm:pb-8 w-full min-w-0/)
    const stickyBlock = source.slice(
      source.indexOf('sticky top-0 z-50'),
      source.indexOf('sticky top-0 z-50') + 80
    )
    expect(stickyBlock).not.toContain('overflow-x-clip')
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
