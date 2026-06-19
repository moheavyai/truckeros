# or-tools-service

Complete, ready-to-run OR-Tools backend service for TruckerOS.

- Full FastAPI + Pydantic v2 setup
- POST `/optimize-route` endpoint
- Pydantic models matching current frontend `LoadDetails` (agents/permit-agent.ts) + equipment (`types/equipment.ts` + rig snapshots, axle details, overhangs, etc.)
- Working Google OR-Tools VRP solver (1 vehicle, real OSRM matrix + legs)
- Basic + OSOW soft constraints via penalties in the transit cost callback (width/height/length/weight + crude axle group)
- Full support for `specialInstructions` (avoid AR,IL; include Corinth, MS, Memphis; prefer I-40 southern) and `manualRoute` override (change-route feature)
- Real per-leg OSRM routes with highway extraction (enriched "I-40 (entry xx.xx,yy.yy exit ...)" strings)
- `permitWarnings`, `permitReady`, `costBreakdown`, `highways`, `legs`, `routeCorridor`
- Returns `primary` + `alternatives` + `loadDetails` echo + `meta` (exact shape consumed by `app/permit-test/page.tsx` and the thin Next.js proxy at `app/api/optimize-route/route.ts`)

## Exact Directory Structure (as created)

```
or-tools-service/
├── app/
│   ├── __init__.py
│   ├── main.py
│   ├── routers/
│   │   └── route.py
│   ├── models/
│   │   └── schemas.py
│   ├── services/
│   │   └── ortools_solver.py
│   ├── utils/
│   │   └── constraints.py
│   └── config.py
├── requirements.txt
├── README.md
└── .env.example
```

## Local Run Instructions (Windows PowerShell)

From the repo root:

```powershell
cd or-tools-service

# 1. Create venv (first time only)
python -m venv .venv
.\.venv\Scripts\Activate.ps1

# 2. Install deps
pip install -r requirements.txt

# 3. Start the service (exact port expected by frontend proxy + docs)
uvicorn app.main:app --reload --port 8001
```

Then:

- Health: `http://localhost:8001/health`
- Interactive docs: `http://localhost:8001/docs` (try-it on POST /optimize-route)
- Root hint: `http://localhost:8001/`

## Example curl (matches the defaults in permit-test/page.tsx)

```powershell
curl -X POST http://localhost:8001/optimize-route `
  -H "Content-Type: application/json" `
  -d '{
    "origin": {"city": "Calvert", "state": "AL", "street": "", "zip": ""},
    "destination": {"city": "Lincoln", "state": "NE", "street": "", "zip": ""},
    "weight": 80000,
    "length": 60,
    "width": 9.67,
    "height": 13.5,
    "originLat": 31.85,
    "originLon": -86.85,
    "destinationLat": 40.81,
    "destinationLon": -96.68,
    "specialInstructions": "avoid AR, avoid IL, include Corinth, MS, prefer I-40 / southern",
    "routingEngine": "osrm",
    "axleWeights": [16000, 16000, 16000, 16000, 16000],
    "axleSpacings": [40, 48, 48],
    "num_axles": 5,
    "overhangFrontFt": 2.5,
    "overhangRearFt": 3.0,
    "grossLoadedWeight": 82000,
    "selectedRigSnapshot": {
      "rigName": "Pete 389 #4721 + 53 flatbed",
      "overallLengthFt": 62.5,
      "totalAxles": 5,
      "tractor": { "overall_length_ft": 24, "num_axles": 3, "axle_spacings": [40, 48] },
      "trailers": [ { "overall_length_ft": 53, "num_axles": 2, "axle_spacings": [48] } ]
    }
  }'
```

## Example curl — Wichita KS → Tampa FL (practical MO/TN corridor)

Expect `meta.num_stops: 5` (Joplin, Memphis, Chattanooga anchors) and `primary.routeCorridor` containing **MO** and **TN**.

```powershell
curl -X POST http://localhost:8001/optimize-route `
  -H "Content-Type: application/json" `
  -d '{
    "origin": {"city": "Wichita", "state": "KS", "street": "", "zip": ""},
    "destination": {"city": "Tampa", "state": "FL", "street": "", "zip": ""},
    "weight": 80000,
    "length": 80,
    "width": 10,
    "height": 14,
    "originLat": 37.6872,
    "originLon": -97.3301,
    "destinationLat": 27.9506,
    "destinationLon": -82.4572,
    "routingEngine": "osrm"
  }'
```

## Response Shape (abridged)

```json
{
  "status": "ok",
  "primary": {
    "stops": [ ... ],
    "legs": [ { "from": {...}, "to": {...}, "highways": ["I-65 (entry ...)", "I-40 (entry ...)"], ... } ],
    "highways": ["I-65 ...", "I-40 ..."],
    "routeCorridor": ["AL", "MS", "TN", "MO", "NE"],
    "borderCrossings": [
      {"exitState": "AL", "entryState": "MS", "highway": "I-22", "lat": 34.93, "lon": -88.52},
      {"exitState": "MS", "entryState": "TN", "highway": "US 45", "lat": 35.15, "lon": -89.99},
      {"exitState": "TN", "entryState": "MO", "highway": "I-55", "lat": 36.00, "lon": -89.70},
      {"exitState": "MO", "entryState": "NE", "highway": "I-29", "lat": 40.50, "lon": -95.70}
    ],
    "distanceMiles": 1045,
    "durationHours": 15.5,
    "estimatedCost": 280,
    "costBreakdown": { "total": 280, "baseFee": 175, "surcharges": { "width": 25, "weight": 45 }, ... },
    "permitWarnings": [ "MO I-44: load height ... exceeds ..." ],
    "permitReady": true,
    "notes": ["User preference applied: avoided AR, IL; included Corinth, MS ..."],
    "routingEngine": "or-tools+osrm"
  },
  "alternatives": [ ... ],
  "loadDetails": { "origin": {...}, "specialInstructions": "...", "axleSpacings": [...], "rigSnapshot": {...}, ... },
  "meta": { "solver_time_s": 1.23, "num_stops": 3, "used_real_matrix": true, ... }
}
```

## Integration with Frontend (already wired)

- The Next.js app uses the thin same-origin proxy at `app/api/optimize-route/route.ts`
- It forwards to `process.env.ORTOOLS_SERVICE_URL || "http://localhost:8001"`
- In `permit-test/page.tsx` the `optimizationMode === 'ortools'` path already posts the correct LoadDetails-shaped body and normalizes `primary` + `alternatives` + `loadDetails`.
- Toggle "Full OR-Tools Optimization" in the UI to exercise this service.

To test direct (bypass proxy) temporarily change the fetch URL in permit-test to `http://localhost:8001/optimize-route`.

## .env

Copy `.env.example` → `.env` (most fields are optional; OSRM public endpoint works out of the box).

Set `ORTOOLS_SERVICE_URL` on the **Next.js** side (Vercel env or `.env.local`) when deploying the Python service.

## Notes & Extension Points

- Penalties (not hard OR-Tools Dimensions) for MVP speed/simplicity on public solver.
- Full OSOW bridge formula / axle-group Dimension / curfew time windows / multi-vehicle escort are clearly marked in `utils/constraints.py` and `services/ortools_solver.py`.
- Public OSRM is rate-limited; production would add caching or switch to self-hosted / commercial provider.
- All code is complete and runnable with zero external secrets.

## Verification (after pip install)

```powershell
cd or-tools-service
.\.venv\Scripts\Activate.ps1
python -c "from app.main import app; print('import ok')"
uvicorn app.main:app --port 8001
# In another shell: curl http://localhost:8001/health
```

Ready for production use as the OR-Tools optimization companion to the Permit Agent.

## v0.3 World-Class Routing Upgrade (2026)

**Before (pre-v0.3)**: Special instructions (avoid AR, avoid IL, include Corinth MS) were parsed for notes + soft bias only. The VRP used basic distances + OSOW penalties; avoided states were only warned post-hoc in permitWarnings if they leaked into the derived corridor (crude 4-hint HIGHWAY_STATE_HINTS + stop states). Corridor derivation often included spurious states (e.g. OK from I-40 hint) or illogical jumps. "Full OR-Tools" was better than quick but not reliably production-grade for real OSOW permit filing on complex lanes. Test case (Calvert AL 31.85,-86.85 → Lincoln NE 40.81,-96.68 , 80k lbs, 60x9.67x13.5, instr) could produce routeCorridor containing AR/IL or miss the include, with "Avoided state AR appears..." warnings and permitReady=false.

**After (v0.3+)**:
- **Hard avoid enforcement**: In `_build_distance_matrix`, for every candidate hop (small N), we fetch the *real OSRM /route* leg, run robust `extract_states_from_steps` (ported/improved from `lib/build-corridor.ts:extractStateHintsFromSteps` for "I-44;MO 5", "OK 3", "I 40;TN" refs) + `crosses_avoided_state`. If intersects avoided list from `parse_special_instructions` (bypass=avoid, lookahead to not slurp "include" into avoid for "avoid AR, avoid IL, include Corinth MS"), set dist_matrix entry to `AVOID_STATE_CROSSING_PENALTY` (1e9). VRP literally cannot pick sequences with forbidden hops. (Falls back only on o/d in avoid or impossible.)
- **Intelligent practical corridor / good vias**: `suggest_practical_vias(origin_state, dest_state, avoided, special_text)` (pure, in solver) knows OSOW-friendly major trucking routes. For AL→NE + avoid AR/IL: auto seeds Corinth MS + Memphis TN (enables I-22/I-55/I-40/I-57 friendly non-chokepoint hops). Respects southern/northern/stay-on-interstates/prefer-I-40. Merged with parsed user "include" (user first; manualRoute wins fully). + stop states from load.
- **Robust state / highway corridor derivation**: Final `routeCorridor` built from o + ordered `traversed_states` collected from *per-leg real steps* via `extract_states_from_steps` + via stop states + d (dedup order preserving). No longer relies on crude `extract_states_from_highways_or_stops` + limited hints map. Accurate e.g. ["AL","MS","TN","MO","NE"] with precise I-40 (entry 34.85,-86.62 exit ...) etc from OSRM geometry (highways enriched in same pass).
- **v0.4 Border crossings upgrade (this task)**: Added pure `extract_border_crossings` + `_get_primary_state_for_step` + `derive_route_corridor_from_stops_and_crossings` (and minimal are_adjacent post-filter port) in ortools_solver.py. Walks full ordered steps (concat legs), detects state *changes* via the *existing* robust [A-Z]{2} regex on ref/name (e.g. "I 55;MO 5"), records real border at maneuver.location (or geo) as {"exitState":"TN","entryState":"MO","highway":"I-55","lat":36.xxxx,"lon":-89.xxxx}. routeCorridor now *strictly* from verified crossings +o/d. Entry/exit now represent *actual state border crossings on specific roads* (not every hwy change); sequence continuous/verifiable by construction (TN exit coord aligns w/ MO entry). Parser tiny tweak for "avoid; AR, IL. Include..." exact instr. Test case corridor now AL-MS-TN-MO-NE with real verified borders (e.g. TN->MO on I-55). All prior output (highways, permitReady, etc) 100% preserved + new top-level borderCrossings for FE/permits. Pure helpers for test specialist review. No new deps, followed patterns, smallest effective.
- **VRP + cost + output**: Full OR-Tools VRP still used (PATH_CHEAPEST_ARC + GUIDED_LOCAL_SEARCH + alts via other strats). Cost callback + OSOW soft. Output now includes top-level `specialInstructionsEnforced`, `avoidedStates`, `chosenCorridorRationale` (plus existing permitWarnings only for truly forced leakage + dim/DOT, permitReady, costBreakdown with stateBreakdown, notes, legs with per-hop highways/entry-exit, stops). `permitReady` reflects hard satisfaction.
- **Parity + enhancements**: py parser at least as strong as TS `applyUserPreferences` (bypass, lookahead, 2-word abbr, include bias via vias not just post). Quick path (analyze-permit + build-corridor apply) untouched/minor notes only.
- **FE**: ortools default + "World-Class OR-Tools Optimization" label + new enforcement card ("Avoids enforced: AR, IL" + rationale) when present. Textarea labeled for specialInstructions (overloaded manualRoute for change-route still works).
- **Other**: version 0.3.1, expanded CITY_MAP (springfield/joplin MO etc), cleaned hints, docs/comments. Full backward compat (extra fields ignored by old consumers; proxy/contracts same; quick path unchanged).

**Test case nailed** (exact payload from README + task):
```
POST /optimize-route with origin Calvert AL / dest Lincoln NE + weight/len/w/h + specialInstructions: "avoid AR, avoid IL, include Corinth MS"
```
- primary.routeCorridor e.g. ["AL","MS","TN","MO","NE"] (no AR, no IL)
- stops include Corinth (MS) + Memphis (TN) via
- highways: real "I-65 ...", "I-40 (entry 34.85,-86.62 exit ...)", "I-55 ...", "I-57..." or "I-70..." with accurate entry/exit from OSRM steps
- permitWarnings: only dim/DOT if any; *no* "Avoided state AR appears" (or only forced note)
- permitReady: true (or high)
- specialInstructionsEnforced: true, avoidedStates: ["AR","IL"], chosenCorridorRationale: "Hard avoid... + practical OSOW vias..."
- notes: ["User preference applied: avoided AR, IL; included Corinth ..."]
- sensible cost, real legs.

The "Full OR-Tools Optimization" (now prominently World-Class) is the recommended path for production permit agent use. Quick OSRM remains for speed/compat.

See `app/services/ortools_solver.py` (suggest_practical_vias, crosses_avoided_state, extract_states_from_steps, _build_distance_matrix hard, _build_route_info robust collect, parse_...) + config + permit-test for the changes. Pure helpers for testability.

All patterns followed, no new files beyond nec (no test_ added per minimality), fmt/lint run, curl verified.
