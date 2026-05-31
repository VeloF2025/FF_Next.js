-- Rollback 393: remove the in_stock → activated reconciliation transition.
--
-- Safe to run only if no serials still depend on the transition. After this,
-- promoteSerial(in_stock→activated) will again raise FF001. Does NOT revert any
-- serials already promoted to 'activated' (the lifecycle is one-way past
-- activated by design; reverting data is a separate, deliberate operation).

BEGIN;

DELETE FROM stock_serial_status_transitions
 WHERE from_state = 'in_stock'
   AND to_state   = 'activated'
   AND event_type = 'activated_on_oes';

DELETE FROM migrations WHERE version = 393;

COMMIT;
