-- Rollback for migration 415: FT billing expected-recovery ledger.
-- Additive table only; nothing read it before this PR, so a plain DROP is clean.
-- NOTE: dropping the table discards the recovery audit trail. The payment_status
-- flips it performed on oes_activations are NOT reverted here (they reflect real FT
-- concessions); only the audit rows are removed.

BEGIN;

DROP TABLE IF EXISTS ft_billing_expected_recovery;

DELETE FROM migrations WHERE version = '415';

COMMIT;
