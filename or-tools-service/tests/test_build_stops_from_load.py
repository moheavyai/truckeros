import math
import pytest

from app.services.ortools_solver import build_stops_from_load


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