# Deploy FibreFlow

Environment-aware deployment with time-gating. During business hours (08:00-17:00 SAST Mon-Fri), only dev deploys are allowed. Production is promoted after hours.

> **Staging retired 2026-03-11.** `vf.fibreflow.app` redirects to `app.fibreflow.app`. Only dev + production remain.

## Usage

```
/deploy                    # Deploy to dev (always allowed)
/deploy dev                # Deploy to dev (always allowed)
/deploy production         # Promote dev → production (after hours only)
/deploy production --force # Emergency override (requires confirmation)
/deploy status             # Show all environments + time gate status
/deploy logs [env]         # View service logs
/deploy rollback [env]     # Rollback to previous backup
```

## Deployment Rules

**Hein's approval is required for ALL production deployments. Never deploy to production without his explicit go-ahead.**

| Time Window | Dev | Production |
|-------------|-----|------------|
| **Business hours** (08:00-17:00 SAST, Mon-Fri) | Allowed | BLOCKED |
| **After hours** + weekends (with Hein's approval) | Allowed | Promote from dev |
| **Emergency** (any time, Hein must confirm) | Allowed | `--force` required |

## Workflow

### During the day: Deploy to dev only

1. Verify clean working directory: `git status`
2. Push changes to origin: `git push origin master`
3. Deploy to dev (one command — handles ownership, clean build, retry, health check):
```bash
bash scripts/deploy-local.sh dev
```
4. Test on https://dev.fibreflow.app

**Note:** `deploy-local.sh` handles everything automatically:
- Fixes `.next` ownership (prevents EACCES from mixed user builds)
- Cleans stale `.next` artifacts before building
- Retries build up to 3 times (handles Next.js race condition)
- Stops service before build, restarts after
- Runs HTTP health check on completion
- Keeps last 3 build backups for rollback

### After hours: Promote to production (requires Hein's approval)

1. **Get Hein's explicit approval before proceeding**
2. Check current time — must be after 17:00 SAST or weekend
3. Verify dev is healthy: `curl -s -o /dev/null -w "%{http_code}" https://dev.fibreflow.app/sign-in`
4. Get dev commit: `sudo -u velo bash -c 'cd /home/velo/fibreflow-dev && git rev-parse --short HEAD'`
5. Promote exact commit to production:
```bash
sudo -u velo bash -c 'cd /home/velo/fibreflow-production && git fetch origin && git checkout <COMMIT> && npm install && npm run build'
sudo systemctl restart fibreflow-production.service
```
6. Verify: `curl -s -o /dev/null -w "%{http_code}" https://app.fibreflow.app/sign-in`

## Using the scripts (preferred)

**Primary method — `deploy-local.sh`** (one command, handles everything):
```bash
# Deploy to dev (always)
bash scripts/deploy-local.sh dev

# Deploy to production (after hours, requires Hein's approval)
bash scripts/deploy-local.sh production

# Emergency override
bash scripts/deploy-local.sh production --force

# Check all environments
bash scripts/deploy-local.sh status
```

**Promotion script** (for deploying exact commits between environments):
```bash
# Promote dev → production (after hours)
bash scripts/promote.sh dev production
```

**Legacy** — `deploy-gate.sh` now auto-redirects to `deploy-local.sh` when on Velocity.

## Check Status

```bash
echo '=== Dev ===' && sudo -u velo bash -c 'cd /home/velo/fibreflow-dev && git log -1 --oneline' && systemctl is-active fibreflow-dev
echo '=== Production ===' && sudo -u velo bash -c 'cd /home/velo/fibreflow-production && git log -1 --oneline' && systemctl is-active fibreflow-production
```

## View Logs

```bash
# Dev
journalctl -u fibreflow-dev -n 50 --no-pager
# Production
journalctl -u fibreflow-production -n 50 --no-pager
```

## Rollback

Each deploy keeps 3 backups (`.next-backup-*`). To rollback:

```bash
# List backups
ls -lt /home/velo/fibreflow-production/.next-backup-* | head -3

# Restore most recent backup (example for production)
sudo -u velo bash -c 'cd /home/velo/fibreflow-production && mv .next .next-failed && mv $(ls -dt .next-backup-* | head -1) .next'
sudo systemctl restart fibreflow-production.service
```

## CRITICAL RULES

1. **Run `npm run ci:quick` before deploying** — lint gates are enforced by `deploy-local.sh` (blocks if lint regresses)
2. **NEVER deploy to production during business hours** unless it's an emergency
3. **Always deploy to dev first** — test there before promoting
4. **Promotions deploy the EXACT commit** from the source environment — no surprises
5. **Emergency overrides require explicit user confirmation** — ask before using `--force`
5. **All environments share the production database** — schema changes affect everyone immediately

## Server Info

| Environment | URL | Port | Service | Directory |
|-------------|-----|------|---------|-----------|
| Dev | https://dev.fibreflow.app | 3005 | fibreflow-dev | /home/velo/fibreflow-dev |
| Production | https://app.fibreflow.app | 3000 | fibreflow-production | /home/velo/fibreflow-production |

## Output Format

### Success
```
===== DEPLOYMENT COMPLETE =====
Environment: [dev/production]
Commit: [hash]
Duration: [X]s
URL: [url]
Status: Live and responding (HTTP 200)
===============================
```

### Blocked
```
===== DEPLOYMENT BLOCKED =====
Environment: [production]
Reason: Business hours (08:00-17:00 SAST)
Action: Deploy to dev now, promote after hours
Override: /deploy [env] --force (emergencies only)
===============================
```
