# Action Items Module — Changelog

All notable changes to the Action Items module are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/).

## [1.3.0] — 2026-03-29

### Added
- **Manco Strategic Action Items Feature** — Executive-level kanban board for action items logged during Manco management meetings
- **MancoKanbanView Component** — Four-column kanban (Pending → In Progress → Completed → Overdue) with department and module badges
- **MancoDetailPane Component** — Slide-out detail panel for viewing, updating status, and adding comments on strategic items
- **Meeting Context Panel** — Display related Manco meeting title, date, transcript excerpts, and meeting summary (decisions, action items) in detail pane
- **Manco API Endpoints** — Full CRUD support for `/api/manco-action-items`, `/api/manco-action-items/stats`, `/api/manco-action-items/comments`, `/api/manco-action-items/meeting-context`
- **MancoActionItem Type System** — New TypeScript types with full support for department, ETA, responsible person, FibreFlow dev linkage
- **Comment Thread System** — Add and view comments on Manco action items with user attribution and timestamps

### Changed
- **Dashboard Navigation** — Added "Manco Strategic" card to ActionItemsDashboard for quick access to executive kanban
- **Manco Grid Helpers Utility** — New helper functions for date formatting, overdue detection, and ETA countdown (`isOverdue`, `daysUntilEta`, `formatDate`, `truncateText`)
- **Design Tokens** — All Manco components migrated to CSS variable tokens (e.g., `var(--ff-warning)`, `var(--ff-info)`) for consistent theming

### Fixed
- **WCAG AA Compliance** — Theme token fixes and ARIA pattern corrections across ActionItemsList and related components
  - Fix: Status toggle button now includes `aria-label`, `aria-pressed`, and focus indicators
  - Fix: Priority badges use existing design system color tokens instead of hardcoded Tailwind classes
  - Fix: Transcript link includes `aria-label` and proper focus ring styling
- **Focus Management** — Added focus rings to interactive elements (buttons, links) for keyboard navigation
- **Component Refactoring** — Removed duplicate AppLayout wrapper in Manco detail pane

## [1.2.1] — 2026-03-15

### Fixed
- **WCAG AA + Theme Tokens** — Seven Pixel audit violations resolved in ActionItemsList component
  - Implemented CSS variable tokens for all color references
  - Fixed text contrast ratios for secondary text
  - Added focus indicators to all interactive elements
  - Proper disabled state styling for buttons
- **Comment API Response** — Fixed comments API to properly unwrap response data in MancoDetailPane

## [1.2.0] — 2026-03-10

### Added
- **Auto-User Linking** — Automatic linking of extracted action item assignee names to FibreFlow user database (migration 256)
  - Match extracted names against `users` table
  - Populate `assigned_to_user_id` field for better accountability
- **User Lookup in Lists** — Display user avatar and linked user name in action item lists when available

### Changed
- **ActionItem Type System** — Extended with user linking fields
  - New field: `assigned_to_user_id` (UUID)
  - New field: `source_type` enum (meeting, procurement, noc, hns, qa, project, manual)
  - New field: `source_id` (reference to source system)
  - New field: `project_id` (link to projects module)

## [1.1.0] — 2026-02-28

### Added
- **Procurement Module Integration** — Wire procurement PO approvals into unified action items system
  - Auto-create action items for POs requiring approval
  - Set source_type='procurement' for easy filtering
  - Link to procurement module for follow-up
- **Unified Action Items** — Single view across meeting-extracted items and module-generated items (procurement, NOC, etc.)

### Fixed
- **Status Toggle Performance** — Optimized checkbox toggle to avoid duplicate API calls
- **Timestamp Display** — Correct formatting of meeting mention timestamps (HH:MM format)

## [1.0.0] — 2026-02-14

### Added
- **Initial Release** — Action Items module launched
- **Core Components**
  - ActionItemsDashboard — Main landing page with stats and navigation
  - ActionItemsList — Reusable list component for displaying items with metadata
  - SourceBadge — Visual indicator of item source (meeting, procurement, NOC, HNS, QA, project, manual)
- **Action Item Data Model**
  - Database table: `action_items` (renamed from `meeting_action_items`)
  - Full CRUD API at `/api/action-items`
  - Support for status tracking (pending, in_progress, completed, cancelled)
  - Priority levels (low, medium, high, urgent)
- **Dashboard Views**
  - My Action Items — User's assigned items
  - Pending Action Items — All pending items across system
  - Completed Action Items — Historical view of completed items
  - Overdue Action Items — Items past due date (highlighted)
  - Action Items by Meeting — Grouped view of items by source meeting
  - Action Items by Assignee — Grouped view by responsible person
  - Search & Filter — Advanced filtering on multiple dimensions
- **Integration with Fireflies.ai**
  - Automatic extraction of action items from meeting transcripts
  - Parsing of assignee names and descriptions from meeting summaries
  - Link to meeting transcript for context
  - Timestamp capture for where action item was mentioned
- **User Assignee Tracking**
  - Capture assignee name and email from transcripts
  - Manual override capability for correction
  - Notification when assigned
- **Priority & Status Workflow**
  - Checkbox toggle to mark items complete/incomplete
  - Priority badges with color coding
  - Due date tracking with overdue highlighting
  - Status history tracking (created_by, completed_by timestamps)
- **Metadata & Searchability**
  - Support for tags, notes, and custom categories
  - Full-text search across description, tags, notes
  - Source tracking (meeting ID, transcript URL reference)
- **API Endpoints**
  - `GET /api/action-items` — List items with filters
  - `GET /api/action-items/:id` — Fetch single item
  - `POST /api/action-items` — Create item
  - `PATCH /api/action-items/:id` — Update item
  - `DELETE /api/action-items/:id` — Delete item
  - `GET /api/action-items/stats` — Summary counts
- **Theme & Design System Integration**
  - CSS variable tokens for colors
  - Responsive grid layout (mobile-first)
  - Shadow and border styling from design system

---

## Version History

| Version | Date | Status | Key Features |
|---------|------|--------|--------------|
| 1.3.0 | 2026-03-29 | Production | Manco Strategic Items, Kanban Board, Meeting Context |
| 1.2.1 | 2026-03-15 | Production | WCAG AA Compliance, Theme Token Fixes |
| 1.2.0 | 2026-03-10 | Production | Auto-User Linking, User Avatars |
| 1.1.0 | 2026-02-28 | Production | Procurement Integration, Unified Items |
| 1.0.0 | 2026-02-14 | Production | Initial Release |

---

## Planned (Backlog)

- [ ] Drag-and-drop kanban reordering for Manco items
- [ ] Calendar integration (sync due dates to user calendars)
- [ ] Slack notifications on item creation/updates
- [ ] Bulk edit capabilities (reassign multiple items at once)
- [ ] Custom workflows (approval gates for high-priority items)
- [ ] Reporting dashboard (completion metrics by source, department, assignee)
- [ ] Historical analytics (trend analysis of action item volume and resolution time)
- [ ] Export to CSV/PDF for reporting
- [ ] Mobile-friendly kanban for iOS/Android apps

---

**Last Updated:** 2026-03-30
