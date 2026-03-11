# FibreFlow Deployment Workflow

**Current as of:** 11 March 2026
**Process Manager:** systemd
**Server:** velo-server (local infrastructure — Claude runs directly on Velocity)

---

## Golden Rule
**Dev → Production.** Always test on dev first.

> **Staging retired 2026-03-11.** `vf.fibreflow.app` redirects to `app.fibreflow.app`.

---

## Quick Reference

### Environments

| Environment | Path | Port | Service | URL |
|---|---|---|---|---|
| **Production** | `/home/velo/fibreflow-production` | 3000 | `fibreflow-production.service` | app.fibreflow.app |
| **Dev** | `/home/velo/fibreflow-dev` | 3005 | `fibreflow-dev.service` | dev.fibreflow.app |

### Time-Gated Deployment Rules

| Time Window | Dev | Production |
|-------------|-----|------------|
| **Business hours** (08:00-17:00 SAST, Mon-Fri) | Allowed | **BLOCKED** |
| **After hours** + weekends | Allowed | Promote from dev |
| **Emergency** (any time) | Allowed | `--force` required |

**Hein's approval is required for ALL production deployments.**

### Permissions

All deploy dirs are owned by `velo`. Claude/hein uses `sudo -u velo` (passwordless via `/etc/sudoers.d/fibreflow-deploy`).

```bash
# Run commands as velo (no password needed)
sudo -u velo bash -c 'cd /home/velo/fibreflow-dev && git pull origin master'

# Restart services (no password needed)
sudo systemctl restart fibreflow-dev.service
```

---

## Standard Deployment Pipeline

### Step 1: Record Current State (Rollback Lifeline)
```bash
sudo -u velo bash -c 'cd /home/velo/fibreflow-dev && echo "Rollback: $(git rev-parse HEAD)"'
```

### Step 2: Pull Latest Code & Build
```bash
# Dev (always allowed)
sudo -u velo bash -c 'cd /home/velo/fibreflow-dev && git pull origin master && npm run build'

# Production (after hours — promote EXACT commit from dev)
sudo -u velo bash -c 'cd /home/velo/fibreflow-production && git fetch origin && git checkout <COMMIT> && npm install && npm run build'
```

**Build Requirements:**
- Free disk space: >2GB on `/home`
- Free RAM: >2GB (builds OOM at ~3.5GB system RAM usage)

Check resources before building:
```bash
df -h /home
free -h
```

### Step 3: Restart Service
```bash
sudo systemctl restart fibreflow-dev.service          # Dev
sudo systemctl restart fibreflow-production.service    # Production
```

### Step 4: Verify Deployment
```bash
# Check service status
sudo systemctl status fibreflow-dev.service

# Check HTTP response
curl -s -o /dev/null -w "%{http_code}" http://localhost:3005/

# Check for errors in recent logs
journalctl -u fibreflow-dev --since "5 min ago" --priority=err --no-pager
```

---

## Deploy Scripts (Recommended)

Use the time-gated deploy scripts instead of manual commands:

```bash
bash scripts/deploy-gate.sh dev              # Deploy to dev (always allowed)
bash scripts/promote.sh dev production       # Promote dev → production (after hours)
bash scripts/deploy-gate.sh status           # Show all environments
```

---

## Rollback Procedures

### Quick Rollback
```bash
sudo -u velo bash -c 'cd /home/velo/fibreflow-production && git checkout <ROLLBACK_HASH> && npm run build'
sudo systemctl restart fibreflow-production.service
```

### Verify Rollback
```bash
sleep 5
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/
sudo systemctl status fibreflow-production.service
```

**Rule:** Rollback first, debug later. If production is down, speed matters.

---

## Monitoring & Troubleshooting

### Check Service Status
```bash
sudo systemctl status fibreflow-production.service
sudo systemctl status fibreflow-dev.service
```

### View Logs
```bash
# Last 50 lines
journalctl -u fibreflow-production -n 50 --no-pager

# Follow logs in real-time
journalctl -u fibreflow-production -f

# Errors only (last 5 minutes)
journalctl -u fibreflow-production --since "5 min ago" --priority=err --no-pager
```

### Restart Service
```bash
sudo systemctl restart fibreflow-production.service    # No password needed
sudo systemctl restart fibreflow-dev.service           # Dev
```

### Check System Resources
```bash
df -h /home    # Disk space
free -h        # Memory usage
```

---

## Common Issues & Solutions

### Build Fails with OOM
```bash
free -h  # Check memory

# If <2GB free, stop service temporarily
sudo systemctl stop fibreflow-production.service
sudo -u velo bash -c 'cd /home/velo/fibreflow-production && npm run build'
sudo systemctl start fibreflow-production.service
```

### Service Won't Start
```bash
sudo lsof -i :3000                                        # Port conflicts
journalctl -u fibreflow-production -n 100 --priority=err   # Recent errors
```

### Database Connection Issues
```bash
# Verify .env.local has DATABASE_URL
sudo -u velo cat /home/velo/fibreflow-production/.env.local | grep DATABASE_URL
```

---

## Safety Rules

1. **ALWAYS record the current commit hash before deploying** (your rollback lifeline)
2. **NEVER run destructive database operations without reading the SQL first**
3. **NEVER modify `.env.local`** unless explicitly instructed
4. **NEVER force-push or force-checkout** on production branch
5. **Rollback first, debug later** if production is down
6. **Check disk space before builds** (need >2GB free)
7. **Check memory before builds** (need >2GB free RAM)
8. **Don't deploy to production during business hours** (08:00-17:00 SAST) without `--force`
9. **Verify after every deploy** (a deploy without QA is incomplete)
10. **One deploy at a time** (never run concurrent deploys)
11. **Hein's approval required** for all production deployments

---

## 📝 Key npm Scripts

| Script | Purpose |
|---|---|
| `npm run build` | Production build (Next.js) |
| `npm run start` | Start production server (handled by systemd) |
| `npm run dev` | Development server |
| `npm run type-check` | TypeScript check without building |
| `npm run lint` | ESLint check |
| `npm run db:migrate` | Run database migrations |
| `npm run db:validate` | Validate database schema |
| `npm run check:db-connections` | Check connection pool health |
| `npm run test` | Run Vitest unit tests |
| `npm run test:e2e:smoke` | Playwright smoke tests |

---

## AI Agent Protocol

When Claude deploys:

1. Record rollback commit hash
2. Run `sudo -u velo bash -c '...'` for git/npm/build operations
3. Install dependencies if package.json changed
4. Build application
5. Restart systemd service via `sudo systemctl restart ...`
6. Verify deployment (health checks, logs, HTTP status)
7. Rollback immediately if verification fails

---

## Related Documentation

- **CLAUDE.md** — Deploy commands and rules
- **docs/INFRASTRUCTURE.md** — Server architecture and services
- **docs/DEPLOYMENT.md** — Safe deploy scripts (post-incident)
- **scripts/deploy-gate.sh** — Time-gated deploy wrapper
- **scripts/promote.sh** — Promotion pipeline (dev → production)
- **scripts/safe-deploy.sh** — Atomic deploy engine
- `/etc/sudoers.d/fibreflow-deploy` — hein passwordless sudo for deploys

---

**Last Updated:** 2026-02-28
