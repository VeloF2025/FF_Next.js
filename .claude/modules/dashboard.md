# Module: dashboard

## Overview
| Property | Value |
|----------|-------|
| **Purpose** | Main application dashboard showing project overview, team metrics, and activity feed |
| **Status** | Active |
| **Complexity** | High |
| **Category** | admin |

## Dependencies

### Internal FF Modules
- `projects` (via ProjectQueryService)
- `auth` (via AuthContext)

### External Packages
- lucide-react
- react

## Database

### Tables
- `projects` (implicit via ProjectQueryService)

### Key Queries
- Fetch all projects with status, progress, and dates
- Calculate active projects, completed tasks, open issues
- Fetch recent activity feed

## API Endpoints
Implicit: /api/* calls via useMainDashboardData hook

## Services

### ProjectQueryService
```typescript
getAllProjects()
```

## Components
- `Dashboard` - Main component
- `ProjectOverviewCard` - Project summary
- `RecentActivityFeed` - Activity stream
- `QuickActions` - Action shortcuts
- `StatsCard` - Metric display
- `ActivityHeader` - Activity header
- `ActivityLoadingState` - Loading state
- `ActivityEmptyState` - Empty state
- `ActivityListItem` - Activity item

## Hooks
- `useMainDashboardData()` - Dashboard data
- `useAuth()` - Authentication context

## Patterns
- Permission-based component visibility
- Real database data (no mock data)
- Safe date conversion with fallbacks for Firestore/native dates
- Hydration-safe greeting and date formatting
- Grid-based stats layout with 3 columns
- Tab filtering (all/active/planning projects)
- Error handling per project with fallback display
- Activity feed with empty state

## Types
- `DisplayProject` - Interface mapping from raw Project
- `Permission` - Enum for access control

## Gotchas
- **Date Conversion**: Safe date conversion handles Firestore Date objects and strings
- **Hydration Issues**: Must check mounted flag before setState due to hydration issues
- **Hardcoded Tasks**: Tasks completed/total hardcoded to 0 - task system not integrated yet
- **Status Defaults**: Project status values might be invalid - defaults to 'planning'
- **Legacy Code**: RecentActivityFeed is legacy compatibility layer (use ./activity modules instead)
- **Empty Arrays**: Activity feed always shows empty array by default
- **Permission Filtering**: Permission filtering on stat cards could hide critical metrics
