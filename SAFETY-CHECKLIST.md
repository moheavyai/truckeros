# Safety Checklist — Before Major Changes

Use this checklist before refactors, schema changes, dependency upgrades, or any work that could break production.

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
- [ ] Confirm `.env*` files are **not** inside the zip (security).

**Excluded from backups:** `node_modules`, `.next`, `.git`, `backups/`, `out`, `build`, `.vercel`, cache dirs, and `.env*`.

### 2. Commit — Save current work to git

- [ ] Run `git status` and review what will be committed.
- [ ] Stage and commit with a clear message, e.g. `chore: safety backup YYYY-MM-DD_HHMMSS`.
- [ ] If there are no changes, skip commit (the script does this automatically).

### 3. Push — Remote safety copy on `main`

- [ ] Run `git push origin main` (or your current branch if not on `main`).
- [ ] Confirm push succeeded on GitHub/your remote.

### 4. Migrations — Apply Supabase schema changes

- [ ] Check `supabase/migrations/` for pending SQL files.
- [ ] If Supabase CLI is set up:
  ```bash
  npx supabase login
  npx supabase link --project-ref <your-project-ref>
  npx supabase db push
  ```
- [ ] If CLI is **not** linked yet (no `supabase/config.toml`):
  - Run `npx supabase init` once, then link your project.
  - Or apply migrations manually in the Supabase SQL editor.
- [ ] Verify migrations ran without errors in the Supabase dashboard.

### 5. Confirmation — Ready for major changes

Before proceeding, confirm:

- [ ] Backup zip exists in `backups/`
- [ ] Git commit pushed to remote
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

## First-Time Supabase CLI Setup

This repo has `supabase/migrations/` but may not have `supabase/config.toml` until initialized:

```bash
npx supabase init
npx supabase login
npx supabase link --project-ref <your-project-ref>
```

After linking, `npm run safety:backup` will run `npx supabase db push` automatically.

---

## When Something Fails

| Step failed | What to do |
|-------------|------------|
| Backup | Check disk space and `backups/` folder permissions. |
| Git commit | Resolve merge conflicts or unstaged secrets before retrying. |
| Git push | Check network, credentials, and branch protection rules. |
| Supabase push | Run `npx supabase login` and `npx supabase link`; apply SQL manually if needed. |

The script uses **fail-fast** behavior: backup/git errors stop the run immediately. Supabase issues show clear warnings when the project is not linked.