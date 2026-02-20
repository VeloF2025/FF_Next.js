---
name: contractor
description: Contractor accountability and field stock management — check outstanding stock, block/unblock contractors, accountability summaries
version: 1.0.0
triggers:
  - /contractor
  - contractor blocked
  - contractor accountability
  - contractor outstanding stock
  - is contractor blocked
  - contractor owes stock
  - unblock contractor
  - block contractor
  - contractor compliance
  - contractor field stock
  - accountability summary
---

# /contractor — Contractor Accountability Agent

Manages contractor field stock accountability, blocking, and compliance in FibreFlow.

## Quick Reference

| Item | Value |
|------|-------|
| **UI** | `/procurement/field-stock` → Accountability tab |
| **DB** | `contractor_stock_accountability` |
| **Block API** | `/api/procurement/field-stock/accountability/[id]/block` |
| **Unblock API** | `/api/procurement/field-stock/accountability/[id]/unblock` |

## Common Tasks

### Check if Contractor is Blocked
```sql
-- Contractor block status
SELECT
  c.company_name,
  a.is_blocked,
  a.block_reason,
  a.blocked_at,
  a.blocked_by
FROM contractor_stock_accountability a
JOIN contractors c ON a.contractor_id = c.id
WHERE c.company_name ILIKE '%contractor_name%';

-- All currently blocked contractors
SELECT
  c.company_name,
  a.block_reason,
  a.blocked_at,
  a.outstanding_value
FROM contractor_stock_accountability a
JOIN contractors c ON a.contractor_id = c.id
WHERE a.is_blocked = TRUE
ORDER BY a.blocked_at DESC;
```

### Outstanding Stock by Contractor
```sql
-- What stock a contractor still holds
SELECT
  c.company_name,
  si.name as item,
  spi.quantity as issued,
  COALESCE(ret.returned_qty, 0) as returned,
  spi.quantity - COALESCE(ret.returned_qty, 0) as outstanding
FROM stock_picking_items spi
JOIN stock_pickings sp ON sp.id = spi.picking_id
JOIN contractors c ON sp.contractor_id = c.id
JOIN stock_items si ON spi.stock_item_id = si.id
LEFT JOIN (
  SELECT sri.stock_item_id, sp2.contractor_id, SUM(sri.quantity) as returned_qty
  FROM stock_return_items sri
  JOIN stock_returns sr ON sr.id = sri.return_id
  JOIN stock_pickings sp2 ON sp2.id = sr.picking_id
  GROUP BY sri.stock_item_id, sp2.contractor_id
) ret ON ret.stock_item_id = spi.stock_item_id
     AND ret.contractor_id = sp.contractor_id
WHERE sp.status = 'completed'
  AND spi.quantity > COALESCE(ret.returned_qty, 0)
ORDER BY c.company_name, si.name;

-- Accountability summary per contractor
SELECT
  c.company_name,
  a.total_issued,
  a.total_returned,
  a.outstanding_quantity,
  a.outstanding_value,
  a.is_blocked
FROM contractor_stock_accountability a
JOIN contractors c ON a.contractor_id = c.id
ORDER BY a.outstanding_value DESC;
```

### Block a Contractor
```bash
# Via API
curl -X POST https://dev.fibreflow.app/api/procurement/field-stock/accountability/{contractorId}/block \
  -H "Content-Type: application/json" \
  -d '{"reason": "Outstanding stock not returned after project completion"}'
```

### Unblock a Contractor
```bash
# Via API (after stock has been returned/reconciled)
curl -X POST https://dev.fibreflow.app/api/procurement/field-stock/accountability/{contractorId}/unblock \
  -H "Content-Type: application/json" \
  -d '{"notes": "All outstanding items returned and verified"}'
```

### Check Picking History
```sql
-- All pickings for a contractor
SELECT
  sp.picking_number,
  sp.status,
  sp.created_at,
  sp.completed_at,
  COUNT(spi.id) as line_items,
  SUM(spi.quantity) as total_qty
FROM stock_pickings sp
JOIN contractors c ON sp.contractor_id = c.id
JOIN stock_picking_items spi ON spi.picking_id = sp.id
WHERE c.company_name ILIKE '%contractor_name%'
GROUP BY sp.id
ORDER BY sp.created_at DESC;

-- Recent returns from contractor
SELECT
  sr.return_number,
  sr.status,
  sr.created_at,
  sr.condition,
  COUNT(sri.id) as items
FROM stock_returns sr
JOIN stock_pickings sp ON sr.picking_id = sp.id
JOIN contractors c ON sp.contractor_id = c.id
JOIN stock_return_items sri ON sri.return_id = sr.id
WHERE c.company_name ILIKE '%contractor_name%'
GROUP BY sr.id
ORDER BY sr.created_at DESC;
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/procurement/field-stock/accountability` | All accountability records |
| POST | `/api/procurement/field-stock/accountability/[id]/block` | Block contractor |
| POST | `/api/procurement/field-stock/accountability/[id]/unblock` | Unblock contractor |
| GET | `/api/procurement/field-stock/pickings` | Stock pickings |
| POST | `/api/procurement/field-stock/pickings` | Create picking |
| POST | `/api/procurement/field-stock/pickings/[id]/confirm` | Confirm picking |
| POST | `/api/procurement/field-stock/pickings/[id]/sign` | Sign-off picking |
| POST | `/api/procurement/field-stock/pickings/[id]/cancel` | Cancel picking |
| GET | `/api/procurement/field-stock/returns` | Stock returns |
| POST | `/api/procurement/field-stock/returns/[id]/accept` | Accept return |
| POST | `/api/procurement/field-stock/returns/[id]/inspect` | Inspect return |

## DB Tables

| Table | Purpose |
|-------|---------|
| `contractor_stock_accountability` | Aggregated accountability per contractor |
| `stock_pickings` | Stock issue records (to contractors) |
| `stock_picking_items` | Line items per picking |
| `stock_returns` | Stock return records |
| `stock_return_items` | Line items per return |
| `contractors` | Contractor master records |

## RBAC Permissions

| Permission | Who Can |
|-----------|---------|
| `canManagePickings` | Admin, Manager, Supervisor |
| `canCancelPickings` | Admin, Manager only |
| `canManageReturns` | Admin, Manager, Supervisor |
| `canManageAccountability` | Admin, Manager only |
| `canReverseMovements` | Admin, Manager only |

## Troubleshooting

### Contractor Showing Wrong Balance
```sql
-- Recalculate outstanding from raw data
SELECT
  SUM(CASE WHEN sm.movement_type = 'out' THEN smi.quantity ELSE -smi.quantity END) as net
FROM stock_movement_items smi
JOIN stock_movements sm ON sm.id = smi.stock_movement_id
WHERE sm.contractor_id = '<contractor_uuid>'
  AND sm.status = 'completed';
```

### Block API Failing
- Check user has `canManageAccountability` permission (Admin or Manager only)
- Verify contractor UUID is correct
- Check contractor isn't already blocked

## Related
- `.claude/modules/procurement.md` — Full procurement module
- `/odoo` skill — Stock sync from Odoo
- `src/modules/procurement/field-stock/` — Field stock UI components
