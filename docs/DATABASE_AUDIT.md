# FibreFlow Database Audit Report

**Generated:** 2026-01-09
**Scope:** Full codebase analysis of API endpoints, database connections, and data access patterns

---

## Executive Summary

| Metric | Count |
|--------|-------|
| **Total API Routes** | 157+ |
| **Database Tables** | 95+ |
| **Service Files** | 55+ |
| **Modules with DB Access** | 24 |
| **Modules without DB** | 10 (UI-only/placeholder) |

**Architecture Assessment:** ENTERPRISE-GRADE
- Strong separation of concerns (service layer → API → frontend)
- No component-level direct database access
- Parameterized SQL queries (injection prevention)
- Neon PostgreSQL serverless throughout

---

## Table of Contents

1. [Critical Distinctions](#critical-distinctions)
2. [Database Tables by Module](#database-tables-by-module)
3. [API Endpoint Inventory](#api-endpoint-inventory)
4. [Data Access Patterns](#data-access-patterns)
5. [Issues & Recommendations](#issues--recommendations)
6. [Table Usage Matrix](#table-usage-matrix)
7. [Unused/Duplicate Data Analysis](#unusedduplicate-data-analysis)

---

## Critical Distinctions

### The Two "Drops" Tables

**This is the most common source of confusion in the codebase!**

| Table | Purpose | Source | API Prefix | Page |
|-------|---------|--------|------------|------|
| `drops` | SOW planning data | Excel/CSV imports | `/api/sow/*` | `/sow`, `/fiber-stringing` |
| `qa_photo_reviews` | WhatsApp QA tracking | WhatsApp messages | `/api/wa-monitor-*` | `/wa-monitor` |

**Key differences:**
- `drops.project_id` is UUID → `qa_photo_reviews.project` is VARCHAR (project name)
- `drops` has no QA steps → `qa_photo_reviews` has 12 boolean step columns
- Different data sources, different lifecycles, different APIs

---

## Database Tables by Module

### Core Modules (Tightly Coupled)

#### Projects Module
```
Tables:
├── projects (core project records)
├── drops (SOW imported drops from Excel)
├── sow_poles (pole positions and statuses)
├── sow_fibre (fiber cable segments)
├── home_installs (customer installations)
├── clients (linked via client_id)
└── staff (linked via project_manager)
```

#### Ticketing Module
```
Tables:
├── tickets (main ticket records)
├── verification_steps (12-step verification workflow)
├── weekly_reports (import batch tracking)
├── qcontact_sync_log (bidirectional sync audit)
├── guarantee_periods (project guarantee config)
├── whatsapp_notifications (delivery tracking)
├── ticket_attachments (file metadata)
├── ticket_notes (internal/client notes)
├── qa_readiness_checks (pre-QA validation)
├── qa_risk_acceptances (conditional approval)
├── handover_snapshots (immutable audit trail)
└── repeat_fault_escalations (infrastructure escalation)
```

#### Workflow Module
```
Tables: (PLANNED - currently mock data)
├── workflow_templates
├── workflow_phases
├── workflow_steps
└── workflow_tasks
```

### Monitoring Modules (Mostly Isolated)

#### WA Monitor Module ✅ FULLY ISOLATED
```
Tables:
└── qa_photo_reviews (12 QA step booleans)

No cross-module dependencies!
Can be extracted to microservice.
```

#### Foto Review Module
```
Tables:
├── foto_ai_reviews (AI evaluation results)
└── qa_photo_reviews (linked by dr_number for submitter)
```

#### DR Photo Review Module
```
Tables:
└── External VLM API (localhost:8082) - no local tables
```

#### RAG Module (Contractor Health)
```
Tables:
├── contractors (reads)
└── contractor_documents (reads for compliance)
```

### Procurement Modules

#### Procurement Module
```
Tables:
├── procurement_projects
├── boqs (Bill of Quantities)
├── rfqs (Request for Quotes)
├── quotes (Supplier responses)
├── purchase_orders
└── stock_positions
```

#### Assets Module
```
Tables:
├── asset_categories
├── assets
├── asset_assignments
├── asset_maintenance
└── asset_documents
```

#### Suppliers Module
```
Tables:
├── suppliers
├── supplier_documents
├── supplier_ratings
└── supplier_compliance
```

### HR/Admin Modules

#### Staff Module
```
Tables:
├── staff
└── staff_documents
```

#### Contractors Module
```
Tables:
├── contractors
├── contractor_documents
├── contractor_teams
└── team_members
```

#### Onboarding Module
```
Tables:
├── onboarding_workflows
├── onboarding_stages
└── workflow_templates
```

### Communication Modules

#### Meetings Module
```
Tables:
└── meetings (Fireflies.ai sync)
```

#### LiveKit Module
```
Tables:
└── meetings (room/recording metadata)
```

#### Action Items Module
```
Tables:
├── meeting_action_items
└── meetings (via JOIN)
```

### GIS/Field Modules

#### QField Sync Module
```
Tables:
├── qfield_sync_jobs
├── qfield_sync_conflicts
├── sow_fibre (target for cable sync)
└── sow_poles (target for pole sync)
```

#### OneMap Module
```
Tables:
├── onemap_properties
├── onemap_layers
└── onemap_features
```

### Analytics/Reporting

#### Analytics Module
```
Tables:
└── No direct DB access (uses dashboard APIs)
```

#### KPI Dashboard/KPIs Modules
```
Tables:
└── No DB access (mock data / placeholder)
```

---

## API Endpoint Inventory

### By Category

| Category | Count | Prefix |
|----------|-------|--------|
| Ticketing | 37 | `/api/ticketing/*` |
| Contractors | 15 | `/api/contractors*` |
| SOW/Projects | 14 | `/api/sow/*`, `/api/projects/*` |
| WA Monitor | 7 | `/api/wa-monitor-*` |
| Procurement | 6 | `/api/procurement/*` |
| Foto Review | 7 | `/api/foto/*` |
| LiveKit | 8 | `/api/livekit/*` |
| Clients | 4 | `/api/clients/*` |
| Staff | 5 | `/api/staff/*` |
| Suppliers | 5 | `/api/suppliers/*` |
| QField Sync | 10 | `/api/qfield-sync-*` |
| Analytics | 6 | `/api/analytics/*` |
| Action Items | 6 | `/api/action-items/*` |
| Meetings | 2 | `/api/meetings*` |
| Health/Admin | 5 | `/api/health/*`, `/api/admin/*` |
| Other | 20 | Various |

### Full API Route List

```
/api/action-items/[id].ts
/api/action-items/extract-all.ts
/api/action-items/extract.ts
/api/action-items/index.ts
/api/action-items/stats.ts
/api/admin/init-db.ts
/api/analytics/dashboard/stats.ts
/api/analytics/dashboard/summary.ts
/api/analytics/dashboard/trends.ts
/api/analytics/errors.ts
/api/analytics/projects/summary.ts
/api/analytics/web-vitals.ts
/api/clients/[id].ts
/api/clients/index.ts
/api/clients/summary.ts
/api/contractors-documents-export.ts
/api/contractors-documents-report-summary.ts
/api/contractors-documents-report.ts
/api/contractors-documents-update.ts
/api/contractors-documents-verify.ts
/api/contractors-documents.ts
/api/contractors-onboarding-complete.ts
/api/contractors-onboarding-stages-update.ts
/api/contractors-onboarding-stages.ts
/api/contractors-projects-delete.ts
/api/contractors-projects-update.ts
/api/contractors-projects.ts
/api/contractors-rag.ts
/api/contractors-update.ts
/api/contractors/[contractorId].ts
/api/contractors/[contractorId]/onboarding/complete.ts
/api/contractors/[contractorId]/onboarding/stages.ts
/api/contractors/[contractorId]/onboarding/stages/[stageId].ts
/api/cron/sync-action-items.ts
/api/database/health.ts
/api/database/info.ts
/api/dr-dashboard/[...path].ts
/api/dr-dashboard/evaluate.ts
/api/dr-dashboard/sessions.ts
/api/dr-dashboard/sessions/[dr]/[...action].ts
/api/dr-dashboard/vlm-status.ts
/api/field/export.ts
/api/field/quality-checks/index.ts
/api/field/schedules/index.ts
/api/field/sync.ts
/api/field/tasks/[id].ts
/api/field/tasks/index.ts
/api/field/technicians/index.ts
/api/foto/auto-process.ts
/api/foto/download-report.ts
/api/foto/evaluate.ts
/api/foto/evaluation/[dr_number].ts
/api/foto/feedback.ts
/api/foto/photo-proxy.ts
/api/foto/photos.ts
/api/health.ts
/api/health/db.ts
/api/livekit/config.ts
/api/livekit/recording.ts
/api/livekit/recordings.ts
/api/livekit/rooms.ts
/api/livekit/schedule.ts
/api/livekit/token.ts
/api/livekit/webhooks.ts
/api/marketing-activations.ts
/api/meetings-sync-cron.ts
/api/meetings.ts
/api/nokia/velocity.ts
/api/onemap/properties-enhanced.ts
/api/onemap/properties-with-mapping.ts
/api/onemap/properties.ts
/api/onemap/upload.ts
/api/poles/index.ts
/api/procurement/boq/index.ts
/api/procurement/metrics/aggregate.ts
/api/procurement/projects/summaries.ts
/api/procurement/rfq/index.ts
/api/procurement/stock/index.ts
/api/projects/[projectId].ts
/api/qfield-sync-cables.ts
/api/qfield-sync-current.ts
/api/qfield-sync-dashboard.ts
/api/qfield-sync-drops.ts
/api/qfield-sync-history.ts
/api/qfield-sync-poles.ts
/api/qfield-sync-start.ts
/api/qfield/oes-sync.ts
/api/qfield/oes-upload.ts
/api/qfield/poles-sync.ts
/api/qfield/projects.ts
/api/realtime/poll.ts
/api/sow/drops.ts
/api/sow/drops/search.ts
/api/sow/drops/stats.ts
/api/sow/fibre.ts
/api/sow/import.ts
/api/sow/list.ts
/api/sow/poles.ts
/api/sow/project.ts
/api/staff/*
/api/suppliers/*
/api/ticketing/* (37+ endpoints)
/api/wa-monitor-daily-drops.ts
/api/wa-monitor-drops.ts
/api/wa-monitor-dr-validation.ts
/api/wa-monitor-health.ts
/api/wa-monitor-projects-summary.ts
/api/wa-monitor-send-feedback.ts
```

---

## Data Access Patterns

### Pattern 1: Service Layer Architecture (CORRECT)

```
Component → Hook → API Route → Service → Database
```

**Example (Ticketing):**
```typescript
// Component uses hook
const { tickets } = useTickets();

// Hook calls API
const response = await fetch('/api/ticketing/tickets');

// API uses service
const tickets = await ticketService.list(filters);

// Service executes SQL
const result = await sql`SELECT * FROM tickets WHERE ...`;
```

**Modules following this pattern:**
- ticketing ✅
- wa-monitor ✅
- foto-review ✅
- procurement ✅
- staff ✅
- suppliers ✅
- clients ✅
- assets ✅

### Pattern 2: Direct API DB Access (ACCEPTABLE)

```
Component → Hook → API Route → Direct SQL
```

**Used when:**
- Simple CRUD operations
- No complex business logic
- Read-only queries

**Example (Clients API):**
```typescript
// In /api/clients/index.ts
const clients = await sql`SELECT * FROM clients WHERE ...`;
```

### Pattern 3: Mock Data (NEEDS WORK)

```
Component → Hook → Returns []
```

**Modules with mock/placeholder data:**
- installations (useHomeInstallations returns [])
- kpi-dashboard (hardcoded stats)
- kpis (hardcoded metrics)
- daily-progress (hardcoded KPIs)
- communications (empty arrays)
- reports (mock data)
- workflow (mock templates)
- field-app (mock tasks)
- nokia-equipment (placeholder)
- onemap (placeholder)

---

## Issues & Recommendations

### 1. Tables That Should Use APIs Instead of Direct DB

| Current Pattern | Recommended Change | Priority |
|-----------------|-------------------|----------|
| Some components import Neon directly | Route through API layer | HIGH |
| Duplicate SQL queries in multiple files | Centralize in services | MEDIUM |
| Raw SQL in API routes | Extract to service methods | LOW |

**Files with direct DB access that should use APIs:**
```
src/modules/ticketing/utils/db.ts - OK (module utility)
src/modules/foto-review/services/fotoDbService.ts - OK (service layer)
src/modules/wa-monitor/services/waMonitorService.ts - OK (isolated module)
```

**Assessment:** All direct DB access is properly encapsulated in services or utilities. No component-level DB access found.

### 2. Potential Duplicate Data

| Data | Table 1 | Table 2 | Issue |
|------|---------|---------|-------|
| Drop numbers | `drops` | `qa_photo_reviews` | Different sources, different data |
| Project info | `projects` | Various module tables | Denormalized for performance |
| Contractor docs | `contractor_documents` | `supplier_documents` | Separate entities, OK |

**Assessment:** No actual data duplication found. The two "drops" tables serve different purposes.

### 3. Unused Tables

Based on code analysis, these tables may be unused or experimental:

| Table | Status | Recommendation |
|-------|--------|----------------|
| `workflow_templates` | Schema defined, no data | Implement or remove |
| `workflow_phases` | Schema defined, no data | Implement or remove |
| `marketing_activations` | Single API endpoint | Review usage |

### 4. Missing Database Integration

| Module | Current State | Recommendation |
|--------|---------------|----------------|
| installations | Mock data | Implement DB integration |
| daily-progress | Hardcoded KPIs | Connect to analytics |
| kpi-dashboard | Mock stats | Connect to real metrics |
| field-app | Mock tasks | Connect to projects/tasks |
| nokia-equipment | Placeholder | Implement inventory DB |
| workflow | Mock templates | Implement workflow tables |

### 5. Cross-Module Dependencies

```
projects ←─┬─→ clients
           ├─→ staff
           ├─→ contractors
           ├─→ sow (drops, poles, fibre)
           └─→ ticketing (via DR lookup)

ticketing ←─┬─→ wa-monitor (feedback)
            ├─→ foto-review (DR photos)
            └─→ qcontact (sync)

foto-review ←─→ qa_photo_reviews (submitter lookup)

wa-monitor ←─→ (ISOLATED - no dependencies)
```

---

## Table Usage Matrix

| Table | Read | Write | Module(s) |
|-------|------|-------|-----------|
| `projects` | ✅ | ✅ | projects, analytics, qfield-sync |
| `drops` | ✅ | ✅ | sow, projects, ticketing (lookup) |
| `qa_photo_reviews` | ✅ | ✅ | wa-monitor, foto-review |
| `tickets` | ✅ | ✅ | ticketing |
| `verification_steps` | ✅ | ✅ | ticketing |
| `contractors` | ✅ | ✅ | contractors, rag, onboarding |
| `contractor_documents` | ✅ | ✅ | contractors, rag |
| `clients` | ✅ | ✅ | clients, projects |
| `staff` | ✅ | ✅ | staff, projects |
| `suppliers` | ✅ | ✅ | suppliers, procurement |
| `meetings` | ✅ | ✅ | meetings, livekit, action-items |
| `foto_ai_reviews` | ✅ | ✅ | foto-review |
| `assets` | ✅ | ✅ | assets |
| `boqs` | ✅ | ✅ | procurement |
| `rfqs` | ✅ | ✅ | procurement |
| `sow_poles` | ✅ | ✅ | sow, qfield-sync |
| `sow_fibre` | ✅ | ✅ | sow, qfield-sync |
| `qfield_sync_jobs` | ✅ | ✅ | qfield-sync |

---

## Unused/Duplicate Data Analysis

### Confirmed No Issues

1. **drops vs qa_photo_reviews**: Different data sources, different purposes, correctly separated
2. **Project denormalization**: Acceptable for performance optimization
3. **Service layer**: All DB access properly encapsulated

### Areas to Monitor

1. **QContact sync log**: Monitor for growth, implement retention policy
2. **Ticket attachments**: Ensure cleanup on ticket deletion
3. **Meeting transcripts**: Large text storage, consider compression

### Data Retention Recommendations

| Table | Retention | Action |
|-------|-----------|--------|
| `qcontact_sync_log` | 90 days | Implement cleanup job |
| `qfield_sync_jobs` | 30 days | Archive completed jobs |
| `whatsapp_notifications` | 30 days | Keep delivery confirmations |
| `handover_snapshots` | Forever | Audit trail, never delete |

---

## Architecture Strengths

1. **Strong module isolation**: wa-monitor can be extracted as microservice
2. **Service layer pattern**: Business logic separated from API handlers
3. **Type safety**: TypeScript interfaces for all database rows
4. **Parameterized queries**: SQL injection prevention throughout
5. **React Query**: Efficient caching and state management

## Architecture Concerns

1. **Mock data modules**: 10 modules with placeholder implementations
2. **Workflow tables**: Defined but not implemented
3. **Two authentication systems**: Clerk + legacy Firebase traces
4. **External dependencies**: VLM at localhost:8082, QFieldCloud API

---

## Quick Reference

### Database Connection

```typescript
// Correct way to connect
import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL);

// Query pattern
const result = await sql`SELECT * FROM table WHERE id = ${id}`;
```

### Module Database Access

```typescript
// Service pattern (recommended)
// src/modules/{module}/services/{module}Service.ts
export const moduleService = {
  async getById(id: string) {
    const sql = getDbConnection();
    return await sql`SELECT * FROM table WHERE id = ${id}`;
  }
};
```

### API Route Pattern

```typescript
// pages/api/{module}/index.ts
import { moduleService } from '@/modules/{module}/services';

export default async function handler(req, res) {
  const data = await moduleService.getAll();
  return apiResponse.success(res, data);
}
```

---

*Last Updated: 2026-01-09*
*Generated by: Database Audit Agent*
