-- Migration 393: OES reconciliation transition — in_stock → activated
--
-- Group A remediation (issue #1860). Serials that are 'Active' in OES but were
-- never recorded as 'installed' in stock_serials — bulk-imported direct to
-- stock, or a field-install event we never captured — cannot currently reach
-- 'activated'. The mig 387 transition matrix only allows installed→activated,
-- so promoteSerial() raises FF001 (lifecycle_violation) on these rows and they
-- stay stuck in 'in_stock' even though OES reports them Active. As of the audit
-- this was 14,474 serials.
--
-- This adds the matrix row in_stock→activated with a DEDICATED event_type
-- 'activated_on_oes' (distinct from the normal post-install 'activated' event)
-- so the emit trigger records the reconciliation honestly. No install metadata
-- is fabricated: the serial transitions straight to 'activated' with one event,
-- not a synthesized installed→activated pair.
--
-- Forward path: promoteOesActivatedSerials (src/modules/activate/services/oes/
-- oesSerialLifecycle.ts) promotes in_stock serials via this row on each OES
-- import. The one-time backfill of the historical rows is a separate,
-- controller-run step (issue #1860).
--
-- Validation/emit mechanics (mig 387): the validate trigger
-- (trg_stock_serial_status_validate) checks only that a (from_state, to_state)
-- row exists; the emit trigger (trg_stock_serial_status_emit) derives
-- event_type from this same row. Adding the row is therefore sufficient — no
-- application code passes event_type.
--
-- Idempotent: the matrix INSERT is guarded by WHERE NOT EXISTS, and the
-- migrations bookkeeping row uses ON CONFLICT (version) DO NOTHING.

BEGIN;

INSERT INTO stock_serial_status_transitions (from_state, to_state, event_type, description)
SELECT 'in_stock', 'activated', 'activated_on_oes',
       'OES reconciliation: serial Active in OES but never recorded as installed; promoted in_stock->activated with no synthesized install metadata (issue #1860).'
WHERE NOT EXISTS (
  SELECT 1 FROM stock_serial_status_transitions
   WHERE from_state = 'in_stock' AND to_state = 'activated'
);

INSERT INTO migrations (version, name)
  VALUES (393, 'oes_in_stock_activated_reconciliation_transition')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
