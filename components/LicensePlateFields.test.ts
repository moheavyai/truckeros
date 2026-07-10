import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'

describe('LicensePlateFields component module', () => {
  it('is defined in a standalone file outside EquipmentPage', () => {
    const filePath = path.join(process.cwd(), 'components', 'LicensePlateFields.tsx')
    const source = readFileSync(filePath, 'utf8')

    expect(source).toContain('export default function LicensePlateFields')
    expect(source).toContain('US_STATE_OPTIONS')
    expect(source).toContain('idPrefix')
  })

  it('uses mobile-first contrast tokens for inputs and labels', () => {
    const filePath = path.join(process.cwd(), 'components', 'LicensePlateFields.tsx')
    const source = readFileSync(filePath, 'utf8')

    expect(source).toContain('const fieldControlClass =')
    expect(source).toContain('const inputClass =')
    expect(source).toContain('const fieldLabelTinyClass =')
    expect(source).toMatch(/border-gray-500 sm:border-gray-300/)
    expect(source).toMatch(/text-gray-900/)
    expect(source).toMatch(/placeholder:text-gray-500/)
    expect(source).toMatch(/text-gray-600 sm:text-gray-500/)
    expect(source).not.toMatch(/const inputClass = 'border p-1\.5 rounded/)
    expect(source).not.toMatch(/border-gray-300 sm:border-gray-500/)
    expect(source).not.toMatch(/text-gray-500 sm:text-gray-600/)
  })

  it('keeps fieldControlClass and fieldLabelTinyClass in parity with Equipment page', () => {
    const lpf = readFileSync(
      path.join(process.cwd(), 'components', 'LicensePlateFields.tsx'),
      'utf8'
    )
    const equipment = readFileSync(
      path.join(process.cwd(), 'app', 'equipment', 'page.tsx'),
      'utf8'
    )
    const fieldControlRe = /const fieldControlClass =\s*\n?\s*'([^']+)'/
    const labelRe = /const fieldLabelTinyClass = '([^']+)'/
    expect(lpf.match(fieldControlRe)?.[1]).toBe(equipment.match(fieldControlRe)?.[1])
    expect(lpf.match(labelRe)?.[1]).toBe(equipment.match(labelRe)?.[1])
  })

  it('is not re-defined inside equipment page', () => {
    const filePath = path.join(process.cwd(), 'app', 'equipment', 'page.tsx')
    const source = readFileSync(filePath, 'utf8')

    expect(source).not.toMatch(/function LicensePlateFields\s*\(/)
    expect(source).toContain("import LicensePlateFields from '@/components/LicensePlateFields'")
  })
})

describe('Equipment page license plate focus regression', () => {
  it('uses functional setState for plate fields without remounting keys', () => {
    const filePath = path.join(process.cwd(), 'app', 'equipment', 'page.tsx')
    const source = readFileSync(filePath, 'utf8')

    expect(source).toContain(
      'setEditingTractor((prev) => (prev ? { ...prev, license_plate: value } : prev))'
    )
    expect(source).toContain('setEditingTractor((prev) =>')
    expect(source).toContain(
      'setEditingTrailer((prev) => (prev ? { ...prev, license_plate: value } : prev))'
    )
    expect(source).toContain('setEditingTrailer((prev) =>')
    expect(source).not.toMatch(/key=\{[^}]*license_plate/)
    expect(source).not.toMatch(/key=\{[^}]*plate/)
  })
})