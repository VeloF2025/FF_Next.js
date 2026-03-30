# Action Items Module

**Status:** Production | **Version:** 1.3.0 | **Last Updated:** 2026-03-30

## Overview

The Action Items module is FibreFlow's centralized system for capturing, tracking, and managing follow-up items extracted from meetings and other operational sources. Action items represent immediate, time-sensitive tasks that arise during discussions—such as meeting follow-ups, procurement approvals, NOC alerts, HNS issues, QA findings, and project-level action items.

Unlike structured project tasks, action items are ad-hoc, often created from unstructured meeting transcripts (via [Fireflies.ai](https://fireflies.ai)), and require rapid tracking to ensure accountability and timely completion.

## Key Features

1. **Multi-Source Ingestion** — Automatically extract action items from Fireflies meeting transcripts; manually add items from procurement, NOC, HNS, QA, and project contexts
2. **Unified Dashboard** — Single view across all action items; filter by status, assignee, meeting, priority, and source
3. **Meeting Context Integration** — Each action item links to source meeting transcript, timestamp, and summary context
4. **Status Tracking** — Mark items as pending, in progress, completed, or cancelled with optional completion dates
5. **Priority Levels** — Four-tier priority system (low, medium, high, urgent) with visual badges
6. **User Linking** — Auto-link extracted action item names to FibreFlow users; maintain assignee contact info
7. **Manco Strategic Integration** — Dedicated kanban board for executive-level action items from Manco meetings with kanban columns (Pending → In Progress → Completed → Overdue) and department/module tracking
8. **Searchable Metadata** — Tags, notes, custom categories, source tracking, and full-text search across all action item fields

## Data Model

### ActionItem (Core Table: `action_items`)
| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Unique identifier |
| `meeting_id` | Integer | Reference to source meeting |
| `description` | String | Action item text (required) |
| `assignee_name` | String | Person responsible (extracted or entered) |
| `assignee_email` | String | Assignee email address |
| `assigned_to_user_id` | UUID | Linked FibreFlow user ID (migration 256) |
| `status` | Enum: pending \| in_progress \| completed \| cancelled | Current state (required) |
| `priority` | Enum: low \| medium \| high \| urgent | Urgency level |
| `source_type` | Enum: meeting \| procurement \| noc \| hns \| qa \| project \| manual | Origin context |
| `source_id` | String | Reference ID in source system |
| `project_id` | UUID | Linked project (optional) |
| `category` | String | Custom category or grouping |
| `due_date` | Date | Target completion date |
| `completed_date` | Date | Actual completion date |
| `mentioned_at` | String | Timestamp in meeting (e.g., "16:17") |
| `tags` | String[] | Searchable labels/tags |
| `notes` | String | Additional context or remarks |
| `created_at` | Timestamp | Record creation time |
| `updated_at` | Timestamp | Last modification time |
| `created_by` | UUID | User who created the item |
| `completed_by` | UUID | User who marked as completed |

### MancoActionItem (Manco Meeting Context Table: `manco_action_items`)
| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Unique identifier |
| `action_item` | String | Item description (required) |
| `department` | String | Responsible department (e.g., Finance, Tech, Operations) |
| `logged_date` | Date | When the action was logged |
| `completion_eta` | Date | Expected completion date (target) |
| `completion_date` | Date | Actual completion date |
| `responsible_person` | String | Primary responsible party |
| `fibreflow_dev` | Boolean | Is this a development task? |
| `fibreflow_module` | String | FibreFlow module affected (e.g., procurement, assets, communications) |
| `fibreflow_link` | String | Direct URL link to FibreFlow module page |
| `fibreflow_responsible` | String | FibreFlow team member responsible |
| `fibreflow_priority` | String | Dev priority (low, medium, high, urgent) |
| `fibreflow_dev_status` | String | Dev status tracking (pending, in_progress, blocked, completed) |
| `comment` | String | Latest status comment or blockers |
| `status` | Enum: pending \| in_progress \| completed \| cancelled | Kanban status |
| `is_ongoing` | Boolean | Recurring or ongoing item? |
| `source_meeting_id` | Integer | Reference to Manco meeting record |
| `created_at` | Timestamp | Record creation time |
| `updated_at` | Timestamp | Last modification time |

### MancoActionItemComment (Comment Thread Table: `manco_action_item_comments`)
| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Unique comment ID |
| `manco_action_item_id` | UUID | Reference to parent action item |
| `author_name` | String | Commenter name |
| `author_user_id` | UUID | Linked FibreFlow user ID |
| `content` | String | Comment text |
| `created_at` | Timestamp | Comment creation time |

## Components

### ActionItemsDashboard
**Location:** `/src/modules/action-items/ActionItemsDashboard.tsx`

Main dashboard landing page displaying:
- Summary stats cards (total, pending, overdue, completed counts)
- 8 navigation cards for quick access to filtered views and sections
- Real-time stats fetched from `/api/action-items/stats`
- Includes link to Manco Strategic dashboard

**Props:** None (page component)

**Key Methods:**
- `useRouter()` — Navigate to filtered views
- `actionItemsService.getStats()` — Fetch summary stats

---

### ActionItemsList
**Location:** `/src/modules/action-items/components/ActionItemsList.tsx`

Reusable list component for displaying action items with rich metadata.

**Features:**
- Checkbox toggle to mark items complete/incomplete
- Status icons (completed, in progress, pending, cancelled)
- Priority badges with color coding
- Assignee, meeting title, and due date display
- Tags and notes expansion
- Source badge (procurement, noc, hns, qa, project)
- Link to meeting transcript
- WCAG AA compliant (focus indicators, aria-labels, disabled states)

**Props:**
```typescript
interface ActionItemsListProps {
  items: ActionItem[];
  onItemUpdated?: () => void;
}
```

**Key Methods:**
- `handleToggleComplete(item)` — Call `actionItemsService.updateStatus(id, newStatus)`
- `getStatusIcon(status)` — Return appropriate Lucide icon
- `getPriorityBadge(priority)` — Render priority color badge

---

### MancoKanbanView
**Location:** `/src/modules/action-items/components/MancoKanbanView.tsx`

Kanban board component for visualizing Manco strategic action items across workflow states.

**Columns:**
1. **Pending** — New action items logged
2. **In Progress** — Currently being worked on
3. **Completed** — Finished items
4. **Overdue** — Items past completion_eta (auto-filtered)

**Features:**
- Drag-and-drop support (future enhancement)
- Column counts with colored badges
- Card summaries with department, module, responsible person, and ETA
- Color-coded ETA indicators (red=overdue, yellow=≤7 days, grey=on track)
- Click to open detail pane

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

Slide-out detail panel for viewing and editing a single Manco action item.

**Features:**
- Full item details (description, department, responsible person, ETA)
- Status dropdown selector (pending → in_progress → completed → cancelled)
- Comment thread (fetch via `/api/manco-action-items/comments`)
- Meeting context panel (fetch via `/api/manco-action-items/meeting-context`)
  - Related Manco meeting title and date
  - Transcript excerpts around the action item mention
  - Meeting summary with decisions and action items
- Real-time updates on status change
- Current user auto-assigned as comment author

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

### SourceBadge
**Location:** `/src/modules/action-items/components/SourceBadge.tsx`

Small badge component indicating the action item's origin source.

**Supported Sources:**
- `meeting` — From Fireflies meeting transcript
- `procurement` — From PO approval workflow
- `noc` — Network Operations Center alert
- `hns` — Home Network Support ticket
- `qa` — Quality Assurance finding
- `project` — Project milestone task
- `manual` — Manually created

---

### Related Pages

- **MyActionItems** (`/src/modules/action-items/pages/MyActionItems.tsx`) — Items assigned to current user
- **PendingActionItems** (`/src/modules/action-items/pages/PendingActionItems.tsx`) — All pending items across system
- **CompletedActionItems** (`/src/modules/action-items/pages/CompletedActionItems.tsx`) — Historical completed items
- **OverdueActionItems** (`/src/modules/action-items/pages/OverdueActionItems.tsx`) — Items past due date
- **ActionItemsByMeeting** (`/src/modules/action-items/pages/ActionItemsByMeeting.tsx`) — Grouped by source meeting
- **ActionItemsByAssignee** (`/src/modules/action-items/pages/ActionItemsByAssignee.tsx`) — Grouped by assignee
- **ActionItemsSearch** (`/src/modules/action-items/pages/ActionItemsSearch.tsx`) — Advanced filtering & full-text search
- **MancoStrategicGrid** (`/src/modules/action-items/pages/MancoStrategicGrid.tsx`) — Executive kanban for Manco items

## Services/APIs

### Client Service: actionItemsService
**Location:** `/src/services/action-items/actionItemsService.ts`

Core service for action items API communication.

**Methods:**

| Method | Endpoint | Description |
|--------|----------|-------------|
| `getStats()` | `GET /api/action-items/stats` | Fetch summary counts (total, pending, overdue, completed) |
| `list(filters?)` | `GET /api/action-items` | List action items with optional filters |
| `getById(id)` | `GET /api/action-items/:id` | Fetch single action item |
| `create(input)` | `POST /api/action-items` | Create new action item |
| `updateStatus(id, status)` | `PATCH /api/action-items/:id` | Update item status |
| `update(id, input)` | `PATCH /api/action-items/:id` | Full item update |
| `delete(id)` | `DELETE /api/action-items/:id` | Delete action item |

---

### Server API: /api/action-items
**Location:** `/pages/api/action-items/`

REST endpoints for action item CRUD.

**GET /api/action-items** — List items
```
Query Parameters:
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled'
  assignee_name: string
  meeting_id: number
  priority: 'low' | 'medium' | 'high' | 'urgent'
  source_type: 'meeting' | 'procurement' | 'noc' | 'hns' | 'qa' | 'project' | 'manual'
  search: string (full-text search on description, tags, notes)
  overdue: boolean
  limit: number (default 100)
  offset: number (default 0)
Response: ActionItem[]
```

**POST /api/action-items** — Create item
```
Body: ActionItemCreateInput
Response: ActionItem (201 Created)
```

**GET /api/action-items/:id** — Fetch single item
```
Response: ActionItem
```

**PATCH /api/action-items/:id** — Update item
```
Body: ActionItemUpdateInput
Response: ActionItem
```

**DELETE /api/action-items/:id** — Delete item
```
Response: 204 No Content
```

---

### Server API: /api/manco-action-items
**Location:** `/pages/api/manco-action-items/`

Specialized endpoints for Manco strategic action items.

**GET /api/manco-action-items** — List Manco items
```
Query Parameters:
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled'
  department: string
  responsible_person: string
  search: string
Response: MancoActionItem[]
```

**POST /api/manco-action-items** — Create Manco item
```
Body: {
  action_item: string (required)
  department: string
  logged_date: date
  completion_eta: date
  responsible_person: string
  fibreflow_dev: boolean
  fibreflow_module: string
  fibreflow_responsible: string
  fibreflow_dev_status: string
  comment: string
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled'
}
Response: MancoActionItem (201 Created)
```

**GET /api/manco-action-items/stats** — Get summary stats
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
**PATCH /api/manco-action-items/:id** — Update item status/fields
**GET /api/manco-action-items/comments** — Fetch comments for an item
**POST /api/manco-action-items/comments** — Add comment
**GET /api/manco-action-items/meeting-context** — Fetch related meeting context & transcripts

---

## Use Cases

### 1. Meeting Follow-Up Tracking
A manager records a meeting transcript via Fireflies.ai. FibreFlow automatically extracts action items and their assignees. Team members check their personal dashboard (**My Actions**) to see what's expected of them, with direct links to meeting transcripts for context.

**Flow:**
- Upload/sync meeting → Auto-extract action items → User sees in dashboard → Click to view transcript → Mark complete

---

### 2. Procurement Approval Workflow
Procurement module creates action items when a PO requires approval. These appear in the unified **Pending Actions** view with source badge "procurement" and priority marking.

**Flow:**
- PO approval needed → Create action item with source='procurement' → Assign to finance reviewer → Status: pending → Update to completed when signed off

---

### 3. Executive Strategy Tracking (Manco)
Strategic action items logged during Manco management meetings are tracked on a kanban board. Each item shows responsible department, FibreFlow dev linkage, and completion ETA. Executive team reviews the kanban weekly to identify blockers and reallocate resources.

**Flow:**
- Manco meeting → Log action item with department & ETA → Add to Pending column → Engineers move to In Progress → Add status comments → Mark Completed → Archival for reporting

---

### 4. NOC Alert Response
NOC system creates action items for critical network events. Assigned on-call engineer sees item in dashboard, updates status, and adds comments as they investigate.

**Flow:**
- Alert triggered → Create action item (source='noc') → Notify assigned user → Update status & notes → Link to resolved ticket

---

### 5. QA Finding Escalation
QA identifies a bug during testing. Create action item with priority='urgent' and assign to dev lead. Dev lead assigns to engineer, tracks to completion with due date.

**Flow:**
- Test failure → Create action item (source='qa', priority='urgent') → Dashboard highlight → Engineer resolves → Mark complete → Link to merged PR

---

### 6. Meeting-Based Actionability Review
Product manager reviews action items by meeting (**By Meeting** view). They see which meetings generated the most follow-up work and which assignees are overloaded.

**Flow:**
- View "By Meeting" → Click a meeting → See all its action items → Filter by status/priority → Reassign if needed

---

## Access Control

### Required Roles for Core Features

| Feature | Required Role(s) | Notes |
|---------|----------|-------|
| **View Dashboard** | Any authenticated user | All users can see the main dashboard |
| **View My Actions** | Assigned user | Users see only items assigned to them unless they have admin role |
| **View All Pending/Completed** | Department lead, manager, admin | Restrict broad views to authorized personnel |
| **Create Action Item** | Department lead, manager, admin | Prevent all users from creating items (ensure source control) |
| **Update Status** | Assigned user, manager, admin | Assigned user can mark their items done; managers can bulk update |
| **Delete Action Item** | Admin only | Deletion requires audit trail |
| **View Manco Kanban** | Manager, executive, admin | Restricted to leadership view |
| **Add Manco Comments** | Manager, executive, admin | Only leadership can comment on strategic items |

### Implementation

All API endpoints use `withAuth` middleware and role-based checks:
```typescript
export default withAuth(handler);
// handler checks req.user.roles for required permissions
```

---

## Integration Points

### Upstream (Sources of Action Items)
1. **Fireflies.ai** → Meeting transcripts → Extract action items (via webhook/sync)
2. **Procurement Module** → PO approval workflow → Create action items
3. **NOC System** → Alert monitoring → Post action items
4. **QA Module** → Test failures → Log findings as action items
5. **Projects Module** → Milestone tasks → Sync as action items
6. **Manco Meetings** → Strategic discussion → Manually log action items

### Downstream (Consumers)
1. **Dashboard** — Display pending items across all modules
2. **Notifications** — Alert assigned user when item created or updated
3. **Reporting** — Aggregate completion metrics by source, department, assignee
4. **Calendar Integration** — Sync due dates to user calendars (future)
5. **Slack Integration** — Post updates to relevant Slack channels (future)

### Module Cross-References
- **meetings** table — Source context and transcript links
- **users** table — User linking and assignee names
- **projects** table — Project-scoped action items
- **procurement** table — PO action items
- **manco_meetings** table — Manco strategic items

---

## Status

**Current Version:** 1.3.0  
**Release Date:** 2026-03-29  
**Production Status:** ✅ Active in Production  

**Recent Enhancements (v1.3.0):**
- ✅ Manco Strategic Action Items with Kanban board
- ✅ Meeting context panel (transcripts, decisions, summary)
- ✅ WCAG AA compliance fixes (theme tokens, ARIA patterns)
- ✅ User linking via migration 256
- ✅ Unified action items from all sources (meetings, procurement, NOC, HNS, QA, projects)

**Known Limitations:**
- Drag-and-drop kanban reordering not yet implemented
- Manco meeting context requires source_meeting_id linkage; some historical items may lack this
- Auto-extraction from Fireflies depends on meeting transcript sync status

**Last Updated:** 2026-03-30
