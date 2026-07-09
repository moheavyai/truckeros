/**
 * lib/cost-engine.ts
 *
 * Improved Cost Engine (Phase III)
 *
 * Calculates estimated permit costs using state-specific pricing when available.
 * Falls back to reasonable defaults for states without verified pricing data.
 *
 * Pricing data should come from official state DOT fee schedules.
 */

import type { LoadDetails } from '@/agents/permit-agent'
import type { StatePermitRule } from '@/types/permit'
import { needsLengthPermit } from '@/lib/permit-length'

export interface CostBreakdown {
  total: number
  baseFee: number
  stateCount: number
  surcharges: {
    width?: number
    height?: number
    length?: number
    weight?: number
  }
  perStateFee: number
  notes: string[]
  stateBreakdown?: Array<{
    state: string
    baseFee: number
  }>
}

/** Conservative fallback when a state has no pricing data yet.
 *  We use a low value so we don't overstate "actual state costs".
 */
const DEFAULT_PRICING = {
  BASE_FEE_PER_STATE: 35,   // Conservative default until real data is seeded
  WIDTH_SURCHARGE: 25,
  HEIGHT_SURCHARGE: 30,
  LENGTH_SURCHARGE: 20,
  WEIGHT_SURCHARGE: 45,
}

export function calculateEstimatedCost(
  permitRequiredStates: string[],
  load: LoadDetails,
  stateRules: StatePermitRule[] = [],
  notes: string[] = []
): CostBreakdown {
  const stateCount = permitRequiredStates.length

  if (stateCount === 0) {
    return {
      total: 0,
      baseFee: 0,
      stateCount: 0,
      surcharges: {},
      perStateFee: DEFAULT_PRICING.BASE_FEE_PER_STATE,
      notes: ['No permits required — cost is $0'],
    }
  }

  // Build a lookup map from the rules we already fetched in the agent
  const ruleMap = new Map(stateRules.map(rule => [rule.state_code, rule]))

  let baseFee = 0
  const stateBreakdown: CostBreakdown['stateBreakdown'] = []

  // Calculate state-specific base fees when available
  for (const state of permitRequiredStates) {
    const rule = ruleMap.get(state)
    const stateBaseFee = rule?.base_permit_fee_usd ?? DEFAULT_PRICING.BASE_FEE_PER_STATE

    baseFee += stateBaseFee
    stateBreakdown.push({ state, baseFee: stateBaseFee })
  }

  // Determine oversize conditions
  const isWidthOversize = load.width > 8.5
  const isHeightOversize = load.height > 13.5
  const isLengthOversize = needsLengthPermit(load.length, load.trailerLengthFt)
  const isOverweight = load.weight > 80000

  const surcharges: CostBreakdown['surcharges'] = {}
  let surchargeTotal = 0

  // Use average surcharge across states that require permits (or default)
  const avgWidthSurcharge = getAverageSurcharge(stateRules, 'oversize_surcharge_width_usd', DEFAULT_PRICING.WIDTH_SURCHARGE)
  const avgHeightSurcharge = getAverageSurcharge(stateRules, 'oversize_surcharge_height_usd', DEFAULT_PRICING.HEIGHT_SURCHARGE)
  const avgLengthSurcharge = getAverageSurcharge(stateRules, 'oversize_surcharge_length_usd', DEFAULT_PRICING.LENGTH_SURCHARGE)
  const avgWeightSurcharge = getAverageSurcharge(stateRules, 'overweight_surcharge_usd', DEFAULT_PRICING.WEIGHT_SURCHARGE)

  if (isWidthOversize) {
    surcharges.width = avgWidthSurcharge
    surchargeTotal += avgWidthSurcharge
  }
  if (isHeightOversize) {
    surcharges.height = avgHeightSurcharge
    surchargeTotal += avgHeightSurcharge
  }
  if (isLengthOversize) {
    surcharges.length = avgLengthSurcharge
    surchargeTotal += avgLengthSurcharge
  }
  if (isOverweight) {
    surcharges.weight = avgWeightSurcharge
    surchargeTotal += avgWeightSurcharge
  }

  const total = baseFee + surchargeTotal

  const costNotes: string[] = []

  if (surchargeTotal > 0) {
    costNotes.push(`Dimensional & weight surcharges: +$${surchargeTotal}`)
  } else {
    costNotes.push('No dimensional or weight surcharges applied')
  }

  return {
    total: Math.round(total),
    baseFee: Math.round(baseFee),
    stateCount,
    surcharges,
    perStateFee: Math.round(baseFee / stateCount),
    notes: [...notes, ...costNotes],
    stateBreakdown,
  }
}

/** Helper to calculate average surcharge from available state data */
function getAverageSurcharge(
  rules: StatePermitRule[],
  field: keyof StatePermitRule,
  defaultValue: number
): number {
  const values = rules
    .map(r => r[field] as number | null | undefined)
    .filter((v): v is number => typeof v === 'number')

  if (values.length === 0) return defaultValue

  const avg = values.reduce((sum, v) => sum + v, 0) / values.length
  return Math.round(avg)
}
