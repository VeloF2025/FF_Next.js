---
name: odoo
description: Odoo data sync and reconciliation for FibreFlow — diagnose gaps, trigger re-syncs, reconcile stock/GRN/PO data
version: 1.0.0
triggers:
  - /odoo
  - odoo sync
  - odoo broken
  - odoo reconciliation
  - GRN not matched
  - serial mismatch
  - vendor bill missing
  - stock quantity wrong
  - odoo data
  - sync odoo
  - odoo stock
  - odoo movements
---

# /odoo — Odoo Sync Agent

Manages Odoo ↔ FibreFlow data sync and reconciliation. Covers stock movements, GRNs, purchase orders, serials, fleet, and vendor bills.

## Architecture

```
Odoo (ERP)
  ├── stock.picking (deliveries/receipts)  →  stock_movements (source_type='odoo')
  ├── purchase.order                        →  purchase_orders (odoo_id, odoo_po_number)
  ├── stock.lot (serial numbers)           →  stock_serials
  ├── fleet.vehicle                         →  fleet_vehicles (odoo_id)
  └── account.move (vendor bills)          →  purchase_orders (vendor_bill_*)

FibreFlow native:
  GRN Confirm → stock_movements (source_type='fibreflow')
  Both → stock_items.qty_available
```

## Sync API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET/POST | `/api/odoo/sync/stock-movements` | Sync Odoo pickings |
| GET/POST | `/api/odoo/sync/assets` | Sync asset/equipment data |
| GET/POST | `/api/odoo/sync/attachments` | Sync document attachments |

## Common Tasks

### Check Sync Health
```sql
-- Count movements by source
SELECT source_type, COUNT(*) as count
FROM stock_movements
GROUP BY source_type;

-- Unmatched GRNs (GRN with no matching PO)
SELECT g.id, g.grn_number, g.purchase_order_id, g.created_at
FROM goods_receipt_notes g
LEFT JOIN purchase_orders p ON g.purchase_order_id = p.id
WHERE p.id IS NULL
ORDER BY g.created_at DESC;

-- POs with Odoo IDs (synced)
SELECT COUNT(*) as synced_pos
FROM purchase_orders
WHERE odoo_id IS NOT NULL;

-- POs without Odoo ID (FibreFlow native)
SELECT COUNT(*) as native_pos
FROM purchase_orders
WHERE odoo_id IS NULL;
```

### Stock Quantity Reconciliation
```sql
-- Compare stock_items qty vs sum of movements
SELECT
  si.id,
  si.name,
  si.qty_available as current_qty,
  COALESCE(SUM(
    CASE WHEN smi.movement_type IN ('in', 'receipt') THEN smi.quantity
         WHEN smi.movement_type IN ('out', 'delivery') THEN -smi.quantity
         ELSE 0 END
  ), 0) as calculated_qty
FROM stock_items si
LEFT JOIN stock_movement_items smi ON smi.stock_item_id = si.id
LEFT JOIN stock_movements sm ON sm.id = smi.stock_movement_id
  AND sm.status = 'completed'
GROUP BY si.id, si.name, si.qty_available
HAVING ABS(si.qty_available - COALESCE(SUM(...), 0)) > 0.01;

-- Check recent movements
SELECT sm.id, sm.reference, sm.source_type, sm.status,
       sm.created_at, COUNT(smi.id) as line_items
FROM stock_movements sm
LEFT JOIN stock_movement_items smi ON smi.stock_movement_id = sm.id
WHERE sm.created_at > NOW() - INTERVAL '24 hours'
GROUP BY sm.id
ORDER BY sm.created_at DESC;
```

### Serial Number Sync Check
```sql
-- Serials not matched to stock items
SELECT ss.serial_number, ss.odoo_lot_id, ss.stock_item_id
FROM stock_serials ss
LEFT JOIN stock_items si ON si.id = ss.stock_item_id
WHERE si.id IS NULL;

-- Recent serial activity
SELECT serial_number, status, updated_at
FROM stock_serials
ORDER BY updated_at DESC
LIMIT 20;
```

### GRN-PO Linkage Check
```sql
-- GRNs linked to confirmed POs
SELECT
  g.grn_number,
  p.po_number as linked_po,
  p.status as po_status,
  g.status as grn_status,
  g.created_at
FROM goods_receipt_notes g
JOIN purchase_orders p ON g.purchase_order_id = p.id
ORDER BY g.created_at DESC
LIMIT 20;

-- Vendor bills on POs
SELECT po_number, vendor_bill_number, vendor_bill_amount, vendor_bill_date
FROM purchase_orders
WHERE vendor_bill_number IS NOT NULL
ORDER BY vendor_bill_date DESC;
```

### Trigger a Sync
```bash
# Sync stock movements from Odoo
curl -X POST https://dev.fibreflow.app/api/odoo/sync/stock-movements \
  -H "Content-Type: application/json"

# Sync assets
curl -X POST https://dev.fibreflow.app/api/odoo/sync/assets

# Sync attachments
curl -X POST https://dev.fibreflow.app/api/odoo/sync/attachments
```

## Key DB Tables

| Table | Odoo Field | Purpose |
|-------|-----------|---------|
| `purchase_orders` | `odoo_id`, `odoo_po_number` | PO sync |
| `purchase_orders` | `vendor_bill_number`, `vendor_bill_amount` | Vendor bill sync |
| `goods_receipt_notes` | `purchase_order_id` | GRN-PO linkage |
| `stock_movements` | `source_type='odoo'` | Odoo picking sync |
| `stock_serials` | `odoo_lot_id` | Serial/lot sync |
| `stock_items` | `odoo_product_id` | Product sync (260 items) |
| `fleet_vehicles` | `odoo_id` | Fleet sync |

## Critical Rules

- **`source_type`**: Always `'odoo'` for synced, `'fibreflow'` for native
- **`tr_grn_stock_update` trigger is DISABLED** — API handles stock updates
- **Use `stock_items` NOT `stock_positions`** — positions table is empty
- **No conditional SQL** — `${cond ? sql\`AND x\` : sql\`\`}` breaks Neon
- **GRN Confirm endpoint**: `POST /api/procurement/grn-confirm` creates movement AND updates stock

## Troubleshooting

### Quantities Don't Match Odoo
1. Check when last sync ran
2. Verify `stock_movements` has recent Odoo records (`source_type='odoo'`)
3. Check for incomplete movements (`status != 'completed'`)
4. Trigger manual sync via API
5. Check if `tr_grn_stock_update` trigger accidentally re-enabled

### GRN Missing from PO
```sql
-- Find orphaned GRNs
SELECT g.grn_number, g.created_at
FROM goods_receipt_notes g
WHERE g.purchase_order_id IS NULL;
```

### Odoo Sync Errors
```bash
# Check server logs
journalctl -u fibreflow-dev.service -n 100 | grep odoo
```

## Related
- `.claude/modules/procurement.md` — Full procurement module
- `/contractor` skill — Stock accountability per contractor
- `pages/api/odoo/sync/` — Sync API endpoints
