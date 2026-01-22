-- Migration 110: Link Requisitions to RFQs
-- Enables proper procurement workflow: Requisition → RFQ → Quote → PO → GRN

-- Add requisition_id to rfqs table
ALTER TABLE rfqs
ADD COLUMN IF NOT EXISTS requisition_id UUID REFERENCES purchase_requisitions(id);

-- Add index for lookups
CREATE INDEX IF NOT EXISTS idx_rfqs_requisition_id ON rfqs(requisition_id);

-- Add requisition tracking to quotes (for easier lineage queries)
ALTER TABLE quotes
ADD COLUMN IF NOT EXISTS requisition_id UUID REFERENCES purchase_requisitions(id);

CREATE INDEX IF NOT EXISTS idx_quotes_requisition_id ON quotes(requisition_id);

-- Add requisition tracking to purchase_orders
ALTER TABLE purchase_orders
ADD COLUMN IF NOT EXISTS requisition_id UUID REFERENCES purchase_requisitions(id);

CREATE INDEX IF NOT EXISTS idx_purchase_orders_requisition_id ON purchase_orders(requisition_id);

-- Create view for procurement lineage tracking
CREATE OR REPLACE VIEW v_procurement_lineage AS
SELECT
  pr.id AS requisition_id,
  pr.requisition_number,
  pr.status AS requisition_status,
  pr.requested_by_name,
  pr.requested_date,
  r.id AS rfq_id,
  r.rfq_number,
  r.status AS rfq_status,
  r.issue_date AS rfq_date,
  q.id AS quote_id,
  q.quote_number,
  q.status AS quote_status,
  q.total_value AS quote_value,
  q.supplier_id,
  po.id AS po_id,
  po.po_number,
  po.status AS po_status,
  po.total_amount AS po_amount
FROM purchase_requisitions pr
LEFT JOIN rfqs r ON r.requisition_id = pr.id
LEFT JOIN quotes q ON q.rfq_id = r.id AND q.is_winner = true
LEFT JOIN purchase_orders po ON po.requisition_id = pr.id OR po.quote_id = q.id
ORDER BY pr.requested_date DESC;

-- Add comment
COMMENT ON VIEW v_procurement_lineage IS 'Track procurement workflow from requisition through to PO';
