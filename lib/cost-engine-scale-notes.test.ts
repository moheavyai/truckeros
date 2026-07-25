import { describe, expect, it } from 'vitest'
import { calculateEstimatedCost } from './cost-engine'
import type { LoadDetails } from '@/agents/permit-agent'

const baseLoad: LoadDetails = {
  origin: { city: 'A', state: 'NE' },
  destination: { city: 'B', state: 'ND' },
  weight: 70000,
  length: 70,
  width: 8.5,
  height: 13.5,
}

describe('calculateEstimatedCost preserves analysis notes', () => {
  it('keeps axle/scale notes when no permit states (cost $0 path)', () => {
    const cost = calculateEstimatedCost(
      [],
      baseLoad,
      [],
      ['Axle groups: 5 axles: Steer×1 · Drives×2 · Trailer×2', 'SCALE: incomplete weights']
    )
    expect(cost.total).toBe(0)
    expect(cost.notes.some((n) => n.includes('Axle groups'))).toBe(true)
    expect(cost.notes.some((n) => n.includes('No permits required'))).toBe(true)
  })
})
