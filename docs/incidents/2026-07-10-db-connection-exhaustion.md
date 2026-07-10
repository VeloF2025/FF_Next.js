# Incident: production DB connection-slot exhaustion (2026-07-10)

## Summary
Around **10:40–10:46 SAST** the production app returned 500s and `/api/health`/
`/api/cron/db-health` returned 503 — it *looked* down. The Next.js process never
crashed (systemd showed no restart); it recovered on its own once a few DB
connection slots freed up. Root cause: **Postgres `max_connections = 200` was
exhausted**, so the app (connecting as non-superuser `fibreflow_user`) could not
open new connections.

## Root cause
`next build` spawns ~30 `jest-worker` child processes for static generation, and
each imports `@/lib/db`. The pool was configured with **`min: 1`** and an **eager
warm-up** (`pool.connect()` on import). `idleTimeoutMillis` never evicts below the
`min` floor, so **every build worker permanently held one `fibreflow_user`
connection**, and the open socket kept the worker alive so it never self-exited.
When a build finished (or was killed) the workers were orphaned but kept their
connections.

Because `PORT` is unset during a build, all of these were tagged with the fallback
`application_name` **`ff-pg-app`**. At incident time there were **146 orphaned
`jest-worker` processes == 146 idle `ff-pg-app` connections** (idle 1–3.5 days),
opened in bursts of ~30 that map 1:1 to build events:

| When (SAST) | Source | Leaked conns |
|---|---|---|
| Jul 6 ~20:45 | a `deploy-local.sh dev` build (`/home/velo/fibreflow-dev`) | 86 |
| Jul 9 ~08:20 / ~08:47 | health-check rebuilds (`/tmp/fibreflow-health-rebuild-*`) | 60 |

Since **dev and prod share one database**, a *dev* build leak took down *production*.
The recurring trigger is `/home/velo/scripts/fibreflow-health-check-v2.sh` (cron
`*/15`), whose `_buildManifest.js` BUILD_ID check false-positives and triggers a
throwaway `next build` in `/tmp`, leaking ~30 connections each time — a vicious
cycle, because a saturated DB makes the app look unhealthy and triggers *more*
rebuilds.

## Fixes in this PR
1. **`src/lib/db.ts` — build-phase guard.** When `NEXT_PHASE === 'phase-production-build'`,
   use `min: 0` and skip the warm-up, so build workers hold no connection floor.
   Any residual build-time query is tagged `ff-pg-build` for instant diagnosis.
   Covered by `src/lib/__tests__/db.test.ts`.
2. **Migration 440 — `idle_session_timeout` backstop.** `ALTER ROLE fibreflow_user
   SET idle_session_timeout = '30min'` so any future leak of this class self-heals
   instead of piling up over days.

## Required server-side follow-ups (NOT in this repo)
`/home/velo/scripts/fibreflow-health-check-v2.sh` is not version-controlled. Apply
(as user `velo`):
- **Trap glob mismatch:** the cleanup trap globs `fibreflow-health-check-rebuild-*`
  but `mktemp` creates `fibreflow-health-rebuild-*` — so `/tmp` build dirs never get
  cleaned. Align the two names.
- **Reap build workers:** after the rebuild step, ensure the `next build` process
  group is fully terminated (e.g. run it in its own process group and kill the group
  on exit) so orphaned `jest-worker` children can't linger.
- **BUILD_ID false-positive:** the `_buildManifest.js` check flags healthy builds as
  broken (see `feedback_nextjs_build_id_monitor_false_positive`). Make it tolerant
  (retry / compare against the running service's BUILD_ID) so it stops triggering
  needless rebuilds. With the code fix above these rebuilds no longer leak, but they
  still waste CPU and restart the service.

## Recovery runbook (when you choose to clear the live saturation)
The code fix prevents *new* leaks; the 146 existing zombies must be cleared once.
Prefer killing the orphaned processes (removes the source) — **by explicit PID
only, never `pkill -f node` (that kills unrelated node processes, including Claude).**

```bash
# 1. List the orphaned next-build jest-workers (the leakers):
ps -eo pid,ppid,etime,cmd | grep 'jest-worker/processChild' | grep -v grep
#    Confirm etime is in DAYS (stale) and no deploy is currently running, then:
#    kill <pid> <pid> ...        # explicit PIDs from the list above

# 2. Verify slots freed (as supabase_admin — the real superuser; `postgres` is not):
#    docker exec supabase-db psql -U supabase_admin -d postgres \
#      -c "select application_name, count(*) from pg_stat_activity \
#          where usename='fibreflow_user' group by 1 order by 2 desc;"
```

Alternatively, terminate the stale backends directly (as `supabase_admin`):
```sql
SELECT pg_terminate_backend(pid) FROM pg_stat_activity
 WHERE application_name = 'ff-pg-app' AND state = 'idle'
   AND state_change < now() - interval '1 hour';
```

## Diagnosis reference
- App up but `/api/health` returns 503 + DB-backed routes 500, and a fresh `psql`
  fails with `FATAL: remaining connection slots are reserved…` → connection-slot
  exhaustion, not an app crash.
- Break down holders: `pg_stat_activity` grouped by `usename, application_name, state`.
  `ff-pg-app` = a `PORT`-unset (build/CLI) process; `ff-pg-3000/3005` = the live
  dev/prod web services.
