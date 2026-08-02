-- Rollback migration 478.
-- scripts/migrations/run.ts owns the surrounding transaction.
--
-- Deliberately NOT a symmetric teardown. Two things this migration created are
-- safety evidence, and destroying them would let a later re-apply contact people
-- who have already been contacted, or whose consent evidence was recorded.
-- Rolling back removes the FEATURE; it must not remove the record of what the
-- feature already did.
--
-- Kept:
--   velocity_review_exports — the permanent (dr_number, phone_e164) ledger, and
--     therefore the whole "never contact the same person about the same DR
--     twice" guarantee. Dropping it and re-applying makes every previously
--     contacted customer eligible again, silently. The forward file creates it
--     with CREATE TABLE IF NOT EXISTS, so a re-apply adopts the surviving table
--     and the guarantee holds across the cycle.
--   velocity_review_runs — velocity_review_exports.first_run_id references it,
--     so it cannot be dropped while the ledger survives; it is also the per-date
--     audit trail.
--   wa_subscriber_consent source values and the widened CHECK — see below.
--
-- Dropped:
--   velocity_review_control — MUST go. It carries automation_enabled and
--     pilot_enabled. Keeping it would let a re-apply resume in whatever state an
--     operator last set, instead of the disabled-by-default the forward file
--     recreates. Dropping it is the fail-closed choice.
--   velocity_review_candidates — per-run discovery rows, no safety value, and
--     the FK child of the ledger.

-- In-flight rows would otherwise hold ux_velocity_review_one_phone_inflight
-- forever, permanently blocking those phones from any future DR while no code
-- exists to advance them. Park them terminally instead: the partial index is
-- released, while UNIQUE (dr_number, phone_e164) still bars a repeat contact for
-- the same DR. error_code records why, so the state stays auditable rather than
-- indistinguishable from a genuine delivery failure.
-- Guarded on the relation existing: every other statement here is IF EXISTS, and
-- a bare UPDATE would make the whole file error on a database where 478 was
-- never applied — or on any re-run after the ledger was archived away by hand.
DO $$ BEGIN
  IF to_regclass('velocity_review_exports') IS NOT NULL THEN
    UPDATE velocity_review_exports
    SET state = 'permanent_failure',
        error_code = 'migration_rolled_back',
        updated_at = NOW()
    WHERE state NOT IN ('completed', 'permanent_failure');
  END IF;
END $$;

-- Consent is deliberately untouched.
--
-- An earlier revision rewrote source to 'import' and narrowed the CHECK back to
-- migration 469's vocabulary. That destroyed POPIA evidence: it collapsed
-- 'onemap_home_signup' and 'onemap_install_signature' — two distinct, separately
-- captured consent events — into one generic label, irreversibly, on a table
-- shared with the WhatsApp stack.
--
-- Neither statement was necessary. Widening a CHECK vocabulary is additive and
-- backward compatible: pre-478 code only ever writes the five original values,
-- and those still satisfy the widened constraint. So the wider vocabulary stays
-- and the evidence survives intact.

ALTER TABLE IF EXISTS velocity_review_candidates
  DROP CONSTRAINT IF EXISTS velocity_review_candidates_export_fk;

DROP TABLE IF EXISTS velocity_review_candidates;
DROP TABLE IF EXISTS velocity_review_control;

DELETE FROM schema_migrations
WHERE filename = '478_velocity_review_export.sql';
