# FibreFlow Database Tables Reference

**⚠️ CRITICAL: DO NOT CONFUSE THESE TABLES!**

## Two Separate Drop Tables

FibreFlow uses **TWO COMPLETELY SEPARATE** drop tables with different purposes, schemas, and data sources.

---

## 1. `drops` Table - SOW Import Data

### Purpose
Stores drops imported from Statement of Work (SOW) Excel/CSV files for project planning and fiber installation tracking.

### Data Source
- Excel/CSV files imported via scripts
- Manual SOW import process
- NOT from WhatsApp

### Used By
- SOW import scripts (`/scripts/sow-import/`)
- Fiber Stringing page (`/fiber-stringing`)
- SOW List page (`/sow/list`)
- SOW Dashboard (`/sow`)

### API Endpoints
- `/api/sow/drops?projectId={id}`
- `/api/sow/fibre?projectId={id}`

### Example Drops
- DR1734268 (imported from Excel)
- DR1734935 (imported from Excel)

### Schema
```sql
CREATE TABLE drops (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    drop_number VARCHAR(255),           -- Drop number (DR########)
    pole_number VARCHAR(255),           -- Associated pole number
    project_id UUID NOT NULL,           -- Foreign key to projects table
    address TEXT,                       -- Installation address
    customer_name VARCHAR(255),         -- Customer name
    cable_length VARCHAR(50),           -- Cable length measurement
    installation_date DATE,             -- Planned/actual installation date
    status VARCHAR(50) DEFAULT 'Active',
    notes TEXT,
    metadata JSONB,                     -- Additional data from import
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    qc_status VARCHAR(50),              -- QC status (if applicable)
    qc_updated_at TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
```

### Query Examples
```sql
-- Get drops for a project
SELECT * FROM drops WHERE project_id = '4eb13426-b2a1-472d-9b3c-277082ae9b55';

-- Count drops per project
SELECT project_id, COUNT(*) FROM drops GROUP BY project_id;

-- Get drops by date
SELECT * FROM drops WHERE installation_date = '2025-11-17';
```

---

## 2. `qa_photo_reviews` Table - WA Monitor WhatsApp Data

### Purpose
Stores drops from WhatsApp QA photo review process - real-time quality assurance tracking of field installations.

### Data Source
- WhatsApp groups (Lawley, Velo Test, Mohadin)
- `realtime_drop_monitor.py` script
- WhatsApp messages with DR numbers

### Used By
- WA Monitor Dashboard (`/wa-monitor`)
- WhatsApp feedback system
- Daily drops tracking
- QA review process

### API Endpoints
- `/api/wa-monitor-drops`
- `/api/wa-monitor-daily-drops`
- `/api/wa-monitor-send-feedback`

### Example Drops
- DR1752169 (from WhatsApp message)
- DR1752182 (from WhatsApp message)
- DR1733545 (from WhatsApp message)

### Schema
```sql
CREATE TABLE qa_photo_reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    drop_number VARCHAR(50) NOT NULL,
    review_date TIMESTAMP WITH TIME ZONE,
    user_name VARCHAR(100),                     -- Technician/agent name
    completed_photos INTEGER DEFAULT 0,         -- Number of photos completed
    outstanding_photos INTEGER DEFAULT 12,      -- Photos still needed
    outstanding_photos_loaded_to_1map BOOLEAN DEFAULT false,
    comment TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    project VARCHAR(100),                       -- Project name (Lawley, Velo Test, etc.)
    assigned_agent VARCHAR(50),                 -- Agent phone number
    completed BOOLEAN DEFAULT false,
    incomplete BOOLEAN DEFAULT true,
    feedback_sent TIMESTAMP WITH TIME ZONE,
    sender_phone VARCHAR(50),

    -- 12 QA Photo Steps (Installation Checklist)
    step_01_house_photo BOOLEAN DEFAULT false,
    step_02_cable_from_pole BOOLEAN DEFAULT false,
    step_03_cable_entry_outside BOOLEAN DEFAULT false,
    step_04_cable_entry_inside BOOLEAN DEFAULT false,
    step_05_wall_for_installation BOOLEAN DEFAULT false,
    step_06_ont_back_after_install BOOLEAN DEFAULT false,
    step_07_power_meter_reading BOOLEAN DEFAULT false,
    step_08_ont_barcode BOOLEAN DEFAULT false,
    step_09_ups_serial BOOLEAN DEFAULT false,
    step_10_final_installation BOOLEAN DEFAULT false,
    step_11_green_lights BOOLEAN DEFAULT false,
    step_12_customer_signature BOOLEAN DEFAULT false,

    -- Incorrect Photo Tracking (Nov 2025)
    incorrect_steps TEXT[] DEFAULT '{}',
    incorrect_comments JSONB DEFAULT '{}',

    -- Locking System
    locked_by TEXT,
    locked_at TIMESTAMP WITH TIME ZONE,
    resubmitted BOOLEAN DEFAULT false,

    -- Serial Scanning Integration (Jan 2026)
    -- Scanned serial numbers linked to stock_serials table
    ont_serial_scanned VARCHAR(100),            -- ONT serial from barcode scan
    ups_serial_scanned VARCHAR(100),            -- UPS serial from barcode scan
    router_serial_scanned VARCHAR(100),         -- Router serial (future use)

    -- Stock consumption links (foreign keys to stock_consumptions)
    ont_consumption_id UUID,                    -- Links to stock_consumptions.id
    ups_consumption_id UUID,                    -- Links to stock_consumptions.id
    router_consumption_id UUID,                 -- Links to stock_consumptions.id

    -- Scan metadata for verification
    scan_gps_lat DECIMAL(10, 7),               -- GPS latitude at scan time
    scan_gps_lng DECIMAL(10, 7),               -- GPS longitude at scan time
    scan_timestamp TIMESTAMP WITH TIME ZONE,   -- When serial was scanned

    -- Verification flags
    serials_verified BOOLEAN DEFAULT false,    -- True if serials matched stock records
    verification_notes TEXT                    -- Notes from verification process
);

-- Indexes for serial scanning
CREATE INDEX idx_qa_ont_serial ON qa_photo_reviews(ont_serial_scanned);
CREATE INDEX idx_qa_ups_serial ON qa_photo_reviews(ups_serial_scanned);
CREATE INDEX idx_qa_consumption_ont ON qa_photo_reviews(ont_consumption_id);
CREATE INDEX idx_qa_consumption_ups ON qa_photo_reviews(ups_consumption_id);
CREATE INDEX idx_qa_photo_reviews_incorrect_steps ON qa_photo_reviews USING GIN (incorrect_steps);
```

### Query Examples
```sql
-- Get all Lawley drops
SELECT * FROM qa_photo_reviews WHERE project = 'Lawley';

-- Count drops by project
SELECT project, COUNT(*) FROM qa_photo_reviews GROUP BY project;

-- Get drops from today
SELECT * FROM qa_photo_reviews WHERE DATE(created_at) = CURRENT_DATE;

-- Get drops from specific date
SELECT * FROM qa_photo_reviews WHERE DATE(created_at) = '2025-11-25';

-- Get incomplete drops
SELECT * FROM qa_photo_reviews WHERE incomplete = true;
```

---

## Key Differences

| Feature | `drops` Table | `qa_photo_reviews` Table |
|---------|---------------|--------------------------|
| **Purpose** | SOW planning data | WhatsApp QA tracking |
| **Source** | Excel/CSV imports | WhatsApp messages |
| **Project Key** | `project_id` (UUID) | `project` (VARCHAR name) |
| **Date Field** | `installation_date` (DATE) | `created_at` (TIMESTAMP) |
| **Status** | `status` (VARCHAR) | `completed`/`incomplete` (BOOLEAN) |
| **QA Steps** | ❌ No | ✅ Yes (12 steps) |
| **Photos** | ❌ No | ✅ Yes |
| **Feedback** | ❌ No | ✅ Yes |
| **APIs** | `/api/sow/*` | `/api/wa-monitor-*` |
| **Pages** | `/sow`, `/fiber-stringing` | `/wa-monitor` |

---

## Common Mistakes

### ❌ WRONG: Querying drops table for WA Monitor data
```sql
-- This will NOT work for WhatsApp drops!
SELECT * FROM drops WHERE project_id = '4eb13426-b2a1-472d-9b3c-277082ae9b55';
```

### ✅ CORRECT: Querying qa_photo_reviews for WA Monitor data
```sql
-- This is correct for WhatsApp drops
SELECT * FROM qa_photo_reviews WHERE project = 'Lawley';
```

---

## When to Use Which Table

### Use `drops` table when:
- Importing SOW data from Excel/CSV
- Viewing fiber stringing progress
- Planning installations
- Tracking pole-to-drop relationships
- Generating SOW reports

### Use `qa_photo_reviews` table when:
- Checking WhatsApp QA submissions
- Viewing WA Monitor dashboard
- Sending feedback to technicians
- Tracking QA photo completion
- Monitoring daily drop submissions
- Analyzing QA review progress

---

## Related Documentation

- **WA Monitor Module:** `src/modules/wa-monitor/README.md`
- **SOW Import Guide:** `SOW/docs/importlog.md`
- **CLAUDE.md:** Main project documentation
- **Database Scripts:** `scripts/sow-import/` (for drops table)
- **WA Monitor Scripts:** External `realtime_drop_monitor.py`

---

## Quick Reference Commands

### Check drops table
```bash
node -e "
const { neon } = require('@neondatabase/serverless');
require('dotenv').config({ path: '.env.local' });
const sql = neon(process.env.NEON_DATABASE_URL);
(async () => {
  const result = await sql\`SELECT COUNT(*) as count FROM drops WHERE project_id = '4eb13426-b2a1-472d-9b3c-277082ae9b55'\`;
  console.log('SOW drops:', result[0].count);
})();
"
```

### Check qa_photo_reviews table
```bash
node -e "
const { neon } = require('@neondatabase/serverless');
require('dotenv').config({ path: '.env.local' });
const sql = neon(process.env.NEON_DATABASE_URL);
(async () => {
  const result = await sql\`SELECT COUNT(*) as count FROM qa_photo_reviews WHERE project = 'Lawley'\`;
  console.log('WA Monitor drops:', result[0].count);
})();
"
```

---

## 3. Field Stock Tables - Equipment Tracking (Jan 2026)

### Overview
The Field Stock system tracks equipment from warehouse receipt through field installation. These tables support the 4-stage stock tracking workflow.

### `stock_serials` Table
Tracks individual serialized equipment units.

```sql
CREATE TABLE stock_serials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    serial_number VARCHAR(100) UNIQUE NOT NULL,
    stock_item_id UUID NOT NULL,              -- Foreign key to stock_items
    status VARCHAR(50) DEFAULT 'available',   -- available, issued, installed, returned, lost
    current_location_id UUID,                 -- Foreign key to stock_locations

    -- Installation tracking
    installed_at_drop_number VARCHAR(50),     -- DR number where installed
    installed_date TIMESTAMP WITH TIME ZONE,
    installed_by VARCHAR(100),

    -- Issue tracking
    issued_to_technician_id VARCHAR(100),
    issued_date TIMESTAMP WITH TIME ZONE,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
```

### `stock_consumptions` Table
Records when equipment is consumed/installed at a job site.

```sql
CREATE TABLE stock_consumptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_type VARCHAR(50),                     -- 'drop', 'repair', etc.
    drop_number VARCHAR(50),                  -- DR number
    stock_item_id UUID NOT NULL,
    serial_id UUID,                           -- Foreign key to stock_serials
    serial_number VARCHAR(100),
    quantity INTEGER DEFAULT 1,

    -- Who consumed it
    consumed_by_id VARCHAR(100),
    consumed_by_name VARCHAR(100),

    -- When and where
    consumption_date TIMESTAMP WITH TIME ZONE,
    gps_lat DECIMAL(10, 7),
    gps_lng DECIMAL(10, 7),

    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
```

### `stock_pickings` Table
Tracks stock movements (receipts, issues, returns).

```sql
CREATE TABLE stock_pickings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    picking_type VARCHAR(50) NOT NULL,        -- 'receipt', 'issue', 'return'
    reference VARCHAR(100),                   -- GRN-202601-001, ISS-202601-001

    -- For issues/returns
    technician_id VARCHAR(100),
    technician_name VARCHAR(100),

    -- Approval
    status VARCHAR(50) DEFAULT 'draft',       -- draft, done, cancelled
    signature_data TEXT,                      -- Base64 signature image

    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP WITH TIME ZONE
);
```

### `contractor_stock_accountability` Table
Tracks contractor accountability for issued equipment.

```sql
CREATE TABLE contractor_stock_accountability (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contractor_id VARCHAR(100) NOT NULL,
    contractor_name VARCHAR(100),

    -- Accountability counts
    total_issued INTEGER DEFAULT 0,
    total_installed INTEGER DEFAULT 0,
    total_returned INTEGER DEFAULT 0,
    unaccounted_count INTEGER DEFAULT 0,
    unaccounted_value DECIMAL(10, 2) DEFAULT 0,

    -- Blocking
    is_blocked BOOLEAN DEFAULT false,
    blocked_reason TEXT,
    blocked_at TIMESTAMP WITH TIME ZONE,
    blocked_by VARCHAR(100),

    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
```

### Reconciliation View
Used by the Daily Reconciliation Dashboard.

```sql
CREATE OR REPLACE VIEW v_installation_stock_reconciliation AS
SELECT
    qa.id,
    qa.drop_number,
    qa.project,
    qa.user_name AS technician,
    qa.ont_serial_scanned,
    qa.ups_serial_scanned,
    sc_ont.serial_number AS stock_ont_serial,
    sc_ups.serial_number AS stock_ups_serial,
    ss_ont.status AS ont_stock_status,
    ss_ups.status AS ups_stock_status,
    CASE WHEN qa.ont_serial_scanned = sc_ont.serial_number THEN true ELSE false END AS ont_matches,
    CASE WHEN qa.ups_serial_scanned = sc_ups.serial_number THEN true ELSE false END AS ups_matches
FROM qa_photo_reviews qa
LEFT JOIN stock_consumptions sc_ont ON sc_ont.id = qa.ont_consumption_id
LEFT JOIN stock_serials ss_ont ON ss_ont.id = sc_ont.serial_id
LEFT JOIN stock_consumptions sc_ups ON sc_ups.id = qa.ups_consumption_id
LEFT JOIN stock_serials ss_ups ON ss_ups.id = sc_ups.serial_id
WHERE qa.drop_number IS NOT NULL;
```

### Query Examples
```sql
-- Get all serials issued to a technician
SELECT * FROM stock_serials WHERE issued_to_technician_id = 'tech-001' AND status = 'issued';

-- Get unaccounted items for a date
SELECT
    ss.serial_number,
    ss.issued_to_technician_id,
    ss.issued_date
FROM stock_serials ss
WHERE ss.status = 'issued'
AND DATE(ss.issued_date) = CURRENT_DATE
AND ss.installed_at_drop_number IS NULL;

-- Get daily reconciliation summary
SELECT
    user_name AS technician,
    COUNT(*) FILTER (WHERE ont_serial_scanned IS NOT NULL) AS installed_count,
    COUNT(*) AS total_drops
FROM qa_photo_reviews
WHERE DATE(created_at) = CURRENT_DATE
GROUP BY user_name;
```

---

**Last Updated:** January 13, 2026
**Author:** Louis (after Claude's confusion incident), updated for Stock Tracking System
**Reason:** To prevent future table confusion errors and document stock tracking tables
