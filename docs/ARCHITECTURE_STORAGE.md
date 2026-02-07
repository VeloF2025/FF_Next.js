# Storage Architecture Documentation

**Last Updated**: January 22, 2026
**Status**: Migrating to Unified VF Storage API

---

## Current State (January 2026)

### CRITICAL: Storage Fragmentation Identified

An audit revealed **critical fragmentation** in file storage:

| Issue | Details |
|-------|---------|
| **Two backends** | Local FS (`/var/www/fibreflow/uploads`) AND VF Storage API (`100.96.203.105:8091`) |
| **Three env var names** | `VF_STORAGE_URL`, `STORAGE_API_URL`, `STORAGE_SERVICE_URL` - all for same thing |
| **50+ hardcoded IPs** | `100.96.203.105:8091` scattered across codebase |
| **Module inconsistency** | Staff/Contractors/Maintenance use local FS; Fleet/Pipeline/OCR use VF Server |

### Decision: Unify to VF Storage API

**All file storage will use VF Storage API at `100.96.203.105:8091` as single source of truth.**

---

## Target Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      FibreFlow App                          │
└─────────────────────────────────────────────────────────────┘
                              │
               ┌──────────────┴──────────────┐
               │                             │
               ▼                             ▼
┌────────────────────────┐      ┌────────────────────────────┐
│   Neon PostgreSQL      │      │   VF Storage API           │
│   (Database)           │      │   (File Storage)           │
├────────────────────────┤      ├────────────────────────────┤
│ • All business data    │      │ URL: 100.96.203.105:8091   │
│ • File metadata        │      │ Path: /var/www/vf-storage  │
│ • Document records     │      │                            │
│ • Audit trails         │      │ Stores ALL files:          │
└────────────────────────┘      │ • Staff documents          │
                                │ • Contractor docs          │
                                │ • Maintenance attachments  │
                                │ • Fleet photos             │
                                │ • Pipeline docs            │
                                │ • Pole photos              │
                                │ • Profile pictures         │
                                └────────────────────────────┘
```

---

## VF Storage API

### Server Details
- **Location**: Velocity Server (100.96.203.105)
- **Port**: 8091
- **Tailscale**: Accessible via `100.96.203.105:8091`
- **Service**: Runs as dedicated storage service

### CRITICAL: URL Types (Updated Feb 2026)

| Context | URL Format | Example |
|---------|------------|---------|
| **Server-to-server** (uploads) | Internal HTTP IP | `http://100.96.203.105:8091/upload/...` |
| **Browser-facing** (stored in DB) | Public HTTPS | `https://vf.fibreflow.app/staff/documents/file.pdf` |

⚠️ **NEVER store internal IP URLs in the database** - they cause mixed content errors when pages are served over HTTPS.

```typescript
// All storage services MUST convert URLs before returning/storing:
let url = result.url;
if (url.includes('100.96.203.105:8091')) {
  url = url.replace('http://100.96.203.105:8091', 'https://vf.fibreflow.app');
}
```

### API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/health` | GET | Health check |
| `/upload/{type}/{category}` | POST | Upload file (multipart/form-data) |
| `/list/{type}/{category}` | GET | List files in directory |
| `/delete/{type}/{category}/{filename}` | DELETE | Delete file |
| `/{type}/{category}/{filename}` | GET | Serve file directly |

### Storage Path Convention

```
{type}/{category}/{filename}

Examples:
- staff/documents/abc123_contract.pdf
- contractors/documents/xyz789_license.pdf
- maintenance/attachments/ticket-001/photo.jpg
- fleet/check-in/vehicle-123/odometer.jpg
- pipeline/wayleave/project-456/approval.pdf
- poles/project-789/pole-001/photo.jpg
```

### Type Categories

| Type | Categories | Purpose |
|------|------------|---------|
| `staff` | `documents`, `photos`, `cv` | Staff member files |
| `contractors` | `documents`, `certificates` | Contractor compliance docs |
| `maintenance` | `attachments`, `evidence` | Ticket attachments |
| `fleet` | `check-in`, `calibration`, `investigation` | Vehicle photos |
| `pipeline` | `wayleave`, `municipal`, `approvals` | Pipeline documents |
| `poles` | `{projectId}` | Pole tracker photos |
| `profile` | `pictures` | User avatars |

---

## Environment Variables (Unified)

### Standard Configuration

```bash
# SINGLE env var for VF Storage (standardized name)
VF_STORAGE_URL=http://100.96.203.105:8091

# Enable VF Storage (required)
NEXT_PUBLIC_USE_VF_STORAGE=true
```

### Deprecated (Do Not Use)

```bash
# These are DEPRECATED - migrate to VF_STORAGE_URL
STORAGE_API_URL=...      # ❌ Use VF_STORAGE_URL
STORAGE_SERVICE_URL=...  # ❌ Use VF_STORAGE_URL
FILE_STORAGE_PATH=...    # ❌ VF API handles paths
FILE_STORAGE_URL=...     # ❌ VF API handles URLs
```

---

## Service Architecture

### Primary Service: VFStorageService

**File**: `src/services/vfStorageAdapter.ts`

```typescript
import { vfStorage, VFStorageService } from '@/services/vfStorageAdapter';

// Upload
const result = await vfStorage.uploadFile(buffer, 'staff', 'documents', 'contract.pdf');
// Returns: { success: true, filename: '...', path: '...', url: '...' }

// List
const files = await vfStorage.listFiles('staff', 'documents');

// Delete
await vfStorage.deleteFile('staff', 'documents', 'contract.pdf');

// Get URL
const url = vfStorage.getFileUrl('staff', 'documents', 'contract.pdf');

// Health check
const healthy = await vfStorage.checkHealth();
```

### Deprecated Services

| Service | Status | Replacement |
|---------|--------|-------------|
| `localFileStorage` | DELETED (Jan 2026) | Use `vfStorage` |
| `storageAdapter` | DEPRECATED | Use `vfStorage` directly |

---

## Migration Status

### Completed (Jan 2026)
- [x] VF Storage API running on Velocity server
- [x] Pipeline module using VF Storage
- [x] Fleet module using VF Storage
- [x] OCR processing using VF Storage
- [x] Maintenance module - migrated attachmentService to vfStorage
- [x] Staff module - already uses vfStorageAdapter (CV, profile photos, documents)
- [x] Contractors module - migrated contractors-documents-upload/delete to vfStorage
- [x] Poles module - migrated pole-photos-upload/delete to vfStorage
- [x] Generic storage APIs - migrated /api/storage/* and /api/uploads/* to vfStorage

### Completed (Jan 2026)
- [x] Consolidated env var names to `VF_STORAGE_URL`
- [x] Removed `STORAGE_API_URL` and `STORAGE_SERVICE_URL` references
- [x] Deleted deprecated `src/services/localFileStorage.ts` service
- [x] All modules now use `vfStorageAdapter` exclusively

---

## API Endpoint Patterns

### Standard Upload Endpoint

```typescript
// pages/api/{module}/upload.ts
import { vfStorage } from '@/services/vfStorageAdapter';

export default async function handler(req, res) {
  const form = formidable({ maxFileSize: 10 * 1024 * 1024 });
  const [fields, files] = await form.parse(req);

  const file = files.file[0];
  const buffer = await fs.readFile(file.filepath);

  const result = await vfStorage.uploadFile(
    buffer,
    'module-type',    // e.g., 'staff', 'maintenance'
    'category',       // e.g., 'documents', 'photos'
    file.originalFilename
  );

  return res.json(result);
}
```

### Standard Serve Endpoint

```typescript
// pages/api/{module}/files/[...path].ts
export default async function handler(req, res) {
  const { path } = req.query;
  const filePath = Array.isArray(path) ? path.join('/') : path;

  const response = await fetch(`${VF_STORAGE_URL}/${filePath}`);
  const buffer = await response.arrayBuffer();

  res.setHeader('Content-Type', response.headers.get('content-type'));
  res.send(Buffer.from(buffer));
}
```

---

## Database: Neon PostgreSQL

File metadata is stored in Neon, not VF Storage:

```sql
-- Example: maintenance_attachments table
CREATE TABLE maintenance_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL,
  filename VARCHAR(255) NOT NULL,
  file_type VARCHAR(50),
  mime_type VARCHAR(100),
  file_size INTEGER,
  storage_path TEXT NOT NULL,  -- VF Storage path: type/category/filename
  storage_url TEXT,            -- Full URL for serving
  uploaded_by UUID,
  uploaded_at TIMESTAMP DEFAULT NOW()
);
```

---

## Security

### Access Control
- VF Storage API is only accessible via Tailscale network
- No public internet exposure
- Files served through Next.js API proxy for access control

### File Validation
- MIME type validation on upload
- File size limits (10MB default, configurable)
- Filename sanitization to prevent path traversal

---

## Troubleshooting

### VF Storage Health Check
```bash
curl http://100.96.203.105:8091/health
```

### List Files
```bash
curl http://100.96.203.105:8091/list/staff/documents
```

### Upload Test
```bash
curl -X POST http://100.96.203.105:8091/upload/test/temp \
  -F "file=@test.pdf"
```

### Service Status (on Velocity server)
```bash
ssh velo@100.96.203.105
echo '$VELO_SSH_PASSWORD' | sudo -S systemctl status vf-storage
```

---

## Related Documentation

- [CLAUDE.md](../CLAUDE.md) - Project overview
- [INFRASTRUCTURE.md](./INFRASTRUCTURE.md) - Server infrastructure
- `src/services/vfStorageAdapter.ts` - VF Storage service code
