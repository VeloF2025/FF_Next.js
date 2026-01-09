# Module: reports

## Overview
| Property | Value |
|----------|-------|
| **Purpose** | Reporting dashboard for generating, managing, and analyzing business reports across projects, financials, performance, and resources |
| **Status** | Experimental |
| **Complexity** | Low |
| **Category** | reporting |

## Dependencies

### Internal FF Modules
- `dashboard` (uses DashboardHeader, StatsGrid components)

### External Packages
- next/navigation (useRouter)
- lucide-react
- react

## Database

### Tables
None - mock data only

### Key Queries
None

## API Endpoints
None implemented

## Services
None

## Components
- `ReportsDashboard` - Main page component
- Tabs: All Reports, Scheduled, Custom, Templates
- Report Categories (6 cards)
- Recent Reports List

## Hooks
- `useReportsDashboardData()` - Not yet connected

## Report Categories
1. Project Reports
2. Financial Reports
3. Performance Reports
4. Resource Reports
5. Quality Reports
6. Custom Reports

## Patterns
- Mock data for UI prototype
- Tab-based navigation
- Category-based report organization
- Card grid layout for categories

## Gotchas
- **Early Stage**: Very early stage - mostly UI scaffolding
- **Mock Data**: All report counts are hardcoded mock data
- **No API**: No actual API integration
- **Missing Routes**: Routes referenced (/reports/projects, etc.) may not exist
- **Disconnected Hook**: useReportsDashboardData not yet connected
