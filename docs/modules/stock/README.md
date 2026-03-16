# Stock Module

**Serial Number Tracking & Equipment Checkout/Check-In Management**

The Stock module provides comprehensive serial number tracking and checkout/check-in workflows for tracked inventory items including Tools, Assets, and PPE. Managers can check out individual units by serial number to projects with scheduled return dates, and the system automatically tracks overdue returns with visual alerts. The module maintains a complete audit trail of each serial's lifecycle: availability status, condition history, and usage patterns across projects.

---

## 🎯 Purpose

The Stock module solves three operational challenges in field asset management:

1. **Equipment Accountability** — Tools and assets disappear from warehouse without tracking. The module enforces serial number tracking, linking each physical unit to a specific project and checkout user. Returns are conditional-based, capturing damage or wear on equipment.

2. **Overdue Returns** — Field teams forget to return equipment on time, causing budget overruns and equipment shortages. The module flags overdue items automatically and surfaces alerts to managers without manual intervention.

3. **Asset Lifecycle Visibility** — No clarity on equipment condition over time or usage patterns. The module tracks condition at return (excellent, good, fair, poor, damaged) and maintains complete audit trails per serial. Managers can identify problem equipment or high-usage trends.

---

## 📊 Key Features

### Serial Number Tracking
- Unique identifier per physical unit (Tools, Assets, PPE categories)
- Status tracking: Available, Checked Out, Maintenance, Retired
- Condition recording: Excellent, Good, Fair, Poor, Damaged
- Location tracking per serial
- CSV bulk import for batch serial creation
- Visual availability summary: "15 of 20 available"

### Checkout Workflow
- Check out serials to specific projects with expected return dates
- Future-date validation (cannot checkout with past return date)
- Checkout slip generation for field teams
- Project assignment for cost tracking and accountability
- Audit trail: who checked out, when, which project
- User-level permissions: managers see all, regular users see their own checkouts

### Check-In Workflow
- Condition-based return inspection (5-level quality scale)
- Return notes required for poor or damaged condition
- Automatic status updates: Available (if good), Maintenance (if damaged)
- Overdue detection: flags items checked in late
- Maintenance ticket auto-creation for damaged equipment
- Audit trail: who checked in, when, condition reported

### Overdue Alerts
- Real-time calculation of days overdue
- Dedicated endpoint for overdue-only queries
- Filtered views by project, user, or item
- Status tracking: active vs. returned vs. overdue vs. lost
- Dashboard alerts for warehouse staff

### Audit Trail per Serial
- Complete checkout/check-in history for each serial
- Days held calculation per checkout period
- User responsibility tracking (who checked out/in)
- Condition progression over time
- Timeline view of equipment lifecycle

---

## 🏗️ Architecture

### Data Model

**`stock_item_serials` Table**
- `id` (UUID): Primary key
- `stock_item_id` (UUID): Reference to stock item
- `serial_number` (VARCHAR): Unique per item
- `status` (VARCHAR): available | checked_out | maintenance | retired
- `condition` (VARCHAR): excellent | good | fair | poor | damaged
- `location` (VARCHAR): Physical storage location
- `notes` (TEXT): Additional context
- `created_at`, `updated_at`: Timestamps
- **Index**: `idx_serials_item` (fast lookup by item), `idx_serials_status` (availability filtering)

**`tool_checkouts` Table**
- `id` (UUID): Primary key
- `serial_id` (UUID): Reference to serial number
- `stock_item_id` (UUID): Reference to stock item
- `project_id` (UUID, nullable): Project being charged
- `checked_out_by` (UUID): User who performed checkout
- `checked_out_at` (TIMESTAMPTZ): Checkout timestamp
- `expected_return_date` (DATE): Scheduled return
- `checked_in_at` (TIMESTAMPTZ, nullable): Actual return timestamp
- `checked_in_by` (UUID, nullable): User who checked in
- `return_condition` (VARCHAR): excellent | good | fair | poor | damaged
- `return_notes` (TEXT): Damage description or notes
- `status` (VARCHAR): active | returned | overdue | lost
- **Indexes**: `idx_checkouts_serial`, `idx_checkouts_status`, `idx_checkouts_project`, `idx_checkouts_overdue` (partial)

### Service Layer

**Serial Management Service**
- CRUD operations for serial records
- Status transitions (available → checked_out → available/maintenance)
- Condition tracking and history
- CSV import validation

**Checkout Service**
- Checkout creation with validation
- Project assignment and cost allocation
- Return date validation
- Checkout slip generation

**Check-In Service**
- Condition-based return processing
- Status updates based on condition (Available vs. Maintenance)
- Overdue detection and flagging
- Maintenance ticket generation for damaged items

**Overdue Management Service**
- Overdue calculation (CURRENT_DATE - expected_return_date)
- Alert generation for warehouse dashboards
- Filtering and reporting by project/user

---

## 🔧 Main Files

| File | Purpose |
|------|---------|
| `pages/api/stock/serials/index.ts` | Serial CRUD endpoints (list, create, update, delete) |
| `pages/api/stock/checkout.ts` | POST endpoint: check out a serial to project |
| `pages/api/stock/checkin.ts` | POST endpoint: check in and record condition |
| `pages/api/stock/checkouts/index.ts` | GET endpoint: list checkouts with filtering |
| `pages/api/stock/checkouts/overdue.ts` | GET endpoint: overdue items only |
| `pages/api/stock/serial-history.ts` | GET endpoint: complete audit trail per serial |
| `src/modules/stock-items/components/SerialsPanel.tsx` | UI tab for serial management in stock items modal |
| `src/modules/stock-items/components/CheckoutModal.tsx` | UI dialog for checking out a serial |
| `src/modules/stock-items/components/CheckinModal.tsx` | UI dialog for checking in a serial |

---

## 📡 API Endpoints

### Serial Management

**GET** `/api/stock/serials?stock_item_id=<uuid>[&status=<status>]`
- List all serials for a stock item
- Optional status filter: available, checked_out, maintenance, retired
- Returns: `{ serials: [...], total: number }`

**POST** `/api/stock/serials`
- Create new serial record
- Body: `{ stock_item_id, serial_number, condition?, location?, notes? }`
- Validates unique serial per item
- Returns: `{ serial: {...} }`

**PATCH** `/api/stock/serials/:id`
- Update serial status, condition, location, or notes
- Body: `{ status?, condition?, location?, notes? }`
- Returns: `{ serial: {...} }`

**DELETE** `/api/stock/serials/:id`
- Soft delete (sets status to 'retired')
- Prevents deletion if currently checked out

### Checkout Workflow

**POST** `/api/stock/checkout`
- Check out a serial to a project
- Body:
  ```json
  {
    "serial_id": "uuid",
    "project_id": "uuid (optional)",
    "checked_out_by": "uuid",
    "expected_return_date": "YYYY-MM-DD",
    "notes": "optional context"
  }
  ```
- Validation: Serial must be available, project exists, future return date
- Side effects: Updates serial status to checked_out, creates checkout record, logs event
- Returns: `{ checkout: {...}, serial: {...} }`

**POST** `/api/stock/checkin`
- Check in a previously checked out serial
- Body:
  ```json
  {
    "checkout_id": "uuid",
    "checked_in_by": "uuid",
    "return_condition": "excellent|good|fair|poor|damaged",
    "return_notes": "optional context"
  }
  ```
- Updates serial status based on condition (Available if good, Maintenance if damaged)
- Flags checkout as overdue if return date passed
- If damaged: can trigger maintenance ticket creation
- Returns: `{ checkout: {...}, serial: {...} }`

### Checkout Query

**GET** `/api/stock/checkouts[?status=<status>&project_id=<uuid>&overdue_only=true]`
- List checkouts with filters
- Query params:
  - `status`: active, returned, overdue, all (default: active)
  - `project_id`: Filter by project
  - `user_id`: Filter by who checked out
  - `stock_item_id`: Filter by item
  - `overdue_only`: Boolean, only overdue items
  - `limit`: Max results (default: 100)
  - `offset`: Pagination
- Returns:
  ```json
  {
    "checkouts": [{
      "id": "uuid",
      "serial": { "serial_number": "...", "stock_item": {...} },
      "project": { "name": "...", "code": "..." },
      "checked_out_by": { "name": "...", "email": "..." },
      "checked_out_at": "ISO timestamp",
      "expected_return_date": "ISO date",
      "days_overdue": 3,
      "status": "active|returned|overdue|lost"
    }],
    "total": 42,
    "overdue_count": 5
  }
  ```

**GET** `/api/stock/checkouts/overdue`
- Dedicated endpoint for overdue items
- Returns same structure as above, filtered to status='active' and expected_return_date < TODAY
- Sorted by days overdue (most overdue first)

### Serial History

**GET** `/api/stock/serial-history/:serial_id`
- Complete audit trail for a serial
- Returns:
  ```json
  {
    "serial": {
      "serial_number": "...",
      "stock_item": {...},
      "current_status": "available",
      "condition": "good"
    },
    "history": [{
      "checkout_id": "uuid",
      "checked_out_by": { "name": "...", "email": "..." },
      "checked_out_at": "ISO timestamp",
      "expected_return_date": "ISO date",
      "checked_in_at": "ISO timestamp (nullable)",
      "checked_in_by": { "name": "...", "email": "..." },
      "return_condition": "excellent|good|fair|poor|damaged",
      "days_held": 14,
      "status": "active|returned|overdue|lost"
    }]
  }
  ```

---

## 🔌 Integration Points

### Stock Items Module
- Serials tab integrated in StockItemModal (appears for Tools, Assets, PPE)
- Checkout/Check-in modals accessible from serials table
- Stock item master data linked via `stock_item_id` foreign key

### Projects Module
- Project assignment during checkout (optional, for cost tracking)
- Project-level overdue reporting (which projects have unreturned equipment)

### Maintenance Module
- Damaged equipment checkout returns can trigger maintenance ticket creation
- Maintenance tickets linked back to serial for tracking

### User Management
- User accountability tracking (who checked out, who checked in)
- Permission-based filtering (managers see all, users see own checkouts)
- Audit trail includes user context for all operations

---

## 📋 Database Tables

| Table | Purpose | Key Fields |
|-------|---------|-----------|
| `stock_item_serials` | Serial numbers and current status | id, stock_item_id, serial_number, status, condition, location |
| `tool_checkouts` | Checkout/check-in records | id, serial_id, stock_item_id, project_id, checked_out_by, expected_return_date, status |

---

## 🛠️ Configuration

### Stock Item Categories (eligible for serial tracking)
Serial management only applies to:
- **Tools** — Hand tools, power tools, diagnostic equipment
- **Assets** — High-value equipment, test equipment, company vehicles
- **PPE** — Personal protective equipment with serial tracking

Excluded categories:
- Consumables (bulk items without individual tracking)
- Raw Materials
- Finished Goods

### Status Enums

**Serial Status:**
- `available` — Ready for checkout
- `checked_out` — Currently in field
- `maintenance` — Returned damaged, awaiting repair
- `retired` — End of life, no longer in service

**Condition Enums:**
- `excellent` — Like new, no visible wear
- `good` — Normal use wear, fully functional
- `fair` — Noticeable wear, functional
- `poor` — Significant wear, functional but suboptimal
- `damaged` — Non-functional or unsafe, requires repair

**Checkout Status:**
- `active` — Currently checked out
- `returned` — Successfully returned on-time
- `overdue` — Returned late
- `lost` — Not returned, assumed lost

---

## 📖 Related Documentation

- **[CHANGELOG.md](./CHANGELOG.md)** — Feature history and commit details
- **[Stock Items Module](../stock-items/README.md)** — Inventory master data management
- **[Field Stock Module](../procurement/field-stock/README.md)** — Field-level stock allocation
- **[Projects Module](../projects/README.md)** — Project cost tracking

---

## 🚀 Common Workflows

### Check Out Equipment to Project

1. Navigate to **Stock Items** → select item
2. Click **Units / Checkout** tab
3. Click **+ Check Out** button
4. Select serial from available list
5. Select project (optional)
6. Set expected return date (future date)
7. Add optional notes (e.g., "Project Site: Zone 5")
8. Submit → receives checkout ID
9. Print checkout slip for field team
10. Checkout created, serial status → "Checked Out"

### Check In Equipment with Condition Report

1. Navigate to **Stock Items** → select item
2. Click **Units / Checkout** tab
3. Find active checkout in table
4. Click **Check In** button
5. Select return condition:
   - Excellent: Return to available
   - Good: Return to available
   - Fair: Return to available (note degradation trend)
   - Poor: Return to available (flag for inspection)
   - Damaged: Move to maintenance (creates maintenance ticket)
6. Add required notes if poor/damaged
7. Submit → checkout completed, serial updated

### View Equipment History

1. Navigate to **Stock Items** → select item
2. Click **Units / Checkout** tab
3. Right-click serial or click **View History**
4. See complete lifecycle: all checkouts, returns, condition progression
5. Identify usage patterns, high-use equipment, condition trends

### Report Overdue Equipment

1. Navigate to **Warehouse Dashboard** or **Stock Module**
2. View **Overdue Items** widget
3. Sorted by days overdue (most urgent first)
4. Click item → shows project, who checked out, contact info
5. Follow up with project manager or field team
6. Once returned, checkout auto-updates to "Overdue" status

### Bulk Import Serials

1. Prepare CSV file: `serial_number,condition,location`
   ```
   TOOL-001,excellent,Rack A1
   TOOL-002,good,Rack A2
   TOOL-003,fair,Rack A3
   ```
2. Navigate to **Stock Items** → select item
3. Click **Units / Checkout** tab
4. Click **Bulk Import** button
5. Upload CSV file
6. System validates for duplicates
7. Confirm import → all serials created

---

**Owner**: velo  
**Last Updated**: 2026-03-15  
**Module Version**: 1.0.0 (Serial Tracking & Checkout System)
