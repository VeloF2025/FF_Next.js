# Activate Reporting Skill

This skill provides comprehensive reporting and analytics for the Activate module.
Use when asking about DR stats, field agent performance, project metrics, or activation data.

## Terminology (CRITICAL - Consistent Across All Reports)

| Term | Definition | Source Table | Color |
|------|------------|--------------|-------|
| **Total** | Unique drops counted once at first install/activation | Derived (max of installed/activated) | Gray |
| **Installed** | DRs submitted via WhatsApp (installation done) | `qa_photo_reviews` | Blue |
| **Activated** | DRs confirmed on OES activation report (1-day lag) | `oes_activations` | Purple |
| **Incomplete** | DRs not yet QA reviewed (missing steps/photos) | `dr_photo_unified_reviews` | Yellow |
| **Complete** | DRs marked complete by HITL or AI (vlm_status='approved') | `dr_photo_unified_reviews` | Green |

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
| `/api/activate/export` | GET | Export filtered data to Excel (.xlsx) |
| `/api/activate/reporting/daily-counts` | GET | Zone/PON breakdown |
| `/api/activate/reporting/discrepancy` | GET | WA vs OES comparison |
| `/api/activate/reporting/serial-validation` | GET | Serial matching |
| `/api/activate/reporting/user-attribution` | GET | User/team performance |

### Excel Export
Export button available on Dashboard and QA Centre pages. Exports filtered data to `.xlsx` file.
- Respects current date range, project, and status filters
- Includes: DR number, project, submitted date, photo count, 10 steps, VLM status, sender info, activation status

## Files

### Types
- `src/modules/activate/types/reporting.types.ts` - TypeScript interfaces

### Services
- `src/modules/activate/services/reportingService.ts` - Database queries
- `src/modules/activate/services/activateDataService.ts` - Main data service

### Components
- `src/modules/activate/components/reporting/ReportsTab.tsx` - Main reports UI
- `src/modules/activate/components/DrListPage.tsx` - Dashboard with stats

### Context
- `src/modules/activate/context/ActivateDataContext.tsx` - Shared state

## Usage Examples

1. **View today's stats**: Go to `/activate`, stats cards show Total/Installed/Activated/Incomplete/Complete
2. **Filter by project**: Use project dropdown in Dashboard tab
3. **View daily breakdown**: Go to Reports tab → Daily Counts
4. **Check discrepancies**: Go to Reports tab → Discrepancy
5. **Find serial issues**: Go to Reports tab → Serial Validation
6. **See agent performance**: Go to Reports tab → User/Team
