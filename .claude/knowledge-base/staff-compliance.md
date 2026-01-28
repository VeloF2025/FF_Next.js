# Staff Compliance System

> Reference for the staff document compliance tracking system.

---

## Overview

Staff compliance tracks whether employees/contractors have uploaded and verified required documents.

**Two Compliance Views:**

| View | URL | API | Purpose |
|------|-----|-----|---------|
| Overview | `/staff/compliance` | `/api/staff/alerts?type=compliance` | All staff, stats, missing docs list |
| Individual | `/staff/[id]` (Compliance tab) | `/api/staff/[staffId]/compliance` | Single staff member's document status |

---

## Required Documents

As of 2026-01-28, these documents are **required** for compliance:

| Document Type | DB Value | Label (Employee) | Label (Contractor) |
|---------------|----------|------------------|-------------------|
| SA ID / Passport | `sa_id`, `passport` | ID Document / Passport | ID Document / Passport |
| Contract | `employment_contract` | **Employment Contract** | **IC Agreement** |
| Bank Confirmation | `bank_details`, `bank_statement` | Bank Confirmation Letter | Bank Confirmation Letter |

**Optional documents (dynamic labels):**
| Document Type | DB Value | Label (Employee) | Label (Contractor) |
|---------------|----------|------------------|-------------------|
| Tax Document | `tax_document` | Tax Document (IRP5) | Tax Document (IT3a) |
| Police Clearance | `police_clearance` | Police Clearance | Police Clearance |
| Driver's License | `drivers_license` | Driver's License | Driver's License |
| Medical Certificate | `medical_certificate` | Medical Certificate | Medical Certificate |

**Note:** Labels change dynamically based on staff's `contract_type` field.

---

## API Reference

### GET /api/staff/alerts?type=compliance

Returns compliance statistics for all active staff.

**Response:**
```typescript
interface ComplianceStats {
  totalStaff: number;
  withVerifiedId: number;
  withVerifiedPassport: number;
  withVerifiedLicense: number;
  withVerifiedBankDetails: number;
  withVerifiedContract: number;    // Added 2026-01-28
  withDob: number;
  missingDocuments: Array<{
    staffId: string;
    staffName: string;
    missingTypes: string[];        // e.g., ["SA ID", "Contract (Employment/IC)"]
  }>;
  compliancePercentage: number;    // Based on 3 required items
}
```

**Compliance Percentage Formula:**
```
(withVerifiedId + withVerifiedBank + withVerifiedContract) / (totalStaff * 3) * 100
```

### GET /api/staff/[staffId]/compliance

Returns document status for a single staff member with **dynamic labels** based on contract type.

**Response:**
```typescript
interface ComplianceStatus {
  isCompliant: boolean;
  requiredComplete: number;
  requiredTotal: number;
  optionalComplete: number;
  optionalTotal: number;
  documents: DocumentStatus[];
  contractType: SAContractType | null;  // Added 2026-01-28
  isEmployee: boolean;                   // Added 2026-01-28
}

interface DocumentStatus {
  type: string;
  label: string;
  required: boolean;
  uploaded: boolean;
  verified: boolean;
  pending: boolean;
  rejected: boolean;
  expired: boolean;
  documentId?: string;
  documentNumber?: string;
  expiryDate?: string;
  verifiedAt?: string;
}
```

---

## Database Schema

**Table: `staff_documents`**
```sql
id UUID PRIMARY KEY
staff_id UUID REFERENCES staff(id)
document_type VARCHAR(50)     -- 'sa_id', 'employment_contract', etc.
document_name VARCHAR(255)
file_url TEXT
verification_status VARCHAR(20)  -- 'pending', 'verified', 'rejected'
verified_at TIMESTAMP
verified_by UUID
expiry_date DATE
document_number VARCHAR(100)
created_at TIMESTAMP
updated_at TIMESTAMP
```

---

## Contract Type Handling

The compliance API dynamically determines labels based on staff's `contract_type` field.

### SAContractType Enum

```typescript
enum SAContractType {
  PERMANENT = 'permanent',           // Employee
  FIXED_TERM = 'fixed_term',         // Employee
  PART_TIME = 'part_time',           // Employee
  TEMPORARY = 'temporary',           // Employee
  INDEPENDENT_CONTRACTOR = 'independent_contractor',  // NOT Employee
  INTERN = 'intern',                 // Employee
}
```

### Legacy Value Mapping

Database may contain legacy values. `mapLegacyContractType()` handles conversion:

| DB Value | Maps To | isEmployee |
|----------|---------|------------|
| `permanent` | PERMANENT | ✅ true |
| `full-time` | PERMANENT | ✅ true |
| `fulltime` | PERMANENT | ✅ true |
| `fixed-term` | FIXED_TERM | ✅ true |
| `fixed_term` | FIXED_TERM | ✅ true |
| `contract` | FIXED_TERM | ✅ true |
| `part_time` | PART_TIME | ✅ true |
| `temporary` | TEMPORARY | ✅ true |
| `independent_contractor` | INDEPENDENT_CONTRACTOR | ❌ false |
| `freelance` | INDEPENDENT_CONTRACTOR | ❌ false |
| `consultant` | INDEPENDENT_CONTRACTOR | ❌ false |
| `intern` | INTERN | ✅ true |

**Location:** `src/types/staff/compliance.types.ts`

---

## Common Issues

### Document Not Showing as Required

**Symptom:** Required document not appearing in missing documents list.

**Checklist:**
1. Check `/api/staff/alerts.ts` - Is document type in the query?
2. Check `/api/staff/[staffId]/compliance.ts` - Is it in `getRequiredDocuments()` array?
3. Check document_type value matches exactly (case-sensitive)

### Wrong Label Showing (Employee vs IC)

**Symptom:** Shows "Employment Contract" for independent contractor or "IC Agreement" for employee.

**Checklist:**
1. Check staff's `contract_type` in database
2. Verify `mapLegacyContractType()` handles the DB value
3. Check `SA_CONTRACT_CONFIG[contractType].isEmployee` returns correct value

### Contract Type Dropdown Not Persisting

**Symptom:** Staff edit form contract type dropdown shows wrong value or resets.

**Fix:** Ensure `StaffEditForm` maps `contract_type` to `saContractType` on initialization:
```typescript
saContractType: existingStaff?.contract_type
  ? mapLegacyContractType(existingStaff.contract_type)
  : SAContractType.PERMANENT
```

### Employee vs IC Agreement

Both use `document_type = 'employment_contract'`. The label changes dynamically:
- **Employees** (isEmployee=true): Shows "Employment Contract"
- **Contractors** (isEmployee=false): Shows "IC Agreement"

---

## Related Files

| File | Purpose |
|------|---------|
| `pages/api/staff/alerts.ts` | Overview compliance stats API |
| `pages/api/staff/[staffId]/compliance.ts` | Individual compliance API (dynamic labels) |
| `pages/staff/compliance.tsx` | Compliance overview page |
| `src/modules/staff/components/tabs/ComplianceTab.tsx` | Individual compliance UI |
| `src/modules/staff/components/StaffEditForm.tsx` | Staff edit form (contract type dropdown) |
| `src/types/staff/compliance.types.ts` | SAContractType enum, mapLegacyContractType() |
| `src/types/staff-document.types.ts` | Document type definitions |

---

## Changelog

- **2026-01-28:** Dynamic compliance labels based on Employee vs IC (commits `d8d0ded5`, `b51e34d7`)
  - API now returns `contractType` and `isEmployee` fields
  - Labels change: "Employment Contract" vs "IC Agreement", "Tax Document (IRP5)" vs "Tax Document (IT3a)"
  - Added legacy contract type mappings: `full-time`, `fulltime`, `fixed-term`
  - Fixed StaffEditForm to map existing contract_type on load
- **2026-01-28:** Added `employment_contract` tracking to overview compliance stats (commit `ada54839`)
