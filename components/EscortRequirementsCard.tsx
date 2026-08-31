'use client'

/**
 * Structured escort summary from escort-analysis StateEscortDetail[].
 * Distinguishes hard-required vs possible; one relocating pilot vs lead+chase.
 */

export type EscortDetailView = {
  stateCode: string
  escortCount: 0 | 1 | 2
  requirementLevel: 'none' | 'may_require' | 'required'
  positions?: string[]
  positionMode?: 'relocates' | 'fixed'
  escortTypes?: string[]
  heightPoleLevel?: 'none' | 'recommended' | 'required'
  warning?: string
  notes?: string
  highwayContext?: string
}

function countLabel(n: 0 | 1 | 2): string {
  if (n >= 2) return '2+'
  if (n === 1) return '1'
  return '0'
}

export default function EscortRequirementsCard({
  details,
  fallbackWarnings,
  fallbackStates,
}: {
  details?: EscortDetailView[] | null
  fallbackWarnings?: string[] | null
  fallbackStates?: string[] | null
}) {
  const rows = (details || []).filter(
    (d) => d.requirementLevel === 'required' || d.requirementLevel === 'may_require' || d.escortCount > 0
  )

  if (rows.length === 0 && !(fallbackWarnings && fallbackWarnings.length) && !(fallbackStates && fallbackStates.length)) {
    return null
  }

  const requiredCount = rows.filter((d) => d.requirementLevel === 'required').length
  const mayCount = rows.filter((d) => d.requirementLevel === 'may_require').length
  const title =
    requiredCount > 0
      ? 'Escorts required'
      : mayCount > 0
        ? 'Escorts possible'
        : 'Escort guidance'

  return (
    <div className="mb-3 p-3 bg-orange-50 border border-orange-200 rounded-lg">
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <span className="font-semibold text-orange-900">{title}</span>
        {requiredCount > 0 && (
          <span className="text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded bg-red-100 text-red-800 border border-red-200">
            {requiredCount} required
          </span>
        )}
        {mayCount > 0 && (
          <span className="text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded bg-amber-100 text-amber-900 border border-amber-200">
            {mayCount} possible
          </span>
        )}
      </div>

      {rows.length > 0 ? (
        <ul className="space-y-2">
          {rows.map((d) => {
            const hard = d.requirementLevel === 'required'
            const relocates =
              d.positionMode === 'relocates' || (d.positionMode !== 'fixed' && d.escortCount === 1)
            const showPole = d.heightPoleLevel === 'required' || d.heightPoleLevel === 'recommended'
            const showLe = (d.escortTypes || []).includes('law_enforcement')
            return (
              <li
                key={d.stateCode}
                className={`rounded-lg border px-3 py-2 text-sm ${
                  hard
                    ? 'border-red-200 bg-white text-red-950'
                    : 'border-amber-200 bg-white text-amber-950'
                }`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono font-bold">{d.stateCode}</span>
                  <span
                    className={`text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded ${
                      hard ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-900'
                    }`}
                  >
                    {hard ? 'Required' : 'Possible'}
                  </span>
                  {d.escortCount > 0 && (
                    <span className="text-xs font-medium text-gray-700">
                      {countLabel(d.escortCount)} escort{d.escortCount === 1 ? '' : 's'}
                    </span>
                  )}
                </div>
                <div className={`mt-1 text-xs space-y-0.5 ${hard ? 'text-red-900/80' : 'text-amber-900/80'}`}>
                  {d.escortCount > 0 && (
                    <div>
                      {relocates
                        ? 'Chase on 4-lane · lead on 2-lane'
                        : 'Lead + chase'}
                    </div>
                  )}
                  {showPole && <div>Height pole on lead</div>}
                  {showLe && <div>Law enforcement required</div>}
                  {d.notes && <div className="text-gray-600">{d.notes}</div>}
                </div>
              </li>
            )
          })}
        </ul>
      ) : fallbackWarnings && fallbackWarnings.length > 0 ? (
        <ul className="text-sm text-orange-800 space-y-1 list-disc list-inside">
          {fallbackWarnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      ) : (
        <div className="text-sm text-orange-800">{(fallbackStates || []).join(' → ')}</div>
      )}

      <p className="mt-2 text-[11px] text-orange-900/70">
        Confirm final escort requirements on the issued state permit. Local and city/county roads may differ from interstate rules.
      </p>
    </div>
  )
}
