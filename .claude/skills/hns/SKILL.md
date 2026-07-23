---
name: hns
description: Health and Safety management for FibreFlow. Audits, incidents, risks, CAPA, contractor gate, overdue alerts. USE WHEN user says '/hns', 'health and safety', 'H&S', 'safety incident', 'H&S audit', 'overdue audit', 'safety compliance', 'open incidents', 'incident report', 'CAPA', 'risk register'.
---

# /hns — Health & Safety Agent

Manages H&S compliance across FibreFlow projects: audits, incidents, risks, CAPA, contractor compliance. Full reference: `.claude/modules/health-safety.md`.

## Quick Reference

| Item | Value |
|------|-------|
| **Dashboard** | `/projects/health-safety` |
| **Incidents** | `/health-safety/incidents` (+`/new`, `/[id]`) |
| **Checklists** | `/health-safety/checklists` (+`/new`, `/[id]` editor) |
| **Risks / CAPA** | `/projects/health-safety/risks` · `/projects/health-safety/capa` |
| **Audit wizard** | `/health-safety/audits/[auditId]` |
| **Project tab** | `/projects/[id]?tab=health-safety` |

## DB Tables (live — see module doc for landmines)

| Table | Purpose |
|-------|---------|
| `hs_project_config` | Per-project audit config (template_id NULL = all-categories scope) |
| `hs_project_audits` + `hs_audit_responses` | Audits + per-item answers |
| `hs_checklist_templates` + `hs_checklist_items` | 8 templates, 44-item seed |
| `maintenance_tickets` + `hs_ticket_details` | Incidents (`source_type IN ('hse_incident','hse_near_miss')`) |
| `hs_risk_register` (+`_reviews`) | Risk register (generated score columns) |
| `hs_corrective_actions` + `hs_capa_comments` | CAPA |
| `hs_contractor_compliance` + `hs_contractor_documents` | Contractor gate inputs |
| `hs_activity_log` | Audit trail (`activity_type/description/metadata` — NOT action/details) |

## Common Tasks

### Open incidents
```sql
SELECT t.ticket_uid, t.title, hd.severity, hd.location, t.status, t.created_at, p.project_name
FROM maintenance_tickets t
JOIN hs_ticket_details hd ON hd.ticket_id = t.id
LEFT JOIN projects p ON p.id::text = t.project_id
WHERE t.source_type IN ('hse_incident', 'hse_near_miss')
  AND t.status NOT IN ('closed', 'resolved')
ORDER BY CASE hd.severity WHEN 'critical' THEN 1 WHEN 'major' THEN 2 WHEN 'moderate' THEN 3 ELSE 4 END,
         t.created_at DESC;
```

### Overdue audits
```sql
SELECT p.project_name, c.audit_frequency, c.next_audit_due::date,
       (NOW()::date - c.next_audit_due::date) AS days_overdue
FROM hs_project_config c
JOIN projects p ON p.id = c.project_id
WHERE c.is_active AND c.next_audit_due < NOW()
ORDER BY c.next_audit_due;
```

### Audit results (last 90 days)
```sql
SELECT p.project_name, a.audit_date::date, a.status, a.overall_score, a.rag_status,
       (SELECT count(*) FILTER (WHERE r.response='fail') FROM hs_audit_responses r WHERE r.audit_id=a.id) AS fails
FROM hs_project_audits a
JOIN projects p ON p.id = a.project_id
WHERE a.status IN ('completed','requires_action')  -- requires_action IS completed (with actions)
  AND a.audit_date > NOW() - INTERVAL '90 days'
ORDER BY a.audit_date DESC;
```

### Open CAPA / risk summary
```sql
SELECT ca.title, ca.severity, ca.status, ca.due_date,
       (ca.status NOT IN ('closed') AND ca.due_date < NOW()::date) AS overdue
FROM hs_corrective_actions ca WHERE ca.status != 'closed' ORDER BY ca.due_date;

SELECT risk_level, count(*) FROM hs_risk_register WHERE status='active' GROUP BY 1;
```

### Contractor gate state
```sql
SELECT c.company_name, hcc.overall_score, hcc.rag_status, hcc.is_gate_approved,
       hcc.gate_blockers, hcc.calculated_at
FROM hs_contractor_compliance hcc
JOIN contractors c ON c.id = hcc.contractor_id
ORDER BY hcc.overall_score NULLS FIRST;
```

## API Endpoints (all withAuth)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health-safety/dashboard` | Aggregated metrics incl. overdue audits |
| GET/POST | `/api/health-safety/incidents` (+ GET `/[incidentId]`) | Incidents |
| GET/POST | `/api/health-safety/project/[projectId]/audits` | Create seeds responses; 400 on empty scope |
| GET/PUT | `/api/health-safety/audits/[auditId]` | Wizard responses + completion scoring |
| GET/PUT | `/api/health-safety/project/[projectId]/config` | Config; template_id null = all categories |
| GET/POST/PUT/DELETE | `/api/health-safety/checklists` (+`/[id]`) | Template + item CRUD |
| GET/POST + PUT | `/api/health-safety/capa` (+`/[capaId]`) | CAPA; server-enforced transitions |
| GET/POST | `/api/health-safety/risks` | Risk register |
| GET/PUT | `/api/health-safety/contractor/[contractorId]/{compliance,documents,gate-check}` | uuid ids |
| POST | `/api/cron/hs-audit-reminders` | `x-cron-secret` header; Action Items for overdue audits |

## Severity / status vocab (live data)

- Incident severity: `critical` / `major` / `moderate` / `minor`
- Audit status: `in_progress` / `completed` / `requires_action` (= completed with fails) / `cancelled`
- Audit RAG: red <50 · amber 50–79 · green ≥80 (critical fail caps score at 79)

## Troubleshooting

- **Audit wizard 0 items**: fixed 2026-07-23 — creation now 400s if the scope has no items. Check `hs_checklist_templates.is_active` + item counts.
- **Risk/CAPA "Failed" toast but row saved**: was the hs_activity_log schema drift — fixed; all writes go through `logHsActivity()`. If it recurs, check that no code writes `action/actor_id/details` columns.
- **Contractor endpoints 500**: ids are uuid — any `parseInt(contractorId)` reintroduction breaks them.
- **Incident POST 500**: `created_by` must be threaded to `createTicket` (NOT NULL uuid).

## Related
- `.claude/modules/health-safety.md` — full module reference
- `docs/plans/health-safety-e2e-goal.md` — 2026-07-23 remediation plan
