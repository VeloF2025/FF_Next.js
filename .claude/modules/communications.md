# Module: communications

## Overview
| Property | Value |
|----------|-------|
| **Purpose** | Unified communications portal for meetings, action items, and team notifications |
| **Status** | Active |
| **Complexity** | Low |
| **Category** | communication |

## Dependencies

### Internal FF Modules
None

### External Packages
- lucide-react
- react

## Database

### Tables
None - awaiting backend implementation

### Key Queries
None

## API Endpoints
None implemented

## Services
None

## Components
- `CommunicationsDashboard` - Main dashboard
- `CommunicationsStatsCards` - Summary statistics
- `CommunicationsOverviewTab` - Overview section
- `CommunicationsMeetingsTab` - Meetings section
- `CommunicationsActionTab` - Actions section
- `CommunicationsNotificationsTab` - Notifications section

## Hooks
- `useCommunications` - Communications data (returns empty arrays)

## Patterns
- Tab-based navigation with 4 sections (Overview, Meetings, Actions, Notifications)
- Stats cards for quick metrics
- Color-coded status and priority indicators
- Empty state handling (no mock data)

## Gotchas
- **No Backend**: Currently no backend integration - useCommunications returns empty arrays
- **Awaiting Implementation**: Communications system awaits implementation of backend services
- **Placeholder Data**: All data is placeholder - no real meetings, actions, or notifications connected
- **TODO Status**: TODO comment indicates this is partially implemented
