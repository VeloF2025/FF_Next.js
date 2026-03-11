# Playwright QA Scripts

Browser-based QA testing for FibreFlow using Playwright CLI.

## Setup (One-Time)

```bash
# Install Playwright in temp directory (not in project deps)
mkdir -p /tmp/playwright-auth
cd /tmp/playwright-auth
npm init -y && npm install playwright

# Login and save auth state
FF_PASSWORD=your-password node scripts/playwright-qa/setup-auth.mjs dev
```

## Usage

### Quick Screenshot
```bash
node scripts/playwright-qa/qa-screenshot.mjs https://dev.fibreflow.app/dashboard /tmp/qa-screenshots/dash.png
node scripts/playwright-qa/qa-screenshot.mjs https://dev.fibreflow.app/staff /tmp/qa-screenshots/staff.png --full-page
```

### Run User Stories
Use the `/ui-review` slash command or invoke the `browser-qa` agent directly:
```
/ui-review                      # All critical stories on dev
/ui-review dashboard-load       # Specific story
/ui-review --env local          # Against localhost
```

## Auth State

- Saved to `/tmp/playwright-auth/auth.json`
- Created by `setup-auth.mjs` via real login flow
- Valid for 24h-30d depending on server session config
- Re-run `setup-auth.mjs` when auth expires

## Environments

| Name | URL |
|------|-----|
| dev | https://dev.fibreflow.app |
| production | https://app.fibreflow.app |
| local | http://localhost:3004 |

## Architecture

Following IndyDevDan's 4-layer browser automation approach:
- **Layer 1 (Skills)**: These Playwright CLI scripts — headless, parallel, token-efficient
- **Layer 2 (Subagents)**: `browser-qa` agent in `.claude/agents/browser-qa.md`
- **Layer 3 (Slash Commands)**: `/ui-review` skill in `.claude/skills/ui-review/`
- **Layer 4 (User Stories)**: Story files in `.claude/user-stories/`
