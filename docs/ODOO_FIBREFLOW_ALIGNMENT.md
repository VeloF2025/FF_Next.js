# Odoo → FibreFlow Data Alignment & Recommendations

## Executive Summary

This document analyzes how Odoo data aligns with FibreFlow's database schema and app processes, with specific recommendations for each entity type.

**Overall Assessment:** ✅ Good alignment with some adjustments needed

---

## 1. SUPPLIERS

### Data Comparison

| Odoo Field | Odoo Sample Data | FF Field | FF Requirements | Status |
|------------|------------------|----------|-----------------|--------|
| `id` | 15 | `odoo_partner_id` | INTEGER | ✅ Direct |
| `name` | "AVERGE TECHNOLOGIES (PTY) LTD" | `name` | VARCHAR(255) NOT NULL | ✅ Direct |
| `email` | (empty) | `email` | VARCHAR(255) NOT NULL | ⚠️ **ISSUE** |
| `phone` | "+27 12 345 4150" | `phone` | VARCHAR | ✅ Direct |
| `vat` | "4760259814" | `tax_number` | VARCHAR(100) | ✅ Direct |
| `street` | "16B AXLE DR" | `physical_address_line1` | VARCHAR | ✅ Direct |
| `street2` | "CLAYVILLE EXT 11, MIDRAND" | `physical_address_line2` | VARCHAR | ✅ Direct |
| `city` | (in street2) | `physical_city` | VARCHAR | ⚠️ Parse needed |
| `zip` | "1666" | `physical_postal_code` | VARCHAR | ✅ Direct |
| `ref` | (empty) | `supplier_code` | VARCHAR(50) | ⚠️ Generate |
| `active` | true | `is_active` | BOOLEAN | ✅ Direct |

### Issues & Recommendations

#### Issue 1: Email is required in FF but missing in Odoo
**Odoo Data:** 0/5 suppliers have email addresses
**FF Requirement:** `email VARCHAR(255) NOT NULL`

**Recommendation:**
```sql
-- Option A: Make email nullable for Odoo imports
ALTER TABLE suppliers ALTER COLUMN email DROP NOT NULL;

-- Option B: Use placeholder during import
email = '{supplier_code}@imported.odoo' -- Mark as needing update
```
**My Advice:** Go with Option A - make email nullable. Many B2B suppliers don't have email on file.

#### Issue 2: Supplier code is required and unique
**Odoo Data:** No `ref` field populated
**FF Requirement:** `code VARCHAR(50) UNIQUE NOT NULL`

**Recommendation:** Auto-generate supplier code during import:
```typescript
// Generate code from Odoo ID
const supplierCode = `ODOO-${odooPartnerId.toString().padStart(5, '0')}`;
// Example: ODOO-00015
```

#### Issue 3: FF has much richer schema
**FF has 130+ columns**, Odoo only provides ~15 fields.

**Recommendation:**
- Set sensible defaults for required fields
- Mark imported suppliers with a tag: `tags = ['odoo-import']`
- Set `status = 'active'` and `is_verified = false` (needs review)

### Supplier Sync Process

```
1. Fetch from Odoo: res.partner WHERE supplier_rank > 0
2. For each supplier:
   a. Check if odoo_partner_id exists in FF → UPDATE
   b. If not exists → INSERT with:
      - Auto-generated code: ODOO-{id}
      - email: NULL or placeholder
      - status: 'active'
      - is_verified: false
      - tags: ['odoo-import']
3. Store mapping in odoo_entity_mappings
4. Log to odoo_sync_history
```

---

## 2. PURCHASE ORDERS

### Data Comparison

| Odoo Field | Odoo Sample | FF Field | FF Requirements | Status |
|------------|-------------|----------|-----------------|--------|
| `id` | 201 | `odoo_po_id` | INTEGER | ✅ Direct |
| `name` | "P00201" | `po_number` | VARCHAR(50) UNIQUE | ⚠️ Conflict possible |
| `partner_id` | [5, "ROHCAP..."] | `supplier_id` | INTEGER FK | ⚠️ Lookup needed |
| `date_order` | "2026-01-16 09:15:36" | `order_date` | DATE | ✅ Direct |
| `date_planned` | "2026-01-20" | `expected_delivery_date` | DATE | ✅ Direct |
| `state` | "purchase" | `status` | VARCHAR(30) | ⚠️ Transform |
| `amount_untaxed` | 35200 | `subtotal` | DECIMAL(14,2) | ✅ Direct |
| `amount_tax` | 5280 | `tax_amount` | DECIMAL(14,2) | ✅ Direct |
| `amount_total` | 40480 | `total_amount` | DECIMAL(14,2) | ✅ Direct |
| `origin` | "006-Thembisa" | `notes` | TEXT | ✅ As reference |

### Issues & Recommendations

#### Issue 1: PO Number Conflict
**Odoo:** Uses format "P00201"
**FF:** Auto-generates "PO{YY}-{00001}" (e.g., "PO26-00001")

**Recommendation:**
```typescript
// Option A: Use Odoo's PO number directly (disable auto-generation for imports)
po_number = odooPoName; // "P00201"

// Option B: Prefix Odoo POs to avoid conflicts
po_number = `ODOO-${odooPoName}`; // "ODOO-P00201"
```
**My Advice:** Use Option A - keep Odoo's PO number. It's what your team knows. Add check to prevent duplicates.

#### Issue 2: Supplier Lookup
**Odoo:** Returns `partner_id = [5, "ROHCAP FIBRE..."]`
**FF:** Needs `supplier_id` as FK to suppliers table

**Recommendation:**
```typescript
// 1. First sync suppliers
// 2. Then sync POs with lookup:
const ffSupplierId = await db.query(`
  SELECT id FROM suppliers WHERE odoo_partner_id = $1
`, [odooPartnerId]);
```

#### Issue 3: Status Mapping
| Odoo State | FF Status | Notes |
|------------|-----------|-------|
| `draft` | `draft` | ✅ Direct |
| `sent` | `sent` | ✅ Direct |
| `to approve` | `pending_approval` | Transform |
| `purchase` | `approved` | Transform (confirmed in Odoo) |
| `done` | `received` | Transform |
| `cancel` | `cancelled` | ✅ Direct |

#### Issue 4: FF Workflow vs Odoo
**FF Process:** Requisition → RFQ → Quote → PO → GRN
**Odoo Process:** PO directly (no requisition step)

**Recommendation:**
- Import Odoo POs directly to `purchase_orders` table
- Skip requisition linkage (`requisition_id = NULL`)
- Set `created_by = 'odoo-sync'` to identify imported POs

#### Issue 5: PO Line Items
**Odoo:** Has `purchase.order.line` with product references
**FF:** Has `purchase_order_items` with optional `stock_item_id`, `material_catalog_id`

**Recommendation:**
```typescript
// For each Odoo PO line:
{
  item_code: odooLine.product_id?.[1]?.split(']')[0] || null, // Extract code
  item_description: odooLine.name,
  quantity_ordered: odooLine.product_qty,
  unit_price: odooLine.price_unit,
  uom: odooLine.product_uom?.[1] || 'Each',
  // Leave material_catalog_id NULL - can be matched later
}
```

### Purchase Order Sync Process

```
1. PREREQUISITE: Suppliers must be synced first
2. Fetch from Odoo: purchase.order (all or incremental by write_date)
3. For each PO:
   a. Lookup supplier_id via odoo_partner_id mapping
   b. Check if odoo_po_id exists → UPDATE or INSERT
   c. Transform status from Odoo state
   d. Fetch order lines: purchase.order.line WHERE order_id = po_id
   e. Sync line items to purchase_order_items
4. Store mappings and log history
```

---

## 3. FLEET VEHICLES

### Data Comparison

| Odoo Field | Odoo Sample | FF Field | FF Type | Status |
|------------|-------------|----------|---------|--------|
| `id` | 1 | `odoo_vehicle_id` | INTEGER | ✅ Direct |
| `license_plate` | "CL94BTZN" | `registration` | VARCHAR(20) UNIQUE | ✅ Direct |
| `vin_sn` | "ACVMRRAR0L4175267" | `vin` | VARCHAR(50) | ✅ Direct |
| `model_id` | [1, "Isuzu/DMAX 250 Fleetside"] | `make`, `model` | VARCHAR(50) | ⚠️ Parse |
| `model_year` | null | `year` | INTEGER | ⚠️ Often empty |
| `color` | null | `color` | VARCHAR(30) | ⚠️ Often empty |
| `state_id` | [2, "Registered"] | `status` | VARCHAR(20) | ⚠️ Transform |
| `driver_id` | [4, "Frans Labuschagne"] | (no direct field) | - | ⚠️ **GAP** |
| `odometer` | 35984 | (no direct field) | - | ⚠️ **GAP** |
| `acquisition_date` | null | (no direct field) | - | ⚠️ **GAP** |
| `car_value` | null | (no direct field) | - | ⚠️ Often empty |

### Issues & Recommendations

#### Issue 1: Driver Assignment Gap
**Odoo:** Has `driver_id` linking to `res.partner`
**FF:** No direct `driver_id` field on `fleet_vehicles`

**Recommendation:**
```sql
-- Add driver tracking to fleet_vehicles
ALTER TABLE fleet_vehicles ADD COLUMN IF NOT EXISTS assigned_driver_name VARCHAR(255);
ALTER TABLE fleet_vehicles ADD COLUMN IF NOT EXISTS assigned_driver_id UUID REFERENCES users(id);
ALTER TABLE fleet_vehicles ADD COLUMN IF NOT EXISTS odoo_driver_partner_id INTEGER;
```
**My Advice:** Add `assigned_driver_name` for display, and optionally link to FF users later.

#### Issue 2: Odometer Tracking Gap
**Odoo:** Tracks current odometer reading
**FF:** Has `fuel_rate_per_km` but no current odometer

**Recommendation:**
```sql
-- Add odometer to fleet_vehicles
ALTER TABLE fleet_vehicles ADD COLUMN IF NOT EXISTS current_odometer INTEGER;
ALTER TABLE fleet_vehicles ADD COLUMN IF NOT EXISTS odometer_updated_at TIMESTAMP WITH TIME ZONE;
```

#### Issue 3: Model/Make Parsing
**Odoo:** Returns combined string like "Isuzu/DMAX 250 Fleetside"
**FF:** Has separate `make` and `model` fields

**Recommendation:**
```typescript
// Parse Odoo model string
const modelString = odooVehicle.model_id?.[1] || '';
const [make, ...modelParts] = modelString.split('/');
const model = modelParts.join('/').trim();

// Result: make = "Isuzu", model = "DMAX 250 Fleetside"
```

#### Issue 4: Status Mapping
| Odoo State | FF Status | Notes |
|------------|-----------|-------|
| "Registered" | `active` | Normal operation |
| "Downgraded" | `maintenance` or custom | Needs review |
| "Cancelled" | `retired` | No longer in use |

### Fleet Sync Process

```
1. Fetch from Odoo: fleet.vehicle (all active)
2. For each vehicle:
   a. Check if registration exists in FF → UPDATE or INSERT
   b. Parse make/model from model_id string
   c. Transform state to FF status
   d. Store driver name (create user mapping if needed)
   e. Update odometer reading
3. Store mappings and log history
```

---

## 4. STOCK TRANSFERS → GRN

### Data Comparison

| Odoo Field | Odoo Sample | FF Field (GRN) | Status |
|------------|-------------|----------------|--------|
| `id` | 1 | `odoo_picking_id` | ✅ Direct |
| `name` | "Law/IN/00001" | `grn_number` | ⚠️ Use as-is or generate |
| `origin` | "PO0000001" | `purchase_order_id` | ⚠️ Lookup by PO number |
| `partner_id` | [supplier] | `supplier_id` | ⚠️ Lookup |
| `location_dest_id` | [2, "Law/Stock"] | `warehouse_id` | ⚠️ Map to FF warehouse |
| `scheduled_date` | "2025-04-24" | - | ✅ Reference |
| `date_done` | "2025-09-30" | `delivery_date` | ✅ Direct |
| `state` | "done" | `status` | ⚠️ Transform |

### Issues & Recommendations

#### Issue 1: Only Import Receipts (Incoming)
**Odoo:** Has multiple picking types (receipts, deliveries, internal)
**FF GRN:** Only for receiving goods from suppliers

**Recommendation:**
```typescript
// Filter for incoming receipts only
const receipts = await odoo.searchRead('stock.picking', [
  ['picking_type_id.code', '=', 'incoming'],
  ['state', '=', 'done']  // Only completed receipts
]);
```

#### Issue 2: Warehouse Mapping
**Odoo Warehouses:** Law, Moh, WH, IP, MamP1, GR, ETW, Tem1, Tem2, Tem3, TBL
**FF:** Needs `stock_locations` table mapping

**Recommendation:**
```typescript
// Create warehouse mapping table or lookup
const warehouseMap = {
  'Law': 'lawley-warehouse-uuid',
  'Moh': 'mohadin-warehouse-uuid',
  'WH': 'main-warehouse-uuid',
  // ... etc
};
```

#### Issue 3: GRN Line Items
**Odoo:** Has `stock.move` records for each product movement
**FF:** Has `goods_receipt_items` table

**Recommendation:** Sync `stock.move` records linked to each picking as GRN line items.

### Stock Transfer Sync Process

```
1. PREREQUISITE: Suppliers and POs must be synced first
2. Fetch from Odoo: stock.picking WHERE picking_type = incoming AND state = done
3. For each picking:
   a. Skip if not a supplier receipt
   b. Lookup supplier_id and purchase_order_id
   c. Map warehouse/location
   d. Create GRN record
   e. Fetch stock.move lines and create goods_receipt_items
4. Store mappings and log history
```

---

## 5. PRODUCTS → MATERIAL CATALOG

### Data Comparison

| Odoo Field | Odoo Sample | FF Field | Status |
|------------|-------------|----------|--------|
| `id` | 1 | `odoo_product_id` (NEW) | ✅ Add column |
| `default_code` | "TIPS" | `item_code` | ✅ Direct |
| `name` | "Tips" | `description` | ✅ Direct |
| `categ_id` | [1, "Services"] | `category` | ⚠️ Map to FF categories |
| `type` | "consu" | - | Info only |
| `list_price` | 0 | `standard_rate` | ✅ Direct |
| `qty_available` | 0 | - | Info only (stock level) |

### Issues & Recommendations

#### Issue 1: Budget Category Mapping
**FF Requirement:** `budget_category VARCHAR(50) NOT NULL`
**Odoo:** Has generic categories like "Services", "Stringing", "BOQ Tembelihle"

**Recommendation:**
```typescript
// Map Odoo categories to FF budget categories
const categoryMap = {
  'Stringing': 'CABLES',
  'Services': 'LABOR',
  'BOQ Tembelihle': 'MATERIALS',
  // ... create comprehensive mapping
};
```

#### Issue 2: Duplicate Prevention
**FF:** Has `material_match_history` for deduplication
**Risk:** Odoo products might duplicate existing FF materials

**Recommendation:**
- First export FF `material_catalog` items
- Match by `item_code` before inserting
- Use fuzzy matching on description for potential duplicates
- Flag matches for manual review

### Product Sync Process

```
1. Fetch from Odoo: product.product WHERE active = true
2. For each product:
   a. Check if item_code exists in material_catalog → Skip or Update
   b. Map category to budget_category
   c. Insert new items with status = 'pending_review'
3. Generate match report for review
```

---

## 6. RECOMMENDED SCHEMA CHANGES

Based on this analysis, I recommend the following changes to FibreFlow:

### 6.1 Suppliers Table
```sql
-- Make email nullable for B2B suppliers
ALTER TABLE suppliers ALTER COLUMN email DROP NOT NULL;

-- Add import tracking
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS import_source VARCHAR(50);
-- Values: 'manual', 'odoo', 'sage', etc.
```

### 6.2 Fleet Vehicles Table
```sql
-- Add driver and odometer tracking
ALTER TABLE fleet_vehicles ADD COLUMN IF NOT EXISTS assigned_driver_name VARCHAR(255);
ALTER TABLE fleet_vehicles ADD COLUMN IF NOT EXISTS current_odometer INTEGER;
ALTER TABLE fleet_vehicles ADD COLUMN IF NOT EXISTS odometer_unit VARCHAR(20) DEFAULT 'km';
ALTER TABLE fleet_vehicles ADD COLUMN IF NOT EXISTS odometer_updated_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE fleet_vehicles ADD COLUMN IF NOT EXISTS odoo_driver_partner_id INTEGER;
```

### 6.3 Material Catalog Table
```sql
-- Add Odoo tracking
ALTER TABLE material_catalog ADD COLUMN IF NOT EXISTS odoo_product_id INTEGER;
ALTER TABLE material_catalog ADD COLUMN IF NOT EXISTS odoo_synced_at TIMESTAMP WITH TIME ZONE;
```

### 6.4 Warehouse/Location Mapping
```sql
-- Create Odoo warehouse mapping (if not using stock_locations)
CREATE TABLE IF NOT EXISTS odoo_warehouse_mappings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    odoo_warehouse_id INTEGER NOT NULL,
    odoo_warehouse_code VARCHAR(20) NOT NULL,
    odoo_warehouse_name VARCHAR(100),
    ff_location_id UUID REFERENCES stock_locations(id),
    ff_project_id UUID REFERENCES projects(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

---

## 7. SYNC ORDER & DEPENDENCIES

```
┌─────────────────────────────────────────────────────────────┐
│                     SYNC ORDER                               │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  1. SUPPLIERS (res.partner)                                  │
│     └── No dependencies, sync first                          │
│                                                              │
│  2. PRODUCTS (product.product) [OPTIONAL]                    │
│     └── Depends on: Nothing                                  │
│     └── Enables: PO line item matching                       │
│                                                              │
│  3. PURCHASE ORDERS (purchase.order)                         │
│     └── Depends on: Suppliers                                │
│     └── Includes: PO Line Items                              │
│                                                              │
│  4. FLEET VEHICLES (fleet.vehicle)                           │
│     └── No dependencies, can sync anytime                    │
│                                                              │
│  5. STOCK TRANSFERS/GRN (stock.picking)                      │
│     └── Depends on: Suppliers, POs, Warehouses               │
│     └── Most complex, sync last                              │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## 8. SUMMARY OF RECOMMENDATIONS

### Must Do (Before Sync)
1. ✅ Make `suppliers.email` nullable
2. ✅ Add fleet vehicle columns (driver_name, odometer)
3. ✅ Create warehouse mapping table or manual mapping

### Should Do (For Better Integration)
1. Add `import_source` column to track where data came from
2. Add `material_catalog.odoo_product_id` for product sync
3. Create product category mapping (Odoo → FF budget categories)

### Nice to Have (Future)
1. Bidirectional sync (push FF changes back to Odoo)
2. Real-time webhooks (Odoo 17+ supports this)
3. Automated reconciliation reports

---

## 9. NEXT STEPS

1. **Apply schema changes** (migration 081)
2. **Sync suppliers first** - Foundation for everything else
3. **Sync fleet vehicles** - Independent, quick win
4. **Sync purchase orders** - Core procurement data
5. **Review products** - Manual mapping of categories
6. **Sync GRNs** - Most complex, do last

Would you like me to proceed with implementing these changes?
