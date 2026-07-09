/**
 * Post-process OR-Tools / corridor route options with escort analysis.
 */

import {
  analyzeEscortRequirements,
  type EscortLoadDimensions,
  type EscortAnalysisResult,
} from '@/lib/escort-analysis'
import { supabase } from '@/lib/supabase'
import type { StatePermitRule } from '@/types/permit'

export interface RouteOptionEscortFields {
  routeCorridor?: string[]
  highways?: string[]
  escortRequiredStates?: string[]
  escortWarnings?: string[]
  escortDetails?: EscortAnalysisResult['escortDetails']
}

export async function loadStatePermitRuleMap(
  stateCodes: string[]
): Promise<Map<string, StatePermitRule>> {
  const unique = [...new Set(stateCodes.map((s) => s.toUpperCase().trim()).filter(Boolean))]
  if (unique.length === 0) {
    return new Map()
  }

  const { data, error } = (await supabase
    .from('state_permit_rules')
    .select('*')
    .in('state_code', unique)) as { data: StatePermitRule[] | null; error: { message?: string } | null }

  if (error) {
    console.warn('[enrich-route-escorts] state_permit_rules query failed:', error.message)
    return new Map()
  }

  return new Map((data || []).map((r) => [r.state_code, r]))
}

export function enrichRouteOptionWithEscorts<T extends RouteOptionEscortFields>(
  option: T,
  load: EscortLoadDimensions,
  ruleMap: Map<string, StatePermitRule>
): T {
  const routeCorridor = option.routeCorridor || []
  if (routeCorridor.length === 0) {
    return option
  }

  const escortAnalysis = analyzeEscortRequirements({
    routeCorridor,
    load,
    ruleMap,
    highways: option.highways || [],
  })

  return {
    ...option,
    escortRequiredStates: escortAnalysis.escortRequiredStates,
    escortWarnings: escortAnalysis.escortWarnings,
    escortDetails: escortAnalysis.escortDetails,
  }
}

export async function enrichOrToolsResponseWithEscorts<
  T extends { primary?: RouteOptionEscortFields; alternatives?: RouteOptionEscortFields[] },
>(data: T, load: EscortLoadDimensions): Promise<T> {
  const options = [data.primary, ...(data.alternatives || [])].filter(Boolean) as RouteOptionEscortFields[]
  const allStates = options.flatMap((o) => o.routeCorridor || [])
  const ruleMap = await loadStatePermitRuleMap(allStates)

  const primary = data.primary
    ? enrichRouteOptionWithEscorts(data.primary, load, ruleMap)
    : data.primary

  const alternatives = (data.alternatives || []).map((alt) =>
    enrichRouteOptionWithEscorts(alt, load, ruleMap)
  )

  return {
    ...data,
    primary,
    alternatives,
  }
}