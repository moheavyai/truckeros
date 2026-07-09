"""Corridor extraction tests (OK->MT multi-state and compass disambiguation)."""
import pytest

from app.services.ortools_solver import (
    _extract_state_codes_from_step_ref,
    _get_primary_state_for_step,
    _is_highway_compass_suffix,
    build_corridor_from_steps,
    complete_corridor_with_highways,
    extract_border_crossings,
    has_plausible_transitions,
    synthesize_border_crossings_from_corridor,
)


def _ok_mt_sparse_ref_steps() -> list[dict]:
    """OSRM-like steps with interstate refs only (no state route numbers)."""
    return [
        {
            "ref": "I 35",
            "name": "I 35",
            "maneuver": {"location": [-95.99, 36.15]},
            "geometry": {"coordinates": [[-95.99, 36.15], [-96.5, 36.8]]},
        },
        {
            "ref": "I 35",
            "name": "I 35",
            "maneuver": {"location": [-96.8, 38.5]},
            "geometry": {"coordinates": [[-96.8, 38.5], [-97.0, 39.5]]},
        },
        {
            "ref": "I 35 N",
            "name": "I 35 N",
            "maneuver": {"location": [-97.0, 39.5]},
            "geometry": {"coordinates": [[-97.0, 39.5], [-96.5, 40.5]]},
        },
        {
            "ref": "I 80",
            "name": "I 80",
            "maneuver": {"location": [-96.0, 41.2]},
            "geometry": {"coordinates": [[-96.0, 41.2], [-100.0, 41.5]]},
        },
        {
            "ref": "I 90",
            "name": "I 90",
            "maneuver": {"location": [-104.0, 44.0]},
            "geometry": {"coordinates": [[-104.0, 44.0], [-106.0, 45.5]]},
        },
        {
            "ref": "I 90",
            "name": "I 90",
            "maneuver": {"location": [-108.5, 45.78]},
            "geometry": {"coordinates": [[-108.5, 45.78], [-108.6, 45.8]]},
        },
    ]


def _ok_mt_explicit_ref_steps() -> list[dict]:
    return [
        {"ref": "OK 11", "name": "OK 11"},
        {"ref": "I 35;KS 15", "name": "I 35;KS 15"},
        {"ref": "KS 15", "name": "KS 15"},
        {"ref": "I 80;NE 2", "name": "I 80;NE 2"},
        {"ref": "I 90;SD 34", "name": "I 90;SD 34"},
        {"ref": "MT 3", "name": "MT 3"},
    ]


class TestCompassDisambiguation:
    def test_highway_compass_suffix_skipped(self):
        assert _is_highway_compass_suffix("I 35 NE", "NE") is True
        assert _is_highway_compass_suffix("I-80 SW", "SW") is True

    def test_nebraska_state_code_kept(self):
        assert _is_highway_compass_suffix("NE", "NE") is False
        assert _is_highway_compass_suffix("NE 2", "NE") is False
        step = {"ref": "I 80;NE 2", "name": "I 80;NE 2"}
        assert _get_primary_state_for_step(step) == "NE"
        assert "NE" in _extract_state_codes_from_step_ref(step)

    def test_i35_n_not_nebraska(self):
        step = {"ref": "I 35 N", "name": "I 35 N"}
        assert _get_primary_state_for_step(step) is None or _get_primary_state_for_step(step) != "NE"


def _ok_mt_western_ref_steps() -> list[dict]:
    """Tulsa→Billings via I-70/I-25 (western corridor)."""
    return [
        {"ref": "I 44", "maneuver": {"location": [-95.99, 36.15]}, "geometry": {"coordinates": [[-95.99, 36.15]]}},
        {"ref": "I 35", "maneuver": {"location": [-96.5, 37.0]}, "geometry": {"coordinates": [[-96.5, 37.0]]}},
        {"ref": "I 70", "maneuver": {"location": [-99.0, 39.0]}, "geometry": {"coordinates": [[-99.0, 39.0]]}},
        {"ref": "I 70", "maneuver": {"location": [-104.71, 39.74]}, "geometry": {"coordinates": [[-104.71, 39.74]]}},
        {"ref": "I 25", "maneuver": {"location": [-105.0, 41.5]}, "geometry": {"coordinates": [[-105.0, 41.5]]}},
        {"ref": "I 90", "maneuver": {"location": [-108.5, 45.78]}, "geometry": {"coordinates": [[-108.5, 45.78]]}},
    ]


class TestOkMtCorridor:
    def test_sparse_refs_not_ok_mt_only(self):
        corridor = build_corridor_from_steps(_ok_mt_sparse_ref_steps(), "OK", "MT")
        assert corridor[0] == "OK"
        assert corridor[-1] == "MT"
        assert len(corridor) >= 4
        assert "KS" in corridor
        assert "NE" in corridor
        assert has_plausible_transitions(corridor)

    def test_explicit_refs_full_corridor(self):
        corridor = build_corridor_from_steps(_ok_mt_explicit_ref_steps(), "OK", "MT")
        assert corridor == ["OK", "KS", "NE", "SD", "MT"]

    def test_bookends_heuristic(self):
        corridor = complete_corridor_with_highways(["OK", "MT"], ["I-35", "I-80", "I-90"])
        assert corridor == ["OK", "KS", "NE", "SD", "MT"]

    def test_border_crossings_include_intermediates(self):
        crossings = extract_border_crossings(_ok_mt_explicit_ref_steps())
        entries = [c["entryState"] for c in crossings]
        assert "KS" in entries
        assert "NE" in entries
        assert "SD" in entries

    def test_western_i70_i25_corridor(self):
        corridor = complete_corridor_with_highways(["OK", "MT"], ["I-70", "I-25"])
        assert corridor == ["OK", "KS", "CO", "WY", "MT"]

    def test_co_path_not_forced_to_ne_sd(self):
        corridor = complete_corridor_with_highways(["OK", "KS", "CO", "MT"], ["I-70", "I-25"])
        assert "NE" not in corridor
        assert "SD" not in corridor
        assert corridor == ["OK", "KS", "CO", "WY", "MT"]

    def test_western_sparse_steps_preserve_mt_bookend(self):
        corridor = build_corridor_from_steps(_ok_mt_western_ref_steps(), "OK", "MT")
        assert corridor[0] == "OK"
        assert corridor[-1] == "MT"
        assert "CO" in corridor or "WY" in corridor

    def test_synthesize_border_crossings_from_corridor(self):
        crossings = synthesize_border_crossings_from_corridor(
            ["OK", "KS", "NE", "SD", "MT"], ["I-80"]
        )
        assert len(crossings) == 4
        assert crossings[0]["exitState"] == "OK"
        assert crossings[0]["entryState"] == "KS"

    def test_eastern_not_blocked_when_co_present(self):
        corridor = complete_corridor_with_highways(
            ["OK", "CO", "MT"], ["I-35", "I-80", "I-90"]
        )
        assert corridor == ["OK", "KS", "NE", "SD", "MT"]


class TestCalvertAlNe:
    def test_no_spurious_ok_from_highways(self):
        corridor = complete_corridor_with_highways(
            ["AL", "MS", "MO", "IA", "NE"], ["I-35", "I-40"]
        )
        assert "OK" not in corridor