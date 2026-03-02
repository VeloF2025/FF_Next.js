# Proactive OpenClaw Agent Fleet — Architecture & Rationale

> **Status:** Live (deployed 2026-02-28)
> **Skill reference:** `.claude/skills/infrastructure/openclaw.md`
> **Fleet briefing:** `~/.openclaw/team-brain/PROACTIVE-FLEET-UPGRADE.md`

## What Is This

OpenClaw is a fleet of 11 AI agents (Claude Code instances) running as systemd user services on Velocity. They handle dev ops, monitoring, QA, documentation, research, and infrastructure for FibreFlow. Mission Control (MC) is the REST API that coordinates them — message passing, agent registry, knowledge base (Qdrant).

Before this upgrade, the fleet was **reactive**: detect crash → restart → alert. Agents worked in silos with no shared memory, no trend awareness, and no ability to learn from past incidents.

This upgrade transforms the fleet to **proactive**: detect trends → predict failures → prevent outages → learn from incidents.

---

## Why This Makes Sense

### Problem 1: 90% of daily-improvement jobs were failing silently

Every agent runs a daily 18:00 "improvement session" — 10 minutes to ship one small enhancement. 9 out of 10 were failing with Write tool errors, meaning the fleet wasn't actually improving.

**Root cause:** Claude Code sandboxes Write/Edit tool calls to the workspace root. Each agent workspace has a `team-brain/` symlink pointing to `/home/hein/.openclaw/team-brain/` — which is outside the sandbox. The Write tool follows the symlink, sees it escapes the sandbox, and blocks the write. Agents had no fallback and just failed.

**Why it wasn't caught:** The cron runner logged the errors in JSONL files under `~/.openclaw/cron/runs/`, but nobody was monitoring those logs. The `consecutiveErrors` counter in `jobs.json` resets on any success, so intermittent failures looked clean.

### Problem 2: No backup verification

A weekly pg_dump backup was documented in CLAUDE.md but the cron job didn't exist. No backup had ever run. Neon's PITR (Point-in-Time Recovery) retention was silently set to 1 day instead of the documented 30 days. If the database was lost, recovery would have been impossible beyond 24 hours.

### Problem 3: No trend awareness

Disk filling up? Memory creeping? Response times degrading? Nobody would know until something broke. There was no time-series data collection, no trend analysis, no anomaly detection. Each outage was a surprise.

### Problem 4: Agents worked in silos

When Sentinel detected a service down, it would alert Gene. Gene would tell Sentinel to restart it. This happened through MC messages with human-speed latency. There was no direct fast path, no shared incident memory, and no way for one agent's discovery to benefit others.

### Problem 5: No institutional memory

The same root causes kept recurring (port conflicts, config drift, duplicate services) but there was no system to track patterns. Each incident was handled as if it were new.

---

## What Was Built

### Layer 1: Fix Critical Gaps

**Sandbox Write Fix**
- All 38 cron job payloads now have `RULES:` at the top of the message — before the task instructions — explicitly banning `~` and `team-brain/` in write paths
- Each payload specifies the exact absolute path to write to (`/home/hein/.openclaw/<agent>/workspace/metrics/`)
- Includes bash `cat >` fallback instruction if Write tool still fails
- Stale `team-brain/metrics/` references cleaned from agent MEMORY.md files (forge had 5, pixel 1, gene 1)
- `metrics/` and `retros/` directories created in all agent workspaces

**Why at the top:** Haiku (the model running most cron jobs) has weaker instruction following than Opus. Instructions at the end of a long message get ignored. Three short numbered rules at the very start are hard to miss.

**Backup System**
- Created `/home/velo/backups/neon/` directory
- Installed velo cron: Sunday 02:00 SAST runs `db-backup.sh`
- Updated `db-backup.sh` to use Docker `postgres:17-alpine` (Neon runs pg17, local pg_dump was v16 — version mismatch causes failures)
- Fixed Neon PITR retention: 1 day → 30 days via Neon API PATCH
- Sentinel runs `backup-health-check.sh` every Monday 08:30 to verify backup age, gzip integrity, file size, and PITR retention

**Why Docker for pg_dump:** Installing `postgresql-client-17` requires root apt access. Docker runs as the current user and pulls `postgres:17-alpine` (5MB image) — same binary, no system package changes, works immediately.

### Layer 2: Metrics & Trend Analysis

**Metrics Collection** (`collect-metrics.sh`)
- Runs every 2 hours during Sentinel's heartbeat
- Captures: disk_pct, mem_pct, load_1m, docker_containers, ff_prod_ms, ff_staging_ms, ff_dev_ms, mc_ms, qfield_ms
- Appends JSONL to `sentinel/workspace/metrics/system-metrics.jsonl`
- Monthly rotation (archive >30 days to .jsonl.gz)

**Trend Analyzer** (`trend-analyzer.sh`)
- Linear regression on 7-day metrics using least-squares slope calculation
- Predictive alerts: disk >90% within 7 days, memory >90% within 3 days, response time increasing >50ms/day
- Generates a "System Forecast" weather report for the morning digest
- Filters out 0ms response times (service cold/down returns 0ms from curl, not a real measurement)

**Anomaly Detector** (`anomaly-detector.sh`)
- Compares current metrics against 7-day rolling average
- Flags deviations >2 standard deviations (moderate) or >3 (high severity)
- Called by trend analyzer as a supplementary check

**Code Quality Sweep** (`code-quality-sweep.sh`)
- Daily scan of production codebase (read-only via `sudo -u velo`)
- Tracks: lint errors, type errors, files >300 lines, console.log count
- Regression alerts when counts increase between runs
- Baseline captured: 537 lint, 5759 type errors, 604 files >300 lines, 41 console.logs

**Why JSONL:** Append-only, one record per line, trivially parseable with Python or jq, no corruption risk from concurrent writes, easy to rotate. Perfect for time-series metrics from shell scripts.

### Layer 3: Cross-Agent Intelligence

**Event Bus** (`mc-event-publish.sh`)
- 13 event topics: service.down, service.degraded, deploy.started, deploy.completed, backup.failed, backup.verified, code.regression, code.improvement, incident.filed, incident.resolved, security.alert, config.drift, cost.anomaly
- Hardcoded subscriber map per topic (e.g., service.down → gene, elon, flow)
- Symlinked into sentinel, flow, forge, gene workspaces
- Best-effort delivery (always exits 0 — events are informational, not transactional)

**Why hardcoded subscribers:** MC doesn't have a native pub/sub system. A shell script with a subscriber map is simple, debuggable, and doesn't require MC API changes. If MC adds pub/sub later, the script becomes a thin wrapper.

**Incident Memory**
- Structured incident template with metadata, timeline, root cause, prevention checklist, pattern tags
- 3 real incidents seeded from recent outages (daily-improvement write failures, 502 nginx crash loop, duplicate WA ack messages)
- Auto-generated INDEX.md with pattern frequency analysis
- Post-incident review process: P0/P1 always file within 48h, blameless culture

**Remediation Fast Path** (`process-remediation-queue.sh`)
- Gene can request Sentinel to restart specific services via MC message: `REMEDIATION: restart <service>`
- Approved list: fibreflow-dev, fibreflow (staging), fibreflow-production, mc-dashboard, mission-control-api
- Forbidden list: whatsapp, openclaw-*, ssh, nginx, postgresql, redis, docker (never auto-restart these)
- Rate limit: max 3 restarts per service per hour
- Pre/post health probes to verify the restart actually helped

**Why an approved list:** Unrestricted auto-restart is dangerous. An agent could restart nginx (taking down all sites), postgresql (corrupting connections), or its own openclaw service (infinite loop). The approved list covers only services that are safe to bounce and commonly need it.

### Layer 4: Learning & Operations

**Maintenance Calendar**
- Full daily/bi-hourly/weekly/monthly operational schedule documented in `team-brain/processes/maintenance-calendar.md`
- Agents know when each job runs and what to expect

**Pattern Frequency Report** (`pattern-frequency-report.sh`)
- Scans incident files for pattern tags
- Flags any tag appearing >2 times in 30 days as a systemic issue needing a structural fix
- Currently clean (all 4 tags at count=1)

**Heartbeat Timeout Tuning**
- Scribe, flow, and pixel were timing out on 44%, 21%, and 20% of heartbeats respectively
- Timeout increased from 120s to 300s for these three agents
- Successful runs typically complete in 43-115s — the 120s limit had no headroom for slow API responses

---

## Key Design Decisions

### 1. Shell scripts over TypeScript/Python services

Every monitoring tool is a standalone bash script. No daemons, no dependencies, no build step. Any agent can run any script with `bash /path/to/script.sh`. This is intentional:
- Agents already have bash access; adding a Python service would mean managing another process
- Shell scripts are transparent — grep, curl, and python3 one-liners are self-documenting
- No import errors, no virtualenv, no package.json — just POSIX
- Easy to test: run the script, see the output

### 2. JSONL for all time-series data

Not a database, not CSV, not JSON arrays. JSONL is:
- Append-only (safe for concurrent writes)
- One record per line (no trailing comma issues)
- Parseable with `python3 -c` in a shell script
- Easy to rotate: `head -n -7 > archive.jsonl.gz && tail -7 > current.jsonl`

### 3. Sandbox rules at the TOP of payloads

Haiku (the model running most cron jobs for cost efficiency) has weaker instruction following than Opus. When the sandbox prohibition was at the bottom of a multi-paragraph payload, agents ignored it and wrote to `team-brain/` from muscle memory (their MEMORY.md files had stale paths). Moving the rules to the first 3 lines of the payload — before the task description — dramatically improves compliance.

### 4. Absolute paths everywhere, no ~ or relative paths

The cron sandbox doesn't reliably expand `~`. Relative paths depend on the working directory, which varies between isolated and attached sessions. Every path in every payload and every script uses `/home/hein/.openclaw/...` — no ambiguity.

### 5. Conservative remediation with an approved list

The remediation queue could restart any service. We chose to whitelist only 5 safe-to-bounce services and explicitly forbid 12 categories of dangerous services. This means some legitimate restart requests will be rejected, but no agent can accidentally take down nginx, postgresql, or docker.

### 6. Event bus is fire-and-forget

Events are informational — they tell other agents "something happened" so they can factor it into their work. They're not transactions. If an event fails to deliver, nothing breaks. This keeps the system simple and avoids cascading failures from a message queue going down.

---

## Verification Results

All tools verified working on 2026-02-28:

| Tool | Result |
|------|--------|
| Trend Analyzer | All green, no warnings, 7+ data points |
| Anomaly Detector | No anomalies (within 2 sigma) |
| Backup Health Check | 8/8 passed (163MB backup, PITR 30d) |
| Code Quality Sweep | Baseline captured (537 lint, 5759 type, 604 >300 lines, 41 console.log) |
| Pattern Frequency Report | No systemic patterns (4 tags, all count=1) |
| Remediation Queue | Empty queue processed cleanly |
| Metrics Collection | 7 data points collected over test runs |

---

## What's Next

The upgrade is live but young. Key things to watch:

1. **Daily improvement jobs (18:00 SAST)** — the sandbox fix needs validation over several days. If agents still fail, their MEMORY.md files may have additional stale paths, or they may be getting paths from other sources (HEARTBEAT.md, MC messages, etc.)

2. **Code quality trend** — the baseline is high (5759 type errors). The value is in the trend, not the absolute number. If it increases, Flow alerts Elon. If it decreases, that's real measurable improvement.

3. **Incident pattern emergence** — with only 3 seeded incidents, the pattern detector has nothing to find yet. As agents file new incidents using the template, recurring root causes will surface.

4. **Backup cron reliability** — the first automated Sunday backup will run on 2026-03-02. The Monday 08:30 health check will verify it. If the Docker image isn't cached, the first run may be slower.
