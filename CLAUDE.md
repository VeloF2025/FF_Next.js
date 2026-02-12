# CLAUDE.md - AI Assistant Context Guide

## Project Overview
**FibreFlow Next.js** - A fiber network project management application
- **Framework**: Next.js 14+ with App Router
- **Auth**: PostgreSQL-based authentication (role-based)
- **Database**: Neon PostgreSQL (direct SQL)
- **Storage**: Firebase Storage (files/images)

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

**Neon Branching Setup:**
| Environment | Branch | Endpoint |
|-------------|--------|----------|
| **Production** | `production` | `ep-dry-night-a9qyh4sj` |
| **Development** | `hein-dev` | `ep-aged-poetry-a9bbd8e9` |

**Connection Strings:** See `.claude/credentials.local.md` (gitignored, never committed)
```bash
# PRODUCTION - endpoint: ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech
# DEVELOPMENT - endpoint: ep-aged-poetry-a9bbd8e9.gwc.azure.neon.tech
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

**Five Environments (all share production DB):**

| Env | URL | Port | Service |
|-----|-----|------|---------|
| Production | app.fibreflow.app | 3000 | `fibreflow-production.service` |
| Staging | vf.fibreflow.app | 3006 | `fibreflow.service` |
| Dev | dev.fibreflow.app | 3005 | `fibreflow-dev.service` |
| VPS Backup | backup.fibreflow.app | 3005 | `fibreflow-backup.service` |
| Local | localhost:3004 | 3004 | manual |

**Server Access:**
```bash
ssh velo@100.96.203.105    # Velocity - SSH key auth (sudo/root, ALL deploys)
ssh zander@100.96.203.105  # Velocity - Password: zander2026 (sudo, full deploy access)
ssh root@72.61.197.178     # VPS (WhatsApp services)
```

**All deploy dirs under /home/velo/:**
```
/home/velo/fibreflow-dev/         # Dev (dev.fibreflow.app)
/home/velo/fibreflow-staging/     # Staging (vf.fibreflow.app)
/home/velo/fibreflow-production/  # Production (app.fibreflow.app)
```

**Deploy Commands (SSH key auth — no passwords needed):**
```bash
# Dev
ssh velo@100.96.203.105 "cd /home/velo/fibreflow-dev && git pull && npm run build && echo 'velo2026' | sudo -S systemctl restart fibreflow-dev.service"

# Staging
ssh velo@100.96.203.105 "cd /home/velo/fibreflow-staging && git pull && npm run build && echo 'velo2026' | sudo -S systemctl restart fibreflow.service"

# Production
ssh velo@100.96.203.105 "cd /home/velo/fibreflow-production && git pull && npm run build && echo 'velo2026' | sudo -S systemctl restart fibreflow-production.service"
```

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
