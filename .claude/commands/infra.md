# /infra - Infrastructure Management & Troubleshooting

Manage and troubleshoot all FibreFlow environments (dev, staging, production).

## Usage

```
/infra                    # Status of all environments
/infra [env]              # Status of specific environment (dev|staging|prod)
/infra fix [env]          # Auto-fix common issues
/infra 502 [env]          # Fix 502 errors
/infra restart [env]      # Restart all services
/infra deploy [env]       # Deploy to environment
/infra logs [env]         # View service logs
/infra tunnel             # Cloudflared tunnel diagnostics
```

## Environment Reference

| Environment | URL | Port | Service | Directory |
|-------------|-----|------|---------|-----------|
| **Production** | app.fibreflow.app | 3000 | `fibreflow-production.service` | `/home/velo/fibreflow-production` |
| **Staging** | vf.fibreflow.app | 3006 | `fibreflow.service` | `/home/louis/apps/fibreflow` |
| **Dev** | dev.fibreflow.app | 3005 | `fibreflow-dev.service` | `/home/hein/apps/fibreflow-dev` |
| **Local** | localhost:3004 | 3004 | manual | Local machine |

**Server:** 100.96.203.105 (Velocity via Tailscale)
**SSH:** `velo@100.96.203.105` (password: $VELO_SSH_PASSWORD)

## Quick Diagnostic

### Step 1: Test All Environments
```bash
# Production
curl -s -o /dev/null -w 'PROD: %{http_code}\n' https://app.fibreflow.app/api/health

# Staging
curl -s -o /dev/null -w 'STAGING: %{http_code}\n' https://vf.fibreflow.app/api/health

# Dev
curl -s -o /dev/null -w 'DEV: %{http_code}\n' https://dev.fibreflow.app/api/health

# Local (if running)
curl -s -o /dev/null -w 'LOCAL: %{http_code}\n' http://localhost:3004/api/health 2>/dev/null || echo "LOCAL: not running"
```

### Step 2: Test Localhost on Server
```bash
sshpass -p '$VELO_SSH_PASSWORD' ssh velo@100.96.203.105 "
  echo 'PROD (3000):' \$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/api/health)
  echo 'STAGING (3006):' \$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3006/api/health)
  echo 'DEV (3005):' \$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3005/api/health)
"
```

### Step 3: Test Nginx Proxy
```bash
sshpass -p '$VELO_SSH_PASSWORD' ssh velo@100.96.203.105 "
  echo 'PROD nginx:' \$(curl -s -o /dev/null -w '%{http_code}' -H 'Host: app.fibreflow.app' http://127.0.0.1:80/api/health)
  echo 'STAGING nginx:' \$(curl -s -o /dev/null -w '%{http_code}' -H 'Host: vf.fibreflow.app' http://127.0.0.1:80/api/health)
"
```

## Decision Tree

| External | Localhost | Nginx | Problem | Fix |
|----------|-----------|-------|---------|-----|
| 502 | 200 | 200 | Cloudflared tunnel | `/infra tunnel` |
| 502 | 502 | 200 | App service down | Restart app service |
| 502 | 502 | 502 | Nginx issue | Check nginx config |
| 500 | 500 | - | App error | Check app logs |

## Fix Commands by Environment

### Production (app.fibreflow.app)

**Restart all services:**
```bash
sshpass -p '$VELO_SSH_PASSWORD' ssh velo@100.96.203.105 "echo '$VELO_SSH_PASSWORD' | sudo -S systemctl restart nginx fibreflow-production.service cloudflared-tunnel.service && sleep 10"
```

**Restart app only:**
```bash
sshpass -p '$VELO_SSH_PASSWORD' ssh velo@100.96.203.105 "echo '$VELO_SSH_PASSWORD' | sudo -S systemctl restart fibreflow-production.service"
```

**View logs:**
```bash
sshpass -p '$VELO_SSH_PASSWORD' ssh velo@100.96.203.105 "echo '$VELO_SSH_PASSWORD' | sudo -S journalctl -u fibreflow-production.service -n 50 --no-pager"
```

**Deploy:**
```bash
sshpass -p '$VELO_SSH_PASSWORD' ssh velo@100.96.203.105 "cd /home/velo/fibreflow-production && git pull origin master && npm run build && echo '$VELO_SSH_PASSWORD' | sudo -S systemctl restart fibreflow-production.service"
```

### Staging (vf.fibreflow.app)

**Restart all services:**
```bash
sshpass -p '$VELO_SSH_PASSWORD' ssh velo@100.96.203.105 "echo '$VELO_SSH_PASSWORD' | sudo -S systemctl restart nginx fibreflow.service cloudflared-tunnel.service && sleep 10"
```

**Restart app only:**
```bash
sshpass -p '$VELO_SSH_PASSWORD' ssh velo@100.96.203.105 "echo '$VELO_SSH_PASSWORD' | sudo -S systemctl restart fibreflow.service"
```

**View logs:**
```bash
sshpass -p '$VELO_SSH_PASSWORD' ssh velo@100.96.203.105 "echo '$VELO_SSH_PASSWORD' | sudo -S journalctl -u fibreflow.service -n 50 --no-pager"
```

**Deploy:**
```bash
sshpass -p '$VELO_SSH_PASSWORD' ssh velo@100.96.203.105 "echo '$VELO_SSH_PASSWORD' | sudo -S bash -c 'cd /home/louis/apps/fibreflow && chown -R louis:louis .git && su louis -c \"git pull origin master && npm run build\"' && sudo systemctl restart fibreflow.service"
```

**Fix port conflict:**
```bash
sshpass -p '$VELO_SSH_PASSWORD' ssh velo@100.96.203.105 "echo '$VELO_SSH_PASSWORD' | sudo -S fuser -k 3006/tcp && echo '$VELO_SSH_PASSWORD' | sudo -S systemctl restart fibreflow.service"
```

**Fix DB auth:**
```bash
sshpass -p '$VELO_SSH_PASSWORD' ssh velo@100.96.203.105 "cd /home/louis/apps/fibreflow && sed -i 's/npg_aRNLhZc1G2CD/$NEON_DB_PASSWORD/g' .env.production"
```

**Check DATABASE_URL exists:**
```bash
sshpass -p '$VELO_SSH_PASSWORD' ssh velo@100.96.203.105 "grep DATABASE_URL /home/louis/apps/fibreflow/.env.production || echo 'MISSING DATABASE_URL!'"
```

**Fix missing DATABASE_URL:**
```bash
sshpass -p '$VELO_SSH_PASSWORD' ssh velo@100.96.203.105 "echo 'DATABASE_URL=postgresql://neondb_owner:$NEON_DB_PASSWORD@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require' >> /home/louis/apps/fibreflow/.env.production && echo '$VELO_SSH_PASSWORD' | sudo -S systemctl restart fibreflow.service"
```

### Dev (dev.fibreflow.app)

**Restart app:**
```bash
sshpass -p '$VELO_SSH_PASSWORD' ssh velo@100.96.203.105 "echo '$VELO_SSH_PASSWORD' | sudo -S systemctl restart fibreflow-dev.service"
```

**View logs:**
```bash
sshpass -p '$VELO_SSH_PASSWORD' ssh velo@100.96.203.105 "echo '$VELO_SSH_PASSWORD' | sudo -S journalctl -u fibreflow-dev.service -n 50 --no-pager"
```

**Deploy:**
```bash
sshpass -p '$VELO_SSH_PASSWORD' ssh velo@100.96.203.105 "cd /home/hein/apps/fibreflow-dev && git pull origin master && npm run build && echo '$VELO_SSH_PASSWORD' | sudo -S systemctl restart fibreflow-dev.service"
```

**Fix port conflict:**
```bash
sshpass -p '$VELO_SSH_PASSWORD' ssh velo@100.96.203.105 "echo '$VELO_SSH_PASSWORD' | sudo -S fuser -k 3005/tcp && echo '$VELO_SSH_PASSWORD' | sudo -S systemctl restart fibreflow-dev.service"
```

## Cloudflared Tunnel Management

**Check status:**
```bash
sshpass -p '$VELO_SSH_PASSWORD' ssh velo@100.96.203.105 "echo '$VELO_SSH_PASSWORD' | sudo -S systemctl status cloudflared-tunnel.service --no-pager | head -15"
```

**Check for errors:**
```bash
sshpass -p '$VELO_SSH_PASSWORD' ssh velo@100.96.203.105 "echo '$VELO_SSH_PASSWORD' | sudo -S journalctl -u cloudflared-tunnel.service -n 30 --no-pager 2>/dev/null | grep -iE 'error|ERR|terminated|failed'"
```

**Check metrics:**
```bash
sshpass -p '$VELO_SSH_PASSWORD' ssh velo@100.96.203.105 "curl -s http://127.0.0.1:20241/metrics 2>/dev/null | grep -E 'cloudflared_tunnel_ha_connections|requests'"
```

**Restart tunnel:**
```bash
sshpass -p '$VELO_SSH_PASSWORD' ssh velo@100.96.203.105 "echo '$VELO_SSH_PASSWORD' | sudo -S systemctl restart cloudflared-tunnel.service && sleep 8"
```

**Verify config (should show root, HOME, http2):**
```bash
sshpass -p '$VELO_SSH_PASSWORD' ssh velo@100.96.203.105 "echo '$VELO_SSH_PASSWORD' | sudo -S cat /etc/systemd/system/cloudflared-tunnel.service 2>/dev/null | grep -E 'User=|Group=|Environment=|ExecStart='"
```

**Expected cloudflared config:**
```ini
[Service]
User=root
Group=root
Environment=HOME=/home/louis
ExecStart=/home/louis/cloudflared --config /home/louis/.cloudflared/config.yml --protocol http2 tunnel run vf-downloads
```

**Fix cloudflared config (if wrong):**
```bash
sshpass -p '$VELO_SSH_PASSWORD' ssh velo@100.96.203.105 "echo '$VELO_SSH_PASSWORD' | sudo -S bash -c 'cat > /etc/systemd/system/cloudflared-tunnel.service << EOF
[Unit]
Description=Cloudflare Tunnel for vf.fibreflow.app
After=network.target

[Service]
Type=simple
User=root
Group=root
Environment=HOME=/home/louis
ExecStart=/home/louis/cloudflared --config /home/louis/.cloudflared/config.yml --protocol http2 tunnel run vf-downloads
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF
' && echo '$VELO_SSH_PASSWORD' | sudo -S systemctl daemon-reload && echo '$VELO_SSH_PASSWORD' | sudo -S systemctl restart cloudflared-tunnel.service"
```

**Cloudflared ingress routes:**
| Hostname | Service | Notes |
|----------|---------|-------|
| app.fibreflow.app | localhost:3000 | Production |
| vf.fibreflow.app | localhost:80 (nginx) | Staging (via nginx for /pdf-tools/) |
| dev.fibreflow.app | localhost:80 (nginx) | Dev |
| qfield.fibreflow.app | localhost:8082 | QFieldCloud |
| support.fibreflow.app | localhost:3005 | Support portal |

## Nginx Management

**Check status:**
```bash
sshpass -p '$VELO_SSH_PASSWORD' ssh velo@100.96.203.105 "echo '$VELO_SSH_PASSWORD' | sudo -S systemctl status nginx --no-pager | head -10"
```

**Test config:**
```bash
sshpass -p '$VELO_SSH_PASSWORD' ssh velo@100.96.203.105 "echo '$VELO_SSH_PASSWORD' | sudo -S nginx -t"
```

**View error logs:**
```bash
sshpass -p '$VELO_SSH_PASSWORD' ssh velo@100.96.203.105 "echo '$VELO_SSH_PASSWORD' | sudo -S tail -30 /var/log/nginx/error.log"
```

**Restart nginx:**
```bash
sshpass -p '$VELO_SSH_PASSWORD' ssh velo@100.96.203.105 "echo '$VELO_SSH_PASSWORD' | sudo -S systemctl restart nginx"
```

## Common Issues Reference

| Issue | Symptom | Root Cause | Fix |
|-------|---------|------------|-----|
| **Cloudflared QUIC** | 502, "accept stream listener failure" | QUIC protocol instability | Use `--protocol http2` |
| **Cloudflared perms** | 502, "Connection terminated" | louis user GID issues | Run as root with `HOME=/home/louis` |
| **Cloudflared certs** | 502, "Cannot determine origin certificate" | root can't find certs | Set `Environment=HOME=/home/louis` |
| **Port conflict** | 500, EADDRINUSE | Stale process | `fuser -k [port]/tcp` |
| **DB auth** | 500, "password authentication failed" | Wrong password in .env | Fix password: `$NEON_DB_PASSWORD` |
| **Missing DATABASE_URL** | 500, "NEON_DATABASE_URL is not defined" | DATABASE_URL not in .env.production | Add `DATABASE_URL=...` to .env.production |
| **Old build** | Missing features | Stale .next cache | `rm -rf .next && npm run build` |
| **Git perms** | "Permission denied" on git | Wrong ownership | `chown -R louis:louis .git` |

## Output Format

### Status Report
```
╔══════════════════════════════════════════════════════════════╗
║                 INFRASTRUCTURE STATUS                        ║
╠══════════════════════════════════════════════════════════════╣
║ Production  (app.fibreflow.app):   [200 ✅ / 502 ❌]         ║
║ Staging     (vf.fibreflow.app):    [200 ✅ / 502 ❌]         ║
║ Dev         (localhost:3005):      [200 ✅ / N/A]            ║
╠══════════════════════════════════════════════════════════════╣
║ Cloudflared: [4 connections ✅ / down ❌]                    ║
║ Nginx:       [running ✅ / stopped ❌]                       ║
╚══════════════════════════════════════════════════════════════╝
```

### Diagnostic Report
```
╔══════════════════════════════════════════════════════════════╗
║             DIAGNOSTIC: [ENVIRONMENT]                        ║
╠══════════════════════════════════════════════════════════════╣
║ External (Cloudflare):  [status]                             ║
║ Nginx (localhost:80):   [status]                             ║
║ App (localhost:[port]): [status]                             ║
╠══════════════════════════════════════════════════════════════╣
║ DIAGNOSIS: [problem identified]                              ║
║ FIX: [command to run]                                        ║
╚══════════════════════════════════════════════════════════════╝
```

### After Fix
```
╔══════════════════════════════════════════════════════════════╗
║                    [ENVIRONMENT] FIXED                       ║
╠══════════════════════════════════════════════════════════════╣
║ Issue: [what was wrong]                                      ║
║ Fix applied: [what was done]                                 ║
║ Status: [URL] → 200 ✅                                       ║
╚══════════════════════════════════════════════════════════════╝
```

## Database Reference

All environments share the same **production database** (Neon PostgreSQL):
```
DATABASE_URL='postgresql://neondb_owner:$NEON_DB_PASSWORD@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require'
```

**Dev branch (for safe experiments):**
```
DATABASE_URL='postgresql://neondb_owner:$NEON_DB_PASSWORD@ep-aged-poetry-a9bbd8e9-pooler.gwc.azure.neon.tech/neondb?sslmode=require'
```
