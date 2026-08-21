-- Rollback 519: remove the project-warehouse auto-provisioner.
--
-- Deliberately does NOT delete the warehouses the migration created. They may
-- already be referenced by goods receipts, stock levels or pickings (all FKs
-- into stock_locations), and dropping a site out from under booked stock is far
-- worse than leaving an extra dropdown entry. Deactivate them by hand if that
-- is really what you want:
--   UPDATE stock_locations SET is_active = false WHERE created_by = 'auto-provision';

DROP TRIGGER IF EXISTS tr_project_warehouse_on_active ON projects;
DROP FUNCTION IF EXISTS trg_project_warehouse();
DROP FUNCTION IF EXISTS ensure_project_warehouse(uuid);
DROP FUNCTION IF EXISTS generate_warehouse_code(text);
