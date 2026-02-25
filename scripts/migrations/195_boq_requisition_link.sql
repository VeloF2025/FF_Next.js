-- Migration 195: BOQ ↔ Purchase Requisition Link
-- Phase 1 of BOQ-Integrated Procurement Workflow
--
-- Adds boq_item_id and item_type to purchase_requisition_items so that
-- each requisition line can be tagged as BOQ-planned or ad-hoc spend.
-- The chain: BOQ → PR → PO → GRN is now fully modelled end-to-end.

ALTER TABLE purchase_requisition_items
  ADD COLUMN IF NOT EXISTS boq_item_id UUID REFERENCES boq_items(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS item_type VARCHAR(10) DEFAULT 'adhoc'
    CHECK (item_type IN ('boq', 'adhoc'));

CREATE INDEX IF NOT EXISTS idx_pri_boq_item ON purchase_requisition_items(boq_item_id);

COMMENT ON COLUMN purchase_requisition_items.boq_item_id IS
  'FK to boq_items — set when item_type=boq, null for ad-hoc items';
COMMENT ON COLUMN purchase_requisition_items.item_type IS
  'boq = planned line from Bill of Quantities; adhoc = unplanned purchase';
