"""Unit tests for KS→FL practical corridor routing helpers."""
import pytest

from app.services.ortools_solver import (
    _is_ks_fl_ok_al_shortcut,
    _pick_best_practical_osrm_route,
    score_practical_osrm_route,
    should_prefer_practical_corridor,
    suggest_practical_vias,
)


def _steps_for_states(states: list[str]) -> list[dict]:
    """Minimal OSRM-like steps with state hints in ref."""
    return [{"ref": st, "name": f"I 55;{st} 5"} for st in states]


class TestShouldPreferPracticalCorridor:
    @pytest.mark.parametrize(
        "o,d,avoided,expected",
        [
            ("KS", "FL", None, True),
            ("KS", "FL", [], True),
            ("KS", "FL", ["MO"], False),
            ("KS", "FL", ["TN"], False),
            ("OK", "FL", None, False),
            ("MO", "FL", None, False),
            ("KS", "GA", None, False),
            ("", "FL", None, False),
        ],
    )
    def test_lane_and_avoid(self, o, d, avoided, expected):
        assert should_prefer_practical_corridor(o, d, avoided) is expected


class TestKsFlOkAlShortcut:
    def test_detects_shortcut(self):
        steps = _steps_for_states(["KS", "OK", "AL", "GA", "FL"])
        assert _is_ks_fl_ok_al_shortcut(steps, "KS", "FL") is True

    def test_mo_tn_not_shortcut(self):
        steps = _steps_for_states(["KS", "MO", "TN", "AL", "GA", "FL"])
        assert _is_ks_fl_ok_al_shortcut(steps, "KS", "FL") is False

    def test_non_ks_fl(self):
        steps = _steps_for_states(["OK", "AL", "GA", "FL"])
        assert _is_ks_fl_ok_al_shortcut(steps, "OK", "FL") is False


class TestSuggestPracticalVias:
    def test_plain_ks_fl_four_vias(self):
        vias = suggest_practical_vias("KS", "FL", [], None)
        assert len(vias) == 4
        names = {v["name"] for v in vias}
        assert names == {"Joplin", "Memphis", "Nashville", "Atlanta"}
        assert len([v for v in vias if v["state"] == "TN"]) == 2
        assert len([v for v in vias if v["state"] == "GA"]) == 1

    def test_avoid_mo_skips_all(self):
        vias = suggest_practical_vias("KS", "FL", ["MO"], None)
        assert vias == []

    def test_avoid_tn_joplin_only(self):
        vias = suggest_practical_vias("KS", "FL", ["TN"], None)
        assert len(vias) == 1
        assert vias[0]["name"] == "Joplin"

    def test_avoid_mo_and_tn_zero_vias(self):
        vias = suggest_practical_vias("KS", "FL", ["MO", "TN"], None)
        assert vias == []


class TestScorePracticalOsrmRoute:
    def test_mo_tn_scores_lower_than_ok_al_shortcut(self):
        mo_tn_steps = _steps_for_states(["KS", "MO", "TN", "AL", "GA", "FL"])
        ok_al_steps = _steps_for_states(["KS", "OK", "AL", "GA", "FL"])
        dist = 2_000_000.0
        mo_tn = score_practical_osrm_route(
            mo_tn_steps, dist, dist, "KS", "FL", "KS", "FL"
        )
        ok_al = score_practical_osrm_route(
            ok_al_steps, dist, dist, "KS", "FL", "KS", "FL"
        )
        assert mo_tn < ok_al

    def test_no_al_scores_lower_than_with_al(self):
        no_al_steps = _steps_for_states(["KS", "MO", "TN", "GA", "FL"])
        with_al_steps = _steps_for_states(["KS", "MO", "TN", "AL", "GA", "FL"])
        dist = 2_000_000.0
        no_al = score_practical_osrm_route(
            no_al_steps, dist, dist, "KS", "FL", "KS", "FL"
        )
        with_al = score_practical_osrm_route(
            with_al_steps, dist, dist, "KS", "FL", "KS", "FL"
        )
        assert no_al < with_al

    def test_avoid_mo_disables_ks_fl_bonus(self):
        mo_tn_steps = _steps_for_states(["KS", "MO", "TN", "AL", "GA", "FL"])
        ok_al_steps = _steps_for_states(["KS", "OK", "AL", "GA", "FL"])
        dist = 2_000_000.0
        mo_tn = score_practical_osrm_route(
            mo_tn_steps, dist, dist, "KS", "FL", "KS", "FL", ["MO"]
        )
        ok_al = score_practical_osrm_route(
            ok_al_steps, dist, dist, "KS", "FL", "KS", "FL", ["MO"]
        )
        assert mo_tn == ok_al

    def test_trip_od_applies_on_intermediate_leg(self):
        """MO→TN leg should still get KS→FL trip bonuses."""
        leg_steps = _steps_for_states(["MO", "TN"])
        score = score_practical_osrm_route(
            leg_steps, 500_000.0, 500_000.0, "MO", "TN", "KS", "FL"
        )
        score_no_trip = score_practical_osrm_route(
            leg_steps, 500_000.0, 500_000.0, "MO", "TN"
        )
        assert score < score_no_trip


class TestPickBestPracticalOsrmRoute:
    def _route(self, dist: float, states: list[str]) -> dict:
        steps = _steps_for_states(states)
        return {"distance": dist, "legs": [{"steps": steps}]}

    def test_picks_practical_within_cap(self):
        shortcut = self._route(1_000_000, ["KS", "OK", "AL", "GA", "FL"])
        practical = self._route(1_200_000, ["KS", "MO", "TN", "GA", "FL"])
        best = _pick_best_practical_osrm_route(
            [shortcut, practical], "KS", "FL", "KS", "FL"
        )
        assert best["distance"] == practical["distance"]

    def test_single_route_still_scored(self):
        practical = self._route(1_200_000, ["KS", "MO", "TN", "AL", "GA", "FL"])
        best = _pick_best_practical_osrm_route(
            [practical], "KS", "FL", "KS", "FL"
        )
        assert best["distance"] == practical["distance"]