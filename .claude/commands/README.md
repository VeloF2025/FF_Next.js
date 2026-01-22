# Claude Code Commands

Custom slash commands for FibreFlow development.

## Available Commands

### /infra - Infrastructure Management
```bash
/infra                    # Status of all environments
/infra [env]              # Status of specific env (dev|staging|prod)
/infra fix [env]          # Auto-fix common issues
/infra 502 [env]          # Fix 502 errors
/infra restart [env]      # Restart all services
/infra deploy [env]       # Deploy to environment
/infra logs [env]         # View service logs
/infra tunnel             # Cloudflared diagnostics
```

Comprehensive infrastructure management for all FibreFlow environments.

---

### /deploy - Deploy to Staging
```bash
/deploy              # Deploy current branch
/deploy [branch]     # Deploy specific branch
/deploy status       # Check staging status
/deploy logs         # View service logs
```

Deploy FibreFlow to staging (vf.fibreflow.app).

---

### /pr - Create Pull Request
```bash
/pr                  # Create PR from current branch
```

Create a pull request with FibreFlow standards.

---

### /review - Review Pull Request
```bash
/review [pr-number]  # Review specific PR
```

Thorough code review with security and quality checks.

---

### /log - Add CHANGELOG Entry
```bash
/log [type] [title]
```

Quickly add an entry to `docs/CHANGELOG.md`.

**Examples:**
```
/log fix Contractor approval buttons
/log feature User dashboard
/log docs Updated tracking system
```

**Types**: feature, fix, enhancement, refactor, docs, infrastructure, performance, security

---

### /status - Show Project Status
```bash
/status
```

Display comprehensive status across all tracking systems.

---

### /sync - Daily Sync
```bash
/sync
```

Morning status check and sync routine.

---

### /kb - Knowledge Base Update
```bash
/kb              # Full scan and update
/kb status       # Show KB status only
/kb [module]     # Update specific module
```

Scan modules and update `.claude.md` context files.

---

### /tdd - Test-Driven Development
```bash
/tdd spec [name]     # Create test specification
/tdd validate        # Check TDD compliance
/tdd implement       # Full RED-GREEN-REFACTOR cycle
```

Enforce spec → test → code workflow.

---

### /e2e - E2E Production Test
```bash
/e2e
```

Run end-to-end tests against production.

---

### /oes - OES Import
```bash
/oes
```

Import OES activation data.

---

## How Commands Work

Commands are defined in `.claude/commands/[name].md` files. Each command file contains:

1. **Description** - What the command does
2. **Usage** - How to use it with examples
3. **Prompt** - Instructions for Claude on how to execute it

## Creating New Commands

1. Create `.claude/commands/[command-name].md`
2. Add usage documentation
3. Add detailed prompt for Claude
4. Test with `/command-name`

## Related

- **Skills**: `.claude/skills/` - Automated behaviors
- **Tracking System**: `docs/TRACKING_SYSTEM.md` - Complete guide
- **CHANGELOG**: `docs/CHANGELOG.md` - Daily work log
- **Page Logs**: `docs/page-logs/` - Per-page issue tracking
