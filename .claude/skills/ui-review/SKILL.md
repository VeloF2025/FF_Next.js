---
name: ui-review
description: Run browser QA tests against FibreFlow user stories. Spawns browser-qa agents to validate UI workflows with screenshots. USE WHEN user says "ui review", "browser test", "smoke test the UI", "check if pages work", "validate the UI", or wants to verify browser functionality.
---

# /ui-review - Browser QA Orchestrator

Run automated browser QA tests against FibreFlow user stories.

## Usage

```
/ui-review                    # Run all critical stories against dev
/ui-review [story-name]       # Run specific story (e.g., "dashboard-load")
/ui-review --env local        # Run against localhost:3004
/ui-review --env production   # Run against app.fibreflow.app
/ui-review --all              # Run ALL stories (including medium priority)
```

## What This Does

1. **Loads user stories** from `.claude/user-stories/`
2. **Spawns browser-qa agents** to execute each story
3. **Collects results** with screenshots as evidence
4. **Reports summary** with pass/fail per story

## Execution Steps

### Step 1: Determine Scope and Environment

Parse the arguments:
- No args → run all **Critical** priority stories against **dev**
- Story name → run that specific story
- `--env local` → use `http://localhost:3004`
- `--env dev` → use `https://dev.fibreflow.app` (default)
- `--env production` → use `https://app.fibreflow.app`
- `--all` → include Medium priority stories too

### Step 2: List Available Stories

```bash
ls .claude/user-stories/*.md | grep -v README
```

Read each story to get its name and priority.

### Step 3: Execute Stories

For each story in scope, spawn a `browser-qa` agent using the Task tool:

```
Task tool:
  subagent_type: browser-qa
  prompt: "Validate the user story at .claude/user-stories/{story}.md against {environment_url}.
           The BASE_URL is {environment_url} — replace {BASE_URL} in the Auth section with this value.
           Execute the ## Auth section first (multi-step login: email → Continue → password → Sign In).
           Then execute every ## Steps step, take screenshots at each step, and report pass/fail results."
```

**Parallelization rules:**
- Run up to 2 stories in parallel (browser tabs)
- Critical stories run first
- If a story requires data modification (like staff-create), run it sequentially

### Step 4: Collect Results

After all agents complete, compile results:

```
╔══════════════════════════════════════════════════════════════╗
║                    UI REVIEW RESULTS                         ║
╠══════════════════════════════════════════════════════════════╣
║ Environment: dev (dev.fibreflow.app)                         ║
║ Stories Run: 7                                               ║
║ Date: 2026-03-11                                             ║
╠══════════════════════════════════════════════════════════════╣
║ RESULTS                                                      ║
║                                                              ║
║  PASS  dashboard-load          5/5 steps passed              ║
║  PASS  staff-list              6/6 steps passed              ║
║  PASS  projects-list           5/5 steps passed              ║
║  FAIL  procurement-overview    3/5 steps (RFQ tab timeout)   ║
║  PASS  navigation-sidebar      7/7 steps passed              ║
║  PASS  activate-overview       5/5 steps passed              ║
║  PASS  construction-qa-list    5/5 steps passed              ║
╠══════════════════════════════════════════════════════════════╣
║ SUMMARY: 6/7 PASSED | 1 FAILED                              ║
║                                                              ║
║ FAILURES:                                                    ║
║  procurement-overview step 4: RFQ tab did not load           ║
║    Console: TypeError: Cannot read property 'map' of null    ║
║    Screenshot: /tmp/qa-screenshots/procurement-step4.png     ║
╚══════════════════════════════════════════════════════════════╝
```

### Step 5: Report Failures

For any FAIL results:
- Show the specific step that failed
- Include console errors if any
- Reference screenshot paths
- Suggest likely root cause if obvious

## Story File Format

Stories live in `.claude/user-stories/{module}-{workflow}.md`:

```markdown
# Story Name

**URL**: /path
**Preconditions**: Fresh browser session (auth handled in Auth section below)
**Priority**: Critical | High | Medium
**Module**: module-name

## Auth

**Login flow** — run before story steps if not already authenticated (sidebar not visible):

1. Navigate to `{BASE_URL}/sign-in`
2. Fill the **Email** field (`id="username"`) with `hein@velocityfibre.co.za`
3. Press **Enter** or click **Continue**
4. Wait for the password field to appear (multi-step form)
5. Fill the **Password** field (`id="current-password"`) with `Mitzi@0203`
6. Click the **Sign In** button
7. Wait for redirect — confirm the sidebar navigation is visible

> Skip this section if already logged in (sidebar already visible on screen).

## Steps

1. **Step description**
   - Action: what to do
   - Expect: what should happen
```

## Available Stories

| Story | Module | Priority |
|-------|--------|----------|
| `dashboard-load` | Dashboard | Critical |
| `staff-list` | Staff | Critical |
| `projects-list` | Projects | Critical |
| `procurement-overview` | Procurement | Critical |
| `staff-create` | Staff | Critical |
| `activate-overview` | Activate | Critical |
| `navigation-sidebar` | Navigation | Critical |
| `construction-qa-list` | Construction QA | High |
| `fleet-checkin` | Fleet | Medium |
| `maintenance-tickets` | Maintenance | Medium |

## Adding New Stories

Create a new `.md` file in `.claude/user-stories/` following the format above.
Name it `{module}-{workflow}.md`.

## Notes

- Screenshots are saved to `/tmp/qa-screenshots/`
- Browser-qa agents use Chrome DevTools and Claude-in-Chrome MCP tools
- Stories that modify data (create, update, delete) should only run on dev
- The agent validates against what's actually on screen, not API responses
