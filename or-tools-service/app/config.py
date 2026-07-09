"""
or-tools-service/app/config.py

Central configuration for the OR-Tools backend service.
- OSRM public endpoint (no key)
- Timeouts, solver limits
- CORS origins for Next.js dev + self
- Default coords and simple OSOW thresholds
- Penalty weights for VRP cost callback (basic + OSOW)
"""

from __future__ import annotations

import hashlib
import os
from pathlib import Path
from typing import Final

# --- Networking / External ---
OSRM_BASE: Final[str] = os.getenv("OSRM_BASE", "https://router.project-osrm.org")
HTTP_TIMEOUT: Final[float] = float(os.getenv("HTTP_TIMEOUT", "30.0"))
OPTIMIZE_ROUTE_TIMEOUT_S: Final[float] = float(os.getenv("OPTIMIZE_ROUTE_TIMEOUT_S", "150.0"))

# --- Server ---
DEFAULT_PORT: Final[int] = int(os.getenv("PORT", "8001"))
SERVICE_VERSION: Final[str] = "0.3.1"  # v0.3.1 World-Class Routing: hard avoid (leg-state matrix), intelligent suggest vias, robust step-ref corridor (ported+improved from TS), accurate for avoids+includes like Calvert AL->NE "avoid AR, avoid IL, include Corinth MS"


def _compute_build_id() -> str:
    """Short fingerprint of solver source for stale-process detection."""
    solver = Path(__file__).resolve().parent / "services" / "ortools_solver.py"
    try:
        return hashlib.sha256(solver.read_bytes()).hexdigest()[:12]
    except OSError:
        return "unknown"


BUILD_ID: Final[str] = _compute_build_id()

# --- CORS (used in main.py) ---
CORS_ORIGINS: Final[list[str]] = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:8001",
    "http://127.0.0.1:8001",
    # Add production origins here when known (or via env comma list)
    *[o.strip() for o in os.getenv("EXTRA_CORS_ORIGINS", "").split(",") if o.strip()],
]

# --- Solver defaults ---
SOLVER_TIME_LIMIT_S: Final[int] = int(os.getenv("SOLVER_TIME_LIMIT_S", "4"))
SOLVER_SOLUTION_LIMIT: Final[int] = int(os.getenv("SOLVER_SOLUTION_LIMIT", "32"))
ALT_SOLVER_TIME_LIMIT_S: Final[int] = 2
MAX_ALTS: Final[int] = 2

# --- Default coords (Calvert AL -> Lincoln NE) used only if none provided ---
DEFAULT_ORIGIN_LAT: Final[float] = 31.85
DEFAULT_ORIGIN_LON: Final[float] = -86.85
DEFAULT_DEST_LAT: Final[float] = 40.81
DEFAULT_DEST_LON: Final[float] = -96.68

# --- Basic OSOW thresholds (legal-ish; states vary) ---
LEGAL_WIDTH_FT: Final[float] = 8.5
LEGAL_HEIGHT_FT: Final[float] = 13.5
LEGAL_LENGTH_FT: Final[float] = 60.0  # conservative for many combos
LEGAL_WEIGHT_LBS: Final[float] = 80000.0

# Trailer/rig length vs overall envelope (trailer + load + overhangs) for permit flagging.
# Trailer <= TRAILER_LEGAL_LENGTH_FT alone does NOT trigger a length permit.
# Envelope permit threshold is ENVELOPE_PERMIT_LENGTH_FT unless a state rule sets higher.
TRAILER_LEGAL_LENGTH_FT: Final[float] = 53.0
ENVELOPE_PERMIT_LENGTH_FT: Final[float] = 84.5

# --- Penalty equivalents (meters in distance_callback for VRP ordering) ---
# These bias the solver toward orders that avoid "bad" arcs for OSOW loads.
# Penalties are soft (added to cost); hard constraints are future extension.
PENALTY_WIDTH: Final[int] = 15000
PENALTY_HEIGHT: Final[int] = 20000
PENALTY_LENGTH: Final[int] = 8000
PENALTY_WEIGHT: Final[int] = 25000
PENALTY_AXLE_OVER: Final[int] = 10000
PENALTY_AXLE_SPACING: Final[int] = 5000

# --- CITY_MAP for special instructions "include" parsing (extend as needed) ---
CITY_MAP: Final[dict[str, tuple[float, float, str]]] = {
    "memphis": (35.1495, -90.0490, "TN"),
    "oklahoma city": (35.4676, -97.5164, "OK"),
    "okc": (35.4676, -97.5164, "OK"),
    "amarillo": (35.2211, -101.8313, "TX"),
    "chicago": (41.8781, -87.6298, "IL"),
    "corinth": (34.9340, -88.5220, "MS"),
    "little rock": (34.7465, -92.2896, "AR"),
    "nashville": (36.1627, -86.7816, "TN"),
    "kansas city": (39.0997, -94.5786, "MO"),
    "st louis": (38.6270, -90.1994, "MO"),
    "dallas": (32.7767, -96.7970, "TX"),
    "fort worth": (32.7555, -97.3308, "TX"),
    "tulsa": (36.1540, -95.9928, "OK"),
    "birmingham": (33.5207, -86.8025, "AL"),
    "atlanta": (33.7490, -84.3880, "GA"),
    "denver": (39.7392, -104.9903, "CO"),
    "omaha": (41.2565, -95.9345, "NE"),
    # Expanded for v0.3 practical OSOW corridors (MO hops for AL->NE avoids etc)
    "springfield": (37.2089, -93.2923, "MO"),
    "joplin": (37.0842, -94.5133, "MO"),
    "wichita": (37.6872, -97.3301, "KS"),
    "tampa": (27.9506, -82.4572, "FL"),
    "chattanooga": (35.0456, -85.3097, "TN"),
}

STATE_ABBR: Final[set[str]] = {
    "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
    "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
    "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
    "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
    "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
}

# Minimal state name map for parser
STATE_NAME_TO_CODE: Final[dict[str, str]] = {
    "alabama": "AL", "alaska": "AK", "arizona": "AZ", "arkansas": "AR",
    "california": "CA", "colorado": "CO", "connecticut": "CT", "delaware": "DE",
    "florida": "FL", "georgia": "GA", "hawaii": "HI", "idaho": "ID",
    "illinois": "IL", "indiana": "IN", "iowa": "IA", "kansas": "KS",
    "kentucky": "KY", "louisiana": "LA", "maine": "ME", "maryland": "MD",
    "massachusetts": "MA", "michigan": "MI", "minnesota": "MN", "mississippi": "MS",
    "missouri": "MO", "montana": "MT", "nebraska": "NE", "nevada": "NV",
    "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
    "north carolina": "NC", "north dakota": "ND", "ohio": "OH", "oklahoma": "OK",
    "oregon": "OR", "pennsylvania": "PA", "rhode island": "RI", "south carolina": "SC",
    "south dakota": "SD", "tennessee": "TN", "texas": "TX", "utah": "UT",
    "vermont": "VT", "virginia": "VA", "washington": "WA", "west virginia": "WV",
    "wisconsin": "WI", "wyoming": "WY",
}

# High priority DOT restrictions (subset; see utils or solver for usage)
PRIORITY_RESTRICTIONS: Final[list[dict]] = [
    {"id": "TX-I10-01", "state": "TX", "highway": "I-10", "type": "height", "value": 13.5, "unit": "ft",
     "description": "Multiple overpasses 13'6\"–14'0\" near Houston Ship Channel."},
    {"id": "TX-I20-01", "state": "TX", "highway": "I-20", "type": "bridge_clearance", "value": 13.83, "unit": "ft",
     "description": "Low bridge west of Fort Worth (Weatherford)."},
    {"id": "OK-I40-01", "state": "OK", "highway": "I-40", "type": "bridge_clearance", "value": 13.5, "unit": "ft",
     "description": "Multiple 13'6\"–13'10\" clearances OKC–Tulsa."},
    {"id": "OK-I44-01", "state": "OK", "highway": "I-44", "type": "weight", "value": 90000, "unit": "lbs",
     "description": "Weight-restricted segments >90k lbs on Turner Turnpike."},
    {"id": "AR-I40-01", "state": "AR", "highway": "I-40", "type": "bridge_clearance", "value": 14.0, "unit": "ft",
     "description": "Several structures 14'0\" and under, West Memphis to Little Rock."},
    {"id": "MO-I44-01", "state": "MO", "highway": "I-44", "type": "bridge_clearance", "value": 13.67, "unit": "ft",
     "description": "Multiple 13'8\"–13'11\" on I-44 St. Louis to Springfield."},
    {"id": "MO-I70-01", "state": "MO", "highway": "I-70", "type": "bridge_clearance", "value": 13.75, "unit": "ft",
     "description": "Low structures Columbia to St. Louis area."},
    {"id": "IL-I55-01", "state": "IL", "highway": "I-55", "type": "weight", "value": 80000, "unit": "lbs",
     "description": "80k lbs gross on many elevated sections Chicago–St. Louis."},
    {"id": "IL-I57-01", "state": "IL", "highway": "I-57", "type": "bridge_clearance", "value": 13.75, "unit": "ft",
     "description": "Low overpass Marion / Mt. Vernon area."},
    {"id": "TN-I40-01", "state": "TN", "highway": "I-40", "type": "bridge_clearance", "value": 13.5, "unit": "ft",
     "description": "Memphis Canyon multiple low clearances historically problematic."},
    {"id": "NE-I80-01", "state": "NE", "highway": "I-80", "type": "seasonal", "value": 80000, "unit": "lbs",
     "description": "Strict spring thaw restrictions statewide on I-80 (Feb–April)."},
    {"id": "AL-I65-01", "state": "AL", "highway": "I-65", "type": "curfew", "description": "Montgomery and Birmingham peak-hour restrictions for wide loads."},
]

# Cost defaults (port of lib/cost-engine.ts)
DEFAULT_PRICING: Final[dict] = {
    "BASE_FEE_PER_STATE": 35,
    "WIDTH_SURCHARGE": 25,
    "HEIGHT_SURCHARGE": 30,
    "LENGTH_SURCHARGE": 20,
    "WEIGHT_SURCHARGE": 45,
}

# =============================================================================
# v0.3 World-Class Routing Upgrade (hard constraints + intelligent corridors)
# =============================================================================

# Expanded highway->state hints for robust extraction (port + improve from lib/build-corridor.ts extractStateHintsFromSteps)
# Note: I-40 spans many states so not a single hint (use step-ref extract for accuracy; hints are fallback only)
HIGHWAY_STATE_HINTS: Final[dict[str, str]] = {
    "I-65": "AL", "I-70": "MO", "I-80": "NE",
    "I-55": "MS", "I-57": "MO", "I-44": "MO", "I-24": "TN", "I-22": "MS",
    "I-85": "GA", "I-20": "AL", "I-10": "LA", "I-35": "OK", "I-29": "MO",
    "I-64": "MO", "I-72": "IL", "I-75": "GA", "I-4": "FL",
    "I-90": "SD", "I-25": "WY", "US 81": "NE", "US 83": "NE",
}

# Approximate lat/lon bounds (min_lat, max_lat, min_lon, max_lon) for geometry fallback
# when OSRM step refs lack state route numbers (common on I-35/I-80/I-90 long-haul).
STATE_LAT_LON_BOUNDS: Final[dict[str, tuple[float, float, float, float]]] = {
    "AL": (30.2, 35.0, -88.5, -84.9), "AZ": (31.3, 37.0, -114.8, -109.0),
    "AR": (33.0, 36.5, -94.6, -89.6), "CA": (32.5, 42.0, -124.5, -114.1),
    "CO": (37.0, 41.0, -109.1, -102.0), "CT": (40.9, 42.1, -73.7, -71.8),
    "DE": (38.4, 39.8, -75.8, -75.0), "FL": (24.5, 31.0, -87.6, -80.0),
    "GA": (30.4, 35.0, -85.6, -80.8), "ID": (42.0, 49.0, -117.2, -111.0),
    "IL": (37.0, 42.5, -91.5, -87.5), "IN": (37.8, 41.8, -88.1, -84.8),
    "IA": (40.4, 43.5, -96.15, -90.1), "KS": (37.0, 40.0, -102.1, -94.6),
    "KY": (36.5, 39.2, -89.6, -81.9), "LA": (29.0, 33.0, -94.0, -89.0),
    "ME": (43.0, 47.5, -71.1, -66.9), "MD": (37.9, 39.7, -79.5, -75.0),
    "MA": (41.2, 42.9, -73.5, -69.9), "MI": (41.7, 48.3, -90.4, -82.4),
    "MN": (43.5, 49.4, -97.2, -89.5), "MS": (30.2, 35.0, -91.7, -88.1),
    "MO": (36.0, 40.6, -95.8, -89.1), "MT": (44.4, 49.0, -116.1, -104.0),
    "NE": (40.0, 43.0, -104.1, -95.3), "NV": (35.0, 42.0, -120.0, -114.0),
    "NH": (42.7, 45.3, -72.6, -70.6), "NJ": (38.9, 41.4, -75.6, -73.9),
    "NM": (31.3, 37.0, -109.1, -103.0), "NY": (40.5, 45.0, -79.8, -71.9),
    "NC": (33.8, 36.6, -84.3, -75.5), "ND": (45.9, 49.0, -104.1, -96.5),
    "OH": (38.4, 42.0, -84.8, -80.5), "OK": (33.6, 37.0, -103.0, -94.4),
    "OR": (42.0, 46.3, -124.6, -116.5), "PA": (39.7, 42.3, -80.5, -74.7),
    "RI": (41.1, 42.0, -71.9, -71.1), "SC": (32.0, 35.2, -83.4, -78.5),
    "SD": (42.5, 45.95, -104.1, -96.4), "TN": (35.0, 36.7, -90.3, -81.6),
    "TX": (25.8, 36.5, -106.6, -93.5), "UT": (37.0, 42.0, -114.1, -109.0),
    "VT": (42.7, 45.0, -73.4, -71.5), "VA": (36.5, 39.5, -83.7, -75.2),
    "WA": (45.5, 49.0, -124.8, -116.9), "WV": (37.2, 40.6, -82.7, -77.7),
    "WI": (42.5, 47.1, -92.9, -86.8), "WY": (41.0, 45.0, -111.1, -104.06),
}

STATE_CENTROIDS: Final[dict[str, tuple[float, float]]] = {
    st: ((b[0] + b[1]) / 2.0, (b[2] + b[3]) / 2.0)
    for st, b in STATE_LAT_LON_BOUNDS.items()
}

# Huge cost for matrix entries whose *actual OSRM leg geometry* crosses an avoided state.
# This makes VRP treat such hops as essentially unreachable (hard enforcement during optimization).
AVOID_STATE_CROSSING_PENALTY: Final[float] = 1_000_000_000.0

# Comment: suggest_practical_vias (in solver) uses CITY_MAP + this knowledge of OSOW-friendly major corridors
# (I-40 gold standard southern/west, I-55/I-57, I-65, I-70, I-80; avoid chokepoints for wide/tall).
# User "include" + manualRoute always take precedence; suggests only to seed good stops when prefs present.
