# CLAUDE.md - AI Assistant Context Guide

## Project Overview
**FibreFlow Next.js** - A fiber network project management application
- **Framework**: Next.js 14+ with App Router
- **Auth**: PostgreSQL-based authentication (role-based)
- **Database**: Self-hosted Supabase Postgres (see Database Configuration)
- **Storage**: VF Storage (self-hosted on 100.96.203.105:8091, served via app.fibreflow.app/storage/)

## Essential Directory Structure
```
src/
├── modules/           # Modular features (see .claude/modules/ for docs)
├── components/        # Shared UI (AppLayout is standard)
├── services/          # API services
└── lib/              # Utilities

.claude/
├── modules/          # Module documentation (58 docs)
├── skills/           # Workflow skills (/pr, /deploy, etc.)
└── knowledge-base/   # Deep reference material
```

## Database Configuration

**Self-hosted Supabase — single DB shared by dev + production** (cutover 2026-04-18; Neon retired).

| Detail | Value |
|--------|-------|
| **Host** | `localhost:5437` on Velocity (Tailscale: `100.96.203.105:5437`) |
| **User / DB** | `fibreflow_user` / `fibreflow` |
| **Container** | `supabase-db` (Docker on Velocity) |

All environments share this database. Schema migrations affect everyone immediately. Connection strings in `.claude/credentials.local.md`.

**Tech debt:** `lib/db/pool.js` still imports `@neondatabase/serverless` (webpack-aliased via `src/lib/neon-shim.ts`). New code should use `pg.Pool` via `@/lib/db` or `@/lib/db-pool`. If a route 500s post-cutover, check for the Neon serverless import first.

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
npm run ci:quick                    # Local CI lint gates (before PRs)
npm run ci                          # Full CI: lint + tests + build
npm run lint && npm run type-check  # Manual quality checks
npm test                            # Vitest
npm run antihall                    # Validate code references
```

## Git Workflow (MANDATORY)

**ALL changes MUST go through a Pull Request.** No exceptions.

- **NEVER commit directly to master** — always create a feature/fix branch and open a PR
- **NEVER edit files in deploy directories** (`/home/velo/fibreflow-dev/`, `/home/velo/fibreflow-production/`) — these are deploy targets, not workspaces. All code changes happen in `/home/hein/Workspace/FF_Next.js/`
- **Branch naming**: `feature/<name>`, `fix/<name>`, `refactor/<name>`
- **Emergency hotfixes** still require a PR — use `ALLOW_MASTER_COMMIT=1` only if explicitly authorized by Hein

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
- **NO conditional SQL fragments via the Neon serverless shim** — `${cond ? sql`AND x` : sql``}` breaks `lib/db/pool.js` callers. Use explicit query branches. (`pg.Pool` callers are unaffected.)

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

Run `ls .claude/modules/` for the full list. See `.claude/modules/_index.yaml` for discovery.

## Deployment

| Env | URL | Port | Service |
|-----|-----|------|---------|
| Dev | dev.fibreflow.app | 3005 | `fibreflow-dev.service` |
| Production | app.fibreflow.app | 3000 | `fibreflow-production.service` |
| Local | localhost:3004 | 3004 | manual |

> Staging retired 2026-03-11. `vf.fibreflow.app` redirects to production.

**DEPLOYMENT RULES (MANDATORY):**

| Time Window | Dev | Production |
|-------------|-----|------------|
| **Business hours** (08:00-17:00 SAST, Mon-Fri) | Allowed | **BLOCKED** |
| **After hours** + weekends | Allowed | Promote from dev |
| **Emergency** (any time) | Allowed | `--force` required |

**Hein's approval is required for ALL production deployments.**

**Always use the deploy script** (stops service before build to prevent 500s):
```bash
bash scripts/deploy-local.sh dev         # Dev (always allowed)
bash scripts/deploy-local.sh production  # After hours only, with approval
```

Never do manual `git pull + build + restart` — causes 500s during the build.

**Deploy dirs** (owned by `velo`, use `sudo -u velo`):
- `/home/velo/fibreflow-dev/` → dev.fibreflow.app
- `/home/velo/fibreflow-production/` → app.fibreflow.app

**Full details:** `docs/INFRASTRUCTURE.md` | Credentials: `.claude/credentials.local.md`

## GitHub Workflow

**Branches:** `feature/<name>`, `fix/<name>`, `refactor/<name>`

**Slash Commands:** `/pr`, `/review <num>`, `/sync`, `/deploy`, `/audit`

## Protocols (PAI)

**Zero Tolerance:** No console.log, no empty catch, 100% types, <300 lines
**NLNH:** Say "I don't know", use confidence levels
**DGTS:** No fake tests, real implementations only

## Knowledge System

```
CLAUDE.md              → Essential quick reference (this file)
.claude/modules/       → Module-specific documentation (58 docs)
.claude/skills/        → Workflow skills and procedures (66 skills)
.claude/knowledge-base/→ Deep reference material
docs/                  → Full documentation
```
