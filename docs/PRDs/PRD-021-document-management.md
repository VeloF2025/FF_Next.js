# PRD-021: Staff Document Management System

## Overview
Complete document management system for staff with upload, verification, compliance tracking, and required document checklists.

## Problem Statement
1. No way to upload and store staff documents (ID, contracts, certifications)
2. No verification workflow for document approval
3. No tracking of document expiry dates
4. No visibility into compliance status (missing required documents)

## Goals
1. Allow document upload for staff members
2. Track document types, expiry dates, and verification status
3. Provide admin verification workflow
4. Show required documents checklist per employee type
5. Full dark mode support

## Requirements

### 1. Document Upload
- **Storage**: Local file storage on Velocity Server (`/var/www/fibreflow/uploads/staff-documents/{staffId}/`)
- **Max Size**: 10MB per file
- **Allowed Types**: PDF, images (jpg, png), Word (.doc, .docx), Excel (.xls, .xlsx)
- **Metadata**: Store filename, size, upload date, uploaded by

### 2. Document Types
```typescript
enum StaffDocumentType {
  // Identity
  ID_DOCUMENT = 'id_document',
  PASSPORT = 'passport',
  DRIVERS_LICENSE = 'drivers_license',

  // Employment
  EMPLOYMENT_CONTRACT = 'employment_contract',
  OFFER_LETTER = 'offer_letter',
  NDA = 'nda',

  // Certifications
  QUALIFICATION = 'qualification',
  CERTIFICATION = 'certification',
  TRAINING_CERTIFICATE = 'training_certificate',

  // Tax & Compliance
  TAX_DOCUMENT = 'tax_document',
  UIF_REGISTRATION = 'uif_registration',

  // Other
  MEDICAL_CERTIFICATE = 'medical_certificate',
  REFERENCE_LETTER = 'reference_letter',
  OTHER = 'other'
}
```

### 3. Document Status
```typescript
enum DocumentStatus {
  PENDING = 'pending',       // Uploaded, awaiting verification
  VERIFIED = 'verified',     // Approved by admin
  REJECTED = 'rejected',     // Rejected with reason
  EXPIRED = 'expired'        // Past expiry date
}
```

### 4. Verification Panel
Admin can:
- View uploaded documents
- Verify (approve) documents
- Reject documents with reason/notes
- Add verification notes

### 5. Required Documents Checklist

#### For Employees
- [ ] ID Document or Passport
- [ ] Employment Contract
- [ ] Tax Document (IRP5/IT3a)
- [ ] UIF Registration
- [ ] Bank Details Confirmation

#### For Contractors
- [ ] ID Document or Passport
- [ ] Service Agreement
- [ ] Company Registration (if applicable)
- [ ] Tax Clearance Certificate
- [ ] BEE Certificate (if applicable)

### 6. Document Expiry Tracking
- Track expiry date for certifications, licenses
- API endpoint for documents expiring within X days
- Dashboard widget showing expiring documents

## Database Schema

```sql
CREATE TABLE staff_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id UUID NOT NULL REFERENCES staff(id) ON DELETE CASCADE,

  -- Document info
  document_type VARCHAR(50) NOT NULL,
  document_name VARCHAR(255) NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  file_path VARCHAR(500) NOT NULL,
  file_size INTEGER NOT NULL,
  mime_type VARCHAR(100),

  -- Dates
  expiry_date DATE,
  uploaded_at TIMESTAMP DEFAULT NOW(),

  -- Verification
  status VARCHAR(20) DEFAULT 'pending',
  verified_by UUID REFERENCES staff(id),
  verified_at TIMESTAMP,
  verification_notes TEXT,
  rejection_reason TEXT,

  -- Metadata
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_staff_documents_staff_id ON staff_documents(staff_id);
CREATE INDEX idx_staff_documents_status ON staff_documents(status);
CREATE INDEX idx_staff_documents_expiry ON staff_documents(expiry_date);
```

## API Endpoints

### Upload Document
```
POST /api/staff-documents-upload
Content-Type: multipart/form-data

Body:
- file: File
- staffId: UUID
- documentType: string
- documentName: string
- expiryDate?: string (ISO date)
```

### List Documents
```
GET /api/staff/{staffId}/documents
Query: ?status=pending&type=certification
```

### Get/Update/Delete Document
```
GET /api/staff-documents/{documentId}
PUT /api/staff-documents/{documentId}
DELETE /api/staff-documents/{documentId}
```

### Verify Document
```
POST /api/staff-documents/{documentId}/verify
Body: {
  status: 'verified' | 'rejected',
  notes?: string,
  rejectionReason?: string
}
```

### Expiring Documents
```
GET /api/staff-documents/expiring?days=30
```

## Files to Create

### Components
- [ ] `src/components/staff/StaffDocumentUploadForm.tsx` - Upload form
- [ ] `src/components/staff/StaffDocumentList.tsx` - Document list with filters
- [ ] `src/components/staff/DocumentVerificationPanel.tsx` - Admin verification
- [ ] `src/components/staff/StaffDocumentChecklist.tsx` - Required docs checklist
- [ ] `src/modules/staff/components/form-sections/DocumentsSection.tsx` - Form integration

### Services
- [ ] `src/services/staffDocumentService.ts` - Document CRUD operations

### API Routes
- [ ] `pages/api/staff-documents-upload.ts`
- [ ] `pages/api/staff-documents/[documentId].ts`
- [ ] `pages/api/staff-documents/[documentId]/verify.ts`
- [ ] `pages/api/staff-documents/expiring.ts`
- [ ] `pages/api/staff/[staffId]/documents.ts`

### Types
- [ ] `src/types/staff-document.types.ts`

### Database
- [ ] `scripts/migrations/create-staff-documents-tables.sql`
- [ ] `scripts/migrations/run-staff-documents-migration.cjs`

### Tests
- [ ] `src/services/__tests__/staffDocumentService.test.ts`
- [ ] `tests/api/staff/documents.test.ts`
- [ ] `tests/components/staff/StaffDocumentUploadForm.test.tsx`
- [ ] `tests/components/staff/StaffDocumentList.test.tsx`
- [ ] `tests/components/staff/DocumentVerificationPanel.test.tsx`

## UI Components

### Upload Form
- Drag-and-drop file upload
- Document type dropdown
- Document name input
- Expiry date picker (optional)
- Progress indicator

### Document List
- Table with columns: Name, Type, Status, Expiry, Actions
- Filter by status, type
- Search by name
- Download button
- Delete button (with confirmation)

### Verification Panel
- Document preview (PDF/image viewer)
- Verify/Reject buttons
- Notes textarea
- Verification history

### Required Documents Checklist
- Shows required vs uploaded
- Green check for verified
- Yellow for pending
- Red for missing
- Completion percentage

## Acceptance Criteria
1. Staff documents can be uploaded via drag-drop or file picker
2. Documents stored locally at `/var/www/fibreflow/uploads/staff-documents/`
3. Document list shows with filtering and search
4. Admin can verify/reject documents with notes
5. Required documents checklist shows completion status
6. Expiring documents API returns docs within X days
7. All components support dark mode
8. 10MB file size limit enforced
9. Only allowed file types accepted

## Dependencies
- Local file storage service (already exists: `src/services/localFileStorage.ts`)
- Staff module
- Database migration

## Original PR
- PR #21: https://github.com/VelocityFibre/FF_Next.js/pull/21
- 32 files changed, +9,368 additions, -24 deletions
