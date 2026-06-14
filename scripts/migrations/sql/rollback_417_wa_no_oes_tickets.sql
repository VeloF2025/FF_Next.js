-- Rollback for migration 417 (wa_no_oes auto-tickets enablement).
--
-- Drops the dedup index and restores tickets_source_check to its pre-417
-- whitelist (WITHOUT 'wa_no_oes'). NOTE: if any wa_no_oes tickets already exist,
-- restoring the narrower CHECK will FAIL (existing rows violate it) — cancel or
-- re-source those tickets first, e.g.
--   UPDATE maintenance_tickets SET status='cancelled'
--    WHERE source='wa_no_oes' AND status NOT IN ('resolved','closed','cancelled','verified');
--   DELETE FROM maintenance_tickets WHERE source='wa_no_oes';  -- if a hard rollback is wanted

BEGIN;

DROP INDEX IF EXISTS public.uniq_open_wa_no_oes_ticket_per_dr;

ALTER TABLE public.maintenance_tickets
  DROP CONSTRAINT IF EXISTS tickets_source_check;

ALTER TABLE public.maintenance_tickets
  ADD CONSTRAINT tickets_source_check CHECK (
    source = ANY (ARRAY[
      'qcontact', 'whatsapp', 'email', 'construction', 'internal',
      'whatsapp_outbound', 'adhoc', 'weekly_report', 'ad_hoc', 'incident',
      'revenue', 'ont_swap', 'manual', 'offline_report', 'qa_review',
      'hse_report', 'wa_maintenance', 'pp_data', 'olt_mismatch', 'dev_ops',
      'snags'
    ]::text[])
  );

COMMIT;
