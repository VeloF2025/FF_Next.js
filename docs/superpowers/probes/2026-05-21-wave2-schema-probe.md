# Wave 2 schema probe

**Filename date:** `2026-05-21` — preserved verbatim from the operative plan's PR-0 reference (`docs/superpowers/plans/2026-05-21-serial-master-register-wave2.md`).
**Capture date:** queries actually executed on 2026-05-22 SAST (the morning after Wave 1 deployed); content reflects live prod schema state at that time.

Captured against self-hosted Supabase at `100.96.203.105:5436/fibreflow` (the single DB shared by dev + prod since 2026-04-18). Connection string sourced from `.claude/credentials.local.md` — never inlined here.

This PR-0 was folded into the PR-7 worktree per Hein's 2026-05-22 decision rather than shipped as a standalone PR. The probe doc is identical in content; only the delivery vehicle changed.

## How to reproduce

The probe was executed via a `psql` heredoc; no `.sql` file is committed. To re-run, paste the SQL block below into a shell. `DATABASE_URL` is sourced from `.claude/credentials.local.md` (pooler on `100.96.203.105:5436`).

```bash
psql "$DATABASE_URL" <<'SQL'
\echo === stock_serials ===
\d stock_serials
\echo === stock_serial_events ===
\d stock_serial_events
\echo === stock_items ===
\d stock_items
\echo === stock_locations ===
\d stock_locations
\echo === projects ===
\d projects
\echo === drops ===
\d drops
\echo === oes_pp_data ===
\d oes_pp_data
\echo === users ===
\d users
\echo === staff ===
\d staff
\echo === access_permissions for procurement ===
SELECT key, label, route FROM access_permissions WHERE key LIKE 'procurement.%' ORDER BY key;
\echo === stock_serials row counts by status ===
SELECT status, COUNT(*) FROM stock_serials GROUP BY status ORDER BY 2 DESC;
\echo === stock_serial_events event_type / source_table distribution ===
SELECT event_type, source_table, COUNT(*) FROM stock_serial_events GROUP BY event_type, source_table ORDER BY 3 DESC;
\echo === stock_serial_events state transitions ===
SELECT from_state, to_state, COUNT(*) FROM stock_serial_events GROUP BY from_state, to_state ORDER BY 3 DESC;
\echo === Sample serial from Mohadin Loeks (returned 0 — see Validation gate section for the substituted anchor) ===
SELECT ss.id, ss.serial_number, ss.status, ss.mac_address, si.name, si.category, ss.installed_at_drop_number, ss.received_date
FROM stock_serials ss JOIN stock_items si ON si.id = ss.stock_item_id
WHERE ss.installed_at_drop_number LIKE 'DR%MOH%' OR ss.received_reference ILIKE '%mohadin%' OR ss.received_reference ILIKE '%loeks%'
LIMIT 5;
\echo === Confirm pseudo-trigger columns exist (UNVERIFIED in plan) ===
SELECT column_name FROM information_schema.columns WHERE table_name='stock_serials' AND column_name IN ('previous_status','status_changed_at') ORDER BY column_name;
\echo === Index on stock_serials.mac_address? ===
SELECT indexname, indexdef FROM pg_indexes WHERE tablename='stock_serials' AND indexdef ILIKE '%mac_address%';
\echo === Total stock_serials rows ===
SELECT COUNT(*) AS total_serials FROM stock_serials;
\echo === Serials with at least one event ===
SELECT COUNT(DISTINCT serial_id) AS serials_with_events FROM stock_serial_events;
\echo === migrations max version ===
SELECT MAX(version) FROM migrations;
SQL
```

The full output of every query above is preserved verbatim in the per-table sections below.

---

## stock_serials

```
                                          Table "public.stock_serials"
            Column            |           Type           | Collation | Nullable |            Default             
------------------------------+--------------------------+-----------+----------+--------------------------------
 id                           | uuid                     |           | not null | gen_random_uuid()
 stock_item_id                | uuid                     |           | not null | 
 serial_number                | character varying(100)   |           | not null | 
 mac_address                  | character varying(50)    |           |          | 
 imei                         | character varying(50)    |           |          | 
 current_location_id          | uuid                     |           |          | 
 status                       | character varying(50)    |           | not null | 'available'::character varying
 installed_at_drop_id         | uuid                     |           |          | 
 installed_at_drop_number     | character varying(50)    |           |          | 
 installed_at_home_install_id | uuid                     |           |          | 
 installed_date               | timestamp with time zone |           |          | 
 installed_by                 | character varying(255)   |           |          | 
 received_date                | date                     |           |          | 
 received_reference           | character varying(100)   |           |          | 
 warranty_end_date            | date                     |           |          | 
 condition                    | character varying(50)    |           |          | 'new'::character varying
 created_at                   | timestamp with time zone |           |          | now()
 updated_at                   | timestamp with time zone |           |          | now()
 previous_status              | character varying(50)    |           |          | 
 status_changed_at            | timestamp with time zone |           |          | 
 status_changed_by            | character varying(255)   |           |          | 
 fault_report_id              | uuid                     |           |          | 
 pp_flagged                   | boolean                  |           |          | false
 pp_flagged_at                | timestamp with time zone |           |          | 
 pp_resolution_status         | text                     |           |          | 
 allocated_to_project_id      | uuid                     |           |          | 
 activated_at_olt_id          | text                     |           |          | 
Indexes:
    "stock_serials_pkey" PRIMARY KEY, btree (id)
    "idx_ss_activated_olt" btree (activated_at_olt_id)
    "idx_ss_allocated_project" btree (allocated_to_project_id)
    "idx_stock_serials_drop" btree (installed_at_drop_id)
    "idx_stock_serials_location" btree (current_location_id)
    "idx_stock_serials_number" btree (serial_number)
    "idx_stock_serials_pp" btree (pp_flagged) WHERE pp_flagged = true
    "idx_stock_serials_status" btree (status)
    "idx_stock_serials_unique" UNIQUE, btree (stock_item_id, serial_number)
Check constraints:
    "stock_serials_status_check" CHECK (status::text = ANY (ARRAY['available','reserved','allocated_to_project','in_transit','issued','installed','activated','faulty','in_repair','returned','scrapped']))
```

Row counts by status:

```
  status   | count 
-----------+-------
 available | 34819
 activated |  1389
 installed |    56
(3 rows; total = 36264)
```

Only 3 of the 11 CHECK-allowed states are present in prod. The other 8 (`reserved`, `allocated_to_project`, `in_transit`, `issued`, `faulty`, `in_repair`, `returned`, `scrapped`) have zero rows. The components must still render the full 11-state vocabulary in filter UI so future state transitions surface immediately.

## stock_serial_events

```
                          Table "public.stock_serial_events"
     Column     |           Type           | Collation | Nullable |      Default      
----------------+--------------------------+-----------+----------+-------------------
 id             | uuid                     |           | not null | gen_random_uuid()
 serial_id      | uuid                     |           | not null | 
 event_type     | character varying(50)    |           | not null | 
 from_state     | character varying(50)    |           |          | 
 to_state       | character varying(50)    |           |          | 
 source_table   | character varying(50)    |           |          | 
 source_id      | uuid                     |           |          | 
 actor_user_id  | uuid                     |           |          | 
 actor_staff_id | uuid                     |           |          | 
 payload        | jsonb                    |           | not null | '{}'::jsonb
 occurred_at    | timestamp with time zone |           | not null | 
 recorded_at    | timestamp with time zone |           | not null | now()
Indexes:
    "stock_serial_events_pkey" PRIMARY KEY, btree (id)
    "idx_sse_event_type" btree (event_type, occurred_at DESC)
    "idx_sse_serial_time" btree (serial_id, occurred_at DESC)
    "idx_sse_source" btree (source_table, source_id)
    "uq_sse_dedupe" UNIQUE, btree (serial_id, source_table, source_id, event_type) WHERE source_id IS NOT NULL
```

Event-type / source-table distribution:

```
    event_type     | source_table | count 
-------------------+--------------+-------
 installed_at_drop | drops        |    56
 activated         | oes_pp_data  |    10
(2 rows; total = 66)
```

Transitions seen:

```
 from_state | to_state  | count 
------------+-----------+-------
 available  | installed |    56
 available  | activated |    10
```

Only 2 of the 8 triggers from migrations 364/366 have ever fired in prod. The picking, return, return-line, return-disposition, qa-install, and onemap-sync triggers have **never** emitted an event. The picking trigger was nonetheless verified to fire correctly in a separate transaction smoke (synthetic UPDATE / ROLLBACK) run before this probe — see commit message for synthetic verification details.

## stock_items

```
                                      Table "public.stock_items"
       Column        |            Type             | Collation | Nullable |          Default           
---------------------+-----------------------------+-----------+----------+----------------------------
 id                  | uuid                        |           | not null | gen_random_uuid()
 item_code           | character varying(100)      |           | not null | 
 name                | character varying(255)      |           | not null | 
 description         | text                        |           |          | 
 category            | character varying(100)      |           | not null | 
 tracking_type       | character varying(20)       |           | not null | 
 uom                 | character varying(20)       |           | not null | 'EA'::character varying
 standard_cost       | numeric(12,2)               |           |          | 
 currency            | character varying(3)        |           |          | 'ZAR'::character varying
 min_stock_level     | integer                     |           |          | 0
 max_stock_level     | integer                     |           |          | 
 reorder_quantity    | integer                     |           |          | 
 is_active           | boolean                     |           |          | true
 is_returnable       | boolean                     |           |          | false
 created_at          | timestamp with time zone    |           |          | now()
 updated_at          | timestamp with time zone    |           |          | now()
 odoo_product_id     | integer                     |           |          | 
 qty_available       | numeric                     |           |          | 0
 qty_reserved        | numeric                     |           |          | 0
 qty_on_order        | numeric                     |           |          | 0
 list_price          | numeric                     |           |          | 
 last_purchase_price | numeric                     |           |          | 
 product_type        | character varying(50)       |           |          | 'consu'::character varying
 purchase_ok         | boolean                     |           |          | true
 sale_ok             | boolean                     |           |          | false
 odoo_synced_at      | timestamp without time zone |           |          | 
 created_by          | character varying(100)      |           |          | 
 category_id         | uuid                        |           |          | 
 serial_number       | text                        |           |          | 
Indexes:
    "stock_items_pkey" PRIMARY KEY, btree (id)
    "idx_stock_items_active" btree (is_active)
    "idx_stock_items_category" btree (category)
    "idx_stock_items_category_id" btree (category_id)
    "idx_stock_items_odoo_product_id" btree (odoo_product_id) WHERE odoo_product_id IS NOT NULL
    "idx_stock_items_tracking" btree (tracking_type)
    "stock_items_item_code_key" UNIQUE CONSTRAINT, btree (item_code)
    "stock_items_odoo_product_id_key" UNIQUE CONSTRAINT, btree (odoo_product_id)
Check constraints:
    "stock_items_tracking_type_check" CHECK (tracking_type::text = ANY (ARRAY['serial'::character varying::text, 'lot'::character varying::text, 'quantity'::character varying::text, 'drum'::character varying::text, 'none'::character varying::text]))
Foreign-key constraints:
    "stock_items_category_id_fkey" FOREIGN KEY (category_id) REFERENCES stock_categories(id)
Referenced by:
    TABLE "assets" CONSTRAINT "assets_stock_item_id_fkey" FOREIGN KEY (stock_item_id) REFERENCES stock_items(id)
    TABLE "boq_items" CONSTRAINT "boq_items_stock_item_id_fkey" FOREIGN KEY (stock_item_id) REFERENCES stock_items(id)
    TABLE "cost_center_transactions" CONSTRAINT "cost_center_transactions_stock_item_id_fkey" FOREIGN KEY (stock_item_id) REFERENCES stock_items(id)
    TABLE "fault_reports" CONSTRAINT "fault_reports_stock_item_id_fkey" FOREIGN KEY (stock_item_id) REFERENCES stock_items(id)
    TABLE "field_stock_movements" CONSTRAINT "field_stock_movements_stock_item_id_fkey" FOREIGN KEY (stock_item_id) REFERENCES stock_items(id)
    TABLE "goods_receipt_items" CONSTRAINT "goods_receipt_items_stock_item_id_fkey" FOREIGN KEY (stock_item_id) REFERENCES stock_items(id)
    TABLE "purchase_order_items" CONSTRAINT "purchase_order_items_stock_item_id_fkey" FOREIGN KEY (stock_item_id) REFERENCES stock_items(id)
    TABLE "purchase_requisition_items" CONSTRAINT "purchase_requisition_items_stock_item_id_fkey" FOREIGN KEY (stock_item_id) REFERENCES stock_items(id)
    TABLE "rfq_items" CONSTRAINT "rfq_items_stock_item_id_fkey" FOREIGN KEY (stock_item_id) REFERENCES stock_items(id)
    TABLE "stock_bundle_items" CONSTRAINT "stock_bundle_items_stock_item_id_fkey" FOREIGN KEY (stock_item_id) REFERENCES stock_items(id) ON DELETE RESTRICT
    TABLE "stock_consumptions" CONSTRAINT "stock_consumptions_stock_item_id_fkey" FOREIGN KEY (stock_item_id) REFERENCES stock_items(id)
    TABLE "stock_levels" CONSTRAINT "stock_levels_stock_item_id_fkey" FOREIGN KEY (stock_item_id) REFERENCES stock_items(id) ON DELETE CASCADE
    TABLE "stock_picking_lines" CONSTRAINT "stock_picking_lines_stock_item_id_fkey" FOREIGN KEY (stock_item_id) REFERENCES stock_items(id)
    TABLE "stock_quants" CONSTRAINT "stock_quants_stock_item_id_fkey" FOREIGN KEY (stock_item_id) REFERENCES stock_items(id)
    TABLE "stock_return_lines" CONSTRAINT "stock_return_lines_stock_item_id_fkey" FOREIGN KEY (stock_item_id) REFERENCES stock_items(id)
    TABLE "stock_serials" CONSTRAINT "stock_serials_stock_item_id_fkey" FOREIGN KEY (stock_item_id) REFERENCES stock_items(id)
    TABLE "stock_take_adjustments" CONSTRAINT "stock_take_adjustments_stock_item_id_fkey" FOREIGN KEY (stock_item_id) REFERENCES stock_items(id)
    TABLE "stock_take_lines" CONSTRAINT "stock_take_lines_stock_item_id_fkey" FOREIGN KEY (stock_item_id) REFERENCES stock_items(id) ON DELETE RESTRICT
    TABLE "supplier_item_codes" CONSTRAINT "supplier_item_codes_stock_item_id_fkey" FOREIGN KEY (stock_item_id) REFERENCES stock_items(id) ON DELETE CASCADE
    TABLE "vendor_invoice_items" CONSTRAINT "vendor_invoice_items_stock_item_id_fkey" FOREIGN KEY (stock_item_id) REFERENCES stock_items(id)

```

## stock_locations

```
                                Table "public.stock_locations"
      Column       |           Type           | Collation | Nullable |         Default         
-------------------+--------------------------+-----------+----------+-------------------------
 id                | uuid                     |           | not null | gen_random_uuid()
 parent_id         | uuid                     |           |          | 
 code              | character varying(50)    |           | not null | 
 name              | character varying(255)   |           | not null | 
 location_type     | character varying(50)    |           | not null | 
 address           | text                     |           |          | 
 coordinates       | jsonb                    |           |          | 
 assigned_to_id    | uuid                     |           |          | 
 assigned_to_name  | character varying(255)   |           |          | 
 assigned_to_phone | character varying(50)    |           |          | 
 project_id        | uuid                     |           |          | 
 is_active         | boolean                  |           |          | true
 is_virtual        | boolean                  |           |          | false
 created_at        | timestamp with time zone |           |          | now()
 updated_at        | timestamp with time zone |           |          | now()
 created_by        | character varying(255)   |           |          | 
 bin_type          | character varying(50)    |           |          | NULL::character varying
Indexes:
    "stock_locations_pkey" PRIMARY KEY, btree (id)
    "idx_stock_locations_assigned" btree (assigned_to_id)
    "idx_stock_locations_assigned_to" btree (assigned_to_id) WHERE assigned_to_id IS NOT NULL
    "idx_stock_locations_parent" btree (parent_id)
    "idx_stock_locations_project" btree (project_id)
    "idx_stock_locations_type" btree (location_type)
    "stock_locations_code_key" UNIQUE CONSTRAINT, btree (code)
Check constraints:
    "stock_locations_bin_type_check" CHECK (bin_type::text = ANY (ARRAY['main'::character varying::text, 'department'::character varying::text, 'project'::character varying::text, 'technician'::character varying::text, 'in_transit'::character varying::text, 'faulty'::character varying::text, 'quarantine'::character varying::text]))
    "stock_locations_location_type_check" CHECK (location_type::text = ANY (ARRAY['warehouse'::character varying::text, 'site_store'::character varying::text, 'transit'::character varying::text, 'technician'::character varying::text, 'customer'::character varying::text, 'scrap'::character varying::text, 'adjustment'::character varying::text]))
Foreign-key constraints:
    "stock_locations_parent_id_fkey" FOREIGN KEY (parent_id) REFERENCES stock_locations(id)
Referenced by:
    TABLE "fault_reports" CONSTRAINT "fault_reports_location_id_fkey" FOREIGN KEY (location_id) REFERENCES stock_locations(id)
    TABLE "field_stock_movements" CONSTRAINT "field_stock_movements_from_location_id_fkey" FOREIGN KEY (from_location_id) REFERENCES stock_locations(id)
    TABLE "field_stock_movements" CONSTRAINT "field_stock_movements_to_location_id_fkey" FOREIGN KEY (to_location_id) REFERENCES stock_locations(id)
    TABLE "goods_receipt_items" CONSTRAINT "goods_receipt_items_location_id_fkey" FOREIGN KEY (location_id) REFERENCES stock_locations(id)
    TABLE "goods_receipt_notes" CONSTRAINT "goods_receipt_notes_warehouse_id_fkey" FOREIGN KEY (warehouse_id) REFERENCES stock_locations(id)
    TABLE "purchase_orders" CONSTRAINT "purchase_orders_warehouse_id_fkey" FOREIGN KEY (warehouse_id) REFERENCES stock_locations(id)
    TABLE "stock_consumptions" CONSTRAINT "stock_consumptions_consumed_from_location_id_fkey" FOREIGN KEY (consumed_from_location_id) REFERENCES stock_locations(id)
    TABLE "stock_levels" CONSTRAINT "stock_levels_location_id_fkey" FOREIGN KEY (location_id) REFERENCES stock_locations(id) ON DELETE SET NULL
    TABLE "stock_locations" CONSTRAINT "stock_locations_parent_id_fkey" FOREIGN KEY (parent_id) REFERENCES stock_locations(id)
    TABLE "stock_pickings" CONSTRAINT "stock_pickings_destination_location_id_fkey" FOREIGN KEY (destination_location_id) REFERENCES stock_locations(id)
    TABLE "stock_pickings" CONSTRAINT "stock_pickings_source_location_id_fkey" FOREIGN KEY (source_location_id) REFERENCES stock_locations(id)
    TABLE "stock_quants" CONSTRAINT "stock_quants_location_id_fkey" FOREIGN KEY (location_id) REFERENCES stock_locations(id)
    TABLE "stock_returns" CONSTRAINT "stock_returns_return_to_location_id_fkey" FOREIGN KEY (return_to_location_id) REFERENCES stock_locations(id)
    TABLE "stock_serials" CONSTRAINT "stock_serials_current_location_id_fkey" FOREIGN KEY (current_location_id) REFERENCES stock_locations(id)
    TABLE "stock_take_lines" CONSTRAINT "stock_take_lines_location_id_fkey" FOREIGN KEY (location_id) REFERENCES stock_locations(id)
    TABLE "stock_takes" CONSTRAINT "stock_takes_location_id_fkey" FOREIGN KEY (location_id) REFERENCES stock_locations(id)

```

## projects

```
                                          Table "public.projects"
        Column         |            Type             | Collation | Nullable |            Default            
-----------------------+-----------------------------+-----------+----------+-------------------------------
 id                    | uuid                        |           | not null | gen_random_uuid()
 project_code          | character varying(50)       |           | not null | 
 project_name          | character varying(255)      |           | not null | 
 client_id             | uuid                        |           |          | 
 description           | text                        |           |          | 
 project_type          | character varying(50)       |           |          | 
 status                | character varying(20)       |           |          | 'planning'::character varying
 priority              | character varying(20)       |           |          | 'medium'::character varying
 start_date            | date                        |           |          | 
 end_date              | date                        |           |          | 
 actual_start_date     | date                        |           |          | 
 actual_end_date       | date                        |           |          | 
 budget                | numeric(15,2)               |           |          | 
 actual_cost           | numeric(15,2)               |           |          | 
 project_manager       | uuid                        |           |          | 
 team_lead             | uuid                        |           |          | 
 location              | text                        |           |          | 
 latitude              | numeric(10,8)               |           |          | 
 longitude             | numeric(11,8)               |           |          | 
 progress_percentage   | integer                     |           |          | 0
 milestones            | jsonb                       |           |          | '[]'::jsonb
 deliverables          | jsonb                       |           |          | '[]'::jsonb
 risks                 | jsonb                       |           |          | '[]'::jsonb
 documents             | jsonb                       |           |          | '[]'::jsonb
 tags                  | jsonb                       |           |          | '[]'::jsonb
 metadata              | jsonb                       |           |          | '{}'::jsonb
 created_by            | uuid                        |           |          | 
 created_at            | timestamp without time zone |           |          | now()
 updated_at            | timestamp without time zone |           |          | now()
 progress              | numeric(5,2)                |           |          | 0
 completion_percentage | numeric(5,2)                |           |          | 0
 budget_status         | character varying(30)       |           |          | 'not_set'::character varying
 budget_health         | character varying(20)       |           |          | 'healthy'::character varying
 budget_utilization    | numeric(5,2)                |           |          | 0
 odoo_warehouse_code   | text                        |           |          | 
 odoo_warehouse_id     | integer                     |           |          | 
 requirements_met      | integer                     |           |          | 0
 requirements_total    | integer                     |           |          | 0
 expiring_docs_count   | integer                     |           |          | 0
 pipeline_project_id   | uuid                        |           |          | 
Indexes:
    "projects_pkey" PRIMARY KEY, btree (id)
    "idx_projects_client_id" btree (client_id)
    "idx_projects_created_at" btree (created_at DESC)
    "idx_projects_pipeline" btree (pipeline_project_id) WHERE pipeline_project_id IS NOT NULL
    "idx_projects_status" btree (status)
    "projects_client_idx" btree (client_id)
    "projects_code_idx" btree (project_code)
    "projects_manager_idx" btree (project_manager)
    "projects_project_code_unique" UNIQUE CONSTRAINT, btree (project_code)
    "projects_status_idx" btree (status)
Foreign-key constraints:
    "projects_client_id_clients_id_fk" FOREIGN KEY (client_id) REFERENCES clients(id)
    "projects_created_by_users_id_fk" FOREIGN KEY (created_by) REFERENCES users(id)
    "projects_pipeline_project_id_fkey" FOREIGN KEY (pipeline_project_id) REFERENCES pipeline_projects(id) ON DELETE SET NULL
    "projects_project_manager_staff_id_fk" FOREIGN KEY (project_manager) REFERENCES staff(id)
    "projects_team_lead_staff_id_fk" FOREIGN KEY (team_lead) REFERENCES staff(id)
Referenced by:
    TABLE "cable_spans" CONSTRAINT "cable_spans_project_id_fkey" FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    TABLE "client_purchase_orders" CONSTRAINT "client_purchase_orders_project_id_fkey" FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    TABLE "construction_qa_photos" CONSTRAINT "construction_qa_photos_project_id_fkey" FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    TABLE "construction_qa_reviews" CONSTRAINT "construction_qa_reviews_project_id_fkey" FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    TABLE "contractor_agreements" CONSTRAINT "contractor_agreements_project_id_fkey" FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    TABLE "contractor_projects" CONSTRAINT "contractor_projects_project_id_fkey" FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    TABLE "cost_centers" CONSTRAINT "cost_centers_project_id_fkey" FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    TABLE "customer_invoices" CONSTRAINT "customer_invoices_project_id_fkey" FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    TABLE "daily_progress" CONSTRAINT "daily_progress_project_id_projects_id_fk" FOREIGN KEY (project_id) REFERENCES projects(id)
    TABLE "document_cross_validations" CONSTRAINT "document_cross_validations_project_id_fkey" FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    TABLE "document_expiry_tracking" CONSTRAINT "document_expiry_tracking_project_id_fkey" FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
    TABLE "fiber_stringing" CONSTRAINT "fiber_stringing_project_id_projects_id_fk" FOREIGN KEY (project_id) REFERENCES projects(id)
    TABLE "fleet_vehicle_project_assignments" CONSTRAINT "fleet_vehicle_project_assignments_project_id_fkey" FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    TABLE "home_installations" CONSTRAINT "home_installations_project_id_projects_id_fk" FOREIGN KEY (project_id) REFERENCES projects(id)
    TABLE "hs_corrective_actions" CONSTRAINT "hs_corrective_actions_project_id_fkey" FOREIGN KEY (project_id) REFERENCES projects(id)
    TABLE "hs_risk_register" CONSTRAINT "hs_risk_register_project_id_fkey" FOREIGN KEY (project_id) REFERENCES projects(id)
    TABLE "infrastructure_installations" CONSTRAINT "infrastructure_installations_project_id_fkey" FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    TABLE "joints" CONSTRAINT "joints_project_id_fkey" FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    TABLE "nokia_equipment" CONSTRAINT "nokia_equipment_project_id_projects_id_fk" FOREIGN KEY (project_id) REFERENCES projects(id)
    TABLE "one_map" CONSTRAINT "one_map_project_id_projects_id_fk" FOREIGN KEY (project_id) REFERENCES projects(id)
    TABLE "pipeline_projects" CONSTRAINT "pipeline_projects_planned_project_id_fkey" FOREIGN KEY (planned_project_id) REFERENCES projects(id) ON DELETE SET NULL
    TABLE "pole_checklist" CONSTRAINT "pole_checklist_project_id_fkey" FOREIGN KEY (project_id) REFERENCES projects(id)
    TABLE "pole_install_sessions" CONSTRAINT "pole_install_sessions_project_id_fkey" FOREIGN KEY (project_id) REFERENCES projects(id)
    TABLE "pole_qa_photos" CONSTRAINT "pole_qa_photos_project_id_fkey" FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    TABLE "poles" CONSTRAINT "poles_project_id_projects_id_fk" FOREIGN KEY (project_id) REFERENCES projects(id)
    TABLE "pon_boundaries" CONSTRAINT "pon_boundaries_project_id_fkey" FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    TABLE "pon_stage_tracking" CONSTRAINT "pon_stage_tracking_project_id_fkey" FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    TABLE "pops" CONSTRAINT "pops_project_id_fkey" FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    TABLE "procurement_threads" CONSTRAINT "procurement_threads_project_id_fkey" FOREIGN KEY (project_id) REFERENCES projects(id)
    TABLE "project_budgets" CONSTRAINT "project_budgets_project_id_fkey" FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    TABLE "project_documents" CONSTRAINT "project_documents_project_id_fkey" FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    TABLE "project_monthly_targets" CONSTRAINT "project_monthly_targets_project_id_fkey" FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    TABLE "project_pipeline_links" CONSTRAINT "project_pipeline_links_project_id_fkey" FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    TABLE "project_requirements" CONSTRAINT "project_requirements_project_id_fkey" FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    TABLE "project_team_assignments" CONSTRAINT "project_team_assignments_project_id_fkey" FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    TABLE "project_weekly_zone_pon_uptake" CONSTRAINT "project_weekly_zone_pon_uptake_project_id_fkey" FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    TABLE "project_weekly_zone_uptake" CONSTRAINT "project_weekly_zone_uptake_project_id_fkey" FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    TABLE "purchase_orders" CONSTRAINT "purchase_orders_project_id_fkey" FOREIGN KEY (project_id) REFERENCES projects(id)
    TABLE "purchase_requisitions" CONSTRAINT "purchase_requisitions_project_id_fkey" FOREIGN KEY (project_id) REFERENCES projects(id)
    TABLE "qfield_import_jobs" CONSTRAINT "qfield_import_jobs_project_id_fkey" FOREIGN KEY (project_id) REFERENCES projects(id)
    TABLE "qfield_project_links" CONSTRAINT "qfield_project_links_fibreflow_project_id_fkey" FOREIGN KEY (fibreflow_project_id) REFERENCES projects(id) ON DELETE CASCADE
    TABLE "recurring_invoices" CONSTRAINT "recurring_invoices_project_id_fkey" FOREIGN KEY (project_id) REFERENCES projects(id)
    TABLE "reports" CONSTRAINT "reports_project_id_projects_id_fk" FOREIGN KEY (project_id) REFERENCES projects(id)
    TABLE "sage_analysis_categories" CONSTRAINT "sage_analysis_categories_ff_project_id_fkey" FOREIGN KEY (ff_project_id) REFERENCES projects(id)
    TABLE "sage_ledger_transactions" CONSTRAINT "sage_ledger_transactions_ff_project_id_fkey" FOREIGN KEY (ff_project_id) REFERENCES projects(id)
    TABLE "site_diary_entries" CONSTRAINT "site_diary_entries_project_id_fkey" FOREIGN KEY (project_id) REFERENCES projects(id)
    TABLE "site_visits" CONSTRAINT "site_visits_project_id_fkey" FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    TABLE "snag_reports" CONSTRAINT "snag_reports_project_id_fkey" FOREIGN KEY (project_id) REFERENCES projects(id)
    TABLE "snags" CONSTRAINT "snags_project_id_fkey" FOREIGN KEY (project_id) REFERENCES projects(id)
    TABLE "sow" CONSTRAINT "sow_project_id_projects_id_fk" FOREIGN KEY (project_id) REFERENCES projects(id)
    TABLE "sp_pon_tracker" CONSTRAINT "sp_pon_tracker_project_id_fkey" FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    TABLE "sp_project_summary" CONSTRAINT "sp_project_summary_project_id_fkey" FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    TABLE "sp_tracker_config" CONSTRAINT "sp_tracker_config_project_id_fkey" FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    TABLE "spare_usage_log" CONSTRAINT "spare_usage_log_project_id_fkey" FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    TABLE "staff_projects" CONSTRAINT "staff_projects_project_id_fkey" FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    TABLE "staff_receipts" CONSTRAINT "staff_receipts_project_id_fkey" FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
    TABLE "stock_serials" CONSTRAINT "stock_serials_allocated_to_project_id_fkey" FOREIGN KEY (allocated_to_project_id) REFERENCES projects(id)
    TABLE "stock_takes" CONSTRAINT "stock_takes_project_id_fkey" FOREIGN KEY (project_id) REFERENCES projects(id)
    TABLE "tasks" CONSTRAINT "tasks_project_id_projects_id_fk" FOREIGN KEY (project_id) REFERENCES projects(id)
    TABLE "teams" CONSTRAINT "teams_project_id_fkey" FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
    TABLE "wa_monitored_groups" CONSTRAINT "wa_monitored_groups_project_id_fkey" FOREIGN KEY (project_id) REFERENCES projects(id)
    TABLE "zone_boundaries" CONSTRAINT "zone_boundaries_project_id_fkey" FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE

```

## drops

```
                                            Table "public.drops"
         Column          |            Type             | Collation | Nullable |           Default            
-------------------------+-----------------------------+-----------+----------+------------------------------
 id                      | uuid                        |           | not null | gen_random_uuid()
 drop_number             | character varying(100)      |           | not null | 
 pole_number             | character varying(100)      |           |          | 
 project_id              | uuid                        |           | not null | 
 address                 | text                        |           |          | 
 customer_name           | character varying(255)      |           |          | 
 cable_length            | character varying(50)       |           |          | 
 installation_date       | date                        |           |          | 
 status                  | character varying(50)       |           |          | 'planned'::character varying
 notes                   | text                        |           |          | 
 metadata                | jsonb                       |           |          | '{}'::jsonb
 created_at              | timestamp without time zone |           |          | CURRENT_TIMESTAMP
 updated_at              | timestamp without time zone |           |          | CURRENT_TIMESTAMP
 qc_status               | character varying(20)       |           |          | 'pending'::character varying
 qc_updated_at           | timestamp without time zone |           |          | CURRENT_TIMESTAMP
 ont_serial              | character varying(100)      |           |          | 
 mini_ups_serial         | character varying(100)      |           |          | 
 router_serial           | character varying(100)      |           |          | 
 ont_consumption_id      | uuid                        |           |          | 
 mini_ups_consumption_id | uuid                        |           |          | 
 materials_issued        | boolean                     |           |          | false
 materials_verified      | boolean                     |           |          | false
 installed_by_id         | uuid                        |           |          | 
 installed_by_name       | character varying(255)      |           |          | 
 installed_at            | timestamp with time zone    |           |          | 
 cable_type              | character varying(50)       |           |          | 
 cable_spec              | character varying(100)      |           |          | 
 cable_capacity          | character varying(20)       |           |          | 
 start_point             | character varying(100)      |           |          | 
 end_point               | character varying(100)      |           |          | 
 municipality            | character varying(100)      |           |          | 
 pon_no                  | integer                     |           |          | 
 zone_no                 | integer                     |           |          | 
 created_by              | character varying(100)      |           |          | 
 raw_data                | jsonb                       |           |          | 
 latitude                | numeric                     |           |          | 
 longitude               | numeric                     |           |          | 
 site_submitted_at       | timestamp with time zone    |           |          | 
 site_submitted_by       | character varying(50)       |           |          | 
 oes_confirmed_at        | timestamp with time zone    |           |          | 
 site_submitted          | boolean                     |           |          | false
 site_submitted_project  | character varying(100)      |           |          | 
 site_project_mismatch   | boolean                     |           |          | false
 oes_confirmed           | boolean                     |           |          | false
 is_offline              | boolean                     |           |          | false
 offline_since           | timestamp with time zone    |           |          | 
 offline_reason          | character varying(100)      |           |          | 
 offline_days            | integer                     |           |          | 
 last_offline_check      | timestamp with time zone    |           |          | 
 client_po_id            | uuid                        |           |          | 
 invoiced                | boolean                     |           |          | false
 invoice_id              | uuid                        |           |          | 
 source                  | character varying(50)       |           |          | 'sow'::character varying
 is_spare                | boolean                     |           |          | false
Indexes:
    "drops_pkey" PRIMARY KEY, btree (id)
    "drops_project_drop_unique" UNIQUE CONSTRAINT, btree (project_id, drop_number)
    "idx_drops_client_po" btree (client_po_id)
    "idx_drops_drop_number" btree (drop_number)
    "idx_drops_installed_by" btree (installed_by_id)
    "idx_drops_invoice_id" btree (invoice_id)
    "idx_drops_invoiced" btree (invoiced) WHERE invoiced = false
    "idx_drops_is_spare" btree (project_id, is_spare) WHERE is_spare = true
    "idx_drops_materials_issued" btree (materials_issued)
    "idx_drops_mini_ups_serial" btree (mini_ups_serial)
    "idx_drops_oes_confirmed" btree (oes_confirmed) WHERE oes_confirmed = true
    "idx_drops_ont_serial" btree (ont_serial)
    "idx_drops_pole_number" btree (pole_number)
    "idx_drops_pon_zone" btree (project_id, pon_no, zone_no)
    "idx_drops_project_id" btree (project_id)
    "idx_drops_qc_status" btree (qc_status)
    "idx_drops_site_submitted" btree (site_submitted) WHERE site_submitted = true
    "idx_drops_status" btree (status)
Check constraints:
    "drops_qc_status_check" CHECK (qc_status::text = ANY (ARRAY['pending'::character varying::text, 'approved'::character varying::text, 'needs-rectification'::character varying::text]))
Foreign-key constraints:
    "drops_client_po_id_fkey" FOREIGN KEY (client_po_id) REFERENCES client_purchase_orders(id)
    "drops_invoice_id_fkey" FOREIGN KEY (invoice_id) REFERENCES customer_invoices(id)
Referenced by:
    TABLE "checklist_items" CONSTRAINT "checklist_items_drop_id_fkey" FOREIGN KEY (drop_id) REFERENCES drops(id) ON DELETE CASCADE
    TABLE "customer_invoice_items" CONSTRAINT "customer_invoice_items_drop_id_fkey" FOREIGN KEY (drop_id) REFERENCES drops(id)
    TABLE "drop_submissions" CONSTRAINT "drop_submissions_drop_id_fkey" FOREIGN KEY (drop_id) REFERENCES drops(id) ON DELETE CASCADE
    TABLE "notification_logs" CONSTRAINT "notification_logs_drop_id_fkey" FOREIGN KEY (drop_id) REFERENCES drops(id) ON DELETE CASCADE
    TABLE "oes_activations" CONSTRAINT "oes_activations_drop_id_fkey" FOREIGN KEY (drop_id) REFERENCES drops(id)
    TABLE "pon_change_log" CONSTRAINT "pon_change_log_drop_id_fkey" FOREIGN KEY (drop_id) REFERENCES drops(id) ON DELETE SET NULL
    TABLE "quality_metrics" CONSTRAINT "quality_metrics_drop_id_fkey" FOREIGN KEY (drop_id) REFERENCES drops(id) ON DELETE CASCADE
    TABLE "spare_usage_log" CONSTRAINT "spare_usage_log_replaced_drop_id_fkey" FOREIGN KEY (replaced_drop_id) REFERENCES drops(id)
    TABLE "spare_usage_log" CONSTRAINT "spare_usage_log_spare_drop_id_fkey" FOREIGN KEY (spare_drop_id) REFERENCES drops(id)
Triggers:
    emit_serial_event_on_drop_install AFTER UPDATE OF ont_serial ON drops FOR EACH ROW WHEN (new.ont_serial IS NOT NULL AND new.ont_serial::text <> ''::text AND (old.ont_serial IS NULL OR old.ont_serial::text <> new.ont_serial::text)) EXECUTE FUNCTION trg_emit_serial_event_on_drop_install()
    trg_drops_client_po_assigned AFTER UPDATE OF client_po_id ON drops FOR EACH ROW EXECUTE FUNCTION update_client_po_drops_assigned()
    trg_drops_spares_allocated AFTER UPDATE OF client_po_id, is_spare ON drops FOR EACH ROW EXECUTE FUNCTION update_client_po_spares_allocated()

```

## oes_pp_data

```
                                            Table "public.oes_pp_data"
        Column         |           Type           | Collation | Nullable |                 Default                 
-----------------------+--------------------------+-----------+----------+-----------------------------------------
 id                    | integer                  |           | not null | nextval('oes_pp_data_id_seq'::regclass)
 serial_number         | text                     |           | not null | 
 project               | text                     |           | not null | 
 date_registered       | date                     |           |          | 
 resolution_status     | text                     |           | not null | 'not_found'::text
 resolved_drop_number  | text                     |           |          | 
 resolved_source       | text                     |           |          | 
 resolved_details      | jsonb                    |           |          | 
 resolved_at           | timestamp with time zone |           |          | 
 import_batch_id       | integer                  |           |          | 
 created_at            | timestamp with time zone |           |          | now()
 updated_at            | timestamp with time zone |           |          | now()
 maintenance_ticket_id | uuid                     |           |          | 
 ticket_id             | uuid                     |           |          | 
 latitude              | numeric                  |           |          | 
 longitude             | numeric                  |           |          | 
 olt_port              | text                     |           |          | 
 olt_address           | text                     |           |          | 
 olt_name              | text                     |           |          | 
 olt_lt                | smallint                 |           |          | 
 olt_pon               | smallint                 |           |          | 
 olt_ont_pos           | smallint                 |           |          | 
 first_resolved_at     | timestamp with time zone |           |          | 
Indexes:
    "oes_pp_data_pkey" PRIMARY KEY, btree (id)
    "idx_oes_pp_data_batch" btree (import_batch_id)
    "idx_oes_pp_data_first_resolved_at" btree (first_resolved_at DESC NULLS LAST) WHERE first_resolved_at IS NOT NULL
    "idx_oes_pp_data_maintenance_ticket" btree (maintenance_ticket_id) WHERE maintenance_ticket_id IS NOT NULL
    "idx_oes_pp_data_olt_lt" btree (olt_lt) WHERE olt_lt IS NOT NULL
    "idx_oes_pp_data_olt_pon" btree (olt_pon) WHERE olt_pon IS NOT NULL
    "idx_oes_pp_data_project" btree (project)
    "idx_oes_pp_data_serial" btree (serial_number)
    "idx_oes_pp_data_status" btree (resolution_status)
    "idx_pp_ticket" btree (ticket_id) WHERE ticket_id IS NOT NULL
    "oes_pp_data_serial_number_project_key" UNIQUE CONSTRAINT, btree (serial_number, project)
Check constraints:
    "oes_pp_data_resolution_status_check" CHECK (resolution_status = ANY (ARRAY['not_found'::text, 'located_oes'::text, 'located_unified'::text, 'located_onemap'::text, 'located_1map'::text, 'located_local'::text, 'activated'::text]))
Foreign-key constraints:
    "oes_pp_data_import_batch_id_fkey" FOREIGN KEY (import_batch_id) REFERENCES oes_pp_import_batches(id)
    "oes_pp_data_ticket_id_fkey" FOREIGN KEY (ticket_id) REFERENCES maintenance_tickets(id) ON DELETE SET NULL
Referenced by:
    TABLE "ont_swap_records" CONSTRAINT "ont_swap_records_pp_data_id_fkey" FOREIGN KEY (pp_data_id) REFERENCES oes_pp_data(id) ON DELETE SET NULL
Triggers:
    emit_serial_event_on_oes_activate AFTER INSERT ON oes_pp_data FOR EACH ROW EXECUTE FUNCTION trg_emit_serial_event_on_oes_activate()

```

## users

```
                                         Table "public.users"
       Column        |            Type             | Collation | Nullable |          Default          
---------------------+-----------------------------+-----------+----------+---------------------------
 id                  | uuid                        |           | not null | gen_random_uuid()
 email               | character varying(255)      |           | not null | 
 password            | character varying(255)      |           |          | 
 first_name          | character varying(100)      |           |          | 
 last_name           | character varying(100)      |           |          | 
 role                | character varying(50)       |           |          | 'user'::character varying
 permissions         | jsonb                       |           |          | '[]'::jsonb
 is_active           | boolean                     |           |          | true
 last_login          | timestamp without time zone |           |          | 
 profile_picture     | text                        |           |          | 
 phone_number        | character varying(20)       |           |          | 
 department          | character varying(100)      |           |          | 
 created_at          | timestamp without time zone |           |          | now()
 updated_at          | timestamp without time zone |           |          | now()
 reset_token         | character varying(255)      |           |          | 
 reset_token_expires | timestamp with time zone    |           |          | 
 password_changed_at | timestamp with time zone    |           |          | 
Indexes:
    "users_pkey" PRIMARY KEY, btree (id)
    "idx_users_auth_lookup" btree (id, is_active) INCLUDE (email, first_name, last_name, role, permissions, profile_picture, department)
    "idx_users_reset_token" btree (reset_token) WHERE reset_token IS NOT NULL
    "users_email_idx" btree (email)
    "users_email_unique" UNIQUE CONSTRAINT, btree (email)
    "users_role_idx" btree (role)
Referenced by:
    TABLE "action_items" CONSTRAINT "action_items_assigned_to_user_id_fkey" FOREIGN KEY (assigned_to_user_id) REFERENCES users(id)
    TABLE "attendance_adjustments" CONSTRAINT "attendance_adjustments_reviewed_by_fkey" FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL
    TABLE "attendance_bulk_action_audit" CONSTRAINT "attendance_bulk_action_audit_actor_user_id_fkey" FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE RESTRICT
    TABLE "attendance_exceptions" CONSTRAINT "attendance_exceptions_resolved_by_fkey" FOREIGN KEY (resolved_by) REFERENCES users(id) ON DELETE SET NULL
    TABLE "attendance_search_presets" CONSTRAINT "attendance_search_presets_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    TABLE "attendance_selfie_access_log" CONSTRAINT "attendance_selfie_access_log_viewed_by_fkey" FOREIGN KEY (viewed_by) REFERENCES users(id) ON DELETE CASCADE
    TABLE "attendance_weekly_locks" CONSTRAINT "attendance_weekly_locks_locked_by_fkey" FOREIGN KEY (locked_by) REFERENCES users(id) ON DELETE RESTRICT
    TABLE "attendance_weekly_locks" CONSTRAINT "attendance_weekly_locks_unlocked_by_fkey" FOREIGN KEY (unlocked_by) REFERENCES users(id) ON DELETE SET NULL
    TABLE "billable_fee_schedule" CONSTRAINT "billable_fee_schedule_created_by_fkey" FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
    TABLE "boq_change_log" CONSTRAINT "boq_change_log_changed_by_fkey" FOREIGN KEY (changed_by) REFERENCES users(id)
    TABLE "client_contracts" CONSTRAINT "client_contracts_created_by_fkey" FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
    TABLE "clients" CONSTRAINT "clients_created_by_users_id_fk" FOREIGN KEY (created_by) REFERENCES users(id)
    TABLE "conduit_project_versions" CONSTRAINT "conduit_project_versions_created_by_fkey" FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
    TABLE "contractor_invoices" CONSTRAINT "contractor_invoices_created_by_fkey" FOREIGN KEY (created_by) REFERENCES users(id)
    TABLE "contractor_payments" CONSTRAINT "contractor_payments_recorded_by_fkey" FOREIGN KEY (recorded_by) REFERENCES users(id)
    TABLE "contractor_progress_claims" CONSTRAINT "contractor_progress_claims_reviewed_by_fkey" FOREIGN KEY (reviewed_by) REFERENCES users(id)
    TABLE "contractor_progress_claims" CONSTRAINT "contractor_progress_claims_submitted_by_fkey" FOREIGN KEY (submitted_by) REFERENCES users(id)
    TABLE "credit_notes" CONSTRAINT "credit_notes_cancelled_by_fkey" FOREIGN KEY (cancelled_by) REFERENCES users(id)
    TABLE "customer_payments" CONSTRAINT "customer_payments_cancelled_by_fkey" FOREIGN KEY (cancelled_by) REFERENCES users(id)
    TABLE "daily_progress" CONSTRAINT "daily_progress_created_by_users_id_fk" FOREIGN KEY (created_by) REFERENCES users(id)
    TABLE "dev_ticket_details" CONSTRAINT "dev_ticket_details_agent_approved_by_fkey" FOREIGN KEY (agent_approved_by) REFERENCES users(id)
    TABLE "dunning_communications" CONSTRAINT "dunning_communications_created_by_fkey" FOREIGN KEY (created_by) REFERENCES users(id)
    TABLE "email_outbox" CONSTRAINT "email_outbox_sender_id_fkey" FOREIGN KEY (sender_id) REFERENCES users(id)
    TABLE "fiber_stringing" CONSTRAINT "fiber_stringing_created_by_users_id_fk" FOREIGN KEY (created_by) REFERENCES users(id)
    TABLE "home_installations" CONSTRAINT "home_installations_created_by_users_id_fk" FOREIGN KEY (created_by) REFERENCES users(id)
    TABLE "hs_capa_comments" CONSTRAINT "hs_capa_comments_author_id_fkey" FOREIGN KEY (author_id) REFERENCES users(id)
    TABLE "hs_corrective_actions" CONSTRAINT "hs_corrective_actions_assigned_to_fkey" FOREIGN KEY (assigned_to) REFERENCES users(id)
    TABLE "hs_corrective_actions" CONSTRAINT "hs_corrective_actions_completed_by_fkey" FOREIGN KEY (completed_by) REFERENCES users(id)
    TABLE "hs_corrective_actions" CONSTRAINT "hs_corrective_actions_created_by_fkey" FOREIGN KEY (created_by) REFERENCES users(id)
    TABLE "hs_corrective_actions" CONSTRAINT "hs_corrective_actions_verified_by_fkey" FOREIGN KEY (verified_by) REFERENCES users(id)
    TABLE "hs_risk_register" CONSTRAINT "hs_risk_register_created_by_fkey" FOREIGN KEY (created_by) REFERENCES users(id)
    TABLE "hs_risk_register" CONSTRAINT "hs_risk_register_responsible_person_fkey" FOREIGN KEY (responsible_person) REFERENCES users(id)
    TABLE "hs_risk_register_reviews" CONSTRAINT "hs_risk_register_reviews_reviewed_by_fkey" FOREIGN KEY (reviewed_by) REFERENCES users(id)
    TABLE "hs_ticket_details" CONSTRAINT "hs_ticket_details_dol_reported_by_fkey" FOREIGN KEY (dol_reported_by) REFERENCES users(id)
    TABLE "hs_ticket_details" CONSTRAINT "hs_ticket_details_investigated_by_fkey" FOREIGN KEY (investigated_by) REFERENCES users(id)
    TABLE "internal_message_recipients" CONSTRAINT "internal_message_recipients_recipient_id_fkey" FOREIGN KEY (recipient_id) REFERENCES users(id)
    TABLE "internal_messages" CONSTRAINT "internal_messages_sender_id_fkey" FOREIGN KEY (sender_id) REFERENCES users(id)
    TABLE "maintenance_qa_checks" CONSTRAINT "maintenance_qa_checks_checked_by_fkey" FOREIGN KEY (checked_by) REFERENCES users(id)
    TABLE "manco_action_item_comments" CONSTRAINT "manco_action_item_comments_author_user_id_fkey" FOREIGN KEY (author_user_id) REFERENCES users(id) ON DELETE SET NULL
    TABLE "nokia_equipment" CONSTRAINT "nokia_equipment_created_by_users_id_fk" FOREIGN KEY (created_by) REFERENCES users(id)
    TABLE "notification_delivery_log" CONSTRAINT "notification_delivery_log_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    TABLE "notification_preferences" CONSTRAINT "notification_preferences_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    TABLE "olt_mismatch_records" CONSTRAINT "olt_mismatch_records_escalated_by_fkey" FOREIGN KEY (escalated_by) REFERENCES users(id)
    TABLE "olt_mismatch_records" CONSTRAINT "olt_mismatch_records_escalated_to_fkey" FOREIGN KEY (escalated_to) REFERENCES users(id)
    TABLE "olt_mismatch_records" CONSTRAINT "olt_mismatch_records_fix_by_fkey" FOREIGN KEY (fix_by) REFERENCES users(id)
    TABLE "olt_mismatch_records" CONSTRAINT "olt_mismatch_records_resolved_by_fkey" FOREIGN KEY (resolved_by) REFERENCES users(id)
    TABLE "olt_report_imports" CONSTRAINT "olt_report_imports_imported_by_fkey" FOREIGN KEY (imported_by) REFERENCES users(id)
    TABLE "one_map" CONSTRAINT "one_map_created_by_users_id_fk" FOREIGN KEY (created_by) REFERENCES users(id)
    TABLE "ont_swap_records" CONSTRAINT "ont_swap_records_reviewed_by_fkey" FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL
    TABLE "payslip_import_skips" CONSTRAINT "payslip_import_skips_skipped_by_fkey" FOREIGN KEY (skipped_by) REFERENCES users(id) ON DELETE SET NULL
    TABLE "payslips" CONSTRAINT "payslips_imported_by_fkey" FOREIGN KEY (imported_by) REFERENCES users(id) ON DELETE SET NULL
    TABLE "poles" CONSTRAINT "poles_created_by_users_id_fk" FOREIGN KEY (created_by) REFERENCES users(id)
    TABLE "project_guarantees" CONSTRAINT "project_guarantees_created_by_fkey" FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
    TABLE "projects" CONSTRAINT "projects_created_by_users_id_fk" FOREIGN KEY (created_by) REFERENCES users(id)
    TABLE "reports" CONSTRAINT "reports_generated_by_users_id_fk" FOREIGN KEY (generated_by) REFERENCES users(id)
    TABLE "site_visits" CONSTRAINT "site_visits_inspector_id_fkey" FOREIGN KEY (inspector_id) REFERENCES users(id) ON DELETE SET NULL
    TABLE "snag_photos" CONSTRAINT "snag_photos_uploaded_by_fkey" FOREIGN KEY (uploaded_by) REFERENCES users(id)
    TABLE "snag_reports" CONSTRAINT "snag_reports_generated_by_fkey" FOREIGN KEY (generated_by) REFERENCES users(id)
    TABLE "snag_reports" CONSTRAINT "snag_reports_imported_by_fkey" FOREIGN KEY (imported_by) REFERENCES users(id)
    TABLE "snag_share_tokens" CONSTRAINT "snag_share_tokens_created_by_fkey" FOREIGN KEY (created_by) REFERENCES users(id)
    TABLE "snags" CONSTRAINT "snags_assigned_to_fkey" FOREIGN KEY (assigned_to) REFERENCES users(id)
    TABLE "snags" CONSTRAINT "snags_fixed_by_fkey" FOREIGN KEY (fixed_by) REFERENCES users(id)
    TABLE "snags" CONSTRAINT "snags_verified_by_fkey" FOREIGN KEY (verified_by) REFERENCES users(id)
    TABLE "sow" CONSTRAINT "sow_approved_by_users_id_fk" FOREIGN KEY (approved_by) REFERENCES users(id)
    TABLE "sow" CONSTRAINT "sow_created_by_users_id_fk" FOREIGN KEY (created_by) REFERENCES users(id)
    TABLE "staff" CONSTRAINT "staff_created_by_users_id_fk" FOREIGN KEY (created_by) REFERENCES users(id)
    TABLE "staff_receipts" CONSTRAINT "staff_receipts_reviewed_by_fkey" FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL
    TABLE "staff" CONSTRAINT "staff_user_id_users_id_fk" FOREIGN KEY (user_id) REFERENCES users(id)
    TABLE "stock_serial_events" CONSTRAINT "stock_serial_events_actor_user_id_fkey" FOREIGN KEY (actor_user_id) REFERENCES users(id)
    TABLE "system_feature_settings" CONSTRAINT "system_feature_settings_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES users(id)
    TABLE "tasks" CONSTRAINT "tasks_assigned_by_users_id_fk" FOREIGN KEY (assigned_by) REFERENCES users(id)
    TABLE "tasks" CONSTRAINT "tasks_assigned_to_users_id_fk" FOREIGN KEY (assigned_to) REFERENCES users(id)
    TABLE "tasks" CONSTRAINT "tasks_created_by_users_id_fk" FOREIGN KEY (created_by) REFERENCES users(id)
    TABLE "maintenance_assignment_history" CONSTRAINT "ticket_assignment_history_assigned_by_fkey" FOREIGN KEY (assigned_by) REFERENCES users(id) ON DELETE RESTRICT
    TABLE "maintenance_assignment_history" CONSTRAINT "ticket_assignment_history_assigned_to_fkey" FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE SET NULL
    TABLE "maintenance_assignment_history" CONSTRAINT "ticket_assignment_history_previous_assignee_fkey" FOREIGN KEY (previous_assignee) REFERENCES users(id) ON DELETE SET NULL
    TABLE "maintenance_attachments" CONSTRAINT "ticket_attachments_uploaded_by_fkey" FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE RESTRICT
    TABLE "maintenance_billing" CONSTRAINT "ticket_billing_approved_by_fkey" FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL
    TABLE "maintenance_history" CONSTRAINT "ticket_history_changed_by_fkey" FOREIGN KEY (changed_by) REFERENCES users(id) ON DELETE SET NULL
    TABLE "maintenance_notes" CONSTRAINT "ticket_notes_created_by_fkey" FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT
    TABLE "maintenance_tags" CONSTRAINT "ticket_tags_created_by_fkey" FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
    TABLE "maintenance_tickets" CONSTRAINT "tickets_billing_approved_by_fkey" FOREIGN KEY (billing_approved_by) REFERENCES users(id) ON DELETE SET NULL
    TABLE "maintenance_tickets" CONSTRAINT "tickets_created_by_fkey" FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT
    TABLE "user_audit_log" CONSTRAINT "user_audit_log_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id)
    TABLE "user_communication_settings" CONSTRAINT "user_communication_settings_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    TABLE "user_notifications" CONSTRAINT "user_notifications_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    TABLE "user_page_visits" CONSTRAINT "user_page_visits_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    TABLE "user_pinned_links" CONSTRAINT "user_pinned_links_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    TABLE "user_sessions" CONSTRAINT "user_sessions_impersonated_by_fkey" FOREIGN KEY (impersonated_by) REFERENCES users(id) ON DELETE SET NULL
    TABLE "user_sessions" CONSTRAINT "user_sessions_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    TABLE "works_qa_corrections" CONSTRAINT "works_qa_corrections_created_by_fkey" FOREIGN KEY (created_by) REFERENCES users(id)

```

## staff

```
                                                                                          Table "public.staff"
             Column             |            Type             | Collation | Nullable |                                                      Default                                                      
--------------------------------+-----------------------------+-----------+----------+-------------------------------------------------------------------------------------------------------------------
 id                             | uuid                        |           | not null | gen_random_uuid()
 employee_id                    | character varying(50)       |           | not null | 
 user_id                        | uuid                        |           |          | 
 first_name                     | character varying(100)      |           | not null | 
 last_name                      | character varying(100)      |           | not null | 
 email                          | character varying(255)      |           | not null | 
 phone                          | character varying(20)       |           |          | 
 alternate_phone                | character varying(20)       |           |          | 
 position                       | character varying(100)      |           |          | 
 department                     | character varying(100)      |           |          | 
 reports_to                     | uuid                        |           |          | 
 join_date                      | date                        |           |          | 
 contract_type                  | character varying(50)       |           |          | 'full-time'::character varying
 status                         | character varying(20)       |           |          | 'active'::character varying
 salary                         | numeric(12,2)               |           |          | 
 hourly_rate                    | numeric(8,2)                |           |          | 
 skills                         | jsonb                       |           |          | '[]'::jsonb
 certifications                 | jsonb                       |           |          | '[]'::jsonb
 emergency_contact              | jsonb                       |           |          | '{}'::jsonb
 address                        | text                        |           |          | 
 city                           | character varying(100)      |           |          | 
 state                          | character varying(100)      |           |          | 
 country                        | character varying(100)      |           |          | 'USA'::character varying
 postal_code                    | character varying(20)       |           |          | 
 profile_picture                | text                        |           |          | 
 documents                      | jsonb                       |           |          | '[]'::jsonb
 performance_rating             | numeric(3,2)                |           |          | 
 current_project_count          | integer                     |           |          | 0
 max_project_count              | integer                     |           |          | 5
 metadata                       | jsonb                       |           |          | '{}'::jsonb
 created_by                     | uuid                        |           |          | 
 created_at                     | timestamp without time zone |           |          | now()
 updated_at                     | timestamp without time zone |           |          | now()
 uif_status                     | character varying(20)       |           |          | 
 uif_number                     | character varying(50)       |           |          | 
 uif_registration_date          | date                        |           |          | 
 coida_status                   | character varying(20)       |           |          | 
 tax_status                     | character varying(20)       |           |          | 
 probation_status               | character varying(20)       |           |          | 
 probation_start_date           | date                        |           |          | 
 probation_end_date             | date                        |           |          | 
 probation_extended             | boolean                     |           |          | 
 probation_extension_reason     | text                        |           |          | 
 notice_period                  | character varying(20)       |           |          | 
 custom_notice_period_days      | integer                     |           |          | 
 working_hours_category         | character varying(20)       |           |          | 
 weekly_hours                   | numeric(4,1)                |           |          | 
 contract_renewal_date          | date                        |           |          | 
 id_number                      | character varying(13)       |           |          | 
 passport_number                | character varying(50)       |           |          | 
 work_permit_number             | character varying(50)       |           |          | 
 work_permit_expiry             | date                        |           |          | 
 is_employee                    | boolean                     |           |          | 
 end_date                       | date                        |           |          | 
 exit_type                      | character varying(50)       |           |          | 
 exit_reason                    | text                        |           |          | 
 is_rehireable                  | boolean                     |           |          | true
 exit_processed_by              | uuid                        |           |          | 
 exit_processed_date            | timestamp without time zone |           |          | 
 level                          | character varying(50)       |           |          | 
 experience_years               | integer                     |           |          | 0
 time_zone                      | character varying(100)      |           |          | 'Africa/Johannesburg'::character varying
 available_weekends             | boolean                     |           |          | false
 available_nights               | boolean                     |           |          | false
 specializations                | jsonb                       |           |          | 
 notes                          | text                        |           |          | 
 bio                            | text                        |           |          | 
 salary_grade                   | character varying(50)       |           |          | 
 working_hours                  | character varying(50)       |           |          | '08:00-17:00'::character varying
 is_active                      | boolean                     |           |          | true
 exit_date                      | date                        |           |          | 
 exit_notes                     | text                        |           |          | 
 rehireable                     | boolean                     |           |          | true
 final_pay_processed            | boolean                     |           |          | false
 exit_interview_completed       | boolean                     |           |          | false
 uif_registered                 | boolean                     |           |          | false
 coida_registered               | boolean                     |           |          | false
 paye_registered                | boolean                     |           |          | false
 tax_number                     | character varying(20)       |           |          | 
 notice_period_days             | integer                     |           |          | 30
 date_of_birth                  | date                        |           |          | 
 gender                         | character varying(50)       |           |          | 
 nationality                    | character varying(50)       |           |          | 'South African'::character varying
 country_of_birth               | character varying(50)       |           |          | 
 bank_branch_code               | character varying(6)        |           |          | 
 bank_account_type              | character varying(20)       |           |          | 
 bank_verified_at               | timestamp without time zone |           |          | 
 bank_verified_by               | uuid                        |           |          | 
 id_issue_date                  | date                        |           |          | 
 id_expiry_date                 | date                        |           |          | 
 passport_expiry_date           | date                        |           |          | 
 passport_issuing_country       | character varying(50)       |           |          | 
 drivers_license_number         | character varying(20)       |           |          | 
 drivers_license_expiry         | date                        |           |          | 
 medical_certificate_expiry     | date                        |           |          | 
 police_clearance_expiry        | date                        |           |          | 
 name                           | character varying(255)      |           |          | generated always as (                                                                                            +
                                |                             |           |          | CASE                                                                                                             +
                                |                             |           |          |     WHEN first_name IS NOT NULL AND last_name IS NOT NULL THEN (first_name::text || ' '::text) || last_name::text+
                                |                             |           |          |     WHEN first_name IS NOT NULL THEN first_name::text                                                            +
                                |                             |           |          |     WHEN last_name IS NOT NULL THEN last_name::text                                                              +
                                |                             |           |          |     ELSE NULL::text                                                                                              +
                                |                             |           |          | END) stored
 cv_url                         | text                        |           |          | 
 cv_uploaded_at                 | timestamp with time zone    |           |          | 
 has_company_vehicle            | boolean                     |           |          | false
 emergency_contact_relationship | character varying(50)       |           |          | 
 next_of_kin_name               | character varying(255)      |           |          | 
 next_of_kin_phone              | character varying(50)       |           |          | 
 next_of_kin_relationship       | character varying(50)       |           |          | 
 next_of_kin_address            | text                        |           |          | 
 sa_id_number                   | character varying(20)       |           |          | 
 passport_country               | character varying(100)      |           |          | 
 passport_expiry                | date                        |           |          | 
 id_photo_url                   | text                        |           |          | 
 profile_photo_url              | text                        |           |          | 
 photo_match_score              | numeric(5,2)                |           |          | 
 photo_verified_at              | timestamp without time zone |           |          | 
 bank_name                      | character varying(100)      |           |          | 
 bank_account_number            | character varying(50)       |           |          | 
 bank_account_holder            | character varying(100)      |           |          | 
 bank_details_verified_at       | timestamp with time zone    |           |          | 
 whatsapp_id                    | character varying(50)       |           |          | 
 department_id                  | uuid                        |           |          | 
 bcea_applicable                | boolean                     |           | not null | true
 ordinarily_works_sundays       | boolean                     |           | not null | false
 home_site_id                   | uuid                        |           |          | 
 payroll_code                   | character varying(20)       |           |          | 
 employment_type                | character varying(20)       |           | not null | 'permanent'::character varying
 role                           | text                        |           |          | 
 account_status                 | text                        |           | not null | 'active'::text
 created_by_staff_id            | uuid                        |           |          | 
Indexes:
    "staff_pkey" PRIMARY KEY, btree (id)
    "idx_staff_contract_type" btree (contract_type)
    "idx_staff_date_of_birth" btree (date_of_birth) WHERE date_of_birth IS NOT NULL
    "idx_staff_department_id" btree (department_id)
    "idx_staff_home_site" btree (home_site_id) WHERE home_site_id IS NOT NULL
    "idx_staff_is_active" btree (is_active)
    "idx_staff_is_employee" btree (is_employee)
    "idx_staff_photo_verified" btree (photo_verified_at) WHERE photo_verified_at IS NOT NULL
    "idx_staff_probation_status" btree (probation_status)
    "idx_staff_status" btree (status)
    "idx_staff_uif_status" btree (uif_status)
    "idx_staff_whatsapp_id" btree (whatsapp_id) WHERE whatsapp_id IS NOT NULL
    "staff_account_status_role_idx" btree (account_status, role) WHERE account_status = 'pending'::text
    "staff_department_idx" btree (department)
    "staff_email_idx" btree (email)
    "staff_email_unique" UNIQUE CONSTRAINT, btree (email)
    "staff_employee_id_idx" btree (employee_id)
    "staff_employee_id_unique" UNIQUE CONSTRAINT, btree (employee_id)
    "staff_payroll_code_unique" UNIQUE, btree (payroll_code) WHERE payroll_code IS NOT NULL
    "staff_reports_to_idx" btree (reports_to)
    "staff_status_idx" btree (status)
Check constraints:
    "staff_account_status_check" CHECK (account_status = ANY (ARRAY['pending'::text, 'active'::text, 'suspended'::text]))
    "staff_bank_account_type_check" CHECK ((bank_account_type::text = ANY (ARRAY['cheque'::character varying::text, 'savings'::character varying::text, 'current'::character varying::text, 'transmission'::character varying::text])) OR bank_account_type IS NULL)
    "staff_bank_branch_code_check" CHECK (length(bank_branch_code::text) = 6 OR bank_branch_code IS NULL)
    "staff_employment_type_check" CHECK (employment_type::text = ANY (ARRAY['permanent'::character varying, 'casual'::character varying]::text[]))
    "staff_gender_check" CHECK ((gender::text = ANY (ARRAY['Male'::character varying::text, 'Female'::character varying::text, 'Other'::character varying::text, 'Prefer not to say'::character varying::text])) OR gender IS NULL)
    "staff_role_check" CHECK (role IS NULL OR (role = ANY (ARRAY['technician'::text, 'stores'::text, 'supervisor'::text, 'admin'::text, 'driver'::text, 'office'::text])))
Foreign-key constraints:
    "staff_bank_verified_by_fkey" FOREIGN KEY (bank_verified_by) REFERENCES staff(id)
    "staff_created_by_staff_id_fkey" FOREIGN KEY (created_by_staff_id) REFERENCES staff(id)
    "staff_created_by_users_id_fk" FOREIGN KEY (created_by) REFERENCES users(id)
    "staff_exit_processed_by_fkey" FOREIGN KEY (exit_processed_by) REFERENCES staff(id)
    "staff_home_site_id_fkey" FOREIGN KEY (home_site_id) REFERENCES fleet_authorized_locations(id) ON DELETE SET NULL
    "staff_reports_to_staff_id_fk" FOREIGN KEY (reports_to) REFERENCES staff(id)
    "staff_user_id_users_id_fk" FOREIGN KEY (user_id) REFERENCES users(id)
Referenced by:
    TABLE "attendance_adjustments" CONSTRAINT "attendance_adjustments_requested_by_fkey" FOREIGN KEY (requested_by) REFERENCES staff(id) ON DELETE RESTRICT
    TABLE "attendance_auth_sessions" CONSTRAINT "attendance_auth_sessions_staff_id_fkey" FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE CASCADE
    TABLE "attendance_bulk_action_audit" CONSTRAINT "attendance_bulk_action_audit_target_staff_id_fkey" FOREIGN KEY (target_staff_id) REFERENCES staff(id) ON DELETE CASCADE
    TABLE "attendance_credentials" CONSTRAINT "attendance_credentials_staff_id_fkey" FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE CASCADE
    TABLE "attendance_daily_summaries" CONSTRAINT "attendance_daily_summaries_staff_id_fkey" FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE CASCADE
    TABLE "attendance_entries" CONSTRAINT "attendance_entries_staff_id_fkey" FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE CASCADE
    TABLE "clients" CONSTRAINT "clients_account_manager_id_fkey" FOREIGN KEY (account_manager_id) REFERENCES staff(id)
    TABLE "clients" CONSTRAINT "clients_sales_representative_id_fkey" FOREIGN KEY (sales_representative_id) REFERENCES staff(id)
    TABLE "daily_progress" CONSTRAINT "daily_progress_team_lead_staff_id_fk" FOREIGN KEY (team_lead) REFERENCES staff(id)
    TABLE "disciplinary_incidents" CONSTRAINT "disciplinary_incidents_issued_by_fkey" FOREIGN KEY (issued_by) REFERENCES staff(id) ON DELETE SET NULL
    TABLE "disciplinary_incidents" CONSTRAINT "disciplinary_incidents_staff_id_fkey" FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE CASCADE
    TABLE "document_ocr_results" CONSTRAINT "document_ocr_results_confirmed_by_fkey" FOREIGN KEY (confirmed_by) REFERENCES staff(id) ON DELETE SET NULL
    TABLE "fiber_stringing" CONSTRAINT "fiber_stringing_stringing_team_staff_id_fk" FOREIGN KEY (stringing_team) REFERENCES staff(id)
    TABLE "fiber_stringing" CONSTRAINT "fiber_stringing_supervisor_staff_id_fk" FOREIGN KEY (supervisor) REFERENCES staff(id)
    TABLE "fiber_stringing" CONSTRAINT "fiber_stringing_testing_team_staff_id_fk" FOREIGN KEY (testing_team) REFERENCES staff(id)
    TABLE "fleet_audit_log" CONSTRAINT "fleet_audit_log_performed_by_fkey" FOREIGN KEY (performed_by) REFERENCES staff(id)
    TABLE "fleet_check_reminders" CONSTRAINT "fleet_check_reminders_driver_id_fkey" FOREIGN KEY (driver_id) REFERENCES staff(id)
    TABLE "fleet_driver_scores" CONSTRAINT "fleet_driver_scores_staff_id_fkey" FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE CASCADE
    TABLE "fleet_fuel_transactions" CONSTRAINT "fleet_fuel_transactions_recorded_by_fkey" FOREIGN KEY (recorded_by) REFERENCES staff(id)
    TABLE "fleet_license_disc" CONSTRAINT "fleet_license_disc_created_by_fkey" FOREIGN KEY (created_by) REFERENCES staff(id)
    TABLE "fleet_odometer_anomalies" CONSTRAINT "fleet_odometer_anomalies_resolved_by_fkey" FOREIGN KEY (resolved_by) REFERENCES staff(id)
    TABLE "fleet_photo_vlm_results" CONSTRAINT "fleet_photo_vlm_results_verified_by_fkey" FOREIGN KEY (verified_by) REFERENCES staff(id)
    TABLE "fleet_portal_sessions" CONSTRAINT "fleet_portal_sessions_driver_id_fkey" FOREIGN KEY (driver_id) REFERENCES staff(id)
    TABLE "fleet_portal_sessions" CONSTRAINT "fleet_portal_sessions_revoked_by_fkey" FOREIGN KEY (revoked_by) REFERENCES staff(id)
    TABLE "fleet_vehicle_calibration" CONSTRAINT "fleet_vehicle_calibration_calibrated_by_fkey" FOREIGN KEY (calibrated_by) REFERENCES staff(id)
    TABLE "fleet_vehicle_documents" CONSTRAINT "fleet_vehicle_documents_uploaded_by_fkey" FOREIGN KEY (uploaded_by) REFERENCES staff(id)
    TABLE "fleet_vehicle_photos" CONSTRAINT "fleet_vehicle_photos_captured_by_fkey" FOREIGN KEY (captured_by) REFERENCES staff(id)
    TABLE "fleet_vehicles" CONSTRAINT "fleet_vehicles_assigned_driver_id_fkey" FOREIGN KEY (assigned_driver_id) REFERENCES staff(id) ON DELETE SET NULL
    TABLE "home_installations" CONSTRAINT "home_installations_backup_technician_staff_id_fk" FOREIGN KEY (backup_technician) REFERENCES staff(id)
    TABLE "home_installations" CONSTRAINT "home_installations_installation_technician_staff_id_fk" FOREIGN KEY (installation_technician) REFERENCES staff(id)
    TABLE "home_installations" CONSTRAINT "home_installations_team_lead_staff_id_fk" FOREIGN KEY (team_lead) REFERENCES staff(id)
    TABLE "nokia_equipment" CONSTRAINT "nokia_equipment_installed_by_staff_id_fk" FOREIGN KEY (installed_by) REFERENCES staff(id)
    TABLE "payslips" CONSTRAINT "payslips_staff_id_fkey" FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE CASCADE
    TABLE "project_pipeline_links" CONSTRAINT "project_pipeline_links_linked_by_fkey" FOREIGN KEY (linked_by) REFERENCES staff(id)
    TABLE "projects" CONSTRAINT "projects_project_manager_staff_id_fk" FOREIGN KEY (project_manager) REFERENCES staff(id)
    TABLE "projects" CONSTRAINT "projects_team_lead_staff_id_fk" FOREIGN KEY (team_lead) REFERENCES staff(id)
    TABLE "smartsheet_sync_config" CONSTRAINT "smartsheet_sync_config_created_by_fkey" FOREIGN KEY (created_by) REFERENCES staff(id) ON DELETE SET NULL
    TABLE "smartsheet_sync_config" CONSTRAINT "smartsheet_sync_config_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES staff(id) ON DELETE SET NULL
    TABLE "smartsheet_sync_history" CONSTRAINT "smartsheet_sync_history_triggered_by_user_fkey" FOREIGN KEY (triggered_by_user) REFERENCES staff(id) ON DELETE SET NULL
    TABLE "staff_audit_log" CONSTRAINT "staff_audit_log_staff_id_fkey" FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE CASCADE
    TABLE "staff" CONSTRAINT "staff_bank_verified_by_fkey" FOREIGN KEY (bank_verified_by) REFERENCES staff(id)
    TABLE "staff_compliance_status" CONSTRAINT "staff_compliance_status_staff_id_fkey" FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE CASCADE
    TABLE "staff" CONSTRAINT "staff_created_by_staff_id_fkey" FOREIGN KEY (created_by_staff_id) REFERENCES staff(id)
    TABLE "staff_documents" CONSTRAINT "staff_documents_staff_id_fkey" FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE CASCADE
    TABLE "staff_documents" CONSTRAINT "staff_documents_verified_by_fkey" FOREIGN KEY (verified_by) REFERENCES staff(id)
    TABLE "staff" CONSTRAINT "staff_exit_processed_by_fkey" FOREIGN KEY (exit_processed_by) REFERENCES staff(id)
    TABLE "staff_notes" CONSTRAINT "staff_notes_staff_id_fkey" FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE CASCADE
    TABLE "staff_projects" CONSTRAINT "staff_projects_assigned_by_fkey" FOREIGN KEY (assigned_by) REFERENCES staff(id)
    TABLE "staff_projects" CONSTRAINT "staff_projects_staff_id_fkey" FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE CASCADE
    TABLE "staff_receipts" CONSTRAINT "staff_receipts_staff_id_fkey" FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE RESTRICT
    TABLE "staff" CONSTRAINT "staff_reports_to_staff_id_fk" FOREIGN KEY (reports_to) REFERENCES staff(id)
    TABLE "stock_serial_events" CONSTRAINT "stock_serial_events_actor_staff_id_fkey" FOREIGN KEY (actor_staff_id) REFERENCES staff(id)
    TABLE "maintenance_tickets" CONSTRAINT "tickets_assigned_to_fkey" FOREIGN KEY (assigned_to) REFERENCES staff(id)
    TABLE "vehicle_assignments" CONSTRAINT "vehicle_assignments_staff_id_fkey" FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE CASCADE
    TABLE "wa_contacts" CONSTRAINT "wa_contacts_staff_id_fkey" FOREIGN KEY (staff_id) REFERENCES staff(id)

```

### Salient interpretation across the 7 tables above

- `stock_items.category` — used as the category filter source in `<SerialSearch>`. Prod distribution dominated by `bootstock` for ONTs.
- `stock_items.tracking_type` CHECK = `('serial','lot','quantity','drum','none')`.
- `stock_locations.location_type` CHECK = `('warehouse','site_store','transit','technician','customer','scrap','adjustment')`.
- `drops` — emits `installed_at_drop` on AFTER UPDATE per migration 364 trigger `emit_serial_event_on_drop_install`.
- `oes_pp_data` — emits `activated` on AFTER INSERT per `emit_serial_event_on_oes_activate`. Dominant write path in production today.
- `users` and `staff` — actor FK targets. Most prod events have `actor_user_id IS NULL AND actor_staff_id IS NULL` (OES-activation and drop-install triggers fire from cron / system context).

## access_permissions for procurement

Confirmed `procurement.field-stock` exists with route `/procurement/field-stock`. PR-8 and PR-9a will reuse this permission key — no new permission seed required.

```
                       key                        |      label       |          route           
--------------------------------------------------+------------------+--------------------------
 procurement.field-stock                          | Field Stock      | /procurement/field-stock
 procurement.inventory.field-stock                | Field Stock      | 
 procurement.inventory.field-stock.reconciliation | Reconciliation   | 
```

`procurement.inventory.field-stock.reconciliation` exists but the route is blank — PR-9a does not need it, but the existence is noted for future deferred PRs.

## migrations max version

```
 max 
-----
 369
```

Next migration (if Wave 2 needs one) would be `370_*.sql`. No schema changes are anticipated for PR-7 / PR-8 / PR-9a — all three are read-only, augment-first.

## Validation gate sample serials

Mohadin Loeks query returned 0 rows (`installed_at_drop_number LIKE 'DR%MOH%' OR received_reference ILIKE '%mohadin%'` matches nothing). Substituted with the first 5 serials that have at least one recorded event:

```
 serial_number | status    | drop_number | category   | item    | n_events
---------------+-----------+-------------+------------+---------+---------
 ALCLB477FAD6  | installed | DR1732246   | bootstock  | FT-ONT  | 1
 ALCLB48EA156  | installed | DR1734151   | bootstock  | FT-ONT  | 1
 ALCLB48F333B  | installed | DR1738762   | bootstock  | FT-ONT  | 1
 ALCLB48CC5D7  | installed | DR1742126   | bootstock  | FT-ONT  | 1
 ALCLB480E55A  | installed | DR1854983   | bootstock  | FT-ONT  | 1
```

PR-9a's browser smoke should resolve **`ALCLB477FAD6`** and assert the timeline page renders one real `installed_at_drop` event plus the pseudo entries derived from `received_date` and `status_changed_at`.

---

## Interpretation for Wave 2

1. **Search-by-mac feasibility.** `stock_serials.mac_address` has **no index**. At 36k rows a seq-scan `ILIKE` prefix match is acceptable for v1 (well under 50ms on modern hardware). Defer index creation until a query-plan measurement says otherwise — adding `gin_trgm_ops` here would require `pg_trgm` and a migration; not warranted yet.

2. **Timeline emptiness.** 66 of 36264 serials carry an event (0.182%). Pseudo entries from `stock_serials` columns (`received_date`, `installed_date`, `status_changed_at`, `activated_at_olt_id`) are mandatory in `<SerialTimeline>` — Locked Decision #10 already commits to this.

3. **Permission key.** `procurement.field-stock` exists. Pages added in PR-8 + PR-9a can reuse it directly; no permission migration needed.

4. **Pseudo-trigger columns.** `previous_status` and `status_changed_at` **both exist**. The plan's UNVERIFIED markers in PR-9a service code can be dropped — the columns are present and safe to reference.

5. **Validation-gate sample.** `ALCLB477FAD6` (status `installed`, drop `DR1732246`, item FT-ONT) — anchors the PR-9a browser smoke test.

6. **Beyond the plan: trigger-coverage gap.** 6 of 8 event-emitting triggers have never fired in production. The picking trigger was the riskiest because migration 366 specifically fixed it; this session's synthetic ROLLBACK smoke confirmed it works. The other 4 (return, return-line insert + disposition, qa-install, onemap-sync) remain unexercised. Wave 2 UI will not synthesise events for them — when they fire for the first time in prod, the timeline will pick them up naturally via the existing event-row contract.
