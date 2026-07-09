"""Integration-style tests for Tulsa OK -> Billings MT (permit-test payload shape)."""
import math

import pytest

from app.models.schemas import LoadDetails
from app.services.ortools_solver import (
    _build_route_info_from_order,
    build_corridor_from_steps,
    complete_corridor_with_highways,
    extract_border_crossings,
    synthesize_border_crossings_from_corridor,
)

WESTERN_CORRIDOR = ["OK", "KS", "CO", "WY", "MT"]
EASTERN_CORRIDOR = ["OK", "KS", "NE", "SD", "MT"]


def _assert_finite_coords(crossings: list[dict]) -> None:
    for c in crossings:
        lat, lon = c.get("lat"), c.get("lon")
        assert lat is not None and lon is not None
        assert math.isfinite(float(lat)) and math.isfinite(float(lon))


def _tulsa_billings_western_steps() -> list[dict]:
    return [
        {
            "ref": "I 244",
            "maneuver": {"location": [-95.994972, 36.161552]},
            "geometry": {"coordinates": [[-95.994972, 36.161552], [-96.0, 36.16]]},
        },
        {
            "ref": "I 35",
            "maneuver": {"location": [-97.3242, 37.5957]},
            "geometry": {"coordinates": [[-97.0, 37.0], [-97.3242, 37.5957], [-99.0, 39.0]]},
        },
        {
            "ref": "I 70",
            "maneuver": {"location": [-104.71, 39.74]},
            "geometry": {"coordinates": [[-99.0, 39.0], [-104.71, 39.74]]},
        },
        {
            "ref": "I 25",
            "maneuver": {"location": [-106.69, 44.37]},
            "geometry": {"coordinates": [[-104.99, 39.99], [-106.69, 44.37]]},
        },
        {
            "ref": "US 87",
            "maneuver": {"location": [-108.4528, 45.7982]},
            "geometry": {"coordinates": [[-108.0, 45.5], [-108.4528, 45.7982]]},
        },
    ]


def _tulsa_billings_eastern_steps() -> list[dict]:
    return [
        {"ref": "OK 11", "maneuver": {"location": [-95.99, 36.15]}, "geometry": {"coordinates": [[-95.99, 36.15]]}},
        {"ref": "I 35;KS 15", "maneuver": {"location": [-96.8, 38.5]}, "geometry": {"coordinates": [[-96.8, 38.5]]}},
        {"ref": "KS 15", "maneuver": {"location": [-97.0, 39.5]}, "geometry": {"coordinates": [[-97.0, 39.5]]}},
        {"ref": "I 80;NE 2", "maneuver": {"location": [-96.0, 41.2]}, "geometry": {"coordinates": [[-96.0, 41.2]]}},
        {"ref": "I 90;SD 34", "maneuver": {"location": [-104.0, 44.0]}, "geometry": {"coordinates": [[-104.0, 44.0]]}},
        {"ref": "MT 3", "maneuver": {"location": [-108.5, 45.78]}, "geometry": {"coordinates": [[-108.5, 45.78]]}},
    ]


def _permit_test_load_dict() -> dict:
    return {
        "origin": {"city": "Tulsa", "state": "OK", "street": "", "zip": ""},
        "destination": {"city": "Billings", "state": "MT", "street": "", "zip": ""},
        "weight": 80000,
        "length": 53,
        "width": 8.5,
        "height": 13.5,
        "originLat": 36.161552,
        "originLon": -95.994972,
        "destinationLat": 45.787121,
        "destinationLon": -108.495315,
    }


class TestTulsaBillingsIntegration:
    def test_permit_test_payload_parses_states(self):
        load = LoadDetails(**_permit_test_load_dict())
        assert load.origin.state == "OK"
        assert load.destination.state == "MT"

    def test_western_highways_repair_sparse_corridor(self):
        hwys = [
            "I-244 (entry 36.16,-95.99 exit 36.16,-96.00)",
            "I-35 (entry 36.40,-97.33 exit 37.60,-97.32)",
            "I-70 (entry 38.87,-97.64 exit 39.74,-104.71)",
            "I-25 (entry 39.99,-104.99 exit 44.37,-106.69)",
        ]
        corridor = complete_corridor_with_highways(["OK", "MT"], hwys)
        assert corridor == WESTERN_CORRIDOR

    def test_eastern_highways_repair_sparse_corridor(self):
        corridor = complete_corridor_with_highways(["OK", "MT"], ["I-35", "I-80", "I-90"])
        assert corridor == EASTERN_CORRIDOR

    def test_eastern_not_blocked_when_co_present_from_geometry(self):
        """CO/WY from geometry must not prevent eastern NE/SD inserts."""
        corridor = complete_corridor_with_highways(["OK", "CO", "MT"], ["I-35", "I-80", "I-90"])
        assert corridor == EASTERN_CORRIDOR

    def test_geometry_walk_exact_western_corridor(self):
        corridor = build_corridor_from_steps(_tulsa_billings_western_steps(), "OK", "MT")
        assert corridor == WESTERN_CORRIDOR

    def test_geometry_walk_exact_eastern_corridor(self):
        corridor = build_corridor_from_steps(_tulsa_billings_eastern_steps(), "OK", "MT")
        assert corridor == EASTERN_CORRIDOR

    def test_negative_ok_mt_only_is_invalid(self):
        sparse = ["OK", "MT"]
        assert sparse != WESTERN_CORRIDOR
        assert sparse != EASTERN_CORRIDOR
        repaired = complete_corridor_with_highways(
            sparse,
            ["I-70 (entry 38.87,-97.64 exit 39.74,-104.71)", "I-25 (entry 39.99,-104.99 exit 44.37,-106.69)"],
        )
        assert repaired == WESTERN_CORRIDOR

    def test_border_crossings_extract_has_finite_lat_lon(self):
        crossings = extract_border_crossings(_tulsa_billings_western_steps())
        assert len(crossings) == 4
        _assert_finite_coords(crossings)

    def test_synthesize_has_null_lat_lon(self):
        crossings = synthesize_border_crossings_from_corridor(WESTERN_CORRIDOR, ["I-70"])
        assert len(crossings) == 4
        assert crossings[0]["lat"] is None
        assert crossings[0]["lon"] is None

    @pytest.mark.asyncio
    async def test_build_route_info_from_order_bookends(self, monkeypatch):
        steps = _tulsa_billings_western_steps()
        load = _permit_test_load_dict()
        stops = [
            {"name": "origin", "lat": 36.161552, "lon": -95.994972, "state": "OK"},
            {"name": "destination", "lat": 45.787121, "lon": -108.495315, "state": "MT"},
        ]
        order = [0, 1]
        dist_matrix = [[0, 1_000_000], [1_000_000, 0]]

        async def fake_get_route_legs(*args, **kwargs):
            return {"distance": 1_986_261, "duration": 100_000, "steps": steps}

        monkeypatch.setattr("app.services.ortools_solver.get_route_legs", fake_get_route_legs)

        info = await _build_route_info_from_order(order, stops, load, dist_matrix)
        assert info["routeCorridor"] == WESTERN_CORRIDOR
        assert len(info["borderCrossings"]) == 4
        _assert_finite_coords(info["borderCrossings"])