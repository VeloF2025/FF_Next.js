# Activate Reporting Patterns

> SQL patterns and best practices for the Activate module's reporting service

## Key Tables

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `dr_photo_unified_reviews` | WA submissions (installed) | `drop_number`, `project`, `submitted_date`, `final_decision` |
| `oes_activations` | Nokia activations (OES report) | `drop_number`, `activation_date` |
| `drops` | SOW-imported valid DRs | `drop_number`, `project_id`, `zone_no`, `pon_no` |

## Critical: Always INNER JOIN to drops

The `drops` table is the **source of truth** for valid DR numbers. Any DR not in this table is invalid (typo, wrong project, test data).

```sql
-- ✅ CORRECT: Only count valid DRs
SELECT COUNT(DISTINCT upr.drop_number) as installed
FROM dr_photo_unified_reviews upr
INNER JOIN drops d ON d.drop_number = upr.drop_number
WHERE upr.submitted_date >= $1 AND upr.submitted_date <= $2

-- ❌ WRONG: Counts invalid DRs too
SELECT COUNT(DISTINCT upr.drop_number) as installed
FROM dr_photo_unified_reviews upr
LEFT JOIN drops d ON d.drop_number = upr.drop_number
WHERE upr.submitted_date >= $1 AND upr.submitted_date <= $2
```

## Daily Counts Query Pattern

```sql
-- Installed DRs (from WhatsApp submissions)
SELECT
  upr.drop_number,
  upr.project,
  COALESCE(d.zone_no, 0) as zone_no,
  COALESCE(d.pon_no, 0) as pon_no,
  d.pole_number as pole_no
FROM dr_photo_unified_reviews upr
INNER JOIN drops d ON d.drop_number = upr.drop_number
WHERE upr.submitted_date >= $1::DATE
  AND upr.submitted_date <= $2::DATE
  AND ($3::TEXT IS NULL OR upr.project = $3);

-- Activated DRs (from OES report)
SELECT DISTINCT
  oes.drop_number,
  COALESCE(upr.project, 'Unknown') as project,
  COALESCE(d.zone_no, 0) as zone_no,
  COALESCE(d.pon_no, 0) as pon_no,
  d.pole_number as pole_no
FROM oes_activations oes
INNER JOIN drops d ON d.drop_number = oes.drop_number
LEFT JOIN dr_photo_unified_reviews upr ON upr.drop_number = oes.drop_number
WHERE oes.activation_date >= $1::DATE
  AND oes.activation_date <= $2::DATE
  AND ($3::TEXT IS NULL OR upr.project = $3 OR upr.project IS NULL);
```

## Trend Analysis CTE Pattern

```sql
WITH wa_counts AS (
  SELECT
    COALESCE(upr.submitted_date, upr.created_at::DATE) as date_val,
    COUNT(DISTINCT upr.drop_number) as installed
  FROM dr_photo_unified_reviews upr
  INNER JOIN drops d ON d.drop_number = upr.drop_number
  WHERE upr.submitted_date >= $1::DATE
    AND upr.submitted_date <= $2::DATE
  GROUP BY 1
),
oes_counts AS (
  SELECT
    oes.activation_date as date_val,
    COUNT(DISTINCT oes.drop_number) as activated
  FROM oes_activations oes
  INNER JOIN drops d ON d.drop_number = oes.drop_number
  WHERE oes.activation_date >= $1::DATE
    AND oes.activation_date <= $2::DATE
  GROUP BY 1
)
SELECT
  COALESCE(wa.date_val, oes.date_val) as date,
  COALESCE(wa.installed, 0) as installed,
  COALESCE(oes.activated, 0) as activated
FROM wa_counts wa
FULL OUTER JOIN oes_counts oes ON wa.date_val = oes.date_val
ORDER BY date;
```

## Project Name Gotcha

The `drops` table does NOT have a `project_name` column - only `project_id` (UUID).

```sql
-- ❌ WRONG: d.project_name doesn't exist
SELECT d.project_name FROM drops d

-- ✅ CORRECT: Use upr.project (already stored)
SELECT upr.project FROM dr_photo_unified_reviews upr

-- ✅ CORRECT: Or JOIN to projects table
SELECT p.project_name
FROM drops d
LEFT JOIN projects p ON d.project_id = p.id
```

## Report Types

| Report | API Endpoint | Key Metric |
|--------|-------------|------------|
| Daily Counts | `/api/activate/reporting/daily-counts` | Installed vs Activated per day |
| Trends | `/api/activate/reporting/trends` | Time series with per-project breakdown |
| Funnel | `/api/activate/reporting/funnel` | Conversion through QA phases |
| Team Performance | `/api/activate/reporting/team-performance` | Throughput by team member |
| Anomalies | (frontend calculation) | WA Only, OES Only, Matched |

## Key Files

| File | Purpose |
|------|---------|
| `src/modules/activate/services/reportingService.ts` | Main reporting service |
| `pages/api/activate/reporting/daily-counts.ts` | Daily counts API |
| `pages/api/activate/reporting/trends.ts` | Trends API |
| `src/modules/activate/components/reporting/` | Report UI components |

## Anomaly Calculation (Frontend)

```typescript
const matched = installedDRs.filter(dr => activatedDRs.includes(dr));
const waOnly = installedDRs.filter(dr => !activatedDRs.includes(dr));
const oesOnly = activatedDRs.filter(dr => !installedDRs.includes(dr));

// Match rate = matched / total unique DRs
const matchRate = (matched.length / new Set([...installedDRs, ...activatedDRs]).size) * 100;
```
