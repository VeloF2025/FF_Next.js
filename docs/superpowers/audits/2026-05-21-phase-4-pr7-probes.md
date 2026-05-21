# PR-7 Prod Schema Probes — 2026-05-21

Probed against localhost:5436 (PgBouncer → self-hosted Supabase on Velocity 100.96.203.105).

---

## 1. `assets` table

Key divergence from backfill assumptions:

| Column | In backfill assumption | Actual prod |
|--------|------------------------|-------------|
| `asset_type` | `TEXT` used to filter `ont`/`gizzu` | **DOES NOT EXIST** |
| `mac_address` | `TEXT` for MAC address | **DOES NOT EXIST** |
| `category_id` | – | `UUID FK → asset_categories` |
| `stock_item_id` | – | `UUID FK → stock_items` (nullable) |
| `serial_number` | ✓ | ✓ `VARCHAR(255)` |
| `created_at` | ✓ | ✓ `TIMESTAMPTZ` |

**Data reality**: the `assets` table contains tools (EXFO OTDRs, fusion splicers, Brady printers, etc.), NOT ONTs or Gizzus. No asset row has `category_id` linked to any ONT/Gizzu category. `asset_categories` has no ONT/Gizzu entry.

**ONT/Gizzu canonical location**: `stock_serials` linked to `stock_items` where `item_code IN ('FT-ONT','FT-GIZZU')` and `category='bootstock'`. There are ~36k serial rows already registered (18,119 Gizzu + 18,117 ONT).

**Backfill fix**: rewrite to JOIN `assets.stock_item_id → stock_items.item_code` instead of `WHERE asset_type IN (...)`. Only `assets` rows that explicitly point to FT-ONT/FT-GIZZU via `stock_item_id` are candidates.

---

## 2. `qa_photo_reviews` table

| Column | In backfill assumption | Actual prod |
|--------|------------------------|-------------|
| `ont_serial` | used for serial lookup | **DOES NOT EXIST** |
| `drop_id` | `UUID FK` for drop linkage | **DOES NOT EXIST** |
| `ont_serial_scanned` | – | ✓ `VARCHAR(255)` |
| `drop_number` | ✓ | ✓ `VARCHAR(255)` (text, no FK) |
| `created_at` | ✓ | ✓ `TIMESTAMPTZ` |

No FK from `qa_photo_reviews` to `drops`. Drop resolution must be done by joining `drops.drop_number`.

---

## 3. `oes_pp_data` table

| Column | In backfill assumption | Actual prod |
|--------|------------------------|-------------|
| `activated_at` | `TIMESTAMPTZ` for ordering | **DOES NOT EXIST** |
| `pon_id` | `TEXT` | **DOES NOT EXIST** |
| `id` | assumed UUID | `SERIAL` (INTEGER) |
| `serial_number` | ✓ | ✓ `TEXT` |
| `olt_name` | ✓ | ✓ `TEXT` |
| `created_at` | ✓ | ✓ `TIMESTAMPTZ` |
| `olt_pon` | – | `SMALLINT` (PON port reference) |

**Ordering fix**: `ORDER BY oes.activated_at DESC` → `ORDER BY oes.created_at DESC`.

**Trigger source_id fix**: `oes_pp_data.id` is INTEGER, not UUID. `stock_serial_events.source_id` is UUID. The migration-364 trigger used `NEW.id` directly as `source_id UUID` which would fail. Fix: use `md5(NEW.id::text)::uuid` (deterministic, idempotent).

---

## 4. `drops` table

No unexpected divergences relevant to backfill scripts. Has `id UUID`, `drop_number VARCHAR`, `project_id UUID`, `ont_serial VARCHAR` etc. The only relevant fix is to JOIN on `drop_number` instead of using a `drop_id` FK from `qa_photo_reviews`.

---

## 5. `stock_serials` table

| Column | In scripts | Actual prod |
|--------|-----------|-------------|
| `serial_number` | ✓ | ✓ |
| `status` | ✓ | ✓ |
| `installed_at_drop_id` | ✓ | ✓ `UUID FK → drops` |
| `activated_at_olt_id` | ✓ (added by migration 362) | ✓ |
| `mac_address` | ✓ | ✓ |

No divergences after migration 362 applied.

---

## 6. `stock_pickings` / `stock_picking_lines`

Confirmed in prior PR-6 probes; no new divergences:
- `stock_picking_lines.serial_ids UUID[]` ✓
- `stock_pickings.technician_id UUID` ✓

---

## 7. `stock_returns` / `stock_return_lines`

Confirmed in prior PR-6 probes; no new divergences:
- `stock_return_lines.serial_id UUID` ✓
- `stock_returns.returned_by_id UUID` ✓

---

## 8. `stock_items` table

| Column | In backfill assumption | Actual prod |
|--------|------------------------|-------------|
| `device_type` | used to identify ONT/Gizzu | **DOES NOT EXIST** |
| `item_code` | – | ✓ `VARCHAR` (`FT-ONT`, `FT-GIZZU`) |
| `category` | – | ✓ `VARCHAR` (`bootstock` for ONT/Gizzu) |
| `tracking_type` | – | ✓ `VARCHAR` (`serial` for ONT/Gizzu) |

**Backfill fix**: use `WHERE item_code = ANY($1::text[])` with `['FT-ONT','FT-GIZZU']` instead of `WHERE device_type = ANY($1::text[])`.

---

## Pre-existing Trigger: `trg_update_accountability_on_issue`

### What it does

```sql
CREATE TRIGGER trg_update_accountability_on_issue
  AFTER UPDATE ON public.stock_pickings
  FOR EACH ROW
  WHEN ((OLD.status IS DISTINCT FROM NEW.status) AND (NEW.status = 'done'))
  EXECUTE FUNCTION update_accountability_on_issue()
```

Function body:

```plpgsql
BEGIN
  IF NEW.picking_type = 'issue' AND NEW.status = 'done'
     AND NEW.contractor_id IS NOT NULL THEN
    INSERT INTO contractor_stock_accountability (contractor_id, contractor_name)
    VALUES (NEW.contractor_id, COALESCE(NEW.contractor_name, 'Unknown'))
    ON CONFLICT (contractor_id) DO NOTHING;

    INSERT INTO stock_accountability_history (
      contractor_id, event_type, reference_id, reference_type,
      reference_number, performed_by, notes)
    VALUES (
      NEW.contractor_id, 'issue', NEW.id, 'picking',
      NEW.picking_number, NEW.approved_by, 'Stock issued');
  END IF;
  RETURN NEW;
END;
```

### Overlap analysis with PR-6's `trg_emit_serial_event_on_picking_done`

Both triggers fire `AFTER UPDATE OF status` on `stock_pickings` when `NEW.status = 'done'`. They have different WHEN clauses:

| Trigger | WHEN | Scope |
|---------|------|-------|
| `trg_update_accountability_on_issue` | `status changed TO 'done'` | Only `picking_type = 'issue'` |
| `emit_serial_event_on_picking_done` (PR-6) | `NEW.status = 'done' AND OLD.status <> 'done'` | ALL picking types |

**Both triggers write to `contractor_stock_accountability`:**

- `trg_update_accountability_on_issue`: does `INSERT ... ON CONFLICT DO NOTHING` — only ensures the row *exists*, does NOT increment any counter.
- `emit_serial_event_on_picking_done` (PR-6): does `INSERT ... ON CONFLICT DO UPDATE SET total_issued_count = total_issued_count + v_count` — actually increments the counter.

**Verdict: No double-write conflict.** The old trigger only ensures row existence (UPSERT no-op on conflict); it never increments `total_issued_count`. PR-6's trigger does the actual counting. They are complementary, not redundant.

The old trigger also writes to `stock_accountability_history` (an audit log table). PR-6's trigger does not write there. These are additive writes to different rows/tables.

### Decision: Option (b) — Leave both triggers as-is

**Reasoning:**
- No overlap in counter writes: old trigger does existence-guarantee INSERT only, PR-6 trigger does counter increment.
- The old trigger's write to `stock_accountability_history` provides a separate audit trail not covered by PR-6's `stock_serial_events`.
- Dropping the old trigger would remove the history-table write, which may be in use by other code.
- No migration 365 needed for this trigger.

Migration 365 is required only for fixing Trigger 2 and Trigger 3 column-name bugs.

---

## Summary of Column Divergences Fixed by PR-7

| Script / Trigger | Column assumed | Actual prod column | Fix applied |
|------------------|----------------|---------------------|-------------|
| PR-2 (assets backfill) | `assets.asset_type` | does not exist | Rewrite to use `stock_items.item_code` |
| PR-2 (assets backfill) | `assets.mac_address` | does not exist | Remove from INSERT |
| PR-2 (assets backfill) | `stock_items.device_type` | does not exist | Use `stock_items.item_code` |
| PR-3 (QA backfill) | `qa_photo_reviews.ont_serial` | `ont_serial_scanned` | Rename column ref |
| PR-3 (QA backfill) | `qa_photo_reviews.drop_id` | does not exist | JOIN `drops` on `drop_number` |
| PR-4 (OES backfill) | `oes_pp_data.activated_at` | does not exist | Use `created_at` |
| Trigger 2 (364) | `NEW.ont_serial` | `NEW.ont_serial_scanned` | Migration 365 CR |
| Trigger 2 (364) | `NEW.drop_id` | does not exist | Migration 365 CR: derive via drops JOIN |
| Trigger 3 (364) | `NEW.pon_id` | does not exist | Migration 365 CR: use `olt_pon::text` |
| Trigger 3 (364) | `NEW.activated_at` | does not exist | Migration 365 CR: use `created_at` |
| Trigger 3 (364) | `NEW.id` as UUID source_id | INTEGER id | Migration 365 CR: `md5(id::text)::uuid` |
| reconcile-queries.sql | `assets.asset_type IN ('ont','gizzu')` | does not exist | Use `item_code IN ('FT-ONT','FT-GIZZU')` |
| test seed | `assets.asset_type`, `mac_address` | does not exist | Seed updated |
| test seed | `qa_photo_reviews.drop_id`, `ont_serial` | does not exist | Seed updated |
| test seed | `oes_pp_data.id UUID`, `pon_id`, `activated_at` | INTEGER, missing cols | Seed updated |
| test seed | `stock_items.device_type` | does not exist | Use `item_code` |
