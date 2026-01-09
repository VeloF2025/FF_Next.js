# Module: kpis

## Overview
| Property | Value |
|----------|-------|
| **Purpose** | Enhanced KPI management dashboard with tabs for different KPI categories and real-time monitoring |
| **Status** | Experimental |
| **Complexity** | Low |
| **Category** | reporting |

## Dependencies

### Internal FF Modules
None

### External Packages
- react
- next
- lucide-react
- next/router

## Database

### Tables
None

### Key Queries
None

## API Endpoints
None

## Services
None

## Components
- `EnhancedKPIDashboard` - Main dashboard with tabs

## Hooks
None

## Patterns
- Tab-based navigation (Operational/Financial/Quality/Customer)
- Metric cards with status indicators (good/warning/critical)
- Hardcoded metric data (all values: 0)
- Navigation cards as entry points
- Status-based color coding (green/yellow/red)

## Gotchas
- **PLACEHOLDER DATA**: All metric values are 0 with hardcoded status strings
- **No Integration**: No data integration whatsoever - purely UI mockup
- **Undefined Routes**: Navigation routes reference undefined pages (e.g., /app/kpis/overview)
- **Single File**: Single file (EnhancedKPIDashboard.tsx) with all logic inline
- **Similar Module**: Similar to kpi-dashboard module but different layout
- **Status Mismatch**: Status colors hardcoded but values don't reflect computation
