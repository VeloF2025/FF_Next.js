# VPS Deployment Documentation

**Date:** November 3, 2025
**Server:** Lithuania VPS (srv1092611.hstgr.cloud)
**Domain:** https://app.fibreflow.app

---

## Server Information

### VPS Details
- **Provider:** Hostinger
- **Location:** Lithuania - Vilnius
- **IP Address:** 72.60.17.245
- **Hostname:** srv1092611.hstgr.cloud
- **Plan:** KVM 2
- **Expiration:** 2026-10-31
- **Specs:**
  - CPU: 2 cores
  - Memory: 8 GB
  - Disk: 100 GB (12 GB used)
  - Bandwidth: 8 TB

### OS & Software
- **OS:** Ubuntu 24.04 LTS
- **Node.js:** v20.19.5
- **npm:** Installed
- **PM2:** v6.0.13 (God Daemon)
- **Nginx:** v1.24.0
- **Certbot:** Installed (Let's Encrypt)

### SSH Access
```bash
ssh root@72.60.17.245
# Password: $VPS_SSH_PASSWORD
```

---

## Deployment Architecture

### Stack
```
Internet (HTTPS)
    ↓
Cloudflare/DNS (app.fibreflow.app → 72.60.17.245)
    ↓
Nginx (Port 80/443)
    ↓
Reverse Proxy
    ↓
PM2 Process Manager
    ↓
Next.js App (Port 3005)
    ↓
Neon PostgreSQL (Cloud)
```

### Directory Structure
```
/var/www/fibreflow/          # Application root
├── .next/                   # Built Next.js app
├── public/                  # Static assets
├── src/                     # Source code
├── pages/                   # Next.js pages
├── .env.production          # Production environment variables
├── package.json             # Dependencies
├── next.config.js           # Next.js configuration
└── ecosystem.config.js      # PM2 configuration
```

---

## DNS Configuration

### Current Setup (Hostinger DNS)

| Type  | Host | Value | TTL |
|-------|------|-------|-----|
| A | app | 72.60.17.245 | 1200 |
| CNAME | www | cname.vercel-dns.com | 1200 |
| A | @ | 216.150.1.1 | 1200 |

**Result:**
- `www.fibreflow.app` → Vercel (existing production)
- `app.fibreflow.app` → VPS (new deployment)

---

## Application Configuration

### Environment Variables
Location: `/var/www/fibreflow/.env.production`

**Key Variables:**
```bash
# Database
DATABASE_URL=postgresql://neondb_owner:$NEON_DB_PASSWORD_OLD@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require&channel_binding=require

# App
NEXT_PUBLIC_APP_URL=https://app.fibreflow.app
NEXT_PUBLIC_API_URL=https://app.fibreflow.app/api
NODE_ENV=production

# Demo Mode (Clerk Auth Bypassed)
DEMO_MODE=true
AUTH_BYPASS=true

# Firebase Storage (for file uploads)
NEXT_PUBLIC_FIREBASE_API_KEY=AIzaSyDaifRDsiYn9anSrWlznHZiWdiLPvk4abY
NEXT_PUBLIC_FIREBASE_PROJECT_ID=fibreflow-app
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=fibreflow-app.firebasestorage.app

# Convex
CONVEX_DEPLOYMENT=dev:kindred-cassowary-768
NEXT_PUBLIC_CONVEX_URL=https://kindred-cassowary-768.convex.cloud
```

### PM2 Configuration
Location: `/var/www/fibreflow/ecosystem.config.js`

```javascript
module.exports = {
  apps: [{
    name: 'fibreflow',
    script: 'node_modules/next/dist/bin/next',
    args: 'start -p 3005',
    cwd: '/var/www/fibreflow',
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production',
      PORT: 3005
    },
    error_file: '/var/log/pm2/fibreflow-error.log',
    out_file: '/var/log/pm2/fibreflow-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z'
  }]
};
```

### Nginx Configuration
Location: `/etc/nginx/sites-available/fibreflow`

```nginx
server {
    server_name app.fibreflow.app;

    location / {
        proxy_pass http://localhost:3005;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;

        # Timeouts
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    # Logs
    access_log /var/log/nginx/fibreflow-access.log;
    error_log /var/log/nginx/fibreflow-error.log;

    listen 443 ssl; # managed by Certbot
    ssl_certificate /etc/letsencrypt/live/app.fibreflow.app/fullchain.pem; # managed by Certbot
    ssl_certificate_key /etc/letsencrypt/live/app.fibreflow.app/privkey.pem; # managed by Certbot
    include /etc/letsencrypt/options-ssl-nginx.conf; # managed by Certbot
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem; # managed by Certbot
}

server {
    if ($host = app.fibreflow.app) {
        return 301 https://$host$request_uri;
    } # managed by Certbot

    listen 80;
    listen [::]:80;
    server_name app.fibreflow.app;
    return 404; # managed by Certbot
}
```

### SSL Certificate
- **Provider:** Let's Encrypt (Certbot)
- **Certificate:** `/etc/letsencrypt/live/app.fibreflow.app/fullchain.pem`
- **Private Key:** `/etc/letsencrypt/live/app.fibreflow.app/privkey.pem`
- **Expires:** February 1, 2026
- **Auto-Renewal:** Enabled (Certbot scheduled task)

---

## Management Commands

### SSH Access
```bash
# Connect to server
ssh root@72.60.17.245

# Copy files to server
scp file.txt root@72.60.17.245:/path/
rsync -avz folder/ root@72.60.17.245:/path/
```

### PM2 Commands
```bash
# View all apps
pm2 list

# View app details
pm2 show fibreflow

# View logs (real-time)
pm2 logs fibreflow

# View last 100 lines
pm2 logs fibreflow --lines 100

# Restart app
pm2 restart fibreflow

# Stop app
pm2 stop fibreflow

# Start app
pm2 start fibreflow

# Delete app from PM2
pm2 delete fibreflow

# Start with config
pm2 start ecosystem.config.js

# Save PM2 process list
pm2 save

# Monitor resources
pm2 monit
```

### Nginx Commands
```bash
# Test configuration
nginx -t

# Reload configuration (no downtime)
systemctl reload nginx

# Restart nginx
systemctl restart nginx

# Check status
systemctl status nginx

# View logs
tail -f /var/log/nginx/fibreflow-access.log
tail -f /var/log/nginx/fibreflow-error.log
```

### SSL/Certbot Commands
```bash
# Renew certificate (manual)
certbot renew

# Test renewal process
certbot renew --dry-run

# List certificates
certbot certificates

# Revoke certificate
certbot revoke --cert-path /etc/letsencrypt/live/app.fibreflow.app/fullchain.pem
```

---

## Deployment Workflow

### Initial Deployment (Completed Nov 3, 2025)
```bash
# 1. DNS Setup
# Added A record: app.fibreflow.app → 72.60.17.245

# 2. Clone repository on server
ssh root@72.60.17.245
cd /var/www
git clone https://github.com/VelocityFibre/FF_Next.js.git fibreflow

# 3. Install dependencies
cd fibreflow
npm ci --production=false

# 4. Create environment file
nano .env.production
# (Copy production environment variables)

# 5. Build application
npm run build

# 6. Configure PM2
nano ecosystem.config.js
pm2 start ecosystem.config.js
pm2 save

# 7. Configure Nginx
nano /etc/nginx/sites-available/fibreflow
ln -s /etc/nginx/sites-available/fibreflow /etc/nginx/sites-enabled/
nginx -t
systemctl reload nginx

# 8. Setup SSL
certbot --nginx -d app.fibreflow.app --non-interactive --agree-tos --email admin@fibreflow.app --redirect
```

### Update Deployment (Pull Latest Changes)
```bash
# From local machine
ssh root@72.60.17.245 "cd /var/www/fibreflow && \
  git pull && \
  npm ci && \
  npm run build && \
  pm2 restart fibreflow"
```

### Manual Update on Server
```bash
# SSH into server
ssh root@72.60.17.245

# Navigate to app directory
cd /var/www/fibreflow

# Pull latest code
git pull origin master

# Install dependencies (if package.json changed)
npm ci

# Rebuild application
npm run build

# Restart PM2
pm2 restart fibreflow

# Check status
pm2 logs fibreflow --lines 50
```

### Deploy Specific Branch
```bash
ssh root@72.60.17.245 "cd /var/www/fibreflow && \
  git fetch origin && \
  git checkout feature-branch && \
  git pull && \
  npm ci && \
  npm run build && \
  pm2 restart fibreflow"
```

---

## Monitoring & Troubleshooting

### Check Application Status
```bash
# PM2 status
pm2 list
pm2 show fibreflow

# Check if app is responding
curl http://localhost:3005
curl https://app.fibreflow.app

# Check memory usage
pm2 show fibreflow | grep memory
free -h

# Check disk space
df -h
du -sh /var/www/fibreflow
```

### View Logs
```bash
# PM2 logs (real-time)
pm2 logs fibreflow

# PM2 log files
tail -f /var/log/pm2/fibreflow-out.log
tail -f /var/log/pm2/fibreflow-error.log

# Nginx logs
tail -f /var/log/nginx/fibreflow-access.log
tail -f /var/log/nginx/fibreflow-error.log

# System logs
journalctl -u nginx -f
journalctl -xe
```

### Common Issues

#### App Not Starting
```bash
# Check PM2 logs
pm2 logs fibreflow --lines 100

# Check if port 3005 is in use
lsof -i :3005
netstat -tulpn | grep 3005

# Restart PM2
pm2 restart fibreflow

# If still failing, delete and recreate
pm2 delete fibreflow
cd /var/www/fibreflow
pm2 start ecosystem.config.js
```

#### Nginx 502 Bad Gateway
```bash
# Check if app is running
pm2 list

# Check if app is listening on port 3005
curl http://localhost:3005

# Check Nginx error logs
tail -f /var/log/nginx/fibreflow-error.log

# Test Nginx configuration
nginx -t

# Restart services
pm2 restart fibreflow
systemctl restart nginx
```

#### SSL Certificate Issues
```bash
# Check certificate status
certbot certificates

# Test renewal
certbot renew --dry-run

# Force renewal (if needed)
certbot renew --force-renewal

# Check Nginx SSL configuration
nginx -t
```

#### High Memory Usage
```bash
# Check PM2 memory
pm2 show fibreflow

# Restart app (releases memory)
pm2 restart fibreflow

# Adjust memory limit in ecosystem.config.js
# max_memory_restart: '1G'
```

---

## Performance Optimization

### PM2 Cluster Mode (Optional)
To use multiple CPU cores:

```javascript
// ecosystem.config.js
module.exports = {
  apps: [{
    name: 'fibreflow',
    script: 'node_modules/next/dist/bin/next',
    args: 'start -p 3005',
    instances: 2,  // or "max" for all cores
    exec_mode: 'cluster',  // Changed from 'fork'
    autorestart: true,
    max_memory_restart: '1G',
  }]
};
```

### Nginx Caching (Optional)
Add to Nginx config for static assets:

```nginx
location /_next/static {
    proxy_cache STATIC;
    proxy_pass http://localhost:3005;
    add_header Cache-Control "public, max-age=31536000, immutable";
}
```

---

## Backup Strategy

### Application Code
```bash
# Code is backed up in GitHub
# Repository: VelocityFibre/FF_Next.js

# Manual backup
ssh root@72.60.17.245 "cd /var/www && tar -czf fibreflow-backup-$(date +%Y%m%d).tar.gz fibreflow/"
scp root@72.60.17.245:/var/www/fibreflow-backup-*.tar.gz ./backups/
```

### Database
- Database hosted on Neon (cloud provider handles backups)
- Connection string in `.env.production`

### Environment Variables
```bash
# Backup .env.production
scp root@72.60.17.245:/var/www/fibreflow/.env.production ./backups/env-backup-$(date +%Y%m%d).txt
```

---

## Security Notes

### Firewall
```bash
# Check firewall status
ufw status

# Allow necessary ports
ufw allow 22/tcp    # SSH
ufw allow 80/tcp    # HTTP
ufw allow 443/tcp   # HTTPS
ufw enable
```

### Fail2ban (Optional)
```bash
# Install fail2ban for SSH protection
apt update
apt install fail2ban -y
systemctl enable fail2ban
systemctl start fail2ban
```

### SSH Key Authentication (Recommended)
```bash
# From local machine, copy SSH key
ssh-copy-id root@72.60.17.245

# Then disable password authentication
# Edit /etc/ssh/sshd_config:
# PasswordAuthentication no
systemctl restart sshd
```

---

## Cost Analysis

### VPS vs Vercel

**VPS (Current):**
- €10-15/month (estimated)
- Full control
- Manual management
- Good for testing/staging

**Vercel (Existing):**
- Free tier or Pro plan
- Automatic deployments
- Global CDN
- Zero config SSL

**Recommendation:**
- Keep both running in parallel
- Use VPS for staging/testing
- Use Vercel for production (www.fibreflow.app)

---

## Future Improvements

1. **CI/CD Pipeline**
   - GitHub Actions for automatic deployment
   - Deploy on push to main branch

2. **Monitoring**
   - Setup Uptime monitoring (UptimeRobot, Pingdom)
   - Error tracking (Sentry)
   - Performance monitoring (New Relic, DataDog)

3. **Backup Automation**
   - Scheduled backups via cron
   - Automated database exports

4. **Load Balancer**
   - If traffic increases, add multiple VPS servers
   - Use Nginx or HAProxy for load balancing

5. **Staging Environment**
   - Create staging.fibreflow.app subdomain
   - Deploy feature branches for testing

---

## Contact & Support

**VPS Provider:** Hostinger
**Support:** https://hostinger.com/support

**Developer:** Claude AI + Louis Duplessis
**Deployment Date:** November 3, 2025

---

## Quick Reference

**Live URL:** https://app.fibreflow.app
**SSH:** `ssh root@72.60.17.245`
**Logs:** `pm2 logs fibreflow`
**Restart:** `pm2 restart fibreflow`
**Update:** `cd /var/www/fibreflow && git pull && npm run build && pm2 restart fibreflow`

---

*Last Updated: November 3, 2025*
