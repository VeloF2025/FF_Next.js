# Hein's Guide: Automated Staging Deployment (vf.fibreflow.app)

## 🎉 NEW: Automated Deployment with Tracking

We've set up automatic deployment logging and monitoring! All your deployments will now be tracked.

## Quick Deploy (Tracked & Logged)

### Simple One-Command Deploy
```bash
ssh hein@100.96.203.105
deploy-staging                    # Deploys current branch
# OR
deploy-staging your-branch-name   # Deploy specific branch
```

That's it! The script will:
- ✅ Create automatic backup
- ✅ Log who deployed and when
- ✅ Build and restart the app
- ✅ Verify deployment success
- ✅ Send notifications (if configured)

## Monitoring Deployments

### Check Who Deployed Last
```bash
ssh hein@100.96.203.105
deployment-monitor last
```

### Watch Deployments Live
```bash
ssh hein@100.96.203.105
deployment-monitor monitor  # Real-time monitoring
```

### See Deployment Statistics
```bash
ssh hein@100.96.203.105
deployment-monitor stats
```

### View Recent Deployments
```bash
ssh hein@100.96.203.105
deployment-monitor recent
```

## What Gets Tracked Automatically

Every deployment logs:
- **Who**: User who deployed (hein, louis, etc.)
- **When**: Exact timestamp
- **What**: Branch, commits, and changes
- **Result**: Success/failure and duration
- **Where**: All stored in `/var/log/staging-deployments.log`

## Example Output

When you run `deploy-staging`:
```
🚀 Starting deployment to staging...
📦 Creating backup branch: auto-backup-20260115-114500
📥 Pulling latest from current branch...
📊 Deploying 5 new commits
📦 Installing dependencies...
🔨 Building application...
🔄 Restarting service...
✅ Deployment successful! (45s)
🌐 Site responding with HTTP 200

===== DEPLOYMENT SUMMARY =====
Deployer: hein
Duration: 45 seconds
Commits: 5
From: abc1234
To: def5678
Backup: auto-backup-20260115-114500
URL: https://vf.fibreflow.app
==============================
```

## Notifications (Optional)

Set up notifications to alert team of deployments:
```bash
ssh hein@100.96.203.105
sudo setup-deployment-notifications

# Choose:
# 1) Slack webhook
# 2) Discord webhook
# 3) Email
# 4) Log file only
```

## Manual Deploy (Old Way - Still Works)

If you prefer the manual process:
```bash
ssh hein@100.96.203.105
cd /home/louis/apps/fibreflow

# Your usual git commands
git fetch origin
git checkout your-branch

# Build and deploy
npm install
npm run build
echo "$VELO_SSH_PASSWORD" | sudo -S systemctl restart fibreflow.service
```

**Note**: Even manual deployments are tracked via git commits!

## Viewing Logs

### Deployment History
```bash
# All deployment logs
sudo cat /var/log/staging-deployments.log

# Operations markdown (readable format)
cat /home/louis/docs/staging-deployments-operations.md

# Service logs
sudo journalctl -u fibreflow.service -n 50
```

## Rollback If Needed

Every deployment creates automatic backup:
```bash
cd /home/louis/apps/fibreflow
git branch -a | grep backup  # List all backups
git checkout auto-backup-20260115-114500  # Restore specific backup
npm install && npm run build
echo "$VELO_SSH_PASSWORD" | sudo -S systemctl restart fibreflow.service
```

## Benefits of New System

1. **Louis sees everything**: All deployments logged automatically
2. **No blame game**: Clear record of who deployed what
3. **Easy rollback**: Automatic backups before each deploy
4. **Team visibility**: Everyone can check deployment status
5. **Notifications**: Optional alerts when deployments happen

## Server Details

- **URL**: https://vf.fibreflow.app
- **Port**: 3006
- **Location**: `/home/louis/apps/fibreflow`
- **Service**: `fibreflow.service`
- **Logs**: `/var/log/staging-deployments.log`

## Common Commands Reference

```bash
# Deploy
deploy-staging                    # Auto-deploy current branch
deploy-staging feature-branch     # Deploy specific branch

# Monitor
deployment-monitor                # Show menu
deployment-monitor last           # Last deployment
deployment-monitor monitor        # Live monitoring
deployment-monitor stats          # Statistics

# Service
sudo systemctl status fibreflow.service
sudo systemctl restart fibreflow.service
sudo journalctl -u fibreflow.service -f

# Logs
tail -f /var/log/staging-deployments.log
tail -f /var/log/deployment-notifications.log
```

## Need Help?

- **Deployment failing?** Check: `deployment-monitor last`
- **Service issues?** Check: `sudo journalctl -u fibreflow.service`
- **Who broke it?** Check: `deployment-monitor recent`
- **Need rollback?** Use the auto-backup branches

---

Happy deploying! All your deployments are now tracked and Louis will see exactly when and what you deployed. 🚀