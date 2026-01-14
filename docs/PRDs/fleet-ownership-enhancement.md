# Fleet Vehicle Ownership Enhancement

## Overview
Extend the fleet vehicle system to capture comprehensive ownership details including:
- NATIS registration documents
- License disc tracking with renewal reminders
- Finance details (for financed vehicles)
- Lease/Rental company details (for leased/rented vehicles)
- Insurance policies
- Document storage

---

## Ownership Types & Required Data

### 1. Company Owned
| Data | Fields |
|------|--------|
| **NATIS Document** | Registration number, issue date, document upload |
| **License Disc** | License number, issue date, expiry date, cost, document, renewal tracking |
| **Finance** (if applicable) | Finance company, account number, amount, monthly payment, interest rate, term, remaining balance, contact details |
| **Insurance** | See Insurance section below |

### 2. Leased
| Data | Fields |
|------|--------|
| **Lease Company** | Company name, address, contract number |
| **Lease Terms** | Monthly cost, start date, end date, km limit, excess km rate, deposit |
| **Contact** | Contact name, phone, email |
| **Documents** | Lease agreement upload |

### 3. Rental
| Data | Fields |
|------|--------|
| **Rental Company** | Company name, address, contract/booking number |
| **Rental Terms** | Daily/monthly cost, start date, end date, km limit, excess km rate |
| **Contact** | Contact name, phone, email |
| **Documents** | Rental agreement upload |

### 4. Insurance (All ownership types)
| Data | Fields |
|------|--------|
| **Policy** | Company, policy number, type (comprehensive/third-party), cover amount, excess |
| **Premium** | Monthly premium, start date, expiry date |
| **Contact** | Insurer contact, broker name, broker phone |
| **Documents** | Policy document upload |

---

## Database Schema

### Migration: `scripts/migrations/040_fleet_ownership.sql`

```sql
-- =============================================================================
-- Fleet Vehicle Ownership Enhancement
-- =============================================================================

-- 1. Vehicle Documents (NATIS, lease agreements, etc.)
CREATE TABLE fleet_vehicle_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id UUID NOT NULL REFERENCES fleet_vehicles(id) ON DELETE CASCADE,
    document_type VARCHAR(50) NOT NULL,
    -- Types: natis, license_disc, finance_agreement, lease_contract,
    --        rental_agreement, insurance_policy, service_record, other
    document_name VARCHAR(255) NOT NULL,
    file_url TEXT,
    file_size INTEGER,
    mime_type VARCHAR(100),
    expiry_date DATE,
    issue_date DATE,
    reference_number VARCHAR(100),
    notes TEXT,
    uploaded_by UUID REFERENCES staff(id),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. License Disc Tracking (dedicated table for renewal tracking)
CREATE TABLE fleet_license_disc (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id UUID NOT NULL REFERENCES fleet_vehicles(id) ON DELETE CASCADE,
    license_number VARCHAR(50),
    issue_date DATE,
    expiry_date DATE NOT NULL,
    cost NUMERIC(10,2),
    document_url TEXT,
    -- Renewal tracking
    renewal_reminder_days INTEGER DEFAULT 30,
    reminder_sent_at TIMESTAMPTZ,
    renewed_at TIMESTAMPTZ,
    -- Audit
    created_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID REFERENCES staff(id)
);

-- 3. Finance Details (for company-owned financed vehicles)
CREATE TABLE fleet_vehicle_finance (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id UUID NOT NULL UNIQUE REFERENCES fleet_vehicles(id) ON DELETE CASCADE,
    -- Finance Company
    finance_company VARCHAR(255) NOT NULL,
    account_number VARCHAR(100),
    -- Amounts
    finance_amount NUMERIC(12,2),
    monthly_payment NUMERIC(10,2),
    interest_rate NUMERIC(5,2),
    balloon_payment NUMERIC(12,2),
    -- Term
    start_date DATE,
    end_date DATE,
    term_months INTEGER,
    -- Current Status
    remaining_balance NUMERIC(12,2),
    payments_made INTEGER DEFAULT 0,
    -- Contact
    contact_name VARCHAR(100),
    contact_phone VARCHAR(50),
    contact_email VARCHAR(255),
    -- Notes
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Lease/Rental Details
CREATE TABLE fleet_vehicle_lease (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id UUID NOT NULL UNIQUE REFERENCES fleet_vehicles(id) ON DELETE CASCADE,
    -- Type: lease or rental
    lease_type VARCHAR(20) NOT NULL CHECK (lease_type IN ('lease', 'rental')),
    -- Company
    company_name VARCHAR(255) NOT NULL,
    company_address TEXT,
    company_phone VARCHAR(50),
    company_email VARCHAR(255),
    -- Contract
    contract_number VARCHAR(100),
    start_date DATE NOT NULL,
    end_date DATE,
    -- Cost
    monthly_cost NUMERIC(10,2),
    deposit_amount NUMERIC(10,2),
    -- Km Limits
    km_limit_monthly INTEGER,
    km_limit_total INTEGER,
    excess_km_rate NUMERIC(10,2),
    current_km INTEGER,
    -- Contact Person
    contact_name VARCHAR(100),
    contact_phone VARCHAR(50),
    contact_email VARCHAR(255),
    -- Notes
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Insurance Policies
CREATE TABLE fleet_vehicle_insurance (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id UUID NOT NULL REFERENCES fleet_vehicles(id) ON DELETE CASCADE,
    -- Insurance Company
    insurance_company VARCHAR(255) NOT NULL,
    policy_number VARCHAR(100),
    policy_type VARCHAR(50), -- comprehensive, third_party, fire_theft
    -- Cover Details
    cover_amount NUMERIC(12,2),
    excess_amount NUMERIC(10,2),
    premium_monthly NUMERIC(10,2),
    -- Term
    start_date DATE,
    expiry_date DATE NOT NULL,
    -- Contacts
    insurer_contact_name VARCHAR(100),
    insurer_contact_phone VARCHAR(50),
    broker_name VARCHAR(100),
    broker_phone VARCHAR(50),
    broker_email VARCHAR(255),
    -- Document
    document_url TEXT,
    -- Status
    is_active BOOLEAN DEFAULT true,
    -- Renewal tracking
    renewal_reminder_days INTEGER DEFAULT 30,
    reminder_sent_at TIMESTAMPTZ,
    -- Notes
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_fleet_docs_vehicle ON fleet_vehicle_documents(vehicle_id);
CREATE INDEX idx_fleet_docs_type ON fleet_vehicle_documents(document_type);
CREATE INDEX idx_fleet_license_expiry ON fleet_license_disc(expiry_date);
CREATE INDEX idx_fleet_insurance_expiry ON fleet_vehicle_insurance(expiry_date);
CREATE INDEX idx_fleet_lease_end ON fleet_vehicle_lease(end_date);

-- Add is_financed flag to fleet_vehicles
ALTER TABLE fleet_vehicles ADD COLUMN IF NOT EXISTS is_financed BOOLEAN DEFAULT false;
```

---

## UI Layout

### Vehicle Detail Page - Tabbed Interface

```
[Overview] [Ownership] [Documents] [Insurance] [GPS History]
```

#### Tab 1: Overview (Current layout)
- Vehicle Details card (registration, make, model, year, color, VIN, status)
- Current Assignment card
- Quick Actions card
- Cost Rates card
- Notes card

#### Tab 2: Ownership (NEW)
**If Company Owned:**
- NATIS Registration card
  - Registration number, issue date
  - Document preview/download
- Finance Details card (if is_financed = true)
  - Finance company, account number
  - Amount, monthly payment, interest rate
  - Term, remaining balance
  - Contact details

**If Leased/Rental:**
- Lease/Rental Company card
  - Company name, address, contract number
  - Contact person details
- Contract Terms card
  - Start/end dates, monthly cost
  - Km limits, excess rate
  - Deposit amount

#### Tab 3: Documents (NEW)
- License Disc card (with renewal status indicator)
  - Current license, expiry date, days until renewal
  - Upload new license
  - History of previous licenses
- Documents list
  - NATIS document
  - Finance/Lease agreements
  - Service records
  - Other documents

#### Tab 4: Insurance (NEW)
- Active Policy card
  - Company, policy number, type
  - Cover amount, excess, premium
  - Expiry date with renewal indicator
  - Broker details
- Policy History

#### Tab 5: GPS History (Move from sidebar)
- Recent investigations list
- Link to full GPS Investigation page

---

## Renewal Reminders

### License Disc
- Warning at 30 days before expiry
- Critical at 7 days before expiry
- Overdue indicator after expiry

### Insurance
- Warning at 30 days before expiry
- Critical at 7 days before expiry
- Overdue indicator after expiry

### Dashboard Alerts
Add to Fleet Dashboard:
- "Expiring Soon" section showing:
  - License discs expiring within 30 days
  - Insurance policies expiring within 30 days
  - Lease contracts ending within 30 days

---

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/fleet/vehicles/[id]/documents` | GET, POST | List/upload documents |
| `/api/fleet/vehicles/[id]/documents/[docId]` | GET, PUT, DELETE | Document CRUD |
| `/api/fleet/vehicles/[id]/license-disc` | GET, POST | License disc history |
| `/api/fleet/vehicles/[id]/finance` | GET, PUT | Finance details |
| `/api/fleet/vehicles/[id]/lease` | GET, PUT | Lease/rental details |
| `/api/fleet/vehicles/[id]/insurance` | GET, POST | Insurance policies |
| `/api/fleet/vehicles/[id]/insurance/[policyId]` | GET, PUT, DELETE | Policy CRUD |
| `/api/fleet/expiring` | GET | All expiring items (license, insurance, leases) |

---

## Files to Create/Modify

### Database
- `scripts/migrations/040_fleet_ownership.sql` (NEW)

### Types
- `src/modules/fleet/types/ownership.types.ts` (NEW)

### Services
- `src/modules/fleet/services/documentService.ts` (NEW)
- `src/modules/fleet/services/financeService.ts` (NEW)
- `src/modules/fleet/services/leaseService.ts` (NEW)
- `src/modules/fleet/services/insuranceService.ts` (NEW)

### API Routes
- `pages/api/fleet/vehicles/[id]/documents.ts` (NEW)
- `pages/api/fleet/vehicles/[id]/license-disc.ts` (NEW)
- `pages/api/fleet/vehicles/[id]/finance.ts` (NEW)
- `pages/api/fleet/vehicles/[id]/lease.ts` (NEW)
- `pages/api/fleet/vehicles/[id]/insurance.ts` (NEW)
- `pages/api/fleet/expiring.ts` (NEW)

### Components
- `src/modules/fleet/components/VehicleTabs.tsx` (NEW)
- `src/modules/fleet/components/OwnershipTab.tsx` (NEW)
- `src/modules/fleet/components/DocumentsTab.tsx` (NEW)
- `src/modules/fleet/components/InsuranceTab.tsx` (NEW)
- `src/modules/fleet/components/LicenseDiscCard.tsx` (NEW)
- `src/modules/fleet/components/FinanceCard.tsx` (NEW)
- `src/modules/fleet/components/LeaseCard.tsx` (NEW)

### Pages
- `pages/fleet/vehicles/[id].tsx` (MODIFY - add tabs)

---

## Implementation Order

1. Database migration
2. TypeScript types
3. API endpoints (documents, license-disc, finance, lease, insurance)
4. Tabbed UI components
5. Form components for each section
6. Dashboard expiring items widget
7. Renewal reminder system (cron job or scheduled task)
