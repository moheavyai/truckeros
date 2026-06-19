"""
or-tools-service/app/routers/route.py

FastAPI APIRouter exposing the main /optimize-route endpoint.

- Accepts tolerant LoadDetails (Pydantic with aliases + extra=ignore)
- Calls the full OR-Tools VRP solver (basic + OSOW penalties + real OSRM legs)
- Returns primary + alternatives + loadDetails echo + meta (shape expected by Next.js proxy + permit-test page)
- Clear error handling (422 for bad payload, 500 for solver issues)
"""

from __future__ import annotations

import asyncio
import logging
import time
import traceback
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import ValidationError

from ..config import OPTIMIZE_ROUTE_TIMEOUT_S
from ..models.schemas import LoadDetails
from ..services.ortools_solver import optimize_route

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/optimize-route")
async def optimize_route_endpoint(payload: dict[str, Any]) -> dict[str, Any]:
    """
    Main optimization endpoint for TruckerOS.

    Payload: any JSON that is a superset of LoadDetails (origin/dest city+state, weight/len/w/h,
    optional coords, specialInstructions, manualRoute, axle*, selectedRigSnapshot, etc.).

    Returns:
    {
      "status": "ok",
      "primary": { stops, legs, highways, routeCorridor, distanceMiles, durationHours,
                   estimatedCost, costBreakdown, permitWarnings, permitReady, notes, routingEngine },
      "alternatives": [ ... ],
      "loadDetails": { origin, destination, weight..., specialInstructions, axleSpacings, rigSnapshot, ... },
      "meta": { solver_time_s, num_stops, used_real_matrix, ... }
    }
    """
    try:
        load = LoadDetails(**payload)
    except ValidationError as ve:
        logger.warning("Validation error on /optimize-route: %s", ve)
        raise HTTPException(
            status_code=422,
            detail={
                "status": "invalid",
                "message": "Invalid load details payload",
                "errors": ve.errors(include_url=False, include_input=False),
            },
        ) from ve

    t0 = time.time()
    try:
        result = await asyncio.wait_for(
            optimize_route(load),
            timeout=OPTIMIZE_ROUTE_TIMEOUT_S,
        )
        elapsed = time.time() - t0
        logger.info("[ORT] optimize-route OK elapsed=%.3fs", elapsed)

        # Echo rich loadDetails for FE parity (history, rig diagrams, change-route, etc.)
        result["loadDetails"] = {
            "origin": load.origin.model_dump(),
            "destination": load.destination.model_dump(),
            "weight": load.weight,
            "length": load.length,
            "width": load.width,
            "height": load.height,
            "specialInstructions": load.get_special_instructions(),
            "axleSpacings": load.get_axle_spacings(),
            "axleWeights": load.get_axle_weights(),
            "overhangs": list(load.get_overhangs()),
            "manualRoute": load.get_manual_route(),
            "rigSnapshot": load.get_rig_snapshot(),
            "selectedRigSnapshot": load.selectedRigSnapshot,
            "numAxles": load.get_num_axles(),
            "tractor": (load.tractor.model_dump() if hasattr(load.tractor, "model_dump") and load.tractor else load.tractor),
            "trailers": [
                (t.model_dump() if hasattr(t, "model_dump") else t)
                for t in (load.trailers or [])
            ] if load.trailers else None,
        }
        return result
    except asyncio.TimeoutError:
        elapsed = time.time() - t0
        logger.error(
            "[ORT] optimize-route TIMEOUT after %.3fs (limit=%.1fs)",
            elapsed,
            OPTIMIZE_ROUTE_TIMEOUT_S,
        )
        raise HTTPException(
            status_code=504,
            detail={
                "status": "timeout",
                "message": "OR-Tools optimization timed out",
                "elapsed_s": round(elapsed, 3),
                "timeout_s": OPTIMIZE_ROUTE_TIMEOUT_S,
            },
        ) from None
    except Exception as exc:
        elapsed = time.time() - t0
        logger.error(
            "[ORT] optimize-route FAILED after %.3fs: %s: %s\n%s",
            elapsed,
            type(exc).__name__,
            exc,
            traceback.format_exc(),
        )
        raise HTTPException(
            status_code=500,
            detail={
                "status": "error",
                "message": "Route optimization failed",
                "error": str(exc)[:200],
                "error_type": type(exc).__name__,
                "elapsed_s": round(elapsed, 3),
            },
        ) from exc


@router.get("/optimize-route")
async def optimize_route_get_hint() -> dict[str, Any]:
    """Helpful GET response for browser/curl discovery."""
    return {
        "message": "POST JSON LoadDetails here. See /docs for OpenAPI.",
        "example": "See README.md in or-tools-service root for full curl.",
    }
