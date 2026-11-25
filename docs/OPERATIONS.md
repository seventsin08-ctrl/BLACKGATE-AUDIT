# Operations guide

## Accounts & access
* Exactly **one** Superadmin exists (enforced by a unique database index). There is no hidden account, backdoor or undocumented access method.
* Only the Superadmin can create staff accounts (Staff Management). A temporary password is shown once and must be changed at first login.
* Staff cannot reach `/api/admin/*`; the Superadmin cannot use `/api/me/*` staff workspace data.
* Passwords: scrypt (N=16384) with per-user salt. Min 10 chars, letters + numbers, must not contain the username. Never returned by any endpoint, never shown to the Superadmin.
* Sessions: random 256-bit token, stored hashed, `HttpOnly; Secure; SameSite=Strict` cookie. Default idle timeout 120 min, absolute 12 h (Settings). Suspending an account or resetting its password revokes its sessions immediately.
* Login rate limiting: 5 failures / 15 min per username+IP, 20 per IP, 30 per username.
* Every sensitive admin action is written to *Activity Logs* (staff creation/suspension, verifications, approvals, payouts, bonuses, settings, backups, exports).

## Account recovery
* **Staff forgot password / lost 2FA:** Superadmin → Staff Management → *Reset password* (new temporary password, 2FA cleared, sessions revoked).
* **Superadmin lost 2FA device:** use one of the one-time recovery codes shown when 2FA was enabled.
* **Superadmin lost password and codes:** requires access to the Netlify account (the site owner). Set `ADMIN_INITIAL_PASSWORD` to a new temporary value and set `ADMIN_RECOVERY_RESET` to any **new** random string, then redeploy/trigger the next request. The Superadmin password is reset to that value, 2FA is cleared, all sessions revoked, a change is forced at next login and the event is logged. Remove `ADMIN_RECOVERY_RESET` afterwards. Re-using an old value does nothing.

## Backups
* Automatic: daily at 02:00 Philippine time (scheduled function), last 30 kept, stored privately in Netlify Blobs (`backups`).
* Manual: Backup and Recovery → *Back up now*; download JSON (confidential — contains hashed passwords and financial records).
* Restore: replaces all data (after an automatic *pre-restore* safety backup) and signs everyone out. Requires typing `RESTORE`.
* Backups cover all database tables except live sessions and sign-in history. Uploaded files (receipts/screenshots) are in separate private blob storage and are not copied into backup JSON files.
* Netlify Database also offers platform-level snapshots/branching; see Netlify docs for plan-specific retention.

## Deploying updates
Push to GitHub / deploy. Migrations in `netlify/database/migrations/` apply automatically before publish. **Never edit an applied migration** — add a new one. Production rows are preserved across deploys. No test data is seeded in production.

## Known limitations
* Receipt/screenshot files are limited to 4 MB (images are compressed in the browser first) and PNG/JPEG/GIF/WebP/PDF only.
* 2FA enrolment shows the setup key (no QR image) — enter it in any authenticator app.
* Browser notifications are delivered while the app is open (polling every 60 s); there is no Web Push server.
* PWA caches only the static shell for offline start; financial data and API responses are never cached offline.
* Uploaded files are not included inside backup JSON (see above).

## Environment variables apply per deploy
Netlify freezes environment variables into each deploy. After adding or changing `APP_SECRET`, `ADMIN_INITIAL_PASSWORD` or `ADMIN_INITIAL_USERNAME`, trigger a new deploy (Deploys → Trigger deploy) or push a commit. Make sure the variables are set on the **same** Netlify site that serves the app. If the sign-in page says "Setup required", a variable is missing on that site or the site has not been redeployed since it was added.
