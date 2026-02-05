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

## Related Modules
- `contractor-documents-report.md` - Document compliance reporting
