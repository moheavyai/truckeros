# Safety Checklist — Before Major Changes

Use this checklist before refactors, schema changes, dependency upgrades, or any work that could break production.

## Prerequisites

| Requirement | Notes |
|-------------|-------|
| **Windows PowerShell 5.1+** | Script uses `#Requires -Version 5.1` |
| **Git** | On PATH; repository initialized with `main` branch |
| **Node.js + npm** | Required for `npm run safety:backup` and Supabase CLI via `npx` |
| **Branch `main` checked out** | Script fails if on another branch or detached HEAD |
| **Pester 5.x** (optional) | For `npm run test:safety` exclusion tests |

## One-Command Safety Run

From the project root:

```bash
npm run safety:backup
```

This runs `scripts/backup-and-push.ps1`, which performs all steps below automatically.

---

## Manual Step-by-Step (if you prefer control)

### 1. Backup — Create a timestamped zip

- [ ] Confirm you are in the project root (`package.json` present).
- [ ] Run `npm run safety:backup` **or** create a manual zip of the project.
- [ ] Verify a new file appears in `backups/` (e.g. `truckeros-backup-YYYY-MM-DD_HHMMSS.zip`).
- [ ] Confirm secret files are **not** inside the zip (see exclusions below).

**Excluded from backups** (directories pruned during walk — not scanned):

`node_modules`, `.next`, `.git`, `backups`, `out`, `build`, `.vercel`, `__pycache__`, `.venv`, `dist`, `coverage`, `.turbo`, `.pnp`, `agent-tools`, `.supabase`

**Excluded file patterns:** `.env*`, `*.pem`, `*.key`, `*.p12`, `*.pfx`, `*.crt`, `*.cer`, `id_rsa`, `id_rsa.pub`, `id_ed25519`, `id_ed25519.pub`, `credentials.json`, `.npmrc`

**Security notes:**
- Symlinks/junctions are skipped (prevents packing files outside the project root).
- Backups are written atomically (`.partial` temp file, renamed on success).
- The `backups/` folder ACL is restricted to the current Windows user when `icacls` is available.

### 2. Commit — Save current work to git

- [ ] Run `git status` and review what will be committed.
- [ ] The script prints `git status --short` before staging.
- [ ] The script scans changed files for sensitive names/content and **aborts** if secrets are detected.
- [ ] Stage and commit with a clear message, e.g. `chore: safety backup YYYY-MM-DD_HHMMSS`.
- [ ] If there are no changes, skip commit (the script does this automatically).

### 3. Push — Remote safety copy on `main`

- [ ] **Must be on branch `main`** — the script fails on any other branch or detached HEAD.
- [ ] Run `git push origin main`.
- [ ] Confirm push succeeded on GitHub/your remote.

### 4. Migrations — Apply Supabase schema changes

- [ ] Check `supabase/migrations/` for pending SQL files.
- [ ] **Migrations are deferred** until Supabase CLI is initialized and linked (`supabase/config.toml` exists).
- [ ] First-time setup:
  ```bash
  npx supabase init
  npx supabase login
  npx supabase link --project-ref YOUR_PROJECT_REF
  ```
- [ ] After linking, `npm run safety:backup` runs `npx supabase db push` automatically.
- [ ] If CLI is not linked, apply migrations manually in the Supabase SQL editor.
- [ ] Verify migrations ran without errors in the Supabase dashboard.

### 5. Confirmation — Ready for major changes

Before proceeding, confirm:

- [ ] Backup zip exists in `backups/`
- [ ] Git commit pushed to `origin/main`
- [ ] Database migrations applied (or consciously deferred with a plan)
- [ ] You know how to restore from backup if needed

---

## Restore From Backup

1. Stop the dev server.
2. Extract the desired zip from `backups/` to a **new folder** (do not overwrite blindly).
3. Copy `.env.local` from your secure store (backups exclude env files).
4. Run `npm install` in the restored folder.
5. Verify the app starts with `npm run dev`.

---

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success (migrations may be deferred/skipped with warnings) |
| `1` | Failure — backup, git, secret scan, branch check, or hard Supabase `db push` error |

Steps 1–3 use **fail-fast**: any error stops the script immediately. Step 4 fails only on hard `db push` errors; link/login issues are warnings.

---

## When Something Fails

| Step failed | Exit | What to do |
|-------------|------|------------|
| Backup (enumeration/zip) | `1` | Check disk space, folder permissions, and path errors in output. A failed zip writes to `.partial` and is cleaned up — no corrupt archive left behind. |
| Secret scan | `1` | Remove or `.gitignore` sensitive files (`.env*`, `*.pem`, `*.key`, private keys) before retrying. |
| Git commit | `1` | Resolve merge conflicts; review `git status --short` output. |
| Detached HEAD | `1` | Run `git checkout main` (or create/switch to `main`). |
| Not on `main` | `1` | Run `git checkout main` — script will not push other branches. |
| Git push | `1` | Check network, credentials, and branch protection rules. |
| Supabase deferred | `0` | Run `npx supabase init`, `login`, `link`; or apply SQL manually. |
| Supabase hard failure | `1` | Fix migration SQL or CLI errors; ambiguous errors fail closed (not treated as skip). |

---

## Run Exclusion Tests

```bash
npm run test:safety
```

Validates `Test-BackupExcluded` and related safety helpers via Pester.