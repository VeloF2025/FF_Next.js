-- Migration 257: Performance indexes for commonly filtered columns
-- These columns appear in WHERE clauses across many API routes
-- Using CONCURRENTLY to avoid locking tables during creation
-- Using IF NOT EXISTS for idempotent re-runs

-- Projects: filtered by status in dashboard stats, project listings, reports
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_projects_status ON projects(status);

-- Projects: filtered by client_id in project listings, client detail pages
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_projects_client_id ON projects(client_id);

-- BOQs: filtered by status and project_id in procurement workflows
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_boqs_status ON boqs(status);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_boqs_project_id ON boqs(project_id);

-- RFQs: filtered by status and project_id in procurement workflows
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_rfqs_status ON rfqs(status);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_rfqs_project_id ON rfqs(project_id);

-- Purchase Orders: filtered by status, project_id in procurement and reporting
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_purchase_orders_status ON purchase_orders(status);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_purchase_orders_project_id ON purchase_orders(project_id);

-- Purchase Order Items: joined on purchase_order_id in PO detail views
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_purchase_order_items_po_id ON purchase_order_items(purchase_order_id);

-- Staff: filtered by status in dashboard stats, staff listings
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_staff_status ON staff(status);

-- Contractors: filtered by status in dashboard stats, contractor listings
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_contractors_status ON contractors(status);

-- Drops: filtered by project_id in SOW imports, project detail pages
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_drops_project_id ON drops(project_id);

-- SOW Poles: filtered by project_id in dashboard stats, SOW reports
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sow_poles_project_id ON sow_poles(project_id);

-- SOW Drops: filtered by project_id in dashboard summary
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sow_drops_project_id ON sow_drops(project_id);

-- Clients: filtered by status in client listings
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_clients_status ON clients(status);

-- Action Items: filtered by status in dashboard stats (open issues count)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_action_items_status ON action_items(status);
