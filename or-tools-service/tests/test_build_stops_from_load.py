import math
import pytest

from app.config import CITY_MAP
from app.services.ortools_solver import (
    build_stops_from_load,
    format_missing_pref_warning,
    seed_preferred_hwy_vias,
    PREFERRED_HWY_VIA_ANCHORS,
)


def _load_with_drops(drops):
    return {
        "origin": {"city": "Grand Island", "state": "NE"},
        "destination": {"city": "Dickinson", "state": "ND"},
        "drops": drops,
    }


def test_build_stops_fixed_order_with_explicit_drops():
    load = _load_with_drops(
        [
            {"query": "Minot", "lat": 48.232, "lon": -101.296, "state": "ND"},
            {"query": "Dickinson", "lat": 46.879, "lon": -102.789, "state": "ND"},
        ]
    )
    stops = build_stops_from_load(load, (40.926, -98.342), (46.879, -102.789))

    assert len(stops) == 3
    assert stops[0]["name"] == "origin"
    assert stops[1]["is_drop"] is True
    assert stops[2]["is_drop"] is True
    assert stops[1]["state"] == "ND"
    assert stops[-1]["lat"] == pytest.approx(46.879)


def test_build_stops_skips_vias_when_explicit_drops():
    load = {
        **_load_with_drops(
            [{"query": "Minot", "lat": 48.232, "lon": -101.296, "state": "ND"}]
        ),
        "specialInstructions": "include Memphis, TN",
    }
    stops = build_stops_from_load(load, (40.926, -98.342), (46.879, -102.789))
    assert len(stops) == 2
    assert all(not s.get("is_via") for s in stops)


def test_build_stops_raises_when_drop_missing_coords():
    load = _load_with_drops(
        [
            {"query": "Minot", "city": "Minot", "state": "ND"},
            {"query": "Dickinson", "lat": 46.879, "lon": -102.789, "state": "ND"},
        ]
    )
    with pytest.raises(ValueError, match="drops\\[0\\] missing lat/lon"):
        build_stops_from_load(load, (40.926, -98.342), (46.879, -102.789))


def test_build_stops_single_destination_when_no_drops():
    load = {
        "origin": {"city": "A", "state": "NE"},
        "destination": {"city": "B", "state": "ND"},
    }
    stops = build_stops_from_load(load, (40.0, -98.0), (46.0, -102.0))
    assert len(stops) == 2
    assert stops[-1]["name"] == "destination"


def test_rock_port_in_city_map():
    assert "rock port" in CITY_MAP
    assert "rockport" in CITY_MAP
    lat, lon, st = CITY_MAP["rock port"]
    assert st == "MO"
    assert lat == pytest.approx(40.4122)
    assert lon == pytest.approx(-95.5169)
    assert CITY_MAP["rockport"] == CITY_MAP["rock port"]
    assert PREFERRED_HWY_VIA_ANCHORS["US 136"] == "rock port"
    assert PREFERRED_HWY_VIA_ANCHORS["I-40"] == "oklahoma city"


def test_prefer_us136_seeds_rock_port_via_mo_to_ne_avoid_ia():
    """prefer US 136 (MO→NE, avoid IA) injects Rock Port via so OSRM can follow the highway."""
    load = {
        "origin": {"city": "Kansas City", "state": "MO"},
        "destination": {"city": "Lincoln", "state": "NE"},
        "specialInstructions": "avoid IA. use US136 from Rock Port, MO to enter NE",
    }
    # KC area → Lincoln NE
    stops = build_stops_from_load(load, (39.0997, -94.5786), (40.8136, -96.7026))
    vias = [s for s in stops if s.get("is_via")]
    assert vias, "expected at least one via from prefer-US-136 injection"
    rock = next(
        (v for v in vias if "rock" in v["name"].lower()),
        None,
    )
    assert rock is not None, f"Rock Port via missing; vias={[v['name'] for v in vias]}"
    assert rock["state"] == "MO"
    assert rock["lat"] == pytest.approx(40.4122, abs=0.01)
    assert rock["lon"] == pytest.approx(-95.5169, abs=0.01)
    # Origin / dest still bookend
    assert stops[0]["name"] == "origin"
    assert stops[-1]["name"] == "destination"


def test_prefer_us136_bare_prefer_also_seeds_rock_port():
    """Bare 'prefer US 136' (no 'from Rock Port') still seeds anchor via."""
    load = {
        "origin": {"city": "St Louis", "state": "MO"},
        "destination": {"city": "Omaha", "state": "NE"},
        "specialInstructions": "prefer US 136",
    }
    stops = build_stops_from_load(load, (38.6270, -90.1994), (41.2565, -95.9345))
    vias = [s for s in stops if s.get("is_via")]
    assert any("rock" in v["name"].lower() and v["state"] == "MO" for v in vias)


def test_avoided_state_blocks_preferred_hwy_via():
    """Never seed a preferred-highway anchor in an avoided state."""
    # Rock Port is MO; avoiding MO must block the via
    seeds = seed_preferred_hwy_vias(["US 136"], ["MO"], "prefer US 136")
    assert seeds == []

    load = {
        "origin": {"city": "Chicago", "state": "IL"},
        "destination": {"city": "Denver", "state": "CO"},
        "specialInstructions": "avoid MO. prefer US 136",
    }
    stops = build_stops_from_load(load, (41.8781, -87.6298), (39.7392, -104.9903))
    vias = [s for s in stops if s.get("is_via")]
    assert not any(v.get("state") == "MO" for v in vias)
    assert not any("rock" in v["name"].lower() for v in vias)


def test_avoided_ok_blocks_i40_okc_via():
    seeds = seed_preferred_hwy_vias(["I-40"], ["OK"], "prefer I-40")
    assert seeds == []
    seeds_ok = seed_preferred_hwy_vias(["I-40"], [], "prefer I-40")
    assert len(seeds_ok) == 1
    assert seeds_ok[0]["state"] == "OK"
    assert "oklahoma" in seeds_ok[0]["name"].lower()


def test_manual_route_not_overridden_by_prefer_via():
    """Explicit manualRoute wins fully; prefer anchors must not inject extra vias."""
    load = {
        "origin": {"city": "A", "state": "MO"},
        "destination": {"city": "B", "state": "NE"},
        "specialInstructions": "prefer US 136",
        "manualRoute": ["memphis"],
    }
    stops = build_stops_from_load(load, (39.0, -94.0), (41.0, -96.0))
    vias = [s for s in stops if s.get("is_via")]
    assert len(vias) == 1
    assert "memphis" in vias[0]["name"].lower()
    assert not any("rock" in v["name"].lower() for v in vias)


def test_bare_from_city_without_prefer_does_not_inject():
    """Narrative 'from Dallas' / 'away from Chicago' must NOT inject city vias."""
    load_dallas = {
        "origin": {"city": "A", "state": "TX"},
        "destination": {"city": "B", "state": "OK"},
        "specialInstructions": "depart from Dallas early",
    }
    stops = build_stops_from_load(load_dallas, (32.0, -96.0), (35.0, -97.0))
    vias = [s for s in stops if s.get("is_via")]
    assert not any("dallas" in v["name"].lower() for v in vias)

    load_chi = {
        "origin": {"city": "A", "state": "WI"},
        "destination": {"city": "B", "state": "IN"},
        "specialInstructions": "stay away from Chicago",
    }
    stops = build_stops_from_load(load_chi, (43.0, -89.0), (40.0, -86.0))
    vias = [s for s in stops if s.get("is_via")]
    assert not any("chicago" in v["name"].lower() for v in vias)

    # Pure helper: empty preferred → no city preposition seeds
    assert seed_preferred_hwy_vias([], [], "from Dallas") == []
    assert seed_preferred_hwy_vias([], [], "stay away from Chicago") == []
    assert seed_preferred_hwy_vias([], [], "depart from Memphis early") == []


def test_prefer_context_from_city_still_seeds_anchor():
    """'use US136 from Rock Port' with preferred list still seeds Rock Port (prefer context)."""
    seeds = seed_preferred_hwy_vias(
        ["US 136"],
        ["IA"],
        "avoid IA. use US136 from Rock Port, MO to enter NE",
        origin_state="MO",
        dest_state="NE",
    )
    assert any("rock" in s["name"].lower() for s in seeds)


def test_us136_geo_gate_blocks_unrelated_corridor():
    """prefer US 136 on CA→OR must not seed Rock Port (large detour)."""
    seeds = seed_preferred_hwy_vias(
        ["US 136"],
        [],
        "prefer US 136",
        origin_state="CA",
        dest_state="OR",
    )
    assert seeds == []

    load = {
        "origin": {"city": "LA", "state": "CA"},
        "destination": {"city": "Portland", "state": "OR"},
        "specialInstructions": "prefer US 136",
    }
    stops = build_stops_from_load(load, (34.0, -118.0), (45.5, -122.6))
    vias = [s for s in stops if s.get("is_via")]
    assert not any("rock" in v["name"].lower() for v in vias)


def test_od_coord_dedupe_skips_via_at_origin():
    """If origin is already Rock Port coords, do not add a duplicate via."""
    rp_lat, rp_lon, _ = CITY_MAP["rock port"]
    load = {
        "origin": {"city": "Rock Port", "state": "MO"},
        "destination": {"city": "Lincoln", "state": "NE"},
        "specialInstructions": "prefer US 136",
    }
    stops = build_stops_from_load(load, (rp_lat, rp_lon), (40.8136, -96.7026))
    vias = [s for s in stops if s.get("is_via")]
    assert not any("rock" in v["name"].lower() for v in vias)


def test_honesty_copy_via_seeded_vs_not_injected():
    """Missing pref copy distinguishes seeded via vs never injected."""
    seeded_msg = format_missing_pref_warning(
        "US 136",
        avoided=["IA"],
        special_text="prefer US 136",
        origin_state="MO",
        dest_state="NE",
    )
    assert "via seeded" in seeded_msg
    assert "not injected" not in seeded_msg

    # Unmapped preferred hwy → still "not injected"
    bare_msg = format_missing_pref_warning(
        "I-99",
        avoided=[],
        special_text="prefer I-99",
        origin_state="PA",
        dest_state="NY",
    )
    assert "not injected" in bare_msg
    assert "via seeded" not in bare_msg

    # Geo-blocked US 136: we did not seed → "not injected"
    geo_msg = format_missing_pref_warning(
        "US 136",
        avoided=[],
        special_text="prefer US 136",
        origin_state="CA",
        dest_state="OR",
    )
    assert "not injected" in geo_msg
    assert "via seeded" not in geo_msg