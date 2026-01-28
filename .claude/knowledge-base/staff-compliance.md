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

| Document Type | DB Value | Label | Notes |
|---------------|----------|-------|-------|
| SA ID / Passport | `sa_id`, `passport` | ID Document / Passport | Either satisfies requirement |
| Employment / IC Agreement | `employment_contract` | Employment / IC Agreement | Covers both employee contracts and IC agreements |
| Bank Confirmation | `bank_details`, `bank_statement` | Bank Confirmation Letter | Either satisfies requirement |

**Optional documents:** tax_document, police_clearance, drivers_license, medical_certificate

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

Returns document status for a single staff member.

**Response:**
```typescript
interface ComplianceStatus {
  isCompliant: boolean;
  requiredComplete: number;
  requiredTotal: number;
  optionalComplete: number;
  optionalTotal: number;
  documents: DocumentStatus[];
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

## Common Issues

### Document Not Showing as Required

**Symptom:** Required document not appearing in missing documents list.

**Checklist:**
1. Check `/api/staff/alerts.ts` - Is document type in the query?
2. Check `/api/staff/[staffId]/compliance.ts` - Is it in REQUIRED_DOCUMENTS array?
3. Check document_type value matches exactly (case-sensitive)

### Employee vs IC Agreement

Both use `document_type = 'employment_contract'`. The label "Employment / IC Agreement" clarifies this covers:
- Employment contracts (for employees)
- Independent Contractor agreements (for contractors)

---

## Related Files

| File | Purpose |
|------|---------|
| `pages/api/staff/alerts.ts` | Overview compliance stats API |
| `pages/api/staff/[staffId]/compliance.ts` | Individual compliance API |
| `pages/staff/compliance.tsx` | Compliance overview page |
| `src/modules/staff/components/tabs/ComplianceTab.tsx` | Individual compliance UI |
| `src/types/staff-document.types.ts` | Document type definitions |

---

## Changelog

- **2026-01-28:** Added `employment_contract` tracking to overview compliance stats (commit `ada54839`)
