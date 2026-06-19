"""
or-tools-service/app/utils/constraints.py

OSOW-aware constraints and penalty helpers for the VRP solver.

- _add_osow_penalty (used inside distance_callback to bias routing)
- check_violations (dim + DOT restriction warnings for permitWarnings)
- get_restrictions_for_highway
- Basic dimension / axle helpers

These are "soft" for the MVP (penalties + warnings). Full hard constraints via
OR-Tools Dimensions (bridge formula, axle groups, kingpin setting, turn radius)
are noted as extension points.
"""

from __future__ import annotations

import math
import re
from typing import Any

from ..config import (
    LEGAL_HEIGHT_FT,
    LEGAL_LENGTH_FT,
    LEGAL_WEIGHT_LBS,
    LEGAL_WIDTH_FT,
    PENALTY_AXLE_OVER,
    PENALTY_AXLE_SPACING,
    PENALTY_HEIGHT,
    PENALTY_LENGTH,
    PENALTY_WEIGHT,
    PENALTY_WIDTH,
    PRIORITY_RESTRICTIONS,
)


def _add_osow_penalty(load: dict[str, Any], from_idx: int, to_idx: int) -> int:
    """
    Return additional cost (meters) to add to a VRP arc for this OSOW load.

    MVP: threshold-based soft penalties. Larger penalty => solver prefers to avoid
    that transition when ordering vias (but still finds a tour).
    Note: hard avoid-state enforcement (for specialInstructions "avoid AR") is done in
    solver _build_distance_matrix via AVOID_STATE_CROSSING_PENALTY on actual leg geometry
    (before VRP); this keeps only OSOW dim/axle soft bias here.

    Extension points (full OSOW):
    - Add routing.Dimension for axle_group_weight
    - Bridge formula using axle_spacings + axle_weights + length + kingpin
    - Vehicle-specific turn radius / lowboy constraints per tractor profile
    - Time windows from curfew notes in special_instructions
    """
    w = float(load.get("width", 0) or 0)
    h = float(load.get("height", 0) or 0)
    l = float(load.get("length", 0) or 0)
    wt = float(load.get("weight", 0) or 0)

    penalty = 0
    if w > LEGAL_WIDTH_FT:
        penalty += PENALTY_WIDTH
    if h > LEGAL_HEIGHT_FT:
        penalty += PENALTY_HEIGHT
    if l > LEGAL_LENGTH_FT:
        penalty += PENALTY_LENGTH
    if wt > LEGAL_WEIGHT_LBS:
        penalty += PENALTY_WEIGHT

    # Crude axle group checks (if data present)
    axles = load.get("axle_weights") or load.get("axleWeights") or []
    if axles:
        try:
            max_axle = max([float(x) for x in axles if x])
            if max_axle > 20000:
                penalty += PENALTY_AXLE_OVER
        except Exception:
            pass

    spacings = load.get("axle_spacings") or load.get("axleSpacings") or []
    if spacings and len(spacings) >= 2 and wt > LEGAL_WEIGHT_LBS:
        try:
            if any(float(s) < 40 for s in spacings if s):
                penalty += PENALTY_AXLE_SPACING
        except Exception:
            pass

    # Overhang contribution (front affects swept path / bridge on some corridors)
    front_oh, _ = _get_overhangs(load)
    if front_oh > 3.0 and (l > 53 or wt > LEGAL_WEIGHT_LBS):
        penalty += 3000

    return penalty


def _get_overhangs(load: dict[str, Any]) -> tuple[float, float]:
    front = (
        load.get("overhang_front_ft")
        or load.get("loadOverhangFrontFt")
        or load.get("overhangFrontFt")
        or 0.0
    )
    rear = (
        load.get("overhang_rear_ft")
        or load.get("loadOverhangRearFt")
        or load.get("overhangRearFt")
        or 0.0
    )
    return (float(front or 0), float(rear or 0))


def get_restrictions_for_highway(highway_plain: str, state: str | None = None) -> list[dict[str, Any]]:
    """Return matching restrictions for a plain highway name (I-40) on optional state."""
    h = highway_plain.split(" (")[0].strip().upper()
    matches = []
    for r in PRIORITY_RESTRICTIONS:
        if r["highway"].upper() == h:
            if state is None or r["state"].upper() == state.upper():
                matches.append(r)
    return matches


def check_violations(load: dict[str, Any], highways_enriched: list[str], states: list[str]) -> list[str]:
    """
    For each highway on the route, emit warnings when load exceeds posted restriction.
    Curfew/seasonal are emitted as soft notes (no hard value).
    """
    warnings: list[str] = []
    w = float(load.get("width", 0) or 0)
    hgt = float(load.get("height", 0) or 0)
    l = float(load.get("length", 0) or 0)  # noqa: F841 (length rarely has direct posted here)
    wt = float(load.get("weight", 0) or 0)

    for hwy in highways_enriched or []:
        plain = hwy.split(" (")[0]
        for st in states or []:
            for r in get_restrictions_for_highway(plain, st):
                if r.get("value") is None:
                    if r["type"] in ("curfew", "seasonal", "route_advisory"):
                        warnings.append(f"{r['state']}: {r['highway']} {r.get('description', '')[:80]}")
                    continue
                val = float(r["value"])
                unit = r.get("unit")
                if r["type"] in ("height", "bridge_clearance", "tunnel") and unit == "ft" and hgt > val:
                    warnings.append(
                        f"{r['state']} {r['highway']}: load height {hgt}ft exceeds posted {val}{unit} ({r.get('description','')[:60]})"
                    )
                elif r["type"] == "weight" and unit in ("lbs", "tons") and wt > val:
                    warnings.append(
                        f"{r['state']} {r['highway']}: load weight {wt}lbs exceeds posted {val}{unit} ({r.get('description','')[:60]})"
                    )
                elif r["type"] == "width" and unit == "ft" and w > val:
                    warnings.append(
                        f"{r['state']} {r['highway']}: load width {w}ft exceeds posted {val}{unit}"
                    )
    # Dedup preserve order
    return list(dict.fromkeys(warnings))


def exceeds_legal(load: dict[str, Any]) -> list[str]:
    """Return list of simple 'exceeds legal' strings for quick checks."""
    out: list[str] = []
    if float(load.get("width", 0) or 0) > LEGAL_WIDTH_FT:
        out.append(f"width > {LEGAL_WIDTH_FT} ft")
    if float(load.get("height", 0) or 0) > LEGAL_HEIGHT_FT:
        out.append(f"height > {LEGAL_HEIGHT_FT} ft")
    if float(load.get("length", 0) or 0) > LEGAL_LENGTH_FT:
        out.append(f"length > {LEGAL_LENGTH_FT} ft")
    if float(load.get("weight", 0) or 0) > LEGAL_WEIGHT_LBS:
        out.append(f"weight > {LEGAL_WEIGHT_LBS} lbs")
    return out


def compute_permit_ready(warnings: list[str], critical_keywords: list[str] | None = None) -> bool:
    """Conservative permitReady: no critical dim/weight issues + not too many soft warnings."""
    if critical_keywords is None:
        critical_keywords = ["exceeds posted", "height", "weight", "width"]
    critical = [
        w for w in warnings
        if any(k in w.lower() for k in critical_keywords) and "curfew" not in w.lower() and "seasonal" not in w.lower()
    ]
    soft_count = len([w for w in warnings if "avoided state" not in w.lower()])
    return len(critical) == 0 and soft_count < 4
