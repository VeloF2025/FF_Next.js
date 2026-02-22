# Module: health-safety

> **Last updated:** 2026-02-22  
> **Path:** `src/modules/health-safety/`  
> **Status:** Active  
> **Complexity:** Medium

## Overview

Health & Safety audit compliance tracking and management. Monitors regulatory compliance, audit trails, and safety incident reporting across FibreFlow projects.

| Property | Value |
|----------|-------|
| **Purpose** | Track H&S compliance, incidents, audits, and regulations by project |
| **Primary use** | Project safety audits, incident documentation, compliance verification |
| **Status** | Active (integrated into project detail pages) |
| **Category** | admin/compliance |

## Core Concepts

### H&S Audit Workflow

Projects can be audited for H&S compliance:
- Audit triggered via project detail page (H&S tab)
- Checklist of safety requirements assessed
- Compliance score calculated (% of requirements met)
- Audit history maintained for trend analysis

### Incident Tracking

Safety incidents logged with:
- Incident type (near-miss, minor, major, lost-time)
- Date and location
- Description and root cause analysis
- Corrective actions
- Follow-up verification

### Regulatory Compliance

Tracks jurisdiction-specific H&S requirements:
- South African OHSA (Occupational Health and Safety Act)
- Industry-specific standards (fiber optics, telecommunications)
- Municipal/provincial regulations
- Client-specific safety requirements

## Database

### Tables
- `h_and_s_audits` — Audit records with date, project_id, compliance_score, auditor
- `h_and_s_incidents` — Incident log (type, severity, date, location, description)
- `h_and_s_corrective_actions` — Actions taken in response to incidents/audits
- `h_and_s_compliance_requirements` — Jurisdiction/industry requirements checklist
- `h_and_s_audit_history` — Historical audit trends by project

## Components

| Component | Purpose |
|-----------|---------|
| H&S Tab (project detail) | Display audit status, recent incidents, compliance score |
| Audit Modal | Trigger audit, fill checklist, calculate score |
| Incident Form | Log new safety incident with severity classification |
| Compliance Dashboard | Organization-wide H&S metrics and trends |
| Corrective Action Tracker | Monitor and close corrective actions |

## Hooks

- `useHSAudits()` — Fetch project's audit history
- `useHSIncidents()` — Fetch incidents for a project or time period
- `useComplianceStatus()` — Get current compliance score and status
- `useCorrectiveActions()` — Track open corrective actions

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/projects/[projectId]/h-and-s/summary` | H&S status for project |
| GET | `/api/projects/[projectId]/h-and-s/audits` | Audit history |
| POST | `/api/projects/[projectId]/h-and-s/audits` | Create new audit |
| GET | `/api/projects/[projectId]/h-and-s/incidents` | Incident log |
| POST | `/api/projects/[projectId]/h-and-s/incidents` | Report incident |
| GET | `/api/h-and-s/compliance-requirements` | List requirements by jurisdiction |
| PATCH | `/api/projects/[projectId]/h-and-s/corrective-actions/[id]` | Update corrective action status |

## Severity Levels

| Level | Threshold | Action |
|-------|-----------|--------|
| **Green** | 90%+ compliance | Routine monitoring |
| **Yellow** | 70–89% compliance | Improvement plan required |
| **Red** | <70% compliance | Project halt / remediation required |

## Recent Changes

- **Feb 2026:** Enhanced H&S integration into project detail wayleaves tab
- **Feb 2026:** Dark theme compliance fixes (dark variants added)
- **Jan 2026:** Core H&S module created with audit workflow

## Related

- `/projects` — Project module (H&S tab integrated)
- `/skills/modules/incident-management.md` — Incident management procedures
- `docs/REGULATORY-COMPLIANCE.md` — Detailed regulatory requirements by jurisdiction
