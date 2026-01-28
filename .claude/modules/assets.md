# Module: assets

## Overview
| Property | Value |
|----------|-------|
| **Purpose** | Complete asset lifecycle management with tracking, assignments, maintenance, calibration, and document storage |
| **Status** | Active |
| **Complexity** | High |
| **Category** | procurement |

## Dependencies

### Internal FF Modules
None

### External Packages
- react
- next
- neon (database client)
- zod (validation)
- @tanstack/react-query
- lucide-react
- html5-qrcode (QR code generation)

## Database

### Tables
- `asset_categories` - Category definitions
- `assets` - Main asset records
- `asset_assignments` - Assignment tracking
- `asset_maintenance` - Maintenance records
- `asset_documents` - Document storage

### Key Queries
- Get all assets with pagination and filtering (search, status, category, calibration due)
- Get asset by ID, asset_number, or barcode
- Dashboard statistics (total, available, assigned, in_maintenance, calibration_due, calibration_overdue)
- Calibration due within N days
- Maintenance due within N days
- Assignment history per asset
- Search assets by term

## API Endpoints
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/assets` | List with filters |
| POST | `/api/assets` | Create asset |
| GET | `/api/assets/[id]` | Get details |
| PUT | `/api/assets/[id]` | Update asset |
| DELETE | `/api/assets/[id]` | Delete asset (fails if assigned) |
| POST | `/api/assets/[id]/checkout` | Check out |
| POST | `/api/assets/[id]/checkin` | Check in |
| GET | `/api/assets/barcode/[code]` | Lookup by barcode |
| GET | `/api/assets/dashboard` | Dashboard stats |
| GET | `/api/assets/[id]/documents` | List asset documents |
| POST | `/api/assets/[id]/documents` | Upload document metadata |
| DELETE | `/api/assets/[id]/documents/[documentId]` | Soft delete document |

## Services

### assetService
```typescript
getAll(filter?: AssetFilterInput)
getById(id: string)
getByAssetNumber(assetNumber: string)
getByBarcode(barcode: string)
create(input: CreateAssetInput, createdBy: string)
update(id: string, input: UpdateAssetInput, updatedBy: string)
updateStatus(id: string, newStatus: AssetStatus, updatedBy: string)
delete(id: string)
getCalibrationDue(withinDays: number)
getMaintenanceDue(withinDays: number)
getDashboardStats()
search(term: string)
getAssignmentHistory(assetId: string)
```

### Additional Services
- `categoryService` - Category management
- `assignmentService` - Assignment operations
- `maintenanceService` - Maintenance tracking

## Components

### App Router Pages (`app/(main)/assets/`)
- `page.tsx` - Asset list/dashboard
- `new/page.tsx` - Create new asset
- `[id]/page.tsx` - Asset detail with Financial, Warranty, Documents sections
- `[id]/documents/upload/page.tsx` - Document upload wizard
- `[id]/documents/upload/DocumentUploadForm.tsx` - Upload form component
- `[id]/DeleteAssetButton.tsx` - Delete with double confirmation
- `[id]/DeleteDocumentButton.tsx` - Document soft delete

### Key UI Patterns
- **Document Display:** Transform VF Storage URLs to proxy URLs for viewing
- **View vs Download:** Use `?download=true` query param for downloads
- **Double Confirmation:** Delete buttons require two clicks (safety)
- **Soft Delete for Documents:** Sets `is_active = false` (preserves audit trail)

## Hooks
- `useAssets` - Asset list and operations
- `useAssetQueryKeys` - Query key management
- `useAssetQueries` - Query definitions
- `useAssetMutations` - Mutation definitions

## Patterns
- Modular isolation with server/client boundary (index.ts vs client.ts)
- Comprehensive database row transformation (transformRow function)
- Status transition validation (isValidTransition)
- Auto-generated asset numbers with category prefix
- Denormalized current assignment fields for performance
- JSONB storage for specifications and tags
- Pagination support with total count calculation

### VF Storage Document Pattern
```typescript
// Upload: Simple category, assetId in filename
const category = 'documents';
const filename = `${assetId}_${Date.now()}_${originalName}`;
POST /upload/assets/{category} with multipart form

// Display: Transform internal URL to proxy URL
function getProxyUrl(url: string): string {
  const match = url.match(/100\.96\.203\.105:8091\/(.+)/);
  return match ? `/api/uploads/${match[1]}` : url;
}

// View: Opens in browser
<a href={getProxyUrl(doc.file_url)} target="_blank">

// Download: Forces download
<a href={`${getProxyUrl(doc.file_url)}?download=true`}>
```

## Gotchas
- **N+1 Potential**: Asset number generation reads from database each time
- **State Machine**: Status transitions must be validated - strict state machine
- **Date Parsing**: Calibration dates in ISO format requiring manual parsing
- **JSONB Fields**: Stored as strings - requires JSON.stringify/parse
- **Filter Split**: Filter logic split between SQL and JavaScript
- **Migration Required**: Module requires database migration execution
- **Write-Only State**: Disposal state is write-only (no reactivation)
- **Delete Restriction**: Cannot delete assigned assets - must return first
- **Lucide File Import**: `File` icon shadows browser's `File` constructor - use `File as FileIcon`
- **VF Storage Paths**: Use simple category (`documents`), put assetId in filename not path
- **Document URLs**: VF Storage URLs need proxy transformation for browser access
- **Next.js Cache**: Deleted assets may persist in `.next` cache - clear and rebuild if needed
- **Purchase Price Zero**: Use `NonNegativeNumberSchema` (not `PositiveNumberSchema`) - donated assets have price 0
