-- Migration: 090_arch_network_audit
-- Description: ARCH (Area Reporting & Compliance Hub) tables for network audit data
-- Date: 2026-01-19
-- Source: law_daily_network_audit_detail_report, law_daily_network_summary_report, lawley_Performance_30Days

-- =============================================================================
-- CORE TABLES
-- =============================================================================

-- Network audit snapshots (one per import/day)
CREATE TABLE IF NOT EXISTS arch_network_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  snapshot_date DATE NOT NULL,
  source_files JSONB DEFAULT '[]', -- Array of imported file names
  import_status VARCHAR(20) DEFAULT 'pending', -- pending, processing, completed, failed
  record_counts JSONB DEFAULT '{}', -- { oes: 0, offline: 0, planning: 0, etc }
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(project_id, snapshot_date)
);

-- PON Index mapping (reference table - relatively static)
CREATE TABLE IF NOT EXISTS arch_pon_index (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  area_name VARCHAR(50) NOT NULL,
  vlan VARCHAR(50) NOT NULL,
  pon_number INT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(project_id, vlan)
);

-- =============================================================================
-- DEVICE DATA TABLES
-- =============================================================================

-- OES activation data (active ONTs with signal levels)
CREATE TABLE IF NOT EXISTS arch_oes_data (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id UUID NOT NULL REFERENCES arch_network_snapshots(id) ON DELETE CASCADE,
  -- Core identifiers
  drop_number VARCHAR(20) NOT NULL,
  serial_number VARCHAR(20) NOT NULL,
  -- OLT location
  olt_address VARCHAR(50),
  olt_rack INT,
  olt_shelf INT,
  olt_slot INT,
  olt_port INT,
  -- Signal levels (dBm)
  ont_rx_signal DECIMAL(6,3),
  olt_rx_signal DECIMAL(6,3),
  link_budget_ont DECIMAL(6,3),
  link_budget_olt DECIMAL(6,3),
  current_ont_rx DECIMAL(6,3),
  -- Status
  ont_status VARCHAR(20),
  activation_date DATE,
  -- GPS
  geo_latitude DECIMAL(12,8),
  geo_longitude DECIMAL(12,8),
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(snapshot_id, drop_number)
);

-- OLT/ACS data (device registration)
CREATE TABLE IF NOT EXISTS arch_olt_data (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id UUID NOT NULL REFERENCES arch_network_snapshots(id) ON DELETE CASCADE,
  serial_number VARCHAR(20) NOT NULL,
  ssid VARCHAR(50),
  last_inform TIMESTAMPTZ,
  registered_date TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(snapshot_id, serial_number)
);

-- Offline device tracking
CREATE TABLE IF NOT EXISTS arch_offline_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id UUID NOT NULL REFERENCES arch_network_snapshots(id) ON DELETE CASCADE,
  serial_number VARCHAR(20) NOT NULL,
  drop_number VARCHAR(20),
  ont_address VARCHAR(50),
  area_abbreviation VARCHAR(10),
  -- Offline details
  last_down_reason VARCHAR(100),
  last_inform_date TIMESTAMPTZ,
  days_since_last_inform INT,
  offline_bucket VARCHAR(50),
  -- Extended data (from Full DataSet)
  vlan VARCHAR(50),
  card_port VARCHAR(20),
  oes_status VARCHAR(20),
  zone_number INT,
  pon_number INT,
  -- Revenue context
  pon_30day_revenue_avg DECIMAL(10,2),
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(snapshot_id, serial_number)
);

-- =============================================================================
-- PLANNING & STRUCTURE TABLES
-- =============================================================================

-- Planning data (full network structure with all drops)
CREATE TABLE IF NOT EXISTS arch_planning_data (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id UUID NOT NULL REFERENCES arch_network_snapshots(id) ON DELETE CASCADE,
  drop_number VARCHAR(20),
  zone_number INT,
  pon_number INT,
  pole_number VARCHAR(20),
  address TEXT,
  latitude DECIMAL(12,8),
  longitude DECIMAL(12,8),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Points of Interest (shops, spazas, retail)
CREATE TABLE IF NOT EXISTS arch_poi (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id UUID NOT NULL REFERENCES arch_network_snapshots(id) ON DELETE CASCADE,
  site_name VARCHAR(100),
  drop_number VARCHAR(20),
  poi_type VARCHAR(50), -- Shop (identification), Retail (branding), Spaza (onboarding)
  poi_name VARCHAR(100),
  branding_location VARCHAR(100),
  voucher_info VARCHAR(100),
  agent_name VARCHAR(100),
  zone_number INT,
  pon_number INT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================================
-- METRICS & REVENUE TABLES
-- =============================================================================

-- Area-level daily metrics (ARCH Summary)
CREATE TABLE IF NOT EXISTS arch_area_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  report_date DATE NOT NULL,
  area_name VARCHAR(50) NOT NULL,
  -- Core metrics
  homes_connected INT,
  revenue DECIMAL(12,2),
  true_revenue DECIMAL(12,2),
  active_bundles INT,
  -- Calculated ratios
  trphc DECIMAL(8,4), -- True Revenue Per Home Connected
  ab_hc_ratio DECIMAL(6,4), -- Active Bundles / Homes Connected
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(project_id, report_date, area_name)
);

-- PON-level daily revenue (TRCH PON Level)
CREATE TABLE IF NOT EXISTS arch_pon_revenue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  report_date DATE NOT NULL,
  pon_number INT NOT NULL,
  -- PON details
  first_installed_home DATE,
  homes_count INT,
  pon_age_days INT,
  -- Revenue
  daily_revenue DECIMAL(10,2),
  thirty_day_avg DECIMAL(10,2),
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(project_id, report_date, pon_number)
);

-- Free voucher usage tracking
CREATE TABLE IF NOT EXISTS arch_voucher_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  report_date DATE NOT NULL,
  vlan VARCHAR(50) NOT NULL,
  pon_number INT,
  -- Yesterday totals
  free_30min_yesterday INT DEFAULT 0,
  free_1day_yesterday INT DEFAULT 0,
  promo_free_yesterday INT DEFAULT 0,
  total_free_yesterday INT DEFAULT 0,
  -- This week totals
  free_30min_week INT DEFAULT 0,
  free_1day_week INT DEFAULT 0,
  promo_free_week INT DEFAULT 0,
  total_free_week INT DEFAULT 0,
  -- This month totals
  free_30min_month INT DEFAULT 0,
  free_1day_month INT DEFAULT 0,
  promo_free_month INT DEFAULT 0,
  total_free_month INT DEFAULT 0,
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(project_id, report_date, vlan)
);

-- =============================================================================
-- SUMMARY TABLES
-- =============================================================================

-- Offline summary by zone or PON
CREATE TABLE IF NOT EXISTS arch_offline_summary (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id UUID NOT NULL REFERENCES arch_network_snapshots(id) ON DELETE CASCADE,
  summary_type VARCHAR(10) NOT NULL, -- 'zone' or 'pon'
  zone_or_pon INT NOT NULL,
  -- Counts by reason
  dying_gasp_count INT DEFAULT 0,
  device_not_active_count INT DEFAULT 0,
  signal_low_count INT DEFAULT 0,
  other_count INT DEFAULT 0,
  total_offline INT DEFAULT 0,
  -- Analysis
  percentage_of_total DECIMAL(5,2),
  rank INT,
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(snapshot_id, summary_type, zone_or_pon)
);

-- =============================================================================
-- INDEXES
-- =============================================================================

-- Snapshot lookups
CREATE INDEX IF NOT EXISTS idx_arch_snapshots_project ON arch_network_snapshots(project_id);
CREATE INDEX IF NOT EXISTS idx_arch_snapshots_date ON arch_network_snapshots(snapshot_date);

-- OES data lookups
CREATE INDEX IF NOT EXISTS idx_arch_oes_snapshot ON arch_oes_data(snapshot_id);
CREATE INDEX IF NOT EXISTS idx_arch_oes_drop ON arch_oes_data(drop_number);
CREATE INDEX IF NOT EXISTS idx_arch_oes_serial ON arch_oes_data(serial_number);
CREATE INDEX IF NOT EXISTS idx_arch_oes_signal ON arch_oes_data(ont_rx_signal);

-- OLT data lookups
CREATE INDEX IF NOT EXISTS idx_arch_olt_snapshot ON arch_olt_data(snapshot_id);
CREATE INDEX IF NOT EXISTS idx_arch_olt_serial ON arch_olt_data(serial_number);

-- Offline device lookups
CREATE INDEX IF NOT EXISTS idx_arch_offline_snapshot ON arch_offline_devices(snapshot_id);
CREATE INDEX IF NOT EXISTS idx_arch_offline_serial ON arch_offline_devices(serial_number);
CREATE INDEX IF NOT EXISTS idx_arch_offline_drop ON arch_offline_devices(drop_number);
CREATE INDEX IF NOT EXISTS idx_arch_offline_reason ON arch_offline_devices(last_down_reason);
CREATE INDEX IF NOT EXISTS idx_arch_offline_days ON arch_offline_devices(days_since_last_inform);

-- Planning data lookups
CREATE INDEX IF NOT EXISTS idx_arch_planning_snapshot ON arch_planning_data(snapshot_id);
CREATE INDEX IF NOT EXISTS idx_arch_planning_drop ON arch_planning_data(drop_number);
CREATE INDEX IF NOT EXISTS idx_arch_planning_zone ON arch_planning_data(zone_number);
CREATE INDEX IF NOT EXISTS idx_arch_planning_pon ON arch_planning_data(pon_number);

-- POI lookups
CREATE INDEX IF NOT EXISTS idx_arch_poi_snapshot ON arch_poi(snapshot_id);
CREATE INDEX IF NOT EXISTS idx_arch_poi_type ON arch_poi(poi_type);
CREATE INDEX IF NOT EXISTS idx_arch_poi_drop ON arch_poi(drop_number);

-- Revenue/metrics lookups
CREATE INDEX IF NOT EXISTS idx_arch_area_metrics_date ON arch_area_metrics(project_id, report_date);
CREATE INDEX IF NOT EXISTS idx_arch_pon_revenue_date ON arch_pon_revenue(project_id, report_date);
CREATE INDEX IF NOT EXISTS idx_arch_pon_revenue_pon ON arch_pon_revenue(pon_number);
CREATE INDEX IF NOT EXISTS idx_arch_voucher_date ON arch_voucher_usage(project_id, report_date);
CREATE INDEX IF NOT EXISTS idx_arch_voucher_vlan ON arch_voucher_usage(vlan);

-- Summary lookups
CREATE INDEX IF NOT EXISTS idx_arch_summary_snapshot ON arch_offline_summary(snapshot_id);
CREATE INDEX IF NOT EXISTS idx_arch_summary_type ON arch_offline_summary(summary_type);

-- =============================================================================
-- COMMENTS
-- =============================================================================

COMMENT ON TABLE arch_network_snapshots IS 'Daily snapshots of network audit data from Excel imports';
COMMENT ON TABLE arch_oes_data IS 'OES activation data: active ONTs with signal levels and GPS';
COMMENT ON TABLE arch_olt_data IS 'ACS/CWMP device registration data';
COMMENT ON TABLE arch_offline_devices IS 'Currently offline devices with reasons and duration';
COMMENT ON TABLE arch_planning_data IS 'Full network planning structure (all possible drops)';
COMMENT ON TABLE arch_poi IS 'Points of Interest: shops, spazas, retail locations';
COMMENT ON TABLE arch_area_metrics IS 'Daily area-level metrics: homes, revenue, bundles';
COMMENT ON TABLE arch_pon_revenue IS 'Daily PON-level revenue tracking';
COMMENT ON TABLE arch_voucher_usage IS 'Free voucher usage by VLAN/PON';
COMMENT ON TABLE arch_offline_summary IS 'Aggregated offline counts by zone or PON';
COMMENT ON TABLE arch_pon_index IS 'Reference mapping: VLAN name to PON number';

-- Signal level thresholds comment
COMMENT ON COLUMN arch_oes_data.ont_rx_signal IS 'ONT RX signal in dBm. Acceptable: -18 to -24 dBm';
