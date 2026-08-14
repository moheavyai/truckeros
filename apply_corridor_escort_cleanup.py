#!/usr/bin/env python3
"""Apply corridor / escort signal cleanup on a clean main-based branch.

Run from repo root:
  python apply_corridor_escort_cleanup.py
"""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parent if (Path(__file__).parent / "lib").exists() else Path.cwd()


def must_replace(path: Path, old: str, new: str, label: str) -> None:
    text = path.read_text(encoding="utf-8")
    if old not in text:
        raise SystemExit(f"FAIL {label}: pattern not found in {path}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")
    print(f"OK {label}")


def main() -> None:
    # --- 1) Corridor restrictions: state gate only (no I-40 name leak) ---
    dot = ROOT / "lib" / "dot-corridor-restrictions.ts"
    must_replace(
        dot,
        """export function getRestrictionsForCorridor(
  states: string[],
  highways: string[] = []
): CorridorRestriction[] {
  const stateSet = new Set(states.map(s => s.toUpperCase()))
  const hwySet = new Set(highways.map(h => h.toUpperCase()))

  return PRIORITY_RESTRICTIONS.filter(r => {
    if (stateSet.has(r.state.toUpperCase())) return true
    if (r.impactsCorridor?.some(imp => stateSet.has(imp.toUpperCase()))) return true

    const rHwy = r.highway.toUpperCase()
    for (const h of hwySet) {
      if (h.includes(rHwy) || rHwy.includes(h.replace('I-', '').replace('US ', ''))) {
        return true
      }
    }
    return false
  })
}""",
        """export function getRestrictionsForCorridor(
  states: string[],
  highways: string[] = []
): CorridorRestriction[] {
  const stateSet = new Set(states.map(s => s.toUpperCase()))
  // State membership (or explicit impactsCorridor) is required.
  // Never expand to every state that shares a highway name (I-40, I-70, …).
  void highways // kept for API compatibility; state gate is the primary filter
  return PRIORITY_RESTRICTIONS.filter(r => {
    if (stateSet.has(r.state.toUpperCase())) return true
    if (r.impactsCorridor?.some(imp => stateSet.has(imp.toUpperCase()))) return true
    return false
  })
}""",
        "dot-corridor state gate",
    )

    # --- 2) Escort analysis: tall → required; merge matching bands ---
    esc = ROOT / "lib" / "escort-analysis.ts"
    must_replace(
        esc,
        """  if (load.height >= heightPoleStrong) {
    triggers.push(
      `height ${formatDimensionDisplay(load.height)} ≥ ${formatDimensionDisplay(heightPoleStrong)}`
    )
    heightPoleLevel = 'required'
    escortCount = Math.max(escortCount, 1) as 0 | 1 | 2
    if (requirementLevel === 'none' || requirementLevel === 'may_require') {
      requirementLevel = 'may_require'
    }
  }""",
        """  if (load.height >= heightPoleStrong) {
    triggers.push(
      `height ${formatDimensionDisplay(load.height)} ≥ ${formatDimensionDisplay(heightPoleStrong)}`
    )
    heightPoleLevel = 'required'
    escortCount = Math.max(escortCount, 1) as 0 | 1 | 2
    // Tall loads (≥ ~15'6\") typically need hard escort + height pole, not soft \"may\".
    requirementLevel = 'required'
  }""",
        "escort tall → required",
    )

    must_replace(
        esc,
        """function analyzeFromStructuredBands(
  stateCode: string,
  load: EscortLoadDimensions,
  structured: StructuredEscortRules,
  highwayContext: string | undefined,
  roadClassHint: RoadClassHint
): StateEscortDetail | null {
  const bands = structured.bands || []
  if (bands.length === 0) return null

  let best: EscortRuleBand | null = null
  const triggers: string[] = []

  for (const band of bands) {
    if (!bandMatches(band, load)) continue
    const { when } = band
    if (when.minWidthFt != null && load.width >= when.minWidthFt) {
      triggers.push(
        `width ${formatDimensionDisplay(load.width)} ≥ ${formatDimensionDisplay(when.minWidthFt)}`
      )
    }
    if (when.minHeightFt != null && load.height >= when.minHeightFt) {
      triggers.push(
        `height ${formatDimensionDisplay(load.height)} ≥ ${formatDimensionDisplay(when.minHeightFt)}`
      )
    }
    if (when.minLengthFt != null && load.length >= when.minLengthFt) {
      triggers.push(
        `length ${formatDimensionDisplay(load.length)} ≥ ${formatDimensionDisplay(when.minLengthFt)}`
      )
    }
    if (when.minWeightLbs != null && load.weight >= when.minWeightLbs) {
      triggers.push(
        `weight ${load.weight.toLocaleString()} lbs ≥ ${when.minWeightLbs.toLocaleString()} lbs`
      )
    }

    if (
      !best ||
      band.count > best.count ||
      (band.requirement === 'required' && best.requirement !== 'required')
    ) {
      best = band
    }
  }

  if (!best) return null

  const escortCount = clampCount(best.count)
  const heightPoleLevel: HeightPoleLevel = best.heightPole || 'none'
  const positions =
    best.positions && best.positions.length > 0
      ? best.positions
      : defaultPositions(escortCount)
  const escortTypes =
    best.types && best.types.length > 0
      ? best.types
      : escortCount > 0
        ? (['civilian'] as EscortVehicleType[])
        : []

  let requirementLevel: EscortRequirementLevel = best.requirement
  if (
    roadClassHint === 'local' &&
    best.roadClasses &&
    best.roadClasses.length > 0 &&
    !best.roadClasses.includes('local')
  ) {
    requirementLevel = 'may_require'
  }

  const detailBase = {
    stateCode,
    requirementLevel,
    escortCount,
    heightPoleLevel,
    positions,
    escortTypes,
    highwayContext,
  }

  return {
    stateCode,
    escortCount,
    heightPoleRecommended: heightPoleLevel !== 'none',
    heightPoleLevel,
    requirementLevel,
    positions,
    escortTypes,
    roadClassHint,
    highwayContext,
    warning: buildWarning(detailBase),
    triggers: [...new Set(triggers)],
    notes: best.notes || structured.defaultNote,
  }
}""",
        """function analyzeFromStructuredBands(
  stateCode: string,
  load: EscortLoadDimensions,
  structured: StructuredEscortRules,
  highwayContext: string | undefined,
  roadClassHint: RoadClassHint
): StateEscortDetail | null {
  const bands = structured.bands || []
  if (bands.length === 0) return null

  const triggers: string[] = []
  let escortCount: 0 | 1 | 2 = 0
  let requirementLevel: EscortRequirementLevel = 'none'
  let heightPoleLevel: HeightPoleLevel = 'none'
  const positionsSet = new Set<EscortPosition>()
  const typesSet = new Set<EscortVehicleType>()
  const notes: string[] = []
  let matched = false

  for (const band of bands) {
    if (!bandMatches(band, load)) continue
    matched = true
    const { when } = band
    if (when.minWidthFt != null && load.width >= when.minWidthFt) {
      triggers.push(
        `width ${formatDimensionDisplay(load.width)} ≥ ${formatDimensionDisplay(when.minWidthFt)}`
      )
    }
    if (when.minHeightFt != null && load.height >= when.minHeightFt) {
      triggers.push(
        `height ${formatDimensionDisplay(load.height)} ≥ ${formatDimensionDisplay(when.minHeightFt)}`
      )
    }
    if (when.minLengthFt != null && load.length >= when.minLengthFt) {
      triggers.push(
        `length ${formatDimensionDisplay(load.length)} ≥ ${formatDimensionDisplay(when.minLengthFt)}`
      )
    }
    if (when.minWeightLbs != null && load.weight >= when.minWeightLbs) {
      triggers.push(
        `weight ${load.weight.toLocaleString()} lbs ≥ ${when.minWeightLbs.toLocaleString()} lbs`
      )
    }

    escortCount = clampCount(Math.max(escortCount, band.count || 0))
    if (band.requirement === 'required') {
      requirementLevel = 'required'
    } else if (requirementLevel === 'none') {
      requirementLevel = 'may_require'
    }

    if (band.heightPole === 'required') {
      heightPoleLevel = 'required'
    } else if (band.heightPole === 'recommended' && heightPoleLevel === 'none') {
      heightPoleLevel = 'recommended'
    }

    for (const pos of band.positions || []) positionsSet.add(pos)
    for (const typ of band.types || []) typesSet.add(typ)
    if (band.notes) notes.push(band.notes)
  }

  if (!matched) return null

  // Tall + height-pole-required bands elevate to hard required.
  if (heightPoleLevel === 'required' && requirementLevel === 'may_require') {
    requirementLevel = 'required'
  }

  if (
    roadClassHint === 'local' &&
    requirementLevel === 'required' &&
    escortCount < 2
  ) {
    requirementLevel = 'may_require'
  }

  const positions =
    positionsSet.size > 0
      ? (Array.from(positionsSet) as EscortPosition[])
      : defaultPositions(escortCount)
  const escortTypes =
    typesSet.size > 0
      ? (Array.from(typesSet) as EscortVehicleType[])
      : escortCount > 0
        ? (['civilian'] as EscortVehicleType[])
        : []

  const detailBase = {
    stateCode,
    requirementLevel,
    escortCount,
    heightPoleLevel,
    positions,
    escortTypes,
    highwayContext,
  }

  return {
    stateCode,
    escortCount,
    heightPoleRecommended: heightPoleLevel !== 'none',
    heightPoleLevel,
    requirementLevel,
    positions,
    escortTypes,
    roadClassHint,
    highwayContext,
    warning: buildWarning(detailBase),
    triggers: [...new Set(triggers)],
    notes: notes[0] || structured.defaultNote,
  }
}""",
        "escort merge matching bands",
    )

    # --- 3) Permit agent: clean dimensions + corridor-only DOT flags ---
    agent = ROOT / "agents" / "permit-agent.ts"
    agent_text = agent.read_text(encoding="utf-8")
    if "formatDimensionDisplay" not in agent_text:
        agent_text = agent_text.replace(
            """import {
  effectiveEnvelopeLengthThreshold,
  needsLengthPermit,
} from '@/lib/permit-length'""",
            """import {
  effectiveEnvelopeLengthThreshold,
  needsLengthPermit,
} from '@/lib/permit-length'
import { formatDimensionDisplay } from '@/lib/parse-dimension'""",
            1,
        )
        agent.write_text(agent_text, encoding="utf-8")
        print("OK permit-agent import")
    else:
        print("OK permit-agent import already present")

    must_replace(
        agent,
        """        const exceeded: string[] = []
        if (load.width  > permitWidth)  exceeded.push(`width ${load.width} > ${permitWidth}`)
        if (load.height > permitHeight) exceeded.push(`height ${load.height} > ${permitHeight}`)
        if (needsLength) {
          exceeded.push(`envelope length ${load.length} > ${permitLengthThreshold}`)
        }
        if (load.weight > permitWeight) exceeded.push(`weight ${load.weight} > ${permitWeight}`)

        reasons.push(`${state}: Permit required — exceeds ${exceeded.join(', ')}`)""",
        """        const exceeded: string[] = []
        if (load.width  > permitWidth) {
          exceeded.push(`width ${formatDimensionDisplay(load.width)} > ${formatDimensionDisplay(permitWidth)}`)
        }
        if (load.height > permitHeight) {
          exceeded.push(`height ${formatDimensionDisplay(load.height)} > ${formatDimensionDisplay(permitHeight)}`)
        }
        if (needsLength) {
          exceeded.push(
            `envelope length ${formatDimensionDisplay(load.length)} > ${formatDimensionDisplay(permitLengthThreshold)}`
          )
        }
        if (load.weight > permitWeight) {
          exceeded.push(`weight ${load.weight.toLocaleString()} lbs > ${permitWeight.toLocaleString()} lbs`)
        }

        reasons.push(`${state}: Permit required — exceeds ${exceeded.join(', ')}`)""",
        "permit-agent dimension format",
    )

    must_replace(
        agent,
        """    for (const r of dotRestrictionsRaw) {
      if (exceedsCorridorRestriction(load, r)) {
        permitRequiredStates.add(r.state)

        const restrictionDesc = `${r.highway}${r.mileMarker ? ' ' + r.mileMarker : ''} (${r.value}${r.unit || ''})`

        reasons.push(
          `${r.state}: Permit required — load exceeds specific DOT-posted restriction on ${restrictionDesc}. ${r.description.slice(0, 120)}${r.description.length > 120 ? '...' : ''}`
        )
      }
    }""",
        """    const corridorStateSet = new Set(routeCorridor.map((s) => s.toUpperCase()))
    for (const r of dotRestrictionsRaw) {
      // Defense in depth: never flag a state outside this route corridor.
      if (!corridorStateSet.has(r.state.toUpperCase())) continue
      if (!exceedsCorridorRestriction(load, r)) continue

      permitRequiredStates.add(r.state)

      const valueLabel =
        r.unit === 'ft' && typeof r.value === 'number'
          ? formatDimensionDisplay(r.value)
          : r.unit === 'lbs' && typeof r.value === 'number'
            ? `${r.value.toLocaleString()} lbs`
            : `${r.value ?? ''}${r.unit || ''}`
      const restrictionDesc = `${r.highway}${r.mileMarker ? ` ${r.mileMarker}` : ''} (${valueLabel})`
      const shortDesc =
        r.description.length > 90 ? `${r.description.slice(0, 90).trim()}…` : r.description

      reasons.push(
        `${r.state}: Exceeds posted limit on ${restrictionDesc}. ${shortDesc}`
      )
    }""",
        "permit-agent corridor-only DOT reasons",
    )

    print("\nAll patches applied. Next:")
    print('  git add lib/dot-corridor-restrictions.ts lib/escort-analysis.ts agents/permit-agent.ts')
    print('  git commit -m "fix(corridor): gate restrictions; hard required for tall; clean reasons"')
    print("  git push -u origin HEAD")


if __name__ == "__main__":
    main()
