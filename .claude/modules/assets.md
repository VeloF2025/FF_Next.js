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
| DELETE | `/api/assets/[id]` | Delete asset |
| POST | `/api/assets/[id]/checkout` | Check out |
| POST | `/api/assets/[id]/checkin` | Check in |
| GET | `/api/assets/barcode/[code]` | Lookup by barcode |
| GET | `/api/assets/dashboard/summary` | Dashboard stats |

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
UI components referenced elsewhere

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

## Gotchas
- **N+1 Potential**: Asset number generation reads from database each time
- **State Machine**: Status transitions must be validated - strict state machine
- **Date Parsing**: Calibration dates in ISO format requiring manual parsing
- **JSONB Fields**: Stored as strings - requires JSON.stringify/parse
- **Filter Split**: Filter logic split between SQL and JavaScript
- **Migration Required**: Module requires database migration execution
- **Write-Only State**: Disposal state is write-only (no reactivation)
