-- Rollback 357: Remove FIELD-DEFAULT virtual destination location
--
-- Removes the row inserted by 357_field_default_location.sql.
-- Safe to run if the row was never inserted (DELETE on a non-existent row is a no-op).
--
-- WARNING: Before rolling back, ensure no stock_pickings rows reference this
-- location as source_location_id or destination_location_id, otherwise the
-- FK constraint will block the delete.

DELETE FROM stock_locations
WHERE id = '00000000-0000-0000-0000-000000000001';
