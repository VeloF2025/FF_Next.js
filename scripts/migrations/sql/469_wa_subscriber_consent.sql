-- scripts/migrations/sql/469_wa_subscriber_consent.sql
-- WA Cloud Phase 5 (#2276): the record that makes business-initiated outbound lawful.
--
-- Every WhatsApp conversation here is business-initiated — the FNO raises the ticket and
-- Velocity contacts the subscriber first — so Meta requires opt-in before the first
-- template and POPIA requires we can prove it. Nothing in the database recorded that
-- until now.
--
-- KEYED ON MSISDN, NOT ON THE TICKET. #2276 originally proposed a per-ticket consent
-- flag. Consent is a property of the person, so a per-ticket flag cannot express
-- withdrawal: a subscriber who opts out has opted out of one fault report, and the next
-- ticket raised for the same drop starts blank and is free to message them again. The
-- thing we actually need permission for is "may we send a WhatsApp to this number", and
-- a WhatsApp block — which we must honour as withdrawal — is signalled per number too,
-- across every drop that number is attached to. `drop_number` is retained for
-- traceability only and is deliberately NOT part of the key.
--
-- FAIL-CLOSED BY CONSTRUCTION: absence of a row means no consent. There is no default
-- that could be read as permission, and no nullable "consented" boolean whose NULL a
-- caller might coerce to true. The guard must treat "no row" and "status <> granted"
-- identically.
--
-- Withdrawal is a status transition, never a DELETE — erasing the row would make the
-- subscriber look un-contacted rather than opted-out, and the next FNO payload carrying
-- consent would silently re-grant it.
--
-- Idempotent; safe to re-run.

CREATE TABLE IF NOT EXISTS wa_subscriber_consent (
  id           BIGSERIAL PRIMARY KEY,
  -- Normalized SA MSISDN (27XXXXXXXXX), as produced by normalizeMsisdn. Storing any
  -- other shape would let the same subscriber hold two conflicting rows.
  msisdn       TEXT        NOT NULL,
  status       TEXT        NOT NULL,
  -- Traceability only: the drop the consent arrived with. Not unique, not part of the
  -- key; a number may legitimately be associated with more than one drop over time.
  drop_number  TEXT,
  -- Where the record came from, so an audit can distinguish an FNO-supplied grant from
  -- an operator's manual entry from an automatic suppression.
  source       TEXT        NOT NULL,
  granted_at   TIMESTAMPTZ,
  withdrawn_at TIMESTAMPTZ,
  recorded_by  TEXT,
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ADD CONSTRAINT has no IF NOT EXISTS form, so guard both explicitly.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'wa_subscriber_consent_status_chk') THEN
    ALTER TABLE wa_subscriber_consent
      ADD CONSTRAINT wa_subscriber_consent_status_chk CHECK (status IN ('granted', 'withdrawn'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'wa_subscriber_consent_source_chk') THEN
    ALTER TABLE wa_subscriber_consent
      ADD CONSTRAINT wa_subscriber_consent_source_chk
      CHECK (source IN ('fno_payload', 'ops_manual', 'subscriber_block', 'inbound_stop', 'import'));
  END IF;
END $$;

-- The unique index below only catches byte-identical duplicates, so on its own it
-- leaves the real hazard open: the SAME subscriber stored twice in two shapes —
-- '27821234567' and '0821234567', or one with a stray '+' or trailing space — one row
-- granted and one withdrawn, with the lookup silently reading whichever shape it
-- happens to normalize to. That is a consent misread, not a cosmetic inconsistency.
--
-- Every write path (the FNO payload, ops_manual entry, and bulk import) is supposed to
-- normalize through normalizeMsisdn first. This makes that an invariant the database
-- enforces rather than one three separate callers are each trusted to remember, and it
-- subsumes the empty-string case for free.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'wa_subscriber_consent_msisdn_chk') THEN
    ALTER TABLE wa_subscriber_consent
      ADD CONSTRAINT wa_subscriber_consent_msisdn_chk CHECK (msisdn ~ '^27[0-9]{9}$');
  END IF;
END $$;

-- Timestamps must agree with the status they describe. Without this a row can claim
-- status='granted' with granted_at NULL, or carry both timestamps at once, which
-- destroys the audit trail these columns exist to provide — the one record showing WHEN
-- a subscriber opted in or out. The guard reads `status`, so this is an audit-integrity
-- constraint rather than a consent-correctness one, but a consent record that cannot
-- say when it was given is not worth much under POPIA.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'wa_subscriber_consent_timestamps_chk') THEN
    ALTER TABLE wa_subscriber_consent
      ADD CONSTRAINT wa_subscriber_consent_timestamps_chk CHECK (
        (status = 'granted'   AND granted_at   IS NOT NULL AND withdrawn_at IS NULL)
        OR
        (status = 'withdrawn' AND withdrawn_at IS NOT NULL)
      );
  END IF;
END $$;

-- One row per subscriber number. This is what makes the guard's lookup a single
-- unambiguous read rather than a "pick the newest and hope" over duplicates, and it is
-- the arbiter an upsert needs to turn a repeated FNO payload into an update instead of
-- a second, contradictory row.
CREATE UNIQUE INDEX IF NOT EXISTS ux_wa_subscriber_consent_msisdn
  ON wa_subscriber_consent (msisdn);

-- Supports the ops surface answering "what is the consent state for this ticket's drop".
CREATE INDEX IF NOT EXISTS idx_wa_subscriber_consent_drop
  ON wa_subscriber_consent (drop_number);
