# Module: nokia-equipment

## Overview
| Property | Value |
|----------|-------|
| **Purpose** | Nokia network equipment inventory and installation tracking |
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
| * | `/api/nokia/velocity.ts` | Velocity integration |

## Services
None

## Components
- `NokiaEquipmentDashboard` - Tabbed dashboard with:
  - Equipment Catalog
  - Inventory Status
  - Installations
  - Maintenance
  - Import Data
  - Reports

## Hooks
None

## Patterns
- Dashboard navigation pattern
- Tab-based interface
- Card grid layout

## Gotchas
- **No Persistence**: No actual data persistence - placeholder component
- **Mock Stats**: Status shows hardcoded mock stats (245 total, 180 available, 65 deployed)
- **No API**: No API integration implemented
- **No Tables**: No database tables assigned
