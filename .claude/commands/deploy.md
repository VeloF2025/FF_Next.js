# Deploy to Staging

Deploy FibreFlow to staging environment (vf.fibreflow.app).

## Usage

```
/deploy              # Deploy current branch (master)
/deploy [branch]     # Deploy specific branch
/deploy status       # Check staging status
/deploy logs         # View service logs
/deploy rollback     # Rollback to backup
```

## Deploy Branch

Two users needed:
- **hein** (0203): git operations, npm build
- **velo** ($VELO_SSH_PASSWORD): sudo/service restart

### Step 1: Build (as hein)
```bash
sshpass -p '$HEIN_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no hein@100.96.203.105 "cd /home/louis/apps/fibreflow && git stash --include-untracked && git fetch origin && git checkout master && git pull origin master && npm install && npm run build"
```

### Step 2: Restart (as velo)
```bash
sshpass -p '$VELO_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no velo@100.96.203.105 "echo '$VELO_SSH_PASSWORD' | sudo -S systemctl restart fibreflow.service"
```

For a different branch, replace `master` with the branch name.

## Check Status

```bash
sshpass -p '$HEIN_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no hein@100.96.203.105 "cd /home/louis/apps/fibreflow && echo 'Branch:' && git branch --show-current && echo 'Commit:' && git log -1 --oneline && echo 'Service:' && systemctl is-active fibreflow.service"
```

Also verify HTTP response:
```bash
curl -s -o /dev/null -w "HTTP: %{http_code}\n" https://vf.fibreflow.app
```

## View Service Logs

```bash
sshpass -p '$VELO_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no velo@100.96.203.105 "echo '$VELO_SSH_PASSWORD' | sudo -S journalctl -u fibreflow.service -n 50"
```

## List Stashed Changes

```bash
sshpass -p '$HEIN_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no hein@100.96.203.105 "cd /home/louis/apps/fibreflow && git stash list"
```

## Rollback

1. List stashed changes (above)
2. Confirm target with user
3. Pop stash and rebuild:
   ```bash
   sshpass -p '$HEIN_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no hein@100.96.203.105 "cd /home/louis/apps/fibreflow && git stash pop && npm install && npm run build"
   sshpass -p '$VELO_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no velo@100.96.203.105 "echo '$VELO_SSH_PASSWORD' | sudo -S systemctl restart fibreflow.service"
   ```

## Output Format

### Success
```
===== DEPLOYMENT COMPLETE =====
Branch: [branch]
Duration: [X]s
Commits: [N]
URL: https://vf.fibreflow.app
Status: Live and responding
==============================
```

### Failure
```
===== DEPLOYMENT FAILED =====
Stage: [build/restart/verify]
Error: [message]
Backup: auto-backup-[timestamp]

Suggested actions:
1. View logs: /deploy logs
2. Rollback: /deploy rollback
==============================
```

## Preflight Checklist

Before deploying, verify:
- [ ] No uncommitted changes
- [ ] Branch pushed to origin
- [ ] Tests passing locally
- [ ] No active deployment

## Server Info

| Setting | Value |
|---------|-------|
| URL | https://vf.fibreflow.app |
| Port | 3006 |
| SSH | hein@100.96.203.105 |
| Location | /home/louis/apps/fibreflow |
| Service | fibreflow.service |
