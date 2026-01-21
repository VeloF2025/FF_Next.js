# Pipeline Management Module - Implementation Plan

## Overview

A comprehensive module for tracking potential projects through the approval pipeline until they receive a PO and transition to planned projects. Integrates with Smartsheet for ongoing data sync.

---

## 1. Core Concepts

### Pipeline vs Planned Projects
- **Pipeline Projects**: Potential projects being chased for approvals (wayleave, municipal, etc.)
- **Planned Projects**: Projects with all approvals + PO received → moves to existing `projects` table

### Approval Gate System
A project can only proceed when ALL required approval gates are satisfied:
- Wayleave (Eskom/other service providers)
- Municipal approval
- Traditional Council permission
- Environmental clearance
- Custom/additional approvals per project

---

## 2. Database Schema

### 2.1 Core Tables

```sql
-- Main pipeline projects table
CREATE TABLE pipeline_projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identification
  project_code VARCHAR(50) UNIQUE,
  project_name VARCHAR(255) NOT NULL,
  description TEXT,

  -- Location
  province VARCHAR(100),
  municipality VARCHAR(100),
  area VARCHAR(255),
  coordinates JSONB, -- {lat, lng, polygon}

  -- Classification
  project_type VARCHAR(50), -- 'greenfield', 'brownfield', 'extension'
  priority VARCHAR(20) DEFAULT 'medium', -- 'low', 'medium', 'high', 'critical'

  -- Client/Owner
  client_id UUID REFERENCES clients(id),
  client_contact_name VARCHAR(255),
  client_contact_email VARCHAR(255),
  client_contact_phone VARCHAR(50),

  -- Internal Assignment
  project_manager_id UUID REFERENCES staff(id),
  wayleaves_officer_id UUID REFERENCES staff(id),
  operations_manager_id UUID REFERENCES staff(id),

  -- Smartsheet Sync
  smartsheet_id VARCHAR(100), -- Smartsheet row ID
  smartsheet_sheet_id VARCHAR(100),
  last_synced_at TIMESTAMP WITH TIME ZONE,
  sync_status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'synced', 'conflict', 'error'
  sync_overrides JSONB, -- Fields manually overridden (won't sync from SS)

  -- Status
  pipeline_status VARCHAR(30) DEFAULT 'new',
    -- 'new', 'in_progress', 'approvals_pending', 'approvals_complete',
    -- 'po_pending', 'ready_to_plan', 'planned', 'on_hold', 'cancelled'

  -- Financial Estimates
  estimated_value DECIMAL(15,2),
  estimated_homes_passed INTEGER,
  estimated_km DECIMAL(10,2),

  -- PO Information (when received)
  po_number VARCHAR(100),
  po_date DATE,
  po_value DECIMAL(15,2),
  po_document_id UUID, -- Reference to uploaded PO document
  po_received_at TIMESTAMP WITH TIME ZONE,
  po_received_by UUID REFERENCES staff(id),

  -- Transition to Planned
  planned_project_id UUID REFERENCES projects(id), -- Link after transition
  transitioned_at TIMESTAMP WITH TIME ZONE,
  transitioned_by UUID REFERENCES staff(id),

  -- Audit
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_by UUID REFERENCES staff(id),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_by UUID REFERENCES staff(id),
  notes TEXT
);

-- Indexes
CREATE INDEX idx_pipeline_projects_status ON pipeline_projects(pipeline_status);
CREATE INDEX idx_pipeline_projects_client ON pipeline_projects(client_id);
CREATE INDEX idx_pipeline_projects_smartsheet ON pipeline_projects(smartsheet_id);
CREATE INDEX idx_pipeline_projects_pm ON pipeline_projects(project_manager_id);
```

### 2.2 Approval Types Configuration

```sql
-- Configurable approval types
CREATE TABLE pipeline_approval_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  code VARCHAR(50) UNIQUE NOT NULL, -- 'wayleave_eskom', 'municipal', 'traditional_council', etc.
  name VARCHAR(100) NOT NULL,
  description TEXT,
  category VARCHAR(50), -- 'wayleave', 'municipal', 'environmental', 'other'

  -- Default settings
  default_required BOOLEAN DEFAULT false, -- Auto-add to new projects
  typical_duration_days INTEGER, -- Expected processing time

  -- Issuing authority defaults
  default_authority_name VARCHAR(255),
  default_authority_contact TEXT,

  -- Document requirements
  required_documents JSONB, -- [{type: 'application_form', name: '...'}]

  -- Sorting
  display_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Seed default approval types
INSERT INTO pipeline_approval_types (code, name, category, default_required, typical_duration_days, display_order) VALUES
  ('wayleave_eskom', 'Wayleave - Eskom', 'wayleave', true, 90, 1),
  ('wayleave_telkom', 'Wayleave - Telkom', 'wayleave', false, 60, 2),
  ('wayleave_sanral', 'Wayleave - SANRAL', 'wayleave', false, 120, 3),
  ('wayleave_transnet', 'Wayleave - Transnet', 'wayleave', false, 90, 4),
  ('municipal_approval', 'Municipal Approval', 'municipal', true, 60, 10),
  ('traditional_council', 'Traditional Council Permission', 'traditional', false, 45, 20),
  ('environmental_eia', 'Environmental Impact Assessment', 'environmental', false, 180, 30),
  ('environmental_heritage', 'Heritage Impact Assessment', 'environmental', false, 90, 31);
```

### 2.3 Project Approvals (Instance per Project)

```sql
-- Individual approval instances per project
CREATE TABLE pipeline_project_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  pipeline_project_id UUID NOT NULL REFERENCES pipeline_projects(id) ON DELETE CASCADE,
  approval_type_id UUID NOT NULL REFERENCES pipeline_approval_types(id),

  -- Status tracking
  status VARCHAR(30) DEFAULT 'not_started',
    -- 'not_started', 'application_submitted', 'in_review', 'additional_info_required',
    -- 'approved', 'rejected', 'expired', 'renewed'
  is_required BOOLEAN DEFAULT true,

  -- Application tracking
  application_date DATE,
  application_reference VARCHAR(100),
  application_document_id UUID, -- Uploaded application form

  -- Authority details (can override type defaults)
  authority_name VARCHAR(255),
  authority_contact_name VARCHAR(255),
  authority_contact_email VARCHAR(255),
  authority_contact_phone VARCHAR(50),
  assigned_officer VARCHAR(255), -- Their internal officer handling it

  -- Follow-up tracking
  last_followup_date DATE,
  next_followup_date DATE,
  followup_notes TEXT,

  -- Approval details (when approved)
  approval_date DATE,
  approval_reference VARCHAR(100),
  approval_document_id UUID, -- Uploaded approval certificate
  issue_date DATE,
  expiry_date DATE,

  -- Financial
  application_fee DECIMAL(10,2),
  fee_paid BOOLEAN DEFAULT false,
  fee_paid_date DATE,
  fee_receipt_reference VARCHAR(100),
  fee_receipt_document_id UUID,

  -- Coverage/Scope (for wayleaves)
  coverage_description TEXT,
  affected_coordinates JSONB, -- Route segments, coordinates
  conditions TEXT, -- Any conditions attached to approval

  -- Rejection handling
  rejection_date DATE,
  rejection_reason TEXT,
  appeal_submitted BOOLEAN DEFAULT false,
  appeal_date DATE,

  -- Smartsheet sync
  smartsheet_column_mapping JSONB, -- Which SS columns map to this approval
  last_synced_at TIMESTAMP WITH TIME ZONE,

  -- Internal approval (before external submission)
  internal_approval_status VARCHAR(20) DEFAULT 'pending',
    -- 'pending', 'pm_approved', 'ops_approved', 'rejected'
  pm_approved_by UUID REFERENCES staff(id),
  pm_approved_at TIMESTAMP WITH TIME ZONE,
  pm_notes TEXT,
  ops_approved_by UUID REFERENCES staff(id),
  ops_approved_at TIMESTAMP WITH TIME ZONE,
  ops_notes TEXT,

  -- Audit
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_by UUID REFERENCES staff(id),
  updated_by UUID REFERENCES staff(id),

  UNIQUE(pipeline_project_id, approval_type_id)
);

-- Indexes
CREATE INDEX idx_ppa_project ON pipeline_project_approvals(pipeline_project_id);
CREATE INDEX idx_ppa_status ON pipeline_project_approvals(status);
CREATE INDEX idx_ppa_expiry ON pipeline_project_approvals(expiry_date) WHERE expiry_date IS NOT NULL;
CREATE INDEX idx_ppa_followup ON pipeline_project_approvals(next_followup_date) WHERE next_followup_date IS NOT NULL;
```

### 2.4 Approval Documents

```sql
-- Documents attached to approvals
CREATE TABLE pipeline_approval_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  approval_id UUID NOT NULL REFERENCES pipeline_project_approvals(id) ON DELETE CASCADE,

  document_type VARCHAR(50) NOT NULL,
    -- 'application_form', 'supporting_doc', 'approval_certificate', 'rejection_letter',
    -- 'fee_receipt', 'site_plan', 'route_map', 'correspondence', 'other'
  document_name VARCHAR(255) NOT NULL,
  description TEXT,

  -- File details
  file_name VARCHAR(255) NOT NULL,
  file_path VARCHAR(500),
  file_url VARCHAR(500),
  file_size INTEGER,
  mime_type VARCHAR(100),

  -- Dates
  document_date DATE, -- Date on the document
  issue_date DATE,
  expiry_date DATE,

  -- Reference
  reference_number VARCHAR(100),
  issuing_authority VARCHAR(255),

  -- Verification
  is_verified BOOLEAN DEFAULT false,
  verified_by UUID REFERENCES staff(id),
  verified_at TIMESTAMP WITH TIME ZONE,
  verification_notes TEXT,

  -- Audit
  uploaded_by UUID REFERENCES staff(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  is_active BOOLEAN DEFAULT true
);

CREATE INDEX idx_pad_approval ON pipeline_approval_documents(approval_id);
CREATE INDEX idx_pad_type ON pipeline_approval_documents(document_type);
CREATE INDEX idx_pad_expiry ON pipeline_approval_documents(expiry_date) WHERE expiry_date IS NOT NULL;
```

### 2.5 Expiry Alerts

```sql
-- Automated expiry alerts (created by trigger)
CREATE TABLE pipeline_expiry_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  approval_id UUID NOT NULL REFERENCES pipeline_project_approvals(id) ON DELETE CASCADE,
  pipeline_project_id UUID NOT NULL REFERENCES pipeline_projects(id) ON DELETE CASCADE,

  alert_type VARCHAR(20) NOT NULL, -- '90_day', '30_day', '7_day', 'expired'
  alert_date DATE NOT NULL,
  expiry_date DATE NOT NULL,

  -- Notification tracking
  is_sent BOOLEAN DEFAULT false,
  sent_at TIMESTAMP WITH TIME ZONE,
  sent_to JSONB, -- [{user_id, email, method}]

  -- Acknowledgement
  acknowledged_by UUID REFERENCES staff(id),
  acknowledged_at TIMESTAMP WITH TIME ZONE,
  action_taken TEXT,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_pea_unsent ON pipeline_expiry_alerts(alert_date) WHERE is_sent = false;
CREATE INDEX idx_pea_project ON pipeline_expiry_alerts(pipeline_project_id);

-- Trigger function to create expiry alerts
CREATE OR REPLACE FUNCTION create_pipeline_expiry_alerts()
RETURNS TRIGGER AS $$
BEGIN
  -- Delete existing alerts for this approval
  DELETE FROM pipeline_expiry_alerts WHERE approval_id = NEW.id;

  -- Only create alerts if expiry_date is set
  IF NEW.expiry_date IS NOT NULL THEN
    -- 90-day alert
    INSERT INTO pipeline_expiry_alerts (approval_id, pipeline_project_id, alert_type, alert_date, expiry_date)
    VALUES (NEW.id, NEW.pipeline_project_id, '90_day', NEW.expiry_date - INTERVAL '90 days', NEW.expiry_date);

    -- 30-day alert
    INSERT INTO pipeline_expiry_alerts (approval_id, pipeline_project_id, alert_type, alert_date, expiry_date)
    VALUES (NEW.id, NEW.pipeline_project_id, '30_day', NEW.expiry_date - INTERVAL '30 days', NEW.expiry_date);

    -- 7-day alert
    INSERT INTO pipeline_expiry_alerts (approval_id, pipeline_project_id, alert_type, alert_date, expiry_date)
    VALUES (NEW.id, NEW.pipeline_project_id, '7_day', NEW.expiry_date - INTERVAL '7 days', NEW.expiry_date);

    -- Expired alert
    INSERT INTO pipeline_expiry_alerts (approval_id, pipeline_project_id, alert_type, alert_date, expiry_date)
    VALUES (NEW.id, NEW.pipeline_project_id, 'expired', NEW.expiry_date, NEW.expiry_date);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_pipeline_expiry_alerts
AFTER INSERT OR UPDATE OF expiry_date ON pipeline_project_approvals
FOR EACH ROW EXECUTE FUNCTION create_pipeline_expiry_alerts();
```

### 2.6 Activity Log

```sql
-- Activity tracking for pipeline projects
CREATE TABLE pipeline_activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  pipeline_project_id UUID NOT NULL REFERENCES pipeline_projects(id) ON DELETE CASCADE,
  approval_id UUID REFERENCES pipeline_project_approvals(id) ON DELETE SET NULL,

  action VARCHAR(50) NOT NULL,
    -- 'created', 'updated', 'status_changed', 'approval_added', 'approval_submitted',
    -- 'approval_approved', 'approval_rejected', 'document_uploaded', 'followup_scheduled',
    -- 'po_received', 'transitioned_to_planned', 'synced_from_smartsheet', 'internal_approved'

  action_by UUID REFERENCES staff(id),
  action_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- Details
  old_value JSONB,
  new_value JSONB,
  notes TEXT,

  -- Source
  source VARCHAR(20) DEFAULT 'manual', -- 'manual', 'smartsheet_sync', 'system', 'api'

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_pal_project ON pipeline_activity_log(pipeline_project_id);
CREATE INDEX idx_pal_action ON pipeline_activity_log(action);
CREATE INDEX idx_pal_date ON pipeline_activity_log(action_at);
```

### 2.7 Smartsheet Sync Configuration

```sql
-- Smartsheet sync configuration
CREATE TABLE smartsheet_sync_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  sheet_id VARCHAR(100) NOT NULL,
  sheet_name VARCHAR(255),
  workspace_id VARCHAR(100),

  -- Sync settings
  is_active BOOLEAN DEFAULT true,
  sync_direction VARCHAR(20) DEFAULT 'from_smartsheet', -- 'from_smartsheet', 'to_smartsheet', 'bidirectional'
  sync_frequency_minutes INTEGER DEFAULT 60,
  last_sync_at TIMESTAMP WITH TIME ZONE,
  last_sync_status VARCHAR(20),
  last_sync_error TEXT,

  -- Column mappings
  column_mappings JSONB NOT NULL,
  /* Example:
  {
    "project_name": {"ss_column_id": "123", "ss_column_name": "Project Name"},
    "province": {"ss_column_id": "124", "ss_column_name": "Province"},
    "wayleave_eskom_status": {"ss_column_id": "125", "ss_column_name": "Eskom Status"},
    "wayleave_eskom_expiry": {"ss_column_id": "126", "ss_column_name": "Eskom Expiry Date"},
    ...
  }
  */

  -- Filtering
  filter_criteria JSONB, -- Only sync rows matching criteria

  -- API credentials (encrypted reference)
  api_token_ref VARCHAR(100), -- Reference to secure storage

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_by UUID REFERENCES staff(id)
);

-- Sync history for debugging
CREATE TABLE smartsheet_sync_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  config_id UUID NOT NULL REFERENCES smartsheet_sync_config(id),

  sync_started_at TIMESTAMP WITH TIME ZONE NOT NULL,
  sync_completed_at TIMESTAMP WITH TIME ZONE,

  status VARCHAR(20), -- 'running', 'completed', 'failed', 'partial'

  -- Stats
  rows_processed INTEGER DEFAULT 0,
  rows_created INTEGER DEFAULT 0,
  rows_updated INTEGER DEFAULT 0,
  rows_skipped INTEGER DEFAULT 0,
  rows_errored INTEGER DEFAULT 0,

  -- Details
  error_details JSONB, -- [{row_id, error}]
  sync_log TEXT,

  triggered_by VARCHAR(20), -- 'scheduled', 'manual', 'webhook'
  triggered_by_user UUID REFERENCES staff(id)
);
```

---

## 3. API Endpoints

### 3.1 Pipeline Projects

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/pipeline/projects` | List with filters, pagination |
| POST | `/api/pipeline/projects` | Create new pipeline project |
| GET | `/api/pipeline/projects/[id]` | Get single project with approvals |
| PUT | `/api/pipeline/projects/[id]` | Update project |
| DELETE | `/api/pipeline/projects/[id]` | Soft delete |
| GET | `/api/pipeline/projects/[id]/approvals` | Get all approvals for project |
| POST | `/api/pipeline/projects/[id]/approvals` | Add approval requirement |
| GET | `/api/pipeline/projects/[id]/activity` | Get activity log |
| POST | `/api/pipeline/projects/[id]/receive-po` | Mark PO received |
| POST | `/api/pipeline/projects/[id]/transition` | Transition to planned project |

### 3.2 Approvals

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/pipeline/approvals/[id]` | Get approval details |
| PUT | `/api/pipeline/approvals/[id]` | Update approval |
| POST | `/api/pipeline/approvals/[id]/submit` | Submit application |
| POST | `/api/pipeline/approvals/[id]/approve` | Mark as approved |
| POST | `/api/pipeline/approvals/[id]/reject` | Mark as rejected |
| POST | `/api/pipeline/approvals/[id]/documents` | Upload document |
| GET | `/api/pipeline/approvals/[id]/documents` | List documents |
| POST | `/api/pipeline/approvals/[id]/internal-approve` | Internal approval (PM/Ops) |

### 3.3 Approval Types (Admin)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/pipeline/approval-types` | List all types |
| POST | `/api/pipeline/approval-types` | Create new type |
| PUT | `/api/pipeline/approval-types/[id]` | Update type |

### 3.4 Dashboard & Reports

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/pipeline/dashboard` | Dashboard stats |
| GET | `/api/pipeline/expiring` | Expiring approvals (90/30/7 days) |
| GET | `/api/pipeline/followups` | Due follow-ups |
| GET | `/api/pipeline/reports/status` | Status report |
| GET | `/api/pipeline/reports/approvals` | Approval pipeline report |

### 3.5 Smartsheet Sync

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/pipeline/smartsheet/config` | Get sync config |
| PUT | `/api/pipeline/smartsheet/config` | Update config |
| POST | `/api/pipeline/smartsheet/sync` | Trigger manual sync |
| GET | `/api/pipeline/smartsheet/history` | Sync history |
| POST | `/api/pipeline/smartsheet/test` | Test connection |

---

## 4. Module Structure

```
src/modules/pipeline/
├── types/
│   ├── project.types.ts
│   ├── approval.types.ts
│   ├── document.types.ts
│   ├── smartsheet.types.ts
│   └── index.ts
├── services/
│   ├── pipelineProjectService.ts
│   ├── pipelineApprovalService.ts
│   ├── pipelineDocumentService.ts
│   ├── smartsheetSyncService.ts
│   ├── expiryAlertService.ts
│   └── transitionService.ts      # Handle transition to planned
├── components/
│   ├── PipelineDashboard/
│   │   ├── PipelineDashboard.tsx
│   │   ├── PipelineStatsCards.tsx
│   │   ├── PipelineProjectList.tsx
│   │   └── ApprovalPipelineChart.tsx
│   ├── ProjectDetail/
│   │   ├── PipelineProjectDetail.tsx
│   │   ├── ApprovalGatesSection.tsx
│   │   ├── ApprovalCard.tsx
│   │   ├── DocumentsTab.tsx
│   │   └── ActivityTab.tsx
│   ├── Forms/
│   │   ├── PipelineProjectForm.tsx
│   │   ├── ApprovalForm.tsx
│   │   └── POReceiptForm.tsx
│   ├── Modals/
│   │   ├── InternalApprovalModal.tsx
│   │   ├── SubmitApplicationModal.tsx
│   │   └── TransitionToPlannedModal.tsx
│   └── Smartsheet/
│       ├── SmartsheetConfig.tsx
│       └── SyncStatusCard.tsx
├── hooks/
│   ├── usePipelineProjects.ts
│   ├── usePipelineApprovals.ts
│   ├── useSmartsheetSync.ts
│   └── useExpiryAlerts.ts
└── utils/
    ├── approvalStatusHelpers.ts
    ├── smartsheetMapper.ts
    └── transitionValidation.ts
```

---

## 5. Key Features

### 5.1 Approval Gates Visualization

```
┌─────────────────────────────────────────────────────────────┐
│ Project: Lawley Phase 2                                     │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐ │
│  │ Wayleave │   │Municipal │   │  Trad.   │   │   PO     │ │
│  │  Eskom   │   │ Approval │   │ Council  │   │ Received │ │
│  │    ✅    │──▶│    🔄    │──▶│    ⏳    │──▶│    ❌    │ │
│  │ Approved │   │In Review │   │Not Start │   │ Pending  │ │
│  │ Exp: 90d │   │ Sub: 15d │   │          │   │          │ │
│  └──────────┘   └──────────┘   └──────────┘   └──────────┘ │
│                                                             │
│  Overall Progress: ████████░░░░░░░░ 40%                    │
│  Status: APPROVALS IN PROGRESS                              │
└─────────────────────────────────────────────────────────────┘
```

### 5.2 Internal Approval Flow

```
Application Ready
       │
       ▼
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   PM Review  │────▶│  Ops Review  │────▶│   Submit to  │
│              │     │              │     │  Authority   │
└──────────────┘     └──────────────┘     └──────────────┘
       │                    │
       ▼                    ▼
   Rejected             Rejected
   (with notes)         (with notes)
```

### 5.3 Transition to Planned Project

When all gates are satisfied:
1. Validate all required approvals are "approved" and not expired
2. Validate PO is received with valid document
3. Create entry in `projects` table with copied data
4. Link documents to new project
5. Set `planned_project_id` reference
6. Update pipeline status to "planned"
7. Log transition in activity

---

## 6. Smartsheet Integration

### 6.1 Sync Strategy

- **Direction**: From Smartsheet (source of truth) with manual override
- **Frequency**: Configurable (default: hourly)
- **Conflict Resolution**: Smartsheet wins unless field is in `sync_overrides`

### 6.2 Field Mapping (Configurable)

Default mappings:
```typescript
{
  // Project fields
  project_name: 'Project Name',
  province: 'Province',
  municipality: 'Municipality',
  area: 'Area/Location',
  client_name: 'Client',
  estimated_value: 'Est. Value',
  estimated_homes: 'Est. Homes Passed',

  // Approval statuses (per type)
  wayleave_eskom_status: 'Eskom Status',
  wayleave_eskom_expiry: 'Eskom Expiry',
  wayleave_eskom_ref: 'Eskom Ref',
  municipal_status: 'Municipal Status',
  municipal_expiry: 'Municipal Expiry',
  traditional_status: 'Traditional Council',

  // Dates
  application_date: 'Date Applied',
  expected_completion: 'Expected Completion'
}
```

### 6.3 Sync Service

```typescript
// smartsheetSyncService.ts
export class SmartsheetSyncService {
  async syncFromSmartsheet(configId: string): Promise<SyncResult>;
  async mapRowToProject(row: SmartsheetRow, mapping: ColumnMapping): Promise<PipelineProject>;
  async resolveConflicts(local: PipelineProject, remote: SmartsheetRow): Promise<PipelineProject>;
  async handleOverrides(project: PipelineProject, overrides: string[]): Promise<PipelineProject>;
}
```

---

## 7. Notification System

### 7.1 Alert Types

| Alert | Recipients | Timing |
|-------|------------|--------|
| Expiry 90-day | PM, Wayleaves Officer | 90 days before |
| Expiry 30-day | PM, Wayleaves Officer, Ops Manager | 30 days before |
| Expiry 7-day | PM, Wayleaves Officer, Ops Manager | 7 days before |
| Expired | All above + Director | On expiry date |
| Follow-up Due | Wayleaves Officer | On due date |
| Internal Approval Required | Next Approver | On submission |

### 7.2 Notification Methods

- In-app notifications (bell icon)
- Email (via existing email service)
- Optional: WhatsApp (via existing bridge)

---

## 8. UI Pages

### 8.1 Page Structure

```
pages/
├── pipeline/
│   ├── index.tsx           # Dashboard with project list
│   ├── [id]/
│   │   ├── index.tsx       # Project detail with approval gates
│   │   └── edit.tsx        # Edit project
│   ├── new.tsx             # Create new project
│   ├── expiring.tsx        # Expiring approvals view
│   ├── reports.tsx         # Reports dashboard
│   └── settings/
│       └── smartsheet.tsx  # Smartsheet config
```

### 8.2 Dashboard Features

- **Stats Cards**: Total, In Progress, Approvals Complete, Ready to Plan
- **Project List**: Filterable, sortable, with approval status indicators
- **Quick Actions**: Add project, Sync Smartsheet, View expiring
- **Approval Pipeline**: Kanban-style view of projects by approval stage

---

## 9. Implementation Phases

### Phase 1: Core Foundation (Week 1-2)
- [ ] Database migration with all tables
- [ ] Core types and interfaces
- [ ] CRUD API for pipeline projects
- [ ] CRUD API for approvals
- [ ] Basic UI: List and detail pages

### Phase 2: Approval Workflow (Week 2-3)
- [ ] Internal approval flow (PM → Ops)
- [ ] Document upload and management
- [ ] Approval status tracking
- [ ] Activity logging

### Phase 3: Alerts & Notifications (Week 3)
- [ ] Expiry alert generation (triggers)
- [ ] Alert notification service
- [ ] In-app notification display
- [ ] Email notifications

### Phase 4: Smartsheet Integration (Week 4)
- [ ] Smartsheet API client
- [ ] Sync configuration UI
- [ ] Sync service with conflict resolution
- [ ] Manual sync trigger
- [ ] Scheduled sync (cron)

### Phase 5: Transition & Polish (Week 4-5)
- [ ] Transition to planned project flow
- [ ] Document migration on transition
- [ ] Reports and analytics
- [ ] Dashboard refinements
- [ ] Testing and QA

---

## 10. Integration Points

### 10.1 Existing Systems

| System | Integration |
|--------|-------------|
| Projects Module | Transition creates project, links documents |
| Clients | Reference client for pipeline project |
| Staff | Assignment of PM, Wayleaves Officer, Ops Manager |
| Documents | Uses existing upload patterns |
| Notifications | Extends existing notification system |

### 10.2 External Systems

| System | Integration |
|--------|-------------|
| Smartsheet | API sync via `smartsheet` npm package |
| Email | Notification delivery |
| WhatsApp (optional) | Alert delivery |

---

## 11. Security & Permissions

### 11.1 Role-Based Access

| Role | Permissions |
|------|-------------|
| Admin | Full access, config, delete |
| Operations Manager | Approve internal, view all, transition |
| Project Manager | Create, edit own, internal approval |
| Wayleaves Officer | Update approvals, upload docs |
| Viewer | Read-only access |

### 11.2 Audit Trail

- All changes logged in activity_log
- User attribution on all records
- Smartsheet sync tracked separately

---

## 12. Success Metrics

- Time from pipeline entry to planned project
- Approval cycle time per type
- Expiry prevention rate (renewals before expiry)
- Smartsheet sync success rate
- Internal approval turnaround time
