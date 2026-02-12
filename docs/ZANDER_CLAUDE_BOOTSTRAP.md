# Claude Code Bootstrap for Zander

> **Purpose**: Give this file to your Claude Code instance at the start of a session.
> It will orient Claude to the full VelocityFibre codebase and infrastructure.
>
> **Usage**: `cat docs/ZANDER_CLAUDE_BOOTSTRAP.md` or paste it into your first message.

---

## Who You Are

You are assisting **Zander**, a new developer at VelocityFibre. Zander has full deploy access
to all environments. Hein is the lead developer and architect.

## Project: FibreFlow

A fiber network project management application used by VelocityFibre to manage
fiber optic installation projects across South Africa.

- **Repo**: `git@github.com:VelocityFibre/FF_Next.js.git`
- **Framework**: Next.js 14+ with Pages Router (NOT App Router)
- **Language**: TypeScript (strict, 100% type coverage)
- **Database**: Neon PostgreSQL (serverless, direct SQL — no ORM)
- **Storage**: Firebase Storage
- **Auth**: Custom PostgreSQL-based with role-based access control

## First Steps — Read These Files

Before doing anything, read these files in order. They contain everything you need:

```
1. CLAUDE.md                          # Project overview, rules, quick reference
2. .claude/modules/_index.yaml        # All 38+ modules and their categories
3. .claude/knowledge-base/architecture/system-overview.md    # System architecture
4. .claude/knowledge-base/architecture/deployment.md         # Deployment setup
```

Then for any specific module you're working on:
```
.claude/modules/<module-name>.md      # Module-specific documentation
```

## Codebase Structure

```
src/
├── modules/           # Feature modules (each has components, types, sometimes .claude.md)
│   ├── activate/      # DR photo review + VLM AI
│   ├── fleet/         # Vehicle fleet management
│   ├── meetings/      # Fireflies meeting sync
│   ├── procurement/   # BOQ, RFQ, PO workflows
│   ├── staff/         # Employee management
│   └── ...            # 30+ more modules
├── components/        # Shared UI components (AppLayout, StatCards, etc.)
├── services/          # API service layers
│   ├── core/          # NotificationService, etc.
│   └── fireflies/     # Meeting transcription
├── lib/               # Utilities
│   ├── db.ts          # Shared database pool (import pool from '@/lib/db')
│   ├── logger.ts      # Logger (import { log } from '@/lib/logger')
│   ├── apiResponse.ts # Standard API responses
│   └── neon.ts        # Neon SQL helper
└── types/             # Shared TypeScript types

pages/
├── api/               # All API routes (Next.js Pages Router)
│   ├── meetings.ts
│   ├── staff.ts
│   ├── wa-monitor-*.ts  # WhatsApp monitor endpoints
│   └── ...
└── *.tsx              # Page components

.claude/
├── modules/           # 45 module documentation files
├── knowledge-base/    # Deep reference material (architecture, patterns, fixes)
├── commands/          # Slash command definitions (/deploy, /pr, /sync, etc.)
├── skills/            # Workflow skills and procedures
├── agents/            # Custom agent definitions
└── hooks/             # Automation hooks
```

## Coding Standards — MANDATORY

These are enforced. Violations will be caught in review:

1. **No console.log** — Use `import { log } from '@/lib/logger'`
2. **No empty catch blocks** — Always log errors
3. **100% type coverage** — No `any` types
4. **Files < 300 lines** — Components < 200 lines
5. **API responses** — Always use `apiResponse.success()` / `apiResponse.error()` from `@/lib/apiResponse`
6. **Database** — Import `pool` from `@/lib/db`, not `new Pool()`. Use `sql` from `@/lib/neon` for tagged templates
7. **No conditional SQL fragments** — `${cond ? sql\`AND x\` : sql\`\`}` breaks Neon. Use explicit query branches
8. **Dynamic routes** — Use `[projectId]` not `[id]`. Flatten nested dynamic routes (they fail on Vercel)
9. **Dark theme** — All UI uses CSS variables: `var(--ff-bg-primary)`, `var(--ff-text-primary)`, etc. No hardcoded colors

## Server Infrastructure

### Velocity Server (100.96.203.105)
Main server hosting all FibreFlow environments and support services.

| Service | Port | Systemd Unit | Directory |
|---------|------|--------------|-----------|
| **Production** | 3000 | `fibreflow-production.service` | `/home/velo/fibreflow-production` |
| **Staging** | 3006 | `fibreflow.service` | `/home/velo/fibreflow-staging` |
| **Dev** | 3005 | `fibreflow-dev.service` | `/home/velo/fibreflow-dev` |
| VLM (Qwen3) | 8100 | `vlm.service` | AI photo analysis |
| QField Sync | 8095 | `qfield-sync.service` | GIS data sync |
| WA Proxy | 8092 | `wa-proxy.service` | WhatsApp routing |

### VPS Server (72.61.197.178)
WhatsApp services only.

| Service | Port | Purpose |
|---------|------|---------|
| WA Sender | 8081 | Outbound WhatsApp messages |
| WA Bridge | 8083 | Receives DR submissions |
| WA Bot | 8086 | Admin commands |

### URLs
| Env | URL |
|-----|-----|
| Production | https://app.fibreflow.app |
| Staging | https://vf.fibreflow.app |
| Dev | https://dev.fibreflow.app |

## SSH Access

```bash
# Zander's personal account (full sudo)
ssh zander@100.96.203.105
# Password: see /home/shared/docs/credentials/CREDENTIALS.md on the server

# Other accounts
ssh velo@100.96.203.105    # Shared admin, all 3 deploy dirs live here
ssh hein@100.96.203.105    # Hein's personal account
```

## Deploy Commands

All 3 environments live under `/home/velo/`. Same user, same pattern for all:

### Dev
```bash
ssh zander@100.96.203.105
cd /home/velo/fibreflow-dev && git pull && npm run build
echo 'zander2026' | sudo -S systemctl restart fibreflow-dev.service
```

### Staging
```bash
ssh zander@100.96.203.105
cd /home/velo/fibreflow-staging && git pull && npm run build
echo 'zander2026' | sudo -S systemctl restart fibreflow.service
```

### Production
```bash
ssh zander@100.96.203.105
cd /home/velo/fibreflow-production && git pull && npm run build
echo 'zander2026' | sudo -S systemctl restart fibreflow-production.service
```

### Verify All Servers Match
```bash
for dir in /home/velo/fibreflow-dev /home/velo/fibreflow-staging /home/velo/fibreflow-production; do
  echo "$dir: $(cd $dir && git log --oneline -1)"
done
```

## Database

Neon PostgreSQL (serverless, cloud-hosted). No local database to run.

| Environment | Branch | Endpoint |
|-------------|--------|----------|
| Production + Staging | `production` | `ep-dry-night-a9qyh4sj` |
| Development | `hein-dev` | `ep-aged-poetry-a9bbd8e9` |

**CRITICAL**: Production and Staging share the same database. Be careful with migrations.

Connection strings are in `/home/shared/docs/credentials/CREDENTIALS.md` on the server
and in `.env.local` on each deployment.

## Two Drop Tables — DO NOT CONFUSE

| Table | Source | API |
|-------|--------|-----|
| `drops` | SOW imports (fiber drops) | `/api/sow/drops` |
| `qa_photo_reviews` | WhatsApp QA photos | `/api/wa-monitor-*` |

## Local Development

```bash
git clone https://github.com/VelocityFibre/FF_Next.js.git
cd FF_Next.js
npm install
cp .env.example .env.local   # Then fill in credentials
PORT=3004 npm run dev         # Runs on localhost:3004
```

### Quality Checks
```bash
npm run lint                  # ESLint
npm run type-check            # TypeScript
npm test                      # Vitest
npm run build                 # Full production build
```

## Git Workflow

- **Branch**: `master` (single main branch)
- **Naming**: `feature/<name>`, `fix/<name>`, `refactor/<name>`
- **Commits**: Conventional commits (`feat(module):`, `fix(module):`, `docs:`, `chore:`)
- **Deploy**: Push to master, then manually deploy to servers

## Key Knowledge Locations

| Need | Look Here |
|------|-----------|
| Module docs | `.claude/modules/<name>.md` |
| Architecture | `.claude/knowledge-base/architecture/` |
| Deploy procedures | `.claude/knowledge-base/architecture/deployment.md` |
| UI patterns | `.claude/knowledge-base/ui-patterns/` |
| WA Monitor | `.claude/modules/wa-monitor.md` + `.claude/knowledge-base/wa-monitor/` |
| Server credentials | `/home/shared/docs/credentials/CREDENTIALS.md` (on server) |
| Full infra docs | `/home/shared/docs/` (on server) |

## Protocols (from Hein's PAI system)

- **NLNH** (No Lies, No Hallucinations): Say "I don't know" when uncertain. Use confidence levels.
- **DGTS** (Don't Game The System): No fake tests, no mocked implementations pretending to be real.
- **Zero Tolerance**: No console.log, no empty catch blocks, 100% types, <300 line files.

## Process Safety

**NEVER use broad process killing commands:**
```bash
# FORBIDDEN:
pkill -f node       # Kills ALL node processes including Claude
pkill -f npm        # Kills ALL npm processes

# SAFE: Find specific PID first, then kill it
ps aux | grep "specific-script"
kill <specific-PID>
```

## Getting Help

- Read `.claude/modules/<module>.md` before working on any module
- Check `.claude/knowledge-base/` for deep dives on specific topics
- Server docs: `/home/shared/docs/` on 100.96.203.105
- Ask Hein for architecture decisions and access issues
