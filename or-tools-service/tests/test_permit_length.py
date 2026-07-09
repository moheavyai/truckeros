"""Tests for trailer vs envelope length permit flagging."""

from app.utils.constraints import (
    effective_envelope_length_threshold,
    exceeds_legal,
    load_needs_length_permit,
    needs_length_permit,
)


class TestNeedsLengthPermit:
    def test_trailer_53_envelope_74_no_length_flag(self):
        """MUST pass: legal trailer + envelope under 84.5 ft → no length permit."""
        assert needs_length_permit(envelope_length_ft=74, trailer_length_ft=53) is False
        assert load_needs_length_permit({"length": 74, "trailerLengthFt": 53}) is False
        assert exceeds_legal({"length": 74, "trailerLengthFt": 53}) == []

    def test_envelope_84_5_boundary_no_flag(self):
        assert needs_length_permit(envelope_length_ft=84.5, trailer_length_ft=53) is False

    def test_envelope_84_51_just_above_boundary_flags(self):
        assert needs_length_permit(envelope_length_ft=84.51, trailer_length_ft=53) is True

    def test_omitted_null_trailer_length_ft_safe_harbor_eligible(self):
        assert needs_length_permit(envelope_length_ft=74) is False
        assert needs_length_permit(envelope_length_ft=74, trailer_length_ft=None) is False
        assert load_needs_length_permit({"length": 74}) is False
        assert needs_length_permit(envelope_length_ft=90) is True
        assert needs_length_permit(envelope_length_ft=90, trailer_length_ft=None) is True
        assert load_needs_length_permit({"length": 90}) is True

    def test_envelope_over_84_5_flags(self):
        assert needs_length_permit(envelope_length_ft=90, trailer_length_ft=53) is True
        assert load_needs_length_permit({"length": 90, "trailerLengthFt": 53}) is True

    def test_trailer_over_53_alone_does_not_flag(self):
        assert needs_length_permit(envelope_length_ft=74, trailer_length_ft=55) is False

    def test_db_trailer_threshold_treated_as_envelope_default(self):
        assert effective_envelope_length_threshold(53) == 84.5
        assert needs_length_permit(74, 53, state_threshold_ft=53) is False
        assert needs_length_permit(90, 53, state_threshold_ft=53) is True

    def test_tx_raw_threshold_59_trailer_53_envelope_74_no_flag(self):
        assert effective_envelope_length_threshold(59) == 84.5
        assert needs_length_permit(74, 53, state_threshold_ft=59) is False

    def test_state_envelope_threshold_only_above_84_5(self):
        assert effective_envelope_length_threshold(75) == 84.5
        assert effective_envelope_length_threshold(90) == 90
        assert needs_length_permit(95, 53, state_threshold_ft=90) is True
        assert needs_length_permit(85, 53, state_threshold_ft=90) is False