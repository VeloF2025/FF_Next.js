-- Migration 417: enable auto NOC tickets for WA-submitted-but-never-activated DRs (audit rec #5, part B)
-- (version = max(DB 416, file 416) + 1.)
--
-- Part A (mig 416) made a TYPED WhatsApp serial reach the three-way recon ledger.
-- Part B turns the ledger's `wa_no_oes` class (has_wa_submission AND NOT
-- has_oes_activation) into actionable, auto-assigned `activations` NOC tickets,
-- created out-of-band by pages/api/cron/wa-no-oes-tickets.ts via
-- waNoOesTicketService.ts (never in this migration / never a trigger).
--
-- This migration is purely the DB enablement for those tickets — two additive,
-- idempotent changes to maintenance_tickets:
--   1. extend tickets_source_check to allow source = 'wa_no_oes' (same pattern by
--      which pp_data / olt_mismatch / snags were added). Without this the INSERT
--      raises 23514.
--   2. add a partial UNIQUE index so a DR can hold at most ONE open wa_no_oes
--      ticket — the race backstop behind the service's pre-create dedup check
--      (mirrors uniq_open_pp_data_ticket_per_serial). A DR that later activates
--      and is auto-resolved drops out of the predicate, so a genuine
--      re-occurrence can be re-ticketed.
--
-- No column is added, renamed or retyped; no existing row is rewritten. Safe to
-- re-run (DROP CONSTRAINT IF EXISTS / CREATE INDEX IF NOT EXISTS).

BEGIN;

-- 1. allow the new source value (reproduce the live whitelist + 'wa_no_oes')
ALTER TABLE public.maintenance_tickets
  DROP CONSTRAINT IF EXISTS tickets_source_check;

ALTER TABLE public.maintenance_tickets
  ADD CONSTRAINT tickets_source_check CHECK (
    source = ANY (ARRAY[
      'qcontact', 'whatsapp', 'email', 'construction', 'internal',
      'whatsapp_outbound', 'adhoc', 'weekly_report', 'ad_hoc', 'incident',
      'revenue', 'ont_swap', 'manual', 'offline_report', 'qa_review',
      'hse_report', 'wa_maintenance', 'pp_data', 'olt_mismatch', 'dev_ops',
      'snags', 'wa_no_oes'
    ]::text[])
  );

-- 2. at most one OPEN wa_no_oes ticket per DR (race backstop for the dedup check)
CREATE UNIQUE INDEX IF NOT EXISTS uniq_open_wa_no_oes_ticket_per_dr
  ON public.maintenance_tickets (dr_number)
  WHERE source = 'wa_no_oes'
    AND dr_number IS NOT NULL
    AND status NOT IN ('resolved', 'closed', 'cancelled', 'verified');

COMMIT;
