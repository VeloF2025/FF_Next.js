# How Everything Works — VelocityFibre Complete Guide

> **For**: Zander (and anyone new joining the team)
> **Last updated**: 2026-02-11
> **Author**: Hein (via Claude Code)

---

## Table of Contents

1. [The Big Picture](#1-the-big-picture)
2. [The Application — FibreFlow](#2-the-application--fibreflow)
3. [The Codebase](#3-the-codebase)
4. [The Database](#4-the-database)
5. [The Servers](#5-the-servers)
6. [Deployment — How Code Gets Live](#6-deployment--how-code-gets-live)
7. [The Module System](#7-the-module-system)
8. [Key Modules Explained](#8-key-modules-explained)
9. [External Services & Integrations](#9-external-services--integrations)
10. [The AI Layer](#10-the-ai-layer)
11. [The Claude Code Setup](#11-the-claude-code-setup)
12. [Day-to-Day Workflow](#12-day-to-day-workflow)
13. [Troubleshooting](#13-troubleshooting)
14. [Gotchas & Lessons Learned](#14-gotchas--lessons-learned)

---

## 1. The Big Picture

VelocityFibre builds fiber optic networks in South Africa. **FibreFlow** is the internal
web application that manages every aspect of this:

- **Projects**: Each fiber deployment is a project with SOW (Statement of Work), drops, poles
- **Field Work**: Technicians submit photos via WhatsApp, which get AI-reviewed
- **Procurement**: BOQ → RFQ → PO → GRN workflow for materials
- **Fleet**: Vehicle management with check-ins and damage tracking
- **Staff/Contractors**: Employee management, contractor onboarding, compliance
- **QA**: Photo review pipeline using AI (VLM) to extract serial numbers, check quality

The app is used daily by project managers, field technicians (via WhatsApp), procurement
staff, and management.

---

## 2. The Application — FibreFlow

### Tech Stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| Frontend | React 18 + Next.js 14 | Pages Router (NOT App Router) |
| Styling | TailwindCSS | Dark theme with CSS variables |
| State | React Query (server) + Zustand (client) | |
| API | Next.js API Routes (`pages/api/`) | REST endpoints |
| Database | Neon PostgreSQL | Serverless, direct SQL (no ORM) |
| Storage | Firebase Storage | File/image uploads |
| Auth | Custom JWT | PostgreSQL-backed roles & permissions |
| AI | Qwen3 VLM | Photo analysis, serial number extraction |

### How a Request Flows

```
User clicks something in browser
  → React component calls fetch('/api/something')
    → pages/api/something.ts handles the request
      → Calls a service in src/services/ (business logic)
        → Service queries Neon PostgreSQL via SQL
          → Returns data up the chain
            → Component renders the result
```

### The Design System

Everything uses a dark theme with CSS variables. Never use hardcoded colors.

```css
--ff-bg-primary        /* Main background */
--ff-bg-secondary      /* Card/panel background */
--ff-bg-tertiary       /* Input/nested backgrounds */
--ff-text-primary      /* Main text */
--ff-text-secondary    /* Subtle text */
--ff-text-tertiary     /* Muted text */
--ff-border-light      /* Borders */
--ff-bg-hover          /* Hover states */
```

---

## 3. The Codebase

### Directory Structure

```
FF_Next.js/
│
├── pages/                    # Next.js pages (routing)
│   ├── api/                  # ALL API endpoints live here
│   │   ├── meetings.ts       # Single-file API routes
│   │   ├── staff.ts
│   │   ├── wa-monitor-*.ts   # WA endpoints (10+ files)
│   │   └── sow/              # Can have subdirectories
│   │       ├── drops.ts
│   │       └── import.ts
│   ├── _app.tsx              # App wrapper (auth, layout)
│   ├── dashboard.tsx         # Dashboard page
│   ├── staff/                # Staff pages
│   │   ├── index.tsx         # /staff
│   │   ├── [id].tsx          # /staff/123
│   │   └── new.tsx           # /staff/new
│   └── ...
│
├── src/
│   ├── modules/              # Feature modules (UI + logic)
│   │   ├── activate/         # DR photo review
│   │   │   ├── ActivateDashboard.tsx
│   │   │   ├── components/
│   │   │   ├── types/
│   │   │   └── .claude.md    # Module-specific AI docs
│   │   ├── fleet/
│   │   ├── procurement/
│   │   ├── staff/
│   │   └── ...               # 30+ modules
│   │
│   ├── components/           # Shared components
│   │   ├── AppLayout.tsx     # Standard page layout
│   │   ├── dashboard/        # StatCard, StatCardGrid, etc.
│   │   └── ui/               # Generic UI components
│   │
│   ├── services/             # Business logic & API clients
│   │   ├── core/
│   │   │   └── NotificationService.ts
│   │   └── fireflies/
│   │       └── firefliesService.ts
│   │
│   ├── lib/                  # Utilities (import from '@/lib/...')
│   │   ├── db.ts             # Database pool (shared, import this)
│   │   ├── neon.ts           # Neon SQL template helper
│   │   ├── logger.ts         # Logger (ALWAYS use this, not console.log)
│   │   ├── apiResponse.ts    # Standard API response helpers
│   │   └── auth.ts           # Auth utilities
│   │
│   └── types/                # Shared TypeScript types
│
├── .claude/                  # AI assistant documentation
│   ├── modules/              # 45 module docs
│   ├── knowledge-base/       # Deep reference material
│   ├── commands/             # Slash commands (/deploy, /pr)
│   ├── skills/               # Workflow procedures
│   └── hooks/                # Automation hooks
│
├── CLAUDE.md                 # Main project instructions for Claude
├── .env.example              # Environment variable template
├── .env.local                # Actual env vars (gitignored)
└── docs/                     # Documentation
```

### Key Patterns

**API Route Pattern:**
```typescript
// pages/api/something.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import pool from '@/lib/db';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    try {
      const result = await pool.query('SELECT * FROM things');
      return apiResponse.success(res, result.rows);
    } catch (error) {
      return apiResponse.error(res, 'Failed to fetch things', 500);
    }
  }
  return apiResponse.error(res, 'Method not allowed', 405);
}
```

**Module Component Pattern:**
```typescript
// src/modules/something/SomethingDashboard.tsx
import { DashboardHeader } from '@/components/dashboard/DashboardHeader';
import { log } from '@/lib/logger';
import type { Something } from './types/something.types';

export function SomethingDashboard() {
  // Fetch data, render UI
  // Use CSS variables for all colors
  // Keep under 200 lines
}
```

---

## 4. The Database

### Neon PostgreSQL

We use **Neon** — a serverless PostgreSQL. It works exactly like regular PostgreSQL but:
- Hosted in the cloud (no local DB to manage)
- Has a "branching" feature (like git branches for databases)
- Scales to zero when idle, spins up on first query
- Console: https://console.neon.tech

### Branches

| Branch | Used By | Endpoint |
|--------|---------|----------|
| `production` | Production + Staging | `ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech` |
| `hein-dev` | Dev + Local | `ep-aged-poetry-a9bbd8e9.gwc.azure.neon.tech` |

**CRITICAL**: Production and Staging share the same database. This means:
- Testing on staging affects production data
- Be very careful with migrations — they hit the live database
- Use the `hein-dev` branch for experimental/destructive work

### Querying

We use **direct SQL** (no ORM like Prisma or Drizzle). Two approaches:

```typescript
// Approach 1: Pool (pg library) — used in API routes
import pool from '@/lib/db';
const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);

// Approach 2: Neon SQL template — used in services
import { sql } from '@/lib/neon';
const users = await sql`SELECT * FROM users WHERE id = ${userId}`;
```

**DO NOT** do conditional SQL fragments with Neon:
```typescript
// BROKEN — will generate invalid SQL:
const result = await sql`SELECT * FROM users ${condition ? sql`WHERE active = true` : sql``}`;

// CORRECT — use separate queries:
const result = condition
  ? await sql`SELECT * FROM users WHERE active = true`
  : await sql`SELECT * FROM users`;
```

### Key Tables

| Table | Module | Description |
|-------|--------|-------------|
| `users` | Auth/Staff | All system users with roles |
| `projects` | Projects | Fiber deployment projects |
| `drops` | SOW | Individual fiber drops (from SOW import) |
| `qa_photo_reviews` | WA Monitor | WhatsApp-submitted QA photos |
| `contractors` | Contractors | Contractor companies |
| `installations` | Installations | Installation records |
| `fleet_vehicles` | Fleet | Vehicle records |
| `fleet_check_records` | Fleet | Vehicle check-in records |
| `rfq`, `boq`, `purchase_orders` | Procurement | Procurement workflow |

---

## 5. The Servers

### Overview

```
┌─────────────────────────────────────────────────┐
│          Velocity Server (100.96.203.105)         │
│                                                   │
│  ┌─────────────┐ ┌──────────┐ ┌───────────────┐ │
│  │ Production   │ │ Staging  │ │ Dev           │ │
│  │ :3000        │ │ :3006    │ │ :3005         │ │
│  │ app.fibre..  │ │ vf.fibre.│ │ dev.fibre..   │ │
│  └─────────────┘ └──────────┘ └───────────────┘ │
│                                                   │
│  ┌─────────┐ ┌──────────┐ ┌────────────┐        │
│  │ VLM AI  │ │ QField   │ │ WA Proxy   │        │
│  │ :8100   │ │ :8095    │ │ :8092      │        │
│  └─────────┘ └──────────┘ └────────────┘        │
│                                                   │
│  Nginx reverse proxy → routes domains to ports    │
└─────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────┐
│            VPS Server (72.61.197.178)             │
│                                                   │
│  ┌───────────┐ ┌──────────┐ ┌──────────┐        │
│  │ WA Sender │ │ WA Bridge│ │ WA Bot   │        │
│  │ :8081     │ │ :8083    │ │ :8086    │        │
│  └───────────┘ └──────────┘ └──────────┘        │
│                                                   │
│  (Separate server for WhatsApp — uses WAHA)       │
└─────────────────────────────────────────────────┘
```

### User Accounts on Velocity

| User | Password | Sudo | Primary Use |
|------|----------|------|-------------|
| `zander` | `zander2026` (change it!) | Yes | Your personal account |
| `velo` | `velo2026` | Yes | Shared admin, owns all 3 deploy dirs |
| `hein` | `0203` | Yes | Hein's personal account (SSH key auth to velo) |

### Systemd Services

Each FibreFlow environment runs as a systemd service:

```bash
# Check if running
sudo systemctl status fibreflow-production.service

# View live logs
sudo journalctl -u fibreflow-production.service -f

# Restart
sudo systemctl restart fibreflow-production.service
```

Services auto-start on server reboot because they're `enabled`.

### Nginx

Nginx sits in front and routes domains to the correct port:

```
app.fibreflow.app  → localhost:3000 (production)
vf.fibreflow.app   → localhost:3006 (staging)
dev.fibreflow.app   → localhost:3005 (dev)
```

Config is at `/etc/nginx/sites-available/fibreflow` on the Velocity server.

---

## 6. Deployment — How Code Gets Live

### The Flow

```
1. You write code locally
2. Commit and push to master on GitHub
3. SSH to the server
4. In the correct directory: git pull → npm run build → systemctl restart
5. The new code is live
```

There is **no CI/CD pipeline** — deploys are manual. This is a known improvement area.

### Step by Step: Production Deploy

```bash
# SSH to server
ssh zander@100.96.203.105

# Go to production directory
cd /home/velo/fibreflow-production

# Pull latest code
git pull

# Build (takes ~2-3 minutes)
npm run build

# Restart the service
echo 'zander2026' | sudo -S systemctl restart fibreflow-production.service

# Verify it's running
sudo systemctl status fibreflow-production.service
```

### All Deploys Are Identical

Since all 3 directories live under `/home/velo/` and are owned by the same user,
every deploy follows the exact same pattern. No more permission issues or two-step deploys.

### Deploying All Three at Once

If you need all environments on the same commit (common after a batch of changes):

```bash
# 1. Push your changes
git push origin master

# 2. Deploy production
ssh zander@100.96.203.105 "cd /home/velo/fibreflow-production && git pull && npm run build && echo 'zander2026' | sudo -S systemctl restart fibreflow-production.service"

# 3. Deploy staging
ssh zander@100.96.203.105 "cd /home/velo/fibreflow-staging && git pull && npm run build && echo 'zander2026' | sudo -S systemctl restart fibreflow.service"

# 4. Deploy dev (two-step)
ssh hein@100.96.203.105 "cd /home/velo/fibreflow-dev && git pull && npm run build"
ssh zander@100.96.203.105 "echo 'zander2026' | sudo -S systemctl restart fibreflow-dev.service"
```

### Rollback

If something breaks:
```bash
cd /home/velo/fibreflow-production
git log --oneline -5        # Find the last good commit
git checkout <hash>          # Go back
npm run build
sudo systemctl restart fibreflow-production.service
```

---

## 7. The Module System

FibreFlow is organized into **38+ modules** in `src/modules/`. Each module is a self-contained
feature area with its own components, types, and sometimes a `.claude.md` file.

### Module Categories

| Category | Modules | What They Do |
|----------|---------|--------------|
| **Core** | projects, clients, sow, installations, workflow, tasks, pipeline | The main business logic |
| **Procurement** | procurement, assets, suppliers | Material purchasing workflow |
| **Monitoring** | wa-monitor, foto-review, activate, daily-progress | QA and progress tracking |
| **Reporting** | analytics, kpi-dashboard, reports | Dashboards and data viz |
| **Operations** | fleet, qfield-sync, field-app, onemap, nokia-equipment | Field operations |
| **Communication** | communications, meetings, livekit | Messaging and video |
| **Admin** | admin, settings, staff, onboarding, access-control | System management |

### Module Documentation

Every module has detailed docs in `.claude/modules/<name>.md`. These include:
- What the module does
- Key files and components
- Database tables it uses
- API endpoints
- Known issues and learnings

**Always read the module doc before working on a module.**

The master index is `.claude/modules/_index.yaml` — it maps every module to its
category, purpose, complexity, and database tables.

---

## 8. Key Modules Explained

### SOW (Statement of Work)
SOW data is imported from Excel spreadsheets. Each SOW defines the fiber drops, poles,
and cable runs for a project. The `drops` table contains every individual fiber drop.

### WA Monitor (WhatsApp Monitor)
Technicians in the field submit QA photos via WhatsApp. These flow through:
```
Technician sends WhatsApp photo
  → VPS WA Bridge (:8083) receives it
    → Stores in qa_photo_reviews table
      → FibreFlow dashboard shows for review
        → VLM AI can auto-extract serial numbers
```

### Activate
The main QA review interface. Project managers review photos submitted via WhatsApp,
verify serial numbers (sometimes using AI), and acknowledge completed drops.

### Fleet
Vehicle management. Technicians do vehicle check-ins with photos (front, back, mileage).
VLM AI reads license plates and mileage from photos.

### Procurement
Full purchasing workflow: BOQ (Bill of Quantities) → RFQ (Request for Quote) →
PO (Purchase Order) → GRN (Goods Received Note).

---

## 9. External Services & Integrations

| Service | Purpose | Integration Point |
|---------|---------|-------------------|
| **Neon** | Database | Direct SQL via `@/lib/db` |
| **Firebase** | File storage | Upload/download via Firebase SDK |
| **1Map** | GIS/mapping | REST API for geocoding and maps |
| **Sage** | Accounting ERP | OAuth2 integration for invoicing |
| **Odoo** | ERP (legacy) | REST API, being phased out |
| **Fireflies** | Meeting transcription | GraphQL API, syncs to `meetings` table |
| **LiveKit** | Video calls | WebRTC for real-time video |
| **WAHA** | WhatsApp API | REST API on VPS for messaging |
| **Resend** | Email | Transactional email sending |
| **QFieldCloud** | GIS field data | Webhook sync for field GPS data |

---

## 10. The AI Layer

### VLM (Visual Language Model)

We run **Qwen3** locally on the Velocity server at port 8100.

What it does:
- **Serial number extraction**: Reads serial numbers from photos of fiber equipment
- **Photo quality assessment**: Checks if a photo is usable
- **License plate reading**: Reads vehicle plates from fleet check-in photos
- **Mileage reading**: Extracts mileage from dashboard photos

API:
```bash
curl http://100.96.203.105:8100/analyze \
  -F "image=@photo.jpg" \
  -F "prompt=Extract the serial number from this equipment label"
```

### Fireflies AI

Fireflies.ai records and transcribes meetings. We sync transcripts to our database
and display them in the meetings module. Meeting summaries, action items, and
attendee lists are all synced.

---

## 11. The Claude Code Setup

Hein uses Claude Code extensively. The `.claude/` directory is a rich knowledge base
that Claude reads to understand the project.

### What's in .claude/

| Directory | Purpose | Example |
|-----------|---------|---------|
| `modules/` | Module-specific docs | `wa-monitor.md` — everything about WA Monitor |
| `knowledge-base/` | Deep reference | `architecture/deployment.md` — full deploy architecture |
| `commands/` | Slash commands | `deploy.md` — the /deploy workflow |
| `skills/` | Complex workflows | Multi-step procedures |
| `agents/` | Custom agent defs | `wa-agent.md` — specialized WA troubleshooter |
| `hooks/` | Automation | Auto-load module context, track tokens, etc. |

### Using Claude Code

```bash
# Start Claude Code in the project directory
cd FF_Next.js
claude

# Claude will automatically read CLAUDE.md and understand the project
# You can ask it to:
# - Read and explain code
# - Write new features
# - Debug issues
# - Deploy to servers
# - Query the database
```

### Your Own Claude Setup

1. Install Claude Code: `npm install -g @anthropic-ai/claude-code`
2. Set your API key: `export ANTHROPIC_API_KEY=your-key`
3. Navigate to the project: `cd FF_Next.js`
4. Start: `claude`
5. On first session, give it `docs/ZANDER_CLAUDE_BOOTSTRAP.md` for full context

You can also create your own `~/.claude/CLAUDE.md` for personal global preferences.

---

## 12. Day-to-Day Workflow

### Starting Work

```bash
cd FF_Next.js
git pull                     # Get latest
npm install                  # If packages changed
PORT=3004 npm run dev        # Start local dev server
```

### Making Changes

1. **Read the module doc first**: `.claude/modules/<module>.md`
2. Make your changes
3. Test locally: `PORT=3004 npm run dev`
4. Quality check: `npm run lint && npm run type-check`
5. Commit: `git add <files> && git commit -m "feat(module): description"`
6. Push: `git push origin master`
7. Deploy: See section 6

### Commit Message Format

```
feat(meetings): add attendee avatars to detail modal
fix(fleet): correct mileage calculation for diesel vehicles
docs: update procurement module documentation
chore: add migration script for pool consolidation
refactor(staff): extract form sections into separate components
```

### Branch Strategy

Currently everything goes to `master`. For larger features, create a branch:
```bash
git checkout -b feature/new-thing
# ... work ...
git push origin feature/new-thing
# Create PR on GitHub, merge to master
```

---

## 13. Troubleshooting

### Service Won't Start

```bash
# Check the logs
sudo journalctl -u fibreflow-production.service -n 50 --no-pager

# Common issues:
# - Port already in use: sudo lsof -i :3000
# - Build failed: check for TypeScript errors
# - Missing env vars: check .env.local exists
```

### Build Fails

```bash
# Run type check to find errors
npm run type-check

# Common fixes:
# - Missing imports
# - Type mismatches
# - Unused variables (ESLint)
```

### Database Issues

```bash
# Connect to production DB
psql "postgresql://neondb_owner:npg_MIUZXrg1tEY0@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require"

# Check table exists
\dt drops

# Check recent data
SELECT * FROM qa_photo_reviews ORDER BY created_at DESC LIMIT 5;
```

### WhatsApp Not Working

```bash
# Check VPS services
ssh root@72.61.197.178
systemctl status wa-sender.service
systemctl status wa-bridge.service

# Check logs
journalctl -u wa-bridge.service -f
```

### Health Checks

```bash
curl https://app.fibreflow.app/api/system/health
curl http://100.96.203.105:8100/health          # VLM
curl http://72.61.197.178:8081/health            # WA Sender
curl http://72.61.197.178:8083/health            # WA Bridge
```

---

## 14. Gotchas & Lessons Learned

### Things That Will Bite You

1. **Production and staging share a database.** If you break data on staging, production
   is broken too. Use the dev branch (`hein-dev`) for risky experiments.

2. **All deploy dirs are under /home/velo/.** This was unified on 2026-02-11 to
   eliminate the old permission issues between hein/velo users.

3. **No conditional SQL with Neon.** Template literal conditionals break the SQL parser.
   Always use explicit query branches.

4. **Nested dynamic routes fail on Vercel.** Use `[projectId]` not `[id]`. Flatten
   routes like `contractors-stages.ts` instead of `[id]/stages.ts`.

5. **Don't use console.log.** Use `import { log } from '@/lib/logger'`. This is enforced.

6. **All environments auto-restart on crash** (systemd `Restart=on-failure`).
   But they do NOT auto-deploy. You must manually deploy after pushing code.

7. **The `drops` table and `qa_photo_reviews` table are different things.**
   `drops` = SOW fiber drops. `qa_photo_reviews` = WhatsApp QA photos. Confusing them
   is a common mistake.

8. **Never `pkill -f node`** — it will kill Claude Code and everything else. Always
   find the specific PID first.

9. **Build takes 2-3 minutes.** Don't panic if it seems slow. The app has 300+ pages.

10. **The `.claude/` directory is committed to git** (except `credentials.local.md`).
    This means your module docs and knowledge base updates go to everyone.

---

## Quick Reference Card

```
LOCAL DEV:     PORT=3004 npm run dev
QUALITY:       npm run lint && npm run type-check
BUILD:         npm run build
TEST:          npm test

PRODUCTION:    app.fibreflow.app    :3000    fibreflow-production.service
STAGING:       vf.fibreflow.app     :3006    fibreflow.service
DEV:           dev.fibreflow.app    :3005    fibreflow-dev.service

VELOCITY:      100.96.203.105 (zander/velo/hein)
VPS:           72.61.197.178 (root)
DATABASE:      Neon PostgreSQL (ep-dry-night = prod, ep-aged-poetry = dev)

MODULE DOCS:   .claude/modules/<name>.md
ARCH DOCS:     .claude/knowledge-base/architecture/
CREDENTIALS:   /home/shared/docs/credentials/CREDENTIALS.md (on server)
```
