# ARCH Data Analysis Report
**Date:** January 19, 2026
**Analyst:** AI Assistant
**Project:** Lawley Fiber Network

---

## Executive Summary

Three Excel files were analyzed containing network audit, performance, and usage data for the Lawley fiber network. This document outlines the data structure, relationships, and recommendations for database import and reporting.

### Key Findings
- **3,880 active ONTs** in OES system
- **24,025 planned drops** in planning database
- **3,829 offline devices** requiring attention
- **160 Points of Interest** (shops, spazas) for distribution
- **30 days of daily revenue tracking** with PON-level granularity

---

## File Inventory

| File | Size | Purpose | Sheets |
|------|------|---------|--------|
| `law_daily_network_audit_detail_report_19Jan2026.xlsx` | 2.2MB | Raw network data | 5 sheets |
| `law_daily_network_summary_report_19Jan2026.xlsx` | 913KB | Aggregated reports | 7 sheets |
| `lawley_Performance_30Days_to_18012026.xlsx` | 24KB | Performance tracking | 3 sheets |

---

## Sheet-by-Sheet Analysis

### File 1: Daily Network Audit Detail Report

#### 1.1 OES Data (3,880 records)
**Purpose:** Active ONT installations with signal levels and GPS

| Column | Type | Description | Import Priority |
|--------|------|-------------|-----------------|
| `stack_ref_filter` | string | Area code (law) | HIGH |
| `drop_number` | string | DR number (PK) | HIGH |
| `serialnumber` | string | ONT serial (ALCL*) | HIGH |
| `activation_date` | date | Excel serial date | HIGH |
| `olt_address` | string | law.olt.01:x-x-x-x | HIGH |
| `ontrxsiglvl` | decimal | ONT RX signal (-15 to -25 dBm) | HIGH |
| `linkbudgetontrx` | decimal | Link budget ONT RX | MEDIUM |
| `oltrxsiglvl` | decimal | OLT RX signal | HIGH |
| `linkbudgetoltrx` | decimal | Link budget OLT RX | MEDIUM |
| `current_ont_rx` | decimal | Current ONT RX reading | HIGH |
| `ontstatus` | string | ONT status | HIGH |
| `geo_latitude` | decimal | GPS latitude | HIGH |
| `geo_longitude` | decimal | GPS longitude | HIGH |
| `data_snapshot_timestamp` | date | Snapshot time | MEDIUM |

**Signal Level Analysis:**
- ONT RX Range: -15.968 to -24.948 dBm
- Acceptable range: -18 to -24 dBm (per QA standards)

**OLT Address Parsing:**
```
Format: law.olt.01:RACK-SHELF-SLOT-PORT
Example: law.olt.01:1-1-4-1 → Rack 1, Shelf 1, Slot 4, Port 1
```

#### 1.2 OLT Data (3,877 records)
**Purpose:** ACS/CWMP device registration

| Column | Type | Description | Import Priority |
|--------|------|-------------|-----------------|
| `stack_ref_filter` | string | Area code | LOW |
| `ssid` | string | WiFi SSID (@fibertime) | MEDIUM |
| `serial_number` | string | ONT serial | HIGH |
| `last_inform` | date | Last ACS check-in | HIGH |
| `registered` | date | Registration date | MEDIUM |
| `data_snapshot_timestamp` | date | Snapshot time | LOW |

#### 1.3 Offline Data (3,829 records)
**Purpose:** Currently offline devices with reasons

| Column | Type | Description | Import Priority |
|--------|------|-------------|-----------------|
| `stack_ref_filter` | string | Area code | HIGH |
| `serial_number` | string | ONT serial | HIGH |
| `area_abbreviation` | string | LAW | LOW |
| `ont_address` | string | OLT slot address | HIGH |
| `drop_number` | string | DR number | HIGH |
| `last_down_reason` | string | Reason for offline | HIGH |
| `last_inform_sast` | date | Last seen date | HIGH |
| `days_since_last_inform` | int | Days offline | HIGH |
| `offline_days_bucket` | string | Bucket category | HIGH |
| `snapshot_timestamp` | date | Snapshot time | MEDIUM |

**Offline Reason Distribution:**
| Reason | Count | % |
|--------|-------|---|
| Dying Gasp | 3,604 | 94.1% |
| Device Not Active | 207 | 5.4% |
| Received Optical Signal Level Too Low | 5 | 0.1% |
| Software Version Mismatch | 8 | 0.2% |
| Other | 5 | 0.1% |

**Offline Duration Buckets:**
| Bucket | Count |
|--------|-------|
| Less than 20 days | 3,790 |
| 20-40 days | 22 |
| 40-60 days | 12 |
| 60-80 days | 3 |
| More than 100 days | 2 |

#### 1.4 Planning Data (24,025 records)
**Purpose:** Full network planning with all drops

| Column | Type | Description | Import Priority |
|--------|------|-------------|-----------------|
| `stack_ref_filter` | string | Area code | HIGH |
| `stack_reference` | string | LAW | LOW |
| `drop_no` | string | DR number | HIGH |
| `pon_no` | int | PON number | HIGH |
| `zone_no` | int | Zone number | HIGH |
| `pole_no` | string | Pole reference | MEDIUM |
| `address` | string | Street address | HIGH |
| `lat` | decimal | GPS latitude | HIGH |
| `lon` | decimal | GPS longitude | HIGH |
| `data_snapshot_timestamp` | date | Snapshot time | LOW |

**Network Structure:**
- Zones: 20 unique zones
- PONs: 212 unique PONs
- This represents full network capacity (not just active)

#### 1.5 Point of Interest Data (160 records)
**Purpose:** Shops and distribution points

| Column | Type | Description | Import Priority |
|--------|------|-------------|-----------------|
| `stack_ref_filter` | string | Area code | HIGH |
| `site_name` | string | Site name | HIGH |
| `drop_no` | string | Associated drop | HIGH |
| `poi_type` | string | Type category | HIGH |
| `poi_name` | string | Business name | HIGH |
| `branding_location` | string | Branding status | MEDIUM |
| `vouch` | string | Voucher info | MEDIUM |
| `agent_name` | string | Agent responsible | HIGH |
| `zone_no` | int | Zone number | HIGH |
| `pon_no` | int | PON number | HIGH |
| `data_snapshot_timestamp` | date | Snapshot time | LOW |

**POI Types:**
- Shop (identification)
- Retail (branding)
- Spaza (onboarding)

---

### File 2: Daily Network Summary Report

#### 2.1 Offline - Zone Summary (10 records)
**Purpose:** Offline count aggregated by zone

| Column | Type | Description |
|--------|------|-------------|
| `Zone` | int | Zone number |
| `Dying Gasp` | int | Count of dying gasp |
| `Device Not Active` | int | Count inactive |
| `Total` | int | Total offline |
| `% of Total` | decimal | Percentage |
| `Rank` | int | Ranking by count |

#### 2.2 Offline - PON Summary (72 records)
**Purpose:** Offline count aggregated by PON

Same structure as Zone Summary but at PON level.

#### 2.3 TRCH PON Level (65 records)
**Purpose:** Revenue per PON over 30 days

| Column | Type | Description |
|--------|------|-------------|
| `# PON` | int | PON number |
| `First Installed Home` | date | First activation date |
| `# of Homes` | int | Homes connected on PON |
| `PON Age` | int | Days since first home |
| `30-day Avg` | decimal | Average daily revenue |
| `2026-01-18` ... `2025-12-20` | decimal | Daily revenue values |

#### 2.4 ARCH Summary (6 records)
**Purpose:** Key performance metrics for entire area

| Metric | 30-day Avg | Latest |
|--------|------------|--------|
| Homes connected | 106,480 (cumulative) | 3,880 (current) |
| Revenue | R263,200 (cumulative) | R13,025 (daily) |
| True Revenue | R265,702 | R13,283 |
| TRPHC | R2.50 | R3.42 |
| Active bundles | 82,161 (cumulative) | 2,626 (daily) |
| AB/HC | 0.77 | 0.67 |

**Metric Definitions:**
- **Homes connected:** Cumulative count of activated drops
- **Revenue:** Gross revenue from bundle sales
- **True Revenue:** Net revenue after adjustments
- **TRPHC:** True Revenue Per Home Connected
- **Active bundles:** Count of purchased bundles
- **AB/HC:** Active Bundles per Home Connected ratio

#### 2.5 Offline - Detail (4,547 records)
**Purpose:** Detailed offline device list with context

Additional columns include:
- Revenue (30-day avg based on Planned PON)
- Point of Interest flag
- Days Since Activation
- Extended ACS information

#### 2.6 Previous Day Free Vouchers (65 records)
**Purpose:** Free voucher usage by PON

| Column | Type | Description |
|--------|------|-------------|
| `vlan` | string | VLAN name (ftn-law-pon-X-X) |
| `Yesterday - First 30min Free` | int | Trial vouchers used |
| `Yesterday - First Day Free` | int | Welcome vouchers |
| `Yesterday - 10 x 1 Day FREE` | int | Promo vouchers |
| `Yesterday - Grand Total` | int | Total free |
| `This Week - *` | int | Weekly totals |
| `This Month - *` | int | Monthly totals |

**Voucher Totals (Jan 18, 2026):**
- Yesterday 30min Free: 127
- This Week Total: 24
- This Month Total: 14,386

#### 2.7 Full DataSet (4,547 records)
**Purpose:** Comprehensive offline dataset with all columns

Extended version of Offline Data with 25 columns including:
- VLAN mapping
- Card/port details
- Zone/PON information
- Revenue context

---

### File 3: Performance 30 Days Report

#### 3.1 Area Overview (6 records)
**Purpose:** Same as ARCH Summary - area-level metrics

#### 3.2 Lawley (65 records)
**Purpose:** Same as TRCH PON Level - PON-level revenue

#### 3.3 area_pon_index_lawley (256 records)
**Purpose:** VLAN to PON mapping table

| Column | Type | Description |
|--------|------|-------------|
| `area_name` | string | Lawley |
| `vlan` | string | VLAN name (ftn-law-pon-X-X) |
| `pon` | int | PON number |

**Example mappings:**
- `ftn-law-pon-1-1` → PON 1
- `ftn-law-pon-3-5` → PON 199
- `ftn-law-pon-3-6` → PON 200

---

## Data Relationships

### Entity Relationship Diagram

```
┌─────────────────┐     ┌─────────────────┐
│  Planning Data  │     │    OES Data     │
│  (24,025 rows)  │     │  (3,880 rows)   │
├─────────────────┤     ├─────────────────┤
│ drop_no (PK)    │◄───►│ drop_number     │
│ zone_no         │     │ serialnumber    │
│ pon_no          │     │ olt_address     │
│ lat/lon         │     │ signal levels   │
│ address         │     │ geo_lat/lon     │
└────────┬────────┘     └────────┬────────┘
         │                       │
         │ zone_no               │ serialnumber
         │ pon_no                │
         ▼                       ▼
┌─────────────────┐     ┌─────────────────┐
│  Offline Data   │     │   OLT Data      │
│  (3,829 rows)   │     │  (3,877 rows)   │
├─────────────────┤     ├─────────────────┤
│ serial_number   │◄───►│ serial_number   │
│ drop_number     │     │ ssid            │
│ last_down_reason│     │ last_inform     │
│ days_offline    │     │ registered      │
└────────┬────────┘     └─────────────────┘
         │
         │ vlan (via olt_address)
         ▼
┌─────────────────┐     ┌─────────────────┐
│   PON Index     │◄───►│  TRCH Revenue   │
│  (256 rows)     │     │  (65 rows)      │
├─────────────────┤     ├─────────────────┤
│ vlan            │     │ pon             │
│ pon             │     │ daily_revenue[] │
│ area_name       │     │ 30_day_avg      │
└─────────────────┘     └─────────────────┘
         │
         │ vlan
         ▼
┌─────────────────┐     ┌─────────────────┐
│ Free Vouchers   │     │   POI Data      │
│  (65 rows)      │     │  (160 rows)     │
├─────────────────┤     ├─────────────────┤
│ vlan            │     │ drop_no         │
│ free_30min      │     │ poi_type        │
│ free_1day       │     │ agent_name      │
│ promo_free      │     │ zone/pon        │
└─────────────────┘     └─────────────────┘
```

### Join Keys

| Source Table | Target Table | Join Key |
|--------------|--------------|----------|
| OES Data | Planning Data | `drop_number` = `drop_no` |
| OES Data | Offline Data | `serialnumber` = `serial_number` |
| OES Data | OLT Data | `serialnumber` = `serial_number` |
| PON Index | TRCH Revenue | `pon` = `# PON` |
| PON Index | Free Vouchers | `vlan` = `vlan` |
| Planning Data | POI Data | `drop_no` = `drop_no` |

### Data Quality Metrics

| Check | Result | Status |
|-------|--------|--------|
| OES duplicate drops | 0 | ✅ |
| OES duplicate serials | 0 | ✅ |
| OES missing GPS | 0 | ✅ |
| OES matched to Planning | 3,864 of 3,880 (99.6%) | ✅ |
| Offline matched to OES | 3,825 of 3,829 (99.9%) | ✅ |
| Offline not in OES | 4 devices | ⚠️ |

---

## Database Schema Proposal

### Tables to Create

```sql
-- Core network audit data
CREATE TABLE arch_network_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id),
  snapshot_date DATE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(project_id, snapshot_date)
);

-- OES activation data
CREATE TABLE arch_oes_data (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id UUID REFERENCES arch_network_snapshots(id) ON DELETE CASCADE,
  drop_number VARCHAR(20) NOT NULL,
  serial_number VARCHAR(20) NOT NULL,
  activation_date DATE,
  olt_address VARCHAR(50),
  olt_rack INT,
  olt_shelf INT,
  olt_slot INT,
  olt_port INT,
  ont_rx_signal DECIMAL(6,3),
  olt_rx_signal DECIMAL(6,3),
  link_budget_ont DECIMAL(6,3),
  link_budget_olt DECIMAL(6,3),
  current_ont_rx DECIMAL(6,3),
  ont_status VARCHAR(20),
  geo_latitude DECIMAL(12,8),
  geo_longitude DECIMAL(12,8),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(snapshot_id, drop_number)
);

-- Offline device tracking
CREATE TABLE arch_offline_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id UUID REFERENCES arch_network_snapshots(id) ON DELETE CASCADE,
  serial_number VARCHAR(20) NOT NULL,
  drop_number VARCHAR(20),
  ont_address VARCHAR(50),
  last_down_reason VARCHAR(100),
  last_inform_date TIMESTAMPTZ,
  days_since_last_inform INT,
  offline_bucket VARCHAR(50),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(snapshot_id, serial_number)
);

-- Planning/network structure
CREATE TABLE arch_planning_data (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id UUID REFERENCES arch_network_snapshots(id) ON DELETE CASCADE,
  drop_number VARCHAR(20),
  zone_number INT,
  pon_number INT,
  pole_number VARCHAR(20),
  address TEXT,
  latitude DECIMAL(12,8),
  longitude DECIMAL(12,8),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Points of Interest
CREATE TABLE arch_poi (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id UUID REFERENCES arch_network_snapshots(id) ON DELETE CASCADE,
  site_name VARCHAR(100),
  drop_number VARCHAR(20),
  poi_type VARCHAR(50),
  poi_name VARCHAR(100),
  branding_location VARCHAR(100),
  agent_name VARCHAR(100),
  zone_number INT,
  pon_number INT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Daily revenue metrics (time series)
CREATE TABLE arch_daily_revenue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id),
  report_date DATE NOT NULL,
  pon_number INT,
  homes_connected INT,
  revenue DECIMAL(12,2),
  true_revenue DECIMAL(12,2),
  active_bundles INT,
  trphc DECIMAL(8,4),
  ab_hc_ratio DECIMAL(6,4),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(project_id, report_date, pon_number)
);

-- Free voucher tracking
CREATE TABLE arch_voucher_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id),
  report_date DATE NOT NULL,
  vlan VARCHAR(50),
  pon_number INT,
  free_30min_yesterday INT DEFAULT 0,
  free_1day_yesterday INT DEFAULT 0,
  promo_free_yesterday INT DEFAULT 0,
  free_30min_week INT DEFAULT 0,
  free_1day_week INT DEFAULT 0,
  promo_free_week INT DEFAULT 0,
  free_30min_month INT DEFAULT 0,
  free_1day_month INT DEFAULT 0,
  promo_free_month INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(project_id, report_date, vlan)
);

-- PON index mapping (reference table)
CREATE TABLE arch_pon_index (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id),
  area_name VARCHAR(50),
  vlan VARCHAR(50),
  pon_number INT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(project_id, vlan)
);

-- Offline zone/PON summaries
CREATE TABLE arch_offline_summary (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id UUID REFERENCES arch_network_snapshots(id) ON DELETE CASCADE,
  summary_type VARCHAR(10) NOT NULL, -- 'zone' or 'pon'
  zone_or_pon INT NOT NULL,
  dying_gasp_count INT DEFAULT 0,
  device_not_active_count INT DEFAULT 0,
  total_offline INT DEFAULT 0,
  percentage_of_total DECIMAL(5,2),
  rank INT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_arch_oes_snapshot ON arch_oes_data(snapshot_id);
CREATE INDEX idx_arch_oes_drop ON arch_oes_data(drop_number);
CREATE INDEX idx_arch_oes_serial ON arch_oes_data(serial_number);
CREATE INDEX idx_arch_offline_snapshot ON arch_offline_devices(snapshot_id);
CREATE INDEX idx_arch_revenue_date ON arch_daily_revenue(project_id, report_date);
CREATE INDEX idx_arch_voucher_date ON arch_voucher_usage(project_id, report_date);
```

---

## Reporting Capabilities

### 1. Network Health Dashboard
- **Homes Connected Trend:** Daily/weekly/monthly activation chart
- **Offline Rate:** Percentage of devices offline by zone
- **Signal Quality:** Distribution of ONT RX signal levels
- **Down Reason Analysis:** Pie chart of offline reasons

### 2. Revenue Analytics
- **Daily Revenue:** Line chart with 30-day trend
- **TRPHC (True Revenue Per Home Connected):** Key metric tracking
- **PON Performance Ranking:** Top/bottom performing PONs
- **Active Bundles Ratio (AB/HC):** Usage engagement metric

### 3. Voucher & Usage Reports
- **Free Voucher Distribution:** Daily/weekly/monthly usage
- **Voucher Type Breakdown:** 30min vs 1-day vs promo
- **PON-level Usage:** Which areas use most free vouchers

### 4. Offline Analysis
- **Zone Heatmap:** Offline concentration by zone
- **Duration Analysis:** How long devices stay offline
- **Trend Analysis:** Is offline rate improving or worsening?
- **Action List:** Devices offline > 20 days needing attention

### 5. Geographic Reports
- **Map Visualization:** GPS-based device mapping
- **POI Coverage:** Shop/spaza distribution and gaps
- **Zone Boundaries:** Visual zone mapping

### 6. Comparative Reports
- **Day-over-Day:** Compare metrics between days
- **Week-over-Week:** Weekly trend analysis
- **Month-over-Month:** Monthly performance review

---

## Import Process

### Recommended Import Flow

```
1. Upload Excel files
   ↓
2. Parse and validate data
   ↓
3. Create snapshot record
   ↓
4. Import in order:
   a. PON Index (reference data)
   b. Planning Data (network structure)
   c. OES Data (active devices)
   d. Offline Data (problem devices)
   e. POI Data (distribution points)
   f. Daily Revenue (metrics)
   g. Voucher Usage (usage stats)
   h. Offline Summaries (aggregates)
   ↓
5. Calculate derived metrics
   ↓
6. Generate reports
```

### API Endpoints to Create

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/arch/upload` | POST | Upload Excel files |
| `/api/arch/snapshots` | GET | List all snapshots |
| `/api/arch/snapshots/:id` | GET | Get snapshot details |
| `/api/arch/oes` | GET | Query OES data |
| `/api/arch/offline` | GET | Query offline devices |
| `/api/arch/revenue` | GET | Query revenue data |
| `/api/arch/vouchers` | GET | Query voucher usage |
| `/api/arch/reports/:type` | GET | Generate reports |

---

## Next Steps

1. **Create Migration Script:** Generate SQL migration for tables
2. **Build Import Service:** Excel parsing and database insertion
3. **Create API Endpoints:** REST APIs for data access
4. **Build Dashboard UI:** React components for visualization
5. **Schedule Imports:** Daily automated import process
6. **Set Up Alerts:** Notifications for anomalies

---

## Appendix

### Excel Date Conversion
Excel dates are stored as serial numbers. Conversion:
```javascript
// Excel serial date to JS Date
function excelToDate(serial) {
  return new Date((serial - 25569) * 86400 * 1000);
}
// Example: 46041 → 2026-01-18
```

### OLT Address Parsing
```javascript
function parseOltAddress(address) {
  const match = address?.match(/law\.olt\.01:(\d+)-(\d+)-(\d+)-(\d+)/);
  if (match) {
    return {
      rack: parseInt(match[1]),
      shelf: parseInt(match[2]),
      slot: parseInt(match[3]),
      port: parseInt(match[4])
    };
  }
  return null;
}
```

### VLAN to PON Mapping
VLAN format: `ftn-law-pon-X-Y`
- X typically maps to slot
- Y maps to a calculated PON number
- Use `arch_pon_index` table for accurate mapping
