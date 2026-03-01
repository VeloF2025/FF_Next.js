# FibreFlow Developer Handover Guide

> **For**: New developers / AI agents working on FibreFlow
> **Last Updated**: 28 February 2026
> **Authority**: This document is the single source of truth for development workflow

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Tech Stack](#2-tech-stack)
3. [Repository & Git Setup](#3-repository--git-setup)
4. [Directory Structure](#4-directory-structure)
5. [Local Development](#5-local-development)
6. [Coding Standards & Protocols](#6-coding-standards--protocols)
7. [Database Rules](#7-database-rules)
8. [API Development](#8-api-development)
9. [Git Workflow & Branching](#9-git-workflow--branching)
10. [Commit Standards](#10-commit-standards)
11. [Pull Request Process](#11-pull-request-process)
12. [Environments & Infrastructure](#12-environments--infrastructure)
13. [Deployment Workflow](#13-deployment-workflow)
14. [Server Access & Services](#14-server-access--services)
15. [Health Monitoring](#15-health-monitoring)
16. [Quality Protocols (PAI)](#16-quality-protocols-pai)
17. [Troubleshooting](#17-troubleshooting)
18. [Quick Reference Cheat Sheet](#18-quick-reference-cheat-sheet)

---

## 1. Project Overview

**FibreFlow** is a fiber network project management application used by VelocityFibre to manage FTTH (Fiber to the Home) construction projects. It handles:

- Project management & SOW (Scope of Work) imports
- Construction QA via WhatsApp photo submissions
- Procurement (BOQ, requisitions, POs, GRNs)
- Field data collection via QFieldCloud GIS
- Contractor management
- Fleet vehicle tracking
- Accounting (Sage integration)
- Reporting & analytics

**Users**: Project managers, field technicians, procurement officers, accountants, and admins at VelocityFibre.

---

## 2. Tech Stack

| Layer | Technology |
|-------|-----------|
| **Framework** | Next.js 14+ (Pages Router for API, mixed routing) |
| **Language** | TypeScript (strict, 100% type coverage required) |
| **Database** | Neon PostgreSQL (serverless, direct SQL — NO ORM) |
| **Auth** | PostgreSQL-based role authentication |
| **Storage** | Firebase Storage (files/images) + Velocity local storage |
| **UI** | React + Tailwind CSS + shadcn/ui components |
| **Testing** | Vitest (unit) + Playwright (E2E) |
| **Hosting** | Self-hosted on Velocity server (systemd services) |
| **Proxy** | Cloudflare Tunnel -> nginx -> Node.js |
| **VCS** | GitHub (VelocityFibre/FF_Next.js) |

---

## 3. Repository & Git Setup

### Repository

- **Primary**: `https://github.com/VelocityFibre/FF_Next.js.git` (origin)
- **Main branch**: `master`

### Clone & Setup

```bash
git clone https://github.com/VelocityFibre/FF_Next.js.git
cd FF_Next.js
npm install

# Copy environment file (get values from team lead)
cp .env.example .env.local

# Start development
PORT=3004 npm run dev
```

### Environment Variables Required

Your `.env.local` needs at minimum:
- `DATABASE_URL` — Neon PostgreSQL connection string
- `NEXTAUTH_SECRET` — Auth secret
- Firebase config vars for storage
- Any service-specific keys (see `.env.example`)

**NEVER commit `.env.local` or any credentials file.**

---

## 4. Directory Structure

```
FF_Next.js/
├── pages/                  # Next.js pages & API routes
│   ├── api/               # ALL API endpoints live here
│   │   ├── projects/      # /api/projects/*
│   │   ├── procurement/   # /api/procurement/*
│   │   ├── sage/          # /api/sage/*
│   │   └── ...
│   ├── projects/          # Project pages
│   ├── procurement/       # Procurement pages
│   └── ...
├── src/
│   ├── modules/           # Feature modules (self-contained)
│   │   ├── accounting/
│   │   ├── procurement/
│   │   ├── construction-qa/
│   │   └── ... (40+ modules)
│   ├── components/        # Shared UI components
│   │   ├── shared/        # Truly shared (buttons, modals)
│   │   └── [module]/      # Module-specific components
│   ├── services/          # Frontend API service wrappers
│   ├── lib/               # Utilities
│   │   ├── apiResponse.ts # Standard API response helper
│   │   ├── logger.ts      # Logger (replaces console.log)
│   │   ├── neon.ts        # Database connection
│   │   └── csv.ts         # CSV export utilities
│   └── types/             # Shared TypeScript types
├── scripts/
│   ├── migrations/        # SQL migration files
│   │   └── sql/           # Numbered .sql files (001_, 002_, ...)
│   └── ...
├── docs/                  # Documentation
├── .claude/               # AI assistant context & module docs
│   ├── modules/           # Per-module documentation
│   ├── skills/            # Workflow automation
│   └── knowledge-base/    # Deep reference material
└── public/                # Static assets
```

### Key Rules

- **API routes**: Always in `pages/api/` — this is where database access happens
- **Frontend code** (`src/`): NEVER imports database clients directly
- **Modules** (`src/modules/`): Self-contained feature code
- **Shared components**: Only in `src/components/shared/` if truly reusable

---

## 5. Local Development

### Starting the Dev Server

```bash
PORT=3004 npm run dev    # Development with HMR (recommended)
```

Access at `http://localhost:3004`

### Quality Checks (Run Before EVERY Commit)

```bash
npm run lint              # ESLint — 0 errors, 0 warnings required
npm run type-check        # TypeScript — 0 errors required
npm test                  # Vitest — all tests must pass
npm run build             # Full build — must succeed
```

### Production-like Testing

```bash
npm run build && PORT=3005 npm start
```

---

## 6. Coding Standards & Protocols

### File Size Limits — HARD RULES

| Type | Max Lines | Target |
|------|-----------|--------|
| **Any file** | 300 | 200-250 |
| **Components** | 200 | 150 |
| **Types files** | 100 | 50-80 |

No exceptions. If a file exceeds 300 lines, split it.

### TypeScript Requirements

- **100% type coverage** — no untyped variables, parameters, or returns
- **No `any` type** without explicit documented reason
- **snake_case** in database columns, **camelCase** in TypeScript
- Proper field mapping in adapters between DB and frontend

### Logging — Zero Tolerance

```typescript
// FORBIDDEN - Never use these:
console.log(...)
console.error(...)
console.warn(...)

// REQUIRED - Always use the logger:
import { log } from '@/lib/logger';

log.info('User logged in', { userId }, 'AuthModule');
log.error('Failed to fetch', { error: err.message }, 'ProjectService');
log.warn('Deprecated method called', { method }, 'API');
log.debug('Query result', { rows: data.length }, 'DB');
```

### Error Handling

```typescript
// FORBIDDEN:
try { ... } catch (e) { }           // Empty catch
try { ... } catch (e) { throw e; }  // Pointless re-throw

// REQUIRED:
try {
  const data = await fetchData();
  return apiResponse.success(res, data);
} catch (error) {
  log.error('Failed to fetch data', { error: (error as Error).message }, 'API');
  return apiResponse.internalError(res, error);
}
```

### Import Organization

```typescript
// 1. External packages
import { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';

// 2. Internal lib/utilities
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';

// 3. Types
import type { Project } from '@/types/project';

// 4. Components (in .tsx files)
import { Button } from '@/components/ui/button';
```

### Dynamic Routes — Critical Vercel Limitation

```
FORBIDDEN: pages/api/projects/[projectId]/stages/[stageId].ts  (nested dynamic)
REQUIRED:  pages/api/projects-stages.ts  (flattened, with query params)
```

Nested dynamic routes FAIL on Vercel. Always flatten them.

### SQL — Critical Neon Limitation

```typescript
// FORBIDDEN - Conditional SQL fragments break Neon:
const result = await sql`
  SELECT * FROM projects
  WHERE 1=1
  ${status ? sql`AND status = ${status}` : sql``}
`;

// REQUIRED - Use explicit query branches:
if (status) {
  result = await sql`SELECT * FROM projects WHERE status = ${status}`;
} else {
  result = await sql`SELECT * FROM projects`;
}
```

---

## 7. Database Rules

### Connection

- **Engine**: Neon PostgreSQL (serverless)
- **Client**: `@neondatabase/serverless` — direct SQL template literals
- **NO ORM**: No Drizzle, no Prisma, no Sequelize. Direct SQL only.

### Branching

| Environment | Neon Branch | Endpoint |
|-------------|------------|----------|
| Production / Staging / Dev | `production` | `ep-dry-night-a9qyh4sj` |
| Local Development (optional) | `hein-dev` | `ep-aged-poetry-a9bbd8e9` |

**All deployed environments share the production database.** Be extremely careful with any data-modifying operations.

### Migrations

SQL migration files live in `scripts/migrations/sql/` and are numbered sequentially:

```
001_initial_schema.sql
002_add_projects.sql
...
212_sage_full_invoice_import.sql
```

To create a new migration:
1. Create `scripts/migrations/sql/NNN_description.sql`
2. Test on the dev branch first if making schema changes
3. Apply to production: `npm run db:migrate`

### Architecture Rule

```
Browser → API Service (src/services/) → API Route (pages/api/) → Database (Neon)
```

Frontend code (`src/`) NEVER touches the database directly. All DB access goes through API routes.

### Database Backup

| What | Command | Schedule |
|------|---------|----------|
| **Weekly pg_dump** | `bash scripts/db-backup.sh` | Sunday 02:00 SAST (cron on Velocity) |
| **Pre-migration snapshot** | `bash scripts/db-snapshot.sh <num> "desc"` | Before EVERY migration |
| **Backup verification** | `bash scripts/db-backup-verify.sh` | Monday 08:00 SAST (cron on Velocity) |

- **Backups**: `/home/velo/backups/neon/fibreflow-YYYY-MM-DD.sql.gz` (4 weekly rolling)
- **Neon PITR**: 30-day point-in-time restore window (Scale plan)

**IMPORTANT**: Always run `bash scripts/db-snapshot.sh` before applying any migration to production.

---

## 8. API Development

### Standard Response Pattern

Every API route MUST use the `apiResponse` helper:

```typescript
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    try {
      const data = await sql`SELECT * FROM projects WHERE is_active = true`;
      return apiResponse.success(res, data);
    } catch (error) {
      log.error('Failed to fetch projects', { error: (error as Error).message }, 'ProjectsAPI');
      return apiResponse.internalError(res, error);
    }
  }

  return apiResponse.methodNotAllowed(res, req.method!, ['GET']);
}
```

### Response Formats

```json
// Success (200)
{ "success": true, "data": [...] }

// Created (201)
{ "success": true, "data": { "id": "..." } }

// Not Found (404)
{ "success": false, "error": { "code": "NOT_FOUND", "message": "Project not found" } }

// Validation Error (422)
{ "success": false, "error": { "code": "VALIDATION_ERROR", "message": "...", "details": { "field": "error" } } }
```

### CRITICAL: No Double-Wrapping

```typescript
// WRONG - causes { data: { success: true, data: { ... } } }
return apiResponse.success(res, { success: true, data: result });

// RIGHT - apiResponse.success() wraps it for you
return apiResponse.success(res, result);
```

---

## 9. Git Workflow & Branching

### Branch Naming Convention

```
feature/<descriptive-name>     # New features
fix/<descriptive-name>         # Bug fixes
refactor/<descriptive-name>    # Code improvements
docs/<descriptive-name>        # Documentation only
```

Examples:
- `feature/sage-customer-sync`
- `fix/procurement-export-crash`
- `refactor/accounting-module-split`

### Workflow

```
1. Create branch from master
   git checkout master
   git pull origin master
   git checkout -b feature/my-feature

2. Develop & commit (see commit standards below)

3. Push & create PR
   git push -u origin feature/my-feature
   # Create PR via GitHub or `gh pr create`

4. PR review & merge to master

5. Deploy (see deployment section)
```

### Branch Rules

- `master` is the main branch — all PRs target master
- Never force-push to master
- Never commit directly to master (always use PRs)
- Delete feature branches after merge

---

## 10. Commit Standards

### Format

```
type(scope): Brief description

- Detailed change 1
- Detailed change 2

[Module affected]
```

### Types

| Type | When to Use |
|------|------------|
| `feat` | New feature or functionality |
| `fix` | Bug fix |
| `refactor` | Code improvement (no behavior change) |
| `docs` | Documentation changes |
| `test` | Adding or updating tests |
| `style` | Formatting, whitespace (no code change) |
| `chore` | Build, deps, config changes |

### Examples

```
feat(procurement): add CSV export for purchase orders

- Added ExportCSVButton component
- New API route /api/procurement/purchase-orders-export
- Supports date range filtering

[procurement]
```

```
fix(accounting): journal entry reversal uses auth userId

- Replaced hardcoded 'system' with authenticated user ID
- Fixed audit trail for journal reversals

[accounting]
```

### Pre-commit Checklist

Before every commit, verify:

1. `npm run lint` — 0 errors
2. `npm run type-check` — 0 errors
3. `npm run build` — succeeds
4. No `console.log` statements
5. No `any` types
6. All files under 300 lines
7. No credentials or secrets in code

---

## 11. Pull Request Process

### Creating a PR

```bash
# Push your branch
git push -u origin feature/my-feature

# Create PR (using GitHub CLI)
gh pr create --title "feat(module): description" --body "## Summary
- Change 1
- Change 2

## Test Plan
- [ ] Tested locally
- [ ] Lint passes
- [ ] Type-check passes
- [ ] Build succeeds"
```

### PR Requirements

- Descriptive title following commit type convention
- Summary of changes in the body
- All quality checks pass
- No unrelated changes bundled in
- Screenshots for UI changes

### Review & Merge

- PRs are reviewed by the team lead (Hein)
- Merge to master via GitHub (squash or merge commit)
- Delete the feature branch after merge

---

## 12. Environments & Infrastructure

### Environment Map

```
                  ┌─────────────────────────────────────────┐
                  │            SHARED PRODUCTION DB          │
                  │     Neon PostgreSQL (ep-dry-night-*)     │
                  └────┬──────────┬──────────┬──────────┬───┘
                       │          │          │          │
              ┌────────┴───┐ ┌───┴────┐ ┌───┴────┐ ┌───┴──────┐
              │ PRODUCTION │ │STAGING │ │  DEV   │ │  BACKUP  │
              │ Port 3000  │ │Port 3006│ │Port 3005│ │Port 3005 │
              │ app.ff.app │ │vf.ff.app│ │dev.ff.app│ │backup.*  │
              └────────────┘ └────────┘ └────────┘ └──────────┘
                   │              │          │           │
                   └──────┬───────┴──────────┘           │
                     Velocity Server              VPS (backup)
                    100.96.203.105              72.61.197.178
```

### Environment Details

| Env | URL | Port | systemd Service | Directory |
|-----|-----|------|-----------------|-----------|
| **Production** | `app.fibreflow.app` | 3000 | `fibreflow-production.service` | `/home/velo/fibreflow-production/` |
| **Staging** | `vf.fibreflow.app` | 3006 | `fibreflow.service` | `/home/velo/fibreflow-staging/` |
| **Dev** | `dev.fibreflow.app` | 3005 | `fibreflow-dev.service` | `/home/velo/fibreflow-dev/` |
| **VPS Backup** | `backup.fibreflow.app` | 3005 | `fibreflow-backup.service` | `/opt/fibreflow/` (VPS) |
| **Local** | `localhost:3004` | 3004 | manual | Your machine |

### Traffic Flow

```
User Browser
  → Cloudflare (SSL, CDN, DDoS protection)
    → Cloudflare Tunnel (cloudflared on Velocity)
      → nginx (upstream load balancing)
        → Primary: localhost:PORT (Velocity)
        → Backup: 72.61.197.178:3005 (VPS, auto-failover)
```

### Important: ALL Environments Share One Database

Dev, staging, and production all connect to the same Neon production database. This means:

- Any data change in dev is visible in production
- Be careful with destructive operations (DELETE, UPDATE)
- Test schema migrations on the dev Neon branch first
- Never run bulk data modifications without team lead approval

---

## 13. Deployment Workflow

### Time-Gated Deployment Rules

Deployments follow strict time gates to protect production during business hours:

| Time Window | Dev | Staging | Production |
|-------------|-----|---------|------------|
| **Business hours** (08:00-17:00 SAST, Mon-Fri) | Allowed | **BLOCKED** | **BLOCKED** |
| **After hours** + weekends | Allowed | Promote from dev | Promote from staging |
| **Emergency** (any time) | Allowed | `--force` required | `--force` required |

**Hein's approval is required for ALL staging and production deployments.**

### Deployment Order: Dev -> Staging -> Production

Always deploy in this order. Never skip staging for production deploys.

- **Dev**: Deploy anytime — this is the testing ground
- **Staging**: Promotes the EXACT commit from dev (after hours only)
- **Production**: Promotes the EXACT commit from staging (after hours only)

### Pre-deploy Checks (on your machine)

```bash
# Ensure you're on master with latest code
git checkout master
git pull origin master

# Run all quality checks
npm run lint
npm run type-check
npm run build

# If any check fails, FIX IT before deploying
```

### Deploy Scripts (Recommended)

**Primary method — one command handles everything:**

```bash
bash scripts/deploy-local.sh dev              # Deploy to dev (always allowed)
bash scripts/deploy-local.sh staging          # After hours only
bash scripts/deploy-local.sh production       # After hours only
bash scripts/deploy-local.sh status           # Show all environment status
```

`deploy-local.sh` automatically handles:
- **Ownership fix** — `sudo chown -R velo:velo` (prevents EACCES from mixed user builds)
- **Clean build** — removes stale `.next` before building
- **Service lifecycle** — stops service before build, starts after
- **Build retry** — up to 3 attempts (Next.js 14 has a transient race condition on rename/unlink)
- **Health check** — HTTP 200 check on the URL after restart
- **Backup rotation** — keeps last 3 `.next-backup-*` builds for rollback

**Promotion scripts (exact commit between envs):**

```bash
bash scripts/promote.sh dev staging          # Promote dev → staging (after hours)
bash scripts/promote.sh staging production   # Promote staging → production (after hours)
```

**Legacy:** `deploy-gate.sh` auto-redirects to `deploy-local.sh` when on Velocity.

### Manual Deploy Commands (Fallback)

All deploy directories live under `/home/velo/` and are owned by the `velo` user. The `hein` user has passwordless sudo configured via `/etc/sudoers.d/fibreflow-deploy` to run commands as `velo` and restart services.

These are only needed if `deploy-local.sh` is unavailable:

#### Dev (`dev.fibreflow.app`) — Always allowed

```bash
sudo chown -R velo:velo /home/velo/fibreflow-dev
sudo systemctl stop fibreflow-dev.service
sudo -u velo bash -c 'cd /home/velo/fibreflow-dev && rm -rf .next && git pull origin master && npm run build'
sudo systemctl start fibreflow-dev.service
```

#### Staging / Production — After hours only

```bash
# Use deploy-local.sh or promote.sh instead
bash scripts/deploy-local.sh staging
bash scripts/deploy-local.sh production
```

### VPS Backup Auto-Syncs

The VPS backup server at `backup.fibreflow.app` runs an hourly cron that auto-pulls from master, builds, and restarts. You don't need to deploy it manually.

### If a Deploy Fails

1. **Build failure**: Check the build output, fix the error, rebuild
2. **Service won't start**: Check logs with `sudo journalctl -u <service> -n 100`
3. **Runtime error**: Check browser console and API responses
4. **Rollback**: `sudo -u velo bash -c 'cd /home/velo/fibreflow-<env> && git checkout <previous-commit> && npm run build' && sudo systemctl restart <service>`

---

## 14. Server Access & Services

### Access Model

We run directly on the Velocity server — no SSH needed for deployments. The `hein` user has passwordless sudo configured to run commands as `velo` and restart systemd services.

| Server | Access | Notes |
|--------|--------|-------|
| **Velocity** (`100.96.203.105`) | Local — use `sudo -u velo` | Deploy dirs under `/home/velo/` |
| **VPS** (`72.61.197.178`) | `ssh root@72.61.197.178` | WhatsApp services only |

### Services on Velocity (100.96.203.105)

| Service | Port | Purpose |
|---------|------|---------|
| `fibreflow-production.service` | 3000 | Production app |
| `fibreflow.service` | 3006 | Staging app |
| `fibreflow-dev.service` | 3005 | Dev app |
| `fibreflow-storage.service` | 8091 | File storage API |
| `pdfcraft.service` | 3007 | PDF generation |
| `vllm-qwen.service` | 8100 | AI vision model (Qwen3-VL) |
| `qfield-sync` | 8095 | GIS field data sync |
| `wa-feedback.service` | 8092 | WhatsApp QA feedback proxy (legacy) |

### Services on VPS (72.61.197.178)

| Service | Port | Purpose |
|---------|------|---------|
| `whatsapp-bridge.service` | 8083 | WhatsApp unified bridge (receives + sends messages directly) |
| `wa-command-bot.service` | 8086 | Admin bot for WA queries |
| `fibreflow-backup.service` | 3005 | Backup FibreFlow instance |

> **Note:** The WhatsApp sender service (`whatsapp-sender`) was **permanently removed** on 2026-02-18. The bridge now sends all messages directly via its built-in whatsmeow client (direct-send architecture). Do not attempt to start or reference `whatsapp-sender`.

### WhatsApp Bridge Architecture (Direct-Send)

```
VPS (72.61.197.178) — Port 8083
  └─→ whatsapp-bridge.service (unified, single service)
        ├─→ RECEIVES messages from 9+ monitored WhatsApp groups
        ├─→ SENDS DR acknowledgments directly (via whatsmeow)
        ├─→ SENDS QA feedback directly
        ├─→ SENDS maintenance messages directly
        └─→ Writes to Neon PostgreSQL + local SQLite store
```

- **Phone**: +27 63 841 2276 (27638412276@s.whatsapp.net)
- **Source code**: `/home/velo/whatsapp-bridge/main.go` (on Velocity)
- **Deployed binary**: `/opt/whatsapp-bridge/whatsapp-bridge` (on VPS)
- **Logs**: `/opt/whatsapp-bridge/bridge.log` (on VPS)

### Useful Commands

```bash
# Check service status (local on Velocity)
sudo systemctl status fibreflow-production.service

# View live logs
sudo journalctl -u fibreflow-production.service -f

# Restart a service
sudo systemctl restart fibreflow-production.service

# Check what's running on a port
ss -tlnp | grep ':3000'

# WhatsApp bridge health (VPS)
curl -s http://72.61.197.178:8083/health | jq .

# List monitored WhatsApp groups
curl -s http://72.61.197.178:8083/groups | jq .

# Reload groups from database (no restart needed)
curl -s http://72.61.197.178:8083/reload-groups
```

---

## 15. Health Monitoring

### Automated Health Checks

A health check script runs every 5 minutes on Velocity:

- **Script**: `/home/velo/scripts/fibreflow-health-check-v2.sh`
- **Monitors**: All FibreFlow services, VLM, QField, WA bridge, Docker containers
- **Auto-recovery**: Restarts failed services automatically
- **Alerts**: Sends WhatsApp notifications for critical production failures
- **Logs**: Recovery actions stored in `system_recovery_actions` DB table

A separate health check runs on the VPS every 5 minutes:

- **Script**: `/opt/wa-healthcheck.sh`
- **Monitors**: WhatsApp bridge (`curl http://localhost:8083/health | jq '.connected'`)
- **Auto-recovery**: Restarts bridge if `connected: false`

### Nginx Failover

If a Velocity service crashes, nginx automatically routes to the VPS backup within ~0.3s. This only covers service-level failures — if the entire Velocity server goes down, the backup won't receive traffic (Cloudflare Tunnel won't route).

---

## 16. Quality Protocols (PAI)

These protocols are non-negotiable. They apply to every line of code.

### NLNH — No Lies, No Hallucinations

- If you don't know something, say "I don't know"
- Never guess at database schemas, API endpoints, or method signatures — look them up
- Use confidence markers in uncertain code:
  ```typescript
  // WORKING: Tested and verified
  // PARTIAL: Core works, edge cases untested
  // UNTESTED: Logic looks correct, needs testing
  // BROKEN: Known issue, needs fix
  ```

### DGTS — Don't Game The System

- No fake tests: `expect(true).toBe(true)` is forbidden
- No mocked implementations pretending to be real
- No commented-out validation to make things "work"
- No skipping linting or type checks
- If a test is hard to write, that's a sign the code needs refactoring

### Zero Tolerance Quality Gates

| Rule | Enforcement |
|------|------------|
| No `console.log` | Use `log` from `@/lib/logger` |
| No empty `catch` blocks | Always log and handle errors |
| No `any` type | Full type coverage |
| Files < 300 lines | Split if over |
| Components < 200 lines | Split if over |
| 0 lint errors | `npm run lint` must be clean |
| 0 type errors | `npm run type-check` must pass |
| Build must succeed | `npm run build` |

### Violations = PR Blocked

Any violation of these rules blocks the PR. No exceptions, no overrides.

---

## 17. Troubleshooting

### Common Issues

#### Build Fails with Memory Error

```bash
# The build already uses increased memory, but if needed:
NODE_OPTIONS=--max-old-space-size=4096 npm run build
```

#### Neon Database Timeout (Error 1033)

Transient Neon connection timeout. Usually self-resolves in seconds. If persistent, check Neon dashboard status.

#### Service Won't Start After Deploy

```bash
# Check what went wrong
sudo journalctl -u <service-name> -n 100

# Common fix: port already in use
ss -tlnp | grep :<port>
# Kill the orphan process, then restart
```

#### "Cannot find module" After Deploy

```bash
# Clean and rebuild (local on Velocity)
sudo -u velo bash -c 'cd /home/velo/fibreflow-<env> && rm -rf .next node_modules && npm install && npm run build'
sudo systemctl restart <service>
```

#### Frontend Shows Blank Data

Check for the double-wrapping anti-pattern. If the API returns `{ data: { success: true, data: [...] } }`, the response helper is being misused. The fix:

```typescript
// WRONG
return apiResponse.success(res, { success: true, data: result });

// RIGHT
return apiResponse.success(res, result);
```

### Process Safety

**NEVER use broad process killing commands:**

```bash
# FORBIDDEN:
pkill -f node       # Kills ALL node processes including other services
pkill -f npm        # Kills ALL npm processes
fuser -k PORT/tcp   # Can kill unrelated processes

# SAFE:
ps aux | grep "fibreflow"   # Identify the specific process
kill <specific-PID>          # Kill only that process
```

---

## 18. Quick Reference Cheat Sheet

### Daily Workflow

```bash
# 1. Start your day
git checkout master && git pull origin master
git checkout -b feature/my-task

# 2. Develop
PORT=3004 npm run dev

# 3. Before committing
npm run lint && npm run type-check && npm run build

# 4. Commit
git add <specific-files>
git commit -m "feat(module): description"

# 5. Push & PR
git push -u origin feature/my-task
gh pr create

# 6. After merge, deploy (one command on Velocity)
bash scripts/deploy-local.sh dev
# Staging + Production: after hours only, see Section 13
```

### Key Files to Know

| File | Purpose |
|------|---------|
| `src/lib/apiResponse.ts` | Standard API response wrapper |
| `src/lib/logger.ts` | Logger (replaces console.log) |
| `src/lib/neon.ts` | Database connection |
| `CLAUDE.md` | AI assistant project context |
| `docs/INFRASTRUCTURE.md` | Full infrastructure docs |
| `.claude/modules/` | Per-module documentation |

### Key URLs

| Environment | URL |
|-------------|-----|
| Production | https://app.fibreflow.app |
| Staging | https://vf.fibreflow.app |
| Dev | https://dev.fibreflow.app |
| GitHub | https://github.com/VelocityFibre/FF_Next.js |

### Emergency Contacts

- **Hein** (Tech Lead) — Primary contact for all FibreFlow issues
- **WhatsApp alerts** — Automated for production service failures

---

## Summary of Rules That Will Get Your PR Blocked

1. `console.log` anywhere in the code
2. `any` type without documented justification
3. Empty `catch` blocks
4. File over 300 lines
5. Lint errors or type errors
6. Fake tests (assert true, tautologies)
7. Credentials or secrets in code
8. Conditional SQL fragments (breaks Neon)
9. Nested dynamic API routes (breaks Vercel)
10. Direct database imports in frontend code (`src/`)
11. Skipping the Dev -> Staging -> Production deploy order
12. Force-pushing to master

---

*This document covers everything you need to contribute to FibreFlow. When in doubt, check the module docs in `.claude/modules/`, ask the team lead, or read the code — it's the ultimate source of truth.*
