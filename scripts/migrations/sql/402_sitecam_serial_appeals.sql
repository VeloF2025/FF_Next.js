-- scripts/migrations/sql/402_sitecam_serial_appeals.sql
-- Adds serial scan tracking columns to dr_photo_unified_reviews.
-- ont_serial_scanned / ups_serial_scanned already exist (from migration 033, table creation).
-- We add attempt counters and status for the PWA 3-strike logic.

ALTER TABLE dr_photo_unified_reviews
  ADD COLUMN IF NOT EXISTS ont_serial_attempts  smallint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ont_serial_status    text CHECK (ont_serial_status IN ('pending','pass','fail','locked')),
  ADD COLUMN IF NOT EXISTS ups_serial_attempts  smallint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ups_serial_status    text CHECK (ups_serial_status IN ('pending','pass','fail','locked'));

-- Appeal records: one row per appeal submission from a technician.
-- technician_id references staff(id): the /my PWA session carries staff_id (staff.id),
--   NOT users.id (see migration 320). The submit handler inserts session.staffId.
-- decided_by references users(id): the reviewer authenticates via withAuth (users.id).
CREATE TABLE IF NOT EXISTS sitecam_appeals (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  dr_number        text        NOT NULL,
  step_number      smallint    NOT NULL,
  technician_id    uuid        NOT NULL REFERENCES staff(id),
  appeal_text      text        NOT NULL,
  photo_url        text        NOT NULL,
  serial_scanned   text,
  serial_expected  text,
  attempt_number   smallint    NOT NULL,
  status           text        NOT NULL DEFAULT 'pending'
                               CHECK (status IN ('pending','approved','denied')),
  decided_by       uuid        REFERENCES users(id),
  decided_via      text        CHECK (decided_via IN ('whatsapp','in_app')),
  decided_at       timestamptz,
  denial_reason    text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- Self-heal: an earlier revision of this migration created technician_id with a FK to
-- users(id). That is wrong — session.staffId is a staff.id, and staff/users ids do not
-- overlap, so every appeal INSERT would FK-fail. Repoint any such constraint at staff(id)
-- so already-provisioned databases match fresh installs. Safe: the table is empty wherever
-- the wrong FK was applied (the feature was never functional under it).
DO $$
DECLARE
  v_constraint text;
BEGIN
  SELECT tc.constraint_name INTO v_constraint
  FROM information_schema.table_constraints tc
  JOIN information_schema.constraint_column_usage ccu
    ON ccu.constraint_name = tc.constraint_name
  JOIN information_schema.key_column_usage kcu
    ON kcu.constraint_name = tc.constraint_name
  WHERE tc.table_name = 'sitecam_appeals'
    AND tc.constraint_type = 'FOREIGN KEY'
    AND kcu.column_name = 'technician_id'
    AND ccu.table_name = 'users'
    AND ccu.column_name = 'id';

  IF v_constraint IS NOT NULL THEN
    EXECUTE format('ALTER TABLE sitecam_appeals DROP CONSTRAINT %I', v_constraint);
    ALTER TABLE sitecam_appeals
      ADD CONSTRAINT sitecam_appeals_technician_id_fkey
      FOREIGN KEY (technician_id) REFERENCES staff(id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS sitecam_appeals_dr_step
  ON sitecam_appeals(dr_number, step_number);
CREATE INDEX IF NOT EXISTS sitecam_appeals_pending
  ON sitecam_appeals(status) WHERE status = 'pending';
