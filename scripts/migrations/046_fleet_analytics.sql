-- Migration: 046_fleet_analytics.sql
-- Description: Fleet Analytics & KPI Dashboard tables and views
-- Created: 2026-01-15
-- PRD: PRD-046

-- ============================================================================
-- TABLE: fleet_service_intervals
-- Purpose: Per-vehicle service scheduling configuration
-- ============================================================================
CREATE TABLE IF NOT EXISTS fleet_service_intervals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id UUID NOT NULL REFERENCES fleet_vehicles(id) ON DELETE CASCADE,
    service_type VARCHAR(50) NOT NULL,  -- oil_change, major_service, brake_pads, tyres, transmission, timing_belt, air_filter, spark_plugs
    interval_km INTEGER NOT NULL,        -- e.g., 10000, 50000, 80000
    interval_months INTEGER,             -- e.g., 6, 12, 24 (optional time-based interval)
    last_service_km INTEGER,
    last_service_date DATE,
    next_service_km INTEGER,
    next_service_date DATE,
    estimated_cost NUMERIC(10,2),
    provider_name VARCHAR(255),          -- Preferred service provider
    notes TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by VARCHAR(255)
);

CREATE INDEX IF NOT EXISTS idx_service_intervals_vehicle ON fleet_service_intervals(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_service_intervals_next_km ON fleet_service_intervals(next_service_km);
CREATE INDEX IF NOT EXISTS idx_service_intervals_next_date ON fleet_service_intervals(next_service_date);
CREATE INDEX IF NOT EXISTS idx_service_intervals_type ON fleet_service_intervals(service_type);

-- ============================================================================
-- TABLE: fleet_service_history
-- Purpose: Completed service records with cost tracking
-- ============================================================================
CREATE TABLE IF NOT EXISTS fleet_service_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id UUID NOT NULL REFERENCES fleet_vehicles(id) ON DELETE CASCADE,
    service_interval_id UUID REFERENCES fleet_service_intervals(id) ON DELETE SET NULL,
    document_id UUID REFERENCES fleet_vehicle_documents(id) ON DELETE SET NULL,  -- Link to service_record document
    service_type VARCHAR(50) NOT NULL,
    service_date DATE NOT NULL,
    odometer_at_service INTEGER,

    -- Cost breakdown
    labor_cost NUMERIC(10,2),
    parts_cost NUMERIC(10,2),
    total_cost NUMERIC(10,2),

    -- Provider details
    provider_name VARCHAR(255),
    provider_location VARCHAR(500),
    invoice_number VARCHAR(100),

    -- Service details
    description TEXT,
    parts_replaced TEXT[],
    findings TEXT,                       -- Technician findings/notes
    recommendations TEXT,                -- Future recommendations

    -- Warranty tracking
    warranty_months INTEGER,
    warranty_km INTEGER,
    warranty_expires DATE,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    created_by VARCHAR(255)
);

CREATE INDEX IF NOT EXISTS idx_service_history_vehicle ON fleet_service_history(vehicle_id, service_date DESC);
CREATE INDEX IF NOT EXISTS idx_service_history_type ON fleet_service_history(service_type);
CREATE INDEX IF NOT EXISTS idx_service_history_date ON fleet_service_history(service_date DESC);

-- ============================================================================
-- TABLE: fleet_driver_scores
-- Purpose: Driver performance tracking with composite scoring
-- ============================================================================
CREATE TABLE IF NOT EXISTS fleet_driver_scores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    staff_id UUID NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
    score_date DATE NOT NULL,
    score_type VARCHAR(20) NOT NULL CHECK (score_type IN ('daily', 'weekly', 'monthly')),

    -- Individual scores (0-100)
    check_in_compliance NUMERIC(5,2),      -- % of expected check-ins completed
    fuel_efficiency_score NUMERIC(5,2),    -- Performance vs fleet average
    authorization_compliance NUMERIC(5,2), -- % of authorized trips
    vehicle_care_score NUMERIC(5,2),       -- Based on check-in issues/damage

    -- Composite score (equal weights: 25% each)
    composite_score NUMERIC(5,2),

    -- Check-in metrics
    total_check_ins INTEGER DEFAULT 0,
    expected_check_ins INTEGER DEFAULT 0,
    missed_check_ins INTEGER DEFAULT 0,
    late_check_ins INTEGER DEFAULT 0,
    critical_issues_reported INTEGER DEFAULT 0,
    minor_issues_reported INTEGER DEFAULT 0,

    -- Fuel metrics
    avg_litres_per_100km NUMERIC(6,2),
    fleet_avg_litres_per_100km NUMERIC(6,2),
    total_fuel_cost NUMERIC(10,2),

    -- Authorization metrics (from GPS)
    total_trips INTEGER DEFAULT 0,
    authorized_trips INTEGER DEFAULT 0,
    unauthorized_trips INTEGER DEFAULT 0,
    after_hours_trips INTEGER DEFAULT 0,
    weekend_trips INTEGER DEFAULT 0,
    total_km NUMERIC(10,2) DEFAULT 0,
    unauthorized_km NUMERIC(10,2) DEFAULT 0,

    created_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(staff_id, score_date, score_type)
);

CREATE INDEX IF NOT EXISTS idx_driver_scores_staff ON fleet_driver_scores(staff_id, score_date DESC);
CREATE INDEX IF NOT EXISTS idx_driver_scores_date ON fleet_driver_scores(score_date DESC, score_type);
CREATE INDEX IF NOT EXISTS idx_driver_scores_composite ON fleet_driver_scores(composite_score DESC);
CREATE INDEX IF NOT EXISTS idx_driver_scores_type ON fleet_driver_scores(score_type, score_date DESC);

-- ============================================================================
-- TABLE: fleet_analytics_snapshots
-- Purpose: Daily/weekly analytics cache for performance
-- ============================================================================
CREATE TABLE IF NOT EXISTS fleet_analytics_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    snapshot_date DATE NOT NULL,
    snapshot_type VARCHAR(20) NOT NULL CHECK (snapshot_type IN ('daily', 'weekly', 'monthly')),

    -- Fleet totals
    total_vehicles INTEGER DEFAULT 0,
    active_vehicles INTEGER DEFAULT 0,
    leased_vehicles INTEGER DEFAULT 0,
    company_vehicles INTEGER DEFAULT 0,

    -- Distance metrics
    total_km_travelled NUMERIC(12,2) DEFAULT 0,
    avg_km_per_vehicle NUMERIC(10,2) DEFAULT 0,

    -- Cost metrics (all in ZAR)
    total_fuel_cost NUMERIC(12,2) DEFAULT 0,
    total_maintenance_cost NUMERIC(12,2) DEFAULT 0,
    total_lease_cost NUMERIC(12,2) DEFAULT 0,
    total_insurance_cost NUMERIC(12,2) DEFAULT 0,
    total_license_cost NUMERIC(12,2) DEFAULT 0,
    total_tco NUMERIC(12,2) DEFAULT 0,

    -- Efficiency metrics
    avg_cost_per_km NUMERIC(10,4),
    avg_fuel_consumption NUMERIC(6,2),      -- L/100km
    avg_check_in_compliance NUMERIC(5,2),   -- Percentage

    -- Detailed metrics (JSON for flexibility)
    vehicle_metrics JSONB,  -- Per-vehicle breakdown: { vehicleId: { tco, costPerKm, ... } }
    driver_metrics JSONB,   -- Per-driver breakdown: { staffId: { score, compliance, ... } }
    cost_breakdown JSONB,   -- { fuel: x, maintenance: y, lease: z, ... }

    created_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(snapshot_date, snapshot_type)
);

CREATE INDEX IF NOT EXISTS idx_analytics_snapshots_date ON fleet_analytics_snapshots(snapshot_date DESC, snapshot_type);

-- ============================================================================
-- TABLE: fleet_fuel_anomalies
-- Purpose: Track detected fuel anomalies for theft detection
-- ============================================================================
CREATE TABLE IF NOT EXISTS fleet_fuel_anomalies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id UUID NOT NULL REFERENCES fleet_vehicles(id) ON DELETE CASCADE,
    detected_at TIMESTAMPTZ DEFAULT NOW(),
    anomaly_type VARCHAR(50) NOT NULL,  -- sudden_drop, excessive_consumption, no_receipt, location_mismatch
    severity VARCHAR(20) NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),

    -- Detection data
    fuel_level_before NUMERIC(5,2),
    fuel_level_after NUMERIC(5,2),
    expected_consumption NUMERIC(6,2),
    actual_consumption NUMERIC(6,2),
    deviation_percentage NUMERIC(5,2),

    -- Context
    location_lat NUMERIC(10,7),
    location_lon NUMERIC(10,7),
    location_name VARCHAR(255),
    related_transaction_id UUID REFERENCES fleet_fuel_transactions(id),
    related_check_record_id UUID REFERENCES fleet_check_records(id),

    -- Resolution
    status VARCHAR(20) DEFAULT 'open' CHECK (status IN ('open', 'investigating', 'resolved', 'dismissed')),
    investigated_by UUID REFERENCES staff(id),
    resolution_notes TEXT,
    resolved_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fuel_anomalies_vehicle ON fleet_fuel_anomalies(vehicle_id, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_fuel_anomalies_status ON fleet_fuel_anomalies(status, severity);
CREATE INDEX IF NOT EXISTS idx_fuel_anomalies_type ON fleet_fuel_anomalies(anomaly_type);

-- ============================================================================
-- VIEW: v_fleet_tco_summary
-- Purpose: Total Cost of Ownership per vehicle (12-month and lifetime)
-- ============================================================================
CREATE OR REPLACE VIEW v_fleet_tco_summary AS
WITH fuel_costs_12m AS (
    SELECT
        vehicle_id,
        COALESCE(SUM(amount_rand), 0) as fuel_cost_12m,
        COALESCE(SUM(litres), 0) as total_litres_12m,
        COUNT(*) as fuel_transactions_12m
    FROM fleet_fuel_transactions
    WHERE transaction_date >= CURRENT_DATE - INTERVAL '12 months'
    GROUP BY vehicle_id
),
fuel_costs_lifetime AS (
    SELECT
        vehicle_id,
        COALESCE(SUM(amount_rand), 0) as fuel_cost_lifetime,
        COALESCE(SUM(litres), 0) as total_litres_lifetime,
        COUNT(*) as fuel_transactions_lifetime
    FROM fleet_fuel_transactions
    GROUP BY vehicle_id
),
service_costs_12m AS (
    SELECT
        vehicle_id,
        COALESCE(SUM(total_cost), 0) as service_cost_12m,
        COUNT(*) as service_count_12m
    FROM fleet_service_history
    WHERE service_date >= CURRENT_DATE - INTERVAL '12 months'
    GROUP BY vehicle_id
),
service_costs_lifetime AS (
    SELECT
        vehicle_id,
        COALESCE(SUM(total_cost), 0) as service_cost_lifetime,
        COUNT(*) as service_count_lifetime
    FROM fleet_service_history
    GROUP BY vehicle_id
),
lease_costs AS (
    SELECT
        vehicle_id,
        monthly_cost,
        contract_duration_months,
        deposit_amount,
        start_date,
        end_date,
        -- Annual lease cost (12 months or remaining contract)
        COALESCE(monthly_cost * LEAST(contract_duration_months, 12), 0) as lease_cost_12m,
        -- Total lease cost over full contract
        COALESCE(monthly_cost * contract_duration_months, 0) + COALESCE(deposit_amount, 0) as total_lease_cost
    FROM fleet_vehicle_lease
),
insurance_costs AS (
    SELECT
        vehicle_id,
        COALESCE(premium_annual, premium_monthly * 12, 0) as insurance_cost_annual
    FROM fleet_vehicle_insurance
    WHERE is_active = true
),
license_costs AS (
    SELECT
        vehicle_id,
        COALESCE(SUM(total_paid), 0) as license_cost_12m
    FROM fleet_license_disc
    WHERE expiry_date >= CURRENT_DATE - INTERVAL '12 months'
    GROUP BY vehicle_id
),
km_data_12m AS (
    SELECT
        vehicle_id,
        MAX(reading) - MIN(reading) as km_travelled_12m
    FROM fleet_odometer_history
    WHERE recorded_at >= CURRENT_DATE - INTERVAL '12 months'
    GROUP BY vehicle_id
),
km_data_lifetime AS (
    SELECT
        vehicle_id,
        MAX(reading) - MIN(reading) as km_travelled_lifetime,
        MIN(recorded_at) as first_reading_date
    FROM fleet_odometer_history
    GROUP BY vehicle_id
)
SELECT
    fv.id as vehicle_id,
    fv.registration,
    fv.make,
    fv.model,
    fv.year,
    fv.ownership_type,
    fv.status,
    fv.created_at as vehicle_added_date,

    -- 12-Month Costs
    COALESCE(fc12.fuel_cost_12m, 0) as fuel_cost_12m,
    COALESCE(sc12.service_cost_12m, 0) as service_cost_12m,
    COALESCE(lc.lease_cost_12m, 0) as lease_cost_12m,
    COALESCE(ic.insurance_cost_annual, 0) as insurance_cost_12m,
    COALESCE(lic.license_cost_12m, 0) as license_cost_12m,

    -- 12-Month TCO
    COALESCE(fc12.fuel_cost_12m, 0) +
    COALESCE(sc12.service_cost_12m, 0) +
    COALESCE(lc.lease_cost_12m, 0) +
    COALESCE(ic.insurance_cost_annual, 0) +
    COALESCE(lic.license_cost_12m, 0) as tco_12m,

    -- Lifetime Costs
    COALESCE(fcl.fuel_cost_lifetime, 0) as fuel_cost_lifetime,
    COALESCE(scl.service_cost_lifetime, 0) as service_cost_lifetime,
    COALESCE(lc.total_lease_cost, 0) as lease_cost_lifetime,

    -- Lifetime TCO (fuel + service + lease total)
    COALESCE(fcl.fuel_cost_lifetime, 0) +
    COALESCE(scl.service_cost_lifetime, 0) +
    COALESCE(lc.total_lease_cost, 0) as tco_lifetime,

    -- Distance metrics
    COALESCE(kd12.km_travelled_12m, 0) as km_travelled_12m,
    COALESCE(kdl.km_travelled_lifetime, 0) as km_travelled_lifetime,

    -- Cost per km (12-month)
    CASE WHEN COALESCE(kd12.km_travelled_12m, 0) > 0 THEN
        (COALESCE(fc12.fuel_cost_12m, 0) + COALESCE(sc12.service_cost_12m, 0) +
         COALESCE(lc.lease_cost_12m, 0) + COALESCE(ic.insurance_cost_annual, 0) +
         COALESCE(lic.license_cost_12m, 0)) / kd12.km_travelled_12m
    ELSE NULL END as cost_per_km_12m,

    -- Cost per km (lifetime)
    CASE WHEN COALESCE(kdl.km_travelled_lifetime, 0) > 0 THEN
        (COALESCE(fcl.fuel_cost_lifetime, 0) + COALESCE(scl.service_cost_lifetime, 0) +
         COALESCE(lc.total_lease_cost, 0)) / kdl.km_travelled_lifetime
    ELSE NULL END as cost_per_km_lifetime,

    -- Fuel efficiency
    CASE WHEN COALESCE(kd12.km_travelled_12m, 0) > 0 AND COALESCE(fc12.total_litres_12m, 0) > 0 THEN
        (fc12.total_litres_12m / kd12.km_travelled_12m) * 100
    ELSE NULL END as litres_per_100km,

    -- Counts
    COALESCE(fc12.fuel_transactions_12m, 0) as fuel_transactions_12m,
    COALESCE(sc12.service_count_12m, 0) as service_count_12m

FROM fleet_vehicles fv
LEFT JOIN fuel_costs_12m fc12 ON fv.id = fc12.vehicle_id
LEFT JOIN fuel_costs_lifetime fcl ON fv.id = fcl.vehicle_id
LEFT JOIN service_costs_12m sc12 ON fv.id = sc12.vehicle_id
LEFT JOIN service_costs_lifetime scl ON fv.id = scl.vehicle_id
LEFT JOIN lease_costs lc ON fv.id = lc.vehicle_id
LEFT JOIN insurance_costs ic ON fv.id = ic.vehicle_id
LEFT JOIN license_costs lic ON fv.id = lic.vehicle_id
LEFT JOIN km_data_12m kd12 ON fv.id = kd12.vehicle_id
LEFT JOIN km_data_lifetime kdl ON fv.id = kdl.vehicle_id
WHERE fv.status != 'retired';

-- ============================================================================
-- VIEW: v_fleet_check_compliance
-- Purpose: Driver check-in compliance rates
-- ============================================================================
CREATE OR REPLACE VIEW v_fleet_check_compliance AS
WITH driver_assignments AS (
    SELECT
        va.staff_id,
        va.fleet_vehicle_id as vehicle_id,
        fv.registration,
        va.assigned_date,
        va.returned_date,
        -- Days assigned (if still active, count to today)
        GREATEST(
            EXTRACT(DAY FROM (COALESCE(va.returned_date, CURRENT_DATE) - va.assigned_date::date))::INTEGER,
            0
        ) as days_assigned
    FROM vehicle_assignments va
    JOIN fleet_vehicles fv ON va.fleet_vehicle_id = fv.id
    WHERE va.fleet_vehicle_id IS NOT NULL
),
check_counts AS (
    SELECT
        driver_id as staff_id,
        vehicle_id,
        COUNT(*) as total_checks,
        COUNT(*) FILTER (WHERE check_date >= CURRENT_DATE - INTERVAL '30 days') as checks_30d,
        COUNT(*) FILTER (WHERE check_date >= CURRENT_DATE - INTERVAL '7 days') as checks_7d,
        COUNT(*) FILTER (WHERE has_critical_issues = true) as critical_issues,
        COUNT(*) FILTER (WHERE has_minor_issues = true) as minor_issues,
        COUNT(*) FILTER (WHERE status = 'approved') as approved_checks,
        COUNT(*) FILTER (WHERE status = 'rejected') as rejected_checks,
        MAX(check_date) as last_check_date
    FROM fleet_check_records
    GROUP BY driver_id, vehicle_id
)
SELECT
    da.staff_id,
    s.name as driver_name,
    s.phone as driver_phone,
    s.email as driver_email,
    da.vehicle_id,
    da.registration,
    da.days_assigned,
    da.assigned_date,
    da.returned_date,
    COALESCE(cc.total_checks, 0) as total_checks,
    COALESCE(cc.checks_30d, 0) as checks_30d,
    COALESCE(cc.checks_7d, 0) as checks_7d,
    COALESCE(cc.critical_issues, 0) as critical_issues,
    COALESCE(cc.minor_issues, 0) as minor_issues,
    COALESCE(cc.approved_checks, 0) as approved_checks,
    COALESCE(cc.rejected_checks, 0) as rejected_checks,
    cc.last_check_date,
    -- Compliance rate (expected = days_assigned for daily checks)
    CASE WHEN da.days_assigned > 0 THEN
        LEAST((COALESCE(cc.total_checks, 0)::numeric / da.days_assigned * 100), 100)
    ELSE 100 END as compliance_rate,
    -- Days since last check
    CASE WHEN cc.last_check_date IS NOT NULL THEN
        EXTRACT(DAY FROM (CURRENT_DATE - cc.last_check_date))::INTEGER
    ELSE da.days_assigned END as days_since_last_check
FROM driver_assignments da
JOIN staff s ON da.staff_id = s.id
LEFT JOIN check_counts cc ON da.staff_id = cc.staff_id AND da.vehicle_id = cc.vehicle_id;

-- ============================================================================
-- VIEW: v_fleet_upcoming_services
-- Purpose: Services due within next 90 days or 5000 km
-- ============================================================================
CREATE OR REPLACE VIEW v_fleet_upcoming_services AS
WITH current_odometer AS (
    SELECT DISTINCT ON (vehicle_id)
        vehicle_id,
        reading as current_km
    FROM fleet_odometer_history
    ORDER BY vehicle_id, recorded_at DESC
)
SELECT
    si.id as interval_id,
    si.vehicle_id,
    fv.registration,
    fv.make,
    fv.model,
    si.service_type,
    si.interval_km,
    si.interval_months,
    si.last_service_km,
    si.last_service_date,
    si.next_service_km,
    si.next_service_date,
    si.estimated_cost,
    si.provider_name,
    co.current_km,
    -- Calculate urgency
    CASE
        WHEN si.next_service_date IS NOT NULL AND si.next_service_date < CURRENT_DATE THEN 'overdue'
        WHEN co.current_km IS NOT NULL AND si.next_service_km IS NOT NULL AND co.current_km > si.next_service_km THEN 'overdue'
        WHEN si.next_service_date IS NOT NULL AND si.next_service_date <= CURRENT_DATE + INTERVAL '7 days' THEN 'critical'
        WHEN co.current_km IS NOT NULL AND si.next_service_km IS NOT NULL AND co.current_km >= si.next_service_km - 500 THEN 'critical'
        WHEN si.next_service_date IS NOT NULL AND si.next_service_date <= CURRENT_DATE + INTERVAL '30 days' THEN 'warning'
        WHEN co.current_km IS NOT NULL AND si.next_service_km IS NOT NULL AND co.current_km >= si.next_service_km - 2000 THEN 'warning'
        ELSE 'ok'
    END as urgency,
    -- Days until due
    CASE WHEN si.next_service_date IS NOT NULL THEN
        EXTRACT(DAY FROM (si.next_service_date - CURRENT_DATE))::INTEGER
    ELSE NULL END as days_until_due,
    -- KM until due
    CASE WHEN si.next_service_km IS NOT NULL AND co.current_km IS NOT NULL THEN
        si.next_service_km - co.current_km
    ELSE NULL END as km_until_due
FROM fleet_service_intervals si
JOIN fleet_vehicles fv ON si.vehicle_id = fv.id
LEFT JOIN current_odometer co ON si.vehicle_id = co.vehicle_id
WHERE si.is_active = true
  AND fv.status = 'active'
ORDER BY
    CASE
        WHEN si.next_service_date IS NOT NULL AND si.next_service_date < CURRENT_DATE THEN 0
        WHEN co.current_km IS NOT NULL AND si.next_service_km IS NOT NULL AND co.current_km > si.next_service_km THEN 0
        ELSE 1
    END,
    si.next_service_date NULLS LAST,
    si.next_service_km NULLS LAST;

-- ============================================================================
-- VIEW: v_fleet_driver_leaderboard
-- Purpose: Driver rankings by composite score
-- ============================================================================
CREATE OR REPLACE VIEW v_fleet_driver_leaderboard AS
SELECT
    ds.staff_id,
    s.name as driver_name,
    s.phone,
    s.email,
    ds.score_date,
    ds.score_type,
    ds.check_in_compliance,
    ds.fuel_efficiency_score,
    ds.authorization_compliance,
    ds.vehicle_care_score,
    ds.composite_score,
    ds.total_check_ins,
    ds.expected_check_ins,
    ds.total_trips,
    ds.unauthorized_trips,
    ds.avg_litres_per_100km,
    ds.fleet_avg_litres_per_100km,
    RANK() OVER (PARTITION BY ds.score_type ORDER BY ds.composite_score DESC) as rank
FROM fleet_driver_scores ds
JOIN staff s ON ds.staff_id = s.id
WHERE ds.score_date = (
    SELECT MAX(score_date)
    FROM fleet_driver_scores
    WHERE score_type = ds.score_type
);

-- ============================================================================
-- Triggers for updated_at
-- ============================================================================
CREATE OR REPLACE FUNCTION update_fleet_analytics_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_fleet_service_intervals_updated_at ON fleet_service_intervals;
CREATE TRIGGER trigger_fleet_service_intervals_updated_at
    BEFORE UPDATE ON fleet_service_intervals
    FOR EACH ROW
    EXECUTE FUNCTION update_fleet_analytics_updated_at();

-- ============================================================================
-- Grant permissions (if needed)
-- ============================================================================
-- GRANT SELECT, INSERT, UPDATE, DELETE ON fleet_service_intervals TO neondb_owner;
-- GRANT SELECT, INSERT, UPDATE, DELETE ON fleet_service_history TO neondb_owner;
-- GRANT SELECT, INSERT, UPDATE, DELETE ON fleet_driver_scores TO neondb_owner;
-- GRANT SELECT, INSERT, UPDATE, DELETE ON fleet_analytics_snapshots TO neondb_owner;
-- GRANT SELECT, INSERT, UPDATE, DELETE ON fleet_fuel_anomalies TO neondb_owner;
