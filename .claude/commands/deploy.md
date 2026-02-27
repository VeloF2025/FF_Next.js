# Deploy FibreFlow

Environment-aware deployment with time-gating. During business hours (08:00-17:00 SAST Mon-Fri), only dev deploys are allowed. Staging and production are promoted after hours.

## Usage

```
/deploy                    # Deploy to dev (always allowed)
/deploy dev                # Deploy to dev (always allowed)
/deploy staging            # Promote dev → staging (after hours only)
/deploy production         # Promote staging → production (after hours only)
/deploy staging --force    # Emergency override (requires confirmation)
/deploy status             # Show all environments + time gate status
/deploy logs [env]         # View service logs
/deploy rollback [env]     # Rollback to previous backup
```

## Deployment Rules

| Time Window | Dev | Staging | Production |
|-------------|-----|---------|------------|
| **Business hours** (08:00-17:00 SAST, Mon-Fri) | Allowed | BLOCKED | BLOCKED |
| **After hours** + weekends | Allowed | Allowed (promote from dev) | Allowed (promote from staging) |
| **Emergency** (any time) | Allowed | `--force` required | `--force` required |

## Workflow

### During the day: Deploy to dev only

1. Verify clean working directory: `git status`
2. Push changes to origin: `git push origin master`
3. Deploy to dev:
```bash
ssh velo@100.96.203.105 "cd /home/velo/fibreflow-dev && git pull origin master && npm install && npm run build && echo 'velo2026' | sudo -S systemctl restart fibreflow-dev.service"
```
4. Verify: `curl -s -o /dev/null -w "%{http_code}" https://dev.fibreflow.app/sign-in`
5. Test on https://dev.fibreflow.app

### After hours: Promote to staging

1. Check current time — must be after 17:00 SAST or weekend
2. Verify dev is healthy: `curl -s -o /dev/null -w "%{http_code}" https://dev.fibreflow.app/sign-in`
3. Get dev commit: `ssh velo@100.96.203.105 "cd /home/velo/fibreflow-dev && git rev-parse --short HEAD"`
4. Promote exact commit to staging:
```bash
ssh velo@100.96.203.105 "cd /home/velo/fibreflow-staging && git fetch origin && git checkout <COMMIT> && npm install && npm run build && echo 'velo2026' | sudo -S systemctl restart fibreflow.service"
```
5. Verify: `curl -s -o /dev/null -w "%{http_code}" https://vf.fibreflow.app/sign-in`

### After hours: Promote to production

1. Verify staging is healthy first
2. Get staging commit: `ssh velo@100.96.203.105 "cd /home/velo/fibreflow-staging && git rev-parse --short HEAD"`
3. Promote exact commit to production:
```bash
ssh velo@100.96.203.105 "cd /home/velo/fibreflow-production && git fetch origin && git checkout <COMMIT> && npm install && npm run build && echo 'velo2026' | sudo -S systemctl restart fibreflow-production.service"
```
4. Verify: `curl -s -o /dev/null -w "%{http_code}" https://app.fibreflow.app/sign-in`

## Using the scripts (preferred)

The deploy scripts handle all the safety checks automatically:

```bash
# Deploy to dev (always)
bash scripts/deploy-gate.sh dev

# Promote dev → staging (after hours)
bash scripts/promote.sh dev staging

# Promote staging → production (after hours)
bash scripts/promote.sh staging production

# Emergency override
bash scripts/deploy-gate.sh staging --force

# Check all environments
bash scripts/deploy-gate.sh status
```

## Check Status

```bash
ssh velo@100.96.203.105 "echo '=== Dev ===' && cd /home/velo/fibreflow-dev && git log -1 --oneline && systemctl is-active fibreflow-dev && echo '=== Staging ===' && cd /home/velo/fibreflow-staging && git log -1 --oneline && systemctl is-active fibreflow && echo '=== Production ===' && cd /home/velo/fibreflow-production && git log -1 --oneline && systemctl is-active fibreflow-production"
```

## View Logs

```bash
# Dev
ssh velo@100.96.203.105 "echo 'velo2026' | sudo -S journalctl -u fibreflow-dev -n 50"
# Staging
ssh velo@100.96.203.105 "echo 'velo2026' | sudo -S journalctl -u fibreflow -n 50"
# Production
ssh velo@100.96.203.105 "echo 'velo2026' | sudo -S journalctl -u fibreflow-production -n 50"
```

## Rollback

Each deploy keeps 3 backups (`.next-backup-*`). To rollback:

```bash
# List backups
ssh velo@100.96.203.105 "ls -lt /home/velo/fibreflow-production/.next-backup-* | head -3"

# Restore most recent backup (example for production)
ssh velo@100.96.203.105 "cd /home/velo/fibreflow-production && mv .next .next-failed && mv \$(ls -dt .next-backup-* | head -1) .next && echo 'velo2026' | sudo -S systemctl restart fibreflow-production"
```

## CRITICAL RULES

1. **NEVER deploy to staging or production during business hours** unless it's an emergency
2. **Always deploy to dev first** — test there before promoting
3. **Promotions deploy the EXACT commit** from the source environment — no surprises
4. **Emergency overrides require explicit user confirmation** — ask before using `--force`
5. **All environments share the production database** — schema changes affect everyone immediately

## Server Info

| Environment | URL | Port | Service | Directory |
|-------------|-----|------|---------|-----------|
| Dev | https://dev.fibreflow.app | 3005 | fibreflow-dev | /home/velo/fibreflow-dev |
| Staging | https://vf.fibreflow.app | 3006 | fibreflow | /home/velo/fibreflow-staging |
| Production | https://app.fibreflow.app | 3000 | fibreflow-production | /home/velo/fibreflow-production |

## Output Format

### Success
```
===== DEPLOYMENT COMPLETE =====
Environment: [dev/staging/production]
Commit: [hash]
Duration: [X]s
URL: [url]
Status: Live and responding (HTTP 200)
===============================
```

### Blocked
```
===== DEPLOYMENT BLOCKED =====
Environment: [staging/production]
Reason: Business hours (08:00-17:00 SAST)
Action: Deploy to dev now, promote after hours
Override: /deploy [env] --force (emergencies only)
===============================
```
