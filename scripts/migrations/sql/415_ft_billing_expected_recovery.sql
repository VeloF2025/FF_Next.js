-- Migration 415: FT billing expected-recovery ledger (activations audit rec #2)
-- (version = max(DB max 414, file max 414) + 1.)
--
-- Closes the daily-fix → billing feedback loop. When a DR was deducted by FT and we
-- THEN fixed the cause (1Map serial/entry corrected, device recovered from offline,
-- or a pre-provision activated), FT should drop it from the next weekly deduction
-- list. This table records that forward-looking claim and tracks whether FT honoured
-- it — closing the gap the audit named: today no code asserts "these N DRs must
-- return to the paid pool" or flags FT when they don't.
--
-- Lifecycle (driven by processExpectedRecoveries at each weekly bundle import):
--   pending      — we detected a post-deduction fix while FT was still billing the
--                  DR; we expect it gone from next week's deductions.
--   recovered    — a later bundle no longer deducts the DR → FT honoured the fix;
--                  oes_activations.payment_status flips deducted → paid.
--   not_returned — a pending DR is STILL deducted a cycle later → FT did not honour
--                  the fix; the deduction is marked a dispute candidate
--                  (ft_billing_deductions.verdict='disputable') and flows into the
--                  existing Action Centre Candidates → Disputes → dispute-pack path.
--
-- Candidate population is note-aware + temporal (verified live 2026-06-13: 438 DRs):
--   note4 / note2 → olt_mismatch_records resolved AFTER the deduction week
--   note5         → offline_devices.recovered_at AFTER the deduction week
--   note2         → oes_pp_data activated AFTER the deduction week
-- A naive "deducted AND ever-fixed" filter matched 1079/1111 (97%, useless) — the
-- temporal guard (fix postdates the deduction) is what makes this a real claim.
--
-- ADDITIVE: a new table only. No existing table/column is altered; the payment_status
-- flip and dispute-candidate mark are written at runtime by the service, not here.

BEGIN;

CREATE TABLE IF NOT EXISTS ft_billing_expected_recovery (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  drop_number               varchar NOT NULL,
  project                   varchar,
  deduction_note            varchar NOT NULL,
  -- the billing week in which the DR was deducted (the episode this recovery clears)
  deduction_week_ending     date NOT NULL,
  -- which fix event qualified this DR, and when it happened
  fix_signal                varchar NOT NULL,
  fix_at                    timestamptz,
  status                    varchar NOT NULL DEFAULT 'pending',
  -- bundle week at which we detected the pending recovery
  detected_week_ending      date NOT NULL,
  detected_billing_week_id  uuid REFERENCES ft_weekly_billing(id) ON DELETE SET NULL,
  -- bundle week at which it was confirmed recovered / not_returned
  confirmed_week_ending     date,
  confirmed_billing_week_id uuid REFERENCES ft_weekly_billing(id) ON DELETE SET NULL,
  -- days between the deduction week and confirmation (FT's acceptance lag)
  recovery_lag_days         integer,
  -- the deduction row marked disputable when not_returned (audit link)
  dispute_deduction_id      uuid REFERENCES ft_billing_deductions(id) ON DELETE SET NULL,
  evidence                  jsonb,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ft_ber_status_chk CHECK (status IN ('pending', 'recovered', 'not_returned')),
  CONSTRAINT ft_ber_signal_chk CHECK (fix_signal IN ('onemap_fix', 'offline_recovery', 'pp_activation')),
  -- one recovery row per (DR, note, deduction episode) — idempotent re-detection.
  -- drop_number is globally unique across projects today (oes_activations_drop_number_key;
  -- verified 0 DRs span >1 project), so project is not part of the key; the service
  -- still scopes its mark_* UPDATEs by project defensively in case that ever changes.
  CONSTRAINT ft_ber_episode_uniq UNIQUE (drop_number, deduction_note, deduction_week_ending)
);

CREATE INDEX IF NOT EXISTS idx_ft_ber_status         ON ft_billing_expected_recovery (status);
CREATE INDEX IF NOT EXISTS idx_ft_ber_project_status ON ft_billing_expected_recovery (project, status);
CREATE INDEX IF NOT EXISTS idx_ft_ber_drop           ON ft_billing_expected_recovery (drop_number);

INSERT INTO migrations (version, name, executed_at)
VALUES ('415', 'ft_billing_expected_recovery', NOW())
ON CONFLICT (version) DO NOTHING;

COMMIT;
