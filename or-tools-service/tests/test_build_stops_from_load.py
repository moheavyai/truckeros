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


def test_build_stops_includes_vias_with_explicit_drops():
    """Include/prefer vias still append when permit-test sends destination as drops."""
    load = {
        **_load_with_drops(
            [{"query": "Minot", "lat": 48.232, "lon": -101.296, "state": "ND"}]
        ),
        "specialInstructions": "include Memphis, TN",
    }
    stops = build_stops_from_load(load, (40.926, -98.342), (46.879, -102.789))
    assert len(stops) >= 3
    assert stops[0]["name"] == "origin"
    vias = [s for s in stops if s.get("is_via")]
    assert any("memphis" in v["name"].lower() for v in vias)
    via_idx = next(i for i, s in enumerate(stops) if s.get("is_via"))
    drop_idx = next(i for i, s in enumerate(stops) if s.get("is_drop"))
    assert via_idx < drop_idx
    assert stops[-1].get("is_drop") is True


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
    assert "auburn" in CITY_MAP
    assert CITY_MAP["auburn"][2] == "NE"
    assert "beatrice" in CITY_MAP
    assert CITY_MAP["beatrice"][2] == "NE"


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


def test_prefer_us136_seeds_rock_port_with_explicit_drops():
    """prefer US136 + destination-as-drop still injects Rock Port via (num_stops >= 3)."""
    load = {
        "origin": {"city": "Kansas City", "state": "MO"},
        "destination": {"city": "Lincoln", "state": "NE"},
        "specialInstructions": "avoid IA. use US136 from Rock Port, MO to enter NE",
        "drops": [
            {"query": "Lincoln", "lat": 40.8136, "lon": -96.7026, "state": "NE"},
        ],
    }
    stops = build_stops_from_load(load, (39.0997, -94.5786), (40.8136, -96.7026))
    assert len(stops) >= 3
    assert stops[0]["name"] == "origin"
    vias = [s for s in stops if s.get("is_via")]
    rock = next((v for v in vias if "rock" in v["name"].lower()), None)
    assert rock is not None, f"Rock Port via missing; stops={[s.get('name') for s in stops]}"
    assert rock["state"] == "MO"
    assert rock["lat"] == pytest.approx(40.4122, abs=0.01)
    assert rock["lon"] == pytest.approx(-95.5169, abs=0.01)
    rock_idx = next(
        i for i, s in enumerate(stops) if s.get("is_via") and "rock" in s["name"].lower()
    )
    drop_idx = next(i for i, s in enumerate(stops) if s.get("is_drop"))
    assert rock_idx < drop_idx
    assert stops[-1].get("is_drop") is True
    assert stops[-1]["lat"] == pytest.approx(40.8136, abs=0.01)


def test_prefer_via_before_multi_drops_order():
    """Multi-drop order: origin, vias…, drop1, drop2…"""
    load = {
        "origin": {"city": "Kansas City", "state": "MO"},
        "destination": {"city": "Dickinson", "state": "ND"},
        "specialInstructions": "prefer US 136",
        "drops": [
            {"query": "Minot", "lat": 48.232, "lon": -101.296, "state": "ND"},
            {"query": "Dickinson", "lat": 46.879, "lon": -102.789, "state": "ND"},
        ],
    }
    stops = build_stops_from_load(load, (39.0997, -94.5786), (46.879, -102.789))
    assert stops[0]["name"] == "origin"
    via_idxs = [i for i, s in enumerate(stops) if s.get("is_via")]
    drop_idxs = [i for i, s in enumerate(stops) if s.get("is_drop")]
    assert via_idxs, "expected prefer-US-136 via"
    assert len(drop_idxs) == 2
    assert max(via_idxs) < min(drop_idxs)
    assert drop_idxs == sorted(drop_idxs)
    assert stops[drop_idxs[0]]["name"] == "Minot"
    assert stops[drop_idxs[1]]["name"] == "Dickinson"
    assert any("rock" in stops[i]["name"].lower() for i in via_idxs)


def test_multi_drop_no_specials_skips_practical_auto_vias():
    """Multi-drop with no specials: only origin + drops (no KS→FL Joplin/Memphis auto vias)."""
    load = {
        "origin": {"city": "Wichita", "state": "KS"},
        "destination": {"city": "Miami", "state": "FL"},
        "drops": [
            {"query": "Tampa", "lat": 27.9506, "lon": -82.4572, "state": "FL"},
            {"query": "Miami", "lat": 25.7617, "lon": -80.1918, "state": "FL"},
        ],
    }
    stops = build_stops_from_load(load, (37.6872, -97.3301), (25.7617, -80.1918))
    assert len(stops) == 3
    assert stops[0]["name"] == "origin"
    assert all(s.get("is_drop") for s in stops[1:])
    assert all(not s.get("is_via") for s in stops)
    names = " ".join(s["name"].lower() for s in stops)
    assert "joplin" not in names
    assert "memphis" not in names
    assert "nashville" not in names
    assert "atlanta" not in names


def test_via_coinciding_with_drop_coords_is_deduped():
    """Prefer/include via that matches a drop lat/lon is skipped (no double stop)."""
    rp_lat, rp_lon, _ = CITY_MAP["rock port"]
    load = {
        "origin": {"city": "Kansas City", "state": "MO"},
        "destination": {"city": "Lincoln", "state": "NE"},
        "specialInstructions": "prefer US 136",
        "drops": [
            {"query": "Rock Port stop", "lat": rp_lat, "lon": rp_lon, "state": "MO"},
            {"query": "Lincoln", "lat": 40.8136, "lon": -96.7026, "state": "NE"},
        ],
    }
    stops = build_stops_from_load(load, (39.0997, -94.5786), (40.8136, -96.7026))
    vias = [s for s in stops if s.get("is_via")]
    assert not any("rock" in v["name"].lower() for v in vias)
    drops = [s for s in stops if s.get("is_drop")]
    assert len(drops) == 2
    assert any(
        abs(s["lat"] - rp_lat) < 0.05 and abs(s["lon"] - rp_lon) < 0.05 for s in drops
    )


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


def test_use_us136_through_auburn_seeds_auburn_not_rock_port():
    """User-named place in prefer clause beats default US136 Rock Port anchor."""
    load = {
        "origin": {"city": "Kansas City", "state": "MO"},
        "destination": {"city": "Lincoln", "state": "NE"},
        "specialInstructions": "avoid IA. Use US136 through Auburn, NE from MO border",
    }
    stops = build_stops_from_load(load, (39.0997, -94.5786), (40.8136, -96.7026))
    vias = [s for s in stops if s.get("is_via")]
    auburn = next((v for v in vias if "auburn" in v["name"].lower()), None)
    assert auburn is not None, f"Auburn via missing; vias={[v['name'] for v in vias]}"
    assert auburn["state"] == "NE"
    assert auburn["lat"] == pytest.approx(40.3925, abs=0.02)
    # Rock Port is not required when user named Auburn
    rock = next((v for v in vias if "rock" in v["name"].lower()), None)
    assert rock is None, f"Rock Port should not be forced when Auburn named; vias={[v['name'] for v in vias]}"


def test_prefer_us136_alone_still_seeds_rock_port():
    """Bare 'prefer US136' (no place) keeps highway default anchor Rock Port."""
    load = {
        "origin": {"city": "St Louis", "state": "MO"},
        "destination": {"city": "Omaha", "state": "NE"},
        "specialInstructions": "prefer US136",
    }
    stops = build_stops_from_load(load, (38.6270, -90.1994), (41.2565, -95.9345))
    vias = [s for s in stops if s.get("is_via")]
    assert any("rock" in v["name"].lower() and v["state"] == "MO" for v in vias)


def test_manual_waypoints_appear_as_vias_before_drops():
    """manualWaypoints schema → forced vias before drops."""
    load = {
        "origin": {"city": "Kansas City", "state": "MO"},
        "destination": {"city": "Lincoln", "state": "NE"},
        "manualWaypoints": [
            {"lat": 40.5, "lon": -95.7, "name": "Map Pick A", "source": "map"},
        ],
        "drops": [
            {"query": "Lincoln", "lat": 40.8136, "lon": -96.7026, "state": "NE"},
        ],
    }
    stops = build_stops_from_load(load, (39.0997, -94.5786), (40.8136, -96.7026))
    assert stops[0]["name"] == "origin"
    vias = [s for s in stops if s.get("is_via")]
    assert any("map pick" in v["name"].lower() or abs(v["lat"] - 40.5) < 0.01 for v in vias)
    via_idx = next(
        i
        for i, s in enumerate(stops)
        if s.get("is_via") and abs(s["lat"] - 40.5) < 0.01
    )
    drop_idx = next(i for i, s in enumerate(stops) if s.get("is_drop"))
    assert via_idx < drop_idx
    assert stops[-1].get("is_drop") is True