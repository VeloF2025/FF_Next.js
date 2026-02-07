# Claude Code Agent Teams

> Reference: https://code.claude.com/docs/en/agent-teams

## Overview

Agent teams coordinate multiple Claude Code instances working together. One session acts as team lead, spawning and coordinating teammates that each have their own context window and can communicate directly with each other.

**Enabled:** 2026-02-07
**Status:** Experimental (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS`)

## Configuration

**Settings:** `~/.claude/settings.json`
```json
{
  "env": { "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1" },
  "teammateMode": "auto"
}
```

**Quality Gate Hooks:**
- `~/.claude/hooks/teammate-idle-quality-gate.mjs` — Runs tests/lint/type-check before teammate goes idle
- `~/.claude/hooks/task-completed-verification.mjs` — Verifies deliverables before task marked complete

**Hook Exit Codes:**
- `0` — Allow (go idle / mark complete)
- `2` — Reject and send feedback (keep working / prevent completion)

## Model Selection (Opus-as-Orchestrator)

| Scenario | Lead | Teammates | Rationale |
|----------|------|-----------|-----------|
| Complex debugging | Opus | Sonnet | Superior synthesis |
| Multi-angle research | Opus | Sonnet | Quality synthesis crucial |
| Parallel code review | Opus | Sonnet + Haiku | Mixed complexity |
| Simple parallelization | Sonnet | Haiku | Cost-effective |

```bash
claude --model opus  # Always start teams with Opus as lead
```

## Agent Teams vs Subagents

| | Subagents | Agent Teams |
|---|-----------|------------|
| **Context** | Own window; results return to caller | Own window; fully independent |
| **Communication** | Report back to main agent only | Teammates message each other directly |
| **Coordination** | Main agent manages all work | Shared task list with self-coordination |
| **Best for** | Focused tasks where only result matters | Complex work requiring discussion |
| **Token cost** | Lower | Higher (5x+ minimum) |

## Display Modes

- `"auto"` — Split panes if in tmux, otherwise in-process (default)
- `"in-process"` — All teammates in main terminal
- `"tmux"` — Force split panes (requires tmux)

**tmux 3.4 is installed** on this system.

## Keyboard Shortcuts (In-Process Mode)

| Key | Action |
|-----|--------|
| `Shift+Up/Down` | Select teammate |
| `Enter` | View teammate session |
| `Escape` | Interrupt teammate |
| `Ctrl+T` | Toggle task list |
| `Shift+Tab` | Toggle delegate mode |

## Best Practices

### File Ownership (CRITICAL)
No file-level locking exists. Always assign explicit file ownership:
```
Create team with 3 teammates:
- Frontend: Owns src/components/**/*.tsx
- Backend: Owns pages/api/**/*.ts
- Tests: Owns __tests__/**/*.test.ts
```

### Task Sizing
- 5-6 tasks per teammate
- Self-contained units with clear deliverables
- Not too small (coordination overhead) or too large (long without check-ins)

### Delegate Mode
Press `Shift+Tab` if lead starts implementing instead of coordinating. Restricts lead to coordination-only tools.

### Plan Approval
For risky tasks, require teammates to plan before implementing:
```
Spawn an architect teammate to refactor the auth module.
Require plan approval before they make any changes.
```

## Example Prompts for FibreFlow

**Parallel Module Review:**
```
Create Opus-led team to review the OLT module:
- Security reviewer (Sonnet) - check data-sync for injection risks
- Performance analyst (Sonnet) - identify slow queries in conflict detection
- Test auditor (Haiku) - verify test coverage for edge cases
```

**Cross-Layer Feature:**
```
Add user preferences feature. Create team:
- Frontend (Sonnet): Settings UI in src/modules/settings/
- Backend (Sonnet): API endpoints in pages/api/settings/
- Database (Sonnet): Schema and migrations
- Tests (Haiku): Unit and integration tests
Coordinate on shared types.
```

**Competing Hypotheses Debug:**
```
Production API slow. Create team with 4 Sonnet teammates:
- Database: analyze Neon query performance
- Network: check connection pooling
- Cache: verify Firebase cache hits
- Server: check systemd service resources
Have them investigate and debate findings.
```

## Known Limitations

1. `/resume` and `/rewind` do NOT restore teammates — clean up team first
2. One team per session — clean up before starting new team
3. No nested teams — only lead can manage
4. Lead is fixed — can't promote teammates
5. Permissions set at spawn — all teammates inherit lead's mode
6. Task status can lag — teammates may fail to mark tasks complete

## Rollback

```bash
# Quick: disable agent teams
# Remove CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS from settings.json

# Full: restore backup
cp ~/.claude/.settings.backup.json ~/.claude/settings.json

# Disable hooks only (keep teams)
# Set hooks to empty arrays in settings.json
```
