# Module: admin

## Overview
| Property | Value |
|----------|-------|
| **Purpose** | Central admin dashboard for system management including document approval and contractor oversight |
| **Status** | Experimental |
| **Complexity** | Low |
| **Category** | admin |

## Dependencies

### Internal FF Modules
- `contractors` (DocumentApprovalPanel component)

### External Packages
- react
- lucide-react
- framer-motion (implied)

## Database

### Tables
None - UI-only module

### Key Queries
None

## API Endpoints
None

## Services
None

## Components
- `AdminDashboard` - Main dashboard
- `DocumentApprovalPanel` - From contractors module

## Hooks
None

## Patterns
- Tab-based interface for feature organization
- Placeholder patterns for upcoming features
- Stats cards for quick metrics overview

## Gotchas
- **Incomplete**: Most tabs show placeholder content (contractors, compliance, overview, settings)
- **Only Implemented**: Only DocumentApprovalPanel is implemented
- **Mock Data**: Stats hardcoded (12, 28, 156, 3)
- **Coupling**: Tight coupling to contractors module
