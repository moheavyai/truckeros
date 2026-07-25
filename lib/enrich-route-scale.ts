/**
 * Post-process OR-Tools / corridor route options with axle-group scale checks.
 * Mirrors escort enrichment so the default OR-Tools path surfaces Scale & Axle Groups.
 *
 * v1: attaches scaleFindings / unableToScale / axleGroupSummary only — does NOT
 * recalculate estimatedCost (cost engine remains analyze-permit / processPermitRequest).
 */

import type { LoadDetails } from '@/agents/permit-agent'
import {
  attachScaleFieldsToOption,
  resolveAxleGroupsFromConfig,
  type AxleGroupSummary,
  type ScaleFinding,
} from '@/lib/axle-groups'
import { loadStatePermitRuleMap } from '@/lib/enrich-route-escorts'
import type { StatePermitRule } from '@/types/permit'

export interface RouteOptionScaleFields {
  routeCorridor?: string[]
  highways?: string[]
  notes?: string[]
  reasons?: string[]
  permitRequiredStates?: string[]
  axleGroupSummary?: string
  axleGroups?: AxleGroupSummary
  scaleFindings?: ScaleFinding[]
  corridorScaleFailedStates?: string[]
  unableToScale?: boolean
}

export interface ScaleEnrichLoad {
  weight: number
  axles?: number
  axleWeights?: number[]
  equipment?: LoadDetails['equipment']
}

export function enrichRouteOptionWithScale<T extends RouteOptionScaleFields>(
  option: T,
  load: ScaleEnrichLoad,
  ruleMap: Map<string, StatePermitRule>,
  summary: AxleGroupSummary
): T {
  const totalWeightLbs = Number(load.weight) || 0
  const attached = attachScaleFieldsToOption(option as Record<string, unknown>, {
    groups: summary.groups,
    axleWeights: load.axleWeights,
    totalWeightLbs,
    routeCorridor: option.routeCorridor || [],
    ruleMap,
    summary,
  })

  // Hard scale failures also force permit flags on failed states
  const permitStates = new Set(
    (option.permitRequiredStates || []).map((s) => String(s).toUpperCase())
  )
  for (const st of attached.corridorScaleFailedStates) {
    permitStates.add(st)
  }

  return {
    ...option,
    ...attached,
    permitRequiredStates: Array.from(permitStates).sort(),
  } as T
}

export async function enrichOrToolsResponseWithScale<
  T extends { primary?: RouteOptionScaleFields; alternatives?: RouteOptionScaleFields[] },
>(data: T, load: ScaleEnrichLoad): Promise<T> {
  const options = [data.primary, ...(data.alternatives || [])].filter(
    Boolean
  ) as RouteOptionScaleFields[]
  const allStates = options.flatMap((o) => o.routeCorridor || [])
  const ruleMap = await loadStatePermitRuleMap(allStates)

  // Prefer precomputed groups from equipment when present and richer than live recompute.
  const precomputed = load.equipment?.axleGroups ?? null
  const liveSummary = resolveAxleGroupsFromConfig({
    tractor: load.equipment?.tractor,
    trailers: load.equipment?.trailers,
    axles: load.axles,
  })
  let summary = liveSummary
  if (liveSummary.totalAxles > 0 && precomputed && precomputed.totalAxles > liveSummary.totalAxles) {
    const liveHasTrailer = liveSummary.groups.some((g) => g.source === 'trailer')
    const preHasTrailer = precomputed.groups.some((g) => g.source === 'trailer')
    if (!liveHasTrailer && preHasTrailer) summary = precomputed
  } else if (liveSummary.totalAxles === 0 && precomputed && precomputed.totalAxles > 0) {
    summary = precomputed
  }

  const primary = data.primary
    ? enrichRouteOptionWithScale(data.primary, load, ruleMap, summary)
    : data.primary

  const alternatives = (data.alternatives || []).map((alt) =>
    enrichRouteOptionWithScale(alt, load, ruleMap, summary)
  )

  return {
    ...data,
    primary,
    alternatives,
  }
}
