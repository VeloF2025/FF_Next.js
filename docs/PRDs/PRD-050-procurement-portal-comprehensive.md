# PRD-050: Comprehensive Procurement Portal

## Executive Summary

A unified procurement, inventory, and supply chain management system for FibreFlow, integrating:
- **Procurement Management** - Purchase orders, RFQs, quotes, approvals
- **Supplier Management** - Vendor database, performance tracking, compliance
- **Bill of Quantities (BOQ)** - Project-based material requirements
- **Central Stock Control** - Warehouse inventory management
- **Field Stock Control** - Technician/site stock tracking (PRD-027)
- **Reporting & Analytics** - Spend analysis, stock valuation, accountability

### Vision
Transform FibreFlow's procurement from disconnected spreadsheets and manual processes into an integrated digital system that provides:
1. **End-to-end visibility** from purchase requisition to field installation
2. **Full traceability** linking every ONT/router to its installed location
3. **Financial control** with approval workflows and budget tracking
4. **Supplier accountability** with performance metrics and compliance tracking

---

## Current State Analysis

### What EXISTS and is WORKING (✅)

| Component | Status | Location |
|-----------|--------|----------|
| Asset Management | 85% complete | `src/modules/assets/` |
| Supplier CRUD | 80% UI, 40% API | `src/modules/suppliers/` |
| Procurement Portal UI | 90% UI complete | `src/modules/procurement/` |
| Field Stock Types | Complete | `src/modules/procurement/field-stock/types/` |
| Field Stock Components | 70% | `src/modules/procurement/field-stock/components/` |

### What EXISTS but is INCOMPLETE (⚠️)

| Component | Issue | Impact |
|-----------|-------|--------|
| BOQ Tab | No backend service | Cannot save BOQs |
| RFQ Tab | Service stub only | Cannot create RFQs |
| PO Tab | Mock data only | No persistence |
| Stock Movement | Components exist, no API | No stock tracking |
| Quote Evaluation | Stub page only | No comparison workflow |

### What is MISSING (❌)

| Component | Description |
|-----------|-------------|
| `/api/procurement/*` | No API routes for procurement |
| `/api/boq/*` | No BOQ endpoints |
| `/api/rfq/*` | No RFQ endpoints |
| `/api/purchase-orders/*` | No PO endpoints |
| `boq.types.ts` | Type definitions missing |
| `rfq.types.ts` | Type definitions missing |
| `purchase-order.types.ts` | Type definitions missing |
| Approval workflows | No multi-level approval |
| 3-way matching | No PO/Receipt/Invoice matching |
| Reorder automation | No automatic replenishment |

### Database Tables Status

| Table | Status | Notes |
|-------|--------|-------|
| `suppliers` | ✅ Exists | Full schema |
| `stock_locations` | ✅ Exists | From PRD-027 |
| `stock_items` | ✅ Exists | From PRD-027 |
| `stock_serials` | ✅ Exists | From PRD-027 |
| `stock_quants` | ✅ Exists | From PRD-027 |
| `stock_pickings` | ✅ Exists | From PRD-027 |
| `purchase_orders` | ⚠️ Partial | Schema exists, needs enhancement |
| `rfq_documents` | ⚠️ Partial | Basic schema |
| `boq_headers` | ❌ Missing | Needs creation |
| `boq_items` | ❌ Missing | Needs creation |

---

## Problem Statement

### 1. Procurement Chaos
- No central system for purchase requisitions
- RFQs managed via email and spreadsheets
- No audit trail for purchasing decisions
- Budget overruns discovered too late

### 2. Stock Black Hole
- Materials issued to technicians disappear
- No traceability from purchase to installation
- Cannot reconcile stock against projects
- Manual physical counts are unreliable

### 3. Supplier Blindness
- No performance metrics for suppliers
- Compliance documents scattered across folders
- No automated renewal reminders
- Cannot compare vendor pricing history

### 4. BOQ Disconnect
- Project BOQs in Excel, disconnected from procurement
- No automatic reorder when BOQ approved
- Cannot track BOQ vs actual consumption
- Multiple versions cause confusion

---

## Goals

### Primary Goals
1. **Unified Procurement** - Single platform for all purchasing activities
2. **Full Traceability** - Track every item from PO to installation
3. **Financial Control** - Approval workflows with budget enforcement
4. **Operational Efficiency** - Automate manual processes

### Success Metrics
| Metric | Current | Target |
|--------|---------|--------|
| PO creation time | 2-3 days | < 1 hour |
| Stock discrepancy rate | Unknown | < 2% |
| Supplier compliance | Manual tracking | 100% digital |
| BOQ to PO time | 1-2 weeks | < 2 days |
| Procurement visibility | None | Real-time dashboards |

---

## Feature Requirements

### Module 1: Procurement Core

#### 1.1 Purchase Requisitions
**Purpose:** Formalize material requests before procurement

| Feature | Priority | Description |
|---------|----------|-------------|
| Create requisition | HIGH | Request materials with quantities, urgency |
| Attach to project | HIGH | Link requisition to specific project |
| Approval workflow | HIGH | Manager approval for value thresholds |
| Convert to RFQ/PO | HIGH | One-click conversion after approval |
| Track status | MEDIUM | Pending → Approved → Ordered → Received |

**Workflow:**
```
Field Team/PM creates requisition
    ↓
System checks budget allocation
    ↓
Routes for approval based on value:
  - < R10,000: Auto-approve
  - R10,000 - R50,000: Manager approval
  - > R50,000: Director approval
    ↓
Approved → Procurement team receives notification
    ↓
Convert to RFQ (multiple suppliers) or PO (single supplier)
```

#### 1.2 Request for Quotation (RFQ)
**Purpose:** Get competitive quotes from multiple suppliers

| Feature | Priority | Description |
|---------|----------|-------------|
| Create RFQ | HIGH | Generate RFQ document from requisition |
| Multi-supplier send | HIGH | Send to multiple vendors simultaneously |
| Supplier portal | HIGH | Vendors respond via self-service portal |
| Quote comparison | HIGH | Side-by-side comparison matrix |
| Auto-select | MEDIUM | Recommend best quote based on criteria |
| Blanket RFQ | LOW | Standing quotes for recurring items |

**Quote Evaluation Criteria:**
- Unit price (weighted 40%)
- Total cost including delivery (weighted 25%)
- Lead time (weighted 20%)
- Supplier rating (weighted 15%)

#### 1.3 Purchase Orders
**Purpose:** Formalize purchases with suppliers

| Feature | Priority | Description |
|---------|----------|-------------|
| Create PO | HIGH | Generate PO from approved quote |
| Multi-line items | HIGH | Multiple products per PO |
| Delivery scheduling | HIGH | Expected delivery dates |
| Partial receipts | HIGH | Receive in multiple shipments |
| PO amendments | MEDIUM | Modify quantities before delivery |
| Recurring POs | LOW | Auto-generate for regular orders |

**PO Lifecycle:**
```
Draft → Submitted → Approved → Sent to Supplier → Partial Receipt → Complete → Invoiced → Paid
```

#### 1.4 Goods Receipt
**Purpose:** Validate and record incoming deliveries

| Feature | Priority | Description |
|---------|----------|-------------|
| Create GRN | HIGH | Goods Receipt Note from PO |
| Quantity validation | HIGH | Compare received vs ordered |
| Quality inspection | MEDIUM | Pass/fail inspection workflow |
| Serial capture | HIGH | Scan serials for tracked items |
| Discrepancy handling | HIGH | Over/under delivery workflow |
| Auto-location | MEDIUM | Assign to default warehouse |

#### 1.5 3-Way Matching
**Purpose:** Prevent payment fraud and errors

| Feature | Priority | Description |
|---------|----------|-------------|
| PO matching | HIGH | Match invoice to purchase order |
| GRN matching | HIGH | Match invoice to goods receipt |
| Variance alerts | HIGH | Flag mismatches > threshold |
| Approval queue | MEDIUM | Route exceptions for review |
| Auto-approve | LOW | Within tolerance auto-processes |

**Matching Rules:**
- Price variance tolerance: ±5%
- Quantity variance tolerance: ±2%
- Mismatches require manual approval

---

### Module 2: Supplier Management

#### 2.1 Supplier Master
**Purpose:** Central repository for all vendor information

| Feature | Priority | Description |
|---------|----------|-------------|
| Supplier profile | HIGH | Contact info, addresses, bank details |
| Multiple contacts | HIGH | Different contacts per function |
| Product catalog | MEDIUM | What each supplier provides |
| Price lists | MEDIUM | Contracted pricing with validity |
| Payment terms | HIGH | Net 30, EOM, etc. |
| Tax registration | HIGH | VAT number, B-BBEE level |

#### 2.2 Supplier Compliance
**Purpose:** Track and enforce supplier requirements

| Feature | Priority | Description |
|---------|----------|-------------|
| Document upload | HIGH | Certificates, insurance, licenses |
| Expiry tracking | HIGH | Automatic expiry reminders |
| Compliance status | HIGH | Valid/Expired/Missing badges |
| Block on expired | MEDIUM | Prevent PO if non-compliant |
| Renewal reminders | HIGH | 30/14/7 day notifications |

**Required Documents:**
- B-BBEE Certificate (annual)
- Tax Clearance Certificate (annual)
- Public Liability Insurance (annual)
- CIDB Registration (construction suppliers)
- Company Registration (CK/CIPC)

#### 2.3 Supplier Performance
**Purpose:** Measure and track supplier quality

| Feature | Priority | Description |
|---------|----------|-------------|
| Delivery rating | HIGH | On-time delivery percentage |
| Quality rating | HIGH | Defect/return rate |
| Price competitiveness | MEDIUM | Compared to market |
| Communication | MEDIUM | Response time rating |
| Overall score | HIGH | Composite performance score |

**Rating Calculation:**
```
Overall Score = (Delivery × 0.35) + (Quality × 0.35) + (Price × 0.15) + (Communication × 0.15)
```

#### 2.4 Supplier Portal
**Purpose:** Self-service for suppliers

| Feature | Priority | Description |
|---------|----------|-------------|
| Portal login | HIGH | Secure supplier access |
| View RFQs | HIGH | See open RFQ invitations |
| Submit quotes | HIGH | Respond to RFQs online |
| View POs | HIGH | See their purchase orders |
| Update documents | MEDIUM | Upload compliance docs |
| Invoice submission | LOW | Digital invoice upload |

---

### Module 3: Bill of Quantities (BOQ)

#### 3.1 BOQ Creation
**Purpose:** Define material requirements per project

| Feature | Priority | Description |
|---------|----------|-------------|
| Create BOQ | HIGH | New BOQ for project |
| Excel import | HIGH | Import from existing spreadsheets |
| Template library | MEDIUM | Standard BOQ templates |
| Version control | HIGH | Track BOQ revisions |
| Clone BOQ | MEDIUM | Copy from similar project |

#### 3.2 BOQ Structure
**Purpose:** Organize materials hierarchically

```
BOQ: Lawley Phase 1
├── Section: Backbone
│   ├── Fiber Cable 12-core (500m)
│   ├── Splice Closures (10)
│   └── Splice Trays (20)
├── Section: Distribution
│   ├── Fiber Cable 6-core (2000m)
│   ├── Drop Closures (100)
│   └── Splitters 1:8 (50)
├── Section: Drops
│   ├── Drop Cable (15000m)
│   ├── ONT Units (500)
│   └── Connectors (1500)
└── Section: Consumables
    ├── Cable Ties (5000)
    ├── Labels (1000)
    └── Splice Protectors (500)
```

#### 3.3 BOQ Approval
**Purpose:** Control BOQ changes

| Feature | Priority | Description |
|---------|----------|-------------|
| Submit for approval | HIGH | Send BOQ for review |
| Approval workflow | HIGH | PM → Finance → Director |
| Comments/feedback | MEDIUM | Reviewers can comment |
| Revision history | HIGH | Full change audit trail |
| Lock approved BOQ | MEDIUM | Prevent changes after approval |

#### 3.4 BOQ to Procurement
**Purpose:** Convert approved BOQ to purchase orders

| Feature | Priority | Description |
|---------|----------|-------------|
| Generate requisitions | HIGH | Create PRs from BOQ |
| Check stock first | HIGH | Don't order what's in stock |
| Supplier mapping | MEDIUM | Default supplier per item |
| Consolidate items | MEDIUM | Combine across sections |
| Phased ordering | LOW | Order per project phase |

#### 3.5 BOQ Tracking
**Purpose:** Monitor BOQ consumption

| Feature | Priority | Description |
|---------|----------|-------------|
| Ordered quantities | HIGH | What's been ordered |
| Received quantities | HIGH | What's been delivered |
| Issued quantities | HIGH | What's gone to field |
| Consumed quantities | HIGH | What's been installed |
| Variance analysis | HIGH | BOQ vs Actual comparison |

---

### Module 4: Central Stock Control

#### 4.1 Warehouse Management
**Purpose:** Manage physical warehouse locations

| Feature | Priority | Description |
|---------|----------|-------------|
| Multi-warehouse | HIGH | Multiple storage locations |
| Location hierarchy | MEDIUM | Zone → Aisle → Bin |
| Location types | HIGH | Warehouse, Site, Transit |
| Capacity tracking | LOW | Space utilization |
| Pick paths | LOW | Optimized picking routes |

**Warehouse Structure:**
```
FibreFlow Inventory
├── JHB Central Warehouse
│   ├── Zone A: Fiber & Cable
│   ├── Zone B: Active Equipment
│   ├── Zone C: Consumables
│   └── Receiving Bay
├── Project: Lawley Site Store
├── Project: Mamelodi Site Store
├── Transit (Virtual)
└── Scrap/Returns (Virtual)
```

#### 4.2 Stock Items Master
**Purpose:** Central product catalog

| Feature | Priority | Description |
|---------|----------|-------------|
| Item master | HIGH | Product database |
| SKU/barcode | HIGH | Unique identifiers |
| Categories | HIGH | Product classification |
| UOM | HIGH | Unit of measure |
| Tracking type | HIGH | Serial/Lot/Quantity |
| Reorder rules | MEDIUM | Min/Max levels |

**Tracking Types:**
| Type | Use Case | Example |
|------|----------|---------|
| Serial | High-value, unique items | ONTs, Routers, Mini-UPS |
| Lot | Batch-tracked items | Cable drums (track meters) |
| Quantity | Standard items | Connectors, cable ties |

#### 4.3 Stock Movements
**Purpose:** Track all inventory changes

| Feature | Priority | Description |
|---------|----------|-------------|
| Goods receipt | HIGH | Receive from supplier |
| Internal transfer | HIGH | Move between locations |
| Issue to field | HIGH | Issue to technicians |
| Returns | HIGH | Receive back from field |
| Adjustments | MEDIUM | Inventory corrections |
| Scrap/write-off | MEDIUM | Dispose damaged items |

#### 4.4 Stock Valuation
**Purpose:** Financial value of inventory

| Feature | Priority | Description |
|---------|----------|-------------|
| Valuation method | HIGH | FIFO/Average cost |
| Cost tracking | HIGH | Per-item cost history |
| Inventory value | HIGH | Total stock value report |
| Movement costs | MEDIUM | Cost impact of movements |

#### 4.5 Reorder Management
**Purpose:** Automate replenishment

| Feature | Priority | Description |
|---------|----------|-------------|
| Reorder point | HIGH | Minimum stock threshold |
| Reorder quantity | HIGH | How much to order |
| Safety stock | MEDIUM | Buffer quantity |
| Lead time | MEDIUM | Expected delivery time |
| Auto-requisition | LOW | Auto-create PR at reorder |

**Reorder Formula:**
```
Reorder Point = (Daily Usage × Lead Time) + Safety Stock
```

---

### Module 5: Field Stock Control (PRD-027)

*Reference: PRD-027-field-stock-control.md*

This module is already defined in detail. Key features:

| Feature | Status | Description |
|---------|--------|-------------|
| Technician van stock | Designed | Virtual locations per tech |
| Stock issuance | Designed | Digital allocation forms |
| Consumption recording | Designed | Link materials to drops |
| Serial traceability | Designed | Track ONT → Drop mapping |
| Returns workflow | Designed | Handle unused materials |
| Accountability | Designed | Contractor liability tracking |
| Blocking | Designed | Block if unaccounted stock |

---

### Module 6: Reporting & Analytics

#### 6.1 Procurement Reports
| Report | Priority | Description |
|--------|----------|-------------|
| Spend Analysis | HIGH | Spending by supplier/category |
| PO Status | HIGH | Open/received/paid POs |
| Supplier Performance | HIGH | Vendor scorecards |
| Price Trends | MEDIUM | Historical pricing |
| Budget vs Actual | HIGH | Project procurement spend |

#### 6.2 Inventory Reports
| Report | Priority | Description |
|--------|----------|-------------|
| Stock on Hand | HIGH | Current quantities by location |
| Stock Valuation | HIGH | Inventory financial value |
| Stock Movement | HIGH | Movement history |
| Aging Report | MEDIUM | Stock age analysis |
| Reorder Report | HIGH | Items below reorder point |

#### 6.3 Field Stock Reports
| Report | Priority | Description |
|--------|----------|-------------|
| Technician Stock | HIGH | Stock per technician |
| Contractor Accountability | HIGH | Issued vs consumed |
| Unaccounted Stock | HIGH | Missing materials |
| Serial Audit Trail | HIGH | Full serial history |
| Consumption by Project | HIGH | Materials per project |

#### 6.4 BOQ Reports
| Report | Priority | Description |
|--------|----------|-------------|
| BOQ Status | HIGH | Ordered/received/consumed |
| BOQ Variance | HIGH | Planned vs actual |
| Cost Overrun | HIGH | BOQ budget vs actual cost |
| Completion Progress | MEDIUM | % of BOQ fulfilled |

---

## Data Model

### Core Procurement Tables

```sql
-- Purchase Requisitions
CREATE TABLE purchase_requisitions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    requisition_number VARCHAR(50) UNIQUE NOT NULL,

    -- Context
    project_id UUID REFERENCES projects(id),
    department VARCHAR(100),

    -- Requestor
    requested_by UUID NOT NULL,
    requested_by_name VARCHAR(255),
    requested_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    required_date DATE,

    -- Approval
    status VARCHAR(30) DEFAULT 'draft' CHECK (status IN (
        'draft', 'submitted', 'pending_approval', 'approved',
        'rejected', 'ordered', 'partially_ordered', 'closed', 'cancelled'
    )),
    approved_by UUID,
    approved_at TIMESTAMP WITH TIME ZONE,
    rejection_reason TEXT,

    -- Financials
    estimated_total DECIMAL(14,2),
    currency VARCHAR(3) DEFAULT 'ZAR',

    -- Tracking
    urgency VARCHAR(20) DEFAULT 'normal' CHECK (urgency IN ('low', 'normal', 'high', 'critical')),
    notes TEXT,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE purchase_requisition_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    requisition_id UUID NOT NULL REFERENCES purchase_requisitions(id) ON DELETE CASCADE,

    stock_item_id UUID REFERENCES stock_items(id),
    item_code VARCHAR(100),
    item_description TEXT NOT NULL,

    quantity DECIMAL(12,3) NOT NULL,
    uom VARCHAR(20) NOT NULL,
    estimated_unit_price DECIMAL(12,2),
    estimated_total DECIMAL(14,2),

    suggested_supplier_id UUID REFERENCES suppliers(id),
    notes TEXT,

    -- Conversion tracking
    converted_to_rfq BOOLEAN DEFAULT false,
    converted_to_po BOOLEAN DEFAULT false,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Request for Quotation
CREATE TABLE rfq_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rfq_number VARCHAR(50) UNIQUE NOT NULL,

    -- Source
    requisition_id UUID REFERENCES purchase_requisitions(id),
    project_id UUID REFERENCES projects(id),

    -- Dates
    issue_date DATE DEFAULT CURRENT_DATE,
    response_deadline DATE NOT NULL,
    validity_period INTEGER DEFAULT 30, -- days

    -- Status
    status VARCHAR(30) DEFAULT 'draft' CHECK (status IN (
        'draft', 'sent', 'responses_received', 'evaluating',
        'awarded', 'cancelled', 'expired'
    )),

    -- Terms
    delivery_address TEXT,
    payment_terms VARCHAR(100),
    special_conditions TEXT,

    created_by UUID NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE rfq_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rfq_id UUID NOT NULL REFERENCES rfq_documents(id) ON DELETE CASCADE,

    stock_item_id UUID REFERENCES stock_items(id),
    item_code VARCHAR(100),
    item_description TEXT NOT NULL,
    specifications TEXT,

    quantity DECIMAL(12,3) NOT NULL,
    uom VARCHAR(20) NOT NULL,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE rfq_suppliers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rfq_id UUID NOT NULL REFERENCES rfq_documents(id) ON DELETE CASCADE,
    supplier_id UUID NOT NULL REFERENCES suppliers(id),

    sent_at TIMESTAMP WITH TIME ZONE,
    sent_via VARCHAR(20), -- email, portal
    portal_access_token VARCHAR(255),

    response_status VARCHAR(30) DEFAULT 'pending' CHECK (response_status IN (
        'pending', 'viewed', 'responded', 'declined', 'no_response'
    )),
    response_date TIMESTAMP WITH TIME ZONE,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE rfq_responses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rfq_id UUID NOT NULL REFERENCES rfq_documents(id) ON DELETE CASCADE,
    supplier_id UUID NOT NULL REFERENCES suppliers(id),
    rfq_supplier_id UUID REFERENCES rfq_suppliers(id),

    -- Response Details
    response_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    validity_date DATE,
    lead_time_days INTEGER,

    -- Totals
    subtotal DECIMAL(14,2),
    tax_amount DECIMAL(14,2),
    total_amount DECIMAL(14,2),
    currency VARCHAR(3) DEFAULT 'ZAR',

    -- Terms offered
    payment_terms VARCHAR(100),
    delivery_terms VARCHAR(100),
    notes TEXT,

    -- Evaluation
    is_selected BOOLEAN DEFAULT false,
    evaluation_score DECIMAL(5,2),
    evaluation_notes TEXT,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE rfq_response_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    response_id UUID NOT NULL REFERENCES rfq_responses(id) ON DELETE CASCADE,
    rfq_item_id UUID NOT NULL REFERENCES rfq_items(id),

    unit_price DECIMAL(12,2) NOT NULL,
    quantity_available DECIMAL(12,3),
    lead_time_days INTEGER,
    notes TEXT,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Purchase Orders (Enhanced)
CREATE TABLE purchase_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    po_number VARCHAR(50) UNIQUE NOT NULL,

    -- Source
    requisition_id UUID REFERENCES purchase_requisitions(id),
    rfq_id UUID REFERENCES rfq_documents(id),
    rfq_response_id UUID REFERENCES rfq_responses(id),

    -- Supplier
    supplier_id UUID NOT NULL REFERENCES suppliers(id),
    supplier_contact_id UUID,

    -- Context
    project_id UUID REFERENCES projects(id),
    warehouse_id UUID REFERENCES stock_locations(id),

    -- Dates
    order_date DATE DEFAULT CURRENT_DATE,
    expected_delivery_date DATE,

    -- Status
    status VARCHAR(30) DEFAULT 'draft' CHECK (status IN (
        'draft', 'pending_approval', 'approved', 'sent',
        'acknowledged', 'partially_received', 'received',
        'invoiced', 'paid', 'cancelled', 'closed'
    )),

    -- Approval
    approval_required BOOLEAN DEFAULT false,
    approved_by UUID,
    approved_at TIMESTAMP WITH TIME ZONE,

    -- Financials
    subtotal DECIMAL(14,2),
    tax_rate DECIMAL(5,2) DEFAULT 15.00,
    tax_amount DECIMAL(14,2),
    shipping_cost DECIMAL(12,2) DEFAULT 0,
    total_amount DECIMAL(14,2),
    currency VARCHAR(3) DEFAULT 'ZAR',

    -- Terms
    payment_terms VARCHAR(100),
    delivery_address TEXT,
    shipping_method VARCHAR(100),
    incoterms VARCHAR(20),

    -- Tracking
    supplier_reference VARCHAR(100),
    internal_notes TEXT,
    supplier_notes TEXT,

    created_by UUID NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE purchase_order_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    purchase_order_id UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,

    stock_item_id UUID REFERENCES stock_items(id),
    item_code VARCHAR(100),
    item_description TEXT NOT NULL,

    quantity_ordered DECIMAL(12,3) NOT NULL,
    quantity_received DECIMAL(12,3) DEFAULT 0,
    uom VARCHAR(20) NOT NULL,

    unit_price DECIMAL(12,2) NOT NULL,
    tax_rate DECIMAL(5,2),
    tax_amount DECIMAL(12,2),
    total_price DECIMAL(14,2),

    expected_delivery_date DATE,
    notes TEXT,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Goods Receipt Notes
CREATE TABLE goods_receipt_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    grn_number VARCHAR(50) UNIQUE NOT NULL,

    purchase_order_id UUID REFERENCES purchase_orders(id),
    supplier_id UUID NOT NULL REFERENCES suppliers(id),

    -- Delivery Details
    delivery_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    delivery_note_number VARCHAR(100),
    carrier VARCHAR(100),

    -- Location
    warehouse_id UUID NOT NULL REFERENCES stock_locations(id),

    -- Status
    status VARCHAR(30) DEFAULT 'draft' CHECK (status IN (
        'draft', 'receiving', 'inspecting', 'completed',
        'partial', 'rejected', 'cancelled'
    )),

    -- Inspection
    inspection_required BOOLEAN DEFAULT false,
    inspected_by UUID,
    inspected_at TIMESTAMP WITH TIME ZONE,
    inspection_notes TEXT,

    -- Totals
    total_items INTEGER,
    total_quantity_received DECIMAL(12,3),

    received_by UUID NOT NULL,
    notes TEXT,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE goods_receipt_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    grn_id UUID NOT NULL REFERENCES goods_receipt_notes(id) ON DELETE CASCADE,
    po_item_id UUID REFERENCES purchase_order_items(id),

    stock_item_id UUID REFERENCES stock_items(id),
    item_code VARCHAR(100),
    item_description TEXT,

    quantity_expected DECIMAL(12,3),
    quantity_received DECIMAL(12,3) NOT NULL,
    quantity_rejected DECIMAL(12,3) DEFAULT 0,
    uom VARCHAR(20) NOT NULL,

    -- For serial-tracked items
    serial_numbers TEXT[], -- Array of serials received

    -- For lot-tracked items
    lot_number VARCHAR(100),
    expiry_date DATE,

    -- Location
    location_id UUID REFERENCES stock_locations(id),

    -- Quality
    inspection_status VARCHAR(30) CHECK (inspection_status IN (
        'pending', 'passed', 'failed', 'partial'
    )),
    rejection_reason TEXT,

    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- BOQ Tables
CREATE TABLE boq_headers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    boq_number VARCHAR(50) UNIQUE NOT NULL,

    -- Context
    project_id UUID NOT NULL REFERENCES projects(id),
    project_phase VARCHAR(100),

    -- Details
    title VARCHAR(255) NOT NULL,
    description TEXT,

    -- Version Control
    version INTEGER DEFAULT 1,
    parent_version_id UUID REFERENCES boq_headers(id),
    is_current BOOLEAN DEFAULT true,

    -- Status
    status VARCHAR(30) DEFAULT 'draft' CHECK (status IN (
        'draft', 'submitted', 'under_review', 'approved',
        'rejected', 'active', 'completed', 'cancelled'
    )),

    -- Approval
    submitted_by UUID,
    submitted_at TIMESTAMP WITH TIME ZONE,
    approved_by UUID,
    approved_at TIMESTAMP WITH TIME ZONE,
    rejection_reason TEXT,

    -- Financials
    estimated_total DECIMAL(14,2),
    approved_budget DECIMAL(14,2),
    currency VARCHAR(3) DEFAULT 'ZAR',

    -- Dates
    valid_from DATE,
    valid_to DATE,

    created_by UUID NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE boq_sections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    boq_id UUID NOT NULL REFERENCES boq_headers(id) ON DELETE CASCADE,

    section_number VARCHAR(20),
    title VARCHAR(255) NOT NULL,
    description TEXT,
    sort_order INTEGER DEFAULT 0,

    -- Section totals (calculated)
    estimated_total DECIMAL(14,2),

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE boq_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    boq_id UUID NOT NULL REFERENCES boq_headers(id) ON DELETE CASCADE,
    section_id UUID REFERENCES boq_sections(id),

    -- Item Details
    stock_item_id UUID REFERENCES stock_items(id),
    item_code VARCHAR(100),
    item_description TEXT NOT NULL,
    specifications TEXT,

    -- Quantities
    quantity DECIMAL(12,3) NOT NULL,
    uom VARCHAR(20) NOT NULL,
    unit_rate DECIMAL(12,2),
    total_amount DECIMAL(14,2),

    -- Tracking
    quantity_ordered DECIMAL(12,3) DEFAULT 0,
    quantity_received DECIMAL(12,3) DEFAULT 0,
    quantity_issued DECIMAL(12,3) DEFAULT 0,
    quantity_consumed DECIMAL(12,3) DEFAULT 0,
    quantity_returned DECIMAL(12,3) DEFAULT 0,

    -- Variance
    variance_quantity DECIMAL(12,3) GENERATED ALWAYS AS (quantity - quantity_consumed + quantity_returned) STORED,

    sort_order INTEGER DEFAULT 0,
    notes TEXT,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Approval Workflow Tables
CREATE TABLE approval_workflows (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_type VARCHAR(50) NOT NULL, -- 'purchase_requisition', 'purchase_order', 'boq'

    name VARCHAR(255) NOT NULL,
    description TEXT,
    is_active BOOLEAN DEFAULT true,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE approval_levels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_id UUID NOT NULL REFERENCES approval_workflows(id) ON DELETE CASCADE,

    level_number INTEGER NOT NULL,
    name VARCHAR(100) NOT NULL,

    -- Threshold
    min_amount DECIMAL(14,2) DEFAULT 0,
    max_amount DECIMAL(14,2),

    -- Approvers
    approver_role VARCHAR(100), -- 'manager', 'finance', 'director'
    approver_user_id UUID,

    -- Settings
    required BOOLEAN DEFAULT true,
    auto_approve BOOLEAN DEFAULT false,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE approval_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_id UUID NOT NULL REFERENCES approval_workflows(id),
    level_id UUID NOT NULL REFERENCES approval_levels(id),

    -- Document Reference
    document_type VARCHAR(50) NOT NULL,
    document_id UUID NOT NULL,

    -- Request
    requested_by UUID NOT NULL,
    requested_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- Response
    status VARCHAR(30) DEFAULT 'pending' CHECK (status IN (
        'pending', 'approved', 'rejected', 'escalated', 'skipped'
    )),
    responded_by UUID,
    responded_at TIMESTAMP WITH TIME ZONE,
    comments TEXT,

    -- Escalation
    escalated_to UUID,
    escalated_at TIMESTAMP WITH TIME ZONE,
    escalation_reason TEXT,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_pr_status ON purchase_requisitions(status);
CREATE INDEX idx_pr_project ON purchase_requisitions(project_id);
CREATE INDEX idx_rfq_status ON rfq_documents(status);
CREATE INDEX idx_rfq_deadline ON rfq_documents(response_deadline);
CREATE INDEX idx_po_status ON purchase_orders(status);
CREATE INDEX idx_po_supplier ON purchase_orders(supplier_id);
CREATE INDEX idx_po_project ON purchase_orders(project_id);
CREATE INDEX idx_grn_po ON goods_receipt_notes(purchase_order_id);
CREATE INDEX idx_boq_project ON boq_headers(project_id);
CREATE INDEX idx_boq_status ON boq_headers(status);
```

### Enhanced Supplier Tables

```sql
-- Supplier Compliance Documents
CREATE TABLE supplier_compliance_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,

    document_type VARCHAR(50) NOT NULL CHECK (document_type IN (
        'bbbee_certificate', 'tax_clearance', 'liability_insurance',
        'cidb_registration', 'company_registration', 'bank_confirmation',
        'quality_certification', 'safety_certification', 'other'
    )),

    document_name VARCHAR(255),
    document_number VARCHAR(100),

    issue_date DATE,
    expiry_date DATE,

    -- Status
    status VARCHAR(30) DEFAULT 'valid' CHECK (status IN (
        'valid', 'expiring_soon', 'expired', 'pending_verification'
    )),

    -- File
    file_path VARCHAR(500),
    file_name VARCHAR(255),
    file_size INTEGER,

    -- Verification
    verified_by UUID,
    verified_at TIMESTAMP WITH TIME ZONE,

    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Supplier Performance Tracking
CREATE TABLE supplier_performance_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    supplier_id UUID NOT NULL REFERENCES suppliers(id),

    -- Period
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,

    -- Metrics
    total_orders INTEGER DEFAULT 0,
    on_time_deliveries INTEGER DEFAULT 0,
    late_deliveries INTEGER DEFAULT 0,
    total_items_received INTEGER DEFAULT 0,
    items_rejected INTEGER DEFAULT 0,

    -- Scores (0-100)
    delivery_score DECIMAL(5,2),
    quality_score DECIMAL(5,2),
    price_score DECIMAL(5,2),
    communication_score DECIMAL(5,2),
    overall_score DECIMAL(5,2),

    -- Calculated values
    on_time_percentage DECIMAL(5,2) GENERATED ALWAYS AS (
        CASE WHEN total_orders > 0
        THEN (on_time_deliveries::DECIMAL / total_orders) * 100
        ELSE 0 END
    ) STORED,

    quality_percentage DECIMAL(5,2) GENERATED ALWAYS AS (
        CASE WHEN total_items_received > 0
        THEN ((total_items_received - items_rejected)::DECIMAL / total_items_received) * 100
        ELSE 100 END
    ) STORED,

    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Supplier Price Lists
CREATE TABLE supplier_price_lists (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    supplier_id UUID NOT NULL REFERENCES suppliers(id),

    name VARCHAR(255) NOT NULL,
    valid_from DATE NOT NULL,
    valid_to DATE,
    currency VARCHAR(3) DEFAULT 'ZAR',

    is_active BOOLEAN DEFAULT true,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE supplier_price_list_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    price_list_id UUID NOT NULL REFERENCES supplier_price_lists(id) ON DELETE CASCADE,

    stock_item_id UUID REFERENCES stock_items(id),
    item_code VARCHAR(100),
    item_description TEXT,

    unit_price DECIMAL(12,2) NOT NULL,
    min_quantity DECIMAL(12,3) DEFAULT 1,
    uom VARCHAR(20),

    lead_time_days INTEGER,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_supplier_docs_type ON supplier_compliance_documents(document_type);
CREATE INDEX idx_supplier_docs_expiry ON supplier_compliance_documents(expiry_date);
CREATE INDEX idx_supplier_perf_period ON supplier_performance_records(supplier_id, period_start);
```

---

## API Specifications

### Procurement APIs

```
# Purchase Requisitions
GET    /api/procurement/requisitions
POST   /api/procurement/requisitions
GET    /api/procurement/requisitions/:id
PUT    /api/procurement/requisitions/:id
DELETE /api/procurement/requisitions/:id
POST   /api/procurement/requisitions/:id/submit
POST   /api/procurement/requisitions/:id/approve
POST   /api/procurement/requisitions/:id/reject
POST   /api/procurement/requisitions/:id/convert-to-rfq
POST   /api/procurement/requisitions/:id/convert-to-po

# RFQ
GET    /api/procurement/rfq
POST   /api/procurement/rfq
GET    /api/procurement/rfq/:id
PUT    /api/procurement/rfq/:id
DELETE /api/procurement/rfq/:id
POST   /api/procurement/rfq/:id/send
POST   /api/procurement/rfq/:id/close
GET    /api/procurement/rfq/:id/responses
POST   /api/procurement/rfq/:id/evaluate
POST   /api/procurement/rfq/:id/award

# RFQ Supplier Portal
GET    /api/procurement/rfq/portal/:token
POST   /api/procurement/rfq/portal/:token/respond
POST   /api/procurement/rfq/portal/:token/decline

# Purchase Orders
GET    /api/procurement/purchase-orders
POST   /api/procurement/purchase-orders
GET    /api/procurement/purchase-orders/:id
PUT    /api/procurement/purchase-orders/:id
DELETE /api/procurement/purchase-orders/:id
POST   /api/procurement/purchase-orders/:id/submit
POST   /api/procurement/purchase-orders/:id/approve
POST   /api/procurement/purchase-orders/:id/send
POST   /api/procurement/purchase-orders/:id/receive
GET    /api/procurement/purchase-orders/:id/receipts

# Goods Receipt
GET    /api/procurement/goods-receipts
POST   /api/procurement/goods-receipts
GET    /api/procurement/goods-receipts/:id
PUT    /api/procurement/goods-receipts/:id
POST   /api/procurement/goods-receipts/:id/complete
POST   /api/procurement/goods-receipts/:id/items/:itemId/serials

# BOQ
GET    /api/procurement/boq
POST   /api/procurement/boq
GET    /api/procurement/boq/:id
PUT    /api/procurement/boq/:id
DELETE /api/procurement/boq/:id
POST   /api/procurement/boq/:id/submit
POST   /api/procurement/boq/:id/approve
POST   /api/procurement/boq/:id/clone
GET    /api/procurement/boq/:id/tracking
POST   /api/procurement/boq/:id/generate-requisitions
POST   /api/procurement/boq/import (Excel upload)
GET    /api/procurement/boq/:id/export

# BOQ Sections
GET    /api/procurement/boq/:id/sections
POST   /api/procurement/boq/:id/sections
PUT    /api/procurement/boq/:id/sections/:sectionId
DELETE /api/procurement/boq/:id/sections/:sectionId

# BOQ Items
GET    /api/procurement/boq/:id/items
POST   /api/procurement/boq/:id/items
PUT    /api/procurement/boq/:id/items/:itemId
DELETE /api/procurement/boq/:id/items/:itemId

# Stock
GET    /api/procurement/stock/items
POST   /api/procurement/stock/items
GET    /api/procurement/stock/items/:id
PUT    /api/procurement/stock/items/:id
GET    /api/procurement/stock/items/:id/serials
GET    /api/procurement/stock/items/:id/movements
GET    /api/procurement/stock/items/:id/balance

GET    /api/procurement/stock/locations
POST   /api/procurement/stock/locations
GET    /api/procurement/stock/locations/:id
PUT    /api/procurement/stock/locations/:id
GET    /api/procurement/stock/locations/:id/stock

GET    /api/procurement/stock/balance
GET    /api/procurement/stock/balance/by-location
GET    /api/procurement/stock/balance/by-item
GET    /api/procurement/stock/balance/valuation

POST   /api/procurement/stock/movements/transfer
POST   /api/procurement/stock/movements/adjustment
GET    /api/procurement/stock/movements/history

GET    /api/procurement/stock/reorder-alerts

# Suppliers
GET    /api/suppliers
POST   /api/suppliers
GET    /api/suppliers/:id
PUT    /api/suppliers/:id
DELETE /api/suppliers/:id
GET    /api/suppliers/:id/purchase-orders
GET    /api/suppliers/:id/performance
GET    /api/suppliers/:id/documents
POST   /api/suppliers/:id/documents
DELETE /api/suppliers/:id/documents/:docId
GET    /api/suppliers/:id/price-lists

# Reports
GET    /api/procurement/reports/spend-analysis
GET    /api/procurement/reports/supplier-performance
GET    /api/procurement/reports/stock-valuation
GET    /api/procurement/reports/boq-variance
GET    /api/procurement/reports/pending-approvals

# Dashboard
GET    /api/procurement/dashboard
GET    /api/procurement/dashboard/kpis
GET    /api/procurement/dashboard/alerts
GET    /api/procurement/dashboard/recent-activity
```

---

## Implementation Phases

### Phase 1: Foundation (Weeks 1-2)
**Goal:** Database schema and type definitions

| Task | Priority | Deliverable |
|------|----------|-------------|
| Create migration scripts | HIGH | All new tables created |
| Define TypeScript types | HIGH | Complete type definitions |
| Set up API route structure | HIGH | Empty route handlers |
| Update existing stock tables | MEDIUM | Add missing columns |

**Database Migrations:**
- `032_procurement_requisitions.sql`
- `033_rfq_documents.sql`
- `034_purchase_orders_enhanced.sql`
- `035_goods_receipts.sql`
- `036_boq_tables.sql`
- `037_approval_workflows.sql`
- `038_supplier_compliance.sql`

### Phase 2: Core Procurement (Weeks 3-5)
**Goal:** Basic procurement workflow working

| Task | Priority | Deliverable |
|------|----------|-------------|
| Purchase Requisition CRUD | HIGH | Create, edit, list PRs |
| PR approval workflow | HIGH | Submit and approve PRs |
| Purchase Order CRUD | HIGH | Create, edit, list POs |
| PO from PR conversion | HIGH | One-click conversion |
| PO sending workflow | MEDIUM | Email/portal delivery |

### Phase 3: RFQ & Quotes (Weeks 6-7)
**Goal:** Competitive quoting process

| Task | Priority | Deliverable |
|------|----------|-------------|
| RFQ creation | HIGH | Create RFQ from PR |
| Multi-supplier RFQ | HIGH | Send to multiple vendors |
| Supplier portal (basic) | HIGH | Vendors can respond |
| Quote comparison | HIGH | Side-by-side comparison |
| Quote to PO conversion | HIGH | Award and convert |

### Phase 4: Goods Receipt & Stock (Weeks 8-9)
**Goal:** Receiving and inventory updates

| Task | Priority | Deliverable |
|------|----------|-------------|
| GRN creation | HIGH | Receive against PO |
| Serial capture | HIGH | Scan serials on receipt |
| Stock updates | HIGH | Auto-update stock_quants |
| Partial receipts | MEDIUM | Multiple deliveries |
| Quality inspection | LOW | Pass/fail workflow |

### Phase 5: BOQ Integration (Weeks 10-11)
**Goal:** Project BOQ management

| Task | Priority | Deliverable |
|------|----------|-------------|
| BOQ CRUD | HIGH | Create, edit, list BOQs |
| Excel import | HIGH | Upload existing BOQs |
| BOQ approval | HIGH | Submit and approve |
| BOQ to PR conversion | HIGH | Generate requisitions |
| BOQ tracking | HIGH | Ordered/received/consumed |

### Phase 6: Supplier Management (Weeks 12-13)
**Goal:** Comprehensive supplier tracking

| Task | Priority | Deliverable |
|------|----------|-------------|
| Supplier profile | HIGH | Enhanced profiles |
| Compliance documents | HIGH | Upload and track expiry |
| Expiry notifications | HIGH | 30/14/7 day alerts |
| Performance tracking | MEDIUM | Auto-calculate scores |
| Price lists | MEDIUM | Supplier pricing |

### Phase 7: Field Stock Integration (Weeks 14-15)
**Goal:** Connect procurement to field operations

| Task | Priority | Deliverable |
|------|----------|-------------|
| Issue from stock | HIGH | Issue to technicians |
| Consumption tracking | HIGH | Link to drops |
| Returns workflow | HIGH | Process returns |
| Reconciliation | HIGH | Accountability reports |
| BOQ consumption | MEDIUM | Update BOQ quantities |

### Phase 8: Reporting & Analytics (Weeks 16-17)
**Goal:** Management visibility

| Task | Priority | Deliverable |
|------|----------|-------------|
| Procurement dashboard | HIGH | KPIs and charts |
| Spend analysis | HIGH | By supplier/category |
| Stock reports | HIGH | Valuation, movement |
| BOQ variance | HIGH | Planned vs actual |
| Export to Excel | MEDIUM | Downloadable reports |

### Phase 9: Polish & Optimization (Weeks 18-19)
**Goal:** Production readiness

| Task | Priority | Deliverable |
|------|----------|-------------|
| Performance optimization | HIGH | Query optimization |
| Mobile responsiveness | HIGH | Touch-friendly UI |
| Error handling | HIGH | User-friendly errors |
| Audit trail | MEDIUM | Full action logging |
| Documentation | MEDIUM | User guides |

---

## UI Component Structure

```
src/modules/procurement/
├── components/
│   ├── shared/
│   │   ├── StatusBadge.tsx
│   │   ├── ApprovalWorkflow.tsx
│   │   ├── ItemSelector.tsx
│   │   ├── SupplierSelector.tsx
│   │   └── CurrencyDisplay.tsx
│   ├── requisitions/
│   │   ├── RequisitionList.tsx
│   │   ├── RequisitionForm.tsx
│   │   ├── RequisitionDetail.tsx
│   │   └── RequisitionApproval.tsx
│   ├── rfq/
│   │   ├── RFQList.tsx
│   │   ├── RFQForm.tsx
│   │   ├── RFQDetail.tsx
│   │   ├── SupplierSelection.tsx
│   │   ├── QuoteComparison.tsx
│   │   └── QuoteAward.tsx
│   ├── purchase-orders/
│   │   ├── POList.tsx
│   │   ├── POForm.tsx
│   │   ├── PODetail.tsx
│   │   ├── POApproval.tsx
│   │   └── POPrint.tsx
│   ├── goods-receipt/
│   │   ├── GRNList.tsx
│   │   ├── GRNForm.tsx
│   │   ├── SerialCapture.tsx
│   │   └── InspectionForm.tsx
│   ├── boq/
│   │   ├── BOQList.tsx
│   │   ├── BOQForm.tsx
│   │   ├── BOQDetail.tsx
│   │   ├── BOQImport.tsx
│   │   ├── BOQTracking.tsx
│   │   └── SectionManager.tsx
│   ├── stock/
│   │   ├── StockDashboard.tsx
│   │   ├── ItemList.tsx
│   │   ├── ItemForm.tsx
│   │   ├── LocationTree.tsx
│   │   ├── StockBalance.tsx
│   │   ├── MovementHistory.tsx
│   │   └── ReorderAlerts.tsx
│   ├── suppliers/
│   │   ├── SupplierList.tsx
│   │   ├── SupplierForm.tsx
│   │   ├── SupplierDetail.tsx
│   │   ├── ComplianceDocuments.tsx
│   │   ├── PerformanceCard.tsx
│   │   └── PriceListManager.tsx
│   └── dashboard/
│       ├── ProcurementDashboard.tsx
│       ├── KPICards.tsx
│       ├── SpendChart.tsx
│       ├── PendingApprovals.tsx
│       └── AlertsFeed.tsx
├── hooks/
│   ├── useRequisitions.ts
│   ├── useRFQ.ts
│   ├── usePurchaseOrders.ts
│   ├── useGoodsReceipt.ts
│   ├── useBOQ.ts
│   ├── useStockItems.ts
│   ├── useStockBalance.ts
│   ├── useSuppliers.ts
│   └── useProcurementDashboard.ts
├── services/
│   ├── requisitionService.ts
│   ├── rfqService.ts
│   ├── purchaseOrderService.ts
│   ├── goodsReceiptService.ts
│   ├── boqService.ts
│   ├── stockService.ts
│   ├── supplierService.ts
│   └── reportService.ts
├── types/
│   ├── requisition.types.ts
│   ├── rfq.types.ts
│   ├── purchase-order.types.ts
│   ├── goods-receipt.types.ts
│   ├── boq.types.ts
│   ├── stock.types.ts
│   ├── supplier.types.ts
│   └── dashboard.types.ts
└── utils/
    ├── formatters.ts
    ├── validators.ts
    └── calculations.ts
```

---

## Success Criteria

### Phase Completion Criteria

| Phase | Success Criteria |
|-------|------------------|
| Foundation | All tables created, migrations run successfully |
| Core Procurement | Can create PR → PO → receive goods |
| RFQ & Quotes | Can send RFQ to 3 suppliers, receive quotes, award |
| Goods Receipt | Can receive goods, scan serials, update stock |
| BOQ Integration | Can import BOQ, generate requisitions, track consumption |
| Supplier Management | Compliance alerts working, performance auto-calculated |
| Field Stock | Full traceability from PO to drop installation |
| Reporting | All 5 core reports generating accurately |
| Polish | < 2s page load, mobile-friendly, no critical bugs |

### Business Metrics

| Metric | Baseline | Target | Timeline |
|--------|----------|--------|----------|
| PO cycle time | 3-5 days | < 4 hours | Phase 2 |
| Stock accuracy | Unknown | > 98% | Phase 7 |
| Supplier compliance visibility | Manual | Real-time | Phase 6 |
| BOQ variance tracking | None | Automated | Phase 5 |
| Field stock accountability | None | 100% tracked | Phase 7 |

---

## Dependencies

### Technical Dependencies
```json
{
  "react-signature-canvas": "^1.0.6",
  "quagga2": "^1.8.4",
  "@tanstack/react-table": "^8.x",
  "recharts": "^2.x",
  "xlsx": "^0.18.5",
  "jspdf": "^2.5.1",
  "react-dropzone": "^14.x"
}
```

### Integration Dependencies
- **Clerk Auth** - User authentication and roles
- **Neon PostgreSQL** - Database
- **Firebase Storage** - Document uploads
- **Email service** - Notifications (existing)

### Module Dependencies
- **Projects Module** - Project references for BOQ
- **Staff Module** - User references
- **Field Stock (PRD-027)** - Consumption tracking

---

## Risk Mitigation

| Risk | Impact | Mitigation |
|------|--------|------------|
| Data migration from spreadsheets | HIGH | Build robust import tools, validate thoroughly |
| User adoption resistance | MEDIUM | Phased rollout, training sessions |
| Complex approval workflows | MEDIUM | Start simple, add complexity iteratively |
| Mobile field usage | HIGH | Progressive web app, offline support |
| Integration with existing systems | MEDIUM | Clear API contracts, versioning |

---

## References

### Internal
- PRD-027: Field Stock Control
- PRD-024: 1Map GIS Integration
- Velocity Fibre SOP documents

### External
- [Odoo Procurement Documentation](https://www.odoo.com/documentation/18.0/applications/inventory_and_mrp/)
- [ERPNext Procurement](https://frappe.io/erpnext/erp-guide/procurement-system)
- [InvenTree Documentation](https://docs.inventree.org/en/stable/)

---

## Appendix A: Open Source Feature Comparison

| Feature | Odoo | ERPNext | InvenTree | FibreFlow (Target) |
|---------|------|---------|-----------|-------------------|
| Purchase Requisitions | ✅ | ✅ | ❌ | ✅ |
| RFQ Multi-vendor | ✅ | ✅ | ✅ | ✅ |
| Supplier Portal | ✅ | ❌ | ❌ | ✅ |
| 3-Way Matching | ✅ | ✅ | ❌ | ✅ |
| BOQ/BOM | ✅ | ✅ | ✅ | ✅ |
| Multi-warehouse | ✅ | ✅ | ✅ | ✅ |
| Serial Tracking | ✅ | ✅ | ✅ | ✅ |
| Lot Tracking | ✅ | ✅ | ✅ | ✅ |
| Reorder Rules | ✅ | ✅ | ❌ | ✅ |
| Field Stock | ❌ | ❌ | ❌ | ✅ (unique) |
| Project BOQ | ✅ | ✅ | ❌ | ✅ |
| Approval Workflows | ✅ | ✅ | ❌ | ✅ |

---

## Appendix B: Migration Scripts Index

| Migration | Tables | Status |
|-----------|--------|--------|
| 027_field_stock_core.sql | stock_locations, stock_items, stock_serials, stock_quants | ✅ Created |
| 028_field_stock_transactions.sql | stock_pickings, stock_picking_lines | ✅ Created |
| 029_field_stock_returns.sql | stock_returns, stock_return_lines | ✅ Created |
| 030_drops_stock_columns.sql | drops (ALTER) | ✅ Created |
| 031_field_stock_fixes.sql | Various fixes | ✅ Created |
| 032_procurement_requisitions.sql | purchase_requisitions, purchase_requisition_items | 📋 Planned |
| 033_rfq_documents.sql | rfq_documents, rfq_items, rfq_suppliers, rfq_responses | 📋 Planned |
| 034_purchase_orders_enhanced.sql | purchase_orders (enhance), purchase_order_items | 📋 Planned |
| 035_goods_receipts.sql | goods_receipt_notes, goods_receipt_items | 📋 Planned |
| 036_boq_tables.sql | boq_headers, boq_sections, boq_items | 📋 Planned |
| 037_approval_workflows.sql | approval_workflows, approval_levels, approval_requests | 📋 Planned |
| 038_supplier_compliance.sql | supplier_compliance_documents, supplier_performance_records | 📋 Planned |

---

**Document Version:** 1.0
**Created:** January 15, 2026
**Author:** FibreFlow Development Team
**Status:** Draft - Pending Review
