-- 452: H&S toolbox talks / DSTI + attendance (goal Phase 2)
--
-- A toolbox talk (a.k.a. Daily Safe Task Instruction) is the pre-work safety
-- briefing a supervisor delivers to a crew. For the safety file it must record:
-- the topic, who presented, when, the attendee register, each attendee's typed
-- acknowledgement (§4.5 e-signature), and photo evidence.
--
-- Attendees are recorded by name (required); linking to a staff/team_member row
-- is optional — field crews routinely include workers in neither table, and a
-- register that could not record them would be useless. At most one link is
-- allowed (a worker is not simultaneously internal staff and a contractor's).
--
-- Idempotent. Rollback: rollback_452_hs_toolbox_talks.sql.

BEGIN;

CREATE TABLE IF NOT EXISTS hs_toolbox_talks (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        uuid REFERENCES projects(id) ON DELETE SET NULL,
  topic             varchar(200) NOT NULL,
  -- daily_dsti | weekly | toolbox (free text; UI offers the common set)
  talk_type         varchar(32) NOT NULL DEFAULT 'toolbox',
  talk_date         date NOT NULL,
  presenter_name    text,
  presenter_staff_id uuid REFERENCES staff(id) ON DELETE SET NULL,
  location          text,
  notes             text,
  -- array of VF Storage URLs for photo evidence
  photo_urls        jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by        uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS hs_toolbox_talks_project_idx ON hs_toolbox_talks (project_id);
CREATE INDEX IF NOT EXISTS hs_toolbox_talks_date_idx ON hs_toolbox_talks (talk_date);

CREATE TABLE IF NOT EXISTS hs_toolbox_attendance (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  talk_id        uuid NOT NULL REFERENCES hs_toolbox_talks(id) ON DELETE CASCADE,
  staff_id       uuid REFERENCES staff(id) ON DELETE SET NULL,
  team_member_id uuid REFERENCES team_members(id) ON DELETE SET NULL,
  worker_name    text NOT NULL,
  -- §4.5 typed e-signature captured at sign-in
  signature_name text,
  signed_at      timestamptz,
  signed_by      uuid,
  signed_ip      varchar(64),
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hs_toolbox_attendance_at_most_one_worker
    CHECK (NOT (staff_id IS NOT NULL AND team_member_id IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS hs_toolbox_attendance_talk_idx ON hs_toolbox_attendance (talk_id);

COMMIT;
