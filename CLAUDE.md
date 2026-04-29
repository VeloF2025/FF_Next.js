# CLAUDE.md - AI Assistant Context Guide

## Project Overview
**FibreFlow Next.js** — fiber network project management application for Velocity Fibre.
- **Framework**: Next.js 14+ (Pages Router primary, App Router for new routes)
- **Auth**: PostgreSQL-based RBAC (no Clerk, no Auth0)
- **Database**: Self-hosted Supabase Postgres on Velocity (`100.96.203.105:5437`) — single DB shared by dev + production
- **Storage**: VF Storage on `100.96.203.105:8091`, served via `app.fibreflow.app/storage/`
- **Deploy targets**: `dev.fibreflow.app` (port 3005) and `app.fibreflow.app` (port 3000), both via systemd on Velocity
- **Staff portal**: `/my` (dark theme, PWA) for time/attendance, payslips, receipts, fleet

---

## Hard Rules (non-negotiable)

### Behaviour
1. **Think before coding.** State assumptions explicitly. If multiple interpretations of a request exist, list them and ask which one — do not guess from training-data patterns.
2. **Simplicity first.** No features beyond what was asked. If a 200-line solution can be 50 lines, rewrite it. No speculative abstractions.
3. **Surgical changes.** Touch only what the task requires. Adjacent dead code, formatting drift, "while we're here" cleanups → *mention* them, don't fix them.
4. **Goal-driven verification.** Before claiming done: define the success criteria, run `npm run ci:quick` (or relevant subset), and prove it passes. For UI changes use Playwright/Claude-in-Chrome MCP — code review alone is not verification. "Should work" / "looks good" are forbidden without evidence.
5. **NLNH** (No Lies, No Hallucinations) — say "I don't know", use HIGH/MEDIUM/LOW confidence, never assert system state without checking.
6. **DGTS** — no fake tests (`assert true`, tautologies), no mocks pretending to be real implementations.

### Git & Deploy
7. **ALL changes go through a Pull Request.** Never commit directly to master. `ALLOW_MASTER_COMMIT=1` only with explicit authorization.
8. **NEVER edit files in deploy dirs** (`/home/velo/fibreflow-dev/`, `/home/velo/fibreflow-production/`). Code changes happen in a worktree off `/home/hein/Workspace/FF_Next.js/`.
9. **Production deploys**: blocked during business hours (08:00–17:00 SAST, Mon–Fri); require Hein's explicit approval; always via `bash scripts/deploy-local.sh` (never manual `git pull + build + restart` — causes 500s).
10. **Destructive commands require confirmation.** Force-push, `git reset --hard`, branch deletion, `rm -rf`, merges into master, schema migrations, process kills (no `pkill -f node`/`pkill -f npm` — they kill Claude itself). When unsure if a command is destructive — ask.

### Code Quality (Zero Tolerance)
11. No `console.log` — use `log` from `@/lib/logger`. No empty catch blocks. 100% type coverage. Files <300 lines, components <200 lines.

---

## Database

**Self-hosted Supabase, single DB shared by dev + production** (cutover 2026-04-18; Neon retired). Schema migrations affect everyone immediately.

| Detail | Value |
|--------|-------|
| Host | `localhost:5437` on Velocity (Tailscale: `100.96.203.105:5437`) |
| User / DB | `fibreflow_user` / `fibreflow` |
| Container | `supabase-db` (Docker on Velocity) |

Connection strings: `.claude/credentials.local.md`.

**Tech debt — Neon serverless shim**: `lib/db/pool.js` still imports `@neondatabase/serverless` (webpack-aliased via `src/lib/neon-shim.ts`). New code uses `pg.Pool` via `@/lib/db` or `@/lib/db-pool`. **Post-cutover 500s → check the Neon shim first.**

**Conditional SQL via the shim is broken**: `${cond ? sql`AND x` : sql``}` breaks `lib/db/pool.js` callers. Use explicit query branches. (`pg.Pool` callers are unaffected.)

**Two drop tables — DO NOT CONFUSE:**
- `drops` — SOW imports (`/api/sow/drops`)
- `qa_photo_reviews` — WhatsApp QA data (`/api/wa-monitor-*`)

---

## Project-Specific Tools & Commands

**npm is canonical** — CI (`scripts/ci-local.sh`) and deploy (`scripts/deploy-local.sh`) both use `npm`. A `bun.lock` is committed but is not the source of truth; do not regenerate it. Use `npm ci` / `npm install`, never `bun install`.

These are the non-default project commands — Claude already knows `npm run build`, `npm run dev`, `npm run lint`, etc.

```bash
npm run ci:quick      # Local CI lint gates (run before EVERY PR)
npm run ci            # Full lint + tests + build
npm run antihall      # Validate that referenced symbols actually exist
PORT=3004 npm run dev # Local dev convention (3004 is the agreed port)
```

**Deploy script** (mandatory — never manual):
```bash
bash scripts/deploy-local.sh dev          # Dev — any time
bash scripts/deploy-local.sh production   # After hours only, with Hein's approval
```

**Use `gh` CLI** for all GitHub operations (PRs, issues, reviews) instead of raw `git push`/web-UI workflows.

---

## API & Code Conventions

```typescript
import { apiResponse } from '@/lib/apiResponse';
return apiResponse.success(res, data);
return apiResponse.notFound(res, 'Resource', id);
```

- Use consistent dynamic param names: `[projectId]`, not `[id]`.
- Flatten nested dynamic routes — they fail in Vercel.
- Wait for the API confirmation before showing success toasts.

---

## Path-Scoped Rule Files

Two parallel doc systems exist. Both are real and serve different roles:

| Location | Role | Loading |
|----------|------|---------|
| `src/modules/<name>/.claude.md` (~56 files) | Quick reference / module gotchas (target ≤50 lines) | **Auto-loaded** when Claude works inside that module |
| `.claude/modules/<name>.md` (~59 files) | Full reference / deep-dive docs | **Explicit-load** (read it when needed) |

When adding rules, keep the auto-loaded `src/modules/*/.claude.md` short — push detail into `.claude/modules/<name>.md` so it doesn't bloat every session.

| Area | Full doc | Quick reference |
|------|----------|------------------|
| Activate | `.claude/modules/activate.md` | `/activate`, VLM on :8100, 12-step QA wizard |
| WA Monitor | `.claude/modules/wa-monitor.md` | VPS 72.61.197.178, sender:8081, bridge:8083 |
| QField Sync | `.claude/modules/qfield-sync.md` | Webhook :8095, `/Qfield` skill |
| VLM | `.claude/modules/vlm.md` | Qwen3 on :8100, max 1024×768 images |
| Fleet | `.claude/modules/fleet.md` | Vehicle check-in, VLM plate reading |
| Procurement | `.claude/modules/procurement.md` | BOQ, RFQ, PO workflow |

Full list: `ls .claude/modules/`. Discovery: `.claude/modules/_index.yaml`.

---

## Iterating on This File

When the user corrects an implementation: **first apply the correction, then capture the rule** in:
- `.claude/modules/<area>.md` — if scoped to a module
- This file's "Hard Rules" — if a project-wide non-negotiable
- User memory (`MEMORY.md`) — if a personal preference / cross-session learning

Don't bury new rules at the bottom — order by priority (hard → medium → reference).

---

## Reference (low priority)

### Directory layout
```
src/{modules,components,services,lib}/
.claude/{modules,skills,knowledge-base}/
pages/api/                    # API routes (flattened, not [id]/sub.ts)
```

### Deploy environments
| Env | URL | Port | Service |
|-----|-----|------|---------|
| Dev | dev.fibreflow.app | 3005 | `fibreflow-dev.service` |
| Production | app.fibreflow.app | 3000 | `fibreflow-production.service` |
| Local | localhost:3004 | 3004 | manual |

Deploy dirs (owned by `velo`, use `sudo -u velo`):
- `/home/velo/fibreflow-dev/` → dev.fibreflow.app
- `/home/velo/fibreflow-production/` → app.fibreflow.app

### Slash commands
- **Project skills** (`.claude/skills/`): `/audit`, `/activate`, `/Qfield`, `/civil-qa`, `/dr`, plus ~60 others — `ls .claude/skills/`
- **Global skills** (`~/.claude/skills/`): `/review`, `/review-team`, `/pr-pipeline`, `/prompting`
- `/sync` and `/deploy` are not skills — deployment is `bash scripts/deploy-local.sh dev|production`

### Knowledge system
`.claude/modules/` (58 docs) · `.claude/skills/` (66 skills) · `.claude/knowledge-base/` (deep ref) · `docs/INFRASTRUCTURE.md` (full deploy ops) · `.claude/credentials.local.md` (secrets)
