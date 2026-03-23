# NOC (Network Operations Centre) Module

**Last Updated:** 2026-03-11  
**Commit:** 96d8cc9  
**Status:** Production (v2.0+)

## Overview

The NOC module (formerly Maintenance) provides centralized ticket management, escalation tracking, risk acceptance workflows, and data synchronization for network operations and maintenance coordination. It integrates with QContact for team management, handles Power+ (PP) data ticket enrichment, and tracks repeat faults with automated escalation.

## Module Purpose

- **Ticket Lifecycle Management** — Create, track, and resolve maintenance tickets with integrated escalation pipelines
- **Data Synchronization** — QContact sync, alignment reporting, weekly imports, and WhatsApp tracking
- **Escalation Handling** — Automated repeat-fault detection and escalation alerts
- **Risk Acceptance** — Review, approve, and track risk acceptance workflows for ongoing risks
- **Team Management** — Maintain team structure, roles, and responsibilities
- **PP Data Enrichment** — Automatically enrich Power+ (PP) data tickets with project metadata, location data, PON, GPS, and client contact information

## Key Features

### 1. Ticketing Dashboard
- Real-time ticket overview with SLA tracking
- Quick-action ticket creation and assignment
- Status filtering and sorting by priority/team

### 2. Data Synchronization Workflows
- **QContact Integration** — Manual sync triggers with audit logging and alignment reports
- **Three-Way Alignment** — Compare QContact teams vs local team assignments vs PP tickets
- **Weekly Imports** — Bulk import facility with progress tracking and error handling
- **WhatsApp Tracking** — Monitor WA conversations linked to tickets

### 3. Escalations & Alerts
- **Repeat Fault Detection** — Identify recurring faults with geographic clustering
- **Escalation Alerts** — Automatic notifications when escalation thresholds are breached
- **Fault Trend Analysis** — Historical analysis of fault patterns by geography and category

### 4. Handover Management
- Pending handover queue with driver/site/coordinator handover types
- Bulk handover operations with status tracking

### 5. Risk Acceptance Workflows
- Active risk review with expiration tracking
- Risk resolution with notes and compliance logging

### 6. Team Management
- Role-based team structure (NOC Coordinator, Team Lead, Technician)
- Team assignment and capacity tracking

## API Endpoints

### Ticket & Data Management
- **GET** `/api/noc/dashboard/summary` — Retrieve ticket summary stats (SLA, count by status)
- **GET** `/api/noc/dashboard/sla` — SLA compliance details by team
- **GET** `/api/noc/dashboard/workload` — Workload distribution across teams
- **GET** `/api/noc/dr-lookup/[drNumber]` — Look up ticket by DR number
- **GET** `/api/noc/attachments/[id]` — Retrieve ticket attachment
- **POST** `/api/noc/attachments` — Upload ticket attachment
- **PATCH** `/api/noc/attachments/[id]` — Update attachment metadata

### Escalations
- **GET** `/api/noc/escalations` — List active escalations with alert status
- **GET** `/api/noc/escalations/[id]` — Retrieve escalation details
- **POST** `/api/noc/escalations/[id]/resolve` — Mark escalation as resolved

### Handovers
- **GET** `/api/noc/handovers/pending` — List pending handovers (filterable by type)
- **POST** `/api/noc/handovers/import/weekly/[id]/progress` — Retrieve weekly import progress

### Risk Acceptance
- **GET** `/api/noc/risk-acceptances` — Query risks (filterable: active, expiring, resolved)
- **POST** `/api/noc/risk-acceptances/[id]/resolve` — Resolve a risk acceptance record

### Analytics
- **GET** `/api/noc/analytics/fault-trends` — Historical fault trend analysis by geography/category

### QContact Sync
- **POST** `/api/noc/cron/sync-qcontact` — Trigger manual QContact synchronization

### PP Data Ticket Enrichment
- **PATCH** `/api/activate/pp-data-tickets` — Backfill existing tickets with project data, location, PON, GPS, and client metadata

## Data Enrichment (PP Data Tickets)

The NOC module automatically enriches Power+ (PP) data tickets with comprehensive project and location information:

### Enrichment Data Sources
- **Project & Location Data** — Linked from `drops` table and `onemap_properties`
- **Fields Enriched:**
  - `project_id` — Associated project (set on all new/backfilled tickets)
  - `address` — Full street address from location data
  - `zone` — Service zone classification
  - `PON` — Point-of-Network identifier
  - `GPS` — Geographic coordinates (latitude, longitude)
  - `client_name` — Client contact name
  - `client_email` — Client email address
  - `client_contact` — Client phone/contact info

### Backfill Operation
- **Commit 96d8cc9** backfilled **372 existing PP tickets** across all projects
- All tickets now include `project_id`
- 7 tickets with associated Delivery Records (DRs) enriched with zone/PON/GPS/address/client data
- Backfill is idempotent — safe to re-run

### Usage
```bash
# Backfill existing tickets with available project data
PATCH /api/activate/pp-data-tickets

# Response includes: tickets_updated, tickets_with_dr, enrichment_summary
```

## Bug Fixes (Commit 96d8cc9)

### PP Data Ticket Creation
- **Issue:** Assigned team name→UUID mismatch caused 500 error when team selection happened
- **Fix:** Correct team object serialization in ticket creation payload

### Error Messaging
- **Issue:** API errors displayed as `[object Object]` toast notifications
- **Fix:** Extract and display `error.message` from API response bodies

## Module Structure

### Frontend Components (`app/(main)/noc/`)
- **Dashboard** — Main landing page with ticket summary
- **Data Sync** — QContact sync, alignment, weekly imports, WA tracking
- **Escalations** — Repeat fault alerts and escalation list/map
- **Handovers** — Pending handover queue and history
- **Risks** — Active risk acceptance reviews
- **Teams** — Team management and RBAC
- **Tickets** — Individual ticket detail page and list
- **Tickets/New** — New ticket creation wizard

### API Routes (`app/api/noc/`)
- **analytics/fault-trends** — Fault trend analysis pipeline
- **attachments/[id]** — Attachment CRUD operations
- **cron/sync-qcontact** — Scheduled QContact sync
- **dashboard/** — Summary, SLA, workload endpoints
- **dr-lookup/[drNumber]** — DR search functionality
- **escalations/** — Escalation list, detail, resolution
- **handovers/** — Pending queue and import tracking
- **import/** — Weekly import progress tracking
- **risk-acceptances/** — Risk query and resolution
- **teams/** — Team list and assignment

### Modules & Hooks
- **Components** — Reusable UI components (Dashboard, QContact, Escalation, Handover, Risk, Team components)
- **Hooks** — Custom React hooks for data fetching (useQContactSync, useTeams)
- **Types** — TypeScript type definitions (escalation, handover, riskAcceptance, team)
- **Utils** — Utility functions for data transformation

## Database Schema

### Primary Tables
- `noc_tickets` — Ticket master with status, SLA tracking
- `noc_escalations` — Escalation records with alert thresholds
- `noc_handovers` — Handover queue entries
- `noc_risk_acceptances` — Risk records with expiry and status
- `noc_teams` — NOC team structure and RBAC
- `noc_qcontact_sync` — Sync history and audit logs

### Related Tables
- `pp_data_tickets` — Power+ enriched data tickets
- `drops` — Location/project reference data
- `onemap_properties` — Geographic data source

## Integration Points

1. **QContact System** — Team data source for sync and alignment
2. **Activate Module** — PP data ticket creation and enrichment (via `/api/activate/pp-data-tickets`)
3. **Auth Module** — RBAC and user context
4. **Notification System** — Alert dispatch for escalations
5. **File Service** — Attachment storage and retrieval
6. **Analytics** — Fault trend aggregation

## Security Measures

- RBAC enforced at endpoint level (NOC Coordinator, Team Lead, Technician roles)
- Ticket assignment restricted to authorized teams
- Risk acceptance sign-off audit trail
- Escalation alert notifications sent only to assigned teams

## Testing & Validation

- Unit tests cover ticket creation, enrichment, escalation detection, and team assignment
- Integration tests validate QContact sync workflow and alignment reporting
- E2E tests cover handover queue and risk acceptance flows

## Dependencies

- `qcontact-sync-plugin` — QContact integration client
- `pp-data-enrichment` — Data enrichment pipeline
- `fault-detection` — Escalation threshold engine
- `audit-logger` — Compliance and audit trail recording

## Migration Notes

**From Maintenance → NOC (Commit 96d8cc9):**
- Complete directory rename: `/app/(main)/maintenance/` → `/app/(main)/noc/`
- Config rename: `maintenanceConfig` → `nocConfig`
- API path updates: `/api/maintenance/*` → `/api/noc/*`
- All imports updated throughout codebase (56 files)
- **BREAKING:** Any client-side links to `/maintenance/*` routes will 404 — update navigation
- **BREAKING:** API clients using `/api/maintenance/*` paths must update to `/api/noc/*`

## Deployment Checklist

- [ ] Verify QContact sync is functional (manual test via Data Sync > QContact)
- [ ] Test PP data ticket creation and enrichment (Activate module)
- [ ] Verify escalation alerts trigger on repeat faults
- [ ] Confirm team RBAC applies correctly to ticket assignments
- [ ] Test attachment upload/download
- [ ] Verify risk acceptance workflow end-to-end
- [ ] Check that all `/api/noc/*` endpoints return expected status codes
- [ ] Monitor for stale `/api/maintenance/*` requests in error logs (404s indicate client updates needed)

## Performance Notes

- QContact sync is asynchronous; large team imports may take 30-60 seconds
- Fault trend analysis queries last 90 days; older faults are archived
- Ticket search is indexed on `dr_number` and `status` for fast lookups

## Support & Escalation

For NOC module issues:
1. Check QContact sync status in Data Sync dashboard
2. Review alignment report for data mismatches
3. Check escalation alert thresholds vs recent fault volume
4. Verify team RBAC assignments
5. Contact Platform team for database schema questions

---

**Last Updated:** 2026-03-11 (Commit 96d8cc9)  
**Owner:** Platform Team  
**Status:** Production
