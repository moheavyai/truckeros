# TruckerOS

Agentic OSOW (oversize/overweight) permit platform for owner-operators and small carriers.

TruckerOS helps build intelligent multi-state corridors, flag permit and escort needs, estimate costs, and assist with state portal prefill — including geometry-aligned border entry/exit points for through-states.

## Stack

| Layer | Tech |
|-------|------|
| App | Next.js 16 (App Router), React, TypeScript, Tailwind |
| Auth / DB | Supabase (Auth, Postgres, RLS) |
| Routing | OSRM (default) + optional GraphHopper truck profile |
| Map (v1) | Leaflet + OpenStreetMap tiles (markers, polyline); MapLibre optional later for vector styles |
| Optimization | Python FastAPI + OR-Tools (`or-tools-service/`) |
| Tests | Vitest (`npm test` / `prebuild`) |

## Quick start

```bash
# 1. Install
npm install

# 2. Env
cp .env.local.example .env.local
# Fill NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY

# 3. Dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Windows note: `npm run dev` uses Webpack for stable Tailwind/PostCSS. Optional: `npm run dev:turbo`.

## Core product areas

- **Permit agent** — corridor options, state rules, escorts, DOT restrictions, cost
- **Corridor builder** (`lib/build-corridor.ts`) — ordered states, highways, `borderCrossings`
- **Equipment / rigs** — tractors, trailers, axle groups, scale checks
- **Portal Assist** — per-state prefill packages (origin / through / destination border fields)
- **Multi-org roles** — Owner, Admin, Driver, Permit Clerk, Viewer; service mode isolation

## Database migrations

Migrations live in `supabase/migrations/`. The project is linked to Supabase CLI.

```bash
# Apply pending migrations to the linked remote project
npx supabase db push
```

Notable migrations include equipment/rigs, multi-org RLS (Phase 1b), axle configs (042), and `border_crossings` / `highways` on `permit_requests` (043).

**Important:** Apply migrations before deploying app code that writes new columns. Migration 043 is required for permit saves that emit `border_crossings` and `highways`.

## Scripts

| Command | Purpose |
|---------|---------|
| `npm run dev` | Next.js dev server |
| `npm test` | Vitest once |
| `npm run build` | Runs tests (`prebuild`) then production build |
| `npm run safety:backup` | Zip backup + commit + push (Windows PowerShell) |
| `npm run restart:ortools` | Restart local OR-Tools service (Windows) |

## OR-Tools service

Optional local Python service under `or-tools-service/` for advanced VRP/OSOW optimization. The main Next.js app can run without it for corridor analysis via OSRM/GraphHopper.

See `or-tools-service/` and `restart-ortools.ps1` for local setup.

## Safety

- Use `npm run safety:backup` before large changes
- Follow `SAFETY-CHECKLIST.md` for release hygiene
- Never commit `.env.local` or secrets

## Repo layout (high level)

```
app/                 Next.js routes & UI (permit-test, portal-assist, equipment, …)
agents/              Permit agent
lib/                 Corridor, portals, cost, equipment helpers
components/          Shared UI
supabase/migrations/ SQL migrations
or-tools-service/    Python FastAPI + OR-Tools
scripts/             Backups, migration helpers
docs/                Plans and product notes
```

## Deferred / later

- Stripe payments
- Commercial map / ProMiles-class routing product
- MapLibre / vector styles for richer basemaps (v1 uses Leaflet + OSM)

## License

Private — `moheavyai/truckeros`.
