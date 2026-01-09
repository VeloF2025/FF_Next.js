# Module: kpi-dashboard

## Overview
| Property | Value |
|----------|-------|
| **Purpose** | Real-time performance metrics and KPI visualization dashboard for project tracking |
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
- @/hooks/useDashboardData
- @/components/dashboard/EnhancedStatCard
- @/components/dashboard/DashboardHeader
- @/config/dashboards/dashboardConfigs

## Database

### Tables
None directly - data via hook

### Key Queries
Data sourced from useDashboardData hook

## API Endpoints
None

## Services
None

## Components
- `KPIDashboard` - Main dashboard with stats grid

## Hooks
- `useKPIDashboardData()` - KPI stats and trends with formatting utilities:
  - `formatNumber`
  - `formatCurrency`
  - `formatPercentage`

## Patterns
- Component-level data fetching via custom hook
- Mixed modern and legacy card layouts for comparison
- Placeholder charts ("Chart visualization coming soon")
- Stats formatting utilities in hook

## Gotchas
- **Minimal Implementation**: Single file component (KPIDashboard.tsx)
- **Unused State**: Loading and error states prefixed with underscore (_isLoading, _error)
- **Hardcoded Cards**: Legacy KPI cards alongside dynamic configuration
- **Incomplete Charts**: Chart placeholders indicate incomplete feature
- **Missing Config**: Depends on dashboardConfigs that may not exist
- **No Integration**: No database or API integration visible
