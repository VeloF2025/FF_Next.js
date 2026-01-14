-- =============================================================================
-- Migration 040: Fleet Vehicle Ownership Enhancement
-- =============================================================================
-- Adds comprehensive ownership tracking for fleet vehicles:
-- - Vehicle documents (NATIS, agreements, service records)
-- - License disc tracking with renewal reminders
-- - Finance details (for financed company-owned vehicles)
-- - Lease/rental company details
-- - Insurance policies with expiry tracking
-- =============================================================================

-- 1. Vehicle Documents
-- Stores all vehicle-related documents (NATIS, agreements, service records, etc.)
CREATE TABLE IF NOT EXISTS fleet_vehicle_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id UUID NOT NULL REFERENCES fleet_vehicles(id) ON DELETE CASCADE,

    -- Document classification
    document_type VARCHAR(50) NOT NULL,
    -- Types: natis, license_disc, finance_agreement, lease_contract,
    --        rental_agreement, insurance_policy, service_record,
    --        roadworthy, other

    -- Document details
    document_name VARCHAR(255) NOT NULL,
    description TEXT,
    file_url TEXT,
    file_size INTEGER,
    mime_type VARCHAR(100),

    -- Dates
    issue_date DATE,
    expiry_date DATE,

    -- Reference
    reference_number VARCHAR(100), -- Policy number, license number, etc.

    -- Notes
    notes TEXT,

    -- Audit
    uploaded_by UUID REFERENCES staff(id),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. License Disc Tracking
-- Dedicated table for license disc history and renewal tracking
CREATE TABLE IF NOT EXISTS fleet_license_disc (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id UUID NOT NULL REFERENCES fleet_vehicles(id) ON DELETE CASCADE,

    -- License details
    license_number VARCHAR(50),
    province VARCHAR(50), -- GP, WC, KZN, etc.

    -- Dates
    issue_date DATE,
    expiry_date DATE NOT NULL,

    -- Cost
    cost NUMERIC(10,2),
    arrears NUMERIC(10,2) DEFAULT 0,
    penalties NUMERIC(10,2) DEFAULT 0,
    total_paid NUMERIC(10,2),

    -- Document
    document_url TEXT,

    -- Renewal tracking
    renewal_reminder_days INTEGER DEFAULT 30,
    reminder_sent_at TIMESTAMPTZ,
    renewed_at TIMESTAMPTZ,

    -- Status
    status VARCHAR(20) DEFAULT 'active', -- active, expired, renewed

    -- Audit
    created_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID REFERENCES staff(id)
);

-- 3. Finance Details
-- For company-owned vehicles that are financed
CREATE TABLE IF NOT EXISTS fleet_vehicle_finance (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id UUID NOT NULL UNIQUE REFERENCES fleet_vehicles(id) ON DELETE CASCADE,

    -- Finance Company
    finance_company VARCHAR(255) NOT NULL,
    finance_type VARCHAR(50), -- instalment_sale, lease_to_own, balloon_payment
    account_number VARCHAR(100),

    -- Principal
    vehicle_price NUMERIC(12,2),
    deposit_paid NUMERIC(12,2),
    finance_amount NUMERIC(12,2), -- Amount financed after deposit

    -- Terms
    interest_rate NUMERIC(5,2), -- Annual percentage
    term_months INTEGER,
    monthly_payment NUMERIC(10,2),
    balloon_payment NUMERIC(12,2), -- Final balloon/residual payment

    -- Dates
    start_date DATE,
    end_date DATE,
    first_payment_date DATE,

    -- Current Status
    remaining_balance NUMERIC(12,2),
    payments_made INTEGER DEFAULT 0,
    next_payment_date DATE,

    -- Contact
    contact_name VARCHAR(100),
    contact_phone VARCHAR(50),
    contact_email VARCHAR(255),
    branch VARCHAR(100),

    -- Settlement
    settlement_amount NUMERIC(12,2),
    settlement_valid_until DATE,

    -- Notes
    notes TEXT,

    -- Audit
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Lease/Rental Details
-- For leased or rented vehicles
CREATE TABLE IF NOT EXISTS fleet_vehicle_lease (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id UUID NOT NULL UNIQUE REFERENCES fleet_vehicles(id) ON DELETE CASCADE,

    -- Type
    lease_type VARCHAR(20) NOT NULL CHECK (lease_type IN ('lease', 'rental', 'operating_lease', 'finance_lease')),

    -- Company Details
    company_name VARCHAR(255) NOT NULL,
    company_registration VARCHAR(50),
    company_vat VARCHAR(50),
    company_address TEXT,
    company_phone VARCHAR(50),
    company_email VARCHAR(255),
    company_website VARCHAR(255),

    -- Contract
    contract_number VARCHAR(100),
    quote_number VARCHAR(100),

    -- Dates
    start_date DATE NOT NULL,
    end_date DATE,
    contract_duration_months INTEGER,

    -- Cost
    monthly_cost NUMERIC(10,2),
    deposit_amount NUMERIC(10,2),
    deposit_refundable BOOLEAN DEFAULT true,

    -- Km Limits (common for SA vehicle leases)
    km_limit_monthly INTEGER,
    km_limit_total INTEGER,
    excess_km_rate NUMERIC(10,2),
    current_km INTEGER,
    km_last_updated DATE,

    -- Inclusions
    includes_maintenance BOOLEAN DEFAULT false,
    includes_tyres BOOLEAN DEFAULT false,
    includes_fuel_card BOOLEAN DEFAULT false,
    includes_tracking BOOLEAN DEFAULT false,
    includes_insurance BOOLEAN DEFAULT false,

    -- Contact Person
    account_manager VARCHAR(100),
    account_manager_phone VARCHAR(50),
    account_manager_email VARCHAR(255),

    -- Alternate Contact
    alternate_contact_name VARCHAR(100),
    alternate_contact_phone VARCHAR(50),

    -- Return Conditions
    return_conditions TEXT,
    early_termination_fee NUMERIC(10,2),

    -- Notes
    notes TEXT,

    -- Audit
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Insurance Policies
-- Vehicle insurance tracking with multiple policy support
CREATE TABLE IF NOT EXISTS fleet_vehicle_insurance (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id UUID NOT NULL REFERENCES fleet_vehicles(id) ON DELETE CASCADE,

    -- Insurance Company
    insurance_company VARCHAR(255) NOT NULL,
    policy_number VARCHAR(100) NOT NULL,

    -- Policy Type
    policy_type VARCHAR(50), -- comprehensive, third_party, third_party_fire_theft

    -- Cover Details
    cover_amount NUMERIC(12,2), -- Insured value
    excess_amount NUMERIC(10,2), -- Standard excess
    excess_theft NUMERIC(10,2), -- Theft excess (often higher)
    excess_third_party NUMERIC(10,2),

    -- Premium
    premium_monthly NUMERIC(10,2),
    premium_annual NUMERIC(10,2),
    payment_method VARCHAR(50), -- debit_order, manual, included_in_lease

    -- Term
    start_date DATE,
    expiry_date DATE NOT NULL,

    -- Insurer Contact
    insurer_contact_name VARCHAR(100),
    insurer_contact_phone VARCHAR(50),
    insurer_claims_phone VARCHAR(50),
    insurer_email VARCHAR(255),

    -- Broker Details
    broker_name VARCHAR(100),
    broker_company VARCHAR(255),
    broker_phone VARCHAR(50),
    broker_email VARCHAR(255),

    -- Emergency
    roadside_assistance_number VARCHAR(50),
    towing_included BOOLEAN DEFAULT false,
    car_hire_included BOOLEAN DEFAULT false,

    -- Document
    document_url TEXT,
    schedule_url TEXT, -- Policy schedule document

    -- Status
    is_active BOOLEAN DEFAULT true,

    -- Renewal tracking
    renewal_reminder_days INTEGER DEFAULT 30,
    reminder_sent_at TIMESTAMPTZ,

    -- Claims (summary - detailed claims could be separate table)
    claims_count INTEGER DEFAULT 0,
    last_claim_date DATE,

    -- Notes
    notes TEXT,

    -- Audit
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. Add is_financed flag to fleet_vehicles if not exists
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'fleet_vehicles' AND column_name = 'is_financed'
    ) THEN
        ALTER TABLE fleet_vehicles ADD COLUMN is_financed BOOLEAN DEFAULT false;
    END IF;
END $$;

-- 7. Add NATIS registration number to fleet_vehicles if not exists
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'fleet_vehicles' AND column_name = 'natis_number'
    ) THEN
        ALTER TABLE fleet_vehicles ADD COLUMN natis_number VARCHAR(50);
    END IF;
END $$;

-- 8. Add engine/chassis numbers to fleet_vehicles if not exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'fleet_vehicles' AND column_name = 'engine_number'
    ) THEN
        ALTER TABLE fleet_vehicles ADD COLUMN engine_number VARCHAR(50);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'fleet_vehicles' AND column_name = 'chassis_number'
    ) THEN
        ALTER TABLE fleet_vehicles ADD COLUMN chassis_number VARCHAR(50);
    END IF;
END $$;

-- =============================================================================
-- Indexes
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_fleet_docs_vehicle ON fleet_vehicle_documents(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_fleet_docs_type ON fleet_vehicle_documents(document_type);
CREATE INDEX IF NOT EXISTS idx_fleet_docs_expiry ON fleet_vehicle_documents(expiry_date) WHERE expiry_date IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_fleet_license_vehicle ON fleet_license_disc(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_fleet_license_expiry ON fleet_license_disc(expiry_date);
CREATE INDEX IF NOT EXISTS idx_fleet_license_status ON fleet_license_disc(status);

CREATE INDEX IF NOT EXISTS idx_fleet_finance_vehicle ON fleet_vehicle_finance(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_fleet_finance_end ON fleet_vehicle_finance(end_date);

CREATE INDEX IF NOT EXISTS idx_fleet_lease_vehicle ON fleet_vehicle_lease(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_fleet_lease_end ON fleet_vehicle_lease(end_date);
CREATE INDEX IF NOT EXISTS idx_fleet_lease_type ON fleet_vehicle_lease(lease_type);

CREATE INDEX IF NOT EXISTS idx_fleet_insurance_vehicle ON fleet_vehicle_insurance(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_fleet_insurance_expiry ON fleet_vehicle_insurance(expiry_date);
CREATE INDEX IF NOT EXISTS idx_fleet_insurance_active ON fleet_vehicle_insurance(is_active) WHERE is_active = true;

-- =============================================================================
-- Views for expiring items (useful for dashboard)
-- =============================================================================

CREATE OR REPLACE VIEW fleet_expiring_items AS
SELECT
    'license_disc' as item_type,
    ld.id as item_id,
    fv.id as vehicle_id,
    fv.registration,
    fv.make || ' ' || fv.model as vehicle_name,
    'License Disc' as item_name,
    ld.expiry_date,
    ld.expiry_date - CURRENT_DATE as days_until_expiry,
    CASE
        WHEN ld.expiry_date < CURRENT_DATE THEN 'overdue'
        WHEN ld.expiry_date - CURRENT_DATE <= 7 THEN 'critical'
        WHEN ld.expiry_date - CURRENT_DATE <= 30 THEN 'warning'
        ELSE 'ok'
    END as urgency
FROM fleet_license_disc ld
JOIN fleet_vehicles fv ON ld.vehicle_id = fv.id
WHERE ld.status = 'active'
  AND ld.expiry_date <= CURRENT_DATE + INTERVAL '60 days'

UNION ALL

SELECT
    'insurance' as item_type,
    fi.id as item_id,
    fv.id as vehicle_id,
    fv.registration,
    fv.make || ' ' || fv.model as vehicle_name,
    fi.insurance_company || ' Policy' as item_name,
    fi.expiry_date,
    fi.expiry_date - CURRENT_DATE as days_until_expiry,
    CASE
        WHEN fi.expiry_date < CURRENT_DATE THEN 'overdue'
        WHEN fi.expiry_date - CURRENT_DATE <= 7 THEN 'critical'
        WHEN fi.expiry_date - CURRENT_DATE <= 30 THEN 'warning'
        ELSE 'ok'
    END as urgency
FROM fleet_vehicle_insurance fi
JOIN fleet_vehicles fv ON fi.vehicle_id = fv.id
WHERE fi.is_active = true
  AND fi.expiry_date <= CURRENT_DATE + INTERVAL '60 days'

UNION ALL

SELECT
    'lease' as item_type,
    fl.id as item_id,
    fv.id as vehicle_id,
    fv.registration,
    fv.make || ' ' || fv.model as vehicle_name,
    fl.company_name || ' ' || fl.lease_type as item_name,
    fl.end_date as expiry_date,
    fl.end_date - CURRENT_DATE as days_until_expiry,
    CASE
        WHEN fl.end_date < CURRENT_DATE THEN 'overdue'
        WHEN fl.end_date - CURRENT_DATE <= 7 THEN 'critical'
        WHEN fl.end_date - CURRENT_DATE <= 30 THEN 'warning'
        ELSE 'ok'
    END as urgency
FROM fleet_vehicle_lease fl
JOIN fleet_vehicles fv ON fl.vehicle_id = fv.id
WHERE fl.end_date IS NOT NULL
  AND fl.end_date <= CURRENT_DATE + INTERVAL '60 days'

ORDER BY days_until_expiry ASC;

-- =============================================================================
-- Comments
-- =============================================================================

COMMENT ON TABLE fleet_vehicle_documents IS 'Stores all vehicle-related documents including NATIS, agreements, service records';
COMMENT ON TABLE fleet_license_disc IS 'License disc history and renewal tracking for vehicles';
COMMENT ON TABLE fleet_vehicle_finance IS 'Finance details for company-owned financed vehicles';
COMMENT ON TABLE fleet_vehicle_lease IS 'Lease and rental company details and contract terms';
COMMENT ON TABLE fleet_vehicle_insurance IS 'Insurance policies with broker and claims tracking';
COMMENT ON VIEW fleet_expiring_items IS 'Dashboard view showing all expiring items across license discs, insurance, and leases';
