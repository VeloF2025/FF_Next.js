# Module: onemap

## Overview
| Property | Value |
|----------|-------|
| **Purpose** | Geographic data visualization and management through OneMap integration |
| **Status** | Experimental |
| **Complexity** | Low |
| **Category** | operations |

## Dependencies

### Internal FF Modules
None

### External Packages
- lucide-react
- next/router

## Database

### Tables
None - placeholder module

### Key Queries
None

## API Endpoints
| Method | Endpoint | Description |
|--------|----------|-------------|
| * | `/api/onemap/properties.ts` | Properties data |
| * | `/api/onemap/properties-enhanced.ts` | Enhanced properties |
| * | `/api/onemap/properties-with-mapping.ts` | Properties with mapping |
| * | `/api/onemap/upload.ts` | Data upload |

## Services
None

## Components
- `OneMapDashboard` - Dashboard with:
  - Map visualization
  - Data grid
  - Layers management
  - Import/Export
  - Search

## Hooks
None

## Patterns
- Dashboard with card-based navigation
- Map/Grid/Layers toggle interface
- Import/Export functionality

## Gotchas
- **UI Placeholder**: Component is mostly UI placeholder
- **No Map Library**: No actual map library integrated (UI shows structure only)
- **Not Implemented**: Data grid and layers features not implemented
- **Zero Stats**: Statistics show all zeros (0 points, 0 layers, no last updated)
