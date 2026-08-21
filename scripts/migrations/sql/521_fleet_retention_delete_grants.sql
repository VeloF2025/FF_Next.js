-- 521_fleet_retention_delete_grants.sql
--
-- Grants DELETE on the seven programme-owned PR4-7 Fleet incident tables to
-- fibreflow_user, so the retention pipeline (PR8, migration 518) can actually
-- purge identifiable data.
--
-- WHAT THIS CHANGES, PLAINLY
--
-- Until now these tables were APPEND-ONLY at the permission level: the
-- application role held SELECT and INSERT (plus UPDATE on the incident itself)
-- and DELETE on none of them. A compromised application account could add
-- evidence about a named driver; it could not destroy any. This migration ends
-- that property, in exchange for making POPIA erasure possible at all — with
-- no DELETE grant, an erasure request cannot be honoured through the
-- application by any code path.
--
-- The trade was made deliberately: the purge runs inside the Next.js app
-- (cron -> API endpoint), so the app process must hold the retention
-- credential either way. A separate database role would live in the same env
-- file, readable by the same process, and would defend only against unrelated
-- code paths deleting by accident — which the trigger below and code review
-- already cover. The genuinely stronger design is a standalone purge process
-- the web app has no credentials for; that is an architectural change, not a
-- grant, and was judged unjustified here.
--
-- WHAT STILL GUARDS THE DATA
--
-- trg_fleet_incident_purge_guard (migration 518) refuses to delete an incident
-- that is not terminal or that carries an active retention hold, and it does
-- so for psql as much as for the purge service.
--
-- Be clear about its limits: that trigger stops BUGS, not a determined
-- attacker. The application also holds UPDATE on fleet_operational_incidents,
-- so anything able to delete could first set lifecycle_status = 'dismissed'
-- and then delete. Treat the trigger as a correctness guarantee about this
-- codebase's own code paths, never as a security boundary against a
-- compromised application account.
--
-- SCOPE
--
-- Exactly the seven tables the purge deletes from
-- (src/modules/fleet/incidents/retention/incidentPurge.ts,
-- PURGE_CHILD_STATEMENTS plus PURGE_INCIDENT_STATEMENT). Deliberately NOT
-- granted here:
--   * fleet_incident_retention_holds / _hold_actions — hold history is deleted
--     only by the ON DELETE CASCADE from a legitimately purged incident, which
--     Postgres performs as the table owner and which therefore needs no grant.
--   * fleet_operational_retention_runs / _items, and
--     fleet_operational_analytics_settings — audit and configuration records
--     that outlive the data they describe.
--   * user_notifications — the purge deletes this module's bell notifications,
--     but the application already holds DELETE on it from its own migration;
--     re-granting it here would widen this migration's apparent scope for no
--     effect.
--   * Any source or master-data table. Attendance, GPS/telematics, H&S, and
--     project/site/vehicle/staff records are never deleted by retention and
--     get no grant from this file, now or later. An eighth table appearing in
--     this list is a review failure, not a convenience.
--
-- OWNERSHIP / WHO CAN APPLY THIS
--
-- All seven tables are owned by `postgres`, and GRANT requires ownership (or
-- an explicit grant option, which nothing holds on them). Production's
-- MIGRATION_DATABASE_URL connects as `postgres`, so the normal migration
-- runner CAN apply this file.
--
-- If any environment runs migrations as `migration_admin` instead, this file
-- WILL fail — that role is neither a superuser, nor an owner, nor a member of
-- `postgres` — and it fails loudly with
-- `ERROR: permission denied for table ...` / `must be owner of table ...`
-- rather than silently doing nothing. Recovery is for a DBA to run, as the
-- table owner:
--
--   psql "$MIGRATION_DATABASE_URL" -f scripts/migrations/sql/521_fleet_retention_delete_grants.sql
--
-- IDEMPOTENCY
--
-- GRANT is naturally repeatable: re-granting a privilege the role already
-- holds is a no-op and raises nothing, so this file is safe to re-run and
-- needs no IF NOT EXISTS guard (which GRANT does not support in any case).

GRANT DELETE ON
  fleet_operational_incidents,
  fleet_operational_incident_observations,
  fleet_operational_incident_actions,
  fleet_operational_incident_evidence,
  fleet_incident_driver_input_requests,
  fleet_incident_driver_submissions,
  fleet_incident_attendance_correction_links
TO fibreflow_user;
