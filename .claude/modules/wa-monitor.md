# Module: wa-monitor

## Overview
| Property | Value |
|----------|-------|
| **Purpose** | Real-time WhatsApp QA photo drop monitoring with incorrect photo marking and feedback system |
| **Status** | Active |
| **Complexity** | Medium |
| **Category** | monitoring |

## Dependencies

### Internal FF Modules
**NONE** - Fully isolated module (no @/lib/* or @/services/* imports)

### External Packages
- @neondatabase/serverless
- lucide-react
- axios

## Database

### Tables
- `qa_photo_reviews` - Main drop records with 12 QA step booleans

### Key Queries
- getAllDrops() with filters
- getDropById(id)
- getDropsByStatus()
- calculateSummary() - Dashboard stats
- getDailyDropsPerProject()
- getProjectStats()

## API Endpoints
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/wa-monitor-drops` | List all drops with summary |
| PATCH | `/api/wa-monitor-drops/[id]` | Update drop review |
| GET | `/api/wa-monitor-daily-drops` | Daily drops per project |
| GET | `/api/wa-monitor-projects-summary` | Project statistics |
| POST | `/api/wa-monitor-send-feedback` | Send WhatsApp feedback |
| GET | `/api/wa-monitor-health` | Health check |
| GET | `/api/wa-monitor-dr-validation` | Validate DR format |

## Services

### waMonitorService
```typescript
getAllDrops()
getDropById(id)
getDropsByStatus(status)
updateDrop(id, data)
calculateSummary()
getDailyDropsPerProject(date)
getProjectStats(projectName)
```

### waMonitorApiService
Frontend API client for dashboard

## Components
- `WaMonitorDashboard` - Main dashboard container
- `WaMonitorGrid` - Sortable drop grid display
- `QaReviewCard` - Individual drop review with incorrect marking
- `WaMonitorFilters` - Filter controls
- `DropStatusBadge` - Status indicator badge
- `SystemHealthPanel` - VPS agent health

## Hooks
- `useWaMonitorStats()` - Dashboard statistics and refresh

## QA Steps (12 total)
Steps are stored as `step_01` through `step_12` boolean columns in database.

**CRITICAL**: Use `ORDERED_STEP_KEYS` constant for correct display order - database column order differs from display order!

## Patterns
- Fully isolated module (no @/lib/* or @/services/* imports)
- Frozen API contracts (see API_CONTRACT.md)
- Edit locking system (prevents concurrent editing)
- Three-state logic for QA photos (correct/incorrect/missing)
- Incorrect photos tracked via `incorrectSteps` array and `incorrectComments` JSONB

## Gotchas
- **COLUMN ORDER**: 12 database columns (step_01...step_12) are NOT in display order - must use ORDERED_STEP_KEYS
- **Text Input**: Incorrect photo marking uses text input approach
- **VPS Writes Basic**: VPS Python monitor writes only basic step booleans
- **Frontend Enriches**: Frontend users populate incorrectSteps and incorrectComments
- **Auto Feedback**: Feedback generation auto-creates message from missing/incorrect items
- **Edit Locking**: Drop locking prevents multiple users editing same record
- **Microservice Ready**: Module intentionally isolated for future extraction

## Related Documentation
- `src/modules/wa-monitor/README.md` - Full module documentation
- `src/modules/wa-monitor/ISOLATION_GUIDE.md` - Branch and testing strategy
- `src/modules/wa-monitor/API_CONTRACT.md` - API contracts (frozen)
- `src/modules/wa-monitor/TROUBLESHOOTING.md` - Common issues
