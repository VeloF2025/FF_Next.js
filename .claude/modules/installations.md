# Module: installations

## Overview
| Property | Value |
|----------|-------|
| **Purpose** | Home installation dashboard and management system for fiber installation tracking and technician workflows |
| **Status** | Active |
| **Complexity** | Medium |
| **Category** | core |

## Dependencies

### Internal FF Modules
None

### External Packages
- react
- next
- lucide-react
- @/lib/logger

## Database

### Tables
None currently - hook returns empty array

### Key Queries
None - awaiting real service implementation

## API Endpoints
None - module is UI-only

## Services

### installationUtils
```typescript
calculateInstallationStats(installations)
```

## Components
- `HomeInstallationsDashboard` - Main dashboard
- `InstallationFilterTabs` - Tab navigation
- `InstallationStatsCards` - Statistics display
- `InstallationsTable` - Table view

## Hooks
- `useHomeInstallations()` - Load installations (returns empty array with TODO)

## Types
- `Installation` (types.ts) - Simple interface
- `HomeInstallation` (model.ts) - Comprehensive interface with:
  - Equipment tracking (ont, router, cables, splitter)
  - Speed test results (download/upload/ping)
  - Customer satisfaction rating
  - Quality checks
  - Billing info

## Patterns
- Empty state pattern: Hook explicitly returns empty array with TODO comment
- Stats calculation utility for computing aggregated metrics
- Tab-based filtering UI with status filter state
- Equipment tracking object with nested properties

## Gotchas
- **NO REAL DATA**: Module is shell/placeholder - no database queries or API endpoints
- **TODO Present**: useHomeInstallations returns [] with note to connect real service
- **Two Type Defs**: installation.types.ts vs installation.model.ts (model has more fields)
- **Model Mismatch**: HomeInstallation interface is comprehensive but no data source
- **No Backend**: Features defined in types but no implementation
