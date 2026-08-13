# Escort engine fortification (2026-08-13)

## Goal
Make escort recommendations **operationally clear**:
- **may_require** vs **required** (hard)
- **count**
- **position** (lead / chase / both)
- **type** (civilian pilot vs law enforcement)
- **height pole** (none / recommended / required)
- **road-class caveat** (interstate vs local/city-county)

## What shipped on `feat/escort-engine-fortify`
1. `lib/escort-analysis.ts` — expanded `StateEscortDetail` + structured band evaluation
2. `types/permit.ts` — `escort_rules` jsonb shape
3. `supabase/migrations/045_state_escort_rules_jsonb.sql` — column + seed for MO/TX/OK/KS/NE/IA
4. Tests updated for new fields; legacy `escortCount` / `heightPoleRecommended` / `warning` preserved

## How to apply
1. Merge PR
2. Run migration 045 in Supabase SQL Editor (or `supabase db push`)
3. UI can start reading `requirementLevel`, `positions`, `escortTypes`, `heightPoleLevel`

## Not yet (next sessions)
- UI surface on analysis details / portal assist
- Authoritative per-state DOT manual verification (seed is heuristic + tagged)
- Route insert/skip hardening + border crossings → portal prefill
- City/county-specific override table (beyond road-class hint)

## Route logic hardening backlog (for follow-on)
- Prevent spurious state insertion/skipping in corridor builder
- Always persist `border_crossings` to permit request + portal packet
- Prefill portal playbooks with entry/exit + ordered corridor
