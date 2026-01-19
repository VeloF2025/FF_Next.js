# Activate Reporting Skill

This skill provides comprehensive reporting and analytics for the Activate module.
Use when asking about DR stats, field agent performance, project metrics, or activation data.

## 8 Report Types Available

| Report | Endpoint | Purpose |
|--------|----------|---------|
| **Daily Counts** | `/reporting/daily-counts` | Zone/PON breakdown by project |
| **Trends** | `/reporting/trends` | Velocity trends (day/week/month) |
| **Funnel** | `/reporting/funnel` | QA workflow funnel analysis |
| **Team Performance** | `/reporting/team-performance` | Team leaderboard |
| **Discrepancy** | `/reporting/discrepancy` | WA vs OES comparison |
| **Serial Validation** | `/reporting/serial-validation` | ONT/UPS serial matching |
| **User Attribution** | `/reporting/user-attribution` | User performance metrics |
| **Resubmissions** | `/reporting/resubmissions` | Failed→Passed analysis |

## Terminology (CRITICAL - Consistent Across All Reports)

| Term | Definition | Source Table | Color |
|------|------------|--------------|-------|
| **Total** | Unique drops counted once at first install/activation | Derived (max of installed/activated) | Gray |
| **Installed** | DRs submitted via WhatsApp (installation done) | `qa_photo_reviews` | Blue |
| **Activated** | DRs confirmed on OES activation report (1-day lag) | `oes_activations` | Purple |
| **Not Reviewed** | DRs not yet QA reviewed | `dr_photo_unified_reviews` (vlm_status != 'approved') | Yellow |
| **Reviewed** | DRs QA reviewed and approved | `dr_photo_unified_reviews` (vlm_status = 'approved') | Green |

## Data Flow

```
WhatsApp Groups → qa_photo_reviews → dr_photo_unified_reviews
                                          ↓
OES Excel Import → oes_activations ←--→ Compare
                                          ↓
                    drops table (zone_no, pon_no) ← Zone/PON data
```

## Database Tables

### `qa_photo_reviews` - WhatsApp Submissions (Installed)
- **Source**: WhatsApp groups via WA Monitor
- **Key Fields**:
  - `drop_number` - Unique DR identifier
  - `project` - Project name (Lawley, Mohadin, etc.)
  - `user_name` - Field agent name
  - `sender_phone` - Field agent phone
  - `whatsapp_message_date` - When DR was submitted
  - `created_at` - Fallback date

### `oes_activations` - OES Report Data (Activated)
- **Source**: Manual Excel import from OES
- **Key Fields**:
  - `drop_number` - Unique DR identifier
  - `serial_number` - ONT serial from OES
  - `team` - Installation team
  - `activation_date` - When activated in OES
  - `status` - Activation status

### `dr_photo_unified_reviews` - QA Review Status (Complete/Incomplete)
- **Source**: VLM AI categorization + HITL review
- **Key Fields**:
  - `drop_number` - Unique DR identifier
  - `project` - Project name
  - `vlm_categorization_status` - 'approved' = Complete
  - `ont_serial_scanned` - ONT serial from photo
  - `ups_serial_scanned` - UPS serial from photo
  - `steps_completed` - Number of completed steps

### `drops` - SOW Data (Zone/PON)
- **Source**: SOW Excel import
- **Key Fields**:
  - `drop_number` - Unique DR identifier
  - `zone_no` - Zone number (1, 2, 3...)
  - `pon_no` - PON number within zone

## Report Types

### 1. Daily Counts Report
**Endpoint**: `/api/activate/reporting/daily-counts`
**Purpose**: Zone/PON breakdown by project with hierarchical accordion

```
▶ Lawley         Total: 45 | Installed: 45 | Activated: 42 | Incomplete: 3 | Complete: 42
  ▼ Zone 1       Total: 20 | Installed: 20 | Activated: 19 | Incomplete: 1 | Complete: 19
    • PON 1.1    8 | 8 | 8 | 0 | 8
    • PON 1.2    7 | 7 | 6 | 1 | 6
```

**SQL Pattern**:
```sql
SELECT qpr.drop_number, qpr.project, d.zone_no, d.pon_no,
       CASE WHEN upr.vlm_categorization_status = 'approved' THEN true ELSE false END as is_complete,
       CASE WHEN oes.drop_number IS NOT NULL THEN true ELSE false END as is_activated
FROM qa_photo_reviews qpr
LEFT JOIN drops d ON d.drop_number = qpr.drop_number
LEFT JOIN dr_photo_unified_reviews upr ON upr.drop_number = qpr.drop_number
LEFT JOIN oes_activations oes ON oes.drop_number = qpr.drop_number
WHERE COALESCE(qpr.whatsapp_message_date, qpr.created_at)::DATE BETWEEN $1 AND $2
```

### 2. Discrepancy Report
**Endpoint**: `/api/activate/reporting/discrepancy`
**Purpose**: Compare WhatsApp vs OES (1-day lag)

| Status | Meaning | Color |
|--------|---------|-------|
| Matched | In both WA and OES | Green |
| WA Only | Submitted but not yet activated | Yellow |
| OES Only | In OES but not from WA (manual install?) | Orange |

**SQL Pattern**:
```sql
WITH wa AS (SELECT * FROM qa_photo_reviews WHERE date = $1),
     oes AS (SELECT * FROM oes_activations WHERE activation_date = $2)
SELECT COALESCE(wa.drop_number, oes.drop_number),
       CASE WHEN wa.drop_number IS NOT NULL AND oes.drop_number IS NOT NULL THEN 'matched'
            WHEN wa.drop_number IS NOT NULL THEN 'wa_only'
            ELSE 'oes_only' END
FROM wa FULL OUTER JOIN oes ON wa.drop_number = oes.drop_number
```

### 3. Serial Validation Report
**Endpoint**: `/api/activate/reporting/serial-validation`
**Purpose**: ONT/UPS serial matching between WA and OES

| Status | Meaning | Severity |
|--------|---------|----------|
| match | Serials match perfectly | OK |
| mismatch | Wrong ONT installed | CRITICAL |
| missing_wa | No serial from WhatsApp | Warning |
| missing_oes | No serial from OES | Warning |

### 4. User/Team Attribution Report
**Endpoint**: `/api/activate/reporting/user-attribution`
**Purpose**: Performance metrics by field agent and installation team

**User Metrics** (from WhatsApp):
- Installed count
- Complete count
- Completion rate %
- Activation rate %
- Serial compliance rate %

**Team Metrics** (from OES):
- Total activations
- Matched to WA
- Match rate %

### 5. Trends Report
**Endpoint**: `/api/activate/reporting/trends`
**Purpose**: Velocity trends with configurable grouping

**Query Params:**
- `dateFrom`, `dateTo`: Date range
- `groupBy`: 'day' | 'week' | 'month'
- `project`: Filter by project

**Returns**: Array of time-grouped metrics:
- Installed count
- Activated count
- Reviewed count
- Pass/Fail/Rework counts

### 6. Funnel Report
**Endpoint**: `/api/activate/reporting/funnel`
**Purpose**: QA workflow funnel analysis

**Stages:**
1. WhatsApp Submitted → Photos Fetched
2. Photos Fetched → Categorized
3. Categorized → QA Reviewed
4. QA Reviewed → Decision Made
5. Decision Made → Feedback Sent

**Returns**: Count and drop-off % per stage

### 7. Team Performance Report
**Endpoint**: `/api/activate/reporting/team-performance`
**Purpose**: Team leaderboard with velocity metrics

**Metrics per Team:**
- Total installs
- Activation rate %
- QA pass rate %
- Average time to activation
- Serial compliance %

### 8. Resubmissions Report
**Endpoint**: `/api/activate/reporting/resubmissions`
**Purpose**: Failed→Passed analysis

**Tracks:**
- DRs that failed QA then passed on resubmission
- Average resubmission count
- Common fail reasons that get fixed
- Time between initial fail and pass

## Common Queries

### "Which field agent had the most Complete installs?"
```sql
SELECT user_name, sender_phone, project,
       COUNT(*) FILTER (WHERE upr.vlm_categorization_status = 'approved') as complete
FROM qa_photo_reviews qpr
LEFT JOIN dr_photo_unified_reviews upr ON qpr.drop_number = upr.drop_number
WHERE qpr.whatsapp_message_date::DATE BETWEEN '2026-01-01' AND '2026-01-17'
GROUP BY user_name, sender_phone, project
ORDER BY complete DESC
LIMIT 10
```

### "Which field agent has the highest activation rate?"
```sql
SELECT user_name, project,
       COUNT(*) as installed,
       COUNT(*) FILTER (WHERE oes.drop_number IS NOT NULL) as activated,
       ROUND(100.0 * COUNT(*) FILTER (WHERE oes.drop_number IS NOT NULL) / COUNT(*), 1) as activation_rate
FROM qa_photo_reviews qpr
LEFT JOIN oes_activations oes ON qpr.drop_number = oes.drop_number
WHERE qpr.whatsapp_message_date::DATE >= CURRENT_DATE - INTERVAL '7 days'
GROUP BY user_name, project
HAVING COUNT(*) >= 5
ORDER BY activation_rate DESC
```

### "Show discrepancies for today"
Navigate to `/activate` → Reports tab → Discrepancy → Select "Today"

### "Show serial mismatches"
Navigate to `/activate` → Reports tab → Serial Validation → Check "Show mismatches only"

## API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/activate/drops` | GET | Main dashboard data with stats |
| `/api/activate/summary` | GET | DR summary for detail view |
| `/api/activate/export` | GET | Export filtered data to Excel (.xlsx) |
| `/api/activate/health-check` | GET | Service health status (DB, 1M, VLM, WA Bridge, WA Feedback) |
| `/api/activate/reporting/daily-counts` | GET | Zone/PON breakdown |
| `/api/activate/reporting/trends` | GET | Velocity trends (day/week/month) |
| `/api/activate/reporting/funnel` | GET | QA workflow funnel |
| `/api/activate/reporting/team-performance` | GET | Team leaderboard |
| `/api/activate/reporting/discrepancy` | GET | WA vs OES comparison |
| `/api/activate/reporting/serial-validation` | GET | Serial matching |
| `/api/activate/reporting/user-attribution` | GET | User/team performance |
| `/api/activate/reporting/resubmissions` | GET | Failed→Passed analysis |

### Excel Export
Export button available on Dashboard and QA Centre pages. Exports filtered data to `.xlsx` file.
- Respects current date range, project, and status filters
- Includes: DR number, project, submitted date, photo count, 10 steps, VLM status, sender info, activation status, QA decision

## Files

### Types
- `src/modules/activate/types/reporting.types.ts` - TypeScript interfaces for all 8 reports
- `src/modules/activate/types/summary.types.ts` - DR Summary types

### Services
- `src/modules/activate/services/reportingService.ts` - Database queries for all reports
- `src/modules/activate/services/activateDataService.ts` - Main data service

### Components
- `src/modules/activate/components/DrListPage.tsx` - Main page with all tabs
- `src/modules/activate/components/DrSummaryPage.tsx` - DR Summary landing tab
- `src/modules/activate/components/reporting/ReportsDashboard.tsx` - Reports container
- `src/modules/activate/components/reporting/ReportsTab.tsx` - Report type selection
- `src/modules/activate/components/reporting/TrendReports.tsx` - Velocity trends chart
- `src/modules/activate/components/reporting/FunnelReports.tsx` - Workflow funnel
- `src/modules/activate/components/reporting/TeamReports.tsx` - Team leaderboard
- `src/modules/activate/components/reporting/AnomalyReports.tsx` - WA-only/OES-only

### API Endpoints
- `pages/api/activate/reporting/daily-counts.ts` - Zone/PON breakdown
- `pages/api/activate/reporting/trends.ts` - Velocity trends
- `pages/api/activate/reporting/funnel.ts` - Workflow funnel
- `pages/api/activate/reporting/team-performance.ts` - Team leaderboard
- `pages/api/activate/reporting/discrepancy.ts` - WA vs OES
- `pages/api/activate/reporting/serial-validation.ts` - Serial matching
- `pages/api/activate/reporting/user-attribution.ts` - User metrics
- `pages/api/activate/reporting/resubmissions.ts` - Failed→Passed

### Context
- `src/modules/activate/context/ActivateDataContext.tsx` - Shared state with auto-refresh

## Usage Examples

1. **View today's stats**: Go to `/activate`, stats cards show Total/Installed/Activated/Incomplete/Complete
2. **Filter by project**: Use project dropdown in Dashboard tab
3. **View daily breakdown**: Go to Reports tab → Daily Counts
4. **Check discrepancies**: Go to Reports tab → Discrepancy
5. **Find serial issues**: Go to Reports tab → Serial Validation
6. **See agent performance**: Go to Reports tab → User/Team
