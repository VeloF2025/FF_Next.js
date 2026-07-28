-- 465: daily site H&S check-in
--
-- Everyone on site declares fitness for duty, PPE and hazards once a day from
-- the /my portal, and that declaration feeds the H&S module's daily surfaces
-- and the contractor compliance gate.
--
-- Shape decisions (Hein, 2026-07-27/28), each recorded because none is obvious
-- from the schema alone:
--
--  * GRADUATED TEETH. A check-in never blocks recording paid time — it blocks
--    H&S *clearance*. Self-declared unfit blocks; a missing/expired medical
--    blocks only when a height/plant activity is declared; PPE gaps and
--    hazards are recorded and alerted, not blocked. Encoded below as
--    hs_daily_checkins_unfit_not_cleared so the invariant cannot be bypassed
--    by a handler bug.
--
--  * TWO CAPTURE MODES. Velocity staff declare for themselves ('self').
--    Subcontractor crews are captured by their team lead in one submission
--    ('crew_lead'), which is the only way to reach workers who have no phone
--    and exist in neither `staff` nor `team_members` — hence worker_name is
--    NOT NULL and is the sole identity for those rows, mirroring how
--    hs_toolbox_attendance already records a signed-for attendee.
--
--  * ACTIVITY, NOT ROLE. The medical gate keys off what the worker declares
--    they are doing TODAY (declared_activities, using the hs_permit_types
--    vocabulary plus plant_operation), not a static role. `staff.role` has no
--    height/plant concept, and a static flag is wrong precisely on the
--    occasional day someone works at height.
--
--  * PROJECT IS SELECTED, GPS IS ALWAYS CAPTURED. There is no reliable
--    automatic project signal today (fleet_authorized_locations is empty, so
--    attendance geofencing is inert; staff_projects covers 7 of 81 people).
--    Storing the coordinates means a later site->project map can both
--    backfill site_match_id and flag rows whose selection disagrees with
--    where the phone actually was.
--
-- contractor_id NULL = Velocity-internal worker. It is REQUIRED for crew_lead
-- rows: computeContractorDailyCheckinSummary aggregates by contractor, so a
-- crew row without one silently never reaches the gate it exists to feed
-- (the same defect fixed for medicals in PR #2269).
--
-- Idempotent. Rollback: rollback_465_hs_daily_checkins.sql.

BEGIN;

CREATE TABLE IF NOT EXISTS hs_daily_checkins (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- SAST calendar day, supplied by the app via sastWorkDate() — never a UTC
  -- DATE literal, which would bucket early-morning check-ins to the wrong day.
  checkin_date          date NOT NULL,
  project_id            uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  -- NULL = Velocity-internal worker; required for crew_lead (enforced below)
  contractor_id         uuid REFERENCES contractors(id) ON DELETE SET NULL,

  -- Worker identity. At most one reference; crew members may have neither,
  -- in which case worker_name is all we have (and the medical check cannot
  -- be verified — surfaced as a warning, never a silent pass).
  staff_id              uuid REFERENCES staff(id) ON DELETE CASCADE,
  team_member_id        uuid REFERENCES team_members(id) ON DELETE CASCADE,
  worker_name           text NOT NULL,

  capture_mode          varchar(16) NOT NULL,
  -- groups the rows created by one crew-lead submission
  submission_id         uuid NOT NULL,
  submitted_by_staff_id uuid REFERENCES staff(id) ON DELETE SET NULL,
  signature_name        text,
  signed_at             timestamptz,

  -- ---- the declaration ----
  fit_for_duty          boolean NOT NULL,
  ppe_complete          boolean NOT NULL,
  -- hs_permit_types codes + 'plant_operation'; drives the medical gate
  declared_activities   text[] NOT NULL DEFAULT '{}',
  hazard_reported       text,

  -- ---- the outcome ----
  clearance             varchar(20) NOT NULL,
  blocked_reasons       text[] NOT NULL DEFAULT '{}',
  -- set only when an H&S officer overrides a block
  cleared_by            uuid REFERENCES users(id) ON DELETE SET NULL,
  cleared_at            timestamptz,
  clearance_note        text,

  -- ---- context ----
  gps_lat               numeric(10,7),
  gps_lon               numeric(10,7),
  -- stays NULL until fleet_authorized_locations is populated and mapped
  site_match_id         uuid,
  -- soft link: the check-in is written AFTER the clock-in succeeds and must
  -- never be able to fail it, so this is nullable and un-constrained
  attendance_entry_id   uuid,
  risk_register_id      uuid REFERENCES hs_risk_register(id) ON DELETE SET NULL,

  created_by            uuid,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT hs_daily_checkins_capture_mode_check
    CHECK (capture_mode IN ('self', 'crew_lead')),
  CONSTRAINT hs_daily_checkins_clearance_check
    CHECK (clearance IN ('cleared', 'blocked', 'cleared_by_override')),
  CONSTRAINT hs_daily_checkins_worker_name_not_blank
    CHECK (btrim(worker_name) <> ''),
  -- at most one structured worker reference
  CONSTRAINT hs_daily_checkins_single_worker_ref
    CHECK ((staff_id IS NOT NULL)::int + (team_member_id IS NOT NULL)::int <= 1),
  -- a self-declaration is always by a known /my user
  CONSTRAINT hs_daily_checkins_self_requires_staff
    CHECK (capture_mode <> 'self' OR staff_id IS NOT NULL),
  -- without a contractor a crew row never reaches the gate it exists to feed
  CONSTRAINT hs_daily_checkins_crew_requires_contractor
    CHECK (capture_mode <> 'crew_lead' OR contractor_id IS NOT NULL),
  -- the teeth: an unfit worker is never 'cleared' (an override is explicit)
  CONSTRAINT hs_daily_checkins_unfit_not_cleared
    CHECK (fit_for_duty OR clearance <> 'cleared'),
  -- an override must name who made it
  CONSTRAINT hs_daily_checkins_override_needs_clearer
    CHECK (clearance <> 'cleared_by_override' OR cleared_by IS NOT NULL)
);

-- One self-declaration per person per day. Crew rows are deliberately excluded:
-- an unregistered worker has no stable id to deduplicate on.
CREATE UNIQUE INDEX IF NOT EXISTS hs_daily_checkins_one_self_per_day
  ON hs_daily_checkins (staff_id, checkin_date)
  WHERE capture_mode = 'self';

-- A crew lead cannot list the same name twice in one submission.
CREATE UNIQUE INDEX IF NOT EXISTS hs_daily_checkins_crew_name_unique
  ON hs_daily_checkins (submission_id, lower(btrim(worker_name)));

-- The today board and the contractor rollup both read (date, project) and
-- (date, contractor); the partial index serves the "who is still blocked" view.
CREATE INDEX IF NOT EXISTS hs_daily_checkins_date_project_idx
  ON hs_daily_checkins (checkin_date, project_id);
CREATE INDEX IF NOT EXISTS hs_daily_checkins_date_contractor_idx
  ON hs_daily_checkins (checkin_date, contractor_id);
CREATE INDEX IF NOT EXISTS hs_daily_checkins_blocked_idx
  ON hs_daily_checkins (checkin_date, project_id)
  WHERE clearance = 'blocked';
CREATE INDEX IF NOT EXISTS hs_daily_checkins_submission_idx
  ON hs_daily_checkins (submission_id);

COMMIT;
