# FibreFlow User Stories for Browser QA

User stories define UI workflows that the `browser-qa` agent validates.

## Format

Each `.md` file defines one testable workflow with:
- **URL**: Starting page
- **Preconditions**: What must be true before running
- **Steps**: Sequential actions with expected outcomes

## Running Stories

```
# Single story
Use the browser-qa agent to validate the "dashboard-load" user story against staging.

# All stories
Use the browser-qa agent to run all user stories against staging.
```

## Naming Convention

`{module}-{workflow}.md` — e.g., `staff-list.md`, `procurement-rfq-create.md`

## Priority Stories

| Story | Module | Critical? |
|-------|--------|-----------|
| `dashboard-load.md` | Dashboard | Yes |
| `staff-list.md` | Staff | Yes |
| `projects-list.md` | Projects | Yes |
| `procurement-overview.md` | Procurement | Yes |
| `staff-create.md` | Staff | Yes |
| `activate-overview.md` | Activate | Yes |
| `navigation-sidebar.md` | Navigation | Yes |
| `fleet-checkin.md` | Fleet | No |
| `maintenance-tickets.md` | Maintenance | No |
