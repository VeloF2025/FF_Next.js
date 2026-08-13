# FibreFlow Next.js — AI Assistant Context Guide

## Project Overview
**FibreFlow Next.js** — fiber network project management application for Velocity Fibre.
- **Framework**: Next.js 14.2; hybrid router. Pages Router is still dominant, but new work exists in both `pages/` and `app/` — follow the surrounding module rather than moving routes by default.
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
4. **Goal-driven verification.** Before claiming done: define the success criteria, run `npm run ci:quick` (or relevant subset), and prove it passes. For UI changes use Playwright or the environment's browser automation (Claude-in-Chrome in Claude Code) — code review alone is not verification. "Should work" / "looks good" are forbidden without evidence.
5. **NLNH** (No Lies, No Hallucinations) — say "I don't know", use HIGH/MEDIUM/LOW confidence, never assert system state without checking.
6. **DGTS** — no fake tests (`assert true`, tautologies), no mocks pretending to be real implementations.

### Git & Deploy
7. **ALL changes go through a Pull Request.** Never commit directly to master. `ALLOW_MASTER_COMMIT=1` only with explicit authorization.
8. **NEVER edit files in deploy dirs** (`/home/velo/fibreflow-dev/`, `/home/velo/fibreflow-production/`). Code changes happen in a worktree off `/home/hein/Workspace/FF_Next.js/`.
9. **Production deploys**: blocked during business hours (08:00–17:00 SAST, Mon–Fri); require Hein's explicit approval; always via `bash scripts/deploy-local.sh` (never manual `git pull + build + restart` — causes 500s).
10. **Destructive commands require confirmation.** Force-push, `git reset --hard`, branch deletion, `rm -rf`, merges into master, schema migrations, process kills (no `pkill -f node`/`pkill -f npm` — they kill the agent process too). When unsure if a command is destructive — ask.
11. **NEVER commit credentials.** No real password, token, API key, connection string, or private key in any tracked file — this includes code, comments, commit messages, PR descriptions, and **docs** (handoff notes `.claude/handoffs/*`, plans/specs `docs/superpowers/**`, deploy/setup docs). Secrets live only in `.claude/credentials.local.md` (gitignored) or server env files. In docs/commands, use a placeholder + reference, never the value: `PGPASSWORD="$PGPASSWORD" psql …  # see .claude/credentials.local.md`. A secret-scan hook (`scripts/secret-scan.sh`, run by pre-commit, pre-push, and CI Gate 7) blocks new leaks — enable the local half once per clone with `bash scripts/install-hooks.sh`, which points `core.hooksPath` at the tracked hooks in `scripts/githooks/` (nothing is copied into `.git/hooks`). Never `--no-verify` past a real secret. A credential that has touched a tracked file is **compromised** — stop and tell Hein so it can be rotated (it was leaked once already: issue #1830).

### Code Quality (Zero Tolerance)
12. **Changed code is zero-tolerance.** No `console.log` without a documented runtime exception — use `log` from `@/lib/logger`. No empty catch blocks; changed code must be fully typed. New files stay <300 lines and new components <200 lines. Existing size, type, and silent-catch debt is ratcheted by CI; do not expand it or refactor it outside the requested scope.

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

**Conditional tagged-template SQL fragments are broken**: `${cond ? sql`AND x` : sql``}` breaks both webpack-shim callers and the `@/lib/db-pool` SQL tag. Use explicit query branches. Raw `pg.Pool.query(text, params)` callers are unaffected.

**Two drop tables — DO NOT CONFUSE:**
- `drops` — SOW imports (`/api/sow/drops`)
- `qa_photo_reviews` — WhatsApp QA data (`/api/wa-monitor-*`)

---

## Project-Specific Tools & Commands

**npm is canonical** — CI (`scripts/ci-local.sh`) and deploy (`scripts/deploy-local.sh`) both use `npm`. A `bun.lock` is committed but is not the source of truth; do not regenerate it. Use `npm ci` / `npm install`, never `bun install`.

These are the non-default project commands; standard npm commands such as `npm run build`, `npm run dev`, and `npm run lint` remain available.

```bash
npm run ci:quick      # Local CI lint gates (run before EVERY PR)
npm run ci            # Full lint + identity-ratcheted unit tests + build
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

## CI

Full application CI runs on the `velo-fibreflow` self-hosted runner on `velo-server` (systemd user unit `gha-runner-fibreflow.service`, labels `self-hosted, linux, fibreflow`). The dependency-free agent-docs gate runs on `ubuntu-latest` because it executes PR-controlled generator code; keep that job off persistent self-hosted runners.

- Re-register: `~/bin/install-gha-runner VelocityFibre/FF_Next.js fibreflow` (idempotent — uses `--replace`).
- Runner assignment: `gh run view <id> --json jobs` (the runner inventory API requires repository administration permission).
- Service control: `systemctl --user status|restart gha-runner-fibreflow`
- Live logs: `journalctl --user -u gha-runner-fibreflow -f`

**Standing review-and-merge rule.** When the user says "review and merge" or "review the PR":

1. Always use an independent blind review; never self-review. In Claude Code invoke `/review`; in other agents use their independent reviewer/agent workflow.
   - Doc-only or single-domain PRs: one independent reviewer.
   - 500+ line code PRs touching multiple domains: use the available review-team workflow.
   - Pass the reviewer the diff + relevant scoped instruction files only — no session reasoning.
2. Wait for GitHub Actions on the self-hosted runner: `gh run watch <id> --exit-status`. If GHA never schedules, fall back to `bash scripts/ci-local.sh` in a clean `git worktree add /tmp/ff-pr-ci origin/<branch>` and post the result as a PR comment.
3. Merge ONLY after BOTH the blind review APPROVED and CI passed: `gh pr merge <N> --merge --delete-branch`.
4. Branch hygiene: never edit on master. First action of any code-editing task is to create/switch to a non-master branch. If the primary checkout is dirty or shared, create a clean worktree from `origin/master` instead of carrying unrelated changes onto the branch.
5. Pre-push hook is the floor. If `npm run ci:quick` fails locally, fix it — never `--no-verify`.

---

## API & Code Conventions

```typescript
import { apiResponse } from '@/lib/apiResponse';
return apiResponse.success(res, data);
return apiResponse.notFound(res, 'Resource', id);
```

- Name dynamic params for the resource (`[projectId]` for a project ID; `[id]` only when unambiguous) and keep each route subtree consistent.
- Match the router and route shape already used by the module. Nested dynamic routes are valid and widely deployed in this repo; flatten only to fix a demonstrated router or tooling conflict.
- Wait for the API confirmation before showing success toasts.

---

## Path-Scoped Rule Files

Two parallel doc systems exist. Both are real and serve different roles:

| Location | Role | Loading |
|----------|------|---------|
| `src/**/.claude.md` | Quick reference / subtree gotchas (target ≤50 lines) | **Path-scoped** to work under that directory |
| `.claude/modules/<name>.md` | Full reference / deep-dive docs | **Explicit-load** (read it when needed) |

`CLAUDE.md` and files named `.claude.md` are canonical. Their `AGENTS.md` mirrors are generated by `node scripts/mirror-agents-md.mjs`; never hand-edit a mirror. Run `npm run agents:mirror` after changing canonical instructions and `npm run agents:check` to verify them. The generator scans `src/` recursively and mirrors nested docs with at least 10 lines beside subtrees containing at least four source files (tests count); smaller stubs remain Claude-only.

When adding rules, keep path-scoped docs short — push detail into `.claude/modules/<name>.md` so it doesn't bloat every agent session.

| Area | Full doc | Quick reference |
|------|----------|------------------|
| Activate | `.claude/modules/activate.md` | `/activate`, VLM on :8100; current wizard has 12 steps, while legacy unified review/reporting still uses a 10-step mapping |
| WA Monitor | `.claude/modules/wa-monitor.md` | VPS 72.61.197.178, unified bridge :8083; the old sender :8081 is retired |
| QField Sync | `.claude/modules/qfield-sync.md` | Webhook :8095, `/qfield` skill |
| VLM | `.claude/modules/vlm.md` | Qwen3 on :8100, max 1024×768 images |
| Fleet | `.claude/modules/fleet.md` | Vehicle check-in, VLM plate reading |
| Procurement | `.claude/modules/procurement.md` | BOQ, RFQ, PO workflow |
| Git hooks | `.claude/modules/git-hooks.md` | `core.hooksPath` → tracked `scripts/githooks/`; absolute, anchored at the main worktree |

Enumerate current path-scoped docs with `find src -name .claude.md -type f`; enumerate full references with `find .claude/modules -maxdepth 1 -name '*.md' -type f`. `.claude/modules/_index.yaml` is a legacy curated category index, not an exhaustive inventory.

---

## Iterating on This File

When the user corrects an implementation: **first apply the correction, then capture the rule** in:
- `.claude/modules/<area>.md` — if scoped to a module
- This file's "Hard Rules" — if a project-wide non-negotiable
- The active agent's user-memory store — if it is a personal preference / cross-session learning

Don't bury new rules at the bottom — order by priority (hard → medium → reference).

---

## Reference (low priority)

### Directory layout
```
src/{modules,components,services,lib}/
.claude/{modules,skills,knowledge-base}/
pages/api/                    # Pages Router API routes; nested dynamic routes are valid
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
- **Claude Code project skills** (`.claude/skills/`): `/audit`, `/activate`, `/qfield`, `/civil-qa`, `/dr`, plus others — `ls .claude/skills/`
- **Global skills** (`~/.claude/skills/`): `/review`, `/review-team`, `/pr-pipeline`, `/prompting`
- `/sync` and `/deploy` are not skills — deployment is `bash scripts/deploy-local.sh dev|production`

### Knowledge system
`.claude/modules/` (full references) · `.claude/skills/` (Claude Code workflows) · `.claude/knowledge-base/` (deep ref) · `docs/INFRASTRUCTURE.md` (full deploy ops) · `.claude/credentials.local.md` (gitignored secrets)
