-- Velocity review export: disabled control plane and durable run/export ledgers.
-- Deliberately unwrapped: run-pending-migrations.sh supplies the transaction.

CREATE TABLE IF NOT EXISTS velocity_review_control (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  automation_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  go_live_date DATE,
  pilot_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  pilot_target_date DATE,
  pilot_limit INTEGER CHECK (pilot_limit IS NULL OR pilot_limit BETWEEN 1 AND 50),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (NOT automation_enabled OR (go_live_date IS NOT NULL AND NOT pilot_enabled)),
  CHECK (NOT pilot_enabled OR
    (NOT automation_enabled AND pilot_target_date IS NOT NULL AND pilot_limit IS NOT NULL))
);

INSERT INTO velocity_review_control (singleton) VALUES (TRUE)
ON CONFLICT (singleton) DO NOTHING;

CREATE TABLE IF NOT EXISTS velocity_review_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_date DATE NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('pending','running','partial','complete','blocked')),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  counts JSONB NOT NULL DEFAULT '{}'::jsonb,
  summary_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (summary_status IN ('pending','sent','failed','skipped')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS velocity_review_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES velocity_review_runs(id) ON DELETE RESTRICT,
  target_date DATE NOT NULL,
  dr_number TEXT NOT NULL,
  source_flags TEXT[] NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('ready','quarantined')),
  quarantine_reason TEXT CHECK (quarantine_reason IS NULL OR quarantine_reason IN
    ('no_safe_phone','phone_conflict','consent_missing','consent_withdrawn')),
  phone_fingerprint TEXT CHECK (phone_fingerprint IS NULL OR phone_fingerprint ~ '^[a-f0-9]{64}$'),
  export_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (target_date, dr_number)
);

CREATE TABLE IF NOT EXISTS velocity_review_exports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  first_run_id UUID NOT NULL REFERENCES velocity_review_runs(id) ON DELETE RESTRICT,
  first_target_date DATE NOT NULL,
  dr_number TEXT NOT NULL,
  phone_e164 TEXT NOT NULL CHECK (phone_e164 ~ E'^\\+27[6-8][0-9]{8}$'),
  phone_fingerprint TEXT NOT NULL CHECK (phone_fingerprint ~ '^[a-f0-9]{64}$'),
  phone_source TEXT NOT NULL CHECK (phone_source IN ('onemap','subscriber_cache','qcontact')),
  source_flags TEXT[] NOT NULL,
  export_key UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  ghl_contact_id TEXT,
  state TEXT NOT NULL CHECK (state IN
    ('ready','upserting','contact_upserted','trigger_requested','retryable_failure',
     'ambiguous','ack_cleanup_pending','completed','permanent_failure')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at TIMESTAMPTZ,
  error_code TEXT,
  upserted_at TIMESTAMPTZ,
  trigger_requested_at TIMESTAMPTZ,
  workflow_acknowledged_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (dr_number, phone_e164)
);

-- Stable E.164 identity must survive HMAC-secret rotation. Remove the earlier
-- fingerprint-derived key if this migration is rerun over a pre-existing schema.
ALTER TABLE velocity_review_exports
  DROP CONSTRAINT IF EXISTS velocity_review_exports_dr_number_phone_fingerprint_key;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'velocity_review_exports_dr_number_phone_e164_key'
      AND conrelid = 'velocity_review_exports'::regclass
  ) THEN
    ALTER TABLE velocity_review_exports
      ADD CONSTRAINT velocity_review_exports_dr_number_phone_e164_key
      UNIQUE (dr_number, phone_e164);
  END IF;
END $$;

-- Permanent dedupe is only meaningful when every writer stores the same DR
-- spelling. Named, relation-scoped guards also add the invariant if this file
-- is rerun after an earlier revision created the ledgers without it.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'velocity_review_candidates_dr_number_canonical_chk'
      AND conrelid = 'velocity_review_candidates'::regclass
  ) THEN
    ALTER TABLE velocity_review_candidates
      ADD CONSTRAINT velocity_review_candidates_dr_number_canonical_chk
      CHECK (dr_number <> '' AND dr_number = UPPER(BTRIM(dr_number)));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'velocity_review_exports_dr_number_canonical_chk'
      AND conrelid = 'velocity_review_exports'::regclass
  ) THEN
    ALTER TABLE velocity_review_exports
      ADD CONSTRAINT velocity_review_exports_dr_number_canonical_chk
      CHECK (dr_number <> '' AND dr_number = UPPER(BTRIM(dr_number)));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'velocity_review_candidates_export_fk'
      AND conrelid = 'velocity_review_candidates'::regclass
  ) THEN
    ALTER TABLE velocity_review_candidates
      ADD CONSTRAINT velocity_review_candidates_export_fk
      FOREIGN KEY (export_id) REFERENCES velocity_review_exports(id) ON DELETE RESTRICT;
  END IF;
END $$;

DROP INDEX IF EXISTS ux_velocity_review_one_phone_inflight;
CREATE UNIQUE INDEX IF NOT EXISTS ux_velocity_review_one_phone_inflight
  ON velocity_review_exports(phone_e164)
  WHERE state IN (
    'upserting', 'contact_upserted', 'trigger_requested', 'retryable_failure',
    'ambiguous', 'ack_cleanup_pending'
  );

-- Widen migration 469's evidence vocabulary without weakening any old source.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'wa_subscriber_consent_source_chk'
      AND conrelid = 'wa_subscriber_consent'::regclass
      AND (
        pg_get_constraintdef(oid) NOT LIKE '%onemap_home_signup%'
        OR pg_get_constraintdef(oid) NOT LIKE '%onemap_install_signature%'
      )
  ) THEN
    ALTER TABLE wa_subscriber_consent
      DROP CONSTRAINT wa_subscriber_consent_source_chk;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'wa_subscriber_consent_source_chk'
      AND conrelid = 'wa_subscriber_consent'::regclass
  ) THEN
    ALTER TABLE wa_subscriber_consent
      ADD CONSTRAINT wa_subscriber_consent_source_chk CHECK (source IN (
        'fno_payload', 'ops_manual', 'subscriber_block', 'inbound_stop', 'import',
        'onemap_home_signup', 'onemap_install_signature'
      ));
  END IF;
END $$;

INSERT INTO schema_migrations (filename, applied_at)
VALUES ('478_velocity_review_export.sql', NOW())
ON CONFLICT (filename) DO NOTHING;
