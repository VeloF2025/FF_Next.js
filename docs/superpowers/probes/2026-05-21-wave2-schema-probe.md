# Wave 2 schema probe — 2026-05-22 SAST

Probe ordered by the operative plan (`docs/superpowers/plans/2026-05-21-serial-master-register-wave2.md` PR-0). Captured against self-hosted Supabase at `100.96.203.105:5436/fibreflow` (the single DB shared by dev + prod since 2026-04-18). Connection string sourced from `.claude/credentials.local.md` — never inlined here.

This PR-0 was folded into the PR-7 worktree per Hein's 2026-05-22 decision rather than shipped as a standalone PR. The probe doc is identical in content; only the delivery vehicle changed.

## How to reproduce

```bash
# DATABASE_URL from .claude/credentials.local.md (pooler on :5436)
psql "$DATABASE_URL" -f docs/superpowers/probes/2026-05-21-wave2-schema-probe.sql
```

The full output of the queries below is preserved verbatim in the per-table sections.

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

## stock_items, stock_locations, projects, drops, oes_pp_data, users, staff

Full `\d` output captured in `/tmp/wave2-probe-output.txt`; salient details only here:

- `stock_items.category` — used as the category filter source in `<SerialSearch>`. Prod category distribution dominated by `bootstock` for ONTs.
- `stock_items.tracking_type` CHECK = `('serial','lot','quantity','drum','none')`.
- `stock_locations.location_type` CHECK = `('warehouse','site_store','transit','technician','customer','scrap','adjustment')`.
- `drops` — emits `installed_at_drop` on AFTER UPDATE per migration 364 trigger `emit_serial_event_on_drop_install`.
- `oes_pp_data` — emits `activated` on AFTER INSERT per `emit_serial_event_on_oes_activate`. This is the dominant write path in production today.
- `users` and `staff` — actor FK targets. Most prod events have `actor_user_id IS NULL AND actor_staff_id IS NULL` (the OES-activation and drop-install triggers fire from cron / system context).

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
