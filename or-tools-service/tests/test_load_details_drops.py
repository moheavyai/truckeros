import math

import pytest
from pydantic import ValidationError

from app.models.schemas import LoadDetails


def _base_load(**overrides):
    payload = {
        "origin": {"city": "Grand Island", "state": "NE"},
        "destination": {"city": "Dickinson", "state": "ND"},
        "weight": 80000,
        "length": 74,
        "width": 8.5,
        "height": 13.5,
        "originLat": 40.926,
        "originLon": -98.342,
        "destinationLat": 46.879,
        "destinationLon": -102.789,
    }
    payload.update(overrides)
    return payload


def test_load_details_accepts_valid_drops():
    load = LoadDetails(
        **_base_load(
            drops=[
                {"query": "Minot", "lat": 48.232, "lon": -101.296, "city": "Minot", "state": "ND"},
                {"query": "Dickinson", "lat": 46.879, "lon": -102.789, "city": "Dickinson", "state": "ND"},
            ]
        )
    )
    assert len(load.drops or []) == 2
    assert load.drops[0].lat == pytest.approx(48.232)


def test_load_details_rejects_drop_missing_coordinates():
    with pytest.raises(ValidationError, match="drops\\[0\\] requires lat and lon"):
        LoadDetails(
            **_base_load(
                drops=[{"query": "Minot", "city": "Minot", "state": "ND"}]
            )
        )


def test_load_details_rejects_non_finite_coordinates():
    with pytest.raises(ValidationError, match="finite lat and lon"):
        LoadDetails(
            **_base_load(
                drops=[{"query": "Minot", "lat": math.nan, "lon": -101.296, "city": "Minot", "state": "ND"}]
            )
        )