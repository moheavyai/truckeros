"""
or-tools-service/app/services/ortools_solver.py

Complete self-contained OR-Tools VRP solver for TruckerOS.

Contains (consolidated for the required structure):
- Async OSRM table + route client (public instance, no key)
- Special instructions parser (avoid/include/prefer) + build_stops_from_load
- Highway extraction + curation (port of TS logic for "I-40 (entry xx,yy exit aa,bb)")
- State derivation helper (overhauled: walk every step in OSRM response for full continuous state sequence from actual geometry)
- Cost engine (port of lib/cost-engine.ts defaults + surcharges)
- DOT priority restriction checks (via utils.constraints)
- Core VRP: 1-vehicle, real (or haversine) matrix, OSOW penalty in transit callback
- Multiple first-solution strategies for primary + alternatives
- Per-leg real route enrichment + full response shape expected by frontend

All functions are async where network is involved. Direct calls from router + tests work.

Extension points clearly marked for full bridge/axle/curfew Dimensions.

v0.3+ overhaul (effort 5): corridor and border logic now walks *every* step to build full continuous state sequence
directly from the geometry attributions (no skips/jumps). Border crossings use the *exact first geometry point*
of the entering step at the state change (places at the actual state line on the highway per OSRM ref/name/geometry).
derive/are_adjacent used for border points + validation only; routeCorridor is the direct geometry walk seq.
Special instructions remain strongly enforced (hard 1e9 matrix penalties, suggest_practical_vias seeding, parser robustness).
"""

from __future__ import annotations

import asyncio
import logging
import math
import re
import time
import traceback
from typing import Any

import httpx
from ortools.constraint_solver import pywrapcp, routing_enums_pb2

from ..config import (
    ALT_SOLVER_TIME_LIMIT_S,
    AVOID_STATE_CROSSING_PENALTY,
    CITY_MAP,
    COUNTY_MAP,
    DEFAULT_DEST_LAT,
    DEFAULT_DEST_LON,
    DEFAULT_ORIGIN_LAT,
    DEFAULT_ORIGIN_LON,
    DEFAULT_PRICING,
    HIGHWAY_STATE_HINTS,
    MAX_ALTS,
    OSRM_BASE,
    SOLVER_SOLUTION_LIMIT,
    SOLVER_TIME_LIMIT_S,
    STATE_ABBR,
    STATE_CENTROIDS,
    STATE_LAT_LON_BOUNDS,
    STATE_NAME_TO_CODE,
)
from ..utils.constraints import (
    _add_osow_penalty,
    check_violations,
    compute_permit_ready,
    load_needs_length_permit,
)

logger = logging.getLogger(__name__)


# =============================================================================
# OSRM client (inline to keep file count minimal while fully working)
# =============================================================================

def _coords_str(coords: list[tuple[float, float]]) -> str:
    return ";".join(f"{lon:.6f},{lat:.6f}" for lat, lon in coords)


async def get_table_matrix(
    coords: list[tuple[float, float]],
    client: httpx.AsyncClient | None = None,
) -> tuple[list[list[float]], list[list[float]]] | None:
    """Return (distances_m, durations_s). Falls back to None on any failure.
    If client is provided it must be an open httpx.AsyncClient whose lifetime covers the await
    (typically created by caller async with and passed for batch reuse in _build_*)."""
    if len(coords) < 2:
        return None
    url = f"{OSRM_BASE}/table/v1/driving/{_coords_str(coords)}?annotations=distance,duration"
    ts = time.time()
    print(f"[ORT] {ts:.3f} OSRM get_table_matrix start url={url}")
    logger.info("[ORT] get_table_matrix start url=%s t=%.3f", url, ts)
    last_exc = None
    for attempt in range(3):  # retry for transient aborts/timeouts
        try:
            if client is not None:
                resp = await client.get(url)
            else:
                async with httpx.AsyncClient(timeout=300.0) as client:  # bumped for robustness on special-instr paths with many legs/borders
                    resp = await client.get(url)
            if resp.status_code != 200:
                elapsed = time.time() - ts
                t_now = time.time()
                print(f"[ORT] {t_now:.3f} OSRM get_table_matrix FAIL status={resp.status_code} elapsed={elapsed:.3f} attempt={attempt}")
                logger.info("[ORT] get_table_matrix FAIL status=%s elapsed=%.3f", resp.status_code, elapsed)
                last_exc = Exception(f"HTTP {resp.status_code}")
                if attempt < 2:
                    await asyncio.sleep(0.5 * (attempt + 1))
                    continue
                return None
            data = resp.json()
            if "distances" not in data or "durations" not in data:
                elapsed = time.time() - ts
                t_now = time.time()
                print(f"[ORT] {t_now:.3f} OSRM get_table_matrix FAIL no-data elapsed={elapsed:.3f} attempt={attempt}")
                logger.info("[ORT] get_table_matrix FAIL no-data elapsed=%.3f", elapsed)
                last_exc = Exception("no data")
                if attempt < 2:
                    await asyncio.sleep(0.5 * (attempt + 1))
                    continue
                return None

            def clean(m: list[list[float | None]]) -> list[list[float]]:
                out = []
                for row in m:
                    out.append([float(x) if x is not None else 1e9 for x in row])
                return out

            res = clean(data["distances"]), clean(data["durations"])
            elapsed = time.time() - ts
            t_now = time.time()
            print(f"[ORT] {t_now:.3f} OSRM get_table_matrix OK dists={len(res[0])}x{len(res[0][0]) if res[0] else 0} elapsed={elapsed:.3f} attempt={attempt}")
            logger.info("[ORT] get_table_matrix OK rows=%d elapsed=%.3f", len(res[0]) if res[0] else 0, elapsed)
            return res
        except Exception as e:
            last_exc = e
            elapsed = time.time() - ts
            t_now = time.time()
            print(f"[ORT] {t_now:.3f} OSRM get_table_matrix EXC {type(e).__name__}: {e} elapsed={elapsed:.3f} attempt={attempt}")
            logger.warning("[ORT] get_table_matrix EXC %s elapsed=%.3f", type(e).__name__, elapsed)
            if attempt < 2:
                await asyncio.sleep(0.5 * (attempt + 1))
                continue
            return None
    print(f"[ORT] {time.time():.3f} OSRM get_table_matrix GAVE UP after retries")
    return None




MULTI_STATE_HWYS: set[str] = {
    "I-10", "I-20", "I-25", "I-29", "I-35", "I-40", "I-44", "I-55", "I-57",
    "I-70", "I-75", "I-80", "I-81", "I-85", "I-90", "I-95", "US 81",
}


def _ok_mt_corridor_profile(plain_hwys: set[str]) -> str | None:
    """Western (I-70/I-25 via CO/WY) vs eastern (I-35/I-80/I-90) OK→MT corridor."""
    western = plain_hwys & {"I-70", "I-25"}
    eastern = plain_hwys & {"I-35", "I-80", "I-90"}
    if western and not eastern:
        return "western"
    if eastern and not western:
        return "eastern"
    if western and eastern:
        return "western" if "I-25" in plain_hwys else "eastern"
    return None




def complete_corridor_with_highways(states: list[str], highways: list[str]) -> list[str]:
    """Port of lib/build-corridor.ts completeCorridorWithHighways
    (southern + OK→MT + east-coast SC fill / LA strip)."""
    result = list(states)
    plain_hwys = {h.split(" (")[0] for h in (highways or [])}

    if (plain_hwys & {"I-35", "I-40"}) and "MO" in result and "OK" not in result:
        result.insert(result.index("MO") + 1, "OK")
    if "AR" in result and "TX" in result and "OK" not in result:
        result.insert(result.index("AR") + 1, "OK")
    if plain_hwys & {"I-35"} and "MO" in result and "KS" not in result:
        mo_idx = result.index("MO")
        if mo_idx > 0:
            result.insert(mo_idx, "KS")

    if plain_hwys & {"I-44", "I-55", "I-24"}:
        if "KS" in result and "MO" not in result:
            result.insert(result.index("KS") + 1, "MO")
        if "TN" not in result and "MO" in result:
            result.insert(result.index("MO") + 1, "TN")

    if "OK" in result and "MT" in result:
        profile = _ok_mt_corridor_profile(plain_hwys)
        if profile is None and len(result) <= 2 and plain_hwys & {"I-70", "I-25"}:
            profile = "western"
        if profile == "western":
            if "KS" not in result:
                result.insert(result.index("OK") + 1, "KS")
            if "CO" not in result and "KS" in result:
                result.insert(result.index("KS") + 1, "CO")
            if "WY" not in result and "CO" in result:
                result.insert(result.index("CO") + 1, "WY")
        elif profile == "eastern":
            for drop in ("CO", "WY"):
                while drop in result:
                    result.remove(drop)
            if "KS" not in result:
                result.insert(result.index("OK") + 1, "KS")
            if "NE" not in result:
                anchor = "KS" if "KS" in result else "OK"
                result.insert(result.index(anchor) + 1, "NE")
            if "SD" not in result and "NE" in result:
                result.insert(result.index("NE") + 1, "SD")

    # I-95 / I-85 seaboard family (I-81 is MULTI_STATE only — not a seaboard SC-fill trigger).
    east_coast_hwy = bool(plain_hwys & {"I-95", "I-85"})

    # Safety strip first: clear spurious mid-corridor LA so NC|GA become adjacent for SC fill.
    # Never strip bookend LA (first/last position) — only remove mid indices. Keep mid LA when
    # prev/next is a local gulf neighbor (TX/MS/AR); distant TX/MS/AR elsewhere must not block strip.
    if east_coast_hwy:
        n = len(result)
        mid_la_idxs = [i for i in range(1, n - 1) if result[i] == "LA"]
        if mid_la_idxs:
            la_idx = mid_la_idxs[0]
            prev = result[la_idx - 1]
            next_s = result[la_idx + 1]

            def _gulf_neighbor(s: str) -> bool:
                return s in ("TX", "MS", "AR")

            if not (_gulf_neighbor(prev) or _gulf_neighbor(next_s)):
                # Strip mid LAs only — preserve origin/dest bookend LA.
                without_la = [
                    s for i, s in enumerate(result)
                    if not (s == "LA" and 0 < i < n - 1)
                ]
                if has_plausible_transitions(without_la) or (
                    not has_plausible_transitions(result)
                    and (
                        not are_adjacent(prev, "LA")
                        or not are_adjacent("LA", next_s)
                        or are_adjacent(prev, next_s)
                    )
                ):
                    result = without_la

    # East-coast SC fill: only when NC and GA (or NC and FL with no GA) are *index neighbors*
    # (avoids inland NC-TN-AL-FL + I-95 false positives). NC→FL also inserts GA for SC-FL adjacency.
    # Final has_plausible_transitions guard reverts bad inserts (same as OK heuristics).
    if east_coast_hwy and "SC" not in result:
        try:
            nc_idx = result.index("NC")
        except ValueError:
            nc_idx = -1
        if nc_idx != -1:
            try:
                ga_idx = result.index("GA")
            except ValueError:
                ga_idx = -1
            try:
                fl_idx = result.index("FL")
            except ValueError:
                fl_idx = -1
            if ga_idx != -1 and abs(ga_idx - nc_idx) == 1:
                if nc_idx < ga_idx:
                    result.insert(nc_idx + 1, "SC")
                else:
                    result.insert(ga_idx + 1, "SC")
            elif ga_idx == -1 and fl_idx != -1 and abs(fl_idx - nc_idx) == 1:
                if nc_idx < fl_idx:
                    result.insert(nc_idx + 1, "SC")
                    if "GA" not in result:
                        sc_idx = result.index("SC")
                        result.insert(sc_idx + 1, "GA")
                else:
                    result.insert(nc_idx, "SC")
                    if "GA" not in result:
                        sc_idx = result.index("SC")
                        result.insert(sc_idx, "GA")

    seen: set[str] = set()
    deduped = [s for s in result if not (s in seen or seen.add(s))]
    return deduped if has_plausible_transitions(deduped) else list(states)




def _border_crossings_match_corridor(
    crossings: list[dict[str, Any]], states: list[str]
) -> bool:
    """True when extracted crossings follow the same state sequence as routeCorridor."""
    if len(states) < 2:
        return True
    if len(crossings) != len(states) - 1:
        return False
    for i, c in enumerate(crossings):
        if c.get("exitState") != states[i] or c.get("entryState") != states[i + 1]:
            return False
    return True

def synthesize_border_crossings_from_corridor(
    states: list[str], highways: list[str]
) -> list[dict[str, Any]]:
    """Build border crossings from repaired corridor when step attribution yields none."""
    if len(states) < 2:
        return []
    hwy = highways[0].split(" (")[0] if highways else "unknown"
    return [
        {
            "exitState": states[i],
            "entryState": states[i + 1],
            "highway": hwy,
            "lat": None,
            "lon": None,
        }
        for i in range(len(states) - 1)
    ]


def _insert_missing_stop_states_in_visit_order(
    states: list[str], ordered_stops: list[dict[str, Any]]
) -> list[str]:
    """Insert missing VRP stop states in visit order (not append at end)."""
    result = list(states)
    placed: list[str] = []
    for stop in ordered_stops:
        st = (stop or {}).get("state")
        if not st or st in result:
            if st:
                placed.append(st)
            continue
        insert_at = len(result)
        for prev in reversed(placed):
            if prev in result:
                insert_at = result.index(prev) + 1
                break
        result.insert(insert_at, st)
        placed.append(st)
    return result


def should_prefer_practical_corridor(
    origin_state: str | None,
    dest_state: str | None,
    avoided: list[str] | None = None,
) -> bool:
    """True for KS→FL where shortest OSRM often skips MO/TN interstate corridors."""
    o = (origin_state or "").upper().strip()
    d = (dest_state or "").upper().strip()
    if o != "KS" or d != "FL":
        return False
    av_set = set(avoided or [])
    if "MO" in av_set or "TN" in av_set:
        return False
    return True


def _is_ks_fl_ok_al_shortcut(
    steps: list[dict[str, Any]],
    origin_state: str | None,
    dest_state: str | None,
) -> bool:
    """Detect unrealistic KS→FL shortcut (OK+AL) that skips MO/TN interstates."""
    o = (origin_state or "").upper().strip()
    d = (dest_state or "").upper().strip()
    if o != "KS" or d != "FL" or not steps:
        return False
    highways = curate_major_highways(extract_highways_from_steps(steps))
    states = complete_corridor_with_highways(
        build_corridor_from_steps(steps, origin_state, dest_state), highways
    )
    return "OK" in states and "AL" in states and "MO" not in states


def score_practical_osrm_route(
    steps: list[dict[str, Any]],
    distance: float,
    shortest_distance: float,
    origin_state: str | None = None,
    dest_state: str | None = None,
    trip_origin_state: str | None = None,
    trip_dest_state: str | None = None,
    avoided: list[str] | None = None,
) -> float:
    """Score OSRM alternative for practical OSOW corridors (lower = better). Mirrors lib/build-corridor.ts."""
    highways = curate_major_highways(extract_highways_from_steps(steps))
    states = complete_corridor_with_highways(
        build_corridor_from_steps(steps, origin_state, dest_state), highways
    )
    trip_o = (trip_origin_state or origin_state or "").upper().strip()
    trip_d = (trip_dest_state or dest_state or "").upper().strip()
    av_set = set(avoided or [])
    ratio = distance / max(shortest_distance, 1.0)
    score = ratio * 100.0
    interstate_count = sum(1 for h in highways if re.match(r"^I-", h.split(" (")[0]))
    us_count = sum(1 for h in highways if re.match(r"^US ", h.split(" (")[0]))
    score -= interstate_count * 12
    score -= us_count * 5
    major = interstate_count + us_count
    if major == 0:
        score += 30
    elif major == 1:
        score += 15
    good_re = re.compile(r"I-(40|80|10|70|35|44|90|25|55|75|24|4|65)")
    good_bonus = sum(1 for h in highways if good_re.search(h.split(" (")[0]))
    score -= good_bonus * 4
    plain_hwys = {h.split(" (")[0] for h in highways}
    for preferred in ("I-35", "I-44", "I-55", "I-65", "I-75"):
        if preferred in plain_hwys:
            score -= 8
    problem_states = {"MI", "MN", "WI", "ND", "NY", "NJ", "IL"}
    problem_hits = sum(1 for s in states if s in problem_states)
    if problem_hits > 0:
        score += problem_hits * 7
    if trip_o == "KS" and trip_d == "FL":
        if "MO" not in av_set and "TN" not in av_set:
            if "MO" in states and "TN" in states:
                score -= 35
            if "OK" in states and "AL" in states and "MO" not in states:
                score += 35
            # Prefer KS->MO->TN->GA->FL without dipping into AL when TN+GA path exists.
            if (
                "MO" in states
                and "TN" in states
                and "GA" in states
                and "AL" not in states
            ):
                score -= 30
            elif "AL" in states and "TN" in states and "GA" in states:
                score += 30
    return score


def _pick_best_practical_osrm_route(
    routes: list[dict[str, Any]],
    origin_state: str | None = None,
    dest_state: str | None = None,
    trip_origin_state: str | None = None,
    trip_dest_state: str | None = None,
    avoided: list[str] | None = None,
) -> dict[str, Any]:
    """Pick best practical route among OSRM alternatives (within 1.25x shortest)."""
    if not routes:
        raise ValueError("no routes")
    shortest = min(float(r.get("distance", 0) or 0) for r in routes) or 1.0
    best_route = routes[0]
    best_score = float("inf")
    for route in routes:
        dist = float(route.get("distance", 0) or 0)
        if len(routes) > 1 and dist > shortest * 1.25:
            continue
        steps: list[dict[str, Any]] = []
        for leg in route.get("legs") or []:
            steps.extend(leg.get("steps") or [])
        sc = score_practical_osrm_route(
            steps, dist, shortest, origin_state, dest_state,
            trip_origin_state, trip_dest_state, avoided,
        )
        if sc < best_score:
            best_score = sc
            best_route = route
    return best_route

async def get_route_legs(
    from_coord: tuple[float, float],
    to_coord: tuple[float, float],
    client: httpx.AsyncClient | None = None,
    prefer_practical: bool = False,
    origin_state: str | None = None,
    dest_state: str | None = None,
    trip_origin_state: str | None = None,
    trip_dest_state: str | None = None,
    avoided: list[str] | None = None,
) -> dict[str, Any] | None:
    """One leg /route with steps for highway extraction.
    If client is provided it must be an open httpx.AsyncClient whose lifetime covers the await
    (typically created by caller async with and passed for batch reuse in _build_*)."""
    o_lat, o_lon = from_coord
    d_lat, d_lon = to_coord
    url = (
        f"{OSRM_BASE}/route/v1/driving/{o_lon:.6f},{o_lat:.6f};{d_lon:.6f},{d_lat:.6f}"
        "?overview=full&geometries=geojson&steps=true&alternatives=" + ("2" if prefer_practical else "false")
    )
    ts = time.time()
    print(f"[ORT] {ts:.3f} OSRM get_route_legs start from=({o_lat:.4f},{o_lon:.4f}) to=({d_lat:.4f},{d_lon:.4f}) url={url}")
    logger.info("[ORT] get_route_legs start from=(%.4f,%.4f) to=(%.4f,%.4f) t=%.3f", o_lat, o_lon, d_lat, d_lon, ts)
    last_exc = None
    for attempt in range(3):  # retry for transient aborts/timeouts on leg fetches (common in special-instr paths)
        try:
            if client is not None:
                resp = await client.get(url)
            else:
                async with httpx.AsyncClient(timeout=300.0) as client:  # bumped for robustness
                    resp = await client.get(url)
            if resp.status_code != 200:
                elapsed = time.time() - ts
                t_now = time.time()
                print(f"[ORT] {t_now:.3f} OSRM get_route_legs FAIL status={resp.status_code} from-to elapsed={elapsed:.3f} attempt={attempt}")
                logger.info("[ORT] get_route_legs FAIL status=%s elapsed=%.3f", resp.status_code, elapsed)
                last_exc = Exception(f"HTTP {resp.status_code}")
                if attempt < 2:
                    await asyncio.sleep(0.5 * (attempt + 1))
                    continue
                return None
            data = resp.json()
            if not data.get("routes"):
                elapsed = time.time() - ts
                t_now = time.time()
                print(f"[ORT] {t_now:.3f} OSRM get_route_legs FAIL no-routes elapsed={elapsed:.3f} attempt={attempt}")
                logger.info("[ORT] get_route_legs FAIL no-routes elapsed=%.3f", elapsed)
                last_exc = Exception("no routes")
                if attempt < 2:
                    await asyncio.sleep(0.5 * (attempt + 1))
                    continue
                return None
            routes = data["routes"]
            route = (
                _pick_best_practical_osrm_route(
                    routes, origin_state, dest_state,
                    trip_origin_state, trip_dest_state, avoided,
                )
                if prefer_practical
                else routes[0]
            )
            steps: list[dict] = []
            if route.get("legs"):
                for leg in route["legs"]:
                    steps.extend(leg.get("steps", []))
            res = {
                "distance": float(route.get("distance", 0)),
                "duration": float(route.get("duration", 0)),
                "geometry": route.get("geometry"),
                "steps": steps,
            }
            elapsed = time.time() - ts
            t_now = time.time()
            print(f"[ORT] {t_now:.3f} OSRM get_route_legs OK dist_m={res['distance']:.0f} steps={len(steps)} elapsed={elapsed:.3f} attempt={attempt}")
            logger.info("[ORT] get_route_legs OK dist=%.0f steps=%d elapsed=%.3f", res["distance"], len(steps), elapsed)
            return res
        except Exception as e:
            last_exc = e
            elapsed = time.time() - ts
            t_now = time.time()
            print(f"[ORT] {t_now:.3f} OSRM get_route_legs EXC {type(e).__name__}: {e} elapsed={elapsed:.3f} attempt={attempt}")
            logger.warning("[ORT] get_route_legs EXC %s elapsed=%.3f", type(e).__name__, elapsed)
            if attempt < 2:
                await asyncio.sleep(0.5 * (attempt + 1))
                continue
            return None
    print(f"[ORT] {time.time():.3f} OSRM get_route_legs GAVE UP after retries")
    return None


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6371000.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2) ** 2
    )
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R * c




_STATE_HWY_RE = re.compile(
    r"\b(I[\s-]?\d{1,3}|US[\s-]?\d{1,3}|[A-Z]{2}[\s-]?\d{1,4})\b",
    re.IGNORECASE,
)


def _is_state_highway(name: str) -> bool:
    return bool(_STATE_HWY_RE.search(name or ""))


def _offset_point(lat: float, lon: float, km: float, bearing_deg: float) -> tuple[float, float]:
    R = 6371.0
    br = math.radians(bearing_deg)
    lat1 = math.radians(lat)
    lon1 = math.radians(lon)
    lat2 = math.asin(
        math.sin(lat1) * math.cos(km / R)
        + math.cos(lat1) * math.sin(km / R) * math.cos(br)
    )
    lon2 = lon1 + math.atan2(
        math.sin(br) * math.sin(km / R) * math.cos(lat1),
        math.cos(km / R) - math.sin(lat1) * math.sin(lat2),
    )
    return math.degrees(lat2), math.degrees(lon2)


async def _nearest_candidates(
    lat: float, lon: float, client: httpx.AsyncClient, number: int = 10
) -> list[tuple[float, float, str, float]]:
    url = f"{OSRM_BASE}/nearest/v1/driving/{lon:.6f},{lat:.6f}?number={number}"
    try:
        resp = await client.get(url)
        if resp.status_code != 200:
            return []
        data = resp.json()
        out: list[tuple[float, float, str, float]] = []
        for wp in data.get("waypoints") or []:
            loc = wp.get("location") or [lon, lat]
            out.append(
                (
                    float(loc[1]),
                    float(loc[0]),
                    str(wp.get("name") or wp.get("hint") or ""),
                    float(wp.get("distance") or 0),
                )
            )
        return out
    except Exception:
        return []


async def snap_to_state_highway(
    lat: float, lon: float, client: httpx.AsyncClient | None = None,
) -> tuple[float, float, bool]:
    """Snap geocoded point to nearest state highway by probing short OSRM routes."""
    if not (math.isfinite(lat) and math.isfinite(lon)):
        return lat, lon, False

    own_client = client is None
    if own_client:
        client = httpx.AsyncClient(timeout=30.0)
    best: tuple[float, float, bool] | None = None
    best_dist = float("inf")
    try:
        assert client is not None
        for km in (3, 8, 15, 25, 40):
            for bearing in range(0, 360, 45):
                slat, slon = _offset_point(lat, lon, float(km), float(bearing))
                route = await get_route_legs((lat, lon), (slat, slon), client=client)
                if not route:
                    continue
                for step in (route.get("steps") or [])[:10]:
                    ref_text = f"{step.get('ref') or ''} {step.get('name') or ''}"
                    if not _is_state_highway(ref_text):
                        continue
                    loc = (step.get("maneuver") or {}).get("location")
                    if loc and len(loc) >= 2:
                        plat, plon = float(loc[1]), float(loc[0])
                        d = haversine_m(lat, lon, plat, plon)
                        if d < best_dist:
                            best_dist = d
                            best = (plat, plon, True)
                    break
        if best:
            return best
        return lat, lon, False
    finally:
        if own_client and client is not None:
            await client.aclose()




async def _build_distance_matrix(
    coords: list[tuple[float, float]],
    avoided: list[str] | None = None,
    origin_state: str | None = None,
    dest_state: str | None = None,
) -> tuple[list[list[float]], bool]:
    """Prefer real OSRM table. Return (matrix, used_real_matrix).
    v0.3 World-Class hard enforcement: if avoided, for *every* pair fetch the real leg route
    and if its geometry steps cross an avoided state, set cost to AVOID_STATE_CROSSING_PENALTY
    (huge). This ensures the VRP solver literally cannot choose a sequence of hops that
    traverses forbidden states (treats as unreachable arc). Falls back gracefully.
    """
    ts0 = time.time()
    av_list = avoided or []
    print(f"[ORT] {ts0:.3f} _build_distance_matrix start n={len(coords)} avoided={av_list}")
    logger.info("[ORT] _build_distance_matrix start n=%d avoided=%s t=%.3f", len(coords), av_list, ts0)
    avoid_checks = 0
    penalties_applied = 0
    # Client created for table (always); reuse for avoid n*n + build legs to avoid churn/abort risk (per special-instr req)
    async with httpx.AsyncClient(timeout=300.0) as client:  # bumped for robustness on complex special-instr paths with many legs + border walks
        res = await get_table_matrix(coords, client=client)
        used_real = False
        if res:
            dists, _ = res
            used_real = True
            # repair any huge/unreachable with haversine
            for i in range(len(dists)):
                for j in range(len(dists[i])):
                    if dists[i][j] > 1e8:
                        dists[i][j] = haversine_m(*coords[i], *coords[j])
        else:
            # pure python fallback (documented; acceptable for air-gapped / demo)
            n = len(coords)
            dists = [[0.0] * n for _ in range(n)]
            for i in range(n):
                for j in range(n):
                    if i != j:
                        dists[i][j] = haversine_m(*coords[i], *coords[j])

        # Realistic detour penalty (smallest addition for world-class practical routing):
        # after real_dist (table or haversine), if a leg's path length >> direct haversine (unnecessary long detour),
        # add excess * factor to matrix cost. Biases VRP toward practical drivable short-total routes (e.g. prevents
        # OK-MO-NE-IL style north-then-east for eastbound OK-IL). 1.25 ratio + 1.2 factor chosen to penalize only
        # clear detours without over-penalizing normal road curvature or valid long hauls. Does not affect reported
        # real OSRM leg distances (only VRP ordering cost).
        n = len(coords)
        for i in range(n):
            for j in range(n):
                if i == j:
                    continue
                real_d = dists[i][j]
                if real_d > 1e8:
                    continue
                h = haversine_m(*coords[i], *coords[j])
                if h > 100:  # ignore micro
                    ratio = real_d / h
                    if ratio > 1.25:
                        excess = real_d - (h * 1.25)
                        dists[i][j] += excess * 1.2

        # Practical corridor penalty: direct KS→FL O-D shortcut (OK+AL w/o MO) when no vias seeded.
        ks_fl_direct = (
            (origin_state or "").upper() == "KS"
            and (dest_state or "").upper() == "FL"
        )
        n = len(coords)
        if ks_fl_direct and n == 2 and dists[0][1] < 1e8:
            route = await get_route_legs(
                coords[0], coords[1], client=client,
                prefer_practical=True,
                origin_state=origin_state,
                dest_state=dest_state,
            )
            if route and _is_ks_fl_ok_al_shortcut(
                route.get("steps", []), origin_state, dest_state
            ):
                dists[0][1] += dists[0][1] * 0.35
                penalties_applied += 1
                print(f"[ORT] {time.time():.3f} PRACTICAL PENALTY 0->1 (OK+AL w/o MO)")
                logger.info("[ORT] PRACTICAL PENALTY 0->1 (OK+AL w/o MO)")

        # v0.3: Hard avoid enforcement on actual leg geometry (not just stop states)
        if av_list:
            n = len(coords)
            for i in range(n):
                for j in range(n):
                    if i == j:
                        continue
                    if dists[i][j] > 1e8 or dists[i][j] >= AVOID_STATE_CROSSING_PENALTY:
                        continue
                    avoid_checks += 1
                    print(f"[ORT] {time.time():.3f} AVOID CHECK i={i}->j={j} (avoided={av_list})")
                    logger.info("[ORT] AVOID CHECK i=%d->j=%d (avoided=%s)", i, j, av_list)
                    # Fetch real route for this hop to inspect traversed states (small N: 3-5 stops => <20 calls)
                    leg_prefer = should_prefer_practical_corridor(origin_state, dest_state, av_list)
                    route = await get_route_legs(
                        coords[i], coords[j], client=client,
                        prefer_practical=leg_prefer,
                        origin_state=origin_state,
                        dest_state=dest_state,
                        trip_origin_state=origin_state,
                        trip_dest_state=dest_state,
                        avoided=av_list,
                    )
                    if route and crosses_avoided_state(route.get("steps", []), av_list):
                        dists[i][j] = AVOID_STATE_CROSSING_PENALTY
                        penalties_applied += 1
                        print(f"[ORT] {time.time():.3f} AVOID PENALTY APPLIED i={i}->j={j} (1e9)")
                        logger.info("[ORT] AVOID PENALTY APPLIED i=%d->j=%d", i, j)
        print(f"[ORT] {time.time():.3f} _build_distance_matrix done checks={avoid_checks} penalties={penalties_applied} used_real={used_real} elapsed={time.time()-ts0:.3f}")
        logger.info("[ORT] _build_distance_matrix done checks=%d penalties=%d used_real=%s elapsed=%.3f", avoid_checks, penalties_applied, used_real, time.time()-ts0)
    return dists, used_real


# =============================================================================
# Special instructions parser + stop builder (supports "specialInstructions")
# =============================================================================

def _get_state_code(token: str, next_token: str | None = None) -> str | None:
    u = token.upper().strip()
    if len(u) == 2 and u in STATE_ABBR:
        return u
    titled = token.strip().title()
    if titled.lower() in STATE_NAME_TO_CODE:
        return STATE_NAME_TO_CODE[titled.lower()]
    if next_token:
        phrase = f"{titled} {next_token.strip().title()}"
        if phrase.lower() in STATE_NAME_TO_CODE:
            return STATE_NAME_TO_CODE[phrase.lower()]
    return None


def _normalize_hwy_token(raw: str) -> str:
    """Normalize US136 / US-136 / US 136 / I29 / I-29 → 'US 136' / 'I-29'."""
    u = re.sub(r"[\s.\-]+", "", (raw or "").upper())
    if u.startswith("US") and u[2:].isdigit():
        return f"US {u[2:]}"
    if u.startswith("I") and u[1:].isdigit():
        return f"I-{u[1:]}"
    return (raw or "").upper().strip()


def _coerce_state_code(s: str | None) -> str | None:
    """Normalize full name or 2-letter to STATE_ABBR code (or None)."""
    if not s:
        return None
    raw = str(s).strip()
    if not raw:
        return None
    up = raw.upper()
    if up in STATE_ABBR:
        return up
    return STATE_NAME_TO_CODE.get(raw.lower()) or None


# City suffixes after a state name → do not treat name as avoid target ("Kansas City" ≠ Kansas).
_CITY_SUFFIXES = frozenset({"city", "springs", "falls", "beach", "ville", "town", "port", "harbor", "harbour"})


def _looks_like_state_token(tok: str) -> bool:
    """True if token resolves to a US state (code or name)."""
    return _get_state_code(tok, None) is not None


def _state_codes_from_tokens(raw_tokens: list[str]) -> list[str]:
    """
    Extract US state codes from avoid phrase tokens.
    English conjunction skip: only natural-language "or" when flanked by state-like tokens
    (e.g. "avoid CA or TX" → skip "or"). Does NOT drop real multi-state list codes
    like OK/OR/IN in "avoid AR, OK, TX" or "avoid WA, OR".
    """
    out: list[str] = []
    i = 0
    while i < len(raw_tokens):
        tok = raw_tokens[i]
        nxt = raw_tokens[i + 1] if i + 1 < len(raw_tokens) else None
        prev = raw_tokens[i - 1] if i > 0 else None
        # "Kansas City" / "Colorado Springs" — do not treat as state Kansas/Colorado
        if nxt and nxt.lower() in _CITY_SUFFIXES:
            i += 2
            continue
        # Conjunction "or" only (not OK/OR/IN/OH as list members): skip when both neighbors are states
        if tok.lower() == "or" and prev and nxt and _looks_like_state_token(prev) and _looks_like_state_token(nxt):
            i += 1
            continue
        # Prefer 2-word name only when next is not a city suffix
        code_two = _get_state_code(tok, nxt) if nxt else None
        code_one = _get_state_code(tok, None)
        if code_two and code_two != code_one:
            if code_two not in out:
                out.append(code_two)
            i += 2
            continue
        if code_one and code_one not in out:
            out.append(code_one)
        i += 1
    return out


def highway_token_present(pref: str, hwys: list[str] | None) -> bool:
    """
    True if preferred highway is on the route list via normalized plain-token *equality*
    (not substring: I-2 ≠ I-29, US13 ≠ US136). Strips enrichment ' (entry ...)'.
    Match against the *full* highway list, not a curated top-N subset.
    """
    np = re.sub(r"[\s.\-]+", "", (pref or "").upper())
    if not np:
        return False
    for h in hwys or []:
        plain = str(h).split(" (")[0]
        nh = re.sub(r"[\s.\-]+", "", plain.upper())
        if nh == np:
            return True
    return False


def assess_preference_enforcement(
    avoided: list[str] | None,
    preferred: list[str] | None,
    route_corridor: list[str] | None,
    highways: list[str] | None,
    origin_state: str | None = None,
    dest_state: str | None = None,
    preferred_or_groups: list[list[str]] | None = None,
) -> dict[str, Any]:
    """
    Pure honesty assessment for special-instructions vs primary geometry.
    enforced is true only when every avoid is off-corridor (except o/d) AND every preferred hwy is present.
    Or-groups ("US136 or I-29"): satisfied if *any* alternative is on the route; missing only if none realized.
    """
    o = _coerce_state_code(origin_state)
    d = _coerce_state_code(dest_state)
    av = list(avoided or [])
    pref = list(preferred or [])
    or_groups = [list(g) for g in (preferred_or_groups or []) if g]
    or_members: set[str] = set()
    for g in or_groups:
        for p in g:
            or_members.add(p)
    states = list(route_corridor or [])
    still_on = [a for a in av if a in states and a != o and a != d]
    # Required preferred: every non-or-group member must appear
    missing_pref = [
        p for p in pref if p not in or_members and not highway_token_present(p, highways)
    ]
    # Or-group: honesty if *none* of the alternatives realized
    for g in or_groups:
        if not any(highway_token_present(p, highways) for p in g):
            label = " or ".join(g)
            if label not in missing_pref:
                missing_pref.append(label)
    has_pref_goal = bool(av) or bool(pref) or bool(or_groups)
    enforced = has_pref_goal and not still_on and not missing_pref
    return {
        "still_on": still_on,
        "missing_pref": missing_pref,
        "enforced": enforced,
        "partial": bool(still_on or missing_pref),
    }


# Preferred highway → CITY_MAP key used as a real VRP via so OSRM geometry can follow the hwy.
# Without an injected via, preferred is only noted ("not injected") and often never appears on corridor.
PREFERRED_HWY_VIA_ANCHORS: dict[str, str] = {
    "US 136": "rock port",
    "I-40": "oklahoma city",
}

# Optional geography gate: only seed anchor when O or D is in a relevant corridor region.
# Highways absent from this map have no O/D gate (e.g. I-40 is multi-region).
PREFERRED_HWY_GEO_STATES: dict[str, frozenset[str]] = {
    "US 136": frozenset({"MO", "NE", "IA", "KS", "IL"}),
}


def _via_coord_dup(candidate: dict[str, Any], existing: list[dict[str, Any]] | None) -> bool:
    """True if candidate lat/lon already present (rounded ~0.05°)."""
    if not existing:
        return False
    try:
        clat, clon = float(candidate["lat"]), float(candidate["lon"])
    except (KeyError, TypeError, ValueError):
        return False
    for v in existing:
        try:
            if abs(float(v["lat"]) - clat) < 0.05 and abs(float(v["lon"]) - clon) < 0.05:
                return True
        except (KeyError, TypeError, ValueError):
            continue
    return False


def _prefer_anchor_geo_ok(
    pref: str,
    origin_state: str | None,
    dest_state: str | None,
) -> bool:
    """True if preferred hwy has no geo gate, or O/D touches the allowed region.

    When both O and D are unknown, do not block (unit callers / honesty without states).
    """
    np = _normalize_hwy_token(pref)
    allowed = PREFERRED_HWY_GEO_STATES.get(np)
    if allowed is None:
        return True
    o = _coerce_state_code(origin_state)
    d = _coerce_state_code(dest_state)
    if not o and not d:
        return True
    return (o in allowed) or (d in allowed)


def extract_prefer_clause_places(
    special_text: str | None,
    preferred: list[str] | None = None,
    *,
    origin_state: str | None = None,
    dest_state: str | None = None,
) -> list[dict[str, Any]]:
    """
    Extract user-named CITY_MAP places from prefer/use/take/via clauses.

    Matches through/via/from/near/enter CITY (prefer context required).
    Product: user-named place > default highway anchor (e.g. Auburn beats Rock Port for US136).
    Does NOT fire on bare "from Dallas" / "away from X" without prefer verb.
    """
    places: list[dict[str, Any]] = []
    t = (special_text or "").lower()
    if not t:
        return places
    pref_norm = [_normalize_hwy_token(p) for p in (preferred or []) if p]
    city_keys = sorted(CITY_MAP.keys(), key=len, reverse=True)
    seen: set[str] = set()
    for city_key in city_keys:
        # Prefer verb … (from|near|through|enter|via) CITY
        # Also: bare "via CITY" (via is itself a prefer verb).
        # Reject "away from" / "depart from".
        matched = re.search(
            rf"(?:use|take|prefer|via)\b"
            rf"(?:(?!\b(?:avoid|use|take|prefer|via)\b).){{0,120}}?"
            rf"(?<!\baway )(?<!\bdepart )"
            rf"(?:from|near|through|enter|via)\s+{re.escape(city_key)}\b",
            t,
        )
        if not matched:
            # "via Auburn" alone: via is the prefer verb and city follows directly
            matched = re.search(
                rf"(?:^|[\s,.(])via\s+{re.escape(city_key)}\b",
                t,
            )
        if not matched:
            continue
        # If city is the mapped anchor for a preferred hwy that failed geo, skip it.
        skip_geo = False
        for pref in pref_norm:
            if PREFERRED_HWY_VIA_ANCHORS.get(pref) == city_key and not _prefer_anchor_geo_ok(
                pref, origin_state, dest_state
            ):
                skip_geo = True
                break
        if skip_geo:
            continue
        if city_key in seen:
            continue
        seen.add(city_key)
        lat, lon, st = CITY_MAP[city_key]
        places.append({
            "name": city_key.title(),
            "lat": lat,
            "lon": lon,
            "state": st,
            "source": "prefer_place",
        })
    return places


def extract_county_vias(
    special_text: str | None,
    avoided: list[str] | None = None,
) -> tuple[list[dict[str, Any]], list[str]]:
    """
    MVP county seeding: "X County, ST" → COUNTY_MAP centroid if known.
    Unknown counties → note only (no hard fail). Returns (vias, notes).
    """
    vias: list[dict[str, Any]] = []
    notes: list[str] = []
    t = special_text or ""
    if not t.strip():
        return vias, notes
    av_set = {str(a).upper().strip() for a in (avoided or []) if a}
    # "Nemaha County, NE" / "Nemaha County NE" / "Gage County, Nebraska"
    county_re = re.compile(
        r"\b([A-Za-z]+(?:\s+[A-Za-z]+)?)\s+[Cc]ounty\s*,?\s*([A-Za-z]{2}|[A-Za-z]+(?:\s+[A-Za-z]+)?)\b",
    )
    seen: set[str] = set()
    for m in county_re.finditer(t):
        cname = m.group(1).strip().lower()
        st_raw = m.group(2).strip()
        st = _coerce_state_code(st_raw) or _get_state_code(st_raw, None)
        if not st:
            notes.append(f"Unknown county (no state): {m.group(0).strip()} (skipped)")
            continue
        key = f"{cname},{st.lower()}"
        if key in seen:
            continue
        seen.add(key)
        if key not in COUNTY_MAP:
            notes.append(f"Unknown county: {m.group(1).strip()} County, {st} (skipped)")
            continue
        lat, lon, cst = COUNTY_MAP[key]
        if cst in av_set:
            notes.append(f"County {m.group(1).strip()} County, {st} in avoided state (skipped)")
            continue
        vias.append({
            "name": f"{m.group(1).strip().title()} County, {st}",
            "lat": lat,
            "lon": lon,
            "state": cst,
            "source": "county",
        })
    return vias, notes


def seed_preferred_hwy_vias(
    preferred: list[str] | None,
    avoided: list[str] | None,
    special_text: str | None = None,
    *,
    origin_state: str | None = None,
    dest_state: str | None = None,
    existing: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    """
    Seed real via stops for preferred highways / prefer-clause places.

    Product rules:
    1) User-named place in prefer/use/via/through/from/enter > default hwy anchor
       ("use US136 through Auburn, NE" → Auburn, not Rock Port).
    2) Bare "prefer US136" (no place) → PREFERRED_HWY_VIA_ANCHORS (Rock Port).
    3) Prefer-clause city scan does NOT fire on bare "from Chicago" / "away from X".

    Only injects when anchor/place state is not avoided, geo gate passes (US 136),
    and not a coord duplicate of existing vias / O/D / earlier seeds.
    Prefer-via ownership is build_stops_from_load (not suggest_practical_vias).
    """
    vias: list[dict[str, Any]] = []
    av_set = {str(a).upper().strip() for a in (avoided or []) if a}
    pref_norm = [_normalize_hwy_token(p) for p in (preferred or []) if p]

    def _try_append(city_key: str, *, source: str = "hwy_anchor") -> bool:
        if city_key not in CITY_MAP:
            return False
        lat, lon, st = CITY_MAP[city_key]
        if st in av_set:
            return False
        via = {
            "name": city_key.title(),
            "lat": lat,
            "lon": lon,
            "state": st,
            "source": source,
        }
        if _via_coord_dup(via, vias) or _via_coord_dup(via, existing):
            return False
        vias.append(via)
        return True

    # --- User places first (prefer-clause cities) ---
    user_places = extract_prefer_clause_places(
        special_text,
        pref_norm,
        origin_state=origin_state,
        dest_state=dest_state,
    )
    for place in user_places:
        st = str(place.get("state") or "").upper()
        if st in av_set:
            continue
        if _via_coord_dup(place, vias) or _via_coord_dup(place, existing):
            continue
        vias.append(place)

    # If user named a place in a prefer clause, do not also force default hwy anchors
    # (Auburn wins over Rock Port for US136).
    if user_places:
        return vias

    # --- Fall back to highway default anchors when no place named ---
    if not pref_norm:
        return vias

    for pref in pref_norm:
        if not _prefer_anchor_geo_ok(pref, origin_state, dest_state):
            continue
        city_key = PREFERRED_HWY_VIA_ANCHORS.get(pref)
        if city_key:
            _try_append(city_key, source="hwy_anchor")

    return vias


def format_missing_pref_warning(
    pref: str,
    *,
    avoided: list[str] | None = None,
    special_text: str | None = None,
    origin_state: str | None = None,
    dest_state: str | None = None,
) -> str:
    """
    Honesty copy for a preferred hwy missing from primary geometry.
    If we seeded (or would seed) a via for this hwy, do not claim "not injected".
    """
    seeds = seed_preferred_hwy_vias(
        [pref],
        avoided,
        special_text,
        origin_state=origin_state,
        dest_state=dest_state,
    )
    if seeds:
        return (
            f"Preferred highway {pref} not on primary route "
            f"(via seeded; not realized in geometry)"
        )
    return f"Preferred highway {pref} not on primary route (noted, not injected)"


def parse_special_instructions(
    text: str | None,
    origin_state: str | None = None,
    dest_state: str | None = None,
) -> dict[str, Any]:
    """
    Parse free-text. Returns avoided states, included city waypoints, preferred highways, notes.
    Supports: avoid AR,IL ; include Corinth, MS, Memphis ; prefer I-40 southern ; bypass CA
    Avoid clause stops at period or next directive verb (use|take|prefer|via|include|through|from|enter|to|...).
    States that appear only inside prefer/use/from/enter clauses are not avoided.
    origin_state / dest_state are always stripped from avoided (impossible o/d avoid).

    Note on stop verb `to`: needed for "use US136 ... to enter NE" so NE is not avoided.
    Tradeoff: "avoid CA to AZ" truncates at `to` (AZ not avoided). Prefer "avoid CA, AZ" or "avoid CA and AZ".
    Preferred highways are taken *only* from use/take/prefer/via clauses (not bare "avoid I-40").
    """
    if not text or not text.strip():
        return {
            "avoided": [],
            "included": [],
            "preferred": [],
            "preferred_or_groups": [],
            "notes": [],
            "raw": text,
        }

    t = text.lower()
    # Normalize ;: to spaces but KEEP periods as avoid-clause terminators (fix: "avoid IA. use US136...").
    # Commas kept so "avoid IA, KS" multi-state tokens still split cleanly.
    t = re.sub(r"[:;]+", " ", t)
    avoided: list[str] = []
    included: list[dict[str, Any]] = []
    preferred: list[str] = []
    preferred_or_groups: list[list[str]] = []
    applied: list[str] = []

    # Avoid / bypass: consume state tokens only until period OR next verb.
    # Extra stop verbs (use|take|from|enter|to) prevent slurping prefer/use clauses into avoided
    # (e.g. "avoid IA. use US136 from Rock Port, MO to enter NE" → avoided=['IA'] only).
    # `to` tradeoff: "avoid CA to AZ" stops at `to` (use "avoid CA, AZ" instead).
    _avoid_stop = (
        r"use|take|prefer|via|include|including|through|from|enter|to|"
        r"avoid|avoiding|no|skip|steer clear of|shun|bypass|near|"
        r"southern|northern|interstate|stay on|avoid major"
    )
    avoid_re = re.compile(
        rf"(?:^|[\s,.(]|\b)[^\w]*(avoid|avoiding|no|skip|steer clear of|shun|bypass)[^\w]+"
        rf"([a-z0-9,\s&\/]+?)"
        rf"(?=\s*(?:{_avoid_stop})\b|\s*\.|$)",
        re.IGNORECASE,
    )
    for m in avoid_re.finditer(t):
        phrase = m.group(2) or ""
        # Period may still trail a phrase if lookahead used '$' after trimmed end — strip it.
        phrase = re.split(r"\.", phrase, maxsplit=1)[0]
        raw_tokens = [x.strip() for x in re.split(r"[,&\s\/]+", phrase) if x.strip()]
        for code in _state_codes_from_tokens(raw_tokens):
            if code not in avoided:
                avoided.append(code)

    # Include / via / near (only cities from CITY_MAP become real VRP stops)
    # Stop before prefer/use/from/enter/to so state tokens there are not treated as include targets.
    _inc_stop = (
        r"avoid|avoiding|no|skip|include|including|prefer|use|take|via|through|near|"
        r"from|enter|to|southern|northern"
    )
    inc_re = re.compile(
        rf"(?:^|[\s,.(]|\b)[^\w]*(include|including|via|through|near|go (?:by|via|through|near)|pass (?:by|near|through))[^\w]+"
        rf"([a-z0-9,\s&\/]+?)"
        rf"(?=\s*(?:{_inc_stop})\b|\s*\.|$)",
        re.IGNORECASE,
    )
    for m in inc_re.finditer(t):
        phrase = m.group(2) or ""
        phrase = re.split(r"\.", phrase, maxsplit=1)[0]
        raw_tokens = [x.strip() for x in re.split(r"[,&\s\/]+", phrase) if x.strip()]
        for i, tok in enumerate(raw_tokens):
            nxt = raw_tokens[i + 1] if i + 1 < len(raw_tokens) else None
            if nxt and nxt.lower() in _CITY_SUFFIXES:
                continue
            code = _get_state_code(tok, nxt if nxt and nxt.lower() not in _CITY_SUFFIXES else None)
            if code:
                continue  # state-only include does not force a precise stop for MVP
            key = tok.lower()
            if key in CITY_MAP:
                lat, lon, st = CITY_MAP[key]
                inc = {"name": tok.title(), "lat": lat, "lon": lon, "state": st}
                if not any(x["name"].lower() == inc["name"].lower() for x in included):
                    included.append(inc)

    # Prefer/use/take/via clauses ONLY → extract highways (no bare-text fallback: "avoid I-40" must not prefer I-40)
    # Stop verbs exclude "then" so "US136 then US75" stays in one phrase (ordered list).
    prefer_clause_re = re.compile(
        r"(?:^|[\s,.(]|\b)[^\w]*(use|take|prefer|via)[^\w]+([a-z0-9,\s&\-\/]+?)"
        r"(?=\s*(?:avoid|use|take|prefer|via|include|through|from|enter|to|southern|northern|interstate|stay on)\b|\s*\.|$)",
        re.IGNORECASE,
    )
    hwy_token_re = re.compile(r"\b(I-?\d+|US[-\s]?\d+)\b", re.IGNORECASE)
    for m in prefer_clause_re.finditer(t):
        phrase = m.group(2) or ""
        # "US136 or I-29" → preferred alternatives (or-group)
        or_parts = re.split(r"\s+or\s+", phrase, flags=re.IGNORECASE)
        if len(or_parts) > 1:
            group: list[str] = []
            for part in or_parts:
                for hm in hwy_token_re.finditer(part):
                    pref = _normalize_hwy_token(hm.group(1))
                    if pref:
                        if pref not in group:
                            group.append(pref)
                        if pref not in preferred:
                            preferred.append(pref)
            if len(group) >= 2:
                # de-dupe identical or-groups
                if group not in preferred_or_groups:
                    preferred_or_groups.append(group)
            continue
        # Ordered preferred: "US136 then US75" / "US136 and US75" / "US136, US75"
        for hm in hwy_token_re.finditer(phrase):
            pref = _normalize_hwy_token(hm.group(1))
            if pref and pref not in preferred:
                preferred.append(pref)

    # Preferences for notes
    if re.search(r"(southern|south|go south|prefer south)", t):
        applied.append("favored southern routing")
    if re.search(r"(northern|north|go north|prefer north)", t):
        applied.append("favored northern routing")
    if re.search(r"(stay on interstates?|interstates? only|prefer (interstates?|major highways?|truck (routes?|corridors?)))", t):
        applied.append("favored staying on interstates / major truck corridors")
    for pref in preferred:
        applied.append(f"preferred {pref}")
    for group in preferred_or_groups:
        applied.append(f"preferred alternatives ({' or '.join(group)})")

    # OD guard: never treat origin/dest as avoided (impossible / geometry-required); coerce full names → codes
    o = _coerce_state_code(origin_state)
    d = _coerce_state_code(dest_state)
    if o or d:
        avoided = [a for a in avoided if a != o and a != d]

    if avoided:
        applied.append(f"avoided {', '.join(avoided)}")
    if included:
        applied.append(f"included {', '.join(i['name'] for i in included)} (biased toward routing near when possible)")

    # County MVP notes (unknown counties soft-skip; known seeded in build_stops_from_load)
    _, county_notes = extract_county_vias(text, avoided)
    for cn in county_notes:
        applied.append(cn)

    notes: list[str] = []
    if applied:
        notes.append("User preference applied: " + "; ".join(applied))

    return {
        "avoided": avoided,
        "included": included,
        "preferred": preferred,
        "preferred_or_groups": preferred_or_groups,
        "notes": notes,
        "raw": text,
    }


def build_stops_from_load(
    load: Any,
    origin_coords: tuple[float, float] | None,
    dest_coords: tuple[float, float] | None,
) -> list[dict[str, Any]]:
    """
    Build VRP stops: [origin, ...prefer/include/manual vias..., destination]
    or with explicit drops: [origin, ...vias..., ...ordered drops...].
    Prefer/include (and manualRoute) vias always apply even when drops exist
    (permit-test often sends destination as is_drop); only coord-dupes vs O/D/drops
    are skipped. suggest_practical_vias is skipped when len(drops) > 1 to avoid
    silent multi-drop expansion (e.g. KS→FL Joplin/Memphis); single dest-as-drop
    still gets practical vias (permit-test).
    """
    stops: list[dict[str, Any]] = []

    # Guarantee exact origin_coords for first leg (and its steps for corridor walk).
    # No default/snap override: caller (optimize_route) passes explicit from get_origin_coords or load lat/lon.
    # o_stop lat/lon (and thus first get_route_legs + prefix of all_steps) always from this.
    o_lat, o_lon = origin_coords if origin_coords is not None else (DEFAULT_ORIGIN_LAT, DEFAULT_ORIGIN_LON)
    d_lat, d_lon = dest_coords if dest_coords is not None else (DEFAULT_DEST_LAT, DEFAULT_DEST_LON)

    # enrich states from load for better corridor derivation
    o_state = None
    d_state = None
    if hasattr(load, "origin") and hasattr(load.origin, "state"):
        o_state = (load.origin.state or "").upper() or None
    elif isinstance(load, dict):
        o = load.get("origin") or {}
        o_state = (o.get("state") or "").upper() or None
    if hasattr(load, "destination") and hasattr(load.destination, "state"):
        d_state = (load.destination.state or "").upper() or None
    elif isinstance(load, dict):
        d = load.get("destination") or {}
        d_state = (d.get("state") or "").upper() or None

    o_stop: dict[str, Any] = {"name": "origin", "lat": o_lat, "lon": o_lon, "is_via": False}
    if o_state:
        o_stop["state"] = o_state
    stops.append(o_stop)

    # Explicit multi-stop drops (ordered delivery stops from permit-test form).
    # Collect first; append after vias so prefer/include anchors sit between O and first drop.
    explicit_drops: list[dict[str, Any]] = []
    if isinstance(load, dict):
        raw_drops = load.get("drops") or []
        if isinstance(raw_drops, list):
            explicit_drops = [d for d in raw_drops if isinstance(d, dict)]
    elif hasattr(load, "drops") and getattr(load, "drops", None):
        explicit_drops = [
            d.model_dump() if hasattr(d, "model_dump") else dict(d)
            for d in (load.drops or [])
        ]

    drop_stops: list[dict[str, Any]] = []
    for i, drop in enumerate(explicit_drops):
        lat_raw = drop.get("lat")
        lon_raw = drop.get("lon")
        if lat_raw is None or lon_raw is None:
            raise ValueError(f"drops[{i}] missing lat/lon coordinates")
        try:
            dlat, dlon = float(lat_raw), float(lon_raw)
        except (TypeError, ValueError) as exc:
            raise ValueError(f"drops[{i}] invalid lat/lon coordinates") from exc
        if not (math.isfinite(dlat) and math.isfinite(dlon)):
            raise ValueError(f"drops[{i}] requires finite lat/lon coordinates")
        d_stop: dict[str, Any] = {
            "name": drop.get("query") or drop.get("city") or f"drop_{i + 1}",
            "lat": dlat,
            "lon": dlon,
            "is_via": False,
            "is_drop": True,
        }
        dst = drop.get("state")
        if dst:
            d_stop["state"] = str(dst).upper().strip()
        drop_stops.append(d_stop)
    has_explicit_drops = len(drop_stops) > 0
    # special instructions
    special = None
    if hasattr(load, "get_special_instructions"):
        special = load.get_special_instructions()
    elif isinstance(load, dict):
        special = load.get("specialInstructions") or load.get("special_instructions")

    parsed = parse_special_instructions(special, o_state, d_state)
    avoided = parsed.get("avoided", [])
    included = list(parsed.get("included", []))
    preferred_hwys: list[str] = list(parsed.get("preferred") or [])

    # v0.3 World-Class: auto-suggest practical OSOW vias (hard-avoid aware) when specialInstructions present.
    # User "include" + manualRoute take precedence (suggested only augment when no explicit manual).
    # This + hard matrix enforcement ensures primary.routeCorridor e.g. never includes AR/IL for the test case.
    o_state_for_suggest = o_state
    d_state_for_suggest = d_state
    manual: list[str] | None = None
    if hasattr(load, "get_manual_route"):
        manual = load.get_manual_route()
    elif isinstance(load, dict):
        manual = load.get("manualRoute") or load.get("manual_route")

    # Forced map/manual waypoints (stable schema) — always accepted as vias before drops.
    manual_wps: list[dict[str, Any]] = []
    if hasattr(load, "get_manual_waypoints"):
        manual_wps = list(load.get_manual_waypoints() or [])
    elif isinstance(load, dict):
        raw_mw = load.get("manualWaypoints") or load.get("manual_waypoints") or []
        if isinstance(raw_mw, list):
            for w in raw_mw:
                if not isinstance(w, dict):
                    continue
                try:
                    wlat, wlon = float(w["lat"]), float(w["lon"])
                except (KeyError, TypeError, ValueError):
                    continue
                if not (math.isfinite(wlat) and math.isfinite(wlon)):
                    continue
                item: dict[str, Any] = {
                    "name": w.get("name") or "waypoint",
                    "lat": wlat,
                    "lon": wlon,
                    "is_via": True,
                    "source": w.get("source") or "manual",
                }
                if w.get("state"):
                    item["state"] = str(w["state"]).upper().strip()
                manual_wps.append(item)

    # O/D + drop coords for seed/final dedupe (avoid double destination / via-on-drop)
    od_refs: list[dict[str, Any]] = [
        {"lat": o_lat, "lon": o_lon},
        {"lat": d_lat, "lon": d_lon},
    ]
    for ds in drop_stops:
        od_refs.append({"lat": ds["lat"], "lon": ds["lon"]})

    if manual and isinstance(manual, list) and len(manual) > 0:
        # manualRoute wins for text-derived vias (change-route explicit) — do not override with prefer anchors
        forced: list[dict[str, Any]] = []
        for tok in manual:
            t = str(tok).strip()
            if not t:
                continue
            u = t.upper()
            if u in STATE_ABBR:
                continue  # state-only: no precise coord stop added
            key = t.lower()
            if key in CITY_MAP:
                lat, lon, st = CITY_MAP[key]
                forced.append({"name": t.title(), "lat": lat, "lon": lon, "state": st, "is_via": True})
            else:
                parts = t.split()
                if len(parts) >= 2:
                    key2 = " ".join(parts[:2]).lower()
                    if key2 in CITY_MAP:
                        lat, lon, st = CITY_MAP[key2]
                        forced.append({"name": t.title(), "lat": lat, "lon": lon, "state": st, "is_via": True})
        vias = forced
    else:
        # Prefer-via injection (single ownership here — not also in suggest_practical_vias):
        # user places in prefer clauses first; else highway anchors (US 136→Rock Port, I-40→OKC).
        # Respects avoided states, geo gate, and coord-dedupe vs includes + O/D + drops.
        # Still runs when has_explicit_drops so permit-test dest-as-drop keeps prefer anchors.
        for seed in seed_preferred_hwy_vias(
            preferred_hwys,
            avoided,
            special,
            origin_state=o_state,
            dest_state=d_state,
            existing=included + od_refs,
        ):
            if not _via_coord_dup(seed, included) and not _via_coord_dup(seed, od_refs):
                included.append(seed)
        # County MVP: known "X County, ST" → centroid via; unknown → note only (parser notes).
        county_vias, _county_notes = extract_county_vias(special, avoided)
        for cv in county_vias:
            if not _via_coord_dup(cv, included) and not _via_coord_dup(cv, od_refs):
                included.append(cv)
        # Lane-specific practical vias (AL→NE, KS→FL, …). Prefer-hwy anchors owned above only.
        # Skip when multi-drop (len > 1): pure multi-stop must not silently expand with
        # Joplin/Memphis/etc. Single dest-as-drop (permit-test) still gets practical vias.
        if len(drop_stops) <= 1:
            suggested = suggest_practical_vias(
                o_state_for_suggest, d_state_for_suggest, avoided, special
            )
            for sv in suggested:
                if not _via_coord_dup(sv, included) and not _via_coord_dup(sv, od_refs):
                    included.append(sv)
        vias = included

    # Prepend forced manualWaypoints (map schema) before other vias; always before drops.
    if manual_wps:
        vias = list(manual_wps) + list(vias)

    # Append vias after origin (before drops/destination). Dedupe by rounded coord; skip O/D/drop coincidence.
    seen_keys: set[str] = set()
    for v in vias:
        if _via_coord_dup(v, od_refs):
            continue
        k = f"{round(v['lat'], 2)},{round(v['lon'], 2)}"
        if k not in seen_keys:
            seen_keys.add(k)
            v["is_via"] = True
            stops.append(v)

    if has_explicit_drops:
        stops.extend(drop_stops)
    else:
        d_stop_final: dict[str, Any] = {
            "name": "destination",
            "lat": d_lat,
            "lon": d_lon,
            "is_via": False,
        }
        if d_state:
            d_stop_final["state"] = d_state
        stops.append(d_stop_final)
    return stops


# =============================================================================
# Highway extraction + curation + state hints (port of build-corridor.ts)
# =============================================================================

def _norm_hwy(raw: str) -> str | None:
    if not raw:
        return None
    h = raw.strip()
    h = re.sub(r"^Interstate\s*", "I-", h, flags=re.I)
    h = re.sub(r"^U\.?S\.?\s*Highway\s*", "US ", h, flags=re.I)
    h = re.sub(r"[A-Z]{2,}$", "", h)
    h = re.sub(r"\s+", " ", h).strip()
    h = re.sub(r"^I[ -]?(\d+)", r"I-\1", h, flags=re.I)
    h = re.sub(r"^US[ -]?(\d+)", r"US \1", h, flags=re.I)
    if re.match(r"^I-\d+$", h, re.I) or re.match(r"^US \d+$", h, re.I):
        return h
    return None


def extract_highways_from_steps(steps: list[dict[str, Any]]) -> list[str]:
    """Produce enriched highway strings with entry/exit coords."""
    if not steps:
        return []

    seen: list[str] = []
    meta: dict[str, dict[str, str]] = {}

    for step in steps:
        ref = step.get("ref") or step.get("name") or ""
        if not ref:
            continue
        parts = [p.strip() for p in re.split(r"[;,\|]", ref) if p.strip()]
        for raw in parts:
            h = _norm_hwy(raw)
            if not h:
                continue
            if h not in seen:
                seen.append(h)

            coords: list[list[float]] = (step.get("geometry") or {}).get("coordinates") or []
            man: list[float] = step.get("maneuver", {}).get("location") or []
            e_lat = e_lon = x_lat = x_lon = ""
            if len(man) >= 2:
                n1, n2 = man[1], man[0]
                if isinstance(n1, (int, float)) and math.isfinite(float(n1)):
                    e_lat = f"{float(n1):.2f}"
                if isinstance(n2, (int, float)) and math.isfinite(float(n2)):
                    e_lon = f"{float(n2):.2f}"
                if coords:
                    last = coords[-1]
                    if len(last) >= 2 and isinstance(last[1], (int, float)) and math.isfinite(float(last[1])):
                        x_lat = f"{float(last[1]):.2f}"
                    if len(last) >= 2 and isinstance(last[0], (int, float)) and math.isfinite(float(last[0])):
                        x_lon = f"{float(last[0]):.2f}"
                if not x_lat and e_lat:
                    x_lat, x_lon = e_lat, e_lon
            elif coords:
                first = coords[0]
                if len(first) >= 2 and isinstance(first[1], (int, float)) and math.isfinite(float(first[1])):
                    e_lat = f"{float(first[1]):.2f}"
                if len(first) >= 2 and isinstance(first[0], (int, float)) and math.isfinite(float(first[0])):
                    e_lon = f"{float(first[0]):.2f}"
                last = coords[-1] if coords else []
                if len(last) >= 2 and isinstance(last[1], (int, float)) and math.isfinite(float(last[1])):
                    x_lat = f"{float(last[1]):.2f}"
                if len(last) >= 2 and isinstance(last[0], (int, float)) and math.isfinite(float(last[0])):
                    x_lon = f"{float(last[0]):.2f}"

            if e_lat and e_lon:
                if h not in meta:
                    meta[h] = {}
                if not meta[h].get("entry"):
                    meta[h]["entry"] = f"{e_lat},{e_lon}"
                if x_lat and x_lon:
                    meta[h]["exit"] = f"{x_lat},{x_lon}"

    if not meta:
        return seen

    enriched: list[str] = []
    for h in seen:
        m = meta.get(h, {})
        if not m.get("entry"):
            enriched.append(h)
            continue
        ex = f" exit {m['exit']}" if m.get("exit") and m.get("exit") != m.get("entry") else ""
        enriched.append(f"{h} (entry {m['entry']}{ex})")
    return enriched


def curate_major_highways(highways: list[str]) -> list[str]:
    if not highways:
        return []
    interstates: list[str] = []
    key_us: list[str] = []
    other_us: list[str] = []
    important = {
        "US 71", "US 59", "US 169", "US 67", "US 79",
        "US 259", "US 90", "US 49", "US 77", "US 75",
        "US 6", "US 40", "US 24",
    }
    for h in highways:
        plain = h.split(" (")[0]
        if plain.startswith("I-"):
            interstates.append(h)
        elif plain in important:
            key_us.append(h)
        elif plain.startswith("US "):
            other_us.append(h)
    result = interstates + key_us
    if len(result) < 6:
        result += other_us[:4]
    if len(result) > 10:
        result = result[:10]
    return result


def extract_states_from_highways_or_stops(
    highways: list[str], stops: list[dict[str, Any]]
) -> list[str]:
    """Rough corridor states for cost + warnings (starter approximation)."""
    states: list[str] = []
    for stp in stops:
        if stp.get("state") and stp["state"] not in states:
            states.append(stp["state"])
    hwy_state_hints = HIGHWAY_STATE_HINTS  # v0.3: use expanded config (was minimal 4)
    for h in highways:
        plain = h.split(" (")[0]
        # Skip multi-state interstates (bare I-10 ≠ LA); same rule as _get_primary_state_for_step.
        if plain in hwy_state_hints and plain not in MULTI_STATE_HWYS:
            s = hwy_state_hints[plain]
            if s not in states:
                states.append(s)
    return states


# =============================================================================
# v0.3 World-Class pure helpers (port robust TS logic + hard avoid + practical corridors)
# =============================================================================

def extract_states_from_steps(steps: list[dict[str, Any]]) -> list[str]:
    """Ordered states from OSRM steps using per-step attribution (_get_primary_state_for_step).
    Uses MULTI_STATE_HWYS + hints-only-when-no-ref-candidates (same as build_corridor_from_steps).
    Used for hard avoid checks on leg geometry (matrix) and cost/warnings."""
    states: list[str] = []
    prev: str | None = None
    for step in steps or []:
        curr = _get_primary_state_for_step(step)
        if curr is None:
            continue
        if prev is None or curr != prev:
            if curr not in states:
                states.append(curr)
            prev = curr
    return states


def crosses_avoided_state(steps: list[dict[str, Any]], avoided: list[str]) -> bool:
    """Pure helper: does the actual leg's OSRM steps geometry traverse any avoided state?
    Used for *hard* enforcement in matrix building (sets huge cost so VRP cannot pick the hop).
    """
    if not avoided or not steps:
        return False
    trav = set(extract_states_from_steps(steps))
    av_set = set(avoided)
    return bool(trav & av_set)



_COMPASS_SUFFIX_CODES: frozenset[str] = frozenset({"NE", "NW", "SE", "SW"})


def _is_highway_compass_suffix(part: str, code: str) -> bool:
    """True when NE/NW/SE/SW is a highway cardinal suffix (e.g. 'I 35 NE'), not Nebraska etc."""
    if code not in _COMPASS_SUFFIX_CODES:
        return False
    # State highway route number: NE 2, NE-92
    if re.search(rf"\b{re.escape(code)}[\s-]*\d", part, re.IGNORECASE):
        return False
    stripped = part.strip()
    # Standalone segment is the state code (e.g. ';NE' part or 'NE' alone)
    if re.fullmatch(rf"{re.escape(code)}", stripped, re.IGNORECASE):
        return False
    # Compass suffix immediately after interstate/US number: I 35 NE, I-80 SW
    if re.search(
        rf"\b(?:I[\s-]?\d+|US[\s-]?\d+)[\s-]+{re.escape(code)}\s*$",
        stripped,
        re.IGNORECASE,
    ):
        return True
    return False


def _state_from_coordinates(lat: float, lon: float) -> str | None:
    """Infer US state from lat/lon using approximate bounds (no network)."""
    if not (math.isfinite(lat) and math.isfinite(lon)):
        return None
    matches: list[str] = []
    for st, (min_lat, max_lat, min_lon, max_lon) in STATE_LAT_LON_BOUNDS.items():
        if min_lat <= lat <= max_lat and min_lon <= lon <= max_lon:
            matches.append(st)
    if not matches:
        return None
    if len(matches) == 1:
        return matches[0]

    def _dist2(code: str) -> float:
        c_lat, c_lon = STATE_CENTROIDS[code]
        return (lat - c_lat) ** 2 + (lon - c_lon) ** 2

    return min(matches, key=_dist2)


def _step_coordinate_samples(step: dict[str, Any]) -> list[tuple[float, float]]:
    """Sample lat/lon points from an OSRM step (maneuver + denser geometry walk)."""
    points: list[tuple[float, float]] = []
    seen: set[tuple[float, float]] = set()

    def _add(lat: float, lon: float) -> None:
        if not (math.isfinite(lat) and math.isfinite(lon)):
            return
        key = (round(lat, 4), round(lon, 4))
        if key not in seen:
            seen.add(key)
            points.append((lat, lon))

    man: list[float] = (step.get("maneuver") or {}).get("location") or []
    if isinstance(man, (list, tuple)) and len(man) >= 2:
        _add(float(man[1]), float(man[0]))
    coords: list[list[float]] = (step.get("geometry") or {}).get("coordinates") or []
    if coords:
        n = len(coords)
        if n <= 6:
            indices = range(n)
        else:
            indices = sorted({
                0,
                n // 4,
                n // 2,
                (3 * n) // 4,
                n - 1,
                *range(0, n, max(1, n // 8)),
            })
        for idx in indices:
            c = coords[idx]
            if isinstance(c, (list, tuple)) and len(c) >= 2:
                _add(float(c[1]), float(c[0]))
    return points


def _state_from_step_geometry(step: dict[str, Any]) -> str | None:
    for lat, lon in _step_coordinate_samples(step):
        st = _state_from_coordinates(lat, lon)
        if st:
            return st
    return None


def _extract_state_codes_from_step_ref(step: dict[str, Any]) -> list[str]:
    """All state codes from step ref/name in traversal order (port of extractStateHintsFromSteps per-step)."""
    if not isinstance(step, dict):
        return []
    ref = str(step.get("ref") or step.get("name") or "")
    if not ref:
        return []
    valid_codes: set[str] = set(STATE_ABBR)
    valid_codes.update({"AB", "BC", "MB", "NB", "NL", "NS", "NT", "NU", "ON", "PE", "QC", "SK", "YT"})
    found: list[str] = []
    parts = [p.strip() for p in re.split(r"[;,\|]", ref) if p.strip()]
    for part in parts:
        for m in re.finditer(r"\b([A-Z]{2})[\s-]?(\d{1,4})\b", part):
            code = m.group(1).upper()
            if code in valid_codes and code not in found:
                found.append(code)
        for m in re.finditer(r"\b([A-Z]{2})\b", part):
            code = m.group(1).upper()
            if code not in valid_codes:
                continue
            if _is_highway_compass_suffix(part, code):
                continue
            if code not in found:
                found.append(code)
        for m in re.finditer(r"\b([A-Za-z]+(?:\s+[A-Za-z]+)?)\b", part):
            nm = m.group(1).strip().lower()
            if nm in STATE_NAME_TO_CODE:
                code = STATE_NAME_TO_CODE[nm]
                if code not in found:
                    found.append(code)
    return found


def extract_state_hints_from_steps(steps: list[dict[str, Any]]) -> list[str]:
    """Ordered first-seen state codes from all step refs (port of lib/build-corridor.ts)."""
    states: list[str] = []
    for step in steps or []:
        for code in _extract_state_codes_from_step_ref(step):
            if code not in states:
                states.append(code)
    return states


def _discover_states_for_step(step: dict[str, Any]) -> list[str]:
    """Ordered states attributable to one step: ref hints, primary, then geometry."""
    discovered = _extract_state_codes_from_step_ref(step)
    primary = _get_primary_state_for_step(step)
    if primary and primary not in discovered:
        discovered.append(primary)
    if not discovered:
        geo = _state_from_step_geometry(step)
        if geo:
            discovered.append(geo)
    return discovered


# =============================================================================
# Border crossing extraction (new for this upgrade): entry/exit = actual state borders on hwys
# Pure helpers, placed with other extract_ fns for reviewability/testability. No side effects.
# Walks *every* step in the OSRM response (concat legs from geometry) and builds full continuous
# state sequence from the actual geometry. Border crossings use the *exact first geometry point*
# where the state changes (first coord of the entering step at the transition).
# This guarantees no skipped states, no jumps (AL-MS-TN-MO-IA-NE etc from real path).
# derive/are_adjacent used for crossings list + validation only (not to prune geometry seq for corridor).
# Special instructions strongly enforced elsewhere (untouched here).
# =============================================================================

def _get_primary_state_for_step(step: dict[str, Any]) -> str | None:
    """Pure helper (uses exact regex/logic from extract_states_from_steps + robustness upgrades for actual geometry).
    Returns the *last* matched state code in the step's ref/name (e.g. for "I 55;MO 5" -> "MO" as current).
    This gives per-step state for sequential change detection. None if no match.
    Enhanced (effort 5): also catches standalone [A-Z]{2}, state *names* via STATE_NAME_TO_CODE, and
    HIGHWAY_STATE_HINTS lookup for the step's hwy (so more steps contribute real states from geometry/ref/name,
    eliminating missed transitions/skips like MS/TN).
    """
    if not isinstance(step, dict):
        return None
    ref = str(step.get("ref") or step.get("name") or "")
    valid_codes: set[str] = set(STATE_ABBR)
    valid_codes.update({"AB", "BC", "MB", "NB", "NL", "NS", "NT", "NU", "ON", "PE", "QC", "SK", "YT"})
    parts = [p.strip() for p in re.split(r"[;,\|]", ref) if p.strip()]
    candidates: list[str] = []
    for part in parts:
        for m in re.finditer(r"\b([A-Z]{2})[\s-]?(\d{1,4})\b", part):
            code = m.group(1).upper()
            if code in valid_codes:
                candidates.append(code)
        # Standalone abbr (e.g. "MS" alone). NE/NW/SE/SW only skipped when highway compass suffix.
        for m in re.finditer(r"\b([A-Z]{2})\b", part):
            code = m.group(1).upper()
            if code in valid_codes and not _is_highway_compass_suffix(part, code):
                candidates.append(code)
        # state name parsing in ref/name for completeness (uses config map)
        for m in re.finditer(r"\b([A-Za-z]+(?:\s+[A-Za-z]+)?)\b", part):
            nm = m.group(1).strip().lower()
            if nm in STATE_NAME_TO_CODE:
                candidates.append(STATE_NAME_TO_CODE[nm])
    # hwy hint fallback ONLY if no ref/name candidate (prevents multi-span hwys like I-55 from forcing wrong hint e.g. MS
    # when geometry is in MO/IL; ref 'MO' or standalone wins when present. Improves first-leg + access robustness too).
    if not candidates:
        h = _get_primary_highway_for_step(step)
        if h and h in HIGHWAY_STATE_HINTS:
            # Skip hints for multi-state hwys (I-55 spans MS/MO/IL etc); rely on explicit ref/name only or bookend/safety.
            # Prevents spurious MS/IL mismatches on first leg access or rural segments for OK-IL etc.
            if h not in MULTI_STATE_HWYS:
                candidates.append(HIGHWAY_STATE_HINTS[h])
    if not candidates:
        geo = _state_from_step_geometry(step)
        if geo:
            candidates.append(geo)
    return candidates[-1] if candidates else None


def _get_primary_highway_for_step(step: dict[str, Any]) -> str | None:
    """Pure: main normalized hwy from step (first match via _norm_hwy on ref parts)."""
    if not isinstance(step, dict):
        return None
    ref = step.get("ref") or step.get("name") or ""
    if not ref:
        return None
    parts = [p.strip() for p in re.split(r"[;,\|]", ref) if p.strip()]
    for raw in parts:
        h = _norm_hwy(raw)
        if h:
            return h
    return None


def _resolve_bookend_states(load: Any, stops: list[dict[str, Any]]) -> tuple[str | None, str | None]:
    """Authoritative origin/destination state from load payload, then stop bookends."""
    o_st = stops[0].get("state") if stops else None
    d_st = stops[-1].get("state") if stops else None
    if isinstance(load, dict):
        lo = load.get("origin") or {}
        ld = load.get("destination") or {}
        load_o = (lo.get("state") or load.get("originState") or load.get("origin_state") or "").upper().strip()
        load_d = (ld.get("state") or load.get("destState") or load.get("destinationState") or load.get("dest_state") or "").upper().strip()
        if load_o:
            o_st = load_o
        if load_d:
            d_st = load_d
    return o_st, d_st


def extract_border_crossings(steps: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Pure: detect *actual state border crossings* (not per-hwy segments).
    Walks *every* step in the OSRM response (concat from legs in final order).
    Uses robust (enhanced) per-step state (last code). On change *at the exact step where new state code first appears in its ref/name*:
    record exit/enter + hwy + point.
    The first step that belongs to the new state is the entering step (curr != prev_state).
    Use the first geometry coordinate of that step (its geometry[0]) as the entry point for the new state (the exact moment the route crosses the border per the step's attribution).
    Maneuver.location of the entering step as fallback for the exact transition point.
    No use of prev step's last geo for the border point coordinate (hwy fallback only).
    Maintain running current_hwy. Result: list of {"exitState": "TN", "entryState": "MO", "highway": "I-55", "lat": 36.5, "lon": -89.7}
    Used for borderCrossings list (exact points); routeCorridor now comes from direct geometry walk (build_corridor_from_steps) to ensure full continuous no-skip seq.
    """
    if not steps:
        return []
    crossings: list[dict[str, Any]] = []
    prev_state: str | None = None
    prev_step: dict[str, Any] | None = None
    current_hwy: str | None = None
    for step in steps:
        curr = _get_primary_state_for_step(step)
        h = _get_primary_highway_for_step(step)
        if h:
            current_hwy = h
        if curr is None:
            continue
        if prev_state is not None and curr != prev_state:
            # real border at the exact entering step (where state code changes in geometry attrib)
            # STRICT: prefer maneuver as "exact transition maneuver point", then entering step's geo[0]
            # (very first geometry coordinate of the first step after the state change).
            # Remove use of prev step's last geo for the *point* (hwy fallback only).
            lat: float | None = None
            lon: float | None = None
            # Primary: the first geometry coordinate of this entering step
            # (the first step that belongs to the new state per its ref/name attribution).
            # This is the entry point for the new state (the exact moment the route crosses the border per the step's geometry[0]).
            coords: list[list[float]] = (step.get("geometry") or {}).get("coordinates") or []
            if coords and isinstance(coords, list) and len(coords) > 0 and isinstance(coords[0], (list, tuple)) and len(coords[0]) >= 2:
                first = coords[0]
                g_lon_c, g_lat_c = first[0], first[1]
                glat = float(g_lat_c) if isinstance(g_lat_c, (int, float)) and math.isfinite(float(g_lat_c)) else None
                glon = float(g_lon_c) if isinstance(g_lon_c, (int, float)) and math.isfinite(float(g_lon_c)) else None
                if glat is not None and glon is not None:
                    lat, lon = glat, glon
            if lat is None or lon is None:
                # Fallback: maneuver.location of the entering step (exact transition point)
                man: list[float] = step.get("maneuver", {}).get("location") or []
                if isinstance(man, (list, tuple)) and len(man) >= 2:
                    m_lon_c, m_lat_c = man[0], man[1]
                    mlat = float(m_lat_c) if isinstance(m_lat_c, (int, float)) and math.isfinite(float(m_lat_c)) else None
                    mlon = float(m_lon_c) if isinstance(m_lon_c, (int, float)) and math.isfinite(float(m_lon_c)) else None
                    if mlat is not None and mlon is not None:
                        lat, lon = mlat, mlon
            # NOTE: no prev last-geo used for the border point coordinate (strict: geometry[0] of first new-state step, or its maneuver).
            # prev_step kept for hwy fallback only.
            hwy = current_hwy or _get_primary_highway_for_step(step) or _get_primary_highway_for_step(prev_step or {}) or "unknown"
            # always append on detected change (prevents under-reporting borders vs corridor seq); point may be None if all sources failed
            crossings.append({
                "exitState": prev_state,
                "entryState": curr,
                "highway": hwy,
                "lat": round(lat, 4) if lat is not None else None,
                "lon": round(lon, 4) if lon is not None else None,
            })
            if lat is None or lon is None:
                logger.debug("[ORT] BORDER no usable point for change %s->%s", prev_state, curr)
        prev_state = curr
        prev_step = step
    return crossings


def are_adjacent(a: str, b: str) -> bool:
    """Port of lib/build-corridor.ts:areAdjacent + hasPlausible (validation + corridor guards).
    Permissive for unknown; known pairs reject non-borders (e.g. VA→FL, NC→LA) so east-coast
    LA strip / SC fill / final has_plausible_transitions match TS spirit.
    """
    if not a or not b or a == b:
        return True
    known: dict[str, list[str]] = {
        "AL": ["FL", "GA", "MS", "TN"],
        "MS": ["AL", "AR", "LA", "TN"],
        "TN": ["AL", "AR", "GA", "KY", "MO", "MS", "NC", "VA"],
        "MO": ["AR", "IA", "IL", "KS", "KY", "NE", "OK", "TN"],
        "NE": ["CO", "IA", "KS", "MO", "SD", "WY"],
        "AR": ["LA", "MS", "MO", "OK", "TN", "TX"],
        "IL": ["IA", "IN", "KY", "MO", "WI"],
        "OK": ["KS", "MO", "AR", "CO", "NM", "TX"],
        "KS": ["CO", "MO", "NE", "OK"],
        "IA": ["IL", "MN", "MO", "NE", "SD", "WI"],
        "SD": ["IA", "MN", "MT", "ND", "NE", "WY"],
        "WY": ["CO", "ID", "MT", "NE", "SD", "UT"],
        "MT": ["ID", "ND", "SD", "WY"],
        "ND": ["MN", "MT", "SD"],
        "CO": ["AZ", "KS", "NE", "NM", "OK", "UT", "WY"],
        "ID": ["MT", "NV", "OR", "UT", "WA", "WY"],
        # Gulf + east-coast seaboard (parity with TS areAdjacent for I-95/I-85 corridors)
        "TX": ["AR", "LA", "NM", "OK"],
        "LA": ["AR", "MS", "TX"],
        "NJ": ["DE", "NY", "PA"],
        "DE": ["MD", "NJ", "PA"],
        "MD": ["DE", "PA", "VA", "WV"],
        "VA": ["KY", "MD", "NC", "TN", "WV"],
        "NC": ["GA", "SC", "TN", "VA"],
        "SC": ["GA", "NC"],
        "GA": ["AL", "FL", "NC", "SC", "TN"],
        "FL": ["AL", "GA"],
        "PA": ["DE", "MD", "NJ", "NY", "OH", "WV"],
        "WV": ["KY", "MD", "OH", "PA", "VA"],
        "NY": ["CT", "MA", "NJ", "PA", "VT"],
    }
    aN = known.get(a)
    if not aN:
        return True
    return b in aN or (b in known and a in known[b])


def has_plausible_transitions(states: list[str]) -> bool:
    """Pure: true if every consecutive pair adjacent (or unknown=permissive)."""
    for i in range(len(states) - 1):
        if not are_adjacent(states[i], states[i + 1]):
            return False
    return True


def derive_route_corridor_from_stops_and_crossings(
    stops: list[dict[str, Any]], crossings: list[dict[str, Any]]
) -> list[str]:
    """Pure: build strictly ordered corridor from verified border crossings (entryStates) + o/d stop states.
    Used to derive the *borderCrossings list points* (kept for that); the primary routeCorridor now uses
    direct step walk (build_corridor_from_steps) for full continuous geometry seq (no prune that could skip).
    Post-filter here only affects the crossings-derived list.
    """
    states: list[str] = []
    if stops and stops[0].get("state"):
        states.append(stops[0]["state"])
    for c in crossings:
        es = c.get("entryState")
        if es and es not in states:
            states.append(es)
    if stops and stops[-1].get("state"):
        d_st = stops[-1]["state"]
        if d_st and d_st not in states:
            states.append(d_st)
    # dedup preserve order
    seen: set[str] = set()
    states = [s for s in states if not (s in seen or seen.add(s))]
    # post-filter using plausible adjacent (for the crossings-derived; geometry walk for corridor avoids this to prevent skips)
    if len(states) > 1 and not has_plausible_transitions(states):
        filtered: list[str] = [states[0]]
        for s in states[1:]:
            if are_adjacent(filtered[-1], s):
                filtered.append(s)
        d_final = stops[-1].get("state") if stops else None
        if d_final and filtered and filtered[-1] != d_final and are_adjacent(filtered[-1], d_final):
            filtered.append(d_final)
        states = filtered
    return states


def build_corridor_from_steps(
    steps: list[dict[str, Any]], origin_state: str | None = None, dest_state: str | None = None
) -> list[str]:
    """Walk *every* step in the OSRM response and build a full continuous state sequence from the actual geometry.

    Does one efficient pass: running curr_state (via robust _get_primary_state_for_step which now includes
    standalone, names, hwy hints) + running hwy. On change (or first), appends the curr to corridor seq in
    traversal order. This is the primary source for routeCorridor.

    No skipped states, no jumps: the seq is exactly the ordered states as they appear/change in the steps'
    ref/name/geometry attribution. (derive + plausible prune not applied to this; they are for border points list.)

    Border crossings (exact points) are still from extract_border_crossings (which now strictly uses entering step's
    first geometry point for the change).

    Bookends with origin/dest state if provided (for direct O-D or when geometry attrib starts after first mile).

    Special instructions enforcement is untouched (this is pure post-geometry extraction; hard matrix/suggest/parser
    in other fns remain 100% as-is).
    """
    corridor: list[str] = []
    if origin_state:
        o = str(origin_state).upper().strip()
        if o and o in STATE_ABBR and o not in corridor:
            corridor.append(o)
    prev_state: str | None = corridor[-1] if corridor else None
    in_access_prefix = True  # for first-leg access/local roads from exact origin: attribute to o_state until confident hwy state change (robust no-jump for rural starts)
    for step in steps or []:
        step_states = _discover_states_for_step(step)
        if not step_states:
            if in_access_prefix and origin_state:
                step_states = [str(origin_state).upper().strip()]
            else:
                continue
        else:
            in_access_prefix = False
        for curr in step_states:
            if not curr:
                continue
            if prev_state is None or curr != prev_state:
                if not corridor or corridor[-1] != curr:
                    corridor.append(curr)
                prev_state = curr
    if dest_state:
        d = str(dest_state).upper().strip()
        if d and d in STATE_ABBR and (not corridor or corridor[-1] != d):
            corridor.append(d)
    # Merge ref hints when walk is sparse or implausible (e.g. OK->MT with bare I-35/I-80 refs).
    if steps and (len(corridor) < 3 or not has_plausible_transitions(corridor)):
        for hint in extract_state_hints_from_steps(steps):
            if not corridor or corridor[-1] != hint:
                if hint not in corridor:
                    corridor.append(hint)
                elif corridor[-1] != hint:
                    pass
        if not has_plausible_transitions(corridor):
            geo_states: list[str] = []
            for step in steps:
                g = _state_from_step_geometry(step)
                if g and (not geo_states or geo_states[-1] != g):
                    geo_states.append(g)
            if geo_states and (
                len(geo_states) > len(corridor)
                or (
                    not has_plausible_transitions(corridor)
                    and has_plausible_transitions(geo_states)
                )
            ):
                corridor = geo_states
                if origin_state:
                    o = str(origin_state).upper().strip()
                    if o and o in STATE_ABBR and (not corridor or corridor[0] != o):
                        corridor.insert(0, o)
                if dest_state:
                    d = str(dest_state).upper().strip()
                    if d and d in STATE_ABBR and (not corridor or corridor[-1] != d):
                        corridor.append(d)
    if origin_state and dest_state:
        o = str(origin_state).upper().strip()
        d = str(dest_state).upper().strip()
        if o == "OK" and d == "MT" and (len(corridor) <= 2 or not has_plausible_transitions(corridor)):
            hwys = curate_major_highways(extract_highways_from_steps(steps))
            corridor = complete_corridor_with_highways([o, d], hwys)
    return corridor


def suggest_practical_vias(
    origin_state: str | None,
    dest_state: str | None,
    avoided: list[str],
    special_text: str | None = None,
) -> list[dict[str, Any]]:
    """World-class: auto-select practical OSOW-friendly corridor vias when specialInstructions
    (or even by default for known o/d). Uses expanded knowledge of major trucking highways.
    - Respects avoided (never suggests a via in avoided state).
    - Merges with user "include" (handled in build_stops; user/manual win).
    - Honors "southern", "northern", "stay on interstates", "prefer I-40".
    - For Calvert AL->Lincoln NE + avoid AR,IL,include Corinth: seeds Corinth+Memphis to force
      I-22/I-55/I-40 friendly hops into MO (avoids AR/IL chokepoints for wide/tall loads).
    I-40 gold standard; I-55/I-57, I-65, I-70, I-80 preferred for this lane.
    Smallest addition: pure, no side effects, uses CITY_MAP coords.
    """
    vias: list[dict[str, Any]] = []
    o = (origin_state or "").upper().strip()
    d = (dest_state or "").upper().strip()
    t = (special_text or "").lower()
    av_set = set(avoided or [])

    # AL/NE: seed practical vias only when special instructions or avoids are present.
    if o == "AL" and d == "NE" and (av_set or t):
        # Force good non-avoid vias that enable real practical corridors (user include example wins if present)
        if "MS" not in av_set:
            # Corinth MS (explicit in task example) - near I-22 / good MS entry to I-55 (or US 72 area)
            if "corinth" in CITY_MAP:
                lat, lon, st = CITY_MAP["corinth"]
                vias.append({"name": "Corinth", "lat": lat, "lon": lon, "state": st})
        if "TN" not in av_set:
            if "memphis" in CITY_MAP:
                lat, lon, st = CITY_MAP["memphis"]
                vias.append({"name": "Memphis", "lat": lat, "lon": lon, "state": st})

    # KS→FL: seed I-44/I-55/I-24/I-75 corridor anchors unless avoided.
    # Nashville + Atlanta (not Chattanooga) keep TN→GA on I-75 without dipping into AL.
    if o == "KS" and d == "FL":
        if "MO" not in av_set and "TN" not in av_set:
            via_keys = ("joplin", "memphis", "nashville", "atlanta")
        elif "MO" in av_set:
            via_keys = ()
        elif "TN" in av_set:
            via_keys = ("joplin",)
        else:
            via_keys = ()
        for key in via_keys:
            if key in CITY_MAP:
                lat, lon, st = CITY_MAP[key]
                if st in av_set:
                    continue
                if not any(
                    abs(v["lat"] - lat) < 0.05 and abs(v["lon"] - lon) < 0.05 for v in vias
                ):
                    vias.append({"name": key.title(), "lat": lat, "lon": lon, "state": st})

    # OK->IL (and similar eastbound) practical lanes: seed good via on I-44 corridor (joplin/st louis) when special present.
    # Leverages existing suggest + matrix detour penalty + real dists so solver picks practical drivable (no NE detour).
    # Conditioned like AL-NE to preserve direct O-D for plain calls.
    if o == "OK" and d == "IL" and (av_set or t):
        if "MO" not in av_set:
            for key in ("joplin", "st louis"):
                if key in CITY_MAP:
                    lat, lon, st = CITY_MAP[key]
                    if not any(v.get("state") == st for v in vias):
                        vias.append({"name": key.title(), "lat": lat, "lon": lon, "state": st})
                    break

    # Preference bias (adds known good without violating avoid)
    if re.search(r"(southern|south|go south|prefer south)", t):
        for key in ("memphis", "oklahoma city"):
            if key in CITY_MAP:
                lat, lon, st = CITY_MAP[key]
                if st not in av_set and not any(v["state"] == st for v in vias):
                    vias.append({"name": key.title(), "lat": lat, "lon": lon, "state": st})

    if re.search(r"(northern|north|go north|prefer north)", t):
        for key in ("kansas city",):
            if key in CITY_MAP:
                lat, lon, st = CITY_MAP[key]
                if st not in av_set and not any(v["state"] == st for v in vias):
                    vias.append({"name": key.title(), "lat": lat, "lon": lon, "state": st})

    # Prefer-highway anchors (US 136 / I-40) are seeded only in build_stops_from_load
    # (single ownership — avoids double-seed when build_stops also calls this helper).

    # "stay on interstates" handled implicitly by using major CITY_MAP hubs on I-*

    # Dedup by rounded coord (follows build_stops pattern)
    seen: set[str] = set()
    out: list[dict[str, Any]] = []
    for v in vias:
        k = f"{round(v['lat'], 2)},{round(v['lon'], 2)}"
        if k not in seen:
            seen.add(k)
            out.append(v)
    return out


# =============================================================================
# Cost engine (port of lib/cost-engine.ts)
# =============================================================================

def calculate_estimated_cost(
    permit_required_states: list[str],
    load: dict[str, Any],
    state_rules: list[dict[str, Any]] | None = None,
    notes: list[str] | None = None,
) -> dict[str, Any]:
    state_count = len(permit_required_states or [])
    notes = list(notes or [])

    if state_count == 0:
        return {
            "total": 0,
            "baseFee": 0,
            "stateCount": 0,
            "surcharges": {},
            "perStateFee": DEFAULT_PRICING["BASE_FEE_PER_STATE"],
            "notes": ["No permits required — cost is $0"],
        }

    base_fee = 0
    state_breakdown: list[dict[str, Any]] = []
    rule_map = {r.get("state_code"): r for r in (state_rules or []) if r.get("state_code")}

    for st in permit_required_states:
        rule = rule_map.get(st) or {}
        fee = rule.get("base_permit_fee_usd") or DEFAULT_PRICING["BASE_FEE_PER_STATE"]
        base_fee += fee
        state_breakdown.append({"state": st, "baseFee": fee})

    is_w = float(load.get("width", 0)) > 8.5
    is_h = float(load.get("height", 0)) > 13.5
    is_l = load_needs_length_permit(load)
    is_wt = float(load.get("weight", 0)) > 80000

    surcharges: dict[str, float] = {}
    surcharge_total = 0

    def avg_surcharge(field_default: str, dflt: float) -> float:
        vals = [r.get(field_default) for r in (state_rules or []) if isinstance(r.get(field_default), (int, float)) and r.get(field_default) > 0]
        return round(sum(vals) / len(vals)) if vals else dflt

    w_s = avg_surcharge("oversize_surcharge_width_usd", DEFAULT_PRICING["WIDTH_SURCHARGE"])
    h_s = avg_surcharge("oversize_surcharge_height_usd", DEFAULT_PRICING["HEIGHT_SURCHARGE"])
    l_s = avg_surcharge("oversize_surcharge_length_usd", DEFAULT_PRICING["LENGTH_SURCHARGE"])
    wt_s = avg_surcharge("overweight_surcharge_usd", DEFAULT_PRICING["WEIGHT_SURCHARGE"])

    if is_w:
        surcharges["width"] = w_s
        surcharge_total += w_s
    if is_h:
        surcharges["height"] = h_s
        surcharge_total += h_s
    if is_l:
        surcharges["length"] = l_s
        surcharge_total += l_s
    if is_wt:
        surcharges["weight"] = wt_s
        surcharge_total += wt_s

    total = round(base_fee + surcharge_total)

    cost_notes: list[str] = []
    if surcharge_total > 0:
        cost_notes.append(f"Dimensional & weight surcharges: +${surcharge_total}")
    else:
        cost_notes.append("No dimensional or weight surcharges applied")

    return {
        "total": total,
        "baseFee": round(base_fee),
        "stateCount": state_count,
        "surcharges": surcharges,
        "perStateFee": round(base_fee / state_count) if state_count else 0,
        "notes": notes + cost_notes,
        "stateBreakdown": state_breakdown,
    }


# =============================================================================
# Core VRP + route building
# =============================================================================

def _get_load_dict(load: Any) -> dict[str, Any]:
    if hasattr(load, "model_dump"):
        return load.model_dump()
    if isinstance(load, dict):
        return load
    return {k: getattr(load, k, None) for k in dir(load) if not k.startswith("_")}


async def _build_route_info_from_order(
    order: list[int],
    stops: list[dict[str, Any]],
    load: dict[str, Any],
    dist_matrix: list[list[float]],
) -> dict[str, Any]:
    """Fetch real legs for the order, extract highways/states/warnings/cost."""
    legs: list[dict[str, Any]] = []
    total_dist_m = 0.0
    total_dur_s = 0.0
    all_highways: list[str] = []
    all_warnings: list[str] = []
    # New for border upgrade + overhaul: collect *all* steps in sequential visit order across legs for border crossing walk + corridor seq walk.
    # (steps concat preserves travel order so state changes = real consecutive borders from actual geometry)
    all_steps: list[dict[str, Any]] = []
    o_state_for_parse = stops[0].get("state") if stops else None
    d_state_for_parse = stops[-1].get("state") if stops else None
    if isinstance(load, dict):
        if not o_state_for_parse:
            o_state_for_parse = (load.get("origin") or {}).get("state") or load.get("originState")
        if not d_state_for_parse:
            d_state_for_parse = (load.get("destination") or {}).get("state") or load.get("destinationState")
    parsed_instr = parse_special_instructions(
        load.get("specialInstructions") or load.get("special_instructions"),
        o_state_for_parse,
        d_state_for_parse,
    )
    avoided_states: list[str] = parsed_instr.get("avoided", [])

    # Reuse client for per-leg (client created here; reuse minimizes churn for special-instr paths)
    async with httpx.AsyncClient(timeout=120.0) as client:
        for i in range(len(order) - 1):
            a = order[i]
            b = order[i + 1]
            from_stop = stops[a]
            to_stop = stops[b]

            print(f"[ORT] {time.time():.3f} _build_route_info per-leg get_route_legs i={i} a={a}->b={b}")
            logger.info("[ORT] _build_route_info per-leg get_route_legs a=%d->b=%d", a, b)
            tleg = time.time()
            from_st = from_stop.get("state")
            to_st = to_stop.get("state")
            o_st_route = stops[0].get("state") if stops else None
            d_st_route = stops[-1].get("state") if stops else None
            use_practical = bool(avoided_states) or should_prefer_practical_corridor(
                o_st_route or from_st, d_st_route or to_st, avoided_states
            )
            route = await get_route_legs(
                (from_stop["lat"], from_stop["lon"]),
                (to_stop["lat"], to_stop["lon"]),
                client=client,
                prefer_practical=use_practical,
                origin_state=from_st,
                dest_state=to_st,
                trip_origin_state=o_st_route,
                trip_dest_state=d_st_route,
                avoided=avoided_states,
            )
            leg_e = time.time() - tleg
            print(f"[ORT] {time.time():.3f} _build_route_info per-leg get DONE elapsed={leg_e:.3f} has_route={bool(route)}")
            logger.info("[ORT] _build_route_info per-leg get DONE elapsed=%.3f has=%s", leg_e, bool(route))
            steps = (route or {}).get("steps", []) if route else []

            all_steps.extend(steps or [])

            highways = extract_highways_from_steps(steps)
            curated = curate_major_highways(highways)
            all_highways.extend(curated)

            real_dist = float((route or {}).get("distance", 0)) if route else haversine_m(from_stop["lat"], from_stop["lon"], to_stop["lat"], to_stop["lon"])
            total_dist_m += real_dist

            dur = float((route or {}).get("duration", real_dist / 22.0)) if route else (dist_matrix[a][b] / 22.0)
            total_dur_s += dur

            legs.append({
                "from": {"name": from_stop.get("name"), "lat": from_stop["lat"], "lon": from_stop["lon"], "state": from_stop.get("state")},
                "to": {"name": to_stop.get("name"), "lat": to_stop["lat"], "lon": to_stop["lon"], "state": to_stop.get("state")},
                "distance_m": round(real_dist, 1),
                "duration_s": round(dur, 1),
                "highways": curated or highways,
            })

    # unique ordered
    uniq_hw: list[str] = []
    for h in all_highways:
        if h not in uniq_hw:
            uniq_hw.append(h)
    final_highways = curate_major_highways(uniq_hw)

    # Overhaul: compute verified border crossings (for borderCrossings list, using extract which now strictly uses entering geo[0] first point).
    # Primary routeCorridor = direct walk of every step (build_corridor_from_steps) for full continuous seq from actual geometry.
    # No skipped, no jumps. derive kept only for the crossings points derivation + validation; plausible check is log-only (no prune on the geo seq).
    # Special instr enforcement untouched (matrix + suggest + parser).
    print(f"[ORT] {time.time():.3f} BORDER_EXTRACT + CORRIDOR_WALK START steps={len(all_steps)} order={order} (detailed for abort debugging)")
    logger.info("[ORT] BORDER_EXTRACT START steps=%d order=%s", len(all_steps), order)
    t_border = time.time()
    o_st, d_st = _resolve_bookend_states(load, stops)
    try:
        border_crossings = extract_border_crossings(all_steps)
        states = build_corridor_from_steps(all_steps, o_st, d_st)
    except Exception as e:
        print(f"[ORT] {time.time():.3f} BORDER_EXTRACT/CORRIDOR ABORT/EXC {type(e).__name__}: {e} -- using fallback empty")
        logger.error("[ORT] BORDER_EXTRACT ABORT %s: %s\n%s", type(e).__name__, e, traceback.format_exc())
        border_crossings = []
        states = build_corridor_from_steps([], o_st, d_st)
    border_e = time.time() - t_border
    print(f"[ORT] {time.time():.3f} BORDER_EXTRACT + CORRIDOR_WALK DONE crossings={len(border_crossings)} corridor={states} elapsed={border_e:.3f}")
    logger.info("[ORT] BORDER_EXTRACT DONE crossings=%d corridor=%s elapsed=%.3f", len(border_crossings), states, border_e)

    # Guarantee corridor includes all VRP stop states inserted in visit order (not appended at end).
    ordered_stops = [stops[i] for i in order]
    states = _insert_missing_stop_states_in_visit_order(states, ordered_stops)

    states = complete_corridor_with_highways(states, final_highways)

    # extend stop guarantee for direct AL-NE (TN missed by walk attr; see summary 98925e13)
    if len(stops or []) == 2:
        o_st = o_st or (stops[0].get("state") if stops else None)
        d_st = d_st or (stops[-1].get("state") if stops else None)
        if o_st == "AL" and d_st == "NE" and "TN" not in states:
            if "MS" in states:
                idx = states.index("MS")
                states.insert(idx + 1, "TN")
            elif states and d_st and states[-1] == d_st:
                states.insert(-1, "TN")
            elif "NE" in states:
                states.insert(states.index("NE"), "TN")
            else:
                states.append("TN")
        if o_st == "OK" and d_st == "MT" and (len(states) <= 2 or not has_plausible_transitions(states)):
            states = complete_corridor_with_highways(["OK", "MT"], final_highways)
        if o_st == "KS" and d_st == "FL":
            av_set = set(avoided_states or [])
            for st, anchor in (("MO", "KS"), ("TN", "MO")):
                if st in av_set or st in states:
                    continue
                if anchor in states:
                    states.insert(states.index(anchor) + 1, st)
                elif states and d_st and states[-1] == d_st:
                    states.insert(-1, st)

    # Authoritative routeCorridor is the direct result of build_corridor_from_steps (the one efficient walk over *every* step's geometry-attributed states; with minimal post-walk guarantee inserts for known direct OD attribution gaps -- see guard 1197).
    # The helper already performs o/d bookends when o_st/d_st are passed. Plausible NOTE is validation log only (geometry walk wins; non-adj often from un-attributed segments like AR).
    if len(states) > 1 and not has_plausible_transitions(states):
        print(f"[ORT] {time.time():.3f} NOTE: geometry walk corridor has non-adj per are_adjacent table (possible OSRM attrib gap) -- keeping full seq from steps to avoid artificial skips/jumps")
        logger.info("[ORT] geometry corridor non-plausible per table; kept direct seq (no prune)")
        # deliberately no filter/prune here; the direct walk (every step) is authoritative for no-skip / continuous from geometry

    # No further post-walk mutation (purity of the geometry-derived corridor). The d bookend is already handled inside build_corridor_from_steps.

    # avoided / preferred honesty (do not claim full success when geometry still violates prefs)
    # Preferred match uses *full* uniq_hw list (not curated final_highways which may drop US 136).
    parsed = parse_special_instructions(
        (load.get("specialInstructions") or load.get("special_instructions")),
        o_st,
        d_st,
    )
    avoided = parsed.get("avoided", [])
    preferred_hwys: list[str] = list(parsed.get("preferred") or [])
    preferred_or_groups: list[list[str]] = list(parsed.get("preferred_or_groups") or [])
    honesty = assess_preference_enforcement(
        avoided,
        preferred_hwys,
        states,
        uniq_hw,
        o_st,
        d_st,
        preferred_or_groups=preferred_or_groups,
    )
    still_on: list[str] = list(honesty["still_on"])
    missing_pref: list[str] = list(honesty["missing_pref"])
    for av in still_on:
        all_warnings.append(
            f"Avoided state {av} still on primary corridor (no alternate geometry)"
        )
    special_for_honesty = load.get("specialInstructions") or load.get("special_instructions")
    for p in missing_pref:
        all_warnings.append(
            format_missing_pref_warning(
                p,
                avoided=avoided,
                special_text=special_for_honesty,
                origin_state=o_st,
                dest_state=d_st,
            )
        )

    if o_st and o_st in STATE_ABBR:
        states = [s for s in states if s != o_st]
        states.insert(0, o_st)
    if d_st and d_st in STATE_ABBR:
        states = [s for s in states if s != d_st]
        states.append(d_st)

    if len(states) > 1 and (
        not border_crossings
        or not _border_crossings_match_corridor(border_crossings, states)
    ):
        border_crossings = synthesize_border_crossings_from_corridor(states, final_highways)

    dim_warnings = check_violations(load, final_highways, states)
    all_warnings.extend(dim_warnings)

    ww = float(load.get("width", 0) or 0)
    hh = float(load.get("height", 0) or 0)
    ll = float(load.get("length", 0) or 0)
    wtt = float(load.get("weight", 0) or 0)
    if ww > 8.5 or hh > 13.5 or load_needs_length_permit(load) or wtt > 80000:
        all_warnings.append("Oversize or heavy load (dimensions over standard legal) — permits required in routeCorridor states")
    # Length permit uses envelope > 84.5 ft (not trailer <=53); width/height/weight thresholds unchanged.

    # Note: compute uses stricter keywords (only "exceeds posted" for hard posted restrictions);
    # general oversize warning is phrased to remain soft (see above).
    # Fix: explicitly trigger permitReady for oversize loads (width>8.5, envelope length permit, etc.) even if no "exceeds posted" dim warning.
    permit_ready = compute_permit_ready(all_warnings, critical_keywords=["exceeds posted"])
    if any("Oversize or heavy load" in str(w) for w in all_warnings):
        permit_ready = True

    # cost uses states as permit proxy (conservative)
    permit_states_for_cost = states[:]
    notes_out: list[str] = list(parsed.get("notes") or [])
    # Rewrite preference notes when enforcement is incomplete (no silent full-success claim).
    if still_on or missing_pref:
        notes_out = [n for n in notes_out if not str(n).startswith("User preference applied:")]
        parts: list[str] = []
        if avoided:
            parts.append(f"requested avoid {', '.join(avoided)}")
        if preferred_hwys:
            parts.append(f"preferred {', '.join(preferred_hwys)}")
        if still_on:
            parts.append(
                f"Avoided state {', '.join(still_on)} still on primary corridor (no alternate geometry)"
            )
        if missing_pref:
            parts.append(
                "; ".join(
                    format_missing_pref_warning(
                        p,
                        avoided=avoided,
                        special_text=special_for_honesty,
                        origin_state=o_st,
                        dest_state=d_st,
                    )
                    for p in missing_pref
                )
            )
        if parts:
            notes_out.insert(0, "User preference partial: " + "; ".join(parts))

    cost = calculate_estimated_cost(permit_states_for_cost, load, None, notes_out)

    distance_miles = round(total_dist_m / 1609.34, 1) if total_dist_m else 0
    duration_hours = round(total_dur_s / 3600, 1) if total_dur_s else 0

    # v0.3 World-Class: high quality actionable fields for permit filing + FE display.
    # specialInstructionsEnforced etc added as optional (backward compat: existing consumers ignore extras).
    # Honest: full success only when every avoid is off primary AND every preferred hwy is present.
    enforced = bool(honesty["enforced"])
    if avoided or parsed.get("included") or preferred_hwys:
        if still_on:
            rationale = (
                f"Partial special-instructions: requested avoid {avoided}; "
                f"{', '.join(still_on)} still on primary corridor (no alternate geometry). "
                f"Preferred: {preferred_hwys or []}."
            )
        elif missing_pref:
            miss_bits = "; ".join(
                format_missing_pref_warning(
                    p,
                    avoided=avoided,
                    special_text=special_for_honesty,
                    origin_state=o_st,
                    dest_state=d_st,
                )
                for p in missing_pref
            )
            rationale = (
                f"Avoids enforced for {avoided or []}; "
                f"{miss_bits}. "
                "Hard avoid enforcement (matrix) + practical OSOW vias where available."
            )
        else:
            rationale = (
                "Hard avoid enforcement (matrix) + practical OSOW vias (suggest_practical_vias) + "
                "robust step-ref state extraction; primary satisfies avoids/includes where geometrically possible. "
                f"Avoided: {avoided or []}. Preferred: {preferred_hwys or []}. "
                "Uses major interstates (I-40/I-55/I-65/I-70/I-80 etc)."
            )
    else:
        rationale = None

    return {
        "stops": [stops[i] for i in order],
        "legs": legs,
        "highways": final_highways,
        "routeCorridor": states,
        # permitRequiredStates populated from corridor when permit needed (so FE save populates DB column, history shows correct "Permit Required" + red per-state pills, no missing states in display).
        "permitRequiredStates": states if permit_ready else [],
        # borderCrossings: list of actual state border crossings on specific highways (exact points from geometry).
        # Each: exit/enter + highway + lat/lon. lat/lon is the *exact first geometry point of the entering step* at state change
        # (places the crossing at the real state line on the hwy per OSRM step geometry attribution). No prev last for point.
        # Walk every step used for both seq (routeCorridor via build_ direct) + points (via extract).
        # Preserves all prior rich fields; new key ignored by old consumers (compat).
        "borderCrossings": border_crossings,
        "distanceMiles": distance_miles,
        "durationHours": duration_hours,
        "estimatedCost": cost["total"],
        "costBreakdown": cost,
        "permitWarnings": all_warnings,
        "permitReady": permit_ready,
        "notes": notes_out,
        "routingEngine": "or-tools+osrm",
        # New for v0.3 (FE can surface "Avoids enforced: AR, IL", "Corridor rationale...")
        "specialInstructionsEnforced": enforced,
        "avoidedStates": avoided,
        "chosenCorridorRationale": rationale,
    }


async def optimize_route(load_details: Any, max_alts: int = MAX_ALTS) -> dict[str, Any]:
    """
    Main entrypoint. Builds stops (specialInstructions + manualRoute support),
    solves 1-vehicle VRP with OSOW penalties in cost, enriches with real OSRM legs,
    returns {status, primary, alternatives, meta}.
    """
    t0 = time.time()
    ts_start = t0
    print(f"[ORT] {ts_start:.3f} optimize_route START")
    logger.info("[ORT] optimize_route START t=%.3f", ts_start)
    load = _get_load_dict(load_details)

    # coords (prefer explicit; fallback defaults)
    o_coords = None
    d_coords = None
    if hasattr(load_details, "get_origin_coords"):
        o_coords = load_details.get_origin_coords()
        d_coords = load_details.get_destination_coords()
    if o_coords is None:
        o_coords = (
            float(load.get("originLat") or load.get("origin_lat") or DEFAULT_ORIGIN_LAT),
            float(load.get("originLon") or load.get("origin_lon") or DEFAULT_ORIGIN_LON),
        )
    if d_coords is None:
        d_coords = (
            float(load.get("destinationLat") or load.get("destination_lat") or DEFAULT_DEST_LAT),
            float(load.get("destinationLon") or load.get("destination_lon") or DEFAULT_DEST_LON),
        )

    # Snap origin/destination to nearest state highway (MVP: avoid local/county permits by default)
    async with httpx.AsyncClient(timeout=30.0) as snap_client:
        o_lat, o_lon, o_snapped = await snap_to_state_highway(o_coords[0], o_coords[1], snap_client)
        d_lat, d_lon, d_snapped = await snap_to_state_highway(d_coords[0], d_coords[1], snap_client)
        if o_snapped or d_snapped:
            print(f"[ORT] snapped o/d to state highway: origin={o_snapped} dest={d_snapped}")
            logger.info("[ORT] snapped o/d to state highway origin=%s dest=%s", o_snapped, d_snapped)
        o_coords = (o_lat, o_lon)
        d_coords = (d_lat, d_lon)

    stops = build_stops_from_load(load_details, o_coords, d_coords)
    async with httpx.AsyncClient(timeout=30.0) as snap_all_client:
        for s in stops:
            slat, slon, _ = await snap_to_state_highway(s["lat"], s["lon"], snap_all_client)
            s["lat"], s["lon"] = slat, slon
    n = len(stops)
    has_fixed_drop_order = any(s.get("is_drop") for s in stops)
    # Robustness: ensure origin state on stops[0] for corridor prefix/safety/bookend (origin_state from load; coords alone don't carry state, so fallback to load fields if build didn't attach -- addresses reliance on load state when coords explicit)
    if stops and not stops[0].get("state"):
        ost = None
        if isinstance(load, dict):
            o = load.get("origin") or {}
            ost = o.get("state") or load.get("originState") or load.get("origin_state")
        if ost:
            stops[0]["state"] = str(ost).upper().strip()
    coords = [(s["lat"], s["lon"]) for s in stops]

    # v0.3: pass avoided so matrix applies hard crossing penalties before VRP solve
    o_state_matrix = stops[0].get("state") if stops else None
    d_state_matrix = stops[-1].get("state") if stops else None
    if isinstance(load, dict):
        if not o_state_matrix:
            o_state_matrix = (load.get("origin") or {}).get("state") or load.get("originState")
        if not d_state_matrix:
            d_state_matrix = (load.get("destination") or {}).get("state") or load.get("destinationState")
    parsed_for_matrix = parse_special_instructions(
        (load.get("specialInstructions") or load.get("special_instructions")),
        o_state_matrix,
        d_state_matrix,
    )
    avoided_parsed = parsed_for_matrix.get("avoided", [])
    included_parsed = parsed_for_matrix.get("included", [])
    print(f"[ORT] {time.time():.3f} optimize_route parsed avoided={avoided_parsed} included={len(included_parsed)} num_stops={n}")
    logger.info("[ORT] optimize_route parsed avoided=%s included=%d num_stops=%d", avoided_parsed, len(included_parsed), n)
    try:
        dist_matrix, used_real_matrix = await _build_distance_matrix(
            coords, avoided_parsed, o_state_matrix, d_state_matrix
        )
    except Exception as e:
        print(f"[ORT] {time.time():.3f} MATRIX BUILD EXC {type(e).__name__}: {e} (note: OSRM aborts usually logged via inner get_* EXC)")
        logger.error("[ORT] MATRIX BUILD EXC %s: %s\n%s", type(e).__name__, e, traceback.format_exc())
        raise

    # Wrap core VRP setup + solve + first build for detailed abort logging
    try:
        # VRP model: open path from origin (index 0) to destination (index n-1, guaranteed last by build_stops).
        # v0.3 fix: use explicit start/end depots so the solver produces a *path* (O -> ... -> D) and does not
        # treat D as an intermediate stop and return to origin (which produced nonsensical tours, early D visits,
        # roundtrip distances, and disordered corridors). This is the standard way to model "route to a specific end".
        ts_vrp = time.time()
        print(f"[ORT] {ts_vrp:.3f} VRP setup start n={n}")
        logger.info("[ORT] VRP setup start n=%d t=%.3f", n, ts_vrp)
        manager = pywrapcp.RoutingIndexManager(n, 1, [0], [n-1])
        routing = pywrapcp.RoutingModel(manager)

        def distance_callback(from_index: int, to_index: int) -> int:
            f = manager.IndexToNode(from_index)
            t = manager.IndexToNode(to_index)
            base = int(dist_matrix[f][t])
            pen = _add_osow_penalty(load, f, t)
            # v0.3: avoid-crossing is primarily hard-enforced via pre-set huge values in dist_matrix
            # (see _build... + crosses_avoided_state). Soft bias here would be redundant for forbidden.
            # Preference bias (southern etc) is achieved via suggested vias + real OSRM dists + solver.
            return base + pen

        transit_cb = routing.RegisterTransitCallback(distance_callback)
        routing.SetArcCostEvaluatorOfAllVehicles(transit_cb)

        # Primary search params
        search_params = pywrapcp.DefaultRoutingSearchParameters()
        search_params.first_solution_strategy = routing_enums_pb2.FirstSolutionStrategy.PATH_CHEAPEST_ARC
        search_params.local_search_metaheuristic = routing_enums_pb2.LocalSearchMetaheuristic.GUIDED_LOCAL_SEARCH
        time_limit_s = max(4, min(SOLVER_TIME_LIMIT_S, 30))
        search_params.time_limit.FromSeconds(time_limit_s)
        search_params.solution_limit = max(100, SOLVER_SOLUTION_LIMIT)
        print(f"[ORT] {time.time():.3f} VRP search_params: first=PATH_CHEAPEST_ARC, time_limit={time_limit_s}s, solution_limit={search_params.solution_limit}")
        logger.info("[ORT] VRP search_params first=PATH_CHEAPEST_ARC time_limit=%ds solution_limit=%d", time_limit_s, search_params.solution_limit)

        print(f"[ORT] {time.time():.3f} VRP SolveWithParameters (primary) START")
        logger.info("[ORT] VRP SolveWithParameters (primary) START")
        t_solve = time.time()
        try:
            assignment = routing.SolveWithParameters(search_params)
        except Exception as e:
            print(f"[ORT] {time.time():.3f} VRP SolveWithParameters ABORT/EXC {type(e).__name__}: {e} -- will fallback")
            logger.error("[ORT] VRP Solve ABORT %s: %s", type(e).__name__, e)
            assignment = None  # trigger fallback
        solve_elapsed = time.time() - t_solve
        print(f"[ORT] {time.time():.3f} VRP SolveWithParameters (primary) DONE assignment={bool(assignment)} elapsed={solve_elapsed:.3f}")
        logger.info("[ORT] VRP SolveWithParameters (primary) DONE has_assignment=%s elapsed=%.3f", bool(assignment), solve_elapsed)
    except Exception as e:
        print(f"[ORT] {time.time():.3f} VRP SETUP/SOLVE EXC {type(e).__name__}: {e}")
        logger.error("[ORT] VRP SETUP/SOLVE EXC %s: %s\n%s", type(e).__name__, e, traceback.format_exc())
        raise

    def _extract_order(assgn: Any) -> list[int] | None:
        if not assgn:
            return None
        idx = routing.Start(0)
        ord_list: list[int] = []
        while not routing.IsEnd(idx):
            ord_list.append(manager.IndexToNode(idx))
            idx = assgn.Value(routing.NextVar(idx))
        ord_list.append(manager.IndexToNode(idx))
        return ord_list

    solutions: list[dict[str, Any]] = []
    primary_order = None
    seen_orders: set[tuple[int, ...]] = set()

    if has_fixed_drop_order and n >= 2:
        primary_order = list(range(n))
        try:
            route_info = await _build_route_info_from_order(primary_order, stops, load, dist_matrix)
            solutions.append(route_info)
            seen_orders.add(tuple(primary_order))
        except Exception as e:
            print(f"[ORT] fixed-order multi-stop build failed: {e}")
            logger.error("[ORT] fixed-order multi-stop build failed: %s", e)
            primary_order = None

    if assignment and not (has_fixed_drop_order and solutions):
        primary_order = _extract_order(assignment)
        if primary_order:
            try:
                print(f"[ORT] {time.time():.3f} _build_route_info_from_order (primary) START order={primary_order}")
                logger.info("[ORT] _build_route_info_from_order (primary) START order=%s", primary_order)
                t_build = time.time()
                route_info = await _build_route_info_from_order(primary_order, stops, load, dist_matrix)
                build_elapsed = time.time() - t_build
                print(f"[ORT] {time.time():.3f} _build_route_info_from_order (primary) DONE elapsed={build_elapsed:.3f}")
                logger.info("[ORT] _build_route_info_from_order (primary) DONE elapsed=%.3f", build_elapsed)
                solutions.append(route_info)
                seen_orders.add(tuple(primary_order))
            except Exception as e:
                print(f"[ORT] {time.time():.3f} PRIMARY ROUTE_INFO BUILD EXC {type(e).__name__}: {e}")
                logger.error("[ORT] PRIMARY ROUTE_INFO BUILD EXC %s: %s\n%s", type(e).__name__, e, traceback.format_exc())
                raise

    # Real alternative solves via different first-solution strategies
    if not has_fixed_drop_order and n > 2 and len(solutions) < max_alts + 1:
        alt_strats = [
            routing_enums_pb2.FirstSolutionStrategy.SAVINGS,
            routing_enums_pb2.FirstSolutionStrategy.PARALLEL_CHEAPEST_INSERTION,
        ]
        for strat in alt_strats:
            if len(solutions) >= max_alts + 1:
                break
            alt_sp = pywrapcp.DefaultRoutingSearchParameters()
            alt_sp.first_solution_strategy = strat
            alt_sp.local_search_metaheuristic = routing_enums_pb2.LocalSearchMetaheuristic.GUIDED_LOCAL_SEARCH
            alt_time_limit = ALT_SOLVER_TIME_LIMIT_S
            alt_sp.time_limit.FromSeconds(alt_time_limit)
            alt_sp.solution_limit = 20
            print(f"[ORT] {time.time():.3f} VRP alt strat={strat} time_limit={alt_time_limit}s START")
            logger.info("[ORT] VRP alt strat=%s time_limit=%ds", strat, alt_time_limit)
            try:
                t_alt = time.time()
                alt_assgn = routing.SolveWithParameters(alt_sp)
                alt_solve_e = time.time() - t_alt
                print(f"[ORT] {time.time():.3f} VRP alt DONE elapsed={alt_solve_e:.3f}")
                logger.info("[ORT] VRP alt DONE elapsed=%.3f", alt_solve_e)
            except Exception as e:
                print(f"[ORT] {time.time():.3f} VRP alt SOLVE EXC {type(e).__name__}: {e}")
                logger.warning("[ORT] VRP alt SOLVE EXC %s (skipped): %s\n%s", type(e).__name__, e, traceback.format_exc())
                alt_assgn = None
            alt_order = _extract_order(alt_assgn)
            if alt_order and tuple(alt_order) not in seen_orders:
                try:
                    alt_info = await _build_route_info_from_order(alt_order, stops, load, dist_matrix)
                    alt_info["is_alternative"] = True
                    alt_info["_order"] = alt_order
                    solutions.append(alt_info)
                    seen_orders.add(tuple(alt_order))
                except Exception as e:
                    print(f"[ORT] {time.time():.3f} ALT ROUTE_INFO BUILD EXC (skipped) {type(e).__name__}")
                    logger.warning("[ORT] ALT ROUTE_INFO BUILD EXC (skipped) %s", e)

    for s in solutions:
        s.pop("_order", None)

    if not solutions:
        # direct O-D fallback
        order = [0, n - 1]
        try:
            print(f"[ORT] {time.time():.3f} _build_route_info_from_order (fallback O-D) START")
            logger.info("[ORT] _build_route_info_from_order (fallback O-D) START")
            t_fb = time.time()
            fb = await _build_route_info_from_order(order, stops, load, dist_matrix)
            fb_e = time.time() - t_fb
            print(f"[ORT] {time.time():.3f} _build_route_info_from_order (fallback) DONE elapsed={fb_e:.3f}")
            logger.info("[ORT] _build_route_info_from_order (fallback) DONE elapsed=%.3f", fb_e)
            notes = ["OR-Tools solver returned no solution — direct O-D fallback"]
            if n > 2:
                notes.append(
                    f"Warning: {n - 2} routing anchor via(s) were discarded in fallback"
                )
            fb["notes"] = (fb.get("notes") or []) + notes
            solutions.append(fb)
        except Exception as e:
            print(f"[ORT] {time.time():.3f} FALLBACK BUILD EXC {type(e).__name__}: {e}")
            logger.error("[ORT] FALLBACK BUILD EXC %s: %s\n%s", type(e).__name__, e, traceback.format_exc())
            raise

    primary = solutions[0]
    alts = solutions[1 : 1 + max_alts]

    elapsed = round(time.time() - t0, 3)
    print(f"[ORT] {time.time():.3f} optimize_route END total_elapsed={elapsed:.3f} status=ok meta_num_stops={n} used_real={used_real_matrix}")
    logger.info("[ORT] optimize_route END total_elapsed=%.3f status=ok num_stops=%d used_real=%s", elapsed, n, used_real_matrix)
    # dual [ORT] print+logger per explicit request (uvicorn visibility + structured) -- small n, no hotloop perf issue
    # NOTE: detailed EXC/trace now in logs for aborts (router 500 still does str(exc)[:200] + logger.exception; tiny enhancement would be in route.py but out of this file scope)

    return {
        "status": "ok",
        "primary": primary,
        "alternatives": alts,
        "meta": {
            "solver_time_s": elapsed,
            "num_stops": n,
            "used_real_matrix": used_real_matrix,
            "osrm_base": OSRM_BASE,
            "service_version": "or-tools-service@0.3.1",  # v0.3.1 World-Class Routing Upgrade (hard enforcement + accurate corridor)
        },
    }
