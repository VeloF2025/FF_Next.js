# Phase 4 Serial Master Register — Verification Probes
**Date:** 2026-05-21  
**Branch:** `docs/phase-4-probes`  
**Purpose:** Resolve 6 open verification items before Wave 1 implementation begins. All queries are SELECT-only — no schema changes.

### Cross-links
- **Spec:** `docs/superpowers/specs/2026-05-21-serial-master-register-design.md`
- **Plan:** `docs/superpowers/plans/2026-05-21-serial-master-register-wave1.md` (currently on branch `docs/procurement-audit`, commit `f3f4036ed`)
- **Audit (predecessor):** `docs/superpowers/audits/2026-05-21-procurement-field-stock-integration.md`

---

## Probe 0 — Migration Version

### Query
```sql
SELECT MAX(version) AS current_max FROM migrations;
```

### Raw Output
```
 current_max
-------------
         361
(1 row)
```

### Decision / Notes
- `current_max = 361`
- Wave 1 forward migration number = **362**
- Wave 1 rollback migration number = **362** (same version, separate down file)

### Downstream PR Impact
- **PR-1** — Replace placeholder `<NNN>` in migration filenames with `362`.
  - Forward file: `scripts/migrations/sql/362_stock_serials_phase4.sql`
  - Rollback file: `scripts/migrations/sql/362_stock_serials_phase4_down.sql`

---

## Probe 1 — `stock_serials.status` CHECK Values + Row Counts

### Query A — CHECK constraint definition
```sql
SELECT pg_get_constraintdef(oid) AS def
FROM pg_constraint
WHERE conname = 'stock_serials_status_check';
```

### Raw Output A
```
CHECK (((status)::text = ANY (ARRAY[
  ('available'::character varying)::text,
  ('reserved'::character varying)::text,
  ('issued'::character varying)::text,
  ('installed'::character varying)::text,
  ('faulty'::character varying)::text,
  ('returned'::character varying)::text,
  ('scrapped'::character varying)::text,
  ('in_transit'::character varying)::text
])))
(1 row)
```

### Query B — Row counts by status
```sql
SELECT status, COUNT(*) FROM stock_serials GROUP BY 1 ORDER BY 2 DESC;
```

### Raw Output B
```
  status   | count
-----------+-------
 available | 36159
 installed |   105
(2 rows)
```

### Decision / Notes
- **8 status values** in the CHECK constraint:
  `available`, `reserved`, `issued`, `installed`, `faulty`, `returned`, `scrapped`, `in_transit`
- **Only 2 status values exist in live data**: `available` (36,159 rows) and `installed` (105 rows).
  The other 6 values (`reserved`, `issued`, `faulty`, `returned`, `scrapped`, `in_transit`) are defined
  in the constraint but have zero rows — they are valid future states.
- **No unexpected status values found** (e.g. `used` is NOT present). The spec's expected list matches
  the constraint exactly.
- **No surprises** — the spec's three new status values (`activated`, `in_repair`, `allocated_to_project`)
  must be added to this CHECK in PR-1's migration. All 8 existing values must be preserved.

### Downstream PR Impact
- **PR-1** — The `ALTER TABLE stock_serials DROP CONSTRAINT stock_serials_status_check` + `ADD CONSTRAINT`
  must include all 8 existing values PLUS the 3 new values added by the serial master register design.
  Minimum safe CHECK list for PR-1:
  ```sql
  CHECK (status IN (
    'available','reserved','issued','installed',
    'faulty','returned','scrapped','in_transit',
    'activated','in_repair','allocated_to_project'  -- new in Wave 1 (per spec)
  ))
  ```

---

## Probe 2 — `projects` Table PK Column

### Query
```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'projects'
  AND column_name IN ('id','project_id','uuid')
ORDER BY ordinal_position;
```

### Raw Output
```
 column_name | data_type | is_nullable | table_schema
-------------+-----------+-------------+--------------
 id          | uuid      | NO          | onemap
 project_id  | uuid      | YES         | onemap
 id          | uuid      | NO          | public
(3 rows)
```

### Decision / Notes
- The `public` schema `projects` table has PK column **`id`** of type **`uuid`**, NOT NULL.
- There is also an `onemap` schema `projects` table (separate schema, not the target). The `onemap.projects`
  table also has `id uuid NOT NULL` and an additional `project_id uuid` (nullable — appears to be a FK
  back-reference, not the PK).
- FK target for the new `allocated_to_project_id` column on `stock_serials` is:
  **`REFERENCES public.projects(id)`** — `uuid`.

### Downstream PR Impact
- **PR-1** — New column definition:
  ```sql
  ALTER TABLE stock_serials
    ADD COLUMN allocated_to_project_id uuid REFERENCES projects(id);
  ```
  (No schema prefix needed since `stock_serials` is in `public` and `projects` defaults to `public.projects`.)

---

## Probe 3 — OLT Identifier in `oes_pp_data`

### Query
```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'oes_pp_data'
  AND column_name ILIKE '%olt%';
```

### Raw Output
```
 column_name | data_type
-------------+-----------
 olt_lt      | smallint
 olt_pon     | smallint
 olt_ont_pos | smallint
 olt_port    | text
 olt_address | text
 olt_name    | text
(6 rows)
```

### Decision / Notes
- `oes_pp_data` has **6 OLT-related columns**. There is no single `olt_id uuid` FK — OLT is represented
  as a **composite of text/smallint fields**:
  - `olt_name` (text) — human-readable OLT name (e.g. `"OLT-RANDBURG-01"`)
  - `olt_address` (text) — network address
  - `olt_port` (text) — port string
  - `olt_lt`, `olt_pon`, `olt_ont_pos` (smallint) — numeric slot/PON/position identifiers
- **No UUID FK** to an `olts` table exists. OLT identity in `oes_pp_data` is by name string.
- Therefore, the new `activated_at_olt_id` column on `stock_serials` should be **`TEXT`**, storing
  the `olt_name` value from the activation source.
- **Future hardening:** introduce an `olts` table (UUID PK, unique `name`, normalised address/port
  metadata) and migrate `activated_at_olt_id` to a UUID FK once OLT inventory is canonicalised.
  Out of scope for Wave 1.

### Downstream PR Impact
- **PR-1** — New column:
  ```sql
  ALTER TABLE stock_serials
    ADD COLUMN activated_at_olt_id text;  -- stores olt_name from oes_pp_data
  ```
- **PR-4** (Backfill C) — Backfill query joins `oes_pp_data.olt_name` → `stock_serials.activated_at_olt_id`.

---

## Probe 4 — GRN Confirm Code Path

### Query
```bash
grep -rE "grn.*confirm|confirmGrn|grn_lines.*INSERT" \
  pages/api/procurement/ src/services/procurement/ 2>/dev/null | head -20
```

### Raw Output
```
pages/api/procurement/grn-confirm.ts: * POST /api/procurement/grn-confirm
pages/api/procurement/grn-confirm.ts:        `Cannot confirm GRN in '${grn.status}' status. Only draft or receiving GRNs can be confirmed.`
pages/api/procurement/grn-confirm.ts:      module: 'procurement:grn-confirm',
pages/api/procurement/grn-confirm.ts:          module: 'procurement:grn-confirm',
pages/api/procurement/grn-confirm.ts:      module: 'procurement:grn-confirm',
pages/api/procurement/grn-confirm.ts:      module: 'procurement:grn-confirm',
src/services/procurement/middleware/rbac/permissions.ts:  GRN_CONFIRM = 'grn:confirm',
```

### Handler Summary
- **File:** `pages/api/procurement/grn-confirm.ts` (278 lines)
- **Method:** `POST /api/procurement/grn-confirm`
- **What it does:**
  1. Validates GRN is in `draft` or `receiving` status
  2. Inserts into `stock_movements` (movement_type=`'GRN'`)
  3. Inserts into `stock_movement_items` for each GRN item (stores `serial_numbers` as an ARRAY)
  4. UPDATEs `stock_items.qty_available` for accepted quantities
  5. Updates GRN status → `'completed'`
  6. Posts to GL integration hook

### Decision / Notes
- **There is no `grn_lines` table** — the actual line items live in `goods_receipt_items`.
- **`goods_receipt_items.serial_numbers` is an ARRAY column** — serials arrive as a batch array, not
  as individual `stock_serials` rows at GRN time.
- **Current gap:** `grn-confirm.ts` does NOT write to `stock_serials`. It only increments `stock_items.qty_available`.
  The `received_at_dc` event planned in PR-6 cannot hook into an existing AFTER INSERT — there is no
  per-serial INSERT trigger point in the current GRN flow.
- **Correct trigger source for `received_at_dc` events (PR-6):** The handler at
  `POST /api/procurement/grn-confirm` is the right place to add per-serial `stock_serials` INSERTs
  (one row per serial in `goods_receipt_items.serial_numbers`). PR-6 should extend `grn-confirm.ts`
  to explode the serial_numbers array into individual `stock_serials` rows with `status='available'`
  and `received_at_dc = NOW()`.

### Downstream PR Impact
- **PR-6** — Extend `pages/api/procurement/grn-confirm.ts`: after the `stock_movement_items` INSERT loop,
  iterate `item.serial_numbers[]` and INSERT one `stock_serials` row per serial (if not already present)
  with `received_at_dc = NOW()`, `status = 'available'`.

---

## Probe 5 — NOC Fault Ticket Integration Source

### Query A — Tables with ONT serial / serial_number columns
```sql
SELECT DISTINCT table_name
FROM information_schema.columns
WHERE column_name ILIKE '%ont_serial%'
   OR column_name ILIKE '%serial_number%'
ORDER BY table_name;
```

### Raw Output A (37 tables)
```
assets
cable_drums
dr_photo_unified_reviews
drops
drops_backup_20260115
eod_install_sheet_entries
field_stock_movements
foto_ai_reviews
ft_billing_deductions
goods_receipt_items
home_installations
loeks_field_mappings
maintenance_qa_checks
maintenance_tickets
nokia_equipment
nokia_exp
oes_activations
oes_pp_data
offline_alerts
offline_devices
qa_photo_reviews
sharepoint_nokia_exp
stock_consumptions
stock_items
stock_movement_items
stock_return_lines
stock_serials
stock_take_lines
tool_checkouts
v_drop_materials
v_foto_ai_reviews
v_installation_gaps
v_installation_stock_reconciliation
v_qa_photo_reviews_compat
v_qfield_oes_activations
v_stock_take_lines_detail
wa_photos
```

### Query B — NOC module fault/ticket references
```bash
grep -rE "noc.*ticket|fault" src/modules/noc/ 2>/dev/null | head -10
```

### Raw Output B
```
src/modules/noc/client.ts:export * from './constants/faultCauses';
src/modules/noc/hooks/useAssignment.ts:  const response = await fetch(`/api/noc/tickets/${payload.ticketId}`, ...
src/modules/noc/hooks/useRelatedTickets.ts:  const response = await fetch(`/api/noc/tickets?${params.toString()}`);
src/modules/noc/hooks/useNearbyTickets.ts: * Shows other tickets nearby (within 100m by default).
src/modules/noc/hooks/useNearbyTickets.ts:  const response = await fetch(`/api/noc/nearby-tickets?${params.toString()}`);
src/modules/noc/hooks/useNearbyTickets.ts: * @param radius - Search radius in meters (default 100)
src/modules/noc/hooks/useTickets.ts:  const url = `/api/noc/tickets?${params.toString()}`;
src/modules/noc/hooks/useTickets.ts:  const response = await fetch('/api/noc/tickets', ...
src/modules/noc/hooks/useNearbyTickets.ts:  const response = await fetch(`/api/noc/nearby-tickets?...`);
src/modules/noc/hooks/useTicketActivities.ts:  const url = `/api/noc/tickets/${ticketId}/activities...`;
```

### Decision / Notes
- **37 tables** contain `ont_serial` or `serial_number` columns — no single authoritative "fault" source
  table exists that naturally links a serial number to a fault event.
- `maintenance_tickets` is the closest candidate (NOC fault tickets) but it has `serial_number` alongside
  37 other tables — no clear single-table ownership.
- The NOC module's `faultCauses` constant and ticket hooks operate on `noc_tickets` (via API), but there
  is no existing DB trigger or event that automatically sets `flagged_faulty` on `stock_serials` when a
  fault ticket is raised.
- **Decision: DEFER `flagged_faulty` event to Wave 2.**
  - In Wave 1, the `flagged_faulty_at` column is added to `stock_serials` schema (PR-1) but NOT populated
    automatically.
  - The `flagged_faulty` event will be emitted by a **manual admin action** (e.g., a "Mark as Faulty"
    button in the Serial Register UI) — Wave 2 implementation.
  - **NO trigger** for this event in Wave 1. PR-6 must NOT attempt to add a NOC-fault trigger.

### Downstream PR Impact
- **PR-1** — Add `flagged_faulty_at timestamptz` column to `stock_serials` schema (nullable, no default).
- **PR-6** — Skip the `flagged_faulty` trigger entirely in Wave 1. Add a comment in PR-6's implementation
  notes: `-- flagged_faulty_at: deferred to Wave 2 (manual admin action, see Phase 4 Probe 5)`.

---

## Probe 6 — Legacy `/procurement/field-stock/*` Page Strategy

### No DB query — decision only

### Options Evaluated
| Option | Description | Verdict |
|--------|-------------|---------|
| (a) Feature flag `NEXT_PUBLIC_NEW_FIELD_STOCK_UI=true` | Toggle between old/new UI via env var | Rejected |
| (b) `/legacy/*` URLs — old pages move to `/procurement/field-stock/legacy/*` | Clean URL separation | **Recommended** |

### Decision: **Option (b) — `/procurement/field-stock/legacy/*`**

**Rationale:**
- Feature flags on Next.js pages leak into browser caches and CDN edge nodes. If the flag is flipped
  off mid-session, users can land on inconsistent states.
- `/legacy/*` URLs are explicit: old pages keep working at their new paths, new pages own the canonical
  `/procurement/field-stock/*` URLs. No ambiguity.
- Navigation links can be updated in one pass (ModuleNav component). Old bookmarks and redirects are
  easy to add as `redirects` in `next.config.js`.
- No env var to manage across `dev.fibreflow.app`, `app.fibreflow.app`, and local.

### Existing Pages to Relocate
Current pages at `/procurement/field-stock/`:
- `pages/procurement/field-stock/index.tsx` → move to `pages/procurement/field-stock/legacy/index.tsx`
- `pages/procurement/field-stock/pickings/[pickingId].tsx` → move to `pages/procurement/field-stock/legacy/pickings/[pickingId].tsx`
- `pages/procurement/field-stock/reconciliation.tsx` → move to `pages/procurement/field-stock/legacy/reconciliation.tsx`

### Downstream PR Impact
- **PR-2 or PR-3** (whichever first touches field-stock UI) — relocate the 3 existing pages to `/legacy/*`
  and add redirects in `next.config.js`:
  ```js
  { source: '/procurement/field-stock', destination: '/procurement/field-stock/legacy', permanent: false },
  ```
- New serial-register pages own `/procurement/field-stock/` canonical paths from Wave 1 launch.

---

## Summary Table

| Probe | Key Finding | Downstream Value |
|-------|-------------|------------------|
| 0 — Migration version | `current_max = 361` | Wave 1 migration = **362** |
| 1 — status CHECK values | 8 values; only `available`+`installed` have data; no `used` | PR-1 must preserve all 8 + add `activated`, `in_repair`, `allocated_to_project` |
| 2 — projects PK | `public.projects.id uuid NOT NULL` | FK: `REFERENCES projects(id)` (uuid) |
| 3 — OLT identifier | No UUID FK; OLT = text `olt_name` in `oes_pp_data` | `activated_at_olt_id text` column |
| 4 — GRN confirm path | `pages/api/procurement/grn-confirm.ts`; no `grn_lines`; serials in array | PR-6 extends grn-confirm to explode serial array → stock_serials rows |
| 5 — NOC fault source | 37 tables with serial cols; no single fault source | `flagged_faulty` deferred to Wave 2; admin manual action |
| 6 — Legacy page strategy | Option (b) `/legacy/*` URLs chosen | PR-2/3: relocate 3 existing pages + add redirects |
