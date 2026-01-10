# PRD-027: Field Stock Control

## Overview
Comprehensive field stock control system for tracking materials (ONTs, routers, drop cables, consumables) issued to technicians, consumed on jobs, and returned. Extends the existing Procurement Stock module with Odoo-inspired location-based inventory management.

## Problem Statement
1. **No Accountability** - Stock issued to technicians disappears into a black hole with no tracking
2. **No Traceability** - Cannot link specific ONT/router to the drop/install where it was used
3. **No Visibility** - Unknown what stock each technician has in their van
4. **Stock Loss** - Unable to identify or investigate missing/unaccounted stock
5. **Manual Processes** - No system for issues, returns, or reconciliation

## Goals
1. Track stock movements from warehouse → technician → customer with full audit trail
2. Link serialized equipment (ONTs/routers) to specific drops/installs
3. Provide real-time visibility of stock by location (warehouse, site store, technician van)
4. Enable technicians to record material consumption in the field via mobile web
5. Support returns workflow with condition tracking and disposition
6. Generate accountability reports per technician/project

## User Requirements
| Requirement | Decision |
|-------------|----------|
| Stock Sources | Multiple warehouses/sites |
| Serial Tracking | ONTs + Routers + Mini-UPS (Gizzu) |
| Quantity Tracking | Drop cables, consumables |
| Job Linking | Full traceability to drops/installs |
| Architecture | Extend Procurement module |
| Field Interface | Responsive web app on mobile |

## SOP Alignment
This PRD implements the **Velocity Fibre Home Installation & Activation SOP** requirements:

| SOP Section | Requirement | Implementation |
|-------------|-------------|----------------|
| 4.1 | Equipment Allocation Form | Digital allocation form with signature capture |
| 4.3 | Link equipment to DR Number | `stock_consumptions.drop_number` |
| 4.4 | Block new stock if previous unaccounted | Issuance blocking rule in system |
| 7.2 | Capture ONT + Mini-UPS serials | `stock_serials` table |
| 8.3 | Serial numbers match system records | Reconciliation reports |
| 10.3 | Traceability to DR + location + serial | Full audit trail |
| 10.4 | Liability for lost/unaccounted | Cost tracking + recovery reports |
| 10.5 | Financial recovery/set-off | Stock value tracking per contractor |

---

## Data Model

### stock_locations
Hierarchical location management following Odoo patterns.

```sql
CREATE TABLE stock_locations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    parent_id UUID REFERENCES stock_locations(id),
    code VARCHAR(50) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,

    -- Location Type
    location_type VARCHAR(50) NOT NULL CHECK (location_type IN (
        'warehouse',      -- Physical warehouse
        'site_store',     -- Project site store
        'transit',        -- In-transit (virtual)
        'technician',     -- Technician van stock (virtual)
        'customer',       -- Installed at customer (virtual)
        'scrap',          -- Scrap/disposal (virtual)
        'adjustment'      -- Inventory adjustment (virtual)
    )),

    -- Physical Details
    address TEXT,
    coordinates JSONB,  -- { lat, lng }

    -- Assignment (for technician type)
    assigned_to_id UUID,          -- staff_id
    assigned_to_name VARCHAR(255),
    assigned_to_phone VARCHAR(50),

    -- Project Context
    project_id UUID REFERENCES projects(id),

    -- Status
    is_active BOOLEAN DEFAULT true,
    is_virtual BOOLEAN DEFAULT false,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by VARCHAR(255)
);

CREATE INDEX idx_stock_locations_type ON stock_locations(location_type);
CREATE INDEX idx_stock_locations_assigned ON stock_locations(assigned_to_id);
```

### stock_items
Item master with tracking type configuration.

```sql
CREATE TABLE stock_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    item_code VARCHAR(100) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    description TEXT,

    -- Classification
    category VARCHAR(100) NOT NULL CHECK (category IN (
        'ont',           -- ONT devices (serial tracked)
        'router',        -- Routers (serial tracked)
        'mini_ups',      -- Mini-UPS/Gizzu units (serial tracked) - SOP requirement
        'drop_cable',    -- Drop cables (quantity tracked)
        'fiber_cable',   -- Fiber cables (drum tracked)
        'connector',     -- Connectors (quantity tracked)
        'consumable',    -- General consumables
        'tool',          -- Tools (returnable)
        'ppe'            -- Safety equipment
    )),

    -- Tracking Configuration
    tracking_type VARCHAR(20) NOT NULL CHECK (tracking_type IN (
        'serial',     -- Each unit has unique serial number
        'lot',        -- Batch/lot tracking
        'quantity',   -- Simple quantity tracking
        'drum'        -- Fiber drum tracking
    )),

    uom VARCHAR(20) NOT NULL DEFAULT 'EA', -- EA, M, KM, ROLL
    standard_cost DECIMAL(12,2),
    currency VARCHAR(3) DEFAULT 'ZAR',

    -- Reorder Settings
    min_stock_level INTEGER DEFAULT 0,
    max_stock_level INTEGER,
    reorder_quantity INTEGER,

    is_active BOOLEAN DEFAULT true,
    is_returnable BOOLEAN DEFAULT false,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

### stock_serials
Serial number registry for ONTs and routers.

```sql
CREATE TABLE stock_serials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    stock_item_id UUID NOT NULL REFERENCES stock_items(id),

    serial_number VARCHAR(100) NOT NULL,
    mac_address VARCHAR(50),           -- For ONTs/routers
    imei VARCHAR(50),                  -- For routers with SIM

    -- Current State
    current_location_id UUID REFERENCES stock_locations(id),
    status VARCHAR(50) NOT NULL DEFAULT 'available' CHECK (status IN (
        'available',      -- In stock, ready for issue
        'reserved',       -- Reserved for a job
        'issued',         -- Issued to technician
        'installed',      -- Installed at customer
        'faulty',         -- Defective
        'returned',       -- Returned from field
        'scrapped'        -- Written off
    )),

    -- Installation Reference (KEY: links to actual work)
    installed_at_drop_id UUID,
    installed_at_drop_number VARCHAR(50),
    installed_at_home_install_id UUID,
    installed_date TIMESTAMP WITH TIME ZONE,
    installed_by VARCHAR(255),

    -- Receipt Info
    received_date DATE,
    received_reference VARCHAR(100),
    warranty_end_date DATE,

    condition VARCHAR(50) DEFAULT 'new' CHECK (condition IN (
        'new', 'good', 'fair', 'poor', 'damaged', 'non_functional'
    )),

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_stock_serials_unique ON stock_serials(stock_item_id, serial_number);
CREATE INDEX idx_stock_serials_status ON stock_serials(status);
CREATE INDEX idx_stock_serials_drop ON stock_serials(installed_at_drop_id);
```

### stock_quants
Current stock quantities by location (Odoo pattern).

```sql
CREATE TABLE stock_quants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    stock_item_id UUID NOT NULL REFERENCES stock_items(id),
    location_id UUID NOT NULL REFERENCES stock_locations(id),
    project_id UUID REFERENCES projects(id),

    quantity DECIMAL(12,3) NOT NULL DEFAULT 0,
    reserved_quantity DECIMAL(12,3) DEFAULT 0,

    lot_number VARCHAR(100),
    unit_cost DECIMAL(12,2),
    total_value DECIMAL(14,2),

    last_movement_date TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    CONSTRAINT unique_quant UNIQUE (stock_item_id, location_id, lot_number)
);
```

### stock_pickings
Issue orders, receipts, transfers (Odoo pattern).

```sql
CREATE TABLE stock_pickings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    picking_number VARCHAR(50) NOT NULL UNIQUE,

    picking_type VARCHAR(50) NOT NULL CHECK (picking_type IN (
        'issue',          -- Issue to technician
        'receipt',        -- Receive from supplier
        'return',         -- Return from field
        'transfer',       -- Inter-location transfer
        'scrap'           -- Write-off/disposal
    )),

    -- Locations
    source_location_id UUID NOT NULL REFERENCES stock_locations(id),
    destination_location_id UUID NOT NULL REFERENCES stock_locations(id),

    -- Job Reference
    project_id UUID REFERENCES projects(id),
    job_reference VARCHAR(100),
    job_type VARCHAR(50), -- 'drop', 'home_install', 'maintenance'

    -- Contractor/Team (SOP: stock allocated per team)
    contractor_id UUID,
    contractor_name VARCHAR(255),
    team_name VARCHAR(255),

    -- Technician (assigned team member)
    technician_id UUID,
    technician_name VARCHAR(255),

    -- Digital Signature (SOP 4.1: team member must sign for stock)
    signature_data TEXT,              -- Base64 signature image
    signed_at TIMESTAMP WITH TIME ZONE,
    signed_by VARCHAR(255),

    -- Status
    status VARCHAR(50) NOT NULL DEFAULT 'draft' CHECK (status IN (
        'draft', 'confirmed', 'processing', 'done', 'cancelled'
    )),

    scheduled_date DATE,
    effective_date TIMESTAMP WITH TIME ZONE,

    requested_by VARCHAR(255),
    approved_by VARCHAR(255),
    approved_at TIMESTAMP WITH TIME ZONE,
    notes TEXT,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_stock_pickings_technician ON stock_pickings(technician_id);
CREATE INDEX idx_stock_pickings_status ON stock_pickings(status);
```

### stock_picking_lines
Line items for each picking.

```sql
CREATE TABLE stock_picking_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    picking_id UUID NOT NULL REFERENCES stock_pickings(id) ON DELETE CASCADE,
    stock_item_id UUID NOT NULL REFERENCES stock_items(id),

    planned_quantity DECIMAL(12,3) NOT NULL,
    actual_quantity DECIMAL(12,3),

    serial_ids UUID[],  -- For serial-tracked items
    lot_number VARCHAR(100),

    unit_cost DECIMAL(12,2),
    total_cost DECIMAL(14,2),

    status VARCHAR(50) DEFAULT 'pending',
    notes TEXT,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

### stock_consumptions
Links stock usage to actual jobs (THE KEY TABLE FOR TRACEABILITY).

```sql
CREATE TABLE stock_consumptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Job Reference (CRITICAL)
    job_type VARCHAR(50) NOT NULL CHECK (job_type IN ('drop', 'home_install', 'maintenance')),
    drop_id UUID,
    drop_number VARCHAR(50),
    home_install_id UUID,

    picking_id UUID REFERENCES stock_pickings(id),

    -- Item Details
    stock_item_id UUID NOT NULL REFERENCES stock_items(id),
    item_code VARCHAR(100) NOT NULL,
    item_name VARCHAR(255) NOT NULL,

    quantity DECIMAL(12,3) NOT NULL,
    uom VARCHAR(20) NOT NULL,

    -- Serial (for tracked items)
    serial_id UUID REFERENCES stock_serials(id),
    serial_number VARCHAR(100),

    -- Technician
    consumed_by_id UUID,
    consumed_by_name VARCHAR(255),
    consumed_from_location_id UUID REFERENCES stock_locations(id),

    consumption_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- Verification
    verified BOOLEAN DEFAULT false,
    verified_by VARCHAR(255),
    verified_at TIMESTAMP WITH TIME ZONE,

    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_consumptions_drop ON stock_consumptions(drop_number);
CREATE INDEX idx_consumptions_serial ON stock_consumptions(serial_number);
CREATE INDEX idx_consumptions_technician ON stock_consumptions(consumed_by_id);
```

### stock_returns
Return orders from field.

```sql
CREATE TABLE stock_returns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    return_number VARCHAR(50) NOT NULL UNIQUE,

    original_picking_id UUID REFERENCES stock_pickings(id),

    returned_by_id UUID,
    returned_by_name VARCHAR(255),
    return_to_location_id UUID REFERENCES stock_locations(id),

    status VARCHAR(50) DEFAULT 'pending' CHECK (status IN (
        'pending', 'inspected', 'accepted', 'rejected', 'restocked'
    )),

    inspected_by VARCHAR(255),
    inspected_at TIMESTAMP WITH TIME ZONE,
    inspection_notes TEXT,

    return_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE stock_return_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    return_id UUID NOT NULL REFERENCES stock_returns(id) ON DELETE CASCADE,
    stock_item_id UUID NOT NULL REFERENCES stock_items(id),

    serial_id UUID REFERENCES stock_serials(id),
    serial_number VARCHAR(100),
    quantity DECIMAL(12,3) DEFAULT 1,

    condition VARCHAR(50),
    return_reason VARCHAR(100) CHECK (return_reason IN (
        'unused', 'job_cancelled', 'wrong_item', 'excess', 'faulty', 'customer_refused'
    )),
    disposition VARCHAR(50) CHECK (disposition IN (
        'restock', 'repair', 'scrap', 'supplier_return'
    )),

    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

### contractor_stock_accountability
Tracks stock liability per contractor (SOP Section 10).

```sql
CREATE TABLE contractor_stock_accountability (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contractor_id UUID NOT NULL,
    contractor_name VARCHAR(255) NOT NULL,

    -- Stock Summary
    total_issued_count INTEGER DEFAULT 0,
    total_issued_value DECIMAL(14,2) DEFAULT 0,
    total_consumed_count INTEGER DEFAULT 0,
    total_consumed_value DECIMAL(14,2) DEFAULT 0,
    total_returned_count INTEGER DEFAULT 0,
    total_returned_value DECIMAL(14,2) DEFAULT 0,

    -- Unaccounted (SOP 10.4: liable for lost/unaccounted)
    unaccounted_count INTEGER DEFAULT 0,
    unaccounted_value DECIMAL(14,2) DEFAULT 0,

    -- Blocking Status (SOP 4.4: no new stock if previous unaccounted)
    is_blocked BOOLEAN DEFAULT false,
    blocked_reason TEXT,
    blocked_at TIMESTAMP WITH TIME ZONE,
    blocked_by VARCHAR(255),

    -- Recovery (SOP 10.5: financial recovery/set-off)
    pending_recovery_amount DECIMAL(14,2) DEFAULT 0,
    recovered_amount DECIMAL(14,2) DEFAULT 0,

    last_reconciliation_date TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_contractor_accountability ON contractor_stock_accountability(contractor_id);
```

### Modifications to Existing Tables

```sql
-- Add to drops table (SOP 7.2: capture serials)
ALTER TABLE drops ADD COLUMN ont_serial VARCHAR(100);
ALTER TABLE drops ADD COLUMN mini_ups_serial VARCHAR(100);  -- SOP: Gizzu serial
ALTER TABLE drops ADD COLUMN ont_consumption_id UUID REFERENCES stock_consumptions(id);
ALTER TABLE drops ADD COLUMN mini_ups_consumption_id UUID REFERENCES stock_consumptions(id);
ALTER TABLE drops ADD COLUMN materials_issued BOOLEAN DEFAULT false;
ALTER TABLE drops ADD COLUMN materials_verified BOOLEAN DEFAULT false;

-- Add to home_installs (if exists)
ALTER TABLE home_installs ADD COLUMN ont_serial VARCHAR(100);
ALTER TABLE home_installs ADD COLUMN router_serial VARCHAR(100);
ALTER TABLE home_installs ADD COLUMN mini_ups_serial VARCHAR(100);
ALTER TABLE home_installs ADD COLUMN ont_consumption_id UUID REFERENCES stock_consumptions(id);
ALTER TABLE home_installs ADD COLUMN router_consumption_id UUID REFERENCES stock_consumptions(id);
ALTER TABLE home_installs ADD COLUMN mini_ups_consumption_id UUID REFERENCES stock_consumptions(id);
```

---

## Workflows

### 1. Stock Receipt at Warehouse
```
Supplier delivers goods
    ↓
Warehouse creates GRN (picking_type='receipt')
    ↓
For ONTs/Routers: Scan serial numbers → Create stock_serials records
For consumables: Enter quantities
    ↓
Validate against PO
    ↓
stock_quants updated at warehouse location
    ↓
Serial status = 'available'
```

### 2. Issue to Technician/Team (SOP Section 4)
```
Job scheduled (Drop or Home Install)
    ↓
CHECK: Is contractor blocked? (SOP 4.4)
  - Yes → BLOCK: "Previous allocation not fully accounted"
  - No → Continue
    ↓
Warehouse creates picking (picking_type='issue')
    ↓
Select items:
  - ONTs: Select specific serial numbers
  - Routers: Select specific serial numbers
  - Mini-UPS: Select specific serial numbers (SOP 7.2)
  - Consumables: Enter quantities
    ↓
Generate Digital Allocation Form (replaces paper form)
    ↓
Contractor/Team member signs digitally (SOP 4.1)
    ↓
System captures:
  - signature_data (base64)
  - signed_at timestamp
  - signed_by name
    ↓
Stock moved: warehouse location → technician location
    ↓
Serial status = 'issued'
stock_quants: warehouse ↓, technician ↑
contractor_stock_accountability: total_issued ↑
```

### 3. Consumption on Job (KEY WORKFLOW - SOP Section 7)
```
Technician at job site
    ↓
Opens mobile web app
    ↓
Selects Drop from job list (DR Number)
    ↓
Records materials (SOP 7.2: capture ALL serials):
  - Scans ONT barcode → Captures serial number (REQUIRED)
  - Scans Mini-UPS/Gizzu barcode → Captures serial number (REQUIRED for home installs)
  - Scans Router barcode → Captures serial number (if applicable)
  - Enters cable length used
  - Confirms consumables (connectors, etc.)
    ↓
Validates:
  - All serial numbers exist in system
  - Serials are in 'issued' status to this technician
  - Drop is valid and not already installed
    ↓
Creates stock_consumption records (one per item, links serial → drop)
    ↓
Updates stock_serials:
  - status = 'installed'
  - installed_at_drop_id = drop.id
  - installed_at_drop_number = 'DR123456'
    ↓
Updates stock_quants: technician location ↓
    ↓
Updates drops table:
  - ont_serial = 'ABC123'
  - mini_ups_serial = 'GIZ456'
  - materials_issued = true
    ↓
Updates contractor_stock_accountability:
  - total_consumed_count ↑
  - total_consumed_value ↑
```

### 4. Return Unused Stock
```
Technician has unused stock
    ↓
Creates return request (lists items, reasons)
    ↓
Warehouse receives return
    ↓
Inspection performed
    ↓
Disposition decision:
  - Good → Restock (status='available', location=warehouse)
  - Damaged → Repair queue
  - Faulty → Scrap (status='scrapped')
    ↓
stock_quants updated accordingly
```

### 5. Stock Reconciliation (SOP Section 10)
```
Weekly/Monthly trigger (or on-demand)
    ↓
Per Contractor/Team:
  - Total issued (from pickings)
  - Total consumed (from consumptions)
  - Total returned (from returns)
  - Unaccounted = issued - consumed - returned
    ↓
Generate discrepancy report:
  - Missing serial numbers
  - Unaccounted quantities
  - Value of missing stock
    ↓
If unaccounted > 0:
  - Mark contractor_stock_accountability.unaccounted_count/value
  - Consider blocking (SOP 4.4): is_blocked = true
  - Calculate recovery amount (SOP 10.5)
    ↓
Investigation:
  - Serial audit trail
  - Location history
  - Technician statements
    ↓
Resolution:
  - Found → Update location/status
  - Lost → Write-off + recovery from contractor
  - Damaged → Scrap + liability assessment
```

### 6. 1Map GPS Sync (Integration)
```
After consumption recorded
    ↓
If drop has GPS coordinates (from 1Map):
  - Verify installation location
  - Flag if technician GPS differs significantly
    ↓
Daily sync with 1Map:
  - Pull latest drop GPS data
  - Cross-reference installed equipment locations
  - Generate location discrepancy alerts
```

---

## API Endpoints

### Locations
```
GET    /api/procurement/field-stock/locations
GET    /api/procurement/field-stock/locations/:id
POST   /api/procurement/field-stock/locations
PUT    /api/procurement/field-stock/locations/:id
DELETE /api/procurement/field-stock/locations/:id
GET    /api/procurement/field-stock/locations/technicians
GET    /api/procurement/field-stock/locations/technician/:technicianId
```

### Items & Serials
```
GET    /api/procurement/field-stock/items
GET    /api/procurement/field-stock/items/:id
POST   /api/procurement/field-stock/items
PUT    /api/procurement/field-stock/items/:id
GET    /api/procurement/field-stock/items/:id/serials
GET    /api/procurement/field-stock/serials/:serialNumber
GET    /api/procurement/field-stock/serials/available
```

### Pickings
```
GET    /api/procurement/field-stock/pickings
GET    /api/procurement/field-stock/pickings/:id
POST   /api/procurement/field-stock/pickings
PUT    /api/procurement/field-stock/pickings/:id
POST   /api/procurement/field-stock/pickings/:id/confirm
POST   /api/procurement/field-stock/pickings/:id/process
POST   /api/procurement/field-stock/pickings/:id/cancel
POST   /api/procurement/field-stock/issues  (shortcut for tech issues)
```

### Consumptions
```
GET    /api/procurement/field-stock/consumptions
POST   /api/procurement/field-stock/consumptions
GET    /api/procurement/field-stock/consumptions/drop/:dropId
GET    /api/procurement/field-stock/consumptions/technician/:technicianId
```

### Returns
```
GET    /api/procurement/field-stock/returns
POST   /api/procurement/field-stock/returns
POST   /api/procurement/field-stock/returns/:id/inspect
POST   /api/procurement/field-stock/returns/:id/accept
```

### Contractor Accountability (SOP Section 10)
```
GET    /api/procurement/field-stock/contractors
GET    /api/procurement/field-stock/contractors/:contractorId
GET    /api/procurement/field-stock/contractors/:contractorId/stock
POST   /api/procurement/field-stock/contractors/:contractorId/block
POST   /api/procurement/field-stock/contractors/:contractorId/unblock
POST   /api/procurement/field-stock/contractors/:contractorId/reconcile
GET    /api/procurement/field-stock/contractors/:contractorId/liability
```

### Dashboard & Reports
```
GET    /api/procurement/field-stock/dashboard
GET    /api/procurement/field-stock/dashboard/technician/:technicianId
GET    /api/procurement/field-stock/dashboard/contractor/:contractorId
GET    /api/procurement/field-stock/reports/accountability
GET    /api/procurement/field-stock/reports/serial-audit
GET    /api/procurement/field-stock/reports/stock-by-location
GET    /api/procurement/field-stock/reports/unaccounted
GET    /api/procurement/field-stock/reports/recovery-pending
```

---

## UI Components

### New Components
```
src/modules/procurement/field-stock/
├── components/
│   ├── locations/
│   │   ├── LocationList.tsx
│   │   ├── LocationForm.tsx
│   │   └── TechnicianVanStockCard.tsx
│   ├── items/
│   │   ├── StockItemList.tsx
│   │   ├── SerialNumberList.tsx
│   │   └── SerialScanner.tsx
│   ├── pickings/
│   │   ├── PickingList.tsx
│   │   ├── CreateIssueModal.tsx
│   │   ├── SerialSelector.tsx
│   │   ├── PickingWorkflow.tsx
│   │   ├── DigitalAllocationForm.tsx     # SOP 4.1: replaces paper form
│   │   └── SignatureCapture.tsx          # Digital signature component
│   ├── consumption/
│   │   ├── ConsumptionRecorder.tsx       # Mobile-optimized
│   │   ├── DropMaterialsPanel.tsx
│   │   ├── SerialConsumptionForm.tsx
│   │   └── BarcodeScanner.tsx            # Camera-based scanning
│   ├── returns/
│   │   ├── ReturnList.tsx
│   │   ├── CreateReturnModal.tsx
│   │   └── ReturnInspectionForm.tsx
│   ├── accountability/                    # SOP Section 10
│   │   ├── ContractorAccountabilityList.tsx
│   │   ├── ContractorStockSummary.tsx
│   │   ├── UnaccountedStockAlert.tsx
│   │   ├── BlockContractorModal.tsx
│   │   └── RecoveryTracker.tsx
│   └── dashboard/
│       ├── FieldStockDashboard.tsx
│       ├── TechnicianAccountability.tsx
│       ├── ContractorAccountability.tsx
│       └── StockAlerts.tsx
├── hooks/
│   ├── useLocations.ts
│   ├── useSerials.ts
│   ├── usePickings.ts
│   ├── useConsumptions.ts
│   └── useContractorAccountability.ts
├── services/
│   ├── locationService.ts
│   ├── serialService.ts
│   ├── pickingService.ts
│   ├── consumptionService.ts
│   └── accountabilityService.ts
└── types/
    └── index.ts
```

### Digital Allocation Form (SOP 4.1)
Replaces paper Equipment Allocation Form with digital version:
- Lists all items being issued with serial numbers
- Contractor/Team selection
- Technician signature capture (touch/stylus)
- PDF generation for records
- Email copy to contractor

### Mobile Consumption Interface
Responsive web interface for technicians in the field:
- Large touch targets for outdoor use
- Camera-based barcode scanning
- Offline capability with sync
- GPS capture at installation
- Quick serial entry with keyboard

### Modified Components
- `src/modules/projects/drops/DropsManagement/components/DropCard.tsx` → Add materials section
- `src/modules/projects/home-installs/components/HomeInstallsTable.tsx` → Add materials column
- `src/components/layout/sidebar/` → Add "Field Stock" nav item

---

## Implementation Phases

### Phase 1: Foundation (Database + Types)
- Create migration scripts for all tables
- Define TypeScript types
- Set up API route structure

### Phase 2: Location Management
- CRUD for warehouses and site stores
- Auto-create technician van stock locations
- Location hierarchy view

### Phase 3: Stock Items & Serials
- Item master with tracking configuration
- Serial number registration
- Barcode scanning integration

### Phase 4: Pickings & Issues
- Create issue orders
- Serial selection for tracked items
- Technician confirmation workflow

### Phase 5: Consumption Tracking (KEY PHASE)
- Mobile-optimized consumption recorder
- Link materials to drops
- Serial → drop traceability

### Phase 6: Returns & Reconciliation
- Return workflow with inspection
- Condition and disposition tracking
- Stock adjustment handling

### Phase 7: Dashboard & Reports
- Field stock dashboard
- Technician accountability report
- Serial audit trail

---

## Success Criteria
1. **Accountability** - Know exactly what stock each technician has at any time
2. **Traceability** - Link every ONT/router to the specific drop where installed
3. **Visibility** - Real-time view of stock across all locations
4. **Reconciliation** - Weekly stock counts match system records within 2%
5. **Loss Prevention** - Identify and investigate discrepancies within 24 hours

---

## Dependencies
- Existing Procurement Stock module (`src/modules/procurement/stock/`)
- Existing Barcode Scanner module (`src/modules/barcode-scanner/`)
- Drops table in Projects module
- Staff module for technician references
- **1Map GIS Integration** (PRD-024) - GPS coordinates for drops, location verification
- **Contractors module** - Contractor/Team management
- **Signature library** - react-signature-canvas or similar

## Technical Dependencies
```json
{
  "react-signature-canvas": "^1.0.6",
  "quagga2": "^1.8.4",           // Barcode scanning
  "react-webcam": "^7.2.0",      // Camera access
  "html2canvas": "^1.4.1",       // PDF generation
  "jspdf": "^2.5.1"              // PDF generation
}
```

## References
- [Odoo Inventory Documentation](https://www.odoo.com/documentation/18.0/applications/inventory_and_mrp/inventory/)
- [Fiber Optic Best Practices](https://www.fiberopticsystems.com/best-practices-for-stocking-spare-parts-in-fiber-optic-systems)
- **Velocity Fibre SOP**: `docs/Uploads/Lawley/Home Installation & Activation – Standard Operating Procedure (SOP).pdf`
- **1Map Integration PRD**: `docs/PRDs/PRD-024-onemap-gis-integration.md`

---

## Appendix: SOP Compliance Checklist

| SOP Requirement | System Feature | Status |
|-----------------|----------------|--------|
| 4.1 Equipment Allocation Form | DigitalAllocationForm.tsx + SignatureCapture.tsx | Planned |
| 4.3 Link to DR Number | stock_consumptions.drop_number | Planned |
| 4.4 Block if unaccounted | contractor_stock_accountability.is_blocked | Planned |
| 7.2 Capture ONT serial | stock_serials + BarcodeScanner | Planned |
| 7.2 Capture Mini-UPS serial | stock_serials (category=mini_ups) | Planned |
| 8.3 Serial verification | Reconciliation reports | Planned |
| 10.3 Full traceability | stock_consumptions + stock_serials | Planned |
| 10.4 Liability tracking | contractor_stock_accountability | Planned |
| 10.5 Financial recovery | pending_recovery_amount field | Planned |
