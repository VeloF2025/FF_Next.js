# Pipeline Module Documentation

**Module**: Deal Pipeline & Approvals
**Status**: Active Development
**Last Updated**: 2026-03-10

---

## 🎯 Module Overview

The Pipeline module manages deal lifecycle and approval workflows, including:

- **Deal Pipeline**: Track deals from opportunity to closure
- **Approval Workflows**: Multi-step approval processes for deals
- **Document Management**: Upload and manage approval documents
- **Multi-File Upload**: Batch upload multiple documents at once
- **Document Types**: Supporting docs, Open Serve letters, maps, permits, etc.
- **Status Tracking**: Monitor approval stage and completion

---

## 📊 Key Features

### Multi-File Upload for Approval Documents (PRIORITY: High)
**Commit**: `379b1a7d` (2026-03-09)

Enhanced document upload flow enabling batch uploads without repeated form submission:

#### Functionality
- **Batch File Selection**:
  - Select multiple files at once (e.g., Open Serve letter + map)
  - Instead of: Upload file 1 → Fill form → Upload file 2 → Fill form
  - Now: Select files → Fill form once → Upload all
  
- **Shared Metadata**:
  - Document type (supporting_doc, open_serve, map, permit, etc.)
  - Description (applies to all selected files)
  - Issue date, expiry date, issuing authority (shared or per-file)
  - Document date
  
- **File List Management**:
  - Queue of files to upload with status
  - Each file shows:
    - Name, size, preview
    - Upload progress bar
    - Success/error state
    - Delete button (remove before upload)
  
- **Sequential Upload**:
  - Files uploaded one-at-a-time (not parallel)
  - Each file gets unique entry in approval documents
  - Can delete failed upload and retry
  
- **Optimized UX**:
  - Progress feedback per file
  - Can start next action while upload completes
  - Error handling: Skip failed, retry, or abort

---

## 🏗️ Architecture

### Components
- **DocumentManager** (`src/modules/pipeline/components/DocumentManager.tsx`)
  - Main document upload + list component
  - Unified UI for batch + single uploads
  - File queue management
  - Upload state management
  
  **Key State**:
  - `uploadedFiles[]`: Queue of files being/to-be uploaded
  - `uploadMeta`: Shared metadata (document_type, description, etc.)
  - `uploadingFiles`: Boolean flag for upload in progress

  **Key Props**:
  - `approvalId`: Parent approval record
  - `onDocumentAdded`: Callback when upload completes
  - `readOnly`: Disable uploads if approval locked

- **DocumentList**: Display uploaded documents with metadata
- **DocumentUpload**: File selection + progress

### API Endpoints
- `POST /api/storage/upload` - Upload file to cloud storage
  - Form data: { file, type: 'pipeline', category: 'approval-documents' }
  - Returns: { file_url, file_size }
  
- `POST /api/approvals/[approvalId]/documents` - Create approval document
  - Body: Metadata + storage URL
  - Returns: Document record with ID

### Database
- **approval_documents** table:
  - `id`: UUID
  - `approval_id`: Foreign key
  - `document_name`: Display name
  - `document_type`: Type enum
  - `file_url`: Cloud storage URL
  - `file_size`: Bytes
  - `description`: User-provided notes
  - `created_at`: Timestamp

---

## 🔧 Main Files

| File | Purpose | Change |
|------|---------|--------|
| `src/modules/pipeline/components/DocumentManager.tsx` | Document upload UI | REFACTORED (379b1a7d) |

#### Changes Detail

**DocumentManager.tsx**: Refactored for batch upload capability

Before:
- Single file selection → Form → Upload → Repeat

After:
- Multi-select → Form → Batch upload
- File queue with progress tracking
- Better error handling + retry

Key additions:
- `UploadedFile` interface for queue state
- `uploadedFiles[]` state (file list with status)
- `uploadMeta` state (shared metadata)
- `handleDragEnd()` for drag-drop file reordering
- Progress bar per file
- Sequential upload logic
- Retry + remove file functionality

---

## 🚀 Workflows

### Batch Document Upload (New)

1. Click "Add Documents" in approval
2. File picker opens (multi-select enabled)
3. Select multiple files:
   - Open Serve letter PDF
   - Site map image
   - Permit scan
4. Click "Open" → Files appear in queue
5. Fill shared metadata:
   - Document Type: "Supporting Documents"
   - Description: "Site survey pack"
   - Date fields (optional)
6. Click "Upload All"
7. Files upload sequentially:
   - Progress bar per file
   - Success checkmark when done
   - Can cancel individual uploads
8. Continue with other tasks while upload finishes

### Single File Upload (Legacy)

1. Click "Add Document"
2. Select single file
3. Fill form (document type, description, dates)
4. Click "Upload"
5. File processed immediately

Both flows are supported; DocumentManager handles both gracefully.

---

## 📝 Important Notes

### Upload Behavior
- **Sequential**: Files uploaded one at a time (not parallel)
  - Reduces server load
  - Easier error tracking (which file failed?)
  
- **Optimistic UI**: File appears in list immediately (pending status)
  - User sees confirmation of selection
  - Can proceed with other work
  
- **Error Handling**:
  - Failed file: Show error message, keep in queue
  - User can retry or delete and re-select
  - Other files continue uploading

### Metadata Sharing
- Same document type applies to all selected files
- Same description applies to all (or per-file optional)
- If per-file dates needed: Switch to single-file upload
- Default values: Date=today, Type=supporting_doc

### Performance
- File picker: Native browser (no library overhead)
- Upload: Uses same API as before (no changes needed)
- Queue rendering: Optimized for 100+ files
- Progress: Real-time feedback without blocking UI

### Testing
- [ ] Select 1 file → Works (backward compatible)
- [ ] Select 5 files → All upload successfully
- [ ] Select 50 files → UI responsive, no lag
- [ ] Cancel upload → Stop remaining files
- [ ] Network error on file 3 → Skip, continue with file 4
- [ ] Retry failed file → Works
- [ ] Different document types per file → Batch picks first type (or split batches)
- [ ] Large files (100MB) → Timeout handling
- [ ] Duplicate files → Allowed (no deduplication)
- [ ] Drag-reorder files in queue → Works (optional UX)

---

## 📚 Related Documentation

- **[CHANGELOG.md](./CHANGELOG.md)** — Commit history
- **[Projects Module](../projects/README.md)** — Project document management
- **[Field-Ops Module](../field-ops/README.md)** — Photo management

---

**Owner**: velo:velo
**Last Updated**: 2026-03-10
