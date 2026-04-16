# Dynamic Ticket Project Dropdowns & Auto-Team Assignment

**Date:** 2026-04-16  
**Status:** Approved  
**Scope:** Activate (PP Data), OLT Report (Investigate), Non-Invoiceables ticket creation

---

## Problem

When creating NOC tickets from the Activate, OLT Investigate, and Non-Invoiceables tabs:
1. Project dropdowns are hardcoded (`["Lawley", "Mohadin", "Mamelodi"]`) — new projects never appear
2. Team assignment is always manual — no auto-assignment based on which project the records belong to
3. Mixed-project bulk ticketing has no structured handling

---

## Goals

1. Project dropdowns fetch live from the database — always reflect actual active projects
2. When creating tickets, auto-assign the configured activations team for each project
3. Mixed-project bulk ticket creation groups records by project and creates separate batches, each auto-assigned to the right team
4. Admins configure project-team assignments in NOC → Teams (inline)

---

## Data Model

### New table: `project_team_assignments`

```sql
CREATE TABLE project_team_assignments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  team_id     UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  role        TEXT NOT NULL DEFAULT 'activations',
  -- roles: 'activations', 'maintenance', 'fault_repair', 'other'
  created_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE(project_id, team_id, role)
);
```

- No changes to existing `teams` or `projects` tables
- A team can serve multiple projects with different roles
- A project can have multiple teams (one per role)
- For auto-assignment, only `role = 'activations'` is used

---

## Admin UI: NOC → Teams

The existing Teams list gets a new **"Projects"** column showing each team's project-role assignments.

### Teams list view (updated)

| Team | Type | Members | Projects | Actions |
|------|------|---------|----------|---------|
| Lawley Activations | Internal | 4 | Lawley (activations) | Edit |
| Lawley Maintenance | Internal | 2 | Lawley (maintenance) | Edit |
| Tembisa Activations | Internal | 3 | Tembisa (activations) | Edit |
| DevOps | Internal | 2 | — | Edit |

### Inline edit (clicking Projects cell or Edit button)

Opens a small popover/inline editor:
- Add: project dropdown + role dropdown → **Add** button
- List of existing assignments with a **Remove** button each
- Available roles: `activations`, `maintenance`, `fault_repair`, `other`

---

## Dynamic Project Dropdowns

Replace all hardcoded project arrays with live DB queries:

| Context | Source query |
|---------|-------------|
| PP Data filter | `SELECT DISTINCT project FROM oes_pp_data ORDER BY project` |
| Non-invoiceables filter | Equivalent query from non-invoiceables table |
| Investigate (OLT) | Project comes from DR's project field |

- "All Projects" remains the default
- Fetched once on page load, cached for the session

---

## Ticket Creation Workflow

### Single-project batch (all selected records from same project)

1. Modal opens with TeamSelector pre-filled with the `activations` team for that project
2. User can override the team if needed
3. Create tickets as normal

### Mixed-project batch (records from multiple projects)

1. System groups selected records by project automatically
2. For each group, resolves the activations team from `project_team_assignments`
3. User sees a confirmation summary before creating:

   > **3 batches will be created:**
   > - Lawley — 12 tickets → Lawley Activations
   > - Mohadin — 5 tickets → Mohadin Activations  
   > - Tembisa — 3 tickets → ⚠️ no activations team configured

4. User confirms → all batches created in one action
5. If a project has no activations team configured, tickets are created with no team assigned (user is warned)

---

## API Changes

### New endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/noc/project-team-assignments` | GET | List all assignments (for admin UI) |
| `/api/noc/project-team-assignments` | POST | Add assignment (team + project + role) |
| `/api/noc/project-team-assignments/:id` | DELETE | Remove assignment |
| `/api/activate/projects` | GET | Distinct projects from `oes_pp_data` |
| `/api/non-invoiceables/projects` | GET | Distinct projects from non-invoiceables table |

### Modified endpoints

| Endpoint | Change |
|----------|--------|
| `GET /api/noc/teams?dropdown=true` | Include `project_assignments[]` in response |
| `POST /api/activate/pp-data-tickets` | Accept array of batches: `[{ pp_data_ids, project_id, assigned_team_id, ... }]` |
| `POST /api/system/olt-report/tickets` | Same batch array pattern |

**Auto-assignment resolution** is client-side: the modal loads `project_team_assignments` once and resolves team IDs without extra round-trips.

---

## Affected Files

| File | Change |
|------|--------|
| `src/modules/activate/components/PPDataFilters.tsx` | Replace hardcoded project array with live fetch |
| `src/modules/activate/components/CreatePPTicketsModal.tsx` | Add batch-per-project logic, pre-fill TeamSelector |
| `src/modules/data-sync/components/groups/olt/CreateOltTicketsModal.tsx` | Same batch logic |
| `src/modules/non-invoiceables/components/CreateTicketModal.tsx` | Dynamic projects, auto-team |
| `src/modules/noc/components/Teams/TeamsList.tsx` | Add Projects column + inline assignment editor |
| `pages/api/activate/pp-data-tickets.ts` | Accept batch array |
| `pages/api/system/olt-report/tickets.ts` | Accept batch array |
| `pages/api/noc/project-team-assignments.ts` | New file |
| `pages/api/activate/projects.ts` | New file |
| `pages/api/non-invoiceables/projects.ts` | New file |
| DB migration | Create `project_team_assignments` table |

---

## Out of Scope

- Changing team names or the teams data model
- Project management (creating/deleting projects)
- Any non-activation ticket types (fault repair etc. remain manual)
