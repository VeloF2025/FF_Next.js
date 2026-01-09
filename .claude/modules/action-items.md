# Module: action-items

## Overview
| Property | Value |
|----------|-------|
| **Purpose** | Tracks action items extracted from meetings, with status management and assignment tracking |
| **Status** | Active |
| **Complexity** | Medium |
| **Category** | admin |

## Dependencies

### Internal FF Modules
- None

### External Packages
- react
- next
- lucide-react (icons)
- neon (database client)
- zod (validation)

## Database

### Tables
- `meeting_action_items` - Main action items table
- `meetings` (via LEFT JOIN) - Source meetings

### Key Queries
- List action items with filters (status, assignee, meeting, priority)
- Get action item statistics (total, pending, in_progress, completed, overdue)
- Create/update action items from API
- Extract action items from meetings

## API Endpoints
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/action-items` | List with filters |
| GET | `/api/action-items/[id]` | Get single item |
| GET | `/api/action-items/stats` | Get statistics |
| POST | `/api/action-items` | Create |
| PATCH | `/api/action-items/[id]` | Update |
| DELETE | `/api/action-items/[id]` | Delete |
| POST | `/api/action-items/extract` | Extract from meeting |
| GET | `/api/cron/sync-action-items` | Sync cron job |

## Services

### actionItemsService
```typescript
getActionItems(filters?: ActionItemFilters)
getActionItem(id: string)
createActionItem(input: ActionItemCreateInput)
updateActionItem(id: string, updates: ActionItemUpdateInput)
updateStatus(id: string, status: ActionItemStatus)
deleteActionItem(id: string)
getStats()
extractFromMeeting(meeting_id: number)
markCompleted(id: string)
```

## Components
- `ActionItemsDashboard` - Main dashboard
- `ActionItemsList` - List view
- `PendingActionItems` - Pending items section
- `OverdueActionItems` - Overdue items section
- `CompletedActionItems` - Completed items section
- `ActionItemsByMeeting` - Grouped by meeting
- `ActionItemsByAssignee` - Grouped by assignee
- `ActionItemsSearch` - Search functionality

## Hooks
None custom - uses standard React hooks

## Patterns
- Service-based API layer (actionItemsService wraps fetch calls)
- Frontend filters applied in JavaScript (moderate dataset assumed)
- Status lifecycle management (pending→in_progress→completed or cancelled)
- Meeting-based grouping and extraction

## Gotchas
- **Scalability**: Filters applied in JS rather than SQL - scalability concern for 10k+ items
- **NULL Handling**: Meeting join is optional (LEFT JOIN) - ensure null handling
- **Status Casting**: Status casting required in database queries (::text)
