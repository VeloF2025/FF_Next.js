# Module: sow

## Overview
| Property | Value |
|----------|-------|
| **Purpose** | Statement of Work import and management system for poles, drops, and fiber cable data with validation, tracking, and filtering |
| **Status** | Active |
| **Complexity** | Medium |
| **Category** | core |

## Dependencies

### Internal FF Modules
- `projects` (SOWDocument type, SOWDocumentType enum)

### External Packages
- next/router
- lucide-react (FileSpreadsheet, Upload icons)
- react (useState, useEffect)

## Database

### Tables
- `sow_imports` - Import records
- `projects` - SOW data metadata

### Key Queries
- Fetch SOW imports with pagination
- Query imports by projectId
- Validate SOW data structure (poles, drops, fibre)
- Insert SOW import records with metadata

## API Endpoints
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/sow` | List SOW imports |
| GET | `/api/sow?projectId={id}` | Project SOW imports |
| POST | `/api/sow` | Import SOW data |
| GET | `/api/sow/status?id={id}` | Check import status |

## Services
None defined in module

## Components
- `SOWListPage` - Main list interface
- `SOWListTable` - Document table
- `SOWFilters` - Search, type, status filters
- `SOWStats` - Summary statistics
- `SOWProjectSelector` - Project picker
- `SOWStatusBadge` - Status display
- `ImportsDataGrid` - Advanced grid view

## Hooks
- `useSOWDocuments` - Mock data for documents
- `useSOWFilters` - Filter/search logic
- `useImportsData` - Imports datagrid data

## SOW Data Types
- Poles
- Drops
- Fibre (fiber cables)

## Patterns
- Mock data implementation in useSOWDocuments
- Type-specific validation (poles, drops, fibre)
- Import tracking with status (completed, failed)
- Document metadata (poleCount, dropCount, etc.)
- Recursive error collection (limited to first 10)

## Gotchas
- **Mock Data**: useSOWDocuments uses mock data, not real API
- **Validation Split**: Validation logic in API but not in frontend hooks
- **Separate Status**: Import status endpoint separate from list endpoint
- **JSON Storage**: Data stored as JSON in projects.sow_data field
- **Error Limit**: Only first 10 errors returned
- **No Upload**: No actual file upload implementation
