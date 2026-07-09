"""
or-tools-service/app/models/schemas.py

Pydantic v2 models matching frontend LoadDetails (agents/permit-agent.ts) + equipment (types/equipment.ts).

- Supports both camelCase (JS) and snake_case via Field(alias=...) + populate_by_name
- extra='ignore' so extra form fields (cargo*, unitNumber, etc.) never break the endpoint
- Rich rig/axle/overhang/tractor/trailer snapshot support for future full OSOW constraints
- Getters for unified access (specialInstructions, manualRoute, coords, axle data, etc.)
- Tolerates the analyzePayload + full formData + change-route payloads used by permit-test/page.tsx
"""

from __future__ import annotations

import math
import re
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class Address(BaseModel):
    """Matches agents/permit-agent.ts Address + form shape."""
    model_config = ConfigDict(extra="ignore", populate_by_name=True, str_strip_whitespace=True)

    query: str | None = ""
    street: str | None = ""
    city: str
    state: str
    zip: str | None = ""


class DropStop(Address):
    """Delivery stop with resolved coordinates."""
    lat: float | None = None
    lon: float | None = None


class TractorProfile(BaseModel):
    """Partial Tractor from types/equipment.ts (for axle_spacings etc)."""
    model_config = ConfigDict(extra="ignore", populate_by_name=True)

    profile_name: str | None = None
    overall_length_ft: float | None = None
    num_axles: int | None = None
    axle_spacings: list[float] | None = Field(None, alias="axleSpacings")  # inches
    steer_axle_setback_in: float | None = None
    wheelbase_in: float | None = None
    fifth_wheel_from_rear_in: float | None = None
    axles: int | None = None  # legacy form alias for num_axles


class TrailerProfile(BaseModel):
    """Partial Trailer from types/equipment.ts."""
    model_config = ConfigDict(extra="ignore", populate_by_name=True)

    profile_name: str | None = None
    overall_length_ft: float | None = None
    num_axles: int | None = None
    axle_spacings: list[float] | None = Field(None, alias="axleSpacings")
    kingpin_distance_from_front_in: float | None = None
    kingpin_to_first_axle_in: float | None = None
    has_lift_axle: bool | None = None
    is_extendable: bool | None = None
    extendable_extra_ft: float | None = None
    trailer_type: str | None = None
    make: str | None = None
    model: str | None = None
    year: int | None = None


class RigProfile(BaseModel):
    """RigSnapshot / RigConfiguration shape (from permit-test + equipment.ts)."""
    model_config = ConfigDict(extra="ignore", populate_by_name=True)

    rigId: str | None = None
    rigName: str | None = None
    rig_id: str | None = None
    rig_name: str | None = None
    tractor: dict[str, Any] | None = None
    trailers: list[dict[str, Any]] | None = None
    overallLengthFt: float | None = None
    totalAxles: int | None = None
    computed_total_length_ft: float | None = None
    computed_total_axles: int | None = None


class LoadDetails(BaseModel):
    """
    Primary payload model for /optimize-route.

    Accepts the exact shapes posted by:
    - /api/analyze-permit mapper (basic + specialInstructions)
    - full formData from permit-test (rich rig/axle/overhang + camelCase)
    - manualRoute (states list) or specialInstructions string
    - change-route payload (manualRoute override)

    OSOW-relevant fields are captured even if only used for penalties today.
    """
    model_config = ConfigDict(
        extra="ignore",
        populate_by_name=True,
        str_strip_whitespace=True,
    )

    # Core required (validation mirrors agent)
    origin: Address
    destination: Address
    drops: list[DropStop] | None = Field(None, alias="drops")
    weight: float = Field(..., gt=0)
    length: float = Field(..., gt=0)
    width: float = Field(..., gt=0)
    height: float = Field(..., gt=0)

    # Optional carrier ids
    mcNumber: str | None = Field(None, alias="mcNumber")
    mc_number: str | None = None
    dotNumber: str | None = Field(None, alias="dotNumber")
    dot_number: str | None = None
    vehicleInfo: str | None = Field(None, alias="vehicleInfo")

    # Coords (preferred when present; from geocode or map pickers in FE)
    originLat: float | None = Field(None, alias="originLat")
    origin_lat: float | None = None
    originLon: float | None = Field(None, alias="originLon")
    origin_lon: float | None = None
    destinationLat: float | None = Field(None, alias="destinationLat")
    destination_lat: float | None = None
    destinationLon: float | None = Field(None, alias="destinationLon")
    destination_lon: float | None = None

    # Manual override (list of state codes or city names for forced vias / corridor)
    manualRoute: list[str] | None = Field(None, alias="manualRoute")
    manual_route: list[str] | None = None

    # Routing choice (frontend passes; we currently use OSRM inside)
    routingEngine: Literal["osrm", "graphhopper"] | None = Field(None, alias="routingEngine")
    routing_engine: str | None = None

    # Free-text special instructions / prefs (key for "include Memphis", "avoid AR,IL", "prefer I-40 southern")
    specialInstructions: str | None = Field(None, alias="specialInstructions")
    special_instructions: str | None = None

    # === Equipment / rig / axle details (types/equipment.ts + formData v2) ===
    axleWeights: list[float] | None = Field(None, alias="axleWeights")
    axle_weights: list[float] | None = None
    axleSpacing: str | list[float] | None = Field(None, alias="axleSpacing")
    axle_spacings: list[float] | None = Field(None, alias="axleSpacings")
    num_axles: int | None = None
    axles: int | None = None

    # Overhangs (front-of-rig affects envelope for OSOW; trailer front is mostly permit doc)
    overhang_front_ft: float | None = Field(None, alias="overhangFrontFt")
    overhang_rear_ft: float | None = Field(None, alias="overhangRearFt")
    loadOverhangFrontFt: float | None = Field(None, alias="loadOverhangFrontFt")
    loadOverhangRearFt: float | None = Field(None, alias="loadOverhangRearFt")
    loadOverhangFrontTrailerFt: float | None = Field(None, alias="loadOverhangFrontTrailerFt")

    grossLoadedWeight: float | None = Field(None, alias="grossLoadedWeight")
    gross_loaded_weight: float | None = None
    registeredGvwLbs: float | None = Field(None, alias="registeredGvwLbs")

    # Snapshots (full fidelity round-trip for history/audit)
    rig: RigProfile | dict[str, Any] | None = None
    equipment: dict[str, Any] | None = None
    selectedRigSnapshot: dict[str, Any] | None = Field(None, alias="selectedRigSnapshot")
    selectedRigId: str | None = Field(None, alias="selectedRigId")

    # Direct tractor / trailers when sent
    tractor: TractorProfile | dict[str, Any] | None = None
    trailers: list[TrailerProfile | dict[str, Any]] | None = None

    # Tolerated noise (cargo etc) via extra=ignore
    cargoDescription: str | None = None
    unitNumber: str | None = None
    vin: str | None = None
    year: str | int | None = None
    make: str | None = None
    model: str | None = None
    trailerMake: str | None = None
    trailerModel: str | None = None
    trailerYear: str | int | None = None
    trailerLengthFt: float | None = None
    tireWidthIn: float | None = None
    kingpinSettingIn: float | None = None
    axleWeights: list[float] | None = Field(None, alias="axleWeights")  # ensure
    loadWeightLbs: float | str | None = None
    loadLengthFt: float | str | None = None
    loadWidthFt: float | str | None = None
    loadHeightFt: float | str | None = None

    @field_validator("origin", "destination", mode="before")
    @classmethod
    def ensure_address(cls, v: Any) -> Any:
        if isinstance(v, dict):
            v.setdefault("city", "")
            v.setdefault("state", "")
        return v

    @field_validator("weight", "length", "width", "height", mode="before")
    @classmethod
    def to_float(cls, v: Any) -> float:
        if v is None:
            return 0.0
        try:
            return float(v)
        except Exception:
            return 0.0

    @model_validator(mode="after")
    def validate_drop_coordinates(self) -> "LoadDetails":
        if self.drops:
            for i, drop in enumerate(self.drops):
                lat = drop.lat
                lon = drop.lon
                if lat is None or lon is None:
                    raise ValueError(f"drops[{i}] requires lat and lon coordinates")
                if not math.isfinite(float(lat)) or not math.isfinite(float(lon)):
                    raise ValueError(f"drops[{i}] requires finite lat and lon coordinates")
        return self

    # --- Unified getters (used by solver / constraints) ---

    def get_special_instructions(self) -> str | None:
        return self.special_instructions or self.specialInstructions

    def get_manual_route(self) -> list[str] | None:
        return self.manual_route or self.manualRoute

    def get_origin_coords(self) -> tuple[float, float] | None:
        lat = self.origin_lat or self.originLat
        lon = self.origin_lon or self.originLon
        if lat is not None and lon is not None:
            return (float(lat), float(lon))
        return None

    def get_destination_coords(self) -> tuple[float, float] | None:
        lat = self.destination_lat or self.destinationLat
        lon = self.destination_lon or self.destinationLon
        if lat is not None and lon is not None:
            return (float(lat), float(lon))
        return None

    def get_axle_spacings(self) -> list[float]:
        """Tolerant extraction mirroring parseAxleSpacings + rig snapshot walk in TS."""
        def _extract(obj: Any) -> list[float]:
            if obj is None:
                return []
            if isinstance(obj, dict):
                spac = obj.get("axle_spacings") or obj.get("axleSpacings") or obj.get("axleSpacing")
                if isinstance(spac, list):
                    return [float(x) for x in spac if isinstance(x, (int, float)) and x > 0]
                if isinstance(spac, str):
                    nums = re.findall(r"[\d.]+", spac)
                    return [float(n) for n in nums if float(n) > 0]
                return []
            if hasattr(obj, "axle_spacings") and getattr(obj, "axle_spacings", None):
                return [float(x) for x in getattr(obj, "axle_spacings") if isinstance(x, (int, float)) and x > 0]
            if hasattr(obj, "model_dump"):
                try:
                    return _extract(obj.model_dump())
                except Exception:
                    pass
            return []

        if self.axle_spacings:
            return [float(x) for x in self.axle_spacings if isinstance(x, (int, float)) and x > 0]
        if self.axleSpacing:
            if isinstance(self.axleSpacing, list):
                return [float(x) for x in self.axleSpacing if isinstance(x, (int, float)) and x > 0]
            if isinstance(self.axleSpacing, str):
                nums = re.findall(r"[\d.]+", self.axleSpacing)
                return [float(n) for n in nums if float(n) > 0]

        snap = self.get_rig_snapshot()
        if snap:
            tractor = snap.get("tractor") if isinstance(snap, dict) else getattr(snap, "tractor", None)
            res = _extract(tractor)
            if res:
                return res
            trs = snap.get("trailers") if isinstance(snap, dict) else getattr(snap, "trailers", None)
            if trs and len(trs) > 0:
                res = _extract(trs[0])
                if res:
                    return res

        if self.tractor:
            res = _extract(self.tractor)
            if res:
                return res
        if self.trailers and len(self.trailers) > 0:
            res = _extract(self.trailers[0])
            if res:
                return res
        return []

    def get_axle_weights(self) -> list[float]:
        if self.axle_weights:
            return [float(x) for x in self.axle_weights]
        if self.axleWeights:
            return [float(x) for x in self.axleWeights]
        return []

    def get_overhangs(self) -> tuple[float, float]:
        """(front_ft, rear_ft) — front contributes to envelope."""
        front = self.overhang_front_ft or self.loadOverhangFrontFt or 0.0
        rear = self.overhang_rear_ft or self.loadOverhangRearFt or 0.0
        return (float(front or 0), float(rear or 0))

    def get_rig_snapshot(self) -> dict[str, Any] | None:
        if self.selectedRigSnapshot:
            return self.selectedRigSnapshot if isinstance(self.selectedRigSnapshot, dict) else None
        if self.rig:
            if isinstance(self.rig, dict):
                return self.rig
            try:
                return self.rig.model_dump()
            except Exception:
                return None
        if self.equipment and isinstance(self.equipment, dict) and self.equipment.get("rig"):
            return self.equipment["rig"] if isinstance(self.equipment["rig"], dict) else None
        return None

    def get_num_axles(self) -> int:
        if self.num_axles is not None:
            return int(self.num_axles)
        if self.axles is not None:
            return int(self.axles)
        snap = self.get_rig_snapshot()
        if snap and isinstance(snap, dict):
            if snap.get("totalAxles"):
                return int(snap["totalAxles"])
            if snap.get("computed_total_axles"):
                return int(snap["computed_total_axles"])
            t = snap.get("tractor") or {}
            if isinstance(t, dict) and t.get("num_axles"):
                return int(t["num_axles"])
        return 5  # common default
