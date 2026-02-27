# Deployment Workflow Standards

## Time-Gated Deployment Strategy

FibreFlow uses a **three-environment setup** with time-gated deployments to protect users during business hours.

### Environments

| Environment | URL | Port | Service | Directory |
|-------------|-----|------|---------|-----------|
| **Dev** | https://dev.fibreflow.app | 3005 | `fibreflow-dev.service` | `/home/velo/fibreflow-dev` |
| **Staging** | https://vf.fibreflow.app | 3006 | `fibreflow.service` | `/home/velo/fibreflow-staging` |
| **Production** | https://app.fibreflow.app | 3000 | `fibreflow-production.service` | `/home/velo/fibreflow-production` |
| **Local** | http://localhost:3004 | 3004 | manual | local machine |

**All cloud environments share the production Neon PostgreSQL database.**

### Server

| Detail | Value |
|--------|-------|
| **Host** | Velocity — 100.96.203.105 |
| **SSH** | `ssh velo@100.96.203.105` (SSH key auth, no password needed) |
| **Sudo** | `echo 'velo2026' \| sudo -S <command>` |
| **Process Manager** | systemd (NOT PM2) |
| **Web Server** | Nginx with upstream failover to VPS backup |

## MANDATORY: Time Gate Rules

| Time Window | Dev | Staging | Production |
|-------------|-----|---------|------------|
| **Business hours** (08:00–17:00 SAST, Mon–Fri) | Allowed | **BLOCKED** | **BLOCKED** |
| **After hours** + weekends | Allowed | Promote from dev | Promote from staging |
| **Emergency** (any time) | Allowed | `--force` required | `--force` required |

**Rationale**: People are actively using staging and production during business hours. Breaking these environments causes downtime for the team.

## Git Strategy — Feature Branch Workflow (MANDATORY from 2026-02-27)

```
feature/<name>  →  push branch  →  deploy to dev  →  Hein approves  →  merge to master  →  promote to staging  →  promote to production
```

- **Protected branch**: `master` — NO direct commits, NO `ALLOW_MASTER_PUSH=1`
- **Feature branches**: `feature/<name>`, `fix/<name>`, `refactor/<name>`
- **All new code** goes on a feature branch first
- **Merge to master** ONLY after Hein approves testing on dev
- **No `develop` branch** — dev environment deploys from the feature branch

## Deployment Flow

### Step 1: Local Development
```bash
PORT=3004 npm run dev    # Local development with HMR
npm run lint && npm run type-check  # Quality checks
npm test                            # Run tests
```

### Step 2: Push Feature Branch & Deploy to Dev
```bash
# Create feature branch (if not already on one)
git checkout -b feature/<name>

# Commit and push the feature branch
git add <files>
git commit -m "feat: description"
git push origin feature/<name>

# Deploy feature branch to dev
ssh velo@100.96.203.105 "cd /home/velo/fibreflow-dev && git fetch origin && git checkout feature/<name> && git pull origin feature/<name> && npm install && npm run build && echo 'velo2026' | sudo -S systemctl restart fibreflow-dev.service"

# Verify
curl -s -o /dev/null -w "%{http_code}" https://dev.fibreflow.app/sign-in
# Expected: 200
```

Test thoroughly at https://dev.fibreflow.app

### Step 3: Get Hein's Approval
**CRITICAL**: Do NOT merge to master without Hein's explicit approval after testing on dev.

### Step 4: Merge to Master (After Approval)
```bash
# Merge feature branch to master
git checkout master
git pull origin master
git merge feature/<name>
git push origin master

# Clean up feature branch
git branch -d feature/<name>
git push origin --delete feature/<name>
```

### Step 5: Promote to Staging (After Hours Only)
```bash
# Get the exact commit running on dev (now on master)
DEV_COMMIT=$(ssh velo@100.96.203.105 "cd /home/velo/fibreflow-dev && git rev-parse HEAD")

# Deploy that EXACT commit to staging
ssh velo@100.96.203.105 "cd /home/velo/fibreflow-staging && git fetch origin && git checkout $DEV_COMMIT && npm install && npm run build && echo 'velo2026' | sudo -S systemctl restart fibreflow.service"

# Verify
curl -s -o /dev/null -w "%{http_code}" https://vf.fibreflow.app/sign-in
```

### Step 6: Promote to Production (After Hours Only)
```bash
# Get the exact commit running on staging
STG_COMMIT=$(ssh velo@100.96.203.105 "cd /home/velo/fibreflow-staging && git rev-parse HEAD")

# Deploy that EXACT commit to production
ssh velo@100.96.203.105 "cd /home/velo/fibreflow-production && git fetch origin && git checkout $STG_COMMIT && npm install && npm run build && echo 'velo2026' | sudo -S systemctl restart fibreflow-production.service"

# Verify
curl -s -o /dev/null -w "%{http_code}" https://app.fibreflow.app/sign-in
```

## Deploy Scripts (Preferred)

Use the automated scripts which handle safety checks, time gates, and smoke tests:

```bash
# Deploy to dev (always allowed)
bash scripts/deploy-gate.sh dev

# Promote dev → staging (after hours)
bash scripts/promote.sh dev staging

# Promote staging → production (after hours)
bash scripts/promote.sh staging production

# Emergency override (any time, requires confirmation)
bash scripts/deploy-gate.sh staging --force
bash scripts/promote.sh staging production --force

# Check all environment status
bash scripts/deploy-gate.sh status
```

### Script Pipeline

Each deployment runs this pipeline automatically:
1. **Time gate check** — blocks staging/prod during business hours
2. **Pre-deploy checks** (`pre-deploy-check.sh`) — disk, memory, ports, service state
3. **Atomic build** — backup current `.next`, build new, swap on success
4. **Service restart** — `systemctl restart <service>`
5. **Smoke tests** (`post-deploy-smoke.sh`) — HTTP 200, response time, content validation

## Service Management

```bash
# Check service status
ssh velo@100.96.203.105 "systemctl is-active fibreflow-dev fibreflow fibreflow-production"

# View logs
ssh velo@100.96.203.105 "echo 'velo2026' | sudo -S journalctl -u fibreflow-dev -n 50"
ssh velo@100.96.203.105 "echo 'velo2026' | sudo -S journalctl -u fibreflow -n 50"
ssh velo@100.96.203.105 "echo 'velo2026' | sudo -S journalctl -u fibreflow-production -n 50"

# Restart a service
ssh velo@100.96.203.105 "echo 'velo2026' | sudo -S systemctl restart fibreflow-dev.service"
```

## Rollback

Each deploy keeps 3 build backups (`.next-backup-*`):

```bash
# List backups
ssh velo@100.96.203.105 "ls -lt /home/velo/fibreflow-production/.next-backup-* | head -3"

# Restore most recent backup
ssh velo@100.96.203.105 "cd /home/velo/fibreflow-production && mv .next .next-failed && mv \$(ls -dt .next-backup-* | head -1) .next && echo 'velo2026' | sudo -S systemctl restart fibreflow-production.service"
```

## Health Monitoring

- **Automatic**: 5-minute health check cron (`fibreflow-health-check-v2.sh`)
- **Auto-recovery**: restarts failed services automatically
- **Alerts**: WhatsApp notifications for production failures
- **Nginx failover**: if Velocity is down, traffic auto-routes to VPS backup (72.61.197.178)

## Pre-Deployment Checklist

- [ ] Changes tested locally (`npm run build`)
- [ ] Lint and type-check pass (`npm run lint && npm run type-check`)
- [ ] Changes committed and pushed to feature branch (NOT master)
- [ ] Feature branch deployed to dev.fibreflow.app and tested
- [ ] Hein approved the feature on dev
- [ ] Current time is after 17:00 SAST (for staging/production)
- [ ] User approval obtained (for production)

## Post-Deployment Verification

- [ ] Service is active: `systemctl is-active <service>`
- [ ] No errors in logs: `journalctl -u <service> -n 50`
- [ ] URL returns HTTP 200
- [ ] Sign-in page loads correctly
- [ ] Key features verified working

## Emergency Procedures

### Critical Production Bug

1. **Rollback immediately** using backup (see Rollback section above)
2. **Notify user** of rollback and issue
3. **Fix on dev** — deploy fix to dev, test, then promote after hours

### Emergency Deploy During Business Hours

```bash
# Requires typing "EMERGENCY" to confirm
bash scripts/deploy-gate.sh production --force
```

Only use for critical issues affecting users NOW. Must have explicit user approval.

## Rules for AI Agents

1. **NEVER push directly to master** — all code goes on feature branches first
2. **NEVER use `ALLOW_MASTER_PUSH=1`** — this bypass is banned
3. **NEVER deploy to staging or production during business hours** (08:00–17:00 SAST Mon–Fri) unless the user explicitly requests an emergency override
4. **Always deploy feature branch to dev first** — test there before merging to master
5. **Merge to master ONLY after Hein approves** on dev
6. **Promotions use the EXACT commit** from the source environment
7. **Ask the user before using --force** — never override the time gate autonomously
8. **All environments share the production database** — schema migrations affect everyone immediately
9. **Use systemd** (not PM2) for process management
10. **Use SSH key auth** (not sshpass) — connect as `velo@100.96.203.105`
