# Deployment Workflow Standards

## Professional Deployment Strategy

FibreFlow uses a **dual environment setup** for professional development workflow:

| Environment | URL | Branch | Port | PM2 Process | Purpose |
|-------------|-----|--------|------|-------------|---------|
| **Production** | https://app.fibreflow.app | `master` | 3005 | `fibreflow-prod` | Live production site |
| **Development** | https://dev.fibreflow.app | `develop` | 3006 | `fibreflow-dev` | Testing & QA before production |

## Git Branch Strategy

```
feature/new-feature  →  develop  →  master
     (local)          (dev site)   (production)
```

**CRITICAL**: Always deploy to DEV first, test, then promote to PRODUCTION.

## Complete Deployment Flow

### Step 1: Local Development
```bash
# Create feature branch from develop
git checkout develop
git pull origin develop
git checkout -b feature/my-new-feature

# Develop locally
npm run build
PORT=3005 npm start
# Test at http://localhost:3005
```

### Step 2: Deploy to Development (Testing)
```bash
# Commit and push to develop branch
git add .
git commit -m "feat: description of changes

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"

git checkout develop
git merge feature/my-new-feature
git push origin develop

# Deploy to DEV environment
sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 \
  "cd /var/www/fibreflow-dev && git pull && npm ci && npm run build && pm2 restart fibreflow-dev"

# Test at https://dev.fibreflow.app
```

### Step 3: Test on Development

Verification checklist:
- ✅ Feature works as specified
- ✅ No console errors in browser DevTools
- ✅ API endpoints return correct data
- ✅ Database queries succeed
- ✅ Forms validate properly
- ✅ Error handling shows user-friendly messages
- ✅ Mobile responsive (test in DevTools device toolbar)
- ✅ No PM2 errors: `sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 "pm2 logs fibreflow-dev --lines 50"`

### Step 4: Get User Approval

**CRITICAL**: Do NOT deploy to production without user approval after testing on dev.fibreflow.app.

### Step 5: Deploy to Production (Go Live)
```bash
# Only after dev testing passes!
git checkout master
git merge develop
git push origin master

# Deploy to PRODUCTION
sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 \
  "cd /var/www/fibreflow && git pull && npm ci && npm run build && pm2 restart fibreflow-prod"

# Verify at https://app.fibreflow.app
```

### Step 6: Post-Deployment Verification

```bash
# Check PM2 status
sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 "pm2 list"

# Check logs for errors
sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 "pm2 logs fibreflow-prod --lines 50"

# Test production URL
curl -I https://app.fibreflow.app

# Manual verification:
# - Login works (Clerk)
# - Dashboard loads
# - Key features working
# - No console errors
```

### Step 7: Update Documentation

Required documentation updates:
```bash
# 1. Update CHANGELOG.md
docs/CHANGELOG.md - Add deployment entry with date, feature, changes

# 2. Update page logs (if UI changed)
docs/page-logs/{page-name}.md - Document changes, file:line references, testing

# 3. Update database docs (if schema changed)
docs/DATABASE_TABLES.md - Add new tables, columns, indexes

# 4. Update module README (if module created/modified)
src/modules/{module}/README.md - API contracts, usage examples
```

## VPS Infrastructure

### Server Details
- **Provider**: Hostinger (Lithuania)
- **IP**: 72.60.17.245
- **OS**: Ubuntu 24.04 LTS
- **Node.js**: v20.19.5
- **Process Manager**: PM2 v6.0.13
- **Web Server**: Nginx v1.24.0
- **SSL**: Let's Encrypt (auto-renewal enabled)

### Directory Structure
```
/var/www/
├── fibreflow/          → Production (master branch, port 3005)
├── fibreflow-dev/      → Development (develop branch, port 3006)
└── ecosystem.config.js → PM2 configuration for both processes
```

## Common Deployment Commands

### Quick Deploy to Development
```bash
sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 \
  "cd /var/www/fibreflow-dev && git pull && npm ci && npm run build && pm2 restart fibreflow-dev"
```

### Quick Deploy to Production
```bash
sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 \
  "cd /var/www/fibreflow && git pull && npm ci && npm run build && pm2 restart fibreflow-prod"
```

### Check Service Status
```bash
sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 "pm2 list"
sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 "pm2 logs fibreflow-prod --lines 50"
sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 "systemctl status nginx"
```

### Restart Services
```bash
sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 "pm2 restart fibreflow-prod"
sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 "pm2 restart fibreflow-dev"
sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 "systemctl restart nginx"
```

## Rollback Procedure

If production deployment fails:

```bash
# SSH into VPS
sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245

# Navigate to production directory
cd /var/www/fibreflow

# View recent commits
git log --oneline -10

# Find last working commit
git log --oneline -5

# Reset to previous commit
git reset --hard <commit-hash>

# Rebuild
npm ci
npm run build

# Restart
pm2 restart fibreflow-prod

# Verify
curl -I https://app.fibreflow.app
```

## Pre-Deployment Checklist

Before deploying to production, verify:

- [ ] Changes tested on dev.fibreflow.app successfully
- [ ] User approval obtained
- [ ] All tests passing locally
- [ ] Database migrations tested on development
- [ ] Environment variables configured correctly (if new vars added)
- [ ] No breaking changes to API contracts
- [ ] Dependencies updated in package.json
- [ ] Build succeeds locally: `npm run build`
- [ ] CHANGELOG.md ready to update
- [ ] Page logs ready to update (if UI changed)

## Post-Deployment Checklist

After deployment, verify:

- [ ] `pm2 list` shows process as "online"
- [ ] `pm2 logs` shows no errors in last 50 lines
- [ ] Production URL returns 200: `curl -I https://app.fibreflow.app`
- [ ] User can log in (Clerk authentication)
- [ ] Database connections successful (check logs)
- [ ] Key features working:
  - [ ] Dashboard loads
  - [ ] Navigation works
  - [ ] Forms submit successfully
  - [ ] Data displays correctly
- [ ] No console errors in browser DevTools
- [ ] Mobile responsive (test on phone/DevTools)
- [ ] CHANGELOG.md updated
- [ ] Page logs updated (if UI changed)

## Database Migrations

### Creating Migrations
```bash
# Create migration script
touch scripts/migrations/YYYY-MM-DD-feature-name.ts
```

### Running Migrations
```bash
# Test on development database first
npm run db:migrate

# After testing, run on production (via SSH)
sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 "cd /var/www/fibreflow && npm run db:migrate"
```

### Migration Best Practices
- ✅ Test migrations on development database first
- ✅ Include rollback scripts
- ✅ Document schema changes in docs/DATABASE_TABLES.md
- ✅ Use transactions for data migrations
- ✅ Backup database before major schema changes

## Environment Variables

### Adding New Environment Variables

1. **Add to local .env**
   ```bash
   echo "NEW_VARIABLE=value" >> .env.local
   ```

2. **Add to development VPS**
   ```bash
   sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 "echo 'NEW_VARIABLE=value' >> /var/www/fibreflow-dev/.env.production"
   ```

3. **Add to production VPS** (after dev testing)
   ```bash
   sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 "echo 'NEW_VARIABLE=value' >> /var/www/fibreflow/.env.production"
   ```

4. **Restart processes**
   ```bash
   sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 "cd /var/www/fibreflow-dev && npm run build && pm2 restart fibreflow-dev"
   sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 "cd /var/www/fibreflow && npm run build && pm2 restart fibreflow-prod"
   ```

5. **Document in VPS docs**
   ```bash
   # Update docs/VPS/DEPLOYMENT.md with new environment variable
   ```

## Continuous Integration (Future)

Currently manual deployment. Future improvements:

- [ ] GitHub Actions for automated testing
- [ ] Automated deploy to dev on push to develop branch
- [ ] Manual approval gate for production deployment
- [ ] Automated rollback on failed health checks
- [ ] Slack/email notifications on deployments

## Troubleshooting

### Deployment Fails on `git pull`
```bash
# Stash local changes
sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 "cd /var/www/fibreflow && git stash && git pull"
```

### Build Fails with Memory Error
```bash
# Increase Node.js memory limit
sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 \
  "cd /var/www/fibreflow && NODE_OPTIONS='--max-old-space-size=4096' npm run build"
```

### PM2 Process Not Starting
```bash
# Check logs
sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 "pm2 logs fibreflow-prod --err --lines 50"

# Delete and re-add process
sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 "pm2 delete fibreflow-prod"
sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 "cd /var/www && pm2 start ecosystem.config.js --only fibreflow-prod"
sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 "pm2 save"
```

### 502 Bad Gateway
```bash
# Check if PM2 process running
sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 "pm2 list"

# Restart PM2 process
sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 "pm2 restart fibreflow-prod"

# Restart Nginx
sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 "systemctl restart nginx"
```

## Emergency Procedures

### Critical Production Bug

1. **Immediate Rollback**
   ```bash
   sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 "cd /var/www/fibreflow && git reset --hard HEAD~1 && npm run build && pm2 restart fibreflow-prod"
   ```

2. **Notify User** of rollback and issue

3. **Fix in Development**
   - Fix bug locally
   - Test on dev.fibreflow.app
   - Get user approval
   - Redeploy to production

### VPS Server Down

1. Check Hostinger status: hpanel.hostinger.com
2. Reboot VPS from control panel
3. Verify services restart (PM2 startup configured)
4. If services don't auto-start:
   ```bash
   sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 "pm2 resurrect"
   ```

## Best Practices

### ✅ Always Do
- Deploy to dev.fibreflow.app first (test before production)
- Use `npm ci` instead of `npm install` (reproducible builds)
- Monitor logs after deployment (`pm2 logs --lines 50`)
- Update documentation (CHANGELOG, page logs)
- Get user approval before production deployment
- Test on multiple devices/browsers
- Verify database migrations on dev first

### ❌ Never Do
- Deploy directly to production without dev testing
- Skip user approval for production deployment
- Ignore PM2 error logs
- Deploy without updating documentation
- Run untested database migrations on production
- Use `npm install` (use `npm ci` for reproducibility)
- Deploy late Friday (avoid weekend emergencies)

## Deployment Success Criteria

Deployment is successful when:
- ✅ PM2 process shows "online" status
- ✅ No errors in PM2 logs (last 50 lines)
- ✅ Production URL returns 200 status code
- ✅ Application loads in browser without errors
- ✅ User can log in successfully (Clerk)
- ✅ Key features verified working
- ✅ No console errors in browser DevTools
- ✅ Mobile responsive tested
- ✅ CHANGELOG.md updated
- ✅ Page logs updated (if UI changed)
- ✅ User confirms production deployment successful

## Reference Documentation

- **Complete Guide**: docs/VPS/DEPLOYMENT.md
- **Quick Reference**: docs/VPS/QUICK_REFERENCE.md
- **Deployment History**: docs/VPS/DEPLOYMENT_HISTORY.md
- **PM2 Config**: /var/www/ecosystem.config.js
- **Nginx Config**: /etc/nginx/sites-available/fibreflow
