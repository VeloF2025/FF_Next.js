# /infra - Infrastructure Management & Troubleshooting

Manage and troubleshoot all FibreFlow environments (dev, production).

> **Staging retired 2026-03-11.** `vf.fibreflow.app` redirects to `app.fibreflow.app`. Standalone services (wa-proxy :8092, pdf-tools :3007) still route through vf.fibreflow.app.

## Usage

```
/infra                    # Status of all environments
/infra [env]              # Status of specific environment (dev|prod)
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
| **Dev** | dev.fibreflow.app | 3005 | `fibreflow-dev.service` | `/home/velo/fibreflow-dev` |
| **Local** | localhost:3004 | 3004 | manual | Local machine |

**Server:** Velocity (100.96.203.105) — runs locally as user `hein` with passwordless sudo via `/etc/sudoers.d/fibreflow-deploy`.
Use `sudo -u velo` for deploy directories owned by velo. No SSH needed.

## Quick Diagnostic

### Step 1: Test All Environments
```bash
# Production
curl -s -o /dev/null -w 'PROD: %{http_code}\n' https://app.fibreflow.app/api/health

# Dev
curl -s -o /dev/null -w 'DEV: %{http_code}\n' https://dev.fibreflow.app/api/health

# Local (if running)
curl -s -o /dev/null -w 'LOCAL: %{http_code}\n' http://localhost:3004/api/health 2>/dev/null || echo "LOCAL: not running"
```

### Step 2: Test Localhost on Server
```bash
echo "PROD (3000):" $(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/api/health)
echo "DEV (3005):" $(curl -s -o /dev/null -w '%{http_code}' http://localhost:3005/api/health)
```

### Step 3: Test Nginx Proxy
```bash
echo "PROD nginx:" $(curl -s -o /dev/null -w '%{http_code}' -H 'Host: app.fibreflow.app' http://127.0.0.1:80/api/health)
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
sudo systemctl restart nginx fibreflow-production.service cloudflared-tunnel.service && sleep 10
```

**Restart app only:**
```bash
sudo systemctl restart fibreflow-production.service
```

**View logs:**
```bash
journalctl -u fibreflow-production.service -n 50 --no-pager
```

**Deploy:**
```bash
sudo -u velo bash -c 'cd /home/velo/fibreflow-production && git pull origin master && npm run build'
sudo systemctl restart fibreflow-production.service
```

### Dev (dev.fibreflow.app)

**Restart app:**
```bash
sudo systemctl restart fibreflow-dev.service
```

**View logs:**
```bash
journalctl -u fibreflow-dev.service -n 50 --no-pager
```

**Deploy:**
```bash
sudo -u velo bash -c 'cd /home/velo/fibreflow-dev && git pull origin master && npm run build'
sudo systemctl restart fibreflow-dev.service
```

## Cloudflared Tunnel Management

**Check status:**
```bash
sudo systemctl status cloudflared-tunnel.service --no-pager | head -15
```

**Check for errors:**
```bash
journalctl -u cloudflared-tunnel.service -n 30 --no-pager 2>/dev/null | grep -iE 'error|ERR|terminated|failed'
```

**Check metrics:**
```bash
curl -s http://127.0.0.1:20241/metrics 2>/dev/null | grep -E 'cloudflared_tunnel_ha_connections|requests'
```

**Restart tunnel:**
```bash
sudo systemctl restart cloudflared-tunnel.service && sleep 8
```

**Verify config (should show root, HOME, http2):**
```bash
sudo cat /etc/systemd/system/cloudflared-tunnel.service 2>/dev/null | grep -E 'User=|Group=|Environment=|ExecStart='
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
sudo bash -c 'cat > /etc/systemd/system/cloudflared-tunnel.service << EOF
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
EOF'
sudo systemctl daemon-reload && sudo systemctl restart cloudflared-tunnel.service
```

**Cloudflared ingress routes:**
| Hostname | Service | Notes |
|----------|---------|-------|
| app.fibreflow.app | localhost:3000 | Production |
| vf.fibreflow.app | localhost:80 (nginx) | Legacy redirect to production + standalone services (wa-proxy, pdf-tools) |
| dev.fibreflow.app | localhost:80 (nginx) | Dev |
| qfield.fibreflow.app | localhost:8082 | QFieldCloud |
| support.fibreflow.app | localhost:3005 | Support portal |

## Nginx Management

**Check status:**
```bash
sudo systemctl status nginx --no-pager | head -10
```

**Test config:**
```bash
sudo nginx -t
```

**View error logs:**
```bash
sudo tail -30 /var/log/nginx/error.log
```

**Restart nginx:**
```bash
sudo systemctl restart nginx
```

## Common Issues Reference

| Issue | Symptom | Root Cause | Fix |
|-------|---------|------------|-----|
| **Cloudflared QUIC** | 502, "accept stream listener failure" | QUIC protocol instability | Use `--protocol http2` |
| **Cloudflared perms** | 502, "Connection terminated" | louis user GID issues | Run as root with `HOME=/home/louis` |
| **Cloudflared certs** | 502, "Cannot determine origin certificate" | root can't find certs | Set `Environment=HOME=/home/louis` |
| **Port conflict** | 500, EADDRINUSE | Stale process | `sudo systemctl restart <service>` to cleanly restart |
| **DB auth** | 500, "password authentication failed" | Wrong password in .env | Fix password: `$NEON_DB_PASSWORD` |
| **Missing DATABASE_URL** | 500, "NEON_DATABASE_URL is not defined" | DATABASE_URL not in .env.production | Add `DATABASE_URL=...` to .env.production |
| **Old build** | Missing features | Stale .next cache | `sudo -u velo bash -c 'cd /home/velo/<env> && rm -rf .next && npm run build'` |
| **Git perms** | "Permission denied" on git | Wrong ownership | `sudo chown -R velo:velo /home/velo/<env>/.git` |

## Output Format

### Status Report
```
╔══════════════════════════════════════════════════════════════╗
║                 INFRASTRUCTURE STATUS                        ║
╠══════════════════════════════════════════════════════════════╣
║ Production  (app.fibreflow.app):   [200 ✅ / 502 ❌]         ║
║ Dev         (dev.fibreflow.app):   [200 ✅ / N/A]            ║
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
