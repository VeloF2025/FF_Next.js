# Staging Deployment Skill

Deploy and monitor FibreFlow staging environment (vf.fibreflow.app).

## Purpose

Streamline staging deployments by:
1. Providing single-command deployment
2. Automatic tracking and logging
3. Quick monitoring and rollback
4. Integration with Claude Code workflow

## Server Details

| Setting | Value |
|---------|-------|
| **URL** | https://vf.fibreflow.app |
| **Port** | 3006 |
| **SSH** | `ssh hein@100.96.203.105` |
| **Location** | `/home/louis/apps/fibreflow` |
| **Service** | `fibreflow.service` |
| **Logs** | `/var/log/staging-deployments.log` |

## Slash Commands

### `/deploy` or `/deploy-staging`

Deploy to staging environment.

**Usage**:
```
/deploy                    # Deploy current local branch
/deploy feature-branch     # Deploy specific branch
```

**Workflow**:
1. SSH to staging server
2. Create automatic backup branch
3. Pull latest code
4. Install dependencies & build
5. Restart service
6. Verify deployment (HTTP 200)
7. Report summary

### `/deploy status`

Check last deployment status.

**Response Template**:
```
📊 Last Staging Deployment:

Deployer: [user]
Time: [timestamp]
Branch: [branch]
Duration: [seconds]
Result: ✅ Success / ❌ Failed

Commits Deployed:
  [commit hashes and messages]
```

### `/deploy logs`

View recent deployment logs.

### `/deploy rollback`

Rollback to previous version.

**Workflow**:
1. List available backup branches
2. Confirm rollback target
3. Checkout backup branch
4. Rebuild and restart
5. Verify site responding

### `/deploy monitor`

Live monitoring mode for active deployments.

## When to Activate

### Trigger 1: Explicit Deploy Request

**User says**:
- "deploy to staging"
- "push to vf"
- "deploy my changes"
- "update staging"
- "/deploy"

**Automatic Actions**:
1. Confirm branch to deploy
2. Run deploy-staging via SSH
3. Monitor progress
4. Report results

### Trigger 2: Deployment Status Check

**User says**:
- "who deployed last"
- "staging status"
- "is staging working"
- "check vf.fibreflow"

**Automatic Actions**:
1. SSH and run `deployment-monitor last`
2. Check service status
3. Verify HTTP response
4. Report status

### Trigger 3: Staging Issues

**User says**:
- "staging is down"
- "vf not working"
- "staging broken"

**Automatic Actions**:
1. Check service status
2. View recent logs
3. Identify issue
4. Suggest fix or rollback

### Trigger 4: Rollback Request

**User says**:
- "rollback staging"
- "revert deployment"
- "staging was better before"

**Automatic Actions**:
1. List backup branches
2. Confirm target version
3. Execute rollback
4. Verify recovery

## SSH Commands Reference

```bash
# Two users needed:
# - hein (0203): git operations, npm build
# - velo (velo2026): sudo/service restart

# Deploy master (or any branch) - use hein for git/build
sshpass -p '0203' ssh -o StrictHostKeyChecking=no hein@100.96.203.105 "cd /home/louis/apps/fibreflow && git stash --include-untracked && git fetch origin && git checkout master && git pull origin master && npm install && npm run build"

# Restart service - use velo for sudo
sshpass -p 'velo2026' ssh -o StrictHostKeyChecking=no velo@100.96.203.105 "echo 'velo2026' | sudo -S systemctl restart fibreflow.service"

# Check status
sshpass -p '0203' ssh -o StrictHostKeyChecking=no hein@100.96.203.105 "cd /home/louis/apps/fibreflow && echo 'Branch:' && git branch --show-current && echo 'Commit:' && git log -1 --oneline && echo 'Service:' && systemctl is-active fibreflow.service"

# Service logs - use velo for sudo
sshpass -p 'velo2026' ssh -o StrictHostKeyChecking=no velo@100.96.203.105 "echo 'velo2026' | sudo -S journalctl -u fibreflow.service -n 50"

# List stashed changes
sshpass -p '0203' ssh -o StrictHostKeyChecking=no hein@100.96.203.105 "cd /home/louis/apps/fibreflow && git stash list"

# HTTP check
curl -s -o /dev/null -w "%{http_code}" https://vf.fibreflow.app
```

## Deployment Workflow

### Standard Deploy Flow

```
User: "deploy to staging"
  |
  v
Claude: "Deploying current branch to staging..."
  |
  v
SSH: deploy-staging
  |
  +---> Creates backup: auto-backup-YYYYMMDD-HHMMSS
  |
  +---> Pulls latest code
  |
  +---> npm install
  |
  +---> npm run build
  |
  +---> systemctl restart fibreflow.service
  |
  +---> Verify HTTP 200
  |
  v
Claude: "
===== DEPLOYMENT COMPLETE =====
Duration: 45 seconds
Commits: 5
URL: https://vf.fibreflow.app
Status: ✅ Live and responding
==============================
"
```

### Rollback Flow

```
User: "rollback staging"
  |
  v
Claude: "Available backups:"
  - auto-backup-20260115-114500 (1 hour ago)
  - auto-backup-20260115-091200 (4 hours ago)
  |
  v
User: "use the one from 4 hours ago"
  |
  v
SSH: git checkout auto-backup-20260115-091200
     npm install && npm run build
     systemctl restart fibreflow.service
  |
  v
Claude: "Rolled back to auto-backup-20260115-091200"
```

## Response Templates

### Deploy Success
```
✅ Deployment Successful!

Branch: [branch-name]
Commits: [count] new commits
Duration: [seconds]s
Backup: auto-backup-[timestamp]

🌐 https://vf.fibreflow.app is live!
```

### Deploy Failed
```
❌ Deployment Failed

Stage: [build/restart/verify]
Error: [error message]

Backup available: auto-backup-[timestamp]

Actions:
1. View full logs: /deploy logs
2. Rollback: /deploy rollback
3. Fix and retry: /deploy
```

### Status Check
```
📊 Staging Status (vf.fibreflow.app)

Service: ✅ Active
Response: ✅ HTTP 200
Uptime: [duration]

Last Deploy:
  By: [user]
  At: [timestamp]
  Branch: [branch]
```

## Auto-Activation Rules

### DO Automatically:
- ✅ Check status when asked
- ✅ Show logs when requested
- ✅ List backup branches
- ✅ Verify site responding

### ASK First:
- ❓ Deploying to staging
- ❓ Restarting service
- ❓ Rolling back to backup

### DON'T (Production Safety):
- ❌ Deploy to production (different workflow)
- ❌ Delete backup branches
- ❌ Modify server config

## Integration Notes

### Pre-Deploy Checklist

Before deploying, Claude should:
1. Check for uncommitted changes locally
2. Verify branch is pushed to remote
3. Confirm with user on branch name
4. Check no active deployment in progress

### Post-Deploy Verification

After deploying, Claude should:
1. Check HTTP response (200)
2. Verify no console errors (optional)
3. Report deployment summary
4. Log deployment in operations doc

## Troubleshooting

### "Permission denied"
```bash
# Ensure SSH key is set up or use sshpass
sshpass -p 'VeloAdmin2025!' ssh hein@100.96.203.105
```

### "Service won't start"
```bash
ssh hein@100.96.203.105
sudo journalctl -u fibreflow.service -n 100
# Check for build errors
```

### "Site returning 502"
```bash
# Service likely crashed
sudo systemctl status fibreflow.service
sudo systemctl restart fibreflow.service
```

### "Build failed"
```bash
# Check npm/build output
cd /home/louis/apps/fibreflow
npm run build 2>&1 | tail -50
```

## Success Criteria

Skill is successful when:
- ✅ Single command deploys code
- ✅ User knows deployment status immediately
- ✅ Rollbacks are quick and easy
- ✅ All deployments are logged
- ✅ No accidental production deploys

## Status Indicators

- 🚀 Deploying
- ✅ Success/Live
- ❌ Failed/Error
- 📊 Status/Stats
- 🔄 Rollback
- 📋 Logs
- ⏱️ Duration
- 🌐 URL/Site
