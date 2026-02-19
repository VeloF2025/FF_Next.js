# FibreFlow Infrastructure Documentation

> Last updated: 19 Feb 2026

## Velocity Server

**Server:** 100.96.203.105 (Tailscale) / 192.168.1.150 (LAN)
**Access:** `ssh velo@100.96.203.105` (use SSH key or stored credentials)
**Specs:** RTX 5090 GPU, 128GB RAM, Ubuntu Server

### Storage

| Drive | Mount | Size | Used | Free | % |
|-------|-------|------|------|------|---|
| `nvme0n1` (LVM root) | `/` | 1.9 TB | 629 GB | **1.2 TB** | 35% |
| `nvme0n1p2` | `/boot` | 2.0 GB | 238 MB | 1.6 GB | 13% |
| `nvme1n1p1` | `/srv/data` | 1.0 TB | 22 GB | **912 GB** | 3% |
| `nvme1n1p2` | `/srv/ml` | 500 GB | 72 GB | **395 GB** | 16% |

> Root LVM (`ubuntu-vg/ubuntu-lv`) expanded 1 TB → 1.9 TB on 2026-02-19 by claiming
> 905 GB of unallocated space in the volume group. No downtime required.

---

## FibreFlow Deployments

All three environments share the **same production database** (Neon PostgreSQL).

| Environment | Port | Directory | URL | Service |
|-------------|------|-----------|-----|---------|
| **Production** | 3000 | `/home/velo/fibreflow-production` | app.fibreflow.app | `fibreflow-production.service` |
| **Staging** | 3006 | `/home/velo/fibreflow-staging` | vf.fibreflow.app | `fibreflow.service` |
| **Dev** | 3005 | `/home/velo/fibreflow-dev` | dev.fibreflow.app | `fibreflow-dev.service` |
| **Backup (VPS)** | 3005 | `/opt/fibreflow` | backup.fibreflow.app | `fibreflow-backup.service` |

All deploy directories on Velocity are under `/home/velo/`. Backup runs on VPS (72.61.197.178).

### Database (Shared)

All environments connect to the **production Neon database**:

```
Host: ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech
Database: neondb
User: neondb_owner
Password: <set in .env - never commit credentials>
```

**Connection String:** Set `DATABASE_URL` in `.env.local` or environment variables.
```bash
# Format: postgresql://neondb_owner:<PASSWORD>@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require
```

### Deployment Commands

**Deploy to Staging (vf.fibreflow.app):**
```bash
ssh velo@100.96.203.105 "cd /home/velo/fibreflow-staging && git pull && npm run build && sudo systemctl restart fibreflow.service"
```

**Deploy to Production (app.fibreflow.app):**
```bash
ssh velo@100.96.203.105 "cd /home/velo/fibreflow-production && git pull origin master && npm run build && sudo systemctl restart fibreflow-production.service"
```

---

## Nginx Upstream Failover

All three environments have automatic failover to the VPS backup server. If a service on Velocity is down (crash, restart, deploy), nginx automatically routes to VPS backup within ~0.3s.

```
User → Cloudflare → cloudflared (Velocity) → nginx upstream → Primary (localhost) or Backup (VPS)
```

### Upstream Configuration

```nginx
# /etc/nginx/sites-enabled/vf-fibreflow

upstream fibreflow_prod {
    server localhost:3000;
    server 72.61.197.178:3005 backup;
}

upstream fibreflow_staging {
    server localhost:3006;
    server 72.61.197.178:3005 backup;
}

upstream fibreflow_dev {
    server localhost:3005;
    server 72.61.197.178:3005 backup;
}
```

**Failover triggers:** connection error, timeout, HTTP 502/503/504
**Failover timeout:** 10s max, 2 tries
**Limitation:** Only covers service-level failures on Velocity. If Velocity itself goes down (server/network/cloudflared), traffic won't reach nginx. That would require Cloudflare Load Balancing (paid plan).

### VPS Backup Auto-Sync

Hourly cron on VPS keeps backup in sync with master:

```bash
# /opt/fibreflow/auto-update.sh (runs every hour via root crontab)
# Fetches latest from GitHub, builds and restarts if new commits detected
```

**Log:** `/var/log/fibreflow-autoupdate.log`

---

## Cloudflare Configuration

| Domain | Points To | Proxy |
|--------|-----------|-------|
| **app.fibreflow.app** | Cloudflare Tunnel → nginx → upstream (localhost:3000 / VPS backup) | Yes |
| **vf.fibreflow.app** | Cloudflare Tunnel → nginx → upstream (localhost:3006 / VPS backup) | Yes |
| **dev.fibreflow.app** | Cloudflare Tunnel → nginx → upstream (localhost:3005 / VPS backup) | Yes |

**Cloudflare Tunnel Service:** `cloudflared-tunnel.service`
- Tunnel name: `vf-downloads`
- Config: `/home/velo/.cloudflared/config.yml`

---

## Health Check System

Automated health monitoring runs every 5 minutes on Velocity:

**Script:** `/home/velo/scripts/fibreflow-health-check-v2.sh`
**Cron:** `*/5 * * * *`

**Monitors:**
- All FibreFlow services (prod, staging, dev)
- Support services (VLM, QField, WA, PDFCraft, Storage)
- Docker containers (QFieldCloud)

**Actions on failure:**
1. Auto-restarts failed systemd services and Docker containers
2. Logs recovery actions to `system_recovery_actions` DB table
3. Sends WhatsApp alerts for critical service failures (production)

---

## Related Services

### Core Services

| Service | Port | Description |
|---------|------|-------------|
| `fibreflow-production.service` | 3000 | Production FibreFlow |
| `fibreflow.service` | 3006 | Staging FibreFlow |
| `fibreflow-dev.service` | 3005 | Dev FibreFlow |
| `fibreflow-backup.service` | 3005 (VPS) | Backup FibreFlow |
| `fibreflow-storage.service` | 8091 | Storage API (`/srv/data/fibreflow-storage`) |
| `pdfcraft.service` | 3007 | PDFCraft (vf.fibreflow.app/pdf-tools/) |

### AI/VLM Services

| Service | Port | Description |
|---------|------|-------------|
| `vllm-qwen.service` | 8100 | Qwen3-VL-8B VLM (primary) |
| `ollama.service` | 11434 | Ollama (localhost only) |

### WhatsApp Services

| Service | Location | Port | Description |
|---------|----------|------|-------------|
| `whatsapp-bridge.service` | VPS | 8083 | Go bridge — inbound + outbound WA (direct-send, 063 841 2276) |
| `wa-command-bot.service` | VPS | 8086 | Python admin bot for WA queries |
| `wa-feedback.service` | Velocity | 8092 | QA feedback proxy → VPS bridge |

**WA Sender (8081) was REMOVED Feb 2026** — bridge handles all sending directly via its own WhatsApp client.
Legacy `whatsapp-sender.service` on Velocity (`/home/louis/whatsapp-sender/`) is orphaned and not used.

### Monitoring & Infrastructure

| Service | Port | Description |
|---------|------|-------------|
| Grafana (Docker) | 3030 | Monitoring dashboards |
| Prometheus (Docker) | 9091 | Metrics collection |
| xyOps (Docker) | 5522 | Server monitoring |
| Qdrant | 6333, 6334 | Vector database |

---

## QFieldCloud Infrastructure

Self-hosted QFieldCloud for mobile GIS field data collection.

**Location:** `/home/velo/qfieldcloud/`
**Access URL:** `http://100.96.203.105:8082`

### QFieldCloud Docker Containers

| Container | Port | Purpose |
|-----------|------|---------|
| `qfieldcloud-nginx-1` | 8082→80 | Web frontend/proxy |
| `qfieldcloud-app-1` | 8000 (internal) | Django application |
| `qfieldcloud-db-1` | 5433→5432 | PostgreSQL database |
| `qfieldcloud-minio-1` | 8009→9000, 8010→9001 | Object storage (S3-compatible) |
| `qfieldcloud-memcached-1` | 11211 (internal) | Caching |
| `qfieldcloud-certbot-1` | - | SSL certificates |
| `qfieldcloud-ofelia-1` | - | Cron scheduler |
| `qfieldcloud-worker_wrapper-[1-8]` | - | Background workers (8 instances) |

### QFieldCloud Management

```bash
# Check status
docker ps --filter 'name=qfieldcloud'

# View logs
docker logs -f qfieldcloud-app-1

# Restart all services
cd /home/velo/qfieldcloud/source && docker-compose restart

# Access PostgreSQL
docker exec -it qfieldcloud-db-1 psql -U qfieldcloud
```

### QField Sync Module

The FibreFlow QField Sync module provides bidirectional sync between QFieldCloud and FibreFlow.

**Module Documentation:** `src/modules/qfield-sync/README.md`
**Module Context:** `.claude/modules/qfield-sync.md`

**Key Features:**
- Sync fiber cables, poles, splice closures from field
- Conflict detection and resolution
- Real-time status updates

**API Endpoints:**
| Endpoint | Description |
|----------|-------------|
| `GET /api/qfield-sync-dashboard` | Dashboard data |
| `POST /api/qfield-sync-start` | Start sync job |
| `GET /api/qfield-sync-current` | Current job status |
| `GET /api/qfield-sync-history` | Sync history |
| `POST /api/qfield-sync-cancel` | Cancel sync |
| `GET /api/qfield-sync-poles` | QField pole data |
| `GET /api/qfield-sync-cables` | QField cable data |

**Database Tables:**
- `qfield_sync_jobs` - Sync operation tracking
- `qfield_sync_conflicts` - Conflict detection
- `sow_fibre` - Target for cable sync
- `sow_poles` - Target for pole sync

**Environment Variables:**
```bash
NEXT_PUBLIC_QFIELD_URL=https://qfield.fibreflow.app
NEXT_PUBLIC_QFIELD_PROJECT_ID=your_project_id
QFIELD_API_KEY=your_api_key
```

> **Note:** Pole-to-Fiber linking is **PLANNED** but not yet implemented. See `src/modules/qfield-sync/README.md` lines 230-465 for implementation plan.

---

## Port Summary

| Port | Service | Status |
|------|---------|--------|
| 3000 | Production FibreFlow | Active |
| 3005 | Dev FibreFlow / VPS Backup | Active |
| 3006 | Staging FibreFlow | Active |
| 3007 | PDFCraft | Active |
| 3007 | PDFCraft | Active |
| 3030 | Grafana | Active |
| 6333 | Qdrant HTTP | Active |
| 6334 | Qdrant gRPC | Active |
| 8082 | QFieldCloud | Active |
| 8092 | WA Feedback (proxy to VPS bridge) | Active |
| 8091 | FibreFlow Storage | Active |
| 8100 | VLM (Qwen3) | Active |
| 9091 | Prometheus | Active |
| 11434 | Ollama | Active (localhost) |

---

## Nginx Configuration

**Main config:** `/etc/nginx/sites-enabled/vf-fibreflow`

### app.fibreflow.app (Production)
- `/` → upstream `fibreflow_prod` (localhost:3000, VPS backup)
- `/storage/` → localhost:8091 (Storage API) **REQUIRED for photos**

### vf.fibreflow.app (Staging)
- `/` → upstream `fibreflow_staging` (localhost:3006, VPS backup)
- `/pdf-tools/` → localhost:3007 (PDFCraft)
- `/storage/` → localhost:8091 (Storage API) **REQUIRED for photos**
- `/wa-proxy/` → localhost:8092 (WhatsApp proxy)

### dev.fibreflow.app (Dev)
- `/` → upstream `fibreflow_dev` (localhost:3005, VPS backup)
- `/storage/` → localhost:8091 (Storage API) **REQUIRED for photos**

### Storage Proxy Configuration
**IMPORTANT:** Each domain needs the `/storage/` proxy for fleet photos to work:
```nginx
location /storage/ {
    proxy_pass http://localhost:8091/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    client_max_body_size 100M;
    expires 30d;
    add_header Cache-Control "public, immutable";
}
```

---

## Quick Reference

### Check Service Status
```bash
ssh velo@100.96.203.105
sudo systemctl status fibreflow.service
sudo systemctl status fibreflow-production.service
```

### View Logs
```bash
sudo journalctl -u fibreflow.service -f
sudo journalctl -u fibreflow-production.service -f
```

### Restart Services
```bash
sudo systemctl restart fibreflow.service          # Staging
sudo systemctl restart fibreflow-production.service  # Production
```

### Check Ports
```bash
ss -tlnp | grep -E ':300[0-9]'
```

---

## TODO

- [ ] Cloudflare Load Balancing for full Velocity server failure (requires paid plan)
- [ ] Add VPS backup to health check WhatsApp alerts
