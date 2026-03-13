# NOC Module

**Module**: Network Operations Centre (NOC)
**Status**: Active — Production
**Last Updated**: 2026-03-13
**Source**: `src/modules/noc/` | `app/(main)/noc/` | `app/api/noc/`

---

## Overview

The NOC module is FibreFlow's central hub for managing fiber network faults, maintenance tickets, QA workflows, team handovers, and QContact synchronisation. It replaces six parallel Excel spreadsheets with a fully integrated digital workflow.

## History

This module was originally named **maintenance** (`src/modules/maintenance/`). It was renamed to **noc** in commit [`96d8cc9`](https://github.com) on 2026-03-11 to better reflect its scope — the module covers the full Network Operations Centre function, not just reactive maintenance.

The rename was a complete refactor: all directories, imports, exports, navigation config, sidebar sections, data-sync groups, and API routes were updated in a single commit. The database schema and data were not migrated — the rename was code-only.

---

## Module Scope

| Area | Description |
|------|-------------|
| **Tickets** | Create, triage, and resolve fault/maintenance tickets from multiple sources (WhatsApp, manual, weekly import) |
| **Escalations** | Track and resolve repeat fault escalations at pole/PON/zone/DR level |
| **Handover** | Immutable snapshot-based handover from Build → QA → NOC |
| **Risks** | QA risk acceptance tracking with documented exceptions and expiry dates |
| **Teams** | NOC team management and member assignment |
| **QContact Sync** | Bidirectional sync with QContact CRM (inbound + outbound, webhook handler) |
| **Weekly Import** | Excel weekly report import wizard (93+ items per import) |
| **WhatsApp** | WAHA-based WhatsApp notifications and DR photo processing |
| **Analytics** | Fault trend analysis, SLA compliance, workload charts |
| **Data Sync** | Data-sync group integration for OLT and NOC data streams |

---

## API Endpoints

All endpoints live under `/api/noc/` (previously `/api/maintenance/`).

### Tickets
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/noc/tickets` | List tickets (filterable by status, priority, assignment) |
| POST | `/api/noc/tickets` | Create new ticket |
| GET | `/api/noc/tickets/[id]` | Get ticket detail |
| PUT | `/api/noc/tickets/[id]` | Update ticket |
| DELETE | `/api/noc/tickets/[id]` | Delete ticket |
| GET | `/api/noc/tickets/[id]/activities` | Activity log |
| GET/POST | `/api/noc/tickets/[id]/notes` | Notes (internal, client, system) |
| DELETE | `/api/noc/tickets/[id]/notes/[noteId]` | Delete note |
| GET/POST | `/api/noc/tickets/[id]/attachments` | Photo and document attachments |
| PUT | `/api/noc/tickets/[id]/handover` | Submit handover |
| GET | `/api/noc/tickets/[id]/handover-history` | Handover audit trail |
| POST | `/api/noc/tickets/[id]/fault-cause` | Record fault cause |
| GET/POST | `/api/noc/tickets/[id]/verification` | Verification state |
| PUT | `/api/noc/tickets/[id]/verification/[step]` | Complete a verification step |
| POST | `/api/noc/tickets/[id]/verification/complete` | Finalise verification |
| GET | `/api/noc/tickets/[id]/qa-readiness` | QA readiness status |
| POST | `/api/noc/tickets/[id]/qa-readiness-check` | Run QA readiness check |
| POST | `/api/noc/tickets/[id]/risk-acceptance` | Submit risk acceptance |
| GET | `/api/noc/tickets/[id]/risk-acceptances` | List risk acceptances |

### Escalations
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/noc/escalations` | List escalations |
| POST | `/api/noc/escalations` | Create escalation |
| GET/PUT | `/api/noc/escalations/[id]` | Get or update escalation |
| POST | `/api/noc/escalations/[id]/resolve` | Resolve escalation |

### Teams
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/noc/teams` | List NOC teams |
| POST | `/api/noc/teams` | Create team |
| GET/PUT/DELETE | `/api/noc/teams/[id]` | Team CRUD |
| GET/POST | `/api/noc/teams/[id]/members` | Team membership |

### Attachments
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/noc/attachments` | List attachments |
| GET/DELETE | `/api/noc/attachments/[id]` | Attachment CRUD |

### QContact Sync
| Method | Path | Purpose |
|--------|------|---------|
| GET/POST | `/api/noc/sync/qcontact` | Trigger / status of QContact sync |
| GET | `/api/noc/sync/qcontact/log` | Sync audit log |
| GET | `/api/noc/sync/qcontact/status` | Current sync status |
| POST | `/api/noc/sync/fibertime` | FiberTime sync trigger |
| POST | `/api/noc/webhooks/qcontact` | Inbound QContact webhook |
| GET | `/api/noc/notifications/status` | Notification delivery status |
| POST | `/api/noc/notifications/whatsapp` | Send WhatsApp notification |

### Analytics & Dashboard
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/noc/dashboard/summary` | Summary metrics |
| GET | `/api/noc/dashboard/sla` | SLA compliance data |
| GET | `/api/noc/dashboard/workload` | Workload distribution |
| GET | `/api/noc/analytics/fault-trends` | Fault trend analysis |
| GET | `/api/noc/repeat-faults/check` | Repeat fault detection |

### Import & Other
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/noc/import/weekly` | Import history list |
| POST | `/api/noc/import/weekly` | Start import batch |
| POST | `/api/noc/import/weekly/parse` | Parse Excel file |
| GET/PUT | `/api/noc/import/weekly/[id]` | Import batch detail |
| GET | `/api/noc/import/weekly/[id]/progress` | Import progress |
| GET | `/api/noc/import/weekly/history` | Full import history |
| GET | `/api/noc/dr-lookup/[drNumber]` | DR number lookup from SOW |
| GET | `/api/noc/users` | Users assignable to tickets |
| GET | `/api/noc/risk-acceptances` | All risk acceptances |

### PP Data Ticket Enrichment (Activate module integration)
| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/activate/pp-data-tickets` | Create NOC tickets for PP Data records |
| **PATCH** | **`/api/activate/pp-data-tickets`** | **Backfill existing PP Data tickets with enrichment data** |

The PATCH endpoint was added in commit `96d8cc9` specifically for bulk backfilling. It should not be confused with the POST (create) path.

---

## PP Data Enrichment Workflow

PP Data tickets (created via the Activate module) can be enriched with network context from two sources:

1. **`drops` table** — Provides: `project_id`, `zone_no`, `pon_no`, `pole_number`, GPS coordinates (`latitude`, `longitude`), `installed_by_name`, `installed_at`
2. **`onemap_properties` table** — Provides: `location_address`, GPS coordinates, `pons`, `sections`, `contact_name + contact_surname` (client name), `contact_number`, `email_address`, `installer_name`, `installation_date`

The join key is `drops.drop_number = onemap_properties.drop_number`, matched via the ticket's DR number.

### Enriched fields on `noc_tickets` (or equivalent)
- `project_id` — from drops or resolved from project name
- `address` — onemap address preferred, falls back to drops address
- `zone` — from drops `zone_no`
- `pon` — from drops `pon_no` or onemap `pons`
- `pole_number` — from drops or onemap
- GPS: `lat` / `lng` — onemap preferred, drops as fallback
- `client_name` — `contact_name + contact_surname` from onemap_properties
- `client_contact` — `contact_number` from onemap_properties
- `client_email` — `email_address` from onemap_properties
- `installer_name` / `installed_at` — from onemap or drops

### Backfill Status (as of 2026-03-11, commit `96d8cc9`)
- **372 existing PP Data tickets** backfilled — all now have `project_id`
- **7 tickets** had DR numbers — enriched with zone, PON, GPS, address, and client data
- Remaining 365 tickets enriched with `project_id` only (no DR number present)

---

## Data Flow: Drops → PP Data Ticket

```
Activate module (PP Data tab)
  └─ CreatePPTicketsModal
       └─ POST /api/activate/pp-data-tickets
            ├─ Creates NOC ticket via ticketService.createTicket()
            └─ Enriches via drops + onemap_properties (if DR number present)

Backfill (one-time / admin):
  └─ PATCH /api/activate/pp-data-tickets
       └─ Iterates existing PP Data tickets
            └─ Fetches enrichment per DR number
            └─ Updates ticket fields in bulk
```

---

## Bug Fixes (commit `96d8cc9`)

Two bugs in the original PP ticket creation flow were fixed:

1. **`assigned_team` name→UUID mismatch** — Ticket creation was sending team name strings instead of team UUIDs, causing a 500 error when a team was selected. Fixed by resolving team UUIDs before submission.
2. **`[object Object]` toast error** — API error responses were not being unwrapped before display. Fixed by extracting `error.message` from the API error response object.

---

## Verification Workflows

The NOC module supports **type-specific verification checklists** for different ticket types. Previously, all tickets used the same 12-step new installation checklist. Now each ticket type has a tailored checklist that matches the actual work being done.

### Verification Step Counts by Ticket Type

| Ticket Type | Steps | Focus |
|-------------|-------|-------|
| **new_installation** | 12 | Full fiber installation workflow |
| **fault_repair** | 7 | Fault assessment → repair → verification |
| **ont_swap** | 7 | Document old ONT → swap → activate → verify |
| **modification** | 6 | Assess → plan → modify → verify |
| **incident** | 7 | Impact → containment → RCA → restore |
| **olt_investigation** | 4 | Review OLT data → cross-ref → verify → resolve |
| **serial_mismatch** | 3 | Review → physical check → resolve |
| **pre_provision** | 3 | OES review → 1Map search → resolve |
| **hse_incident** | 6 | Scene assessment → RCA → corrective actions |
| **hse_near_miss** | 3 | Document → factors → corrective actions |

**API Behavior**: `GET /api/noc/tickets/[id]/verification` returns type-specific steps based on `ticket.type`. Unknown ticket types fall back to the 12-step new_installation checklist.

**Photo Upload**: Verification photo upload supports **clipboard paste** (Ctrl+V / Cmd+V) in addition to drag-drop and click-to-upload.

**Source**: `src/modules/noc/constants/verificationSteps.ts` — all step definitions are code-based (no DB migration required).

See **[CHANGELOG.md](./CHANGELOG.md)** for details (commit `a63c493`, 2026-03-13).

---

## Module Structure

```
src/modules/noc/
├── __tests__/          # Unit and integration tests
│   ├── api/            # API route tests
│   ├── components/     # Component tests
│   ├── hooks/          # Hook tests
│   ├── services/       # Service layer tests
│   └── utils/          # Utility tests
├── components/         # React components
│   ├── Dashboard/      # Ticketing dashboard + SLA cards
│   ├── Escalation/     # Escalation management
│   ├── FaultAttribution/
│   ├── Handover/       # Handover wizard + history
│   ├── KanbanBoard/    # Kanban ticket view
│   ├── QAReadiness/    # QA readiness checks
│   ├── QContact/       # QContact sync UI
│   ├── TicketDetail/   # Full ticket detail panel
│   ├── TicketForm/     # Create/edit ticket form
│   ├── TicketList/     # Ticket list + filters
│   ├── Verification/   # Type-specific verification checklists (3-12 steps)
│   ├── WeeklyImport/   # Excel import wizard
│   └── WATrackingDashboard.tsx
├── constants/          # Ticket status, types, fault causes, etc.
├── hooks/              # useTickets, useTicket, useHandover, useVerification, etc.
├── jobs/               # QContact sync background job
├── migrations/         # PostgreSQL migration files (4 migrations)
├── services/           # Business logic
│   ├── ticketService.ts
│   ├── ticketEnrichmentService.ts
│   ├── escalationService.ts
│   ├── handoverService.ts
│   ├── verificationService.ts
│   ├── qaReadinessService.ts
│   ├── qcontactSyncOrchestrator.ts
│   └── whatsappService.ts
├── types/              # TypeScript definitions
└── utils/              # Helpers (SLA calc, fault patterns, etc.)
```

---

## Test Status

As of 2026-03-12, **6 test failures** exist in the NOC module (`src/modules/noc/__tests__/`). These are pre-existing failures unrelated to the module rename — the rename itself was a mechanical find-and-replace of import paths. The failures are tracked separately.

---

## Known Integrations

| System | Direction | Mechanism |
|--------|-----------|-----------|
| **QContact** | Bidirectional | REST sync + webhook (`/api/noc/webhooks/qcontact`) |
| **WhatsApp (WAHA)** | Outbound | `/api/noc/notifications/whatsapp` |
| **Activate module** | Inbound | `/api/activate/pp-data-tickets` creates NOC tickets |
| **Data Sync** | Outbound | NocGroup in data-sync dashboard |
| **OLT Report** | Inbound | `/api/system/olt-report/tickets` creates NOC tickets |
| **FiberTime** | Outbound | `/api/noc/sync/fibertime` |

---

*Last updated: 2026-03-13 · Source commits: [`96d8cc9`](https://github.com) (2026-03-11, module rename + PP enrichment), [`a63c493`](https://github.com) (2026-03-13, type-specific verification)*
