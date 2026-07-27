"""Unit tests for special-instructions parser (avoid clause bound + OD guard + preferred hwys + honesty)."""

from app.services.ortools_solver import (
    parse_special_instructions,
    _normalize_hwy_token,
    highway_token_present,
    assess_preference_enforcement,
    format_missing_pref_warning,
)


class TestParseSpecialInstructionsOdGuard:
    def test_avoid_ia_use_us136_from_rock_port_mo_enter_ne(self):
        """Exact failing case: MO/NE must not be avoided; US 136 preferred; only IA avoided."""
        parsed = parse_special_instructions(
            "avoid IA. use US136 from Rock Port, MO to enter NE",
            origin_state="MO",
            dest_state="NE",
        )
        assert parsed["avoided"] == ["IA"]
        assert "US 136" in parsed["preferred"]
        assert "MO" not in parsed["avoided"]
        assert "NE" not in parsed["avoided"]

    def test_clause_bound_without_od_strip(self):
        """MO/NE must not be avoided from clause alone (no origin/dest passed)."""
        parsed = parse_special_instructions(
            "avoid IA. use US136 from Rock Port, MO to enter NE"
        )
        assert parsed["avoided"] == ["IA"]
        assert "MO" not in parsed["avoided"]
        assert "NE" not in parsed["avoided"]
        assert "US 136" in parsed["preferred"]

    def test_avoid_ia_avoid_ks_still_works(self):
        parsed = parse_special_instructions("avoid IA, avoid KS")
        assert parsed["avoided"] == ["IA", "KS"]

    def test_origin_dest_never_in_avoided(self):
        parsed = parse_special_instructions(
            "avoid MO, avoid IA, avoid NE",
            origin_state="MO",
            dest_state="NE",
        )
        assert parsed["avoided"] == ["IA"]
        assert "MO" not in parsed["avoided"]
        assert "NE" not in parsed["avoided"]

    def test_od_full_name_normalized(self):
        parsed = parse_special_instructions(
            "avoid Missouri, avoid Iowa",
            origin_state="Missouri",
            dest_state="Nebraska",
        )
        assert "MO" not in parsed["avoided"]
        assert parsed["avoided"] == ["IA"]

    def test_no_period_still_stops_at_use(self):
        parsed = parse_special_instructions(
            "avoid IA use US-136 from Rock Port MO to enter NE",
            origin_state="MO",
            dest_state="NE",
        )
        assert parsed["avoided"] == ["IA"]
        assert "US 136" in parsed["preferred"]

    def test_highway_normalization_variants(self):
        assert _normalize_hwy_token("US136") == "US 136"
        assert _normalize_hwy_token("US-136") == "US 136"
        assert _normalize_hwy_token("US 136") == "US 136"
        assert _normalize_hwy_token("I29") == "I-29"
        assert _normalize_hwy_token("I-29") == "I-29"
        assert parse_special_instructions("prefer I-40")["preferred"] == ["I-40"]
        assert parse_special_instructions("via I-29")["preferred"] == ["I-29"]

    def test_avoid_i40_does_not_prefer(self):
        """Bare 'avoid I-40' must not treat I-40 as preferred."""
        parsed = parse_special_instructions("avoid I-40")
        assert parsed["preferred"] == []

    def test_include_corinth_multi_avoid_regression(self):
        parsed = parse_special_instructions("avoid AR, avoid IL, include Corinth, MS")
        assert parsed["avoided"] == ["AR", "IL"]
        names = [i["name"].lower() for i in parsed["included"]]
        assert "corinth" in names

    def test_empty_and_none(self):
        assert parse_special_instructions(None)["avoided"] == []
        assert parse_special_instructions("")["avoided"] == []
        assert parse_special_instructions("   ")["preferred"] == []

    def test_english_conjunction_or_mid_phrase(self):
        """Natural-language 'or' is not Oregon; CA and TX still avoided."""
        parsed = parse_special_instructions("avoid CA or TX")
        assert parsed["avoided"] == ["CA", "TX"]
        assert "OR" not in parsed["avoided"]

    def test_comma_list_keeps_ok(self):
        """Real multi-state avoid must not drop OK as English FP."""
        parsed = parse_special_instructions("avoid AR, OK, TX")
        assert parsed["avoided"] == ["AR", "OK", "TX"]

    def test_comma_list_keeps_or(self):
        """Oregon in a comma list must not be dropped as conjunction 'or'."""
        parsed = parse_special_instructions("avoid WA, OR")
        assert parsed["avoided"] == ["WA", "OR"]

    def test_comma_list_keeps_in_oh(self):
        parsed = parse_special_instructions("avoid IL, IN, OH")
        assert parsed["avoided"] == ["IL", "IN", "OH"]

    def test_bypass_ok_on_way_to_tx(self):
        """'on' is not a US state; 'to' stops phrase so TX is not avoided."""
        parsed = parse_special_instructions("bypass OK on way to TX")
        assert parsed["avoided"] == ["OK"]
        assert "ON" not in parsed["avoided"]

    def test_kansas_city_not_kansas(self):
        parsed = parse_special_instructions("avoid Kansas City")
        assert "KS" not in parsed["avoided"]


class TestHighwayTokenPresent:
    def test_equality_not_substring(self):
        assert highway_token_present("I-29", ["I-29", "I-80"]) is True
        assert highway_token_present("I-2", ["I-29"]) is False
        assert highway_token_present("US 136", ["US 13"]) is False
        assert highway_token_present("US 136", ["US 136 (entry 40.0,-95.5)"]) is True

    def test_full_list_not_curated(self):
        # US 136 present only on full list (would be dropped by curate when many interstates)
        full = [
            "I-29", "I-35", "I-40", "I-55", "I-65", "I-70", "I-80",
            "US 136 (entry 40.4,-95.5)",
        ]
        assert highway_token_present("US 136", full) is True


class TestAssessPreferenceEnforcement:
    def test_residual_avoid_enforced_false(self):
        h = assess_preference_enforcement(
            avoided=["IA"],
            preferred=["US 136"],
            route_corridor=["MO", "IA", "NE"],
            highways=["I-29", "I-80"],
            origin_state="MO",
            dest_state="NE",
        )
        assert h["still_on"] == ["IA"]
        assert h["missing_pref"] == ["US 136"]
        assert h["enforced"] is False
        assert h["partial"] is True

    def test_preferred_missing_enforced_false_even_if_avoid_clean(self):
        h = assess_preference_enforcement(
            avoided=["IA"],
            preferred=["US 136"],
            route_corridor=["MO", "KS", "NE"],
            highways=["I-29", "I-80"],
            origin_state="MO",
            dest_state="NE",
        )
        assert h["still_on"] == []
        assert h["missing_pref"] == ["US 136"]
        assert h["enforced"] is False

    def test_full_success(self):
        h = assess_preference_enforcement(
            avoided=["IA"],
            preferred=["US 136"],
            route_corridor=["MO", "KS", "NE"],
            highways=["US 136", "I-29"],
            origin_state="MO",
            dest_state="NE",
        )
        assert h["enforced"] is True
        assert h["partial"] is False

    def test_missing_pref_honesty_copy_when_via_seeded(self):
        """When prefer-via injection applied, do not claim 'not injected'."""
        msg = format_missing_pref_warning(
            "US 136",
            avoided=["IA"],
            special_text="avoid IA. use US136 from Rock Port, MO to enter NE",
            origin_state="MO",
            dest_state="NE",
        )
        assert "via seeded" in msg
        assert "not realized in geometry" in msg
        assert "not injected" not in msg

    def test_or_group_satisfied_if_any_realized(self):
        """US136 or I-29: either highway on route satisfies the or-group."""
        h = assess_preference_enforcement(
            avoided=["IA"],
            preferred=["US 136", "I-29"],
            route_corridor=["MO", "NE"],
            highways=["I-29", "I-80"],
            origin_state="MO",
            dest_state="NE",
            preferred_or_groups=[["US 136", "I-29"]],
        )
        assert h["missing_pref"] == []
        assert h["enforced"] is True

    def test_or_group_missing_if_none_realized(self):
        h = assess_preference_enforcement(
            avoided=[],
            preferred=["US 136", "I-29"],
            route_corridor=["MO", "KS", "NE"],
            highways=["I-80"],
            origin_state="MO",
            dest_state="NE",
            preferred_or_groups=[["US 136", "I-29"]],
        )
        assert any("or" in m.lower() for m in h["missing_pref"])
        assert h["enforced"] is False

    def test_ordered_preferred_both_required(self):
        """US136 then US75 → both required (not or-group)."""
        h = assess_preference_enforcement(
            avoided=[],
            preferred=["US 136", "US 75"],
            route_corridor=["MO", "NE"],
            highways=["US 136", "I-29"],
            origin_state="MO",
            dest_state="NE",
        )
        assert "US 75" in h["missing_pref"]
        assert h["enforced"] is False


class TestPreferredHighwayLists:
    def test_then_ordered_preferred(self):
        parsed = parse_special_instructions("prefer US136 then US75")
        assert parsed["preferred"] == ["US 136", "US 75"]
        assert parsed["preferred_or_groups"] == []

    def test_or_group_preferred_alternatives(self):
        parsed = parse_special_instructions("prefer US136 or I-29")
        assert "US 136" in parsed["preferred"]
        assert "I-29" in parsed["preferred"]
        assert ["US 136", "I-29"] in parsed["preferred_or_groups"]
