# NOC Ticket Attachments — Product Requirements Document

**Feature**: NOC > Ticket Detail > Attachments tab (upload, paste, gallery)
**Commits**: 4e083c8, 6fc1069
**Status**: Released (2026-03-14)
**Priority**: P2 (UX Enhancement + Bug Fix)
**Module**: NOC
**Last Updated**: 2026-03-16

---

## Problem Statement

NOC technicians needed to attach photos/videos to fault tickets for:
- Evidence of pole damage (splice closure failure, FDH malfunction)
- Before/after photos of repairs
- Customer site conditions (access issues, cable routing)

**Previous Workaround**:
- Attach files via email to support@velocityfibre.co.za (manual process)
- Upload to WhatsApp group (lost after 24 hours)
- Email links (security risk, external dependencies)

**Problems**:
- ❌ No audit trail (who uploaded what, when)
- ❌ Files lost after handover (not linked to ticket)
- ❌ No preview in ticket UI (clicking out to email/WhatsApp)
- ❌ Duplicate uploads (file attached to email AND ticket created separately)
- ❌ Mixed media formats (some PNG, some JPEG, some MOV) — hard to classify

## Solution

**Attachments Tab** — Unified file attachment UI built into NOC ticket detail:
- **Drag-drop upload** — Drag photo/video onto panel
- **Clipboard paste** — Ctrl+V/Cmd+V to paste screenshot or phone camera
- **File picker** — Click to browse device storage
- **Gallery preview** — Thumbnail grid with lightbox
- **Full-size modal** — Click thumbnail to view full image
- **Persistent storage** — Files saved to MinIO, linked to ticket
- **Audit trail** — Attachment metadata (uploader, timestamp) recorded

### Design Principles

1. **Zero Friction** — Attach in 1 click; no 5-step wizard
2. **Field-Friendly** — Works on mobile field devices (iPhone, Android)
3. **Persistent** — Files survive ticket handover, visible in audit trail
4. **Safe** — Scoped to ticket; no cross-ticket access
5. **Fast** — < 2s upload for typical 2MB photo

---

## Feature Specifications

### 1. File Upload Methods

#### Drag-Drop Upload
- Users can drag multiple files onto the Attachments Tab panel
- Supports: JPG, PNG, GIF, WebP (images) + MP4, WebM, QuickTime, AVI (video)
- Max file size: 25MB per file
- Max files per upload: 10
- Visual feedback: "Drop zone" highlight when dragging over panel

#### Clipboard Paste (Ctrl+V / Cmd+V)
- Users press Ctrl+V (Windows/Linux) or Cmd+V (Mac) anywhere on the panel
- Paste handler captures images from clipboard
- Useful for: Screenshots, phone camera pastes
- React hook: useEffect on paste event, captures blob, calls uploadFile
- **Bug Fix (commit 6fc1069)**: uploadFile moved to useCallback before paste effect (fixes stale closure)

#### File Picker (Browse Button)
- "Browse" button opens native file dialog
- Accept all image/video MIME types
- Single or multiple selection (depending on browser)

### 2. Gallery Preview

**Thumbnail Grid**:
- Images displayed as 100×100px thumbnails
- Aspect ratio: auto-crop to square (center focal point)
- Lazy-loaded on scroll
- Click thumbnail to open full-size modal

**Lightbox Modal**:
- Full-size image in modal overlay
- Dark background
- Navigation: previous/next buttons (arrow keys work too)
- Close: ESC key or click X button or backdrop
- Metadata: filename, upload time, uploader name (hover)

**Video Support**:
- Thumbnail: auto-generated from first frame
- Click thumbnail to play embedded video in modal
- Supported: MP4, WebM, QuickTime (MOV), AVI
- Native HTML5 video player (play/pause/fullscreen)

### 3. File Metadata

**Stored Per Attachment**:
- `id` — UUID
- `ticket_id` — Foreign key to tickets table
- `file_name` — Original filename (IMG_20260314_123456.JPG)
- `file_size` — Bytes (used to display "2.3 MB")
- `mime_type` — MIME type (image/jpeg, video/mp4, etc.)
- `s3_path` — MinIO path (/uploads/tickets/[ticket_id]/[uuid].jpg)
- `uploaded_at` — ISO timestamp
- `uploaded_by_user_id` — FK to users table
- `deleted_at` — Soft delete flag (null = active)

### 4. Database Schema

#### Migration 233: `attachment_columns`
```sql
ALTER TABLE maintenance_attachments ADD COLUMN file_name VARCHAR(255);
ALTER TABLE maintenance_attachments ADD COLUMN uploaded_by_user_id BIGINT;
ALTER TABLE maintenance_attachments ADD COLUMN s3_path VARCHAR(512);
ALTER TABLE maintenance_attachments ADD COLUMN deleted_at TIMESTAMP NULL;
ALTER TABLE maintenance_attachments ADD COLUMN mime_type VARCHAR(50);

CREATE INDEX idx_maintenance_attachments_ticket_id ON maintenance_attachments(ticket_id);
CREATE INDEX idx_maintenance_attachments_uploaded_at ON maintenance_attachments(uploaded_at DESC);
```

---

## API Endpoints

### 1. POST `/api/noc/tickets/[ticketId]/attachments`
**Purpose**: Upload single file to ticket

**Headers**:
- `Content-Type: multipart/form-data`

**Body**:
```
file: <binary>
```

**Response**:
```json
{
  "success": true,
  "id": "uuid-12345",
  "file_name": "IMG_20260314.JPG",
  "file_size": 2097152,
  "mime_type": "image/jpeg",
  "s3_path": "/uploads/tickets/456/uuid-12345.jpg",
  "uploaded_at": "2026-03-16T10:30:00Z",
  "uploaded_by": "Johan Pieterse"
}
```

### 2. GET `/api/noc/tickets/[ticketId]/attachments`
**Purpose**: List all attachments for ticket

**Response**:
```json
{
  "success": true,
  "count": 3,
  "attachments": [
    {
      "id": "uuid-12345",
      "file_name": "damage-before.jpg",
      "file_size": 2097152,
      "mime_type": "image/jpeg",
      "s3_path": "/uploads/tickets/456/uuid-12345.jpg",
      "uploaded_at": "2026-03-16T10:30:00Z",
      "uploaded_by": "Johan Pieterse"
    }
  ]
}
```

### 3. DELETE `/api/noc/tickets/[ticketId]/attachments/[attachmentId]`
**Purpose**: Soft-delete attachment

**Response**: `{ "success": true }`

---

## Frontend Components

### Component Hierarchy
```
TicketDetail.tsx
└── TicketDetailTabs.tsx (new "Attachments" tab)
    └── AttachmentsTab.tsx (main container)
        ├── UploadDropZone.tsx (drag-drop area)
        ├── AttachmentGallery.tsx (thumbnail grid)
        └── AttachmentModal.tsx (full-size lightbox)
```

### Component Specs

#### `AttachmentsTab.tsx` (Main Container)
- Fetches `/attachments` on mount
- Manages upload state (uploading, errors, progress)
- Renders drop zone, gallery, and modal
- Paste handler: `useEffect` with paste event listener
- uploadFile in useCallback before paste effect (to avoid stale closure)

**Key Code Pattern** (commit 6fc1069 fix):
```typescript
const uploadFile = useCallback(async (file: File) => {
  // upload logic
}, [ticketId]);

useEffect(() => {
  const handlePaste = (e: ClipboardEvent) => {
    e.clipboardData?.items // get file from clipboard
    uploadFile(pastedFile); // call uploadFile (now fresh)
  };
  document.addEventListener('paste', handlePaste);
  return () => document.removeEventListener('paste', handlePaste);
}, [uploadFile]); // depend on uploadFile
```

#### `AttachmentGallery.tsx`
- Grid layout (4 columns on desktop, 2 on mobile)
- Thumbnail size: 100×100px
- Lazy-load on scroll (Intersection Observer)
- Click thumbnail to open modal
- Hover tooltip: filename + upload time

#### `AttachmentModal.tsx`
- Full-size image/video in modal overlay
- Navigation: prev/next buttons
- Keyboard: arrow keys, ESC to close
- Click backdrop to close
- Metadata bar: filename, size, uploader

---

## Integration with Ticket Detail

**Tab Location**: Between "Notes" and "Verification" tabs

**Content**:
- Attachments count shown in tab label (e.g., "Attachments (3)")
- Empty state: "No attachments yet. Drag files here or click Browse."
- After upload: attachment added to gallery instantly (optimistic UI)

---

## Success Metrics

1. **Adoption**: 70% of new tickets include at least 1 attachment within 4 weeks
2. **Field Efficiency**: Technicians save 2 min per ticket (no email/WhatsApp detour)
3. **Audit Trail**: 100% of attachments have metadata (uploader, timestamp)
4. **Data Retention**: 0 lost files (all stored in MinIO, linked to ticket)
5. **Performance**: Attachment upload < 2s for 2MB file on 4G connection

---

## Security & Compliance

1. **Access Control**: Only ticket owner + NOC team can view attachments
2. **Virus Scanning** (Future): Scan files with ClamAV before storing
3. **Data Retention**: Soft-delete only (compliance with 7-year audit requirement)
4. **S3 Security**: MinIO bucket scoped to `/uploads/tickets/` prefix, not world-readable

---

## Bug Fixes in This Feature

### Stale Closure in Paste Handler (Commit 6fc1069)
**Problem**: `uploadFile` function was defined after the paste `useEffect`, causing the paste handler to capture an undefined reference, breaking Ctrl+V upload.

**Solution**: Move `uploadFile` to `useCallback` before the paste effect definition, so the effect has a fresh reference.

**Code Change**:
```typescript
// Before (broken):
useEffect(() => {
  const handlePaste = async (e) => {
    await uploadFile(file); // uploadFile not yet defined!
  };
}, []);

const uploadFile = async (file) => { /* ... */ };

// After (fixed):
const uploadFile = useCallback(async (file) => {
  /* ... */
}, [ticketId]);

useEffect(() => {
  const handlePaste = async (e) => {
    await uploadFile(file); // Now uploadFile is defined first
  };
}, [uploadFile]);
```

---

## Related Changes

### .gitignore Additions (Commit 4e083c8)
```
.claude/session/
.claude/metrics/
.claude/settings.local.json
.claude/worktrees/

scripts/__pycache__/
public/uploads/qa-photos/

tests/e2e-results/
metrics/
```

**Reason**: Exclude build artifacts, Claude local files, and upload directories from version control.

---

## Rollout Plan

1. **Dev Testing** (2026-03-14) — Manual QA, paste handler validation
2. **Staging** (2026-03-15) — Full NOC team, test MinIO integration
3. **Production** (2026-03-16) — Live, gather user feedback
4. **Monitoring** (2026-03-17+) — Watch upload success rate, S3 quota
5. **Training** (2026-03-24) — 10-min walkthrough video (drag-drop, paste, gallery)

---

## Open Questions / Future Work

1. **Virus Scanning** — Add ClamAV integration for uploaded files
2. **Thumbnail Optimization** — Use WebP thumbnails to reduce S3 bandwidth
3. **Batch Download** — "Download All" button to export all attachments as ZIP
4. **Approval Workflow** — Flag attachments requiring review before ticket closure
5. **Duplicate Detection** — Warn if user uploads same file twice (hash-based)

---

## References

- **Related Commits**:
  - 4e083c8 — Attachments tab feature
  - 6fc1069 — Paste handler stale closure fix
  - Migration 233 — Schema changes for attachment metadata
- **Related Modules**: noc, field-ops (WhatsApp integration)
- **User Documentation**: (TBD) `/help/noc/ticket-attachments.md`

**Last Updated**: 2026-03-16 | **Owner**: Elon (CTO) | **Status**: Released
