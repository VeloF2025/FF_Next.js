-- Migration 214: Procurement Threads
-- Tracks the full lifecycle of a procurement transaction across all
-- workflow steps (requisition -> RFQ -> quote -> PO -> GRN -> payment).
-- Thread numbering: PT26-00001

CREATE TABLE IF NOT EXISTS procurement_threads (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_number       VARCHAR(50) UNIQUE NOT NULL,
  title               VARCHAR(255),
  description         TEXT,

  -- Document linkages (nullable — populated as steps complete)
  project_id          UUID REFERENCES projects(id),
  requisition_id      UUID REFERENCES purchase_requisitions(id),
  rfq_id              UUID,
  quote_id            UUID,
  po_id               UUID REFERENCES purchase_orders(id),
  grn_id              UUID REFERENCES goods_receipt_notes(id),
  payment_approval_id UUID,

  -- Workflow position (1-9 matching the wizard steps)
  current_step        INTEGER NOT NULL DEFAULT 1 CHECK (current_step BETWEEN 1 AND 9),
  strategy            VARCHAR(20) CHECK (strategy IN ('rfq', 'direct_po')),
  status              VARCHAR(20) NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active', 'completed', 'cancelled', 'on_hold')),

  -- Denormalized financials for list view
  estimated_total     DECIMAL(14, 2),
  po_total            DECIMAL(14, 2),

  -- Audit
  created_by          VARCHAR(255) NOT NULL,
  created_at          TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at          TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Auto-number trigger: PT<YY>-<00001>
CREATE OR REPLACE FUNCTION procurement_threads_set_number()
RETURNS TRIGGER AS $$
DECLARE
  v_year   TEXT;
  v_prefix TEXT;
  v_seq    INTEGER;
BEGIN
  v_year   := TO_CHAR(NOW(), 'YY');
  v_prefix := 'PT' || v_year || '-';
  SELECT COALESCE(MAX(
    CAST(SUBSTRING(thread_number FROM LENGTH(v_prefix) + 1) AS INTEGER)
  ), 0) + 1
  INTO v_seq
  FROM procurement_threads
  WHERE thread_number LIKE v_prefix || '%';
  NEW.thread_number := v_prefix || LPAD(v_seq::TEXT, 5, '0');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_procurement_threads_set_number ON procurement_threads;
CREATE TRIGGER trg_procurement_threads_set_number
  BEFORE INSERT ON procurement_threads
  FOR EACH ROW
  WHEN (NEW.thread_number IS NULL OR NEW.thread_number = '')
  EXECUTE FUNCTION procurement_threads_set_number();

-- Updated_at trigger
CREATE OR REPLACE FUNCTION procurement_threads_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_procurement_threads_updated_at ON procurement_threads;
CREATE TRIGGER trg_procurement_threads_updated_at
  BEFORE UPDATE ON procurement_threads
  FOR EACH ROW
  EXECUTE FUNCTION procurement_threads_set_updated_at();

-- Indexes
CREATE INDEX IF NOT EXISTS idx_procurement_threads_status ON procurement_threads(status);
CREATE INDEX IF NOT EXISTS idx_procurement_threads_project_id ON procurement_threads(project_id);
CREATE INDEX IF NOT EXISTS idx_procurement_threads_requisition_id ON procurement_threads(requisition_id);
CREATE INDEX IF NOT EXISTS idx_procurement_threads_po_id ON procurement_threads(po_id);
CREATE INDEX IF NOT EXISTS idx_procurement_threads_current_step_active
  ON procurement_threads(current_step) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_procurement_threads_created_at ON procurement_threads(created_at DESC);
