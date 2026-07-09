import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'
import { sortRigsForDisplay, type RigConfiguration } from '@/types/equipment'

function rig(overrides: Partial<RigConfiguration> & Pick<RigConfiguration, 'id'>): RigConfiguration {
  return {
    user_id: 'u1',
    rig_name: 'Rig',
    tractor_id: 't1',
    trailer_ids: [],
    computed_total_length_ft: null,
    computed_total_axles: null,
    computed_kingpin_to_last_axle_ft: null,
    ...overrides,
  }
}

describe('Default rig button labels', () => {
  it('shows Make Default Rig only for non-default rigs (no ✓ Default button)', () => {
    const filePath = path.join(process.cwd(), 'app', 'equipment', 'page.tsx')
    const source = readFileSync(filePath, 'utf8')

    expect(source).toContain('Make Default Rig')
    expect(source).not.toContain('✓ Default')
    expect(source).not.toContain('✓ Default Rig')
    expect(source).toContain('if (isDefault) return null')
  })

  it('opens on Saved Rigs tab with Saved Rigs first in tab order', () => {
    const filePath = path.join(process.cwd(), 'app', 'equipment', 'page.tsx')
    const source = readFileSync(filePath, 'utf8')

    expect(source).toMatch(/useState<Tab>\('saved'\)/)
    expect(source).toMatch(/\{ k: 'saved', label: 'Saved Rigs' \},\s*\n\s*\{ k: 'tractors'/)
    expect(source).toMatch(/\{ k: 'trailers', label: 'Trailers' \},\s*\n\s*\{ k: 'builder', label: 'Rig Builder' \}/)
  })
})

describe('sortRigsForDisplay', () => {
  it('puts default rig first, then sorts by name and created_at', () => {
    const sorted = sortRigsForDisplay([
      rig({ id: '1', rig_name: 'Beta', created_at: '2024-02-01' }),
      rig({ id: '2', rig_name: 'Alpha', is_default: true, created_at: '2024-01-01' }),
      rig({ id: '3', rig_name: 'Alpha', created_at: '2024-03-01' }),
      rig({ id: '4', rig_name: 'Charlie', created_at: '2024-01-15' }),
    ])

    expect(sorted.map((r) => r.id)).toEqual(['2', '3', '1', '4'])
  })
})