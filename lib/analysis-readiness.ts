export const NO_TRACTOR_ANALYSIS_HINT = 'Add a tractor before running route analysis.'

export function canRunRouteAnalysis(params: { tractorCount: number }): boolean {
  return Number(params.tractorCount) > 0
}
