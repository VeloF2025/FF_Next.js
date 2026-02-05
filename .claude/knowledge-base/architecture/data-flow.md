# Data Flow Diagrams

## Core Data Flows

### 1. Project Lifecycle

```mermaid
stateDiagram-v2
    [*] --> Planning: Create Project
    Planning --> Activation: Requirements Met
    Activation --> Active: Activation Complete
    Active --> OnHold: Pause
    OnHold --> Active: Resume
    Active --> Closeout: Work Complete
    Closeout --> Completed: Final Review
    Completed --> [*]

    note right of Planning
        - Client assigned
        - Budget allocated
        - Team assigned
    end note

    note right of Activation
        - 5-phase wizard
        - VLM photo validation
        - Document verification
    end note
```

### 2. SOW Import Flow

```mermaid
sequenceDiagram
    participant User
    participant UI as SOW Import UI
    participant API as /api/sow/import
    participant Parser as Excel Parser
    participant DB as drops table
    participant QField as QField Sync

    User->>UI: Upload Excel file
    UI->>API: POST file
    API->>Parser: Parse workbook
    Parser->>Parser: Validate structure
    Parser->>Parser: Extract drops
    Parser->>DB: Batch insert drops
    DB->>API: Confirm insert
    API->>UI: Success response
    UI->>User: Show imported count

    Note over QField,DB: Later...
    QField->>DB: Sync field data
    DB->>DB: Update drop status
```

**Key Tables**: `drops`, `sow_imports`

### 3. Daily Reporting & QA Flow

```mermaid
sequenceDiagram
    participant Field as Field Team
    participant WA as WhatsApp
    participant Bridge as WA Bridge :8083
    participant API as FibreFlow API
    participant VLM as VLM :8100
    participant DB as Database
    participant QA as QA Team

    Field->>WA: Send DR photos + message
    WA->>Bridge: Webhook delivery
    Bridge->>API: POST /api/wa-monitor-webhook
    API->>DB: Store in qa_photo_reviews
    API->>VLM: Analyze photo quality
    VLM->>API: Quality assessment
    API->>DB: Update review status

    QA->>API: GET /api/qa/reviews
    API->>DB: Fetch pending reviews
    DB->>API: Reviews list
    API->>QA: Display for review
    QA->>API: POST /api/qa/approve
    API->>WA: Send confirmation via WA Sender
```

**Key Tables**: `qa_photo_reviews`, `dr_photos`, `dr_photo_unified_reviews`

### 4. Procurement Flow

```mermaid
sequenceDiagram
    participant PM as Project Manager
    participant UI as Procurement UI
    participant API as API Routes
    participant VLM as VLM :8100
    participant DB as Database
    participant Supplier

    Note over PM,Supplier: Phase 1: BOQ
    PM->>UI: Create BOQ
    UI->>API: POST /api/procurement/boq
    API->>DB: Store BOQ items

    Note over PM,Supplier: Phase 2: RFQ
    PM->>UI: Create RFQ from BOQ
    UI->>API: POST /api/procurement/rfq
    API->>DB: Store RFQ
    API->>Supplier: Send RFQ (email/WA)

    Note over PM,Supplier: Phase 3: Quote Evaluation
    Supplier->>UI: Submit quote
    UI->>API: POST /api/procurement/quotes
    API->>DB: Store quote
    PM->>UI: Evaluate quotes
    UI->>API: POST /api/procurement/quote-evaluation
    API->>DB: Store evaluation

    Note over PM,Supplier: Phase 4: PO Creation
    PM->>UI: Upload PO image
    UI->>VLM: Extract PO data
    VLM->>UI: Extracted fields
    UI->>API: POST /api/procurement/po
    API->>DB: Store PO
```

**Key Tables**: `boq_items`, `rfq`, `quotes`, `purchase_orders`

### 5. Fleet Check-in Flow

```mermaid
sequenceDiagram
    participant Driver
    participant App as Fleet App
    participant API as /api/fleet/check-in
    participant VLM as VLM :8100
    participant DB as Database
    participant Manager

    Driver->>App: Start check-in
    App->>App: Capture photos (odometer, plates, damage)
    App->>API: POST photos + metadata
    API->>VLM: Extract plate number
    VLM->>API: Plate: ABC123GP
    API->>VLM: Extract odometer reading
    VLM->>API: Reading: 45,230 km
    API->>DB: Store check-in record
    API->>DB: Update vehicle mileage

    alt Issues Detected
        API->>Manager: Notify of issues
    end

    API->>App: Check-in complete
```

**Key Tables**: `vehicle_check_ins`, `vehicles`, `fleet_photos`

### 6. Project Activation Flow

```mermaid
sequenceDiagram
    participant PM as Project Manager
    participant UI as Activation Wizard
    participant API as API Routes
    participant VLM as VLM :8100
    participant DB as Database

    PM->>UI: Start activation

    Note over PM,DB: Phase 1: Basic Info
    UI->>PM: Verify project details
    PM->>UI: Confirm

    Note over PM,DB: Phase 2: Documents
    UI->>API: GET /api/projects/{id}/documents
    API->>DB: Check required docs
    DB->>API: Document status
    alt Missing Documents
        PM->>UI: Upload documents
        UI->>API: POST /api/documents
    end

    Note over PM,DB: Phase 3: Team
    UI->>API: GET /api/projects/{id}/team
    API->>DB: Check team assignments
    alt Missing Roles
        PM->>UI: Assign team members
    end

    Note over PM,DB: Phase 4: Budget
    UI->>API: GET /api/projects/{id}/budget
    API->>DB: Check budget allocation

    Note over PM,DB: Phase 5: Site Photos
    PM->>UI: Upload site photos
    UI->>VLM: Validate photos
    VLM->>UI: Validation result

    PM->>UI: Complete activation
    UI->>API: POST /api/projects/{id}/activate
    API->>DB: Update status to 'active'
```

**Key Tables**: `projects`, `project_team`, `documents`, `budgets`

## Database Schema Overview

```mermaid
erDiagram
    projects ||--o{ drops : contains
    projects ||--o{ project_team : has
    projects ||--o{ documents : has
    projects ||--o{ budgets : has
    projects ||--o{ purchase_orders : has

    clients ||--o{ projects : owns
    users ||--o{ project_team : member_of

    drops ||--o{ qa_photo_reviews : reviewed_by

    vehicles ||--o{ vehicle_check_ins : has
    vehicles ||--o{ fleet_photos : has

    rfq ||--o{ quotes : receives
    quotes ||--o{ purchase_orders : generates

    projects {
        uuid id PK
        string name
        string status
        uuid client_id FK
        date start_date
        date end_date
    }

    drops {
        uuid id PK
        uuid project_id FK
        string drop_id
        string status
        geometry location
    }

    qa_photo_reviews {
        uuid id PK
        uuid drop_id FK
        string status
        jsonb photos
        timestamp reviewed_at
    }
```

## Key Data Relationships

| Source | Relationship | Target | Notes |
|--------|--------------|--------|-------|
| `projects` | 1:N | `drops` | SOW data |
| `projects` | 1:N | `project_team` | Team assignments |
| `projects` | 1:N | `documents` | Project documents |
| `projects` | 1:N | `purchase_orders` | Procurement |
| `clients` | 1:N | `projects` | Client ownership |
| `users` | N:M | `projects` | Via `project_team` |
| `drops` | 1:N | `qa_photo_reviews` | QA workflow |
| `vehicles` | 1:N | `vehicle_check_ins` | Fleet tracking |
| `rfq` | 1:N | `quotes` | Quote collection |

## Critical Table Disambiguation

**Two "drops" concepts exist - do not confuse:**

| Table | Purpose | API | Module |
|-------|---------|-----|--------|
| `drops` | SOW import data | `/api/sow/drops` | SOW |
| `qa_photo_reviews` | WhatsApp DR photos | `/api/wa-monitor-*` | WA Monitor |

They are NOT the same table despite similar naming in the UI.
