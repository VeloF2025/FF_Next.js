---
name: openclaw
description: OpenClaw Agent Fleet & Mission Control — diagnostics, cron management, MC messaging, proactive monitoring, fleet maintenance
version: 1.0.0
triggers:
  - /openclaw
  - /mc
  - /fleet
  - openclaw
  - mission control
  - agent fleet
  - cron jobs
  - fleet status
  - agent status
  - daily improvement
  - heartbeat check
  - trend analysis
  - backup health
  - code quality sweep
  - anomaly detector
  - remediation queue
---

# /openclaw — OpenClaw Agent Fleet & Mission Control

Manages the OpenClaw AI agent fleet (11 agents) running on Velocity, coordinated through Mission Control (MC) API.

## Quick Reference

| Item | Value |
|------|-------|
| **MC API** | `http://localhost:4000` |
| **MC API Key** | See `~/.openclaw/sentinel/workspace/.env` (`MC_API_KEY`) |
| **MC Dashboard** | `http://localhost:4000` (web UI) |
| **MC Database** | PostgreSQL on `:5434` |
| **Qdrant (KB)** | `http://localhost:6333` |
| **Cron Config** | `/home/hein/.openclaw/cron/jobs.json` |
| **Cron Run Logs** | `/home/hein/.openclaw/cron/runs/<job-id>.jsonl` |
| **Team Brain** | `/home/hein/.openclaw/team-brain/` (shared knowledge) |
| **Elon Workspace** | `/home/hein/.openclaw/workspace/` |
| **Agent Workspaces** | `/home/hein/.openclaw/<agent>/workspace/` |

## Agent Fleet

| Agent | Service | Role | Heartbeat |
|-------|---------|------|-----------|
| **elon** | `openclaw-gateway.service` | CTO — orchestration, deep work, task dispatch | — |
| **sentinel** | `openclaw-sentinel.service` | DevOps — monitoring, alerts, backup health | 2h |
| **flow** | `openclaw-flow.service` | App Dev — FibreFlow code, deploys, code quality | 2h |
| **forge** | `openclaw-forge.service` | DevOps tooling — deploy scripts, CI/CD | 2h |
| **gene** | `openclaw-gene.service` | VP Ops — escalation, cost tracking, remediation | 2h |
| **pixel** | `openclaw-pixel.service` | UI/UX — screenshots, visual QA | 4h |
| **qfield** | `openclaw-qfield.service` | QField — GPKG sync, MinIO, field data | 2h |
| **scribe** | `openclaw-scribe.service` | Docs — changelogs, knowledge base, writing | 4h |
| **atlas** | `openclaw-atlas.service` | CIO — research, tech scanning, intelligence | — |
| **relay** | — | WA Monitor relay (no gateway service) | — |
| **main** | — | Core system jobs (security, health, youtube) | — |

## Service Management

```bash
# List all agent services
systemctl --user list-units 'openclaw*' --no-pager

# Check specific agent
systemctl --user status openclaw-sentinel.service

# Restart an agent
systemctl --user restart openclaw-flow.service

# View agent logs
journalctl --user -u openclaw-sentinel.service -f
journalctl --user -u openclaw-sentinel.service -n 50
```

## MC API Usage

All MC API calls require the Authorization header:
```bash
MC_KEY=$(grep MC_API_KEY /home/hein/.openclaw/sentinel/workspace/.env | cut -d= -f2)
```

### Send Message to Agent
```bash
curl -s -X POST http://localhost:4000/messages \
  -H "Authorization: Bearer $MC_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "from_agent": "hein",
    "to_agent": "sentinel",
    "type": "message",
    "payload": {"message": "Run backup health check now."}
  }'
```

### Broadcast to All Agents
```bash
for agent in sentinel flow forge gene pixel qfield scribe atlas elon; do
  curl -s -X POST http://localhost:4000/messages \
    -H "Authorization: Bearer $MC_KEY" \
    -H "Content-Type: application/json" \
    -d "{
      \"from_agent\": \"hein\",
      \"to_agent\": \"$agent\",
      \"type\": \"message\",
      \"payload\": {\"message\": \"Your message here\"}
    }"
done
```

### Read Agent Inbox
```bash
# All unread messages for an agent
curl -s -H "Authorization: Bearer $MC_KEY" \
  "http://localhost:4000/messages?to_agent=sentinel&unread=true"

# All messages
curl -s -H "Authorization: Bearer $MC_KEY" \
  "http://localhost:4000/messages?to_agent=sentinel"
```

### List Registered Agents
```bash
curl -s -H "Authorization: Bearer $MC_KEY" http://localhost:4000/agents
```

## Cron Job Management

### View All Jobs
```bash
python3 -c "
import json
with open('/home/hein/.openclaw/cron/jobs.json') as f:
    data = json.load(f)
for j in sorted(data['jobs'], key=lambda x: x.get('agentId','')):
    agent = j.get('agentId','')
    name = j.get('name','')
    enabled = j.get('enabled', True)
    state = j.get('state', {})
    status = state.get('lastStatus', 'n/a')
    errs = state.get('consecutiveErrors', 0)
    icon = 'OK' if enabled and errs == 0 else 'ERR' if errs > 0 else 'OFF'
    print(f'{icon:3s} {agent:12s} | {name:40s} | errs={errs}')
"
```

### Check Job Run History
```bash
# Find job ID first
python3 -c "
import json
with open('/home/hein/.openclaw/cron/jobs.json') as f:
    data = json.load(f)
for j in data['jobs']:
    if 'SEARCH_TERM' in j.get('name','').lower():
        print(f\"{j['id']} — {j['agentId']}/{j['name']}\")
"

# Then check run log
python3 -c "
import json
from datetime import datetime
with open('/home/hein/.openclaw/cron/runs/JOB_ID.jsonl') as f:
    for line in f:
        e = json.loads(line.strip())
        ts = datetime.fromtimestamp(e['ts']/1000).strftime('%m-%d %H:%M')
        status = e.get('status','?')
        err = str(e.get('error',''))[:80]
        print(f'{ts} | {status:7s} | {err}')
"
```

### Edit Job Payload
```bash
python3 << 'PYEOF'
import json
with open('/home/hein/.openclaw/cron/jobs.json') as f:
    data = json.load(f)
for j in data['jobs']:
    if j.get('name','') == 'JOB_NAME':
        # Edit payload
        j['payload']['message'] = 'New message here'
        # Or change timeout
        j['payload']['timeoutSeconds'] = 300
        # Or enable/disable
        j['enabled'] = True
        break
with open('/home/hein/.openclaw/cron/jobs.json', 'w') as f:
    json.dump(data, f, indent=2)
PYEOF
```

## Proactive Monitoring Scripts

All scripts run from their agent workspace and require no arguments.

### Sentinel Scripts
| Script | Purpose | Schedule |
|--------|---------|----------|
| `collect-metrics.sh` | System metrics (disk, mem, load, response times) → JSONL | Every 2h (heartbeat) |
| `trend-analyzer.sh` | Linear regression on 7-day metrics, weather forecast | Daily 06:00 |
| `anomaly-detector.sh` | 2-sigma deviation detector against 7-day rolling avg | Called by trend-analyzer |
| `backup-health-check.sh` | Verify Sunday pg_dump + Neon PITR retention | Monday 08:30 |
| `pattern-frequency-report.sh` | Scan incidents for recurring patterns (>2x/30d) | Weekly |
| `process-remediation-queue.sh` | Gene→Sentinel restart requests (approved list only) | Every heartbeat |
| `systemd-service-health.sh` | Check all FibreFlow + MC services | Every heartbeat |

### Flow Scripts
| Script | Purpose | Schedule |
|--------|---------|----------|
| `code-quality-sweep.sh` | Lint, type errors, file lengths, console.log count | Daily 06:30 |

### Cross-Agent
| Script | Purpose | Location |
|--------|---------|----------|
| `mc-event-publish.sh` | Pub/sub event bus (13 topics) | Symlinked in sentinel, flow, forge, gene |
| `incident-index-update.sh` | Generate incidents INDEX.md with pattern frequency | Elon workspace |

### Run Manually
```bash
# Metrics collection
bash /home/hein/.openclaw/sentinel/workspace/scripts/collect-metrics.sh

# Trend analysis (needs 7+ data points)
bash /home/hein/.openclaw/sentinel/workspace/scripts/trend-analyzer.sh

# Anomaly detection
bash /home/hein/.openclaw/sentinel/workspace/scripts/anomaly-detector.sh

# Backup health
bash /home/hein/.openclaw/sentinel/workspace/scripts/backup-health-check.sh

# Code quality
bash /home/hein/.openclaw/flow/workspace/scripts/code-quality-sweep.sh

# Pattern frequency
bash /home/hein/.openclaw/sentinel/workspace/scripts/pattern-frequency-report.sh

# Remediation queue
bash /home/hein/.openclaw/sentinel/workspace/scripts/process-remediation-queue.sh
```

## Cron Schedule Overview

| Time (SAST) | Job | Agent |
|-------------|-----|-------|
| 06:00 daily | Trend analysis + anomaly detection | sentinel |
| 06:00 daily | MD health check | main |
| 06:30 daily | Code quality sweep | flow |
| 07:00 daily | YouTube monitor | main |
| 07:00 daily | Server health report | main |
| 07:00-17:00 (odd hours, Mon-Sat) | QField autonomous monitor | qfield |
| 07:00-17:00 (odd hours, Mon-Sat) | WA relay monitor | relay |
| 08:00 daily | Atlas morning brief | atlas |
| 08:00 daily | Sentinel morning digest | sentinel |
| 08:30 Monday | Backup health check | sentinel |
| 09:00 Monday | Weekly security audit | main |
| 09:00 Monday | Fleet self-audit | atlas |
| 10:00 Sunday | Weekly deep sessions (all agents) | all |
| 17:00 daily | Sentinel evening digest | sentinel |
| 18:00 daily | Daily improvement (all agents) | all |
| Every 2h | Heartbeats (sentinel, flow, forge, gene, qfield) | varies |
| Every 4h | Heartbeats (pixel, scribe) | varies |
| Every 30min | Token budget monitor | atlas |

## Metrics & Data Locations

| Data | Path | Format |
|------|------|--------|
| System metrics | `sentinel/workspace/metrics/system-metrics.jsonl` | JSONL (disk, mem, load, response times) |
| Code quality | `flow/workspace/metrics/code-quality.jsonl` | JSONL (lint, types, file lengths, console.log) |
| Remediation log | `sentinel/workspace/metrics/remediation-log.jsonl` | JSONL (restart requests) |
| Agent pulse | `team-brain/metrics/agent-pulse.jsonl` | JSONL (heartbeat records) |
| Incidents | `team-brain/incidents/*.md` | Markdown (structured template) |
| Incident index | `team-brain/incidents/INDEX.md` | Markdown (auto-generated) |

All paths relative to `/home/hein/.openclaw/`.

## Known Issues & Workarounds

### Sandbox Symlink Traversal (P0 — Fixed)
**Problem:** Claude Code's Write/Edit tools block writes through symlinks that escape the workspace sandbox root. The `team-brain/` symlink in agent workspaces points to `/home/hein/.openclaw/team-brain/` which is outside the sandbox.
**Fix:** All cron payloads now have `RULES:` at the top banning `~` and `team-brain/` in write paths. Agents write to their own `workspace/metrics/` directory instead.
**If it recurs:** Check the agent's MEMORY.md for stale `team-brain/metrics/` paths and replace with `metrics/`.

### Rate Limits (Transient)
**Symptom:** `Error: All models failed — API rate limit reached`
**Cause:** Too many concurrent agent sessions hitting Anthropic API.
**Fix:** Self-resolves. Reduce heartbeat frequency if persistent.

### Heartbeat Timeouts
**Symptom:** `cron: job execution timed out`
**Fix:** Increase `payload.timeoutSeconds` in jobs.json. Current defaults:
- sentinel, flow, forge, gene, qfield: 120s
- scribe, pixel: 300s (increased due to frequent timeouts)

## Standards & Processes

| Document | Path |
|----------|------|
| Event routing (13 topics) | `team-brain/standards/event-routing.md` |
| Incident template | `team-brain/standards/incident-template.md` |
| Post-incident review | `team-brain/standards/post-incident-review.md` |
| Maintenance calendar | `team-brain/processes/maintenance-calendar.md` |
| Fleet upgrade briefing | `team-brain/PROACTIVE-FLEET-UPGRADE.md` |
| Sentinel guardrails | `sentinel/workspace/GUARDRAILS.md` |

All paths relative to `/home/hein/.openclaw/`.

## Diagnostics Playbook

### Fleet Health Check (Quick)
```bash
# 1. Services running?
systemctl --user list-units 'openclaw*' --no-pager

# 2. MC API up?
curl -s http://localhost:4000/health

# 3. Any cron errors?
python3 -c "
import json
with open('/home/hein/.openclaw/cron/jobs.json') as f:
    data = json.load(f)
errs = [(j['agentId'], j['name'], j['state']['consecutiveErrors'])
        for j in data['jobs']
        if j.get('state',{}).get('consecutiveErrors',0) > 0]
if errs:
    for a,n,e in errs: print(f'ERR {a}/{n}: {e} consecutive errors')
else:
    print('All cron jobs clean.')
"

# 4. Run proactive checks
bash /home/hein/.openclaw/sentinel/workspace/scripts/trend-analyzer.sh
bash /home/hein/.openclaw/sentinel/workspace/scripts/anomaly-detector.sh
bash /home/hein/.openclaw/sentinel/workspace/scripts/backup-health-check.sh
bash /home/hein/.openclaw/flow/workspace/scripts/code-quality-sweep.sh
```

### Daily Improvement Failures
```bash
# Check which jobs failed
python3 -c "
import json, os
from datetime import datetime
with open('/home/hein/.openclaw/cron/jobs.json') as f:
    data = json.load(f)
for j in data['jobs']:
    if 'improv' not in j.get('name','').lower(): continue
    jid = j['id']
    agent = j['agentId']
    rf = f'/home/hein/.openclaw/cron/runs/{jid}.jsonl'
    if not os.path.exists(rf): continue
    with open(rf) as f:
        lines = f.readlines()
    last = json.loads(lines[-1].strip())
    ts = datetime.fromtimestamp(last['ts']/1000).strftime('%m-%d %H:%M')
    status = last.get('status','?')
    err = str(last.get('error',''))[:80]
    icon = 'OK' if status == 'ok' else 'FAIL'
    print(f'{icon} {agent:12s} | {ts} | {err}')
"
```

### Agent Not Responding
```bash
# 1. Check service
systemctl --user status openclaw-AGENT.service

# 2. Check MC inbox for errors
MC_KEY=$(grep MC_API_KEY /home/hein/.openclaw/sentinel/workspace/.env | cut -d= -f2)
curl -s -H "Authorization: Bearer $MC_KEY" \
  "http://localhost:4000/messages?to_agent=AGENT&unread=true" | python3 -m json.tool | head -30

# 3. Restart
systemctl --user restart openclaw-AGENT.service
```

## Related

- `.claude/modules/wa-monitor.md` — WA Monitor module
- `.claude/skills/infrastructure/whatsapp.md` — WhatsApp infrastructure
- `.claude/skills/db.md` — Database operations (Neon backups)
- `/deploy` skill — FibreFlow deployment

## Version History

| Date | Change |
|------|--------|
| Mar 2, 2026 | Initial skill — fleet overview, MC API, cron management, proactive monitoring |
