---
name: kpi
description: KPI and analytics queries for FibreFlow — project performance, team productivity, activation rates, procurement metrics
version: 1.0.0
triggers:
  - /kpi
  - KPI
  - analytics query
  - project performance
  - which projects are behind
  - team performance
  - activation rate
  - weekly summary
  - performance report
  - progress metrics
  - how is project X doing
  - productivity report
---

# /kpi — KPI Analytics Agent

Answers business intelligence questions about project performance, team productivity, and operational metrics using direct DB queries.

## Quick Reference

| Item | Value |
|------|-------|
| **Analytics UI** | `/analytics` |
| **KPI Dashboard** | `/kpi-dashboard` |
| **Enhanced KPIs** | `/enhanced-kpis` |
| **API** | `/api/analytics/dashboard/*` |

## Project Performance

### Overall Project Status
```sql
-- All active projects with progress
SELECT
  p.name,
  p.status,
  p.project_code,
  p.total_poles,
  p.total_drops,
  p.start_date,
  p.target_completion_date,
  ROUND(
    100.0 * p.completed_poles / NULLIF(p.total_poles, 0), 1
  ) as poles_pct,
  ROUND(
    100.0 * p.completed_drops / NULLIF(p.total_drops, 0), 1
  ) as drops_pct
FROM projects p
WHERE p.status IN ('active', 'in_progress')
ORDER BY p.start_date DESC;
```

### Projects Behind Schedule
```sql
-- Projects where actual progress < expected (linear schedule)
WITH expected AS (
  SELECT
    id,
    name,
    total_drops,
    start_date,
    target_completion_date,
    CASE
      WHEN target_completion_date > CURRENT_DATE THEN
        ROUND(
          100.0 * (CURRENT_DATE - start_date) /
          NULLIF(target_completion_date - start_date, 0), 1
        )
      ELSE 100
    END as expected_pct
  FROM projects
  WHERE status = 'active'
)
SELECT
  e.name,
  e.expected_pct as expected_progress,
  ROUND(100.0 * p.completed_drops / NULLIF(p.total_drops, 0), 1) as actual_progress,
  e.expected_pct - ROUND(100.0 * p.completed_drops / NULLIF(p.total_drops, 0), 1) as gap
FROM expected e
JOIN projects p ON p.id = e.id
WHERE e.expected_pct > ROUND(100.0 * p.completed_drops / NULLIF(p.total_drops, 0), 1) + 5
ORDER BY gap DESC;
```

### Weekly Progress Summary
```sql
-- Daily progress this week by project
SELECT
  p.name as project,
  DATE(dp.date) as date,
  SUM(dp.poles_completed) as poles,
  SUM(dp.drops_completed) as drops,
  SUM(dp.fibre_laid_m) as fiber_m
FROM daily_progress dp
JOIN projects p ON dp.project_id = p.id
WHERE dp.date >= DATE_TRUNC('week', CURRENT_DATE)
GROUP BY p.name, DATE(dp.date)
ORDER BY p.name, date;
```

## Activation Metrics

### DR Submission Rate
```sql
-- DRs submitted per project this month
SELECT
  project,
  COUNT(*) as total_drs,
  SUM(CASE WHEN vlm_status = 'approved' THEN 1 ELSE 0 END) as approved,
  SUM(CASE WHEN vlm_status = 'failed' THEN 1 ELSE 0 END) as failed,
  SUM(CASE WHEN vlm_status = 'pending' THEN 1 ELSE 0 END) as pending,
  ROUND(
    100.0 * SUM(CASE WHEN vlm_status = 'approved' THEN 1 ELSE 0 END) / COUNT(*), 1
  ) as approval_rate
FROM foto_ai_reviews
WHERE created_at >= DATE_TRUNC('month', CURRENT_DATE)
GROUP BY project
ORDER BY approval_rate DESC;

-- Daily DR volume trend
SELECT
  DATE(created_at) as date,
  COUNT(*) as drs,
  SUM(CASE WHEN vlm_status = 'approved' THEN 1 ELSE 0 END) as approved
FROM foto_ai_reviews
WHERE created_at >= CURRENT_DATE - INTERVAL '30 days'
GROUP BY DATE(created_at)
ORDER BY date;
```

## Procurement Metrics

### Procurement Summary
```sql
-- PO value by status
SELECT
  status,
  COUNT(*) as po_count,
  SUM(total_amount) as total_value
FROM purchase_orders
GROUP BY status
ORDER BY total_value DESC;

-- GRN completion rate
SELECT
  COUNT(*) as total_grns,
  SUM(CASE WHEN status = 'confirmed' THEN 1 ELSE 0 END) as confirmed,
  ROUND(
    100.0 * SUM(CASE WHEN status = 'confirmed' THEN 1 ELSE 0 END) / COUNT(*), 1
  ) as confirmation_rate
FROM goods_receipt_notes
WHERE created_at >= CURRENT_DATE - INTERVAL '30 days';

-- Stock movement velocity
SELECT
  si.name as item,
  COUNT(smi.id) as movement_count,
  SUM(CASE WHEN sm.movement_type = 'out' THEN smi.quantity ELSE 0 END) as total_issued,
  SUM(CASE WHEN sm.movement_type = 'in' THEN smi.quantity ELSE 0 END) as total_received
FROM stock_movement_items smi
JOIN stock_movements sm ON sm.id = smi.stock_movement_id
JOIN stock_items si ON si.id = smi.stock_item_id
WHERE sm.created_at >= CURRENT_DATE - INTERVAL '30 days'
  AND sm.status = 'completed'
GROUP BY si.name
ORDER BY movement_count DESC
LIMIT 20;
```

## Team Performance

### Field Team Productivity
```sql
-- Drops completed per team this week
SELECT
  t.name as team,
  SUM(dp.drops_completed) as drops_this_week,
  SUM(dp.poles_completed) as poles_this_week,
  COUNT(DISTINCT dp.date) as active_days,
  ROUND(SUM(dp.drops_completed) / NULLIF(COUNT(DISTINCT dp.date), 0), 1) as avg_drops_per_day
FROM daily_progress dp
JOIN teams t ON dp.team_id = t.id
WHERE dp.date >= DATE_TRUNC('week', CURRENT_DATE)
GROUP BY t.name
ORDER BY drops_this_week DESC;
```

## API Endpoints (Analytics)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/analytics/dashboard/stats` | Dashboard stats |
| GET | `/api/analytics/dashboard/summary` | Summary data |
| GET | `/api/analytics/dashboard/trends` | Trend data |
| GET | `/api/analytics/projects/summary` | Per-project summary |

## Key DB Tables

| Table | Key Metrics |
|-------|------------|
| `projects` | `total_poles`, `completed_poles`, `total_drops`, `completed_drops` |
| `daily_progress` | Per-day team output (poles, drops, fibre) |
| `foto_ai_reviews` | DR submission + VLM approval rates |
| `purchase_orders` | PO counts and values by status |
| `goods_receipt_notes` | GRN confirmation rates |
| `stock_items` | Inventory levels, low stock |

## Common Questions → Queries

| Question | Query Focus |
|----------|------------|
| "Which projects are behind?" | `projects` vs schedule |
| "What's our activation rate?" | `foto_ai_reviews.vlm_status` |
| "Which team is most productive?" | `daily_progress` grouped by team |
| "How much stock do we have?" | `stock_items.qty_available` |
| "What's our GRN backlog?" | `goods_receipt_notes WHERE status != 'confirmed'` |
| "Which contractors owe stock?" | `contractor_stock_accountability.outstanding_value` |

## Notes on Analytics Module State

- `useAnalyticsData` currently returns **mock data** (no real API call)
- `useDashboardData` has real API integration
- Direct DB queries (above) are more reliable than the UI analytics
- Enhanced KPIs (`/enhanced-kpis`) has more complete real-data implementation

## Related
- `.claude/modules/analytics.md` — Analytics module state
- `.claude/modules/kpi-dashboard.md` — KPI dashboard module
- `/db` skill — Safe query execution patterns
