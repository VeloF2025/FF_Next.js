# Manco Module

**Status:** Production | **Version:** 1.0.0 | **Last Updated:** 2026-03-30

## Overview

The Manco module provides a dedicated interface for tracking and managing executive-level strategic action items logged during Manco management meetings. These are high-stakes, cross-functional action items that require visibility across departments and FibreFlow development teams.

Manco items differ from regular meeting action items in that they:
- Are logged manually during or after management strategy sessions
- Track accountabilities at the department level (Finance, Tech, Operations, etc.)
- Link to FibreFlow development work when applicable
- Include ETAs and completion milestones
- Require executive visibility and status tracking

The Manco module is integrated within the broader **Action Items** system but operates as a separate data model with dedicated kanban views, meeting context panels, and comment threads for strategic discussion.

## Key Features

1. **Strategic Kanban Board** — Four-column workflow (Pending → In Progress → Completed → Overdue) with visual status indicators
2. **Department Accountability** — Track which department (Finance, Tech, Operations, etc.) owns each action item
3. **FibreFlow Dev Linkage** — Mark items requiring development work; link to specific FibreFlow modules and assign dev ownership
4. **ETA Tracking** — Target completion dates with automated overdue detection and day countdown
5. **Meeting Context** — Pull related Manco meeting details, transcript excerpts, and decision summaries into the detail pane
6. **Comment Threads** — Leadership team can add status updates, blockers, and commentary directly on items
7. **Advanced Filtering** — Filter by status, department, responsible person, and full-text search across action item descriptions
8. **Real-Time Status Updates** — Move items between kanban columns; status syncs immediately to all viewers

## Data Model

### MancoActionItem (Core: `manco_action_items` Table)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | UUID | Yes | Unique identifier |
| `action_item` | String | Yes | Action item description or title |
| `department` | String | No | Responsible department (Finance, Tech, Operations, Sales, HR, etc.) |
| `logged_date` | Date | No | Date the action was logged/created |
| `completion_eta` | Date | No | Target completion date (used for overdue detection) |
| `completion_date` | Date | No | Actual completion date (when marked done) |
| `responsible_person` | String | No | Primary contact/accountable person name |
| `fibreflow_dev` | Boolean | Yes | Is this a development task requiring FibreFlow engineering? |
| `fibreflow_module` | String | No | Which FibreFlow module is affected (procurement, assets, communications, etc.) |
| `fibreflow_link` | String | No | Direct URL link to related FibreFlow page/module |
| `fibreflow_responsible` | String | No | FibreFlow engineer/team responsible for dev work |
| `fibreflow_priority` | String | No | Dev priority (low, medium, high, urgent) |
| `fibreflow_dev_status` | String | No | Dev status tracking (pending, in_progress, blocked, completed) |
| `comment` | String | No | Latest status comment, blocker note, or update |
| `status` | Enum | Yes | Current kanban status: `pending` \| `in_progress` \| `completed` \| `cancelled` |
| `is_ongoing` | Boolean | No | Is this a recurring/ongoing item? |
| `source_meeting_id` | Integer | No | Reference to source Manco meeting record |
| `created_at` | Timestamp | Yes | Record creation time |
| `updated_at` | Timestamp | Yes | Last modification time |

### MancoActionItemComment (Comments: `manco_action_item_comments` Table)

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Comment identifier |
| `manco_action_item_id` | UUID | Reference to parent action item |
| `author_name` | String | Name of commenter |
| `author_user_id` | UUID | FibreFlow user ID of commenter |
| `content` | String | Comment text |
| `created_at` | Timestamp | When comment was added |

### MancoMeetingContext (Meeting Metadata)

Structure returned by `/api/manco-action-items/meeting-context`:

```typescript
{
  meeting: {
    id: number;
    title: string;
    meeting_date: string;
  } | null;
  excerpts: [
    {
      timestamp: string;
      speaker: string;
      text: string;
    }
  ];
  summary: {
    overview: string;
    decisions: string[];
    action_items: string[];
  } | null;
}
```

## Components

### MancoKanbanView
**Location:** `/src/modules/action-items/components/MancoKanbanView.tsx`

Kanban board visualization for Manco strategic items.

**Columns:**
1. **Pending** — Items newly logged, awaiting work start
2. **In Progress** — Currently being worked on
3. **Completed** — Finished items
4. **Overdue** — Items past completion_eta (auto-filtered based on current date)

**Features:**
- Column header with item count badge (color-coded by column)
- Card display with:
  - Action item title (truncated to 2 lines)
  - Department badge (e.g., "Finance", "Tech")
  - FibreFlow module badge (e.g., "Procurement", "Assets")
  - Responsible person name
  - ETA with color coding (red=overdue, yellow=≤7 days, grey=on track)
- Click card to open detail pane
- Responsive horizontal scroll on mobile

**Props:**
```typescript
interface MancoKanbanViewProps {
  items: MancoActionItem[];
  onItemClick: (item: MancoActionItem) => void;
}
```

---

### MancoDetailPane
**Location:** `/src/modules/action-items/components/MancoDetailPane.tsx`

Full-detail slide-out panel for viewing and editing a single Manco action item.

**Sections:**
- **Item Overview** — Title, department, responsible person, logged date, ETA
- **Status Selector** — Dropdown to move between pending → in_progress → completed → cancelled
- **FibreFlow Dev Tracking** — Shows if item is dev-related, module, assigned engineer, dev status, priority
- **Meeting Context** — Related Manco meeting title, date, transcript excerpts, meeting summary
- **Comment Thread** — Display existing comments; add new comment (current user auto-assigned as author)
- **Timestamps** — created_at, updated_at, completion_date

**Key Methods:**
- `handleStatusUpdate()` — PATCH to `/api/manco-action-items/:id` with new status
- `fetchComments()` — GET from `/api/manco-action-items/comments?item_id=:id`
- `fetchMeetingContext()` — GET from `/api/manco-action-items/meeting-context?item_id=:id`
- `handleAddComment()` — POST to `/api/manco-action-items/comments` with new comment

**Props:**
```typescript
interface MancoDetailPaneProps {
  item: MancoActionItem | null;
  isOpen: boolean;
  onClose: () => void;
  onUpdated: () => void;
}
```

---

### MancoStrategicGrid Page
**Location:** `/src/modules/action-items/pages/MancoStrategicGrid.tsx`

Full-page container for the Manco strategic action items dashboard.

**Features:**
- Filter bar (by status, department, responsible person, search)
- MancoKanbanView integrated below
- MancoDetailPane controlled by kanban card clicks
- Real-time stats bar (total, pending, in_progress, completed, overdue counts)
- Responsive layout for mobile/tablet/desktop

---

## Services/APIs

### Client Service: manco Action Items Methods
**Location:** `/src/services/action-items/actionItemsService.ts`

Methods specifically for Manco items:
```typescript
// List Manco items with filters
mancoList(filters?: MancoActionItemFilters): Promise<MancoActionItem[]>

// Get a single Manco item
mancoGetById(id: string): Promise<MancoActionItem>

// Update Manco item status
mancoUpdateStatus(id: string, status: MancoActionItemStatus): Promise<MancoActionItem>

// Get Manco stats
mancoGetStats(): Promise<MancoActionItemStats>

// Fetch comments for an item
mancoGetComments(itemId: string): Promise<MancoActionItemComment[]>

// Add comment to item
mancoAddComment(itemId: string, content: string): Promise<MancoActionItemComment>

// Fetch meeting context
mancoGetMeetingContext(itemId: string): Promise<MancoMeetingContext>
```

---

### Server API: /api/manco-action-items

**GET /api/manco-action-items** — List Manco items
```
Query Parameters:
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled'
  department: string
  responsible_person: string
  search: string
  limit: number (default 100)
  offset: number (default 0)

Response: MancoActionItem[]

Example:
  GET /api/manco-action-items?status=in_progress&department=Tech
```

**POST /api/manco-action-items** — Create Manco item
```
Body: {
  action_item: string (required)
  department: string
  logged_date: string (ISO date)
  completion_eta: string (ISO date)
  responsible_person: string
  fibreflow_dev: boolean
  fibreflow_module: string
  fibreflow_responsible: string
  fibreflow_priority: string
  fibreflow_dev_status: string
  comment: string
  status: string (required)
}

Response: MancoActionItem (201 Created)
```

**GET /api/manco-action-items/stats** — Summary statistics
```
Response: MancoActionItemStats {
  total: number
  pending: number
  in_progress: number
  completed: number
  overdue: number
}
```

**GET /api/manco-action-items/:id** — Fetch single item
```
Response: MancoActionItem
```

**PATCH /api/manco-action-items/:id** — Update item
```
Body: Partial<MancoActionItem>
Response: MancoActionItem
```

**GET /api/manco-action-items/comments** — List comments for an item
```
Query Parameters:
  item_id: string (required)

Response: MancoActionItemComment[]
```

**POST /api/manco-action-items/comments** — Add comment
```
Body: {
  item_id: string (required)
  content: string (required)
}

Response: MancoActionItemComment (201 Created)
```

**GET /api/manco-action-items/meeting-context** — Fetch meeting context
```
Query Parameters:
  item_id: string (required)

Response: MancoMeetingContext {
  meeting: { id, title, meeting_date } | null
  excerpts: [{ timestamp, speaker, text }]
  summary: { overview, decisions, action_items } | null
}
```

---

## Use Cases

### 1. Executive Strategy Review
Every week, the Manco (management committee) logs action items from their strategy meeting. CFO assigns Finance items (e.g., "Renegotiate supplier contracts"), CTO assigns Tech items (e.g., "Evaluate cloud hosting options"). The kanban board shows all items with ETAs. By Friday, the CFO checks overdue items and re-prioritizes.

**Flow:**
- Manco meeting → Log action items with departments & ETAs → Kanban Pending column → Teams start work → Move to In Progress → Add status comments → Complete by ETA → Move to Completed

---

### 2. Cross-Functional Development Initiative
A strategic decision requires both business and FibreFlow engineering work. Item logged with `fibreflow_dev=true`, linked to "procurement" module, assigned to Lead Dev. Dev team uses the `fibreflow_dev_status` field to track blocked, in_progress, or completed. Business team and Dev team both comment on the item.

**Flow:**
- Item logged → FibreFlow responsible assigned → Dev status set to "in_progress" → Comments added: "Waiting for DB schema approval" → Status updated → "Ready for testing" → Completed

---

### 3. Accountability & Escalation
An item is overdue (completion_eta passed, status still pending). Executive dashboard highlights it in red. Responsible person is prompted to update status or add blocker comment. If no update in 2 days, escalate to director.

**Flow:**
- Item becomes overdue → Visible in Overdue column → Red ETA badge → Responsible person comments on blocker → Status updated or escalation triggered

---

### 4. Meeting Context & Decisions
When reviewing an old Manco action item, open detail pane and view related Manco meeting title, date, transcript excerpts mentioning the action, and the meeting summary. Provides full context for decision-making.

**Flow:**
- Click item → Detail pane opens → View meeting context panel → Read transcript excerpt → Understand decision rationale → Update status

---

## Access Control

### Required Roles

| Feature | Required Role(s) | Notes |
|---------|----------|-------|
| **View Manco Kanban** | Manager, Executive, Admin | Restricted to leadership view |
| **Create Manco Item** | Executive, Admin | Only Manco members can log strategic items |
| **Update Status** | Executive, Manager, Admin | Leadership can move items; assigned person can update |
| **Add Comments** | Executive, Manager, Admin | Only leadership participates in strategic discussion |
| **View Meeting Context** | Manager, Executive, Admin | Strategic context restricted |
| **Delete Item** | Admin only | Requires audit trail |

### Implementation

All Manco endpoints use `withAuth` middleware and check `req.user.roles`:

```typescript
export default withAuth(handler);
// handler validates req.user roles match required permissions
```

---

## Integration Points

### Upstream (Sources)
- **Manco Meetings** — Executive strategy sessions where action items are logged
- **FibreFlow Dev Queue** — Items with `fibreflow_dev=true` link to development work

### Downstream (Consumers)
- **Executive Dashboard** — Show Manco kanban as widget
- **Notifications** — Alert responsible person when item created or overdue
- **Reporting** — Aggregate completion metrics by department for board reports

### Cross-Module References
- **meetings** table → `source_meeting_id` references Manco meeting record
- **users** table → `fibreflow_responsible`, `author_user_id` for user linking
- **action_items** table → Manco items are separate table but same conceptual family

---

## Status

**Current Version:** 1.0.0  
**Release Date:** 2026-03-29  
**Production Status:** ✅ Active  

**Features Shipped (v1.0.0):**
- ✅ Kanban board with 4 columns (Pending, In Progress, Completed, Overdue)
- ✅ Department & module tracking
- ✅ FibreFlow dev linkage
- ✅ Meeting context panel
- ✅ Comment threads for strategic discussion
- ✅ Advanced filtering (status, department, person, search)
- ✅ ETA tracking with overdue detection
- ✅ Full API suite (CRUD, stats, comments, meeting context)

**Known Limitations:**
- Drag-and-drop kanban reordering not yet implemented
- Meeting context requires source_meeting_id; some items may lack historical linkage
- Bulk edit (reassign multiple items) not yet supported

**Last Updated:** 2026-03-30
