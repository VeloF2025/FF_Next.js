# Dev Queue Module

**Status:** Active (internal team feature)  
**Last Updated:** 2026-02-24  
**Complexity:** Medium-High  
**Lines of Code:** ~3,400  
**Recent Activity:** 3 commits (sporadic, feature-complete)  

---

## Overview

Dev Queue is an internal Kanban board for the FibreFlow team to collaboratively prioritize, vote on, and track development work. It integrates with GitHub (MVP repo) and Harness (CI/POC validation) to automate the pipeline from idea → approval → build → done.

**Purpose:** Replace ad-hoc task discussions with a structured, votable, tracked pipeline.

---

## Architecture

### Core Workflow

```
Backlog (ideas)
    ↓ [team votes]
Under Review (voting phase)
    ↓ [team approves]
Approved (ready to build)
    ↓ [MVP eligible → GitHub issue created]
POC Validation (Harness test run)
    ↓ [POC passes]
Building (active development)
    ↓
Done (merged)
```

### Key Concepts

**Status States (6 total):**
- **Backlog** — New ideas, not yet prioritized
- **Under Review** — Team voting phase (vote count visible)
- **Approved** — Consensus reached, ready for pipeline
- **POC Validation** — Running Harness POC test
- **Building** — Active development (PR open)
- **Done** — Merged and shipped

**Priority:** low, medium, high

**Effort Estimates (Fibonacci):** XS, S, M, L, XL

**Work Type:** feature, fix, amendment, refactor

**Business Value:** Optional numeric score (used in prioritization)

---

## Voting & Prioritization

### Voting System

Each item tracks:
- `votes` — total upvotes from team
- `has_voted` — whether current user voted
- Vote endpoint: `PATCH /api/dev-queue/:id/vote`

**Usage:** Team members vote on items in "Under Review" status. Items with majority votes automatically move to "Approved".

### Effort & Business Value Scoring

| Effort | XS | S | M | L | XL |
|--------|----|----|----|----|-----|
| Estimate | <1d | 1-2d | 2-4d | 4-7d | 7+ d |

**Impact scoring:** Effort vs. Business Value determines MVP eligibility and prioritization.

---

## MVP Pipeline

### Automation Trigger

When an item is **Approved** + **Effort = XS, S, or M**:

1. **GitHub Issue Created** — `VelocityFibre/mvp-builds` repo
2. **Spec Auto-Generated** — From dev-queue item fields:
   - Problem Statement
   - Acceptance Criteria
   - Target Module
   - Test Scenarios
3. **Build Status Tracked** — dev-queue item updates with:
   - `github_issue_url` — Link to issue
   - `build_status` — pending → building → complete/failed
   - `build_progress` — 0-100%
   - Build timestamps + error logs

### Service: `githubMvpSync.ts`

**Key Functions:**
- `isEligibleForMvp(effortEstimate)` — Check if XS/S/M
- `generateSpecTemplate(item)` — Build GitHub issue body
- `createGitHubIssue(item, githubToken)` — POST to GitHub API
- `syncBuildStatus(itemId, buildInfo)` — Update dev-queue with build status

**GitHub Integration:**
- Repo: `VelocityFibre/mvp-builds`
- API: GitHub REST API (Bearer token auth)
- Creates issues with detailed spec, vote count, creator info

---

## POC & Harness Integration

### 2-Stage Validation

After Approved, items can enter **POC Validation** stage:

1. **POC Run** — Harness executes smoke/validation tests
2. **Results** — Pass/fail, logged to item
3. **Transition** — POC pass → moves to Building

**Harness Service:** `harnessTrigger.ts`

- Triggers runs via Harness API
- Tracks run ID, status, logs
- Polls until completion
- Updates item with `poc_status` (pending | running | passed | failed)

---

## Database Schema (Kanban Structure)

### `dev_queue_columns` (WIP limits)
```sql
id, name, position, color, wip_limit
created_at, updated_at
-- E.g.: Backlog, Under Review, Approved, POC Validation, Building, Done
```

### `dev_queue_items`
```sql
id, title, description, status (from column)
priority (low|medium|high), effort_estimate (XS|S|M|L|XL)
work_type (feature|fix|amendment|refactor)
business_value (numeric)
votes (count), created_by, assigned_to
-- MVP pipeline fields
github_issue_url, build_status, build_progress
build_started_at, build_completed_at, build_error
-- POC fields
poc_status, poc_run_id, harness_run_id, pr_url
```

### `dev_queue_votes`
```sql
id, item_id, user_id, vote_date
```

### `dev_queue_comments`
```sql
id, item_id, user_id, comment, created_at
```

### `dev_queue_attachments`
```sql
id, item_id, type (image|url|file)
url, filename, file_size, mime_type
uploaded_by, created_at
```

---

## Components

| Component | Purpose |
|-----------|---------|
| **DevQueueDashboard** | Main page, tab router (board/pipeline/analytics/settings) |
| **DevQueueKanban** | Drag-drop Kanban board (hello-pangea/dnd library) |
| **DevQueueCard** | Single item card with priority, effort, votes, status |
| **DevQueueColumn** | Column in Kanban (renders cards, drag target) |
| **DevQueuePipeline** | Shows MVP build pipeline & Harness results |
| **DevQueueAnalytics** | Stats: total items, votes, by-priority breakdown, by-status breakdown |
| **DevQueueSettings** | Board configuration, column WIP limits, team members |
| **AddDevQueueItemModal** | Form to create new item |
| **AttachmentsModal** | Manage attachments (images, URLs, files) |

---

## Hooks

### `useDevQueue()`

Main state management hook for board operations.

**Returns:**
- `board` — columns + items + stats
- `loading`, `error` — state
- `refetch()` — refresh board from API
- `createItem(input)` — add new item
- `updateItem(id, input)` — edit item
- `moveItem(id, targetColumn, position)` — drag-drop reorder
- `voteItem(id)` — toggle vote
- `deleteItem(id)` — remove item

**State Sync:** Updates reflect in real-time on board; changes persisted to API.

---

## Common Workflows

### 1. Add a New Feature Idea

```
User clicks "+" → AddDevQueueItemModal
  ↓
Enters: title, description, problem_statement, acceptance_criteria, target_module, test_scenarios
  ↓
Selects: priority (medium), effort (M), work_type (feature)
  ↓
Submits → devQueueService.create(input)
  ↓
Item appears in Backlog
```

### 2. Vote & Approve

```
Team members open DevQueueDashboard → board tab
  ↓
See items in "Under Review" column
  ↓
Click vote button on items they support
  ↓
Once majority votes reached → move item to "Approved"
```

### 3. Trigger MVP Build

```
Item is Approved + Effort = S or M
  ↓
Dev queue detects eligibility
  ↓
githubMvpSync.createGitHubIssue(item)
  ↓
Issue created in VelocityFibre/mvp-builds
  ↓
item.github_issue_url populated
  ↓
DevQueuePipeline tab shows build progress
```

### 4. POC Validation

```
Item in "POC Validation" column
  ↓
harnessTrigger.triggerPocRun(item.harness_run_id)
  ↓
Harness executes tests
  ↓
Results: passed → move to "Building", failed → stay in POC or move back to Review
```

---

## Analytics Tab

Displays board-wide metrics:
- **Total Items** by status
- **Vote Distribution** (most/least voted items)
- **Priority Breakdown** (pie chart: low/medium/high)
- **Effort Distribution** (bar chart: XS → XL)
- **Velocity** (items completed per week)
- **Team Participation** (votes per member)

---

## Known Patterns

### 1. Kanban Board State (Drag-Drop Context)
Uses `@hello-pangea/dnd` for accessible drag-drop. Hydration fix applied — DragDropContext only rendered after client mount to avoid SSR mismatch.

### 2. WIP Limits
Each column can have a `wip_limit`. Enforced on frontend (warning badge if exceeded). Backend does not hard-block.

### 3. Attachment Storage
Attachments are references (URL-based). File uploads are stored externally; dev-queue stores metadata (filename, size, mime_type, uploaded_by).

### 4. GitHub Token Auth
MVP sync requires a GitHub personal access token (stored in env). Token must have repo access to `VelocityFibre/mvp-builds`.

---

## API Endpoints

```
GET    /api/dev-queue                   # Fetch board
GET    /api/dev-queue/:id               # Fetch item + comments
POST   /api/dev-queue                   # Create item
PATCH  /api/dev-queue/:id               # Update item
DELETE /api/dev-queue/:id               # Delete item
POST   /api/dev-queue/:id/move          # Move to column
PATCH  /api/dev-queue/:id/vote          # Toggle vote
POST   /api/dev-queue/:id/comments      # Add comment
GET    /api/dev-queue/:id/attachments   # List attachments
POST   /api/dev-queue/:id/attachments   # Upload attachment
DELETE /api/dev-queue/:id/attachments/:attachId  # Delete attachment
```

---

## Testing Notes

- Unit: Vote increment/decrement, effort eligibility check, MVP template generation
- Integration: Kanban move operations, GitHub issue creation (mock), Harness trigger (mock)
- E2E: Create item → vote → approve → GitHub issue → build pipeline

---

## Comparison to Other Systems

| Aspect | Dev Queue | FibreFlow Tasks | GitHub Issues |
|--------|-----------|-----------------|---------------|
| **Vote System** | ✅ Built-in | ❌ No | ❌ No |
| **GitHub Integration** | ✅ Auto-issue | ❌ No | ✅ Native |
| **POC Pipeline** | ✅ Harness | ❌ No | ❌ No |
| **Internal Use** | ✅ Team-only | ⚠️ Client-facing | ❌ Public repo |
| **Kanban UI** | ✅ Drag-drop | ✅ Kanban | ❌ No |

---

## Future Enhancements

- **Burndown Chart** — Track sprint velocity
- **Dependency Tracking** — Link blocked items
- **Time Tracking** — Log hours per item
- **Email Notifications** — Notify on vote/status change
- **Slack Integration** — Post approvals to Slack
- **Custom Fields** — Team-defined metadata

---

**Next Steps:** Monitor MVP sync accuracy, gather user feedback on voting UX, consider burndown metrics.

---
*Written by: Scribe | 2026-02-24 | Self-improvement heartbeat task (4:59 PM)*
