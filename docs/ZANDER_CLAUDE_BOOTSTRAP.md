# Claude Code Bootstrap for Zander

> **Purpose**: Give this file to your Claude Code instance at the start of a session.
> It will orient Claude to the full VelocityFibre codebase and infrastructure.
>
> **Usage**: `cat docs/ZANDER_CLAUDE_BOOTSTRAP.md` or paste it into your first message.
>
> **Last updated**: 18 Feb 2026

---

## Who You Are

You are assisting **Zander**, a developer at VelocityFibre. Zander has full deploy access
to all environments (SSH + sudo). Hein is the lead developer and architect.

## Project: FibreFlow

A fiber network project management application used by VelocityFibre to manage
fiber optic installation projects across South Africa.

- **Repo**: `git@github.com:VelocityFibre/FF_Next.js.git`
- **Framework**: Next.js 14+ (App Router for pages, Pages Router for API routes)
- **Language**: TypeScript (strict, 100% type coverage)
- **Database**: Neon PostgreSQL (serverless, direct SQL — no ORM)
- **Storage**: Firebase Storage
- **Auth**: Custom PostgreSQL-based with role-based access control

## First Steps — Read These Files

Before doing anything, read these files in order:

```
1. CLAUDE.md                          # Project overview, rules, quick reference
2. .claude/modules/_index.yaml        # All 50+ modules and their categories
3. .claude/knowledge-base/architecture/system-overview.md    # System architecture
4. .claude/knowledge-base/architecture/deployment.md         # Deployment setup
5. docs/INFRASTRUCTURE.md             # Full infrastructure reference
```

Then for any specific module you're working on:
```
.claude/modules/<module-name>.md      # Module-specific documentation
src/modules/<module-name>/.claude.md  # In-module context (all 50 modules have this)
```

## Codebase Structure

```
src/
├── modules/           # 50+ feature modules (each has .claude.md context file)
│   ├── activate/      # DR photo review + VLM AI + QA Centre
│   ├── fleet/         # Vehicle fleet management
│   ├── maintenance/   # NOC ticketing, Kanban board
│   ├── meetings/      # Fireflies meeting sync
│   ├── procurement/   # BOQ, RFQ, PO workflows
│   ├── pipeline/      # Project pipeline & wayleaves
│   ├── staff/         # Employee management
│   ├── wa-monitor/    # WhatsApp DR monitoring
│   ├── qfield-sync/   # QFieldCloud GIS sync
│   └── ...            # 40+ more modules
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

app/                   # App Router pages (main UI)
├── (main)/            # Layout group for authenticated pages
│   ├── activate/      # Activation module pages
│   ├── maintenance/   # Maintenance/NOC pages
│   └── ...
└── sign-in/           # Auth pages

pages/
├── api/               # All API routes (Pages Router)
│   ├── activate/      # Activation APIs
│   ├── maintenance/   # Maintenance APIs
│   ├── wa-monitor-*.ts  # WhatsApp monitor endpoints
│   └── ...

.claude/
├── modules/           # 50 module documentation files
├── knowledge-base/    # Deep reference material (architecture, patterns, fixes)
├── commands/          # Slash command definitions (/deploy, /pr, /sync, etc.)
├── skills/            # Workflow skills and procedures
├── agents/            # Custom agent definitions
└── hooks/             # Automation hooks

scripts/
├── ingest-qdrant.py   # KB vector DB ingestion (run on Velocity)
├── qfield-sync/       # QField sync Python service
└── daily-audit/       # Automated daily health audit
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
10. **Neon returns strings** — `COUNT(*)`, `SUM()` etc. return strings. Always `Number()` before arithmetic

---

## Server Infrastructure

### Velocity Server (100.96.203.105)

Main server hosting all FibreFlow environments and support services.
**Specs**: RTX 5090 GPU, 128GB RAM, Ubuntu Server. Accessed via Tailscale VPN.

#### FibreFlow Application Instances

| Service | Port | Systemd Unit | Directory |
|---------|------|--------------|-----------|
| **Production** | 3000 | `fibreflow-production.service` | `/home/velo/fibreflow-production` |
| **Staging** | 3006 | `fibreflow.service` | `/home/velo/fibreflow-staging` |
| **Dev** | 3005 | `fibreflow-dev.service` | `/home/velo/fibreflow-dev` |

#### Support Services (systemd)

| Service | Port | Systemd Unit | Purpose |
|---------|------|--------------|---------|
| VLM (Qwen3-VL) | 8100 | `vllm-qwen.service` | AI photo analysis for DR reviews |
| QField Sync | 8095 | `qfield-sync.service` | GIS webhook server (Python) |
| WA Feedback | 8092 | `wa-feedback.service` | WA message proxy → VPS bridge |
| Storage API | 8091 | `fibreflow-storage.service` | Fleet photo storage (`/srv/data/fibreflow-storage`) |
| PDFCraft | 3007 | `pdfcraft.service` | PDF tools (vf.fibreflow.app/pdf-tools/) |
| Ollama | 11434 | `ollama.service` | LLM inference (localhost only) |
| OpenClaw QField | — | `openclaw-qfield.service` | AI agent for QField automation |

#### Docker Containers (Velocity)

| Container | Port | Purpose |
|-----------|------|---------|
| **QFieldCloud** | 8082 | Self-hosted mobile GIS (Django + 8 workers + MinIO + PostgreSQL) |
| **Qdrant** | 6333, 6334 | Vector database for FibreFlow KB search |
| **Grafana** | 3030 | Monitoring dashboards |
| **Prometheus** | 9091 | Metrics collection |
| **Uptime Kuma** | — | Service uptime monitoring |
| drop-number-api | 8090 | Drop number lookup API |
| dr-photo-api | 8003 | DR photo processing API |
| dr-qa-dashboard | 8084 | QA analytics dashboard |
| boss-cost-api | 8000 | BOSS cost estimation API |
| boss-cost-dashboard | 8080 | BOSS cost dashboard UI |
| Dokploy | 3010 | Container deployment platform |
| xyOps | 5522 | Server monitoring |

#### Cloudflare Tunnels (Velocity)

All public traffic routes through Cloudflare Tunnels (no exposed ports):

| Domain | Service | Tunnel |
|--------|---------|--------|
| app.fibreflow.app | nginx → localhost:3000 | `cloudflared-qfield.service` |
| vf.fibreflow.app | nginx → localhost:3006 | `cloudflared-qfield.service` |
| dev.fibreflow.app | nginx → localhost:3005 | `cloudflared-qfield.service` |
| qfield.fibreflow.app | localhost:8082 (direct) | `cloudflared-qfield.service` |
| mc.fibreflow.app | localhost:3847 | `cloudflared-qfield.service` |

Main tunnel config: `/home/velo/.cloudflared/config.yml`

---

### VPS Server (72.61.197.178)

WhatsApp services + FibreFlow backup instance.

| Service | Port | Systemd Unit | Purpose |
|---------|------|--------------|---------|
| **WA Bridge** | 8083 | `whatsapp-bridge.service` | WhatsApp ↔ FibreFlow (Go binary, phone: 063 841 2276) |
| **WA Command Bot** | 8086 | `wa-command-bot.service` | Admin bot for WA queries (Python) |
| **FibreFlow Backup** | 3005 | `fibreflow-backup.service` | Auto-synced failover instance |

#### WhatsApp Architecture (IMPORTANT — Changed Feb 2026)

The WhatsApp bridge now handles **both inbound AND outbound** messages directly:

```
Technician sends DR photo via WhatsApp
  → WA Bridge (VPS:8083) receives via whatsmeow Go client
  → Bridge calls FibreFlow API (app.fibreflow.app/api/wa-monitor-*)
  → FibreFlow processes DR + triggers VLM analysis
  → FibreFlow calls bridge /send-message endpoint for ACK
  → Bridge sends ACK directly via its own WhatsApp client (direct-send)
```

**The WA Sender service (port 8081) was REMOVED from VPS on 18 Feb 2026.**
The bridge's `SENDER_URL` is set to `http://localhost:1` (dummy) — it sends directly.
This eliminated WebSocket session conflicts that caused EOF errors every ~5 minutes.

**Bridge binary**: `/opt/whatsapp-bridge/whatsapp-bridge`
**Bridge log**: `/opt/whatsapp-bridge/bridge.log`
**Bridge source**: `/home/velo/whatsapp-bridge/` (Go, whatsmeow library)

#### VPS Backup Auto-Sync

Hourly cron (`/opt/fibreflow/auto-update.sh`) keeps backup in sync with master:
- Fetches from GitHub, if new commits → pull, build, restart
- Log: `/var/log/fibreflow-autoupdate.log`

---

### URLs

| Env | URL |
|-----|-----|
| Production | https://app.fibreflow.app |
| Staging | https://vf.fibreflow.app |
| Dev | https://dev.fibreflow.app |
| QFieldCloud | https://qfield.fibreflow.app |
| Mission Control | https://mc.fibreflow.app |

---

## SSH Access

```bash
# Zander's personal account (full sudo)
ssh zander@100.96.203.105
# Password: zander2026

# Shared admin account (deploy dirs live here)
ssh velo@100.96.203.105    # SSH key auth from Hein's workstation

# VPS (WhatsApp services)
ssh root@72.61.197.178     # Root access
```

---

## Deploy Commands

All 3 environments live under `/home/velo/`. Same pattern for all:

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

### One-liner Deploy (from local machine)
```bash
# Dev
ssh zander@100.96.203.105 "cd /home/velo/fibreflow-dev && git pull && npm run build && echo 'zander2026' | sudo -S systemctl restart fibreflow-dev.service"

# Staging
ssh zander@100.96.203.105 "cd /home/velo/fibreflow-staging && git pull && npm run build && echo 'zander2026' | sudo -S systemctl restart fibreflow.service"

# Production
ssh zander@100.96.203.105 "cd /home/velo/fibreflow-production && git pull && npm run build && echo 'zander2026' | sudo -S systemctl restart fibreflow-production.service"
```

### Verify All Servers Match
```bash
ssh zander@100.96.203.105 'for dir in /home/velo/fibreflow-dev /home/velo/fibreflow-staging /home/velo/fibreflow-production; do echo "$dir: $(cd $dir && git log --oneline -1)"; done'
```

---

## Database

Neon PostgreSQL (serverless, cloud-hosted). No local database to run.

| Environment | Branch | Endpoint |
|-------------|--------|----------|
| Production + Staging | `production` | `ep-dry-night-a9qyh4sj` |
| Development | `hein-dev` | `ep-aged-poetry-a9bbd8e9` |

**CRITICAL**: Production and Staging share the same database. Be careful with migrations.

Connection strings are in `.env.local` on each deployment directory.

### Neon Gotchas
- `COUNT(*)`, `SUM()`, etc. return **strings** — always `Number()` before arithmetic
- Cast in JOINs when needed: `project_id::UUID`
- **No conditional SQL fragments**: `${cond ? sql\`AND x\` : sql\`\`}` breaks Neon — use explicit query branches
- Transient timeouts show as error code 1033 — usually self-resolves

### Two Drop Tables — DO NOT CONFUSE

| Table | Source | API |
|-------|--------|-----|
| `drops` | SOW imports (fiber drops) | `/api/sow/drops` |
| `qa_photo_reviews` | WhatsApp QA photos | `/api/wa-monitor-*` |

---

## Health Check & Monitoring

### Automated Health Check
- **Script**: `/home/velo/scripts/fibreflow-health-check-v2.sh` (runs every 5 min via cron)
- Auto-restarts failed systemd services and Docker containers
- Logs recovery actions to `system_recovery_actions` DB table
- Sends WhatsApp alerts for critical production failures

### Manual Health Checks
```bash
# FibreFlow apps
curl -s https://app.fibreflow.app/api/health | jq .
curl -s https://vf.fibreflow.app/api/health | jq .
curl -s https://dev.fibreflow.app/api/health | jq .

# VLM
curl -s http://100.96.203.105:8100/health

# WA Bridge
curl -s http://72.61.197.178:8083/health

# WA Feedback proxy
curl -s http://100.96.203.105:8092/health
```

### Service Status
```bash
# Check all FibreFlow services on Velocity
ssh zander@100.96.203.105 "systemctl status fibreflow-production fibreflow fibreflow-dev vllm-qwen qfield-sync wa-feedback --no-pager"

# Check WA services on VPS
ssh root@72.61.197.178 "systemctl status whatsapp-bridge wa-command-bot --no-pager"

# View logs
ssh zander@100.96.203.105 "journalctl -u fibreflow-production.service -f"
ssh root@72.61.197.178 "tail -f /opt/whatsapp-bridge/bridge.log"
```

### Nginx Upstream Failover

All environments have automatic failover to VPS backup:
```
User → Cloudflare Tunnel → nginx → Primary (Velocity) or Backup (VPS:3005)
```
Triggers: connection error, timeout, HTTP 502/503/504. Failover time: ~0.3s.

---

## Troubleshooting Guide

### Common Issues

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| Site returns 502/503 | Service crashed | `sudo systemctl restart fibreflow-production.service` |
| "Build ID mismatch" error | Stale .next cache | `rm -rf .next && npm run build` |
| WA ACKs not sending | wa-feedback down or bridge down | Check both services |
| VLM returning errors | GPU memory full | `sudo systemctl restart vllm-qwen.service` |
| QFieldCloud 500 errors | Worker crashed | `docker restart qfieldcloud-worker_wrapper-1` |
| API returns strings not numbers | Neon type gotcha | Wrap with `Number()` |
| `git pull` fails on server | Unstaged changes | `git stash && git pull` |

### WhatsApp Troubleshooting

```bash
# Check bridge is running and receiving
ssh root@72.61.197.178 "tail -20 /opt/whatsapp-bridge/bridge.log"

# Check wa-feedback proxy on Velocity
ssh zander@100.96.203.105 "journalctl -u wa-feedback.service --since '1 hour ago' --no-pager | tail -20"

# Test sending a message via bridge
curl -s http://72.61.197.178:8083/send-message -X POST \
  -H "Content-Type: application/json" \
  -d '{"group_jid":"120363421664266245@g.us","message":"Test from CLI"}'
```

**WhatsApp Group JIDs (for testing):**

| Project | Group JID |
|---------|-----------|
| Velo Test | `120363421664266245@g.us` |
| Lawley | `120363418298130331@g.us` |
| Mohadin | `120363421532174586@g.us` |
| Mamelodi | `120363408849234743@g.us` |

### Docker Container Management

```bash
# List all containers
ssh zander@100.96.203.105 "docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'"

# Restart QFieldCloud
ssh zander@100.96.203.105 "cd /home/velo/qfieldcloud/source && docker-compose restart"

# View container logs
ssh zander@100.96.203.105 "docker logs --tail 50 qfieldcloud-app-1"
```

---

## Louis's Legacy Paths (IMPORTANT)

Louis was the previous developer. Some services still reference his home directory.
These paths work fine (files are still there), but be aware:

| Service | Path | Notes |
|---------|------|-------|
| `wa-feedback.service` | `/home/louis/wa-feedback-service/` | Node.js proxy, port 8092 |
| `whatsapp-sender.service` (Velocity) | `/home/louis/whatsapp-sender/` | **Legacy — not used by bridge anymore** |
| `cloudflared-tunnel.service` | `/home/louis/cloudflared` | Old tunnel binary (superseded by velo's tunnel) |

If these services need changes, the source code is at those paths on the Velocity server.
The `velo` user has read access to `/home/louis/`.

---

## Local Development

```bash
git clone https://github.com/VelocityFibre/FF_Next.js.git
cd FF_Next.js
npm install
cp .env.example .env.local   # Then fill in credentials from server
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
- **Deploy**: Push to master, then manually deploy to servers (or use `/deploy` skill)

## Key Knowledge Locations

| Need | Look Here |
|------|-----------|
| Module docs | `.claude/modules/<name>.md` (50 files) |
| In-module context | `src/modules/<name>/.claude.md` (50 files) |
| Architecture | `.claude/knowledge-base/architecture/` |
| Deploy procedures | `.claude/knowledge-base/architecture/deployment.md` |
| UI patterns | `.claude/knowledge-base/ui-patterns/` |
| WA Monitor | `.claude/modules/wa-monitor.md` + `.claude/knowledge-base/wa-monitor/` |
| Full infra docs | `docs/INFRASTRUCTURE.md` |
| Changelog | `docs/CHANGELOG.md` |

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

# PREFER service management:
sudo systemctl restart <service-name>
```

## Getting Help

- Read `.claude/modules/<module>.md` before working on any module
- Check `.claude/knowledge-base/` for deep dives on specific topics
- Ask Hein for architecture decisions and access issues
