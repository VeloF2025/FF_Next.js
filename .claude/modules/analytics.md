# Module: analytics

## Overview
| Property | Value |
|----------|-------|
| **Purpose** | Provides dashboards and charts for project performance, team productivity, and operational metrics |
| **Status** | Active |
| **Complexity** | High |
| **Category** | reporting |

## Dependencies

### Internal FF Modules
None

### External Packages
- react
- next
- recharts (charting library)
- lucide-react
- framer-motion (lazy loading)

## Database

### Tables
None directly - data sourced via API

### Key Queries
N/A - queries in API layer

## API Endpoints
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/analytics/dashboard/stats` | Dashboard statistics |
| GET | `/api/analytics/dashboard/summary` | Summary data |
| GET | `/api/analytics/dashboard/trends` | Trend data |
| GET | `/api/analytics/projects/summary` | Project summary |
| GET | `/api/analytics/errors` | Error tracking |
| GET | `/api/analytics/web-vitals` | Performance metrics |

## Services
None defined in module

## Components
- `AnalyticsDashboard` - Main dashboard
- `AnalyticsStatsCards` - Statistics cards
- `DailyProgressChart` - Progress visualization
- `ProjectStatusView` - Project status
- `TeamPerformanceTable` - Team metrics
- `KeyInsights` - Insights panel
- `ChartWrapper` - Chart container

## Hooks
- `useAnalyticsData(timeRange: TimeRange)` - Fetch analytics data
- `useDashboardData()` - Dashboard-specific data

## Patterns
- Lazy component loading (React.lazy)
- Mock data fallback in hooks
- Time range filtering (24h, 7d, 30d, 90d, all)
- Metric type filtering (all, poles, drops, fiber, revenue)
- Dual stats system (useAnalyticsData + useDashboardData)

## Gotchas
- **Mock Data**: useAnalyticsData returns mock data (hardcoded daily progress and team performance)
- **No Real API**: No actual API calls in hook - just setTimeout simulation
- **Mixed Sources**: Mixing two different stats sources (stats vs enhancedStats)
- **Performance**: Lazy load may cause performance jank without Suspense boundaries
- **Duplicate Functions**: formatNumber called twice (formatNumber vs formatNum)
