# FibreFlow Deployment Workflow

**Current as of:** February 2026  
**Process Manager:** systemd  
**Server:** velo-server (local infrastructure)

---

## 🎯 Golden Rule
**ALWAYS deploy to STAGING first → Test → Then deploy to PRODUCTION**

---

## 📋 Quick Reference

### Environments

| Environment | Path | Port | Service | Branch | URL |
|---|---|---|---|---|---|---|
| **Production** | `/home/velo/fibreflow-production` | 3000 | `fibreflow-production` | `master` | app.fibreflow.app |
| **Staging** | `/home/velo/fibreflow-staging` | 3005/3006 | — | varies | vf.fibreflow.app |

### SSH Access
```bash
# From Docker container (agent context)
sshpass -p "velo2026" ssh velo@172.17.0.1 "command"

# From localhost
sshpass -p "velo2026" ssh velo@localhost "command"
```

---

## 🔄 Standard Deployment Pipeline

### 1️⃣ Record Current State (Rollback Lifeline)
```bash
cd /home/velo/fibreflow-production
ROLLBACK_HASH=$(git rev-parse HEAD)
echo "Rollback commit: $ROLLBACK_HASH"
# Save this! You'll need it if rollback is required.
```

### 2️⃣ Pull Latest Code
```bash
cd /home/velo/fibreflow-production
git fetch origin
git pull origin master
```

### 3️⃣ Check for Dependency Changes
```bash
git diff $ROLLBACK_HASH HEAD package.json package-lock.json
```

If `package.json` changed:
```bash
npm install
```

### 4️⃣ Build Application
```bash
npm run build
```

**Build Requirements:**
- Free disk space: >2GB on `/home`
- Free RAM: >2GB (builds OOM at ~3.5GB system RAM usage)

Check resources before building:
```bash
df -h /home
free -h
```

### 5️⃣ Run Database Migrations (if any)
```bash
npm run db:migrate
```

Check migration status:
```bash
npm run db:validate
```

### 6️⃣ Restart Service
```bash
echo 'velo2026' | sudo -S systemctl restart fibreflow-production
```

### 7️⃣ Verify Deployment
```bash
# Wait for service to start
sleep 5

# Check service status
systemctl is-active fibreflow-production

# Check HTTP response
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/

# Check health endpoint
curl -s http://localhost:3000/api/monitoring/health | jq .

# Check for errors in recent logs
journalctl -u fibreflow-production --since "5 min ago" --priority=err --no-pager
```

---

## 🤖 Full Deployment (Single Command - Agent Context)

From Docker container:
```bash
sshpass -p "velo2026" ssh velo@172.17.0.1 "cd /home/velo/fibreflow-production && \
  ROLLBACK_HASH=\$(git rev-parse HEAD) && \
  echo \"Rollback: \$ROLLBACK_HASH\" && \
  git pull origin master && \
  npm install && \
  npm run build && \
  npm run db:migrate && \
  echo 'velo2026' | sudo -S systemctl restart fibreflow-production && \
  sleep 5 && \
  systemctl is-active fibreflow-production && \
  curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/"
```

---

## 🚨 Rollback Procedures

### Quick Rollback
```bash
cd /home/velo/fibreflow-production
git checkout <ROLLBACK_HASH>
npm run build
echo 'velo2026' | sudo -S systemctl restart fibreflow-production
```

### Verify Rollback
```bash
sleep 5
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/
systemctl status fibreflow-production
```

**Rule:** Rollback first, debug later. If production is down, speed matters.

---

## 📊 Monitoring & Troubleshooting

### Check Service Status
```bash
systemctl status fibreflow-production
systemctl is-active fibreflow-production
```

### View Logs
```bash
# Last 50 lines
journalctl -u fibreflow-production -n 50 --no-pager

# Follow logs in real-time
journalctl -u fibreflow-production -f

# Errors only (last 5 minutes)
journalctl -u fibreflow-production --since "5 min ago" --priority=err --no-pager

# Specific time range
journalctl -u fibreflow-production --since "2026-02-14 10:00:00" --until "2026-02-14 11:00:00"
```

### Restart Service
```bash
echo 'velo2026' | sudo -S systemctl restart fibreflow-production
```

### Check System Resources
```bash
# Disk space
df -h /home

# Memory usage
free -h

# Process memory
ps aux | grep node | grep fibreflow-production

# Database connections
npm run check:db-connections
```

---

## 🛠️ Common Issues & Solutions

### Build Fails with OOM
```bash
# Check current memory usage
free -h

# If <2GB free, stop service temporarily
echo 'velo2026' | sudo -S systemctl stop fibreflow-production
npm run build
echo 'velo2026' | sudo -S systemctl start fibreflow-production
```

### Service Won't Start
```bash
# Check for port conflicts
sudo lsof -i :3000

# Check environment variables
systemctl show fibreflow-production --property=Environment

# Check recent errors
journalctl -u fibreflow-production -n 100 --priority=err --no-pager
```

### Database Connection Issues
```bash
# Check connection pool
npm run check:db-connections

# Verify .env.local has DATABASE_URL
cat /home/velo/fibreflow-production/.env.local | grep DATABASE_URL
```

---

## 🔒 Safety Rules

1. ✅ **ALWAYS record the current commit hash before deploying** (your rollback lifeline)
2. ✅ **NEVER run destructive database operations without reading the SQL first**
3. ✅ **NEVER modify `.env.local`** unless explicitly instructed
4. ✅ **NEVER force-push or force-checkout** on production branch
5. ✅ **Rollback first, debug later** if production is down
6. ✅ **Check disk space before builds** (need >2GB free)
7. ✅ **Check memory before builds** (need >2GB free RAM)
8. ✅ **Don't deploy during business hours** (08:00-17:00 SAST) without approval
9. ✅ **Verify after every deploy** (a deploy without QA is incomplete)
10. ✅ **One deploy at a time** (never run concurrent deploys)

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

## 🤖 AI Agent Protocol

When Forge (deployment agent) executes deployments:

1. ✅ Record rollback commit hash
2. ✅ Pull latest code from master
3. ✅ Install dependencies if package.json changed
4. ✅ Build application
5. ✅ Run database migrations
6. ✅ Restart systemd service
7. ✅ Verify deployment (health checks, logs, HTTP status)
8. ✅ Report results to Mission Control
9. ⚠️ Rollback immediately if verification fails

---

## 📚 Related Documentation

- **Root CLAUDE.md** - Agent reference for Forge
- **docs/INFRASTRUCTURE.md** - Server architecture
- **docs/VPS/DEPLOYMENT.md** - Old VPS setup (DEPRECATED)
- **skills/deploy-pipeline.md** - Detailed deployment procedures
- **skills/rollback-procedures.md** - Emergency rollback guide
- **skills/build-troubleshooting.md** - Build failure diagnostics

---

**Last Updated:** 2026-02-14 by Forge (Task #85)
