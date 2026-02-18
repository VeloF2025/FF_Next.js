# Contractors Module

## Overview
| Property | Value |
|----------|-------|
| **Purpose** | Manage contractor relationships, onboarding, and compliance |
| **Status** | Production |
| **Category** | project-management |

## Key Features
- Contractor CRUD with company, contact, banking details
- Project assignments (many-to-many)
- Document management with verification
- Onboarding workflow with stages
- Compliance tracking

## Directory Structure
```
app/(main)/contractors/
├── page.tsx                    # List (force-dynamic)
├── new/page.tsx               # Create form
├── [id]/
│   ├── page.tsx               # Detail view (force-dynamic)
│   ├── edit/page.tsx          # Edit form (force-dynamic)
│   ├── onboarding/page.tsx    # Onboarding stages
│   └── documents-report/      # Document compliance report

src/components/contractors/
├── ContractorForm.tsx         # Create/Edit form
├── ContractorsList.tsx        # List with suspend/delete
├── ContractorDocuments.tsx    # Document management
└── ContractorProjects.tsx     # Project assignments

pages/api/
├── contractors-update.ts      # PUT - Update contractor
├── contractors-delete.ts      # DELETE - Permanent delete
├── contractors-projects.ts    # Project assignments
├── contractors-documents*.ts  # Document operations
└── contractors-onboarding*.ts # Onboarding operations
```

## API Endpoints

### CRUD Operations
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/contractors` | GET | List all contractors |
| `/api/contractors` | POST | Create contractor |
| `/api/contractors-update` | PUT | Update contractor (flat route) |
| `/api/contractors-delete` | DELETE | Permanent delete (flat route) |

**IMPORTANT**: Use flat endpoints (`-update`, `-delete`) instead of dynamic routes (`/[id]`) due to Vercel issues.

### Request Format
```typescript
// Update
PUT /api/contractors-update
{
  "id": "uuid",
  "companyName": "...",
  // ... other fields
}

// Delete
DELETE /api/contractors-delete
{
  "id": "uuid"
}
```

## Database Tables
| Table | Purpose |
|-------|---------|
| `contractors` | Main contractor records |
| `contractor_projects` | Many-to-many project assignments |
| `contractor_documents` | Uploaded documents |
| `contractor_onboarding_stages` | Onboarding progress |

## UI Actions

### Suspend vs Delete
| Action | Icon | Effect |
|--------|------|--------|
| Suspend | Yellow Ban | Sets `isActive=false`, `status='suspended'` |
| Delete | Red Trash | Permanent removal (double confirmation) |

### Delete Constraints
Delete fails if contractor has linked projects. Error message shows count.
To force delete: unlink projects first via database or UI.

## Caching Fix (2026-02-05)

All contractor pages MUST have these exports to prevent stale data:
```typescript
export const dynamic = 'force-dynamic';
export const revalidate = 0;
```

### Pages Fixed
- `app/(main)/contractors/page.tsx`
- `app/(main)/contractors/[id]/page.tsx`
- `app/(main)/contractors/[id]/edit/page.tsx`

## Form Defaults
- New contractors: `isActive = true`, `status = 'pending'`
- Business type: `'pty_ltd'`
- Compliance status: `'pending'`

## Onboarding Stages (Updated 2026-02-09)

6-stage workflow defined in `src/services/contractor/contractorOnboardingService.ts`:

| Stage | Name | Required Documents |
|-------|------|--------------------|
| 1 | Company Registration | `cipc_registration`, `directors_ids`, `tax_clearance` |
| 2 | Company Verification | (no docs - VerificationPanel) |
| 3 | Financial Documentation | `bank_confirmation`, `vat_certificate` |
| 4 | Insurance & Compliance | `insurance_liability`, `insurance_workers_comp`, `coid_registration`, `safety_certificate` |
| 5 | Technical Qualifications | `technical_certification`, `key_staff_credentials` |
| 6 | Final Review | `msa` (Master Build Agreement) |

**DB storage**: `contractor_onboarding_stages.required_documents` is **jsonb** array.

**Key rules**:
- `cipc_registration` IS the company registration (don't duplicate with `company_registration`)
- COID Registration (`coid_registration`) belongs in Insurance stage
- Master Build Agreement (`msa`) required at Final Review
- Directors' IDs tracked in Stage 1 (contractors upload multiple)
- Stage 2 uses `VerificationPanel` component (SearchWorks/CIPC checks), not documents

**Updating stages for existing contractors**: Use jsonb operators:
```sql
-- Add a doc: SET required_documents = required_documents || '"doc_type"'::jsonb
-- Remove a doc: SET required_documents = required_documents - 'doc_type'
-- Check contains: WHERE required_documents @> '"doc_type"'::jsonb
```

## Document Types

Defined in `src/types/contractor-document.types.ts`. Key labels:
- `msa` = "Master Build Agreement" (renamed from "Master Service Agreement" on 2026-02-09)
- `cipc_registration` = "CIPC Registration" (same as company registration)
- `coid_registration` = "COID Registration"
- `directors_ids` = "Directors' IDs"

Categories in `DOCUMENT_TYPE_CATEGORIES` for dropdown grouping.

## UI/UX (Updated 2026-02-09)

### Dark Theme
All contractor modals/forms use FF design system CSS variables:
- Modal overlay: `bg-black/60`
- Modal container: `bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)]`
- Inputs: `bg-[var(--ff-bg-primary)] border border-[var(--ff-border-light)] text-[var(--ff-text-primary)]`
- Error banners: `bg-red-500/10 border border-red-500/30 text-red-400`
- Cancel buttons: `bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] hover:bg-[var(--ff-bg-hover)]`

### Layout
- Detail/Edit pages: Full width with `p-6` (no `max-w-4xl`)
- Back buttons: `inline-flex items-center gap-2 text-sm text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] px-3 py-1.5 -ml-3 rounded-lg hover:bg-[var(--ff-bg-tertiary)] transition-colors`

## Recent Changes (Feb 2026)

### Agreement Generation Modal
- Generate contractor agreements with configurable dates (`ecf961dd`)
- Modal component for agreement parameters before PDF generation

### Company Verification System
- Added verification panel for onboarding Stage 2 (`b4e89f17`)
- SearchWorks/CIPC automated checks

### Security Hardening
- CSP headers, magic byte validation, logger replacement (`2d6c206c`)
- Cache revalidation + suspend/delete separation cleanup (`cdd6b164`)

## Related Modules
- `contractor-documents-report.md` - Document compliance reporting
