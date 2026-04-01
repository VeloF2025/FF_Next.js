# CLAUDE.md - AI Assistant Context Guide

## Project Overview
**FibreFlow Next.js** - A fiber network project management application
- **Framework**: Next.js 14+ with App Router
- **Auth**: PostgreSQL-based authentication (role-based)
- **Database**: Neon PostgreSQL (direct SQL)
- **Storage**: VF Storage (self-hosted on 100.96.203.105:8091, served via vf.fibreflow.app/storage/)

## Essential Directory Structure
```
src/
├── modules/           # Modular features (see .claude/modules/ for docs)
├── components/        # Shared UI (AppLayout is standard)
├── services/          # API services
└── lib/              # Utilities

.claude/
├── modules/          # Module documentation (40+ docs)
├── skills/           # Workflow skills (/pr, /deploy, etc.)
└── knowledge-base/   # Deep reference material
```

## Database Configuration

**Single Production Database (all environments):**
| Detail | Value |
|--------|-------|
| **Provider** | Neon PostgreSQL |
| **Branch** | `production` |
| **Endpoint** | `ep-dry-night-a9qyh4sj` |

All environments (dev, production, local) share this database. Schema migrations affect everyone immediately.

**Connection String:** See `.claude/credentials.local.md` (gitignored, never committed)
```bash
# endpoint: ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech
```

**Two Drop Tables - DO NOT CONFUSE:**
- `drops` - SOW imports (`/api/sow/drops`)
- `qa_photo_reviews` - WhatsApp QA data (`/api/wa-monitor-*`)

## Starting the Server
```bash
PORT=3004 npm run dev    # Development (HMR, recommended)
npm run build && PORT=3005 npm start  # Production testing
```

## Key Commands
```bash
npm run lint && npm run type-check  # Quality checks
npm test                            # Vitest
npm run antihall                    # Validate code references
```

## Git Workflow (MANDATORY)

**ALL changes MUST go through a Pull Request.** No exceptions.

- **NEVER commit directly to master** — always create a feature/fix branch and open a PR
- **NEVER edit files in deploy directories** (`/home/velo/fibreflow-dev/`, `/home/velo/fibreflow-production/`) — these are deploy targets, not workspaces. All code changes happen in `/home/hein/Workspace/FF_Next.js/`
- **Branch naming**: `feature/<name>`, `fix/<name>`, `refactor/<name>`
- **Emergency hotfixes** still require a PR — use `ALLOW_MASTER_COMMIT=1` only if explicitly authorized by Hein
- After merging a PR, deploy to dev by pulling in the deploy directory — never by editing files there

## Development Guidelines

**API Response Standards:**
```typescript
import { apiResponse } from '@/lib/apiResponse';
return apiResponse.success(res, data);
return apiResponse.notFound(res, 'Resource', id);
```

**Coding Standards:**
- Files < 300 lines, components < 200 lines
- No `console.log` - use `log` from `@/lib/logger`
- 100% type coverage

**Critical Rules:**
- Wait for confirmation before showing success toasts
- Use consistent dynamic parameter names (`[projectId]` not `[id]`)
- Nested dynamic routes fail in Vercel - flatten them
- **NO conditional SQL fragments** - `${cond ? sql`AND x` : sql``}` breaks Neon - use explicit query branches

## Database Backup

| What | Command | Schedule |
|------|---------|----------|
| **Weekly pg_dump** | `bash scripts/db-backup.sh` | Sunday 02:00 SAST (cron on Velocity) |
| **Pre-migration snapshot** | `bash scripts/db-snapshot.sh <num> "desc"` | Before EVERY migration |
| **Backup verification** | `bash scripts/db-backup-verify.sh` | Monday 08:00 SAST (cron on Velocity) |

- **Backups:** `/home/velo/backups/neon/fibreflow-YYYY-MM-DD.sql.gz` (4 weekly rolling)
- **Neon PITR:** 30-day restore window (Scale plan)
- **Recovery runbook:** See `~/.openclaw/shared/kb/fibreflow/architecture/deployment.md` §17

## Module Documentation

Detailed module docs live in `.claude/modules/`. Key modules:

| Module | Doc | Quick Reference |
|--------|-----|-----------------|
| **Activate** | `.claude/modules/activate.md` | `/activate`, VLM on :8100, 5-phase QA wizard |
| **WA Monitor** | `.claude/modules/wa-monitor.md` | VPS 72.61.197.178, sender:8081, bridge:8083 |
| **QField Sync** | `.claude/modules/qfield-sync.md` | Webhook :8095, `/Qfield` skill |
| **VLM** | `.claude/modules/vlm.md` | Qwen3 on :8100, max 1024x768 images |
| **Fleet** | `.claude/modules/fleet.md` | Vehicle check-in, VLM plate reading |
| **Procurement** | `.claude/modules/procurement.md` | BOQ, RFQ, PO workflow |

Run `ls .claude/modules/` for full list (40+ modules).

## Deployment

**Two Environments (all share production DB):**

| Env | URL | Port | Service |
|-----|-----|------|---------|
| Dev | dev.fibreflow.app | 3005 | `fibreflow-dev.service` |
| Production | app.fibreflow.app | 3000 | `fibreflow-production.service` |
| Local | localhost:3004 | 3004 | manual |

> **Staging retired 2026-03-11.** `vf.fibreflow.app` redirects to production. Standalone services (wa-proxy, pdf-tools) still route through it.

**Server Access:**
```bash
# Local (we ARE on Velocity — use sudo -u velo for deploy dirs)
sudo -u velo bash -c 'whoami'     # No password needed (sudoers configured)
ssh root@72.61.197.178             # VPS (WhatsApp services)
```

**Deploy dirs under /home/velo/ (owned by velo, use `sudo -u velo`):**
```
/home/velo/fibreflow-dev/         # Dev (dev.fibreflow.app)
/home/velo/fibreflow-production/  # Production (app.fibreflow.app)
```

**DEPLOYMENT RULES (MANDATORY):**

| Time Window | Dev | Production |
|-------------|-----|------------|
| **Business hours** (08:00-17:00 SAST, Mon-Fri) | Allowed | **BLOCKED** |
| **After hours** + weekends | Allowed | Promote from dev |
| **Emergency** (any time) | Allowed | `--force` required |

**Hein's approval is required for ALL production deployments. Never deploy to production without explicit approval from Hein.**

**Workflow:**
1. During the day: deploy to **dev only** (`/deploy` or `/deploy dev`)
2. After hours (with Hein's approval): promote dev → production (`/deploy production`)
3. Emergency: `/deploy production --force` (requires Hein to confirm)

**Deploy Scripts:**
```bash
bash scripts/deploy-gate.sh dev              # Deploy to dev (always)
bash scripts/deploy-gate.sh production       # Blocked during business hours
bash scripts/promote.sh dev production       # Promote dev → production (after hours)
bash scripts/deploy-gate.sh status           # Show all environments
```

**ALWAYS use the deploy script (stops service before build to prevent 500s):**
```bash
# Dev (always allowed)
bash scripts/deploy-local.sh dev

# Production (after hours only)
bash scripts/deploy-local.sh production

# NEVER do manual git pull + build + restart — this causes 500 errors
# because the running service serves broken responses during the build.
```

**Maintenance page:** Nginx serves `/var/www/html/maintenance.html` on 502/503 during restarts (auto-refreshes every 8s).

**Sudoers:** `/etc/sudoers.d/fibreflow-deploy` — hein can run as velo (NOPASSWD) + restart services

**Full details:** `docs/INFRASTRUCTURE.md` | Credentials: `.claude/credentials.local.md`

## Services Quick Reference

| Service | Server | Port | Notes |
|---------|--------|------|-------|
| VLM (Qwen3) | Velocity | 8100 | See `.claude/modules/vlm.md` |
| WA Sender | VPS | 8081 | See `.claude/modules/wa-monitor.md` |
| WA Bridge | VPS | 8083 | Receives DR submissions |
| WA Feedback | Velocity | 8092 | Proxy to VPS sender |
| QField Sync | Velocity | 8095 | `/Qfield` skill |

## Browser Automation

**ALWAYS use `claude-in-chrome` (mcp__claude-in-chrome__*)**

```bash
claude --chrome  # Start with browser automation
```

1. `tabs_context_mcp` - Get tab context (REQUIRED FIRST)
2. `navigate` - Go to URL
3. `read_page` - Get accessibility tree
4. `computer` - Click, type, screenshot

## GitHub Workflow

**Branches:** `feature/<name>`, `fix/<name>`, `refactor/<name>`

**Slash Commands:**
| Command | Description |
|---------|-------------|
| `/pr` | Create PR |
| `/review <num>` | Review PR |
| `/sync` | Morning status |
| `/deploy` | Deploy skill |

## Protocols (PAI)

**Zero Tolerance:** No console.log, no empty catch, 100% types, <300 lines
**NLNH:** Say "I don't know", use confidence levels
**DGTS:** No fake tests, real implementations only

## Knowledge System

```
CLAUDE.md              → Essential quick reference (this file)
.claude/modules/       → Module-specific documentation
.claude/skills/        → Workflow skills and procedures
.claude/knowledge-base/→ Deep reference material
docs/                  → Full documentation
```

When in doubt, check `.claude/modules/_index.yaml` for module discovery.
