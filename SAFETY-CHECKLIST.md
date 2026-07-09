# Safety Checklist — Before Major Changes

Use this checklist before refactors, schema changes, dependency upgrades, or any work that could break production.

## Prerequisites

| Requirement | Notes |
|-------------|-------|
| **Windows PowerShell 5.1+** | Script uses `#Requires -Version 5.1` |
| **Execution policy** | `npm run safety:backup` uses `-ExecutionPolicy Bypass` so scripts run reliably on Restricted policy machines |
| **Git** | On PATH; repository initialized with `main` branch |
| **Node.js + npm** | Required for `npm run safety:backup` and Supabase CLI via `npx` |
| **Branch `main` checked out** | Script fails if on another branch or detached HEAD |
| **Pester 3.4+** (optional) | For `npm run test:safety` (compatible with built-in Windows Pester 3.x) |

## One-Command Safety Run

From the project root:

```bash
npm run safety:backup
```

This runs `scripts/backup-and-push.ps1` and performs backup → commit → push → migrations (when linked).

### Expected output (success)

```
  [OK] Project root: C:\...\truckeros

==> Step 1/4: Create zip backup
  [OK] Backup created: backups/truckeros-backup-YYYY-MM-DD_HHMMSS.zip (N files, X.XX MB)

==> Step 2/4: Git commit
  [SKIP] No changes to commit.          # or [OK] Committed: chore: safety backup ...

==> Step 3/4: Git push to main
  [OK] Pushed to origin/main.

==> Step 4/4: Supabase migrations
  [WARN] supabase/config.toml not found - db push not attempted.
  [WARN] Step 4 attempts migrations only when CLI is initialized and linked (expected until first-time setup).

========================================
  Safety backup workflow complete
========================================
  Command   : npm run safety:backup
  Step 1    : created (...)
  Step 2    : skipped (clean working tree)
  Step 3    : pushed to origin/main
  Step 4    : deferred (expected until init/login/link)
  Confirm   : Complete SAFETY-CHECKLIST.md step 5 before major changes
```

**Note:** Step 4 showing `deferred` is **expected** until you run `npx supabase init`, `login`, and `link`. Exit code is still `0`.

---

## Manual Step-by-Step (granular control)

Use these when you want to run individual steps without the full npm script.

### 1. Backup — Create a timestamped zip manually

- [ ] Confirm project root (`package.json` present).
- [ ] Create `backups/` if missing.
- [ ] Zip the project **excluding** heavy/cache dirs (see list below).
- [ ] Name it `truckeros-backup-YYYY-MM-DD_HHMMSS.zip`.

PowerShell example (manual, not identical to script pruning):

```powershell
$ts = Get-Date -Format "yyyy-MM-dd_HHmmss"
Compress-Archive -Path app,lib,agents,supabase,package.json -DestinationPath "backups/truckeros-backup-$ts.zip"
```

Prefer `npm run safety:backup` for the full pruned/atomic backup.

**Excluded directories** (pruned during script walk):

`node_modules`, `.next`, `.git`, `backups`, `out`, `build`, `.vercel`, `__pycache__`, `.pytest_cache`, `.venv`, `dist`, `coverage`, `.turbo`, `.pnp`, `agent-tools`, `.supabase`

**Excluded file patterns:** `.env*`, `*.env`, `*.pem`, `*.key`, `*.p12`, `*.pfx`, `*.crt`, `*.cer`, `id_rsa`, `id_rsa.pub`, `id_ed25519`, `id_ed25519.pub`, `credentials.json`, `secrets.json`, `production.env`, `.npmrc`

### 2. Commit — Save current work to git

- [ ] `git status` — review changes.
- [ ] `git add -A`
- [ ] `git commit -m "chore: safety backup YYYY-MM-DD_HHMMSS"`
- [ ] Skip if working tree is clean.

The automated script also prints `git status --short` and scans for secrets before staging.

### 3. Push — Remote safety copy on `main`

- [ ] `git checkout main` (required — script refuses other branches / detached HEAD).
- [ ] `git push origin main`
- [ ] Confirm on remote.

### 4. Migrations — Apply Supabase schema changes

- [ ] **Attempts `db push` only when `supabase/config.toml` exists** and CLI is linked.
- [ ] Until then, deferral is **expected** — not a failure.
- [ ] First-time setup:
  ```bash
  npx supabase init
  npx supabase login
  npx supabase link --project-ref YOUR_PROJECT_REF
  ```
- [ ] Then `npx supabase db push` (or re-run `npm run safety:backup`).
- [ ] Manual fallback: Supabase SQL editor.

### 5. Confirmation — Ready for major changes

- [ ] Backup zip exists in `backups/`
- [ ] Git commit pushed to `origin/main`
- [ ] Migrations applied **or** consciously deferred with a plan
- [ ] Restore procedure understood (below)

---

## Restore From Backup

1. Stop the dev server and any background services (`or-tools-service`, etc.).
2. Extract the desired zip from `backups/` to a **new folder** (do not overwrite blindly).
3. Copy secrets from your secure store (backups exclude `.env*`, keys, `secrets.json`):
   - `.env.local` (Next.js / Supabase)
   - `or-tools-service/.env` or `.env.local` if you use the Python solver
4. Reinstall dependencies:
   ```bash
   npm install
   cd or-tools-service
   python -m venv .venv
   .venv\Scripts\activate
   pip install -r requirements.txt
   ```
5. Verify services:
   ```bash
   npm run dev
   # optionally: start or-tools-service per or-tools-service/README.md
   ```

---

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success — migrations may show `deferred` until CLI is linked (expected) |
| `1` | Failure — backup enumeration/zip, git, secret scan, branch check, or hard Supabase `db push` error |

Steps 1–3 fail-fast. Step 4 defers gracefully when CLI is not set up; hard migration errors exit `1`.

---

## When Something Fails

| Step failed | Exit | What to do |
|-------------|------|------------|
| Backup enumeration | `1` | Fix permissions/path errors listed in output; script fails if any enumeration error occurs. |
| Backup zip finalize | `1` | Check disk space; `.partial` file is cleaned up on rename failure. |
| Secret scan (findings) | `1` | Remove or `.gitignore` sensitive files before retrying. |
| Secret scan (unreadable file) | `0` | Warning only — commit continues. |
| Git commit | `1` | Resolve merge conflicts; review `git status --short`. |
| Detached HEAD | `1` | `git checkout main` |
| Not on `main` | `1` | `git checkout main` |
| Git push | `1` | Check network, credentials, branch protection. |
| Supabase deferred | `0` | Expected until `init` / `login` / `link`; apply SQL manually if needed. |
| Supabase hard failure | `1` | Fix migration SQL or CLI errors. |

---

## Run Safety Tests

```bash
npm run test:safety
```

Validates backup exclusions, git path parsing, and secret-scan helpers via Pester.