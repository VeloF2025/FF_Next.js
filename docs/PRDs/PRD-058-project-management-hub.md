# PRD-058: Project Management Hub

## Document Information
- **PRD Number**: PRD-058
- **Title**: Project Management Hub - Unified Project Lifecycle System
- **Author**: Claude (PAI)
- **Created**: 2026-01-26
- **Status**: Draft
- **Priority**: High

---

## 1. Overview

### 1.1 Problem Statement
Currently, FibreFlow's project management is fragmented:
- `/projects` shows a simple list with no overview or health metrics
- No unified dashboard showing portfolio status at a glance
- No clear workflow guiding projects from opportunity to completion
- Contractor agreements (SOW, Master Build Agreement) not tracked
- Document expiry (tax clearance, wayleaves, permits) not monitored
- No visibility into which projects have expiring requirements
- Project detail page lacks comprehensive tabs for all related data

### 1.2 Solution Summary
Implement a comprehensive Project Management Hub that:
- Provides a portfolio-level dashboard with health metrics
- Implements VelocityFibre's workflow: PIPELINE → PLANNED → ACTIVE → COMPLETED
- Creates a Project Detail Hub with 12+ interlinked tabs
- Generates contractor agreements (SOW + Master Build Agreement)
- Tracks document expiry with alerts and links to resolution
- Surfaces expiring wayleaves/permits in project dashboards

### 1.3 Success Metrics
- All projects have clear lifecycle stage visibility
- 100% of contractor agreements generated through FibreFlow
- Expiring documents surfaced 30/60/90 days in advance
- Project managers can see all project data in one place
- Zero context-switching needed between modules for project work

---

## 2. VelocityFibre Project Workflow

### 2.1 Workflow Stages

```
┌────────────────────────────────────────────────────────────────────┐
│                        PROJECT LIFECYCLE                            │
├────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  /projects/new (status=PIPELINE)                                    │
│         │                                                           │
│         ▼                                                           │
│  ┌──────────────┐                                                   │
│  │   PIPELINE   │ ← Gather requirements, wayleaves, permits        │
│  │  (Pre-Work)  │   View: /pipeline (Kanban)                       │
│  └──────┬───────┘                                                   │
│         │ Gate: All requirements met                                │
│         ▼                                                           │
│  ┌──────────────┐                                                   │
│  │   PLANNED    │ ← BOQ, contractors, budget, H&S                  │
│  │  (Planning)  │   View: /projects/[id]                           │
│  └──────┬───────┘                                                   │
│         │ Gate: All planning complete + approved                    │
│         ▼                                                           │
│  ┌──────────────┐                                                   │
│  │   ACTIVE     │ ← Track progress, spend, compliance              │
│  │ (Execution)  │   View: /projects/[id]                           │
│  └──────┬───────┘                                                   │
│         │ Gate: Work complete + QA passed                           │
│         ▼                                                           │
│  ┌──────────────┐                                                   │
│  │  COMPLETED   │ ← Final inspection, handover, archive            │
│  │  (Closure)   │   View: /projects/[id]                           │
│  └──────────────┘                                                   │
│                                                                     │
└────────────────────────────────────────────────────────────────────┘
```

### 2.2 Stage Requirements (Gates)

#### PIPELINE → PLANNED Gate
| Requirement | Description | Tracked In |
|-------------|-------------|------------|
| Wayleaves | Municipal wayleaves obtained | project_requirements |
| Permits | Required permits approved | project_requirements |
| Client Agreement | Client contract signed | project_documents |
| Feasibility | Technical feasibility confirmed | project_requirements |
| Documentation | Initial docs gathered | project_documents |

#### PLANNED → ACTIVE Gate
| Requirement | Description | Tracked In |
|-------------|-------------|------------|
| BOQ Approved | Bill of Quantities uploaded & approved | boqs table |
| Contractor Appointed | Contractor assigned with agreement | project_contractors |
| SOW Signed | Scope of Work signed | contractor_agreements |
| MBA Signed | Master Build Agreement signed | contractor_agreements |
| Budget Approved | Budget allocated and approved | project_budgets |
| H&S Verified | Health & Safety compliance verified | hs_compliance |
| Team Assigned | Project team assigned | project_staff |

#### ACTIVE → COMPLETED Gate
| Requirement | Description | Tracked In |
|-------------|-------------|------------|
| All Drops Installed | 100% drop completion | drops table |
| QA Passed | All installations validated | qa_photo_reviews |
| Final Inspection | Site inspection completed | project_requirements |
| Client Handover | Handover document signed | project_documents |

---

## 3. User Stories

### 3.1 Portfolio Manager
```
As a Portfolio Manager
I want to see the health of all projects at a glance
So that I can identify issues before they become critical
```

**Acceptance Criteria:**
- [ ] Dashboard shows total/active/planning/at-risk counts
- [ ] Budget health aggregated across portfolio
- [ ] Network progress (total drops) visible
- [ ] Expiring documents highlighted with count
- [ ] Click-through to specific project details

### 3.2 Project Manager
```
As a Project Manager
I want all project information in one central hub
So that I don't need to navigate multiple pages
```

**Acceptance Criteria:**
- [ ] Project detail page has horizontal tabs for all data
- [ ] Workflow progress indicator shows current stage
- [ ] Checklist shows what's needed for next stage
- [ ] All tabs scoped to THIS project only
- [ ] Cross-links between related tabs work

### 3.3 Project Manager (Expiry Tracking)
```
As a Project Manager
I want to see expiring documents for my project
So that I can resolve issues before they block progress
```

**Acceptance Criteria:**
- [ ] Dashboard shows expiring items count (30/60/90 days)
- [ ] Contractor docs (tax clearance, comp commissioner) tracked
- [ ] Wayleaves/permits with expiry dates shown
- [ ] Click-through to resolve/renew documents
- [ ] Alerts sent as documents approach expiry

### 3.4 Contracts Administrator
```
As a Contracts Administrator
I want to generate contractor agreements from FibreFlow
So that all agreements are consistent and tracked
```

**Acceptance Criteria:**
- [ ] Create SOW for each project-contractor assignment
- [ ] Generate Master Build Agreement with SOW as annexure
- [ ] Track agreement status (draft → sent → signed → active)
- [ ] PDF generation for signature
- [ ] Store signed copies in project documents

### 3.5 Pipeline Manager
```
As a Pipeline Manager
I want to see all pre-project opportunities on a board
So that I can progress them through requirements
```

**Acceptance Criteria:**
- [ ] Kanban board shows PIPELINE projects by sub-stage
- [ ] Document checklist per project item
- [ ] "Move to Planned" when all requirements met
- [ ] Link to full project detail from card

---

## 4. Functional Requirements

### 4.1 Projects Landing Page (`/projects`)

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-4.1.1 | System SHALL show tabbed interface (Overview, All Projects) | Must |
| FR-4.1.2 | Overview tab SHALL show portfolio dashboard | Must |
| FR-4.1.3 | Dashboard SHALL show status counts (Total, Active, Planned, At Risk, Completed) | Must |
| FR-4.1.4 | Dashboard SHALL show aggregated budget health | Must |
| FR-4.1.5 | Dashboard SHALL show total network progress (drops) | Must |
| FR-4.1.6 | Dashboard SHALL show H&S compliance summary | Should |
| FR-4.1.7 | Dashboard SHALL show maintenance ticket counts | Should |
| FR-4.1.8 | Dashboard SHALL show expiring documents alert | Must |
| FR-4.1.9 | All Projects tab SHALL show searchable/filterable list | Must |
| FR-4.1.10 | Recent Projects table SHALL show last 5-10 projects | Should |

### 4.2 Project Detail Hub (`/projects/[id]`)

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-4.2.1 | System SHALL show project header with status badge | Must |
| FR-4.2.2 | System SHALL show workflow progress indicator | Must |
| FR-4.2.3 | System SHALL provide horizontal tabs for all data sections | Must |
| FR-4.2.4 | All tabs SHALL be scoped to current project only | Must |
| FR-4.2.5 | URL SHALL update with tab parameter (?tab=xxx) | Should |
| FR-4.2.6 | Tabs SHALL cross-link to related data | Should |

**Required Tabs:**

| Tab | Content | Priority |
|-----|---------|----------|
| Overview | KPIs, workflow checklist, timeline, activity log, **expiring docs** | Must |
| Progress | UnifiedTrackerGrid (poles, drops, fiber) | Must |
| BOQ & Procurement | BOQ items, RFQs, POs, GRNs, stock | Must |
| Budget | Budget vs Actuals, categories, transactions | Must |
| Team | Staff assigned, contractors assigned, roles | Must |
| Contractor Agreements | SOW, Master Build Agreement, status tracking | Must |
| H&S | Compliance status, audits, incidents | Must |
| Maintenance | Open/resolved tickets | Should |
| Documents | All project files (contracts, reports, wayleaves) | Must |
| Approvals | Pending sign-offs, approval history | Should |
| Communications | WhatsApp logs, activity feed | Could |

### 4.3 Pipeline Module (`/pipeline`)

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-4.3.1 | System SHALL show Kanban board for PIPELINE projects | Must |
| FR-4.3.2 | Kanban columns SHALL be sub-stages (Prospect, Qualifying, Ready) | Must |
| FR-4.3.3 | Each card SHALL show requirement checklist progress | Must |
| FR-4.3.4 | System SHALL track requirements per project | Must |
| FR-4.3.5 | "Move to Planned" SHALL only enable when all requirements met | Must |
| FR-4.3.6 | Card click SHALL navigate to project detail | Must |

### 4.4 Document Expiry Tracking

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-4.4.1 | System SHALL track expiry dates for contractor documents | Must |
| FR-4.4.2 | System SHALL track expiry dates for wayleaves/permits | Must |
| FR-4.4.3 | Dashboard SHALL show count of expiring items (30/60/90 days) | Must |
| FR-4.4.4 | Project overview SHALL list all expiring documents | Must |
| FR-4.4.5 | Expiring wayleaves SHALL link back to pipeline requirements | Must |
| FR-4.4.6 | System SHALL send alerts for expiring documents | Should |

**Document Types with Expiry:**

| Document Type | Typical Validity | Alert Threshold |
|---------------|------------------|-----------------|
| Tax Clearance Certificate | 1 year | 60 days |
| Compensation Commissioner | 1 year | 60 days |
| Municipal Wayleave | Varies | 90 days |
| Building Permit | Project duration | 30 days |
| Insurance Certificate | 1 year | 60 days |
| Safety Training Cert | 2 years | 90 days |

### 4.5 Contractor Agreements

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-4.5.1 | System SHALL allow creating SOW per project-contractor | Must |
| FR-4.5.2 | SOW SHALL define rights, work items, rates | Must |
| FR-4.5.3 | System SHALL generate Master Build Agreement | Must |
| FR-4.5.4 | MBA SHALL include SOW as Annexure A | Must |
| FR-4.5.5 | MBA SHALL include project details and contractor info | Must |
| FR-4.5.6 | System SHALL track agreement status (draft → sent → signed → active) | Must |
| FR-4.5.7 | System SHALL generate PDF for signature | Must |
| FR-4.5.8 | Signed agreements SHALL be stored in project documents | Must |

**SOW Fields:**
- Project reference
- Contractor details
- Work scope description
- Rate card (per-item rates)
- Rights granted
- Duration/timeline
- Terms and conditions reference

**Master Build Agreement Template Sections:**
1. Parties (VelocityFibre + Contractor)
2. Project Details (name, location, scope)
3. Term and Duration
4. Compensation (reference to SOW rates)
5. Rights and Obligations
6. Insurance and Liability
7. Termination
8. Annexure A: Scope of Work

---

## 5. Technical Design

### 5.1 Database Schema

#### 5.1.1 New Tables

**project_requirements** (Pipeline checklist items)
```sql
CREATE TABLE project_requirements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

    requirement_type VARCHAR(50) NOT NULL,
    -- 'wayleave', 'permit', 'client_agreement', 'feasibility', 'documentation'
    -- 'boq_approved', 'contractor_appointed', 'budget_approved', 'hs_verified', 'team_assigned'
    -- 'drops_complete', 'qa_passed', 'final_inspection', 'client_handover'

    requirement_name VARCHAR(255) NOT NULL,
    description TEXT,

    is_completed BOOLEAN DEFAULT false,
    completed_at TIMESTAMP WITH TIME ZONE,
    completed_by VARCHAR(255),

    -- For requirements with documents
    document_id UUID REFERENCES project_documents(id),

    -- For requirements with expiry
    expiry_date DATE,
    expiry_alert_sent BOOLEAN DEFAULT false,

    stage VARCHAR(30) NOT NULL, -- 'pipeline', 'planning', 'execution', 'closure'
    sort_order INTEGER DEFAULT 0,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_project_requirements_project ON project_requirements(project_id);
CREATE INDEX idx_project_requirements_expiry ON project_requirements(expiry_date) WHERE expiry_date IS NOT NULL;
```

**contractor_agreements** (SOW + MBA tracking)
```sql
CREATE TABLE contractor_agreements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    contractor_id UUID NOT NULL REFERENCES contractors(id),

    agreement_type VARCHAR(30) NOT NULL, -- 'sow', 'mba'

    -- SOW-specific fields
    work_scope TEXT,
    rate_card JSONB, -- [{item, unit, rate}, ...]
    rights_granted TEXT,
    terms_reference TEXT,

    -- Status tracking
    status VARCHAR(30) DEFAULT 'draft',
    -- 'draft', 'pending_review', 'sent', 'signed', 'active', 'expired', 'terminated'

    -- Document references
    draft_document_id UUID REFERENCES project_documents(id),
    signed_document_id UUID REFERENCES project_documents(id),

    -- Dates
    effective_date DATE,
    expiry_date DATE,
    sent_at TIMESTAMP WITH TIME ZONE,
    signed_at TIMESTAMP WITH TIME ZONE,

    -- Signatures
    contractor_signatory VARCHAR(255),
    company_signatory VARCHAR(255),

    -- Audit
    created_by VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_contractor_agreements_project ON contractor_agreements(project_id);
CREATE INDEX idx_contractor_agreements_contractor ON contractor_agreements(contractor_id);
CREATE INDEX idx_contractor_agreements_expiry ON contractor_agreements(expiry_date) WHERE expiry_date IS NOT NULL;
```

**document_expiry_tracking** (Unified expiry tracking)
```sql
CREATE TABLE document_expiry_tracking (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Polymorphic reference
    entity_type VARCHAR(50) NOT NULL, -- 'project', 'contractor', 'staff'
    entity_id UUID NOT NULL,
    project_id UUID REFERENCES projects(id), -- For project scoping

    document_type VARCHAR(50) NOT NULL,
    -- 'tax_clearance', 'comp_commissioner', 'wayleave', 'permit',
    -- 'insurance', 'safety_training', 'trade_certificate'

    document_name VARCHAR(255) NOT NULL,
    document_id UUID REFERENCES project_documents(id),

    issue_date DATE,
    expiry_date DATE NOT NULL,

    -- Alert tracking
    alert_90_sent BOOLEAN DEFAULT false,
    alert_60_sent BOOLEAN DEFAULT false,
    alert_30_sent BOOLEAN DEFAULT false,

    -- Resolution
    status VARCHAR(30) DEFAULT 'valid',
    -- 'valid', 'expiring_soon', 'expired', 'renewed'
    renewed_document_id UUID REFERENCES document_expiry_tracking(id),

    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_doc_expiry_project ON document_expiry_tracking(project_id);
CREATE INDEX idx_doc_expiry_entity ON document_expiry_tracking(entity_type, entity_id);
CREATE INDEX idx_doc_expiry_date ON document_expiry_tracking(expiry_date);
```

#### 5.1.2 Schema Modifications

**projects** - Add columns:
```sql
ALTER TABLE projects ADD COLUMN IF NOT EXISTS pipeline_sub_stage VARCHAR(30);
-- 'prospect', 'qualifying', 'ready'

ALTER TABLE projects ADD COLUMN IF NOT EXISTS workflow_stage VARCHAR(30);
-- Computed from status: 'pipeline', 'planning', 'execution', 'closure'

ALTER TABLE projects ADD COLUMN IF NOT EXISTS expiring_docs_count INTEGER DEFAULT 0;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS requirements_met INTEGER DEFAULT 0;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS requirements_total INTEGER DEFAULT 0;
```

**contractors** - Add expiry tracking columns:
```sql
ALTER TABLE contractors ADD COLUMN IF NOT EXISTS tax_clearance_expiry DATE;
ALTER TABLE contractors ADD COLUMN IF NOT EXISTS comp_commissioner_expiry DATE;
ALTER TABLE contractors ADD COLUMN IF NOT EXISTS insurance_expiry DATE;
ALTER TABLE contractors ADD COLUMN IF NOT EXISTS has_expiring_docs BOOLEAN DEFAULT false;
```

### 5.2 API Endpoints

#### Portfolio Dashboard
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/projects/portfolio-dashboard` | Aggregated portfolio metrics |

**Response:**
```typescript
{
  counts: {
    total: number;
    pipeline: number;
    planned: number;
    active: number;
    completed: number;
    atRisk: number;
  };
  budget: {
    totalBudget: number;
    totalCommitted: number;
    totalActual: number;
    health: 'healthy' | 'warning' | 'critical';
  };
  network: {
    totalDrops: number;
    completedDrops: number;
    progressPercent: number;
  };
  compliance: {
    avgHsScore: number;
    openIncidents: number;
    pendingAudits: number;
  };
  maintenance: {
    openTickets: number;
    criticalTickets: number;
  };
  expiringDocs: {
    count30Days: number;
    count60Days: number;
    count90Days: number;
  };
  recentProjects: Project[];
}
```

#### Project Hub
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/projects/[projectId]/hub` | All project hub data |
| GET | `/api/projects/[projectId]/requirements` | Workflow requirements |
| POST | `/api/projects/[projectId]/requirements/[id]/complete` | Mark requirement complete |
| GET | `/api/projects/[projectId]/expiring-documents` | Expiring docs for project |

#### Contractor Agreements
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/projects/[projectId]/contractor-agreements` | List agreements |
| POST | `/api/projects/[projectId]/contractor-agreements` | Create SOW or MBA |
| PUT | `/api/projects/[projectId]/contractor-agreements/[id]` | Update agreement |
| POST | `/api/projects/[projectId]/contractor-agreements/[id]/generate-pdf` | Generate PDF |
| PUT | `/api/projects/[projectId]/contractor-agreements/[id]/status` | Update status |

#### Pipeline
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/pipeline` | Get all pipeline projects |
| PUT | `/api/pipeline/[projectId]/sub-stage` | Update pipeline sub-stage |
| POST | `/api/pipeline/[projectId]/move-to-planned` | Progress to PLANNED |

#### Document Expiry
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/document-expiry` | Get expiring documents |
| GET | `/api/document-expiry/by-project/[projectId]` | Expiring docs for project |
| POST | `/api/document-expiry` | Track new document |
| PUT | `/api/document-expiry/[id]/renew` | Mark as renewed |

### 5.3 Services

**agreementGeneratorService.ts**
```typescript
export const agreementGeneratorService = {
  // Generate SOW document
  generateSOW(projectId: string, contractorId: string, data: SOWData): Promise<Buffer>;

  // Generate Master Build Agreement with SOW as annexure
  generateMBA(projectId: string, contractorId: string, sowId: string): Promise<Buffer>;

  // Save generated PDF to Firebase and create document record
  saveAgreementPDF(buffer: Buffer, metadata: AgreementMetadata): Promise<string>;
};
```

**documentExpiryService.ts**
```typescript
export const documentExpiryService = {
  // Check all documents and update status
  checkExpiry(): Promise<void>;

  // Get expiring documents for project
  getExpiringForProject(projectId: string, daysAhead: number): Promise<ExpiringDocument[]>;

  // Send expiry alerts
  sendExpiryAlerts(): Promise<void>;

  // Link expiring wayleave back to pipeline requirement
  linkToPipelineRequirement(docId: string, requirementId: string): Promise<void>;
};
```

---

## 6. User Interface

### 6.1 Projects Dashboard (`/projects`)

```
┌─────────────────────────────────────────────────────────────────────┐
│ Projects                                         [+ New Project]     │
│ Manage your fiber network projects                                   │
├─────────────────────────────────────────────────────────────────────┤
│ [Overview] [All Projects]                                            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────────────┐       │
│ │Total │ │Pipe- │ │Plan- │ │Active│ │Compl-│ │⚠️ 5 Docs     │       │
│ │  24  │ │line  │ │ned   │ │  12  │ │eted  │ │  Expiring    │       │
│ │      │ │   4  │ │   3  │ │      │ │   5  │ │  Soon        │       │
│ └──────┘ └──────┘ └──────┘ └──────┘ └──────┘ └──────────────┘       │
│                                                                      │
│ ┌───────────────────────────┐ ┌───────────────────────────┐         │
│ │ Budget Health             │ │ Network Progress          │         │
│ │ ▓▓▓▓▓▓▓▓░░░░ 68%         │ │ ▓▓▓▓▓▓░░░░░░ 52%         │         │
│ │ R 4.2M / R 6.2M          │ │ 2,450 / 4,700 drops       │         │
│ │ ● Healthy                 │ │                           │         │
│ └───────────────────────────┘ └───────────────────────────┘         │
│                                                                      │
│ ┌───────────────────────────┐ ┌───────────────────────────┐         │
│ │ H&S Compliance            │ │ Maintenance               │         │
│ │ 92% Average Score         │ │ 18 Open Tickets           │         │
│ │ 0 Open Incidents          │ │ 4 Critical                │         │
│ └───────────────────────────┘ └───────────────────────────┘         │
│                                                                      │
│ Recent Projects                                      [View All →]    │
│ ┌────────────────────────────────────────────────────────────────┐  │
│ │ Name           │ Client    │ Status  │ Progress │ Manager      │  │
│ │ Lawley Ph2     │ VumaCo    │ Active  │ 67%      │ John D       │  │
│ │ Midrand North  │ OpenServe │ Planned │ 15%      │ Sarah M      │  │
│ │ Century CBD    │ VumaCo    │ Active  │ 42%      │ Mike R       │  │
│ └────────────────────────────────────────────────────────────────┘  │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 6.2 Project Detail Hub (`/projects/[id]`)

```
┌─────────────────────────────────────────────────────────────────────┐
│ ← Projects    Lawley Phase 2                    [Active] ● Healthy  │
│               VumaCo · PM: John Doe                                  │
├─────────────────────────────────────────────────────────────────────┤
│ Workflow: [●] Pipeline → [●] Planned → [◐] Active → [ ] Completed   │
├─────────────────────────────────────────────────────────────────────┤
│ [Overview] [Progress] [BOQ] [Budget] [Team] [Agreements] [H&S] ...  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│ ┌─────────────────────────────────────────────────────────────────┐ │
│ │ OVERVIEW TAB CONTENT                                            │ │
│ │                                                                 │ │
│ │ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌────────────┐ │ │
│ │ │ Progress    │ │ Budget      │ │ Team        │ │ ⚠️ 2 Docs  │ │ │
│ │ │ 67%         │ │ 68%         │ │ 12 Members  │ │ Expiring   │ │ │
│ │ │ 1,580/2,350 │ │ R 2.1M      │ │ 3 Contrs    │ │ Tax Clear  │ │ │
│ │ └─────────────┘ └─────────────┘ └─────────────┘ └────────────┘ │ │
│ │                                                                 │ │
│ │ What's Needed for Completion:                                   │ │
│ │ ☑ All drops installed (67% complete)                           │ │
│ │ ☐ QA validation passed                                          │ │
│ │ ☐ Final inspection                                              │ │
│ │ ☐ Client handover signed                                        │ │
│ │                                                                 │ │
│ │ Expiring Documents (30 days):                          [View →] │ │
│ │ ├─ Tax Clearance - ABC Contractors - Expires Feb 15             │ │
│ │ └─ Wayleave - Section 12 - Expires Feb 28 [Resolve →]          │ │
│ │                                                                 │ │
│ └─────────────────────────────────────────────────────────────────┘ │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 6.3 Contractor Agreements Tab

```
┌─────────────────────────────────────────────────────────────────────┐
│ Contractor Agreements                        [+ Create Agreement]    │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│ ABC Construction (Pty) Ltd                                           │
│ ┌────────────────────────────────────────────────────────────────┐  │
│ │ Scope of Work (SOW)                              [Active] ✓    │  │
│ │ Created: 2026-01-15 │ Signed: 2026-01-18                       │  │
│ │ [View PDF] [Edit]                                              │  │
│ ├────────────────────────────────────────────────────────────────┤  │
│ │ Master Build Agreement                           [Active] ✓    │  │
│ │ Created: 2026-01-15 │ Signed: 2026-01-20                       │  │
│ │ Includes: SOW as Annexure A                                    │  │
│ │ [View PDF]                                                     │  │
│ └────────────────────────────────────────────────────────────────┘  │
│                                                                      │
│ Contractor Documents                                                 │
│ ┌────────────────────────────────────────────────────────────────┐  │
│ │ Document             │ Status    │ Expiry      │ Action        │  │
│ │ Tax Clearance        │ ⚠️ Expiring│ 2026-02-15 │ [Request New] │  │
│ │ Comp Commissioner    │ ✓ Valid   │ 2026-08-30 │               │  │
│ │ Public Liability Ins │ ✓ Valid   │ 2026-12-01 │               │  │
│ └────────────────────────────────────────────────────────────────┘  │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 6.4 Pipeline Kanban (`/pipeline`)

```
┌─────────────────────────────────────────────────────────────────────┐
│ Pipeline                                        [+ New Project]      │
│ Pre-project opportunities and requirements tracking                  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│ ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐      │
│ │   PROSPECT (3)   │ │ QUALIFYING (2)   │ │    READY (1)     │      │
│ │                  │ │                  │ │                  │      │
│ │ ┌──────────────┐ │ │ ┌──────────────┐ │ │ ┌──────────────┐ │      │
│ │ │ Sandton CBD  │ │ │ │ Rosebank Ph3 │ │ │ │ Bryanston    │ │      │
│ │ │ VumaCo       │ │ │ │ OpenServe    │ │ │ │ MTN          │ │      │
│ │ │ ▓▓░░░ 2/5    │ │ │ │ ▓▓▓▓░ 4/5    │ │ │ │ ▓▓▓▓▓ 5/5   │ │      │
│ │ │              │ │ │ │              │ │ │ │ [→ Planned]  │ │      │
│ │ └──────────────┘ │ │ └──────────────┘ │ │ └──────────────┘ │      │
│ │ ┌──────────────┐ │ │ ┌──────────────┐ │ │                  │      │
│ │ │ Randburg     │ │ │ │ Fourways     │ │ │                  │      │
│ │ │ Client TBD   │ │ │ │ Liquid       │ │ │                  │      │
│ │ │ ▓░░░░ 1/5    │ │ │ │ ▓▓▓░░ 3/5    │ │ │                  │      │
│ │ └──────────────┘ │ │ │ ⚠️ Wayleave  │ │ │                  │      │
│ │                  │ │ │    expiring  │ │ │                  │      │
│ │                  │ │ └──────────────┘ │ │                  │      │
│ └──────────────────┘ └──────────────────┘ └──────────────────┘      │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 7. Implementation Plan

### Phase 1: Database & API Foundation
**Duration: ~400 lines**

1. Create migration script (project_requirements, contractor_agreements, document_expiry_tracking)
2. Modify projects table (add workflow columns)
3. Create portfolio-dashboard API
4. Create project hub API
5. Create document-expiry API

### Phase 2: Projects Landing Dashboard
**Duration: ~500 lines**

1. Refactor `/pages/projects/index.tsx` with tabs
2. Create PortfolioDashboard components
3. Create expiring documents alert card
4. Wire up to API

### Phase 3: Project Detail Hub
**Duration: ~1,200 lines**

1. Create ProjectHubLayout with horizontal tabs
2. Implement ProjectOverviewTab with expiring docs
3. Implement ProjectContractorAgreementsTab
4. Implement other tabs (BOQ, Budget, Team, H&S, etc.)
5. Create WorkflowChecklist component

### Phase 4: Agreement Generation
**Duration: ~400 lines**

1. Create SOW form and CRUD
2. Create MBA generator service
3. Implement PDF generation (using existing PDF infrastructure)
4. Track agreement status

### Phase 5: Pipeline Enhancement
**Duration: ~400 lines**

1. Enhance PipelineKanban with sub-stages
2. Add requirement checklist per project
3. Add expiring document warnings
4. Implement "Move to Planned" action

### Phase 6: Document Expiry System
**Duration: ~300 lines**

1. Create document expiry tracking CRUD
2. Implement expiry checking cron job
3. Link expiring wayleaves to pipeline requirements
4. Send expiry alerts

### Phase 7: Integration & Polish
**Duration: ~200 lines**

1. URL state for tabs
2. Cross-linking between modules
3. Dark mode verification
4. Testing

**Total Estimated: ~3,400 lines**

---

## 8. File Structure

```
pages/
├── projects/
│   ├── index.tsx                    # MODIFY - Add dashboard
│   ├── [id]/
│   │   └── index.tsx                # MODIFY - Add hub tabs
│   └── new.tsx                      # EXISTS - Add PIPELINE default
├── pipeline/
│   └── index.tsx                    # MODIFY - Enhance with sub-stages
└── api/
    ├── projects/
    │   ├── portfolio-dashboard.ts   # NEW
    │   ├── [projectId]/
    │   │   ├── hub.ts               # NEW
    │   │   ├── requirements.ts      # NEW
    │   │   ├── contractor-agreements.ts  # NEW
    │   │   ├── generate-agreement.ts     # NEW
    │   │   └── expiring-documents.ts     # NEW
    ├── pipeline/
    │   └── index.ts                 # NEW/MODIFY
    └── document-expiry/
        └── index.ts                 # NEW

src/modules/projects/
├── components/
│   ├── Dashboard/
│   │   ├── PortfolioDashboard.tsx   # NEW
│   │   ├── PortfolioStatsCards.tsx  # NEW
│   │   ├── BudgetHealthCard.tsx     # NEW
│   │   ├── ExpiringDocsCard.tsx     # NEW
│   │   └── RecentProjectsTable.tsx  # NEW
│   └── ProjectHub/
│       ├── ProjectHubLayout.tsx     # NEW
│       ├── ProjectOverviewTab.tsx   # NEW
│       ├── ProjectProgressTab.tsx   # NEW
│       ├── ProjectBOQTab.tsx        # NEW
│       ├── ProjectBudgetTab.tsx     # NEW
│       ├── ProjectTeamTab.tsx       # NEW
│       ├── ProjectContractorAgreementsTab.tsx  # NEW
│       ├── ProjectHSTab.tsx         # NEW
│       ├── ProjectMaintenanceTab.tsx # NEW
│       ├── ProjectDocumentsTab.tsx  # NEW
│       ├── WorkflowChecklist.tsx    # NEW
│       └── ExpiringDocsList.tsx     # NEW
└── services/
    ├── agreementGeneratorService.ts # NEW
    ├── sowService.ts                # NEW
    └── documentExpiryService.ts     # NEW

scripts/migrations/
└── 058_project_management_hub.sql   # NEW
```

---

## 9. Dependencies

- PRD-057: Project Budget Tracking System (budget integration)
- PRD-050: Procurement Portal (BOQ, PO, GRN integration)
- Existing: UnifiedTrackerGrid (progress tracking)
- Existing: H&S module (audits, incidents)
- Existing: Maintenance module (tickets)
- Existing: Pipeline module (kanban base)

---

## 10. Out of Scope

- Multi-project Gantt chart visualization (future)
- Resource capacity planning across projects (future)
- Automated document renewal workflows (future)
- Mobile-specific optimizations (future)
- Project templates (future)

---

## 11. Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Large tab count may overwhelm users | Medium | Use tab overflow menu, remember last tab |
| PDF generation performance | Low | Generate async, cache templates |
| Expiry alerts flooding users | Medium | Batch alerts, configurable thresholds |
| Migration on existing projects | Medium | Backfill script for requirements |

---

## 12. Approval

| Role | Name | Date | Signature |
|------|------|------|-----------|
| Product Owner | | | |
| Tech Lead | | | |
| QA Lead | | | |
