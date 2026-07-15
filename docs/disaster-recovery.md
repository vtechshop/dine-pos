# Disaster Recovery Runbook — Dine POS

## Services Overview

| Service | Platform | URL pattern |
|---------|----------|-------------|
| Backend API | Render.com | `dine-pos-api.onrender.com` |
| Database | MongoDB Atlas | `cluster0.xxxxx.mongodb.net` |
| Cache / Pub-Sub | Upstash Redis | `xxxxx.upstash.io` |
| CDN / File upload | Cloudinary | `res.cloudinary.com` |
| Error tracking | Sentry | `sentry.io/organizations/…` |

---

## Scenario 1 — Backend API is down (Render service crashed)

**Detection:** `/api/health` returns non-200 or is unreachable; mobile apps show "Server unreachable".

1. Open Render dashboard → `dine-pos-api` → **Logs** tab.
2. If the last deploy caused the crash, click **Manual Deploy** → select the previous commit hash.
3. If the service is OOM-killed (memory > 90 % in Metrics): increase `plan` in `render.yaml` from `standard` to `pro`, push, redeploy.
4. If startup fails with `❌ FATAL: …is not set`: check **Environment** tab — add the missing env var, then **Manual Deploy**.
5. Confirm recovery: `curl https://dine-pos-api.onrender.com/api/health` returns `{"status":"OK"}`.

**RTO target:** < 10 minutes (Render redeploy takes ~3–5 min).

---

## Scenario 2 — MongoDB Atlas is unavailable

**Detection:** `/api/health` returns `{"status":"DEGRADED","mongodb":"disconnected"}`; all write operations fail.

1. Open Atlas → **Clusters** → check cluster status (maintenance window? region outage?).
2. If Atlas is healthy, check `MONGODB_URI` env var on Render for typos (rotate credentials if suspected breach).
3. If Atlas is down region-wide: initiate a **cluster pause/resume** cycle to force a failover to a secondary replica. Atlas M10+ clusters have automatic failover in ~30 s.
4. If data loss is suspected (e.g. accidental `db.dropDatabase()`): restore from Atlas **Continuous Cloud Backup** — navigate to Cluster → **Backup** → **Restore** → select point-in-time (max 24 h ago for M10+).
5. After restore: all `RefreshToken` documents written after the restore point are lost. Affected admins must log in again.

**RPO:** Last backup snapshot (Atlas continuous backup ≈ 1-hour granularity on M10+).
**RTO:** ~20–40 minutes for point-in-time restore.

---

## Scenario 3 — Redis is unavailable (Upstash)

**Detection:** Rate limiters fall back to in-memory (no data loss). Socket.IO pub-sub falls back to single-instance mode (multi-instance setups will not share events). `/api/health` shows `redis: "error"`.

**Impact:** Low — the app continues to work. Rate limits become per-instance (weaker enforcement). Real-time order broadcasts may not reach all instances.

1. Open Upstash dashboard → check service status.
2. If quota exceeded: upgrade the Upstash plan.
3. If `REDIS_URL` rotated: update the env var in Render and redeploy.
4. No data migration needed — Redis is a cache; state is always backed by MongoDB.

**RTO:** Near-zero (fallback is automatic). Redis restoration is < 5 minutes.

---

## Scenario 4 — Accidental data deletion (orders, hotels, products)

1. **Stop writes immediately:** suspend the affected hotel in the super-admin dashboard to prevent further mutations.
2. **Atlas Point-in-Time Restore** (see Scenario 2, step 4) to a point before the deletion.
3. If a single hotel's data was deleted (not a cluster-wide event): export the restored documents using `mongodump --collection=orders --query='{"hotelId":"<id>"}'` and import into production using `mongorestore`.
4. **After any restore:** clear the Redis hotel-status cache for the affected hotel:
   ```
   redis-cli DEL hotel:status:<hotelId>
   ```
5. Notify affected hotel owner; offer a reconciliation window if POS receipts are available locally on their device.

---

## Scenario 5 — JWT_SECRET or SUPER_ADMIN_PASS compromised

1. **Rotate the secret immediately** in Render → Environment → update value → **Manual Deploy**.
2. All existing JWTs signed with the old secret are instantly invalidated. All admin sessions will receive 401 and must log in again. This is the intended behavior.
3. All `RefreshToken` records in MongoDB are now useless (they were rotated alongside the JWT). Users must log in from scratch.
4. For `SUPER_ADMIN_PASS`: update the value and re-deploy. No database migration needed.
5. Audit the Render access log and Sentry for any suspicious super-admin calls in the past 24 hours.

---

## Scenario 6 — Mobile app OTA update causes a crash (expo-updates)

**Detection:** Users report crash on launch after an OTA update.

1. Open EAS dashboard → **Updates** → find the bad update.
2. Click **Rollback** to re-publish the previous update to the `production` channel.
3. Users will receive the rollback on next app launch (or within 5 minutes if `checkAutomatically: ON_LOAD`).
4. If rollback is insufficient: publish a hotfix build via `eas build --platform all --profile production` and submit to stores.

---

## Contacts & Escalation

| Role | Responsible party |
|------|-------------------|
| Backend / infra | [Your name / team] |
| Database (Atlas) | MongoDB Atlas Support — `support.mongodb.com` |
| Render platform | Render Support — `render.com/support` |
| App stores | Apple / Google Play consoles |

---

## Recovery Checklist

- [ ] Identify affected service (API / DB / Redis / app)
- [ ] Check status pages (Render, Atlas, Upstash)
- [ ] Check Render logs for startup errors
- [ ] Check Sentry for error spikes
- [ ] Restore from backup if data loss occurred
- [ ] Clear Redis cache after any database restore
- [ ] Rotate secrets if breach is suspected
- [ ] Notify affected hotel owners
- [ ] Post-mortem: document root cause and add monitoring alert to prevent recurrence
