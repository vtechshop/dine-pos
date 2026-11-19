# MongoDB Atlas credential rotation — runbook

**Status: PREPARED, NOT EXECUTED.** To be run by an authorised Atlas project owner.
No step here was performed by the release audit.

## Why this is urgent
- A real Atlas connection string (username + password) was committed in
  `backend/migrate.js` in commit `d12cb92` and removed in `acb52cc`.
- The GitHub repository `vtechshop/dine-pos` is **public**, so the credential is
  in public history. Treat it as **compromised**: removing it from history does
  not help (clones/forks/caches may exist). Rotation is the only remedy.
- There is no evidence in the repository that it has been rotated.

Do not paste the old or new credential into tickets, chat, commits or logs.

## 0. Prepare (no impact)
1. Identify the Atlas **database user** named in the old URI (Atlas → Database
   Access). Do not copy the password anywhere.
2. List every consumer of that user: Render `dine-pos-api` (prod), Render staging,
   any local `.env` files, scripts (`migrate.js` now reads `MIGRATE_TARGET_URI`),
   CI secrets, BI/backup tools.
3. Pick a maintenance window (rotation causes a short reconnect on each instance).

## 1. Create a replacement user (zero downtime)
1. Atlas → Database Access → **Add New Database User**: new username, long random
   password (Atlas "Autogenerate"), **least privilege**: `readWrite` on the app
   database only (not `atlasAdmin`, not "any database").
2. Atlas → Network Access: confirm the IP access list contains only Render egress
   IPs / required ranges — **remove `0.0.0.0/0`** if present.

## 2. Switch consumers
1. Render → `dine-pos-api` → Environment → update `MONGODB_URI` with the new user
   (secret field, `sync: false`) → **Manual Deploy**. Wait for `/api/health/live`
   and a successful login. Repeat for staging with its **own** user/cluster.
2. Update any other consumer from step 0.2.

## 3. Revoke the old credential
1. Atlas → Database Access → **delete** the old database user (or at minimum
   change its password) once all consumers use the new one.
2. Confirm the app still works (login, create + complete an order).

## 4. Investigate exposure
1. Atlas → Project → **Activity Feed** and **Database Access History** (and
   cluster logs if available): look for connections by the old user from unknown
   IPs since the commit date of `d12cb92`.
2. Check data for unexpected changes (new admin users, mass updates, dropped
   collections). Atlas → Backup: confirm snapshots exist from before any
   suspicious access.
3. If unauthorised access is found: follow `docs/disaster-recovery.md` (security
   incident), notify affected restaurants as required, consider restoring.

## 5. Prevent recurrence
- Enable GitHub **secret scanning / push protection** on the repository.
- Keep `migrate.js` requiring `MIGRATE_TARGET_URI` (+ explicit confirmation flag).
- Consider making the repository private if it is not meant to be public.
- Optional: purge history with `git filter-repo` — only together with rotation,
  requires a force-push and coordination with every clone (explicit approval).

## TLS
Connections use `mongodb+srv://` (TLS on by default). No TLS-weakening options
(`tlsAllowInvalidCertificates`, `tlsInsecure`, `rejectUnauthorized:false`) exist
in the repository. The **deployment environment** (Render env vars) could not be
inspected from here and must be checked for `NODE_TLS_REJECT_UNAUTHORIZED=0`; the
audit machine's own shell had it set — it must not be set on servers.

## Sign-off
| Step | Done by | Date | Notes |
|------|---------|------|-------|
| 1 New user | | | |
| 2 Consumers switched | | | |
| 3 Old user revoked | | | |
| 4 Access history reviewed | | | |
