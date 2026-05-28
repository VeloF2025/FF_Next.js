-- Migration 387: Serial lifecycle state machine (Sprint E)
-- Spec: docs/superpowers/specs/2026-05-28-serial-lifecycle-state-machine-sprintE-design.md
-- Replaces per-source emit triggers (mig 365/366/367) with one generic
-- status-validate + status-emit + holder-validate pair on stock_serials.
-- pre_provision remains an overlay (pp_flagged + pp_resolution_status, mig 312).

BEGIN;

-- 0. Cutover atomicity gate. See "Cutover atomicity contract" in the plan.
--    The shared dev+prod DB means this migration affects production the
--    moment it runs. Without a marker table proving every L4 caller has been
--    refactored through promoteSerial, this RAISE EXCEPTION aborts the txn
--    and the schema stays untouched.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_tables
     WHERE schemaname = 'public'
       AND tablename  = '__sprint_e_cutover_gate__'
  ) THEN
    RAISE EXCEPTION
      'mig 387 cannot run until __sprint_e_cutover_gate__ marker table exists. '
      'Create it manually as the first step of docs/runbooks/sprint-e-cutover.md, '
      'AFTER scripts/verify-no-direct-status-writes.ts exits 0 against origin/master HEAD.';
  END IF;
END$$;

-- 1. Widen the status CHECK to the 8-value vocabulary.
--    Drops `reserved`, `in_transit`, `in_repair` from acceptable values; the
--    backfill task (Track 5) maps `available` → `in_stock` first, so the
--    CHECK widening can be done before the rename in the same txn.
ALTER TABLE stock_serials
  DROP CONSTRAINT IF EXISTS stock_serials_status_check;
ALTER TABLE stock_serials
  ADD CONSTRAINT stock_serials_status_check
  CHECK (status IN (
    'available',                -- legacy, retained until backfill renames to in_stock
    'in_stock',
    'allocated_to_project',
    'issued',
    'installed',
    'activated',
    'faulty',
    'returned',
    'scrapped'
  ));

-- 2. Transition matrix table.
--    Sentinel '__new__' represents the INSERT case (no prior row). Using a
--    sentinel rather than NULL because Postgres forces PK columns to NOT NULL;
--    a nullable PK would fail at CREATE TABLE time.
CREATE TABLE stock_serial_status_transitions (
  from_state    varchar(50)   NOT NULL,     -- '__new__' for INSERT (no prior row)
  to_state      varchar(50)   NOT NULL,
  event_type    varchar(50)   NOT NULL,
  description   text,
  PRIMARY KEY (from_state, to_state)
);

INSERT INTO stock_serial_status_transitions (from_state, to_state, event_type, description) VALUES
  ('__new__',             'in_stock',             'received',              'GRN posting / Odoo opening seed'),
  ('__new__',             'available',            'received',              'Legacy/transitional INSERT prior to backfill rename'),
  ('available',           'in_stock',             'backfill_rename',       'Migration 387 status rename (backfill bypass path)'),
  ('in_stock',            'allocated_to_project', 'allocated',             'Project allocation'),
  ('allocated_to_project','issued',               'issued_to_tech',        'Picking done'),
  ('in_stock',            'issued',               'issued_to_tech',        'Picking done (allocation skipped)'),
  ('issued',              'installed',            'installed_at_drop',     'Field install'),
  ('installed',           'activated',            'activated',             'OES activation'),
  ('installed',           'faulty',               'marked_faulty',         'RMA flagged pre-activation'),
  ('activated',           'faulty',               'marked_faulty',         'RMA flagged post-activation'),
  ('issued',              'faulty',               'marked_faulty',         'Tech-side fault before install'),
  ('installed',           'returned',             'returned_to_warehouse', 'Pulled from drop'),
  ('activated',           'returned',             'returned_to_warehouse', 'Customer cancel + recovery'),
  ('faulty',              'returned',             'returned_to_warehouse', 'RMA returned'),
  ('returned',            'in_stock',             'restocked',             'Return disposition=restock'),
  ('returned',            'scrapped',             'scrapped',              'Return disposition=scrap'),
  ('faulty',              'scrapped',             'scrapped',              'Scrapped without restock'),
  -- Self-loops (no-op writes) — explicitly allowed, emit nothing
  ('in_stock',            'in_stock',             'no_op',                 'Same-state UPDATE'),
  ('issued',              'issued',               'no_op',                 'Same-state UPDATE'),
  ('installed',           'installed',            'no_op',                 'Same-state UPDATE'),
  ('activated',           'activated',            'no_op',                 'Same-state UPDATE');

-- 3. Holder cross-validation pairs (status × holder_type).
--    NULL holder_type means holder_id IS NULL is acceptable.
--    Cannot use PRIMARY KEY (status, holder_type) because PK columns must be
--    NOT NULL in Postgres; use a surrogate id PK + UNIQUE NULLS NOT DISTINCT
--    (Postgres 15+) to enforce the uniqueness while permitting NULL holder_type.
CREATE TABLE stock_serial_status_holder_pairs (
  id            serial        PRIMARY KEY,
  status        varchar(50)   NOT NULL,
  holder_type   varchar(50),                -- NULL = holder_id IS NULL required
  UNIQUE NULLS NOT DISTINCT (status, holder_type)
);
COMMENT ON TABLE stock_serial_status_holder_pairs IS
  'Allowed (status, holder_type) pairs. Multiple rows per status mean each is acceptable.';

INSERT INTO stock_serial_status_holder_pairs (status, holder_type) VALUES
  ('available',            'warehouse'),       -- legacy, until backfill
  ('in_stock',             'warehouse'),
  ('allocated_to_project', 'warehouse'),       -- earmarked but still at warehouse
  ('allocated_to_project', 'project'),         -- moved to project staging
  ('issued',               'staff'),
  ('installed',            NULL),              -- at customer, no tracked holder
  ('activated',            NULL),
  ('faulty',               'staff'),           -- during pickup
  ('faulty',               'warehouse'),       -- after pickup
  ('faulty',               'vendor'),          -- RMA in flight
  ('returned',             'warehouse'),
  ('scrapped',             NULL),
  ('scrapped',             'vendor');

-- 4. Side table for any RAISE NOTICE warnings during bypass operations.
CREATE TABLE stock_serial_lifecycle_violations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  serial_id     uuid REFERENCES stock_serials(id),
  serial_number varchar(100),
  attempted_from varchar(50),
  attempted_to   varchar(50),
  source_table  varchar(50),
  source_id     uuid,
  bypass_used   boolean DEFAULT false,
  raised_at     timestamptz DEFAULT now()
);
CREATE INDEX idx_ssv_raised_at ON stock_serial_lifecycle_violations (raised_at DESC);

-- 5. Status-validate trigger function.
--    SQLSTATE 'FF001' (custom; not a built-in Postgres class) so the Bugsink
--    alert can filter on it without colliding with general check_violation
--    noise from unrelated CHECK constraints.
CREATE OR REPLACE FUNCTION trg_stock_serial_status_validate()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_from      varchar(50);
  v_to        varchar(50);
  v_bypass    boolean;
  v_allowed   boolean;
BEGIN
  -- Guard OLD reference behind TG_OP. In BEFORE INSERT triggers OLD is null
  -- and accessing OLD.status against a null record is brittle; the explicit
  -- IF keeps the assignment safe and reads naturally.
  IF TG_OP = 'INSERT' THEN
    v_from := '__new__';
  ELSE
    v_from := OLD.status;
  END IF;
  v_to := NEW.status;

  -- No-op same-state writes pass without check
  IF v_from = v_to AND TG_OP = 'UPDATE' THEN
    RETURN NEW;
  END IF;

  v_bypass := COALESCE(current_setting('ff.bypass_validation', true), 'false') = 'true';

  IF v_bypass THEN
    -- Log the bypass to the violations side-table for audit; allow write
    INSERT INTO stock_serial_lifecycle_violations
      (serial_id, serial_number, attempted_from, attempted_to,
       source_table, source_id, bypass_used)
    VALUES
      (NEW.id, NEW.serial_number, NULLIF(v_from, '__new__'), v_to,
       NULLIF(current_setting('ff.event_source_table', true), ''),
       NULLIF(current_setting('ff.event_source_id', true), '')::uuid,
       true);
    RETURN NEW;
  END IF;

  SELECT TRUE INTO v_allowed
    FROM stock_serial_status_transitions
   WHERE from_state = v_from
     AND to_state   = v_to
   LIMIT 1;

  IF v_allowed IS NULL THEN
    RAISE EXCEPTION 'lifecycle_violation: % → % not allowed for serial % (set ff.bypass_validation=true to override)',
      v_from, v_to, NEW.serial_number
      USING ERRCODE = 'FF001';
  END IF;

  RETURN NEW;
END;
$$;

-- 6. Status-emit trigger function. Reads per-txn GUCs for context.
CREATE OR REPLACE FUNCTION trg_stock_serial_status_emit()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_from        varchar(50);
  v_event_type  varchar(50);
  v_source_table varchar(50);
  v_source_id    uuid;
  v_payload     jsonb;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_from := '__new__';
  ELSE
    v_from := OLD.status;
  END IF;

  -- Skip no-op same-state
  IF v_from = NEW.status AND TG_OP = 'UPDATE' THEN
    RETURN NEW;
  END IF;

  SELECT event_type INTO v_event_type
    FROM stock_serial_status_transitions
   WHERE from_state = v_from
     AND to_state   = NEW.status
   LIMIT 1;

  -- Unknown transition (only possible with bypass): emit a generic event
  IF v_event_type IS NULL THEN
    v_event_type := 'force_corrected';
  END IF;

  v_source_table := NULLIF(current_setting('ff.event_source_table', true), '');
  v_source_id    := NULLIF(current_setting('ff.event_source_id',    true), '')::uuid;
  v_payload      := COALESCE(NULLIF(current_setting('ff.event_payload', true), '')::jsonb, '{}'::jsonb);

  INSERT INTO stock_serial_events
    (serial_id, event_type, from_state, to_state,
     source_table, source_id,
     actor_user_id, actor_staff_id,
     payload, occurred_at)
  VALUES
    -- Translate the internal '__new__' sentinel back to NULL on the way out
    -- so the events table preserves the original "no prior state" semantics.
    (NEW.id, v_event_type, NULLIF(v_from, '__new__'), NEW.status,
     v_source_table, v_source_id,
     NULLIF(current_setting('ff.event_actor_user_id',  true), '')::uuid,
     NULLIF(current_setting('ff.event_actor_staff_id', true), '')::uuid,
     v_payload,
     COALESCE(NULLIF(current_setting('ff.event_occurred_at', true), '')::timestamptz, NOW()))
  ON CONFLICT (serial_id, source_table, source_id, event_type)
    WHERE source_id IS NOT NULL
  DO NOTHING;

  RETURN NEW;
END;
$$;

-- 7. Holder-validate trigger function.
CREATE OR REPLACE FUNCTION trg_stock_serial_holder_validate()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_holder_type varchar(50);
  v_allowed     boolean;
BEGIN
  IF current_setting('ff.bypass_validation', true) = 'true' THEN
    RETURN NEW;
  END IF;

  IF NEW.holder_id IS NULL THEN
    v_holder_type := NULL;
  ELSE
    SELECT holder_type INTO v_holder_type
      FROM stock_holders
     WHERE id = NEW.holder_id;
  END IF;

  SELECT TRUE INTO v_allowed
    FROM stock_serial_status_holder_pairs
   WHERE status = NEW.status
     AND holder_type IS NOT DISTINCT FROM v_holder_type
   LIMIT 1;

  IF v_allowed IS NULL THEN
    -- Custom SQLSTATE 'FF002' so Bugsink can isolate holder-mismatch alerts
    -- from generic check_violation noise.
    RAISE EXCEPTION 'holder_mismatch: status=% with holder_type=% not allowed for serial %',
      NEW.status, COALESCE(v_holder_type, 'NULL'), NEW.serial_number
      USING ERRCODE = 'FF002';
  END IF;

  RETURN NEW;
END;
$$;

-- 8. Install triggers. NOTE: legacy mig 365/366/367 triggers REMAIN INSTALLED
--    until Track 2 retires them after the verbs are refactored.
DROP TRIGGER IF EXISTS trg_stock_serial_status_validate_t ON stock_serials;
CREATE TRIGGER trg_stock_serial_status_validate_t
  BEFORE INSERT OR UPDATE OF status ON stock_serials
  FOR EACH ROW EXECUTE FUNCTION trg_stock_serial_status_validate();

DROP TRIGGER IF EXISTS trg_stock_serial_status_emit_t ON stock_serials;
CREATE TRIGGER trg_stock_serial_status_emit_t
  AFTER INSERT OR UPDATE OF status ON stock_serials
  FOR EACH ROW EXECUTE FUNCTION trg_stock_serial_status_emit();

DROP TRIGGER IF EXISTS trg_stock_serial_holder_validate_t ON stock_serials;
CREATE TRIGGER trg_stock_serial_holder_validate_t
  BEFORE INSERT OR UPDATE OF status, holder_id ON stock_serials
  FOR EACH ROW EXECUTE FUNCTION trg_stock_serial_holder_validate();

INSERT INTO migrations (version, name)
  VALUES (387, 'serial_lifecycle_state_machine')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
