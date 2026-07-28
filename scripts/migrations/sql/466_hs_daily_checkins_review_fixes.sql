-- 466: hs_daily_checkins hardening from blind review of PR #2273
--
-- Three gaps in 465, all found by review rather than by tests:
--
--  1. Crew rows had no per-day uniqueness, so a crew lead's double-tap (or a
--     client retry after a timeout) wrote the whole crew twice. That inflated
--     workers_checked_in / cleared / blocked in the contractor gate rollup and
--     showed each person twice on the board. Registered crew members can be
--     deduplicated exactly by team_member_id; name-only members are
--     deduplicated per (contractor, day) on the trimmed lowercased name.
--
--     The name-based index has a known, accepted cost: two genuinely different
--     people with the same name on one contractor's crew on one day will
--     collide, and the second is refused with a message telling the lead to
--     disambiguate. That is a LOUD, fixable failure; the alternative — silently
--     inflating a compliance count that a gate decision depends on — is a quiet
--     wrong answer, which is worse.
--
--  2. `activities_without_permit` was computed at write time and returned only
--     in the submitter's response, so a worker doing permit work with no permit
--     open was invisible to the H&S officer's board and to the gate. It is a
--     fact about the row and belongs on the row.
--
--  3. `checkin_date` is a SAST calendar day, but the medical/permit validity
--     checks compared against Postgres `CURRENT_DATE`, and the dev/prod session
--     timezone is UTC. Between 00:00 and 02:00 SAST those disagree by a day, so
--     a certificate that expired yesterday could still read as valid for exactly
--     the height/plant work the medical gate exists to stop. Fixed in the
--     application by passing the SAST date in; no schema change needed, recorded
--     here because it is part of the same review round.
--
-- Idempotent. Rollback: rollback_466_hs_daily_checkins_review_fixes.sql.

BEGIN;

-- 2. Store the permit finding so the board and the gate can see it.
ALTER TABLE hs_daily_checkins
  ADD COLUMN IF NOT EXISTS activities_without_permit text[] NOT NULL DEFAULT '{}';

-- 1a. Registered crew members: exact per-day uniqueness.
CREATE UNIQUE INDEX IF NOT EXISTS hs_daily_checkins_one_crew_member_per_day
  ON hs_daily_checkins (team_member_id, checkin_date)
  WHERE capture_mode = 'crew_lead' AND team_member_id IS NOT NULL;

-- 1b. Name-only crew members: per-contractor, per-day, on the normalised name.
CREATE UNIQUE INDEX IF NOT EXISTS hs_daily_checkins_one_crew_name_per_day
  ON hs_daily_checkins (contractor_id, checkin_date, lower(btrim(worker_name)))
  WHERE capture_mode = 'crew_lead' AND team_member_id IS NULL;

COMMIT;
