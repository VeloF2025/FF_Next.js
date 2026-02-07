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
# - velo ($VELO_SSH_PASSWORD): sudo/service restart

# Deploy master (or any branch) - use hein for git/build
sshpass -p '$HEIN_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no hein@100.96.203.105 "cd /home/louis/apps/fibreflow && git stash --include-untracked && git fetch origin && git checkout master && git pull origin master && npm install && npm run build"

# Restart service - use velo for sudo
sshpass -p '$VELO_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no velo@100.96.203.105 "echo '$VELO_SSH_PASSWORD' | sudo -S systemctl restart fibreflow.service"

# Check status
sshpass -p '$HEIN_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no hein@100.96.203.105 "cd /home/louis/apps/fibreflow && echo 'Branch:' && git branch --show-current && echo 'Commit:' && git log -1 --oneline && echo 'Service:' && systemctl is-active fibreflow.service"

# Service logs - use velo for sudo
sshpass -p '$VELO_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no velo@100.96.203.105 "echo '$VELO_SSH_PASSWORD' | sudo -S journalctl -u fibreflow.service -n 50"

# List stashed changes
sshpass -p '$HEIN_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no hein@100.96.203.105 "cd /home/louis/apps/fibreflow && git stash list"

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

### Quick Diagnosis Command
```bash
# Run this first to diagnose most issues:
sshpass -p '$HEIN_SSH_PASSWORD' ssh hein@100.96.203.105 "cd /home/louis/apps/fibreflow && echo '=== Git ===' && git log -1 --oneline && echo '=== DB Password ===' && grep DATABASE_URL .env.production | grep -o 'npg_[^@]*' && echo '=== Service Dir ===' && grep WorkingDirectory /etc/systemd/system/fibreflow.service && echo '=== Logs ===' && tail -20 /var/log/fibreflow.error.log 2>/dev/null"
```

---

### ISSUE: Database Authentication Failed (500 errors)

**Symptoms:**
- 500 Internal Server Error on API calls
- Log shows: `password authentication failed for user 'neondb_owner'`
- Console shows: `NeonDbError: password authentication failed`

**Root Cause:**
The `.env.production` file has the wrong database password. This happens when:
1. Git pull overwrites with old password from an outdated branch
2. Someone manually edited the file incorrectly

**Correct Password:** `$NEON_DB_PASSWORD`
**Wrong Password:** `npg_aRNLhZc1G2CD` (old/revoked)

**Fix:**
```bash
# Check current password
sshpass -p '$HEIN_SSH_PASSWORD' ssh hein@100.96.203.105 "grep DATABASE_URL /home/louis/apps/fibreflow/.env.production"

# Fix if wrong
sshpass -p '$HEIN_SSH_PASSWORD' ssh hein@100.96.203.105 "sed -i 's/npg_aRNLhZc1G2CD/$NEON_DB_PASSWORD/g' /home/louis/apps/fibreflow/.env.production"

# Restart service
sshpass -p '$VELO_SSH_PASSWORD' ssh velo@100.96.203.105 "echo '$VELO_SSH_PASSWORD' | sudo -S systemctl restart fibreflow.service"
```

**Prevention:**
- The correct password is committed in master branch
- Always deploy from latest master: `git reset --hard origin/master`

---

### ISSUE: Wrong Systemd WorkingDirectory (404 on all routes)

**Symptoms:**
- All API routes return 404
- Site loads but nothing works
- Build ID in response doesn't match `.next/BUILD_ID`

**Root Cause:**
The systemd service is pointing to the wrong directory (e.g., `fibreflow-production` instead of `fibreflow`).

**Diagnosis:**
```bash
sshpass -p '$HEIN_SSH_PASSWORD' ssh hein@100.96.203.105 "grep WorkingDirectory /etc/systemd/system/fibreflow.service"
```

**Expected:** `WorkingDirectory=/home/louis/apps/fibreflow`
**Wrong:** `WorkingDirectory=/home/louis/apps/fibreflow-production`

**Fix:**
```bash
sshpass -p '$VELO_SSH_PASSWORD' ssh velo@100.96.203.105 "echo '$VELO_SSH_PASSWORD' | sudo -S sed -i 's|fibreflow-production|fibreflow|g' /etc/systemd/system/fibreflow.service && sudo systemctl daemon-reload && sudo systemctl restart fibreflow.service"
```

---

### ISSUE: Git Branch Diverged / Old Commit

**Symptoms:**
- Features missing on staging
- Old bugs reappearing
- `.env.production` keeps reverting

**Diagnosis:**
```bash
# Check current commit vs master
sshpass -p '$HEIN_SSH_PASSWORD' ssh hein@100.96.203.105 "cd /home/louis/apps/fibreflow && echo 'Local:' && git log -1 --oneline && echo 'Remote:' && git fetch origin && git log -1 --oneline origin/master"
```

**Fix:**
```bash
# Force reset to origin/master (discards local changes)
sshpass -p '$VELO_SSH_PASSWORD' ssh velo@100.96.203.105 "echo '$VELO_SSH_PASSWORD' | sudo -S bash -c 'chown -R louis:louis /home/louis/apps/fibreflow/.git && su louis -c \"cd /home/louis/apps/fibreflow && git fetch origin && git checkout master && git reset --hard origin/master\"'"

# Then rebuild
sshpass -p '$VELO_SSH_PASSWORD' ssh velo@100.96.203.105 "echo '$VELO_SSH_PASSWORD' | sudo -S bash -c 'su louis -c \"cd /home/louis/apps/fibreflow && npm install && npm run build\"'"

# Restart
sshpass -p '$VELO_SSH_PASSWORD' ssh velo@100.96.203.105 "echo '$VELO_SSH_PASSWORD' | sudo -S systemctl restart fibreflow.service"
```

---

### ISSUE: Git Permission Errors

**Symptoms:**
- `error: cannot open '.git/FETCH_HEAD': Permission denied`
- `insufficient permission for adding an object to repository database`

**Root Cause:**
Mixed file ownership in `.git` directory (some files owned by velo, some by louis).

**Fix:**
```bash
sshpass -p '$VELO_SSH_PASSWORD' ssh velo@100.96.203.105 "echo '$VELO_SSH_PASSWORD' | sudo -S chown -R louis:louis /home/louis/apps/fibreflow/.git"
```

---

### ISSUE: Local Changes Blocking Checkout

**Symptoms:**
- `error: Your local changes to the following files would be overwritten by checkout`

**Fix:**
```bash
# Discard local changes and checkout master
sshpass -p '$VELO_SSH_PASSWORD' ssh velo@100.96.203.105 "echo '$VELO_SSH_PASSWORD' | sudo -S bash -c 'su louis -c \"cd /home/louis/apps/fibreflow && git checkout -- . && git checkout master && git reset --hard origin/master\"'"
```

---

### ISSUE: Service Won't Start / Crashes

**Diagnosis:**
```bash
# Check service status
sshpass -p '$VELO_SSH_PASSWORD' ssh velo@100.96.203.105 "echo '$VELO_SSH_PASSWORD' | sudo -S systemctl status fibreflow.service"

# View logs
sshpass -p '$HEIN_SSH_PASSWORD' ssh hein@100.96.203.105 "tail -50 /var/log/fibreflow.error.log"

# View journald logs
sshpass -p '$VELO_SSH_PASSWORD' ssh velo@100.96.203.105 "echo '$VELO_SSH_PASSWORD' | sudo -S journalctl -u fibreflow.service -n 100"
```

**Common Causes:**
1. Build errors - rebuild with `npm run build`
2. Missing dependencies - run `npm install`
3. Database connection issues - check `.env.production`
4. Port already in use - check with `lsof -i :3006`

---

### ISSUE: VLM Extraction Failed ("fetch failed")

**Symptoms:**
- Data Validation shows "Not extracted" for all VLM fields
- API returns `"error": "fetch failed"` in extraction results
- Power meter, ONT serial, DR number all missing

**Root Cause:**
Missing or incorrect environment variables in `.env.production`:
1. `VLM_API_URL` - Must use `localhost`, not Tailscale IP (100.96.203.105)
2. `NEXT_PUBLIC_APP_URL` - Must match the port (3006 for staging)

**Diagnosis:**
```bash
sshpass -p '$HEIN_SSH_PASSWORD' ssh hein@100.96.203.105 "grep -E 'VLM_API_URL|NEXT_PUBLIC_APP_URL' /home/louis/apps/fibreflow/.env.production"
```

**Expected Values:**
```
VLM_API_URL=http://localhost:8100
NEXT_PUBLIC_APP_URL=http://localhost:3006
```

**Fix:**
```bash
# Add/fix environment variables
sshpass -p '$VELO_SSH_PASSWORD' ssh velo@100.96.203.105 "echo '$VELO_SSH_PASSWORD' | sudo -S bash -c 'cat >> /home/louis/apps/fibreflow/.env.production << EOF
VLM_API_URL=http://localhost:8100
NEXT_PUBLIC_APP_URL=http://localhost:3006
EOF
chown louis:louis /home/louis/apps/fibreflow/.env.production'"

# Restart service
sshpass -p '$VELO_SSH_PASSWORD' ssh velo@100.96.203.105 "echo '$VELO_SSH_PASSWORD' | sudo -S systemctl restart fibreflow.service"
```

**Why localhost?**
- The staging app runs ON the same server as VLM (100.96.203.105)
- Using Tailscale IP causes network issues from within Node.js
- `localhost:8100` is always reachable from the same machine

---

### ISSUE: Site Returning 502 Bad Gateway

**Root Cause:**
Cloudflare tunnel can't reach the service.

**Fix:**
```bash
# Check if service is running
sshpass -p '$VELO_SSH_PASSWORD' ssh velo@100.96.203.105 "systemctl is-active fibreflow.service"

# Restart if not active
sshpass -p '$VELO_SSH_PASSWORD' ssh velo@100.96.203.105 "echo '$VELO_SSH_PASSWORD' | sudo -S systemctl restart fibreflow.service"

# Verify local response
sshpass -p '$HEIN_SSH_PASSWORD' ssh hein@100.96.203.105 "curl -s -o /dev/null -w '%{http_code}' http://localhost:3006"
```

---

### ISSUE: Build Failed

**Diagnosis:**
```bash
sshpass -p '$HEIN_SSH_PASSWORD' ssh hein@100.96.203.105 "cd /home/louis/apps/fibreflow && npm run build 2>&1 | tail -100"
```

**Common Fixes:**
1. TypeScript errors - fix in local repo and push
2. Missing modules - `npm install`
3. Out of memory - check with `free -h`

---

## Quick Recovery Checklist

When staging is broken, run these in order:

```bash
# 1. Check what's wrong
sshpass -p '$HEIN_SSH_PASSWORD' ssh hein@100.96.203.105 "tail -30 /var/log/fibreflow.error.log"

# 2. Fix permissions if needed
sshpass -p '$VELO_SSH_PASSWORD' ssh velo@100.96.203.105 "echo '$VELO_SSH_PASSWORD' | sudo -S chown -R louis:louis /home/louis/apps/fibreflow/.git"

# 3. Reset to master
sshpass -p '$VELO_SSH_PASSWORD' ssh velo@100.96.203.105 "echo '$VELO_SSH_PASSWORD' | sudo -S bash -c 'su louis -c \"cd /home/louis/apps/fibreflow && git fetch origin && git checkout -- . && git reset --hard origin/master\"'"

# 4. Rebuild
sshpass -p '$VELO_SSH_PASSWORD' ssh velo@100.96.203.105 "echo '$VELO_SSH_PASSWORD' | sudo -S bash -c 'su louis -c \"cd /home/louis/apps/fibreflow && npm install && npm run build\"'"

# 5. Restart service
sshpass -p '$VELO_SSH_PASSWORD' ssh velo@100.96.203.105 "echo '$VELO_SSH_PASSWORD' | sudo -S systemctl restart fibreflow.service"

# 6. Verify
curl -s "https://vf.fibreflow.app/api/ticketing/tickets?pageSize=1" | jq -r '.success'
```

---

## Issue Log (Self-Improving)

| Date | Issue | Root Cause | Fix Applied |
|------|-------|------------|-------------|
| 2026-01-16 | 500 errors on all APIs | Wrong DB password in `.env.production` | `sed -i` to fix password |
| 2026-01-16 | 404 on all routes | Systemd pointing to wrong directory | Fixed WorkingDirectory |
| 2026-01-16 | Password kept reverting | Old commit with wrong password | Reset to origin/master |
| 2026-01-16 | Database authentication failed | Wrong DB password in `.env.production` | Updated DATABASE_URL password via sed |
| 2026-01-16 | Git permission denied | Mixed file ownership | `chown -R louis:louis .git` |
| 2026-01-19 | VLM extraction "fetch failed" | Missing `VLM_API_URL` and `NEXT_PUBLIC_APP_URL` | Added env vars to .env.production |

**Add new issues here as they're discovered and fixed.**

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
