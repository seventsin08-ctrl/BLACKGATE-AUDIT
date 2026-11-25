# BlackGate Audit

Internal workforce operating system for BlackGate: staff workspace + Superadmin Control Center
(tasks, notes, platforms, posting, clients, payments, commissions, daily audits, rankings, backups).

* **Frontend:** dependency-free ES modules in `public/` (no build step). Installable PWA, light/dark, 320px+.
* **Backend:** Netlify Functions (`netlify/functions/api.mjs` → `server/`), scheduled job `cron.mjs` (hourly).
* **Database:** Netlify Database (managed Postgres, provisioned with the site). Schema lives in `netlify/database/migrations/` and is applied automatically on deploy. Production data is never touched by deploys.
* **Private files:** receipts / screenshots / backups live in Netlify Blobs, served only through authorised API calls.

> GitHub holds **source code only**. No staff data, client data, credentials or backups are ever committed.

## Two interfaces
| Path | Who | Notes |
|---|---|---|
| `/` | everyone | sign-in, forced password change, optional 2FA code |
| `/app/` | staff | dashboard, tasks, notes, add post, clients, daily audit, earnings, platforms |
| `/admin/` | Superadmin only | Control Center (16 sections). Enforced **server-side** on every `/api/admin/*` call |

## Business rules (all enforced on the server, see `server/services.mjs`)
* Commission = **verified initial payment × rate** (default 10%, editable in Settings; each commission keeps the rate it was created with).
* Commission stays **locked** until verified payments cover the full project price → **eligible** → Superadmin **approves** → Superadmin records **payout** (released).
* Staff cannot verify payments or approve/release anything; admin-only routes return 403 for staff.
* Tips and bonuses are separate from project payments and never affect commissions.
* Duplicate post links (normalised, across all staff) are stored as `duplicate` and never count. Rankings count only verified posts, confirmed clients, verified project payments, submitted/approved audits and verified official tasks.

## Setup (once)
Set these in **Netlify → Site configuration → Environment variables** (scope: Functions; mark as *secret*). Never commit them.

| Variable | Purpose |
|---|---|
| `APP_SECRET` | ≥ 24 random chars. Encrypts 2FA secrets. Changing it disables existing 2FA enrolments. |
| `ADMIN_INITIAL_PASSWORD` | Temporary Superadmin password. Used only to create the account (and for the documented recovery reset). |
| `ADMIN_INITIAL_USERNAME` | Optional, default `admin`. |

`GET /api/health` reports `setup_required` and what is missing instead of failing silently.

### First login (important)
1. Deploy, then **sign in immediately** as the Superadmin with the temporary password.
2. You are forced to set a new password before anything else is accessible.
3. Optionally enable 2FA in *Settings → Your account & security* and store the recovery codes.

Until the temporary password is changed, anyone who knows it and the URL could claim the account — change it right away, then remove/rotate `ADMIN_INITIAL_PASSWORD` if you wish (it is only needed again for recovery).

See [docs/OPERATIONS.md](docs/OPERATIONS.md) for recovery, backups, restore and limitations.

## Local development & tests
```bash
npm install
npm test                       # 22 API integration tests on a real throwaway Postgres
node scripts/dev-server.mjs    # local UI at http://localhost:8888 (admin / Temp-Pass-1, throwaway DB)
node tests/e2e.mjs             # Playwright browser checks (needs `playwright`; run against the dev server)
```
