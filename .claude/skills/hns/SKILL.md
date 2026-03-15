---
name: hns
description: Health and Safety management for FibreFlow. Incidents, checklists, compliance tracking, overdue alerts. USE WHEN user says '/hns', 'health and safety', 'H&S', 'safety incident', 'H&S checklist', 'overdue checklist', 'safety compliance', 'open incidents', 'incident report'.
---


# /hns — Health & Safety Agent

Manages H&S compliance across all FibreFlow projects: incidents, checklists, and compliance reporting.

## Quick Reference

| Item | Value |
|------|-------|
| **UI** | `/health-safety` |
| **Checklists** | `/health-safety/checklists` |
| **Incidents** | `/health-safety/incidents` |
| **New Incident** | `/health-safety/incidents/new` |

## Common Tasks

### Check Open Incidents
```sql
-- All open incidents (not closed)
SELECT
  i.id,
  i.incident_type,
  i.severity,
  i.description,
  i.location,
  i.reported_by,
  i.created_at,
  p.name as project
FROM health_safety_incidents i
LEFT JOIN projects p ON i.project_id = p.id
WHERE i.status != 'closed'
ORDER BY
  CASE i.severity
    WHEN 'critical' THEN 1
    WHEN 'high' THEN 2
    WHEN 'medium' THEN 3
    WHEN 'low' THEN 4
    ELSE 5
  END,
  i.created_at DESC;

-- Critical incidents requiring immediate action
SELECT * FROM health_safety_incidents
WHERE severity = 'critical' AND status = 'open';

-- Incidents by project this month
SELECT
  p.name as project,
  i.severity,
  COUNT(*) as count
FROM health_safety_incidents i
JOIN projects p ON i.project_id = p.id
WHERE i.created_at >= DATE_TRUNC('month', CURRENT_DATE)
GROUP BY p.name, i.severity
ORDER BY p.name, count DESC;
```

### Check Overdue Checklists
```sql
-- Checklists due today or overdue (not completed)
SELECT
  c.id,
  c.checklist_type,
  c.due_date,
  c.assigned_to,
  p.name as project,
  CURRENT_DATE - c.due_date as days_overdue
FROM health_safety_checklists c
LEFT JOIN projects p ON c.project_id = p.id
WHERE c.status != 'completed'
  AND c.due_date <= CURRENT_DATE
ORDER BY c.due_date ASC;

-- Completion rate by project
SELECT
  p.name as project,
  COUNT(*) as total_checklists,
  SUM(CASE WHEN c.status = 'completed' THEN 1 ELSE 0 END) as completed,
  ROUND(
    100.0 * SUM(CASE WHEN c.status = 'completed' THEN 1 ELSE 0 END) / COUNT(*),
    1
  ) as completion_pct
FROM health_safety_checklists c
JOIN projects p ON c.project_id = p.id
WHERE c.due_date >= CURRENT_DATE - INTERVAL '30 days'
GROUP BY p.name
ORDER BY completion_pct ASC;
```

### Generate Safety Report
```sql
-- Monthly safety summary
SELECT
  DATE_TRUNC('month', created_at) as month,
  COUNT(*) as total_incidents,
  SUM(CASE WHEN severity = 'critical' THEN 1 ELSE 0 END) as critical,
  SUM(CASE WHEN severity = 'high' THEN 1 ELSE 0 END) as high,
  SUM(CASE WHEN severity = 'medium' THEN 1 ELSE 0 END) as medium,
  SUM(CASE WHEN severity = 'low' THEN 1 ELSE 0 END) as low,
  SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END) as resolved
FROM health_safety_incidents
WHERE created_at >= CURRENT_DATE - INTERVAL '12 months'
GROUP BY month
ORDER BY month DESC;
```

## DB Tables

| Table | Purpose |
|-------|---------|
| `health_safety_incidents` | Incident reports |
| `health_safety_checklists` | Scheduled compliance checklists |
| `health_safety_checklist_items` | Individual checklist line items |

## Incident Severity Levels

| Level | Response Time | Description |
|-------|--------------|-------------|
| `critical` | Immediate | Life-threatening, stop work |
| `high` | Same day | Serious injury risk |
| `medium` | 48 hours | Moderate risk |
| `low` | 7 days | Minor, no immediate danger |

## Incident Statuses

| Status | Description |
|--------|-------------|
| `open` | Reported, under investigation |
| `investigating` | Active investigation |
| `remediated` | Fix applied, monitoring |
| `closed` | Fully resolved and documented |

## Checklist Types

Typically includes:
- **Pre-work safety checks** — Before starting on site
- **Daily toolbox talks** — Daily safety briefings
- **PPE compliance** — Personal Protective Equipment checks
- **Equipment inspection** — Tool and machinery checks
- **Site sign-off** — End of day site clearance

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health-safety/incidents` | List incidents |
| POST | `/api/health-safety/incidents` | Create incident |
| PATCH | `/api/health-safety/incidents/[id]` | Update incident |
| GET | `/api/health-safety/checklists` | List checklists |
| POST | `/api/health-safety/checklists` | Create checklist |
| PATCH | `/api/health-safety/checklists/[id]` | Complete checklist |

## Compliance Reporting

```sql
-- Contractor compliance summary
SELECT
  c.company_name,
  COUNT(i.id) as incidents,
  COUNT(DISTINCT ch.id) as checklists_assigned,
  SUM(CASE WHEN ch.status = 'completed' THEN 1 ELSE 0 END) as checklists_done
FROM contractors c
LEFT JOIN health_safety_incidents i ON i.contractor_id = c.id
  AND i.created_at >= CURRENT_DATE - INTERVAL '30 days'
LEFT JOIN health_safety_checklists ch ON ch.contractor_id = c.id
  AND ch.due_date >= CURRENT_DATE - INTERVAL '30 days'
GROUP BY c.company_name
ORDER BY incidents DESC;
```

## Troubleshooting

### Missing Incident Data
- Check that `project_id` is set on all incidents
- Verify contractor linking if contractor-specific reports needed

### Overdue Alerts Not Showing
- Confirm `due_date` column is populated on checklists
- Verify UI filter is not excluding past-due items

## Related
- `.claude/modules/projects.md` — Project context
- `.claude/modules/contractors.md` — Contractor compliance tracking
