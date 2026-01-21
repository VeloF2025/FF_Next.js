# FibreFlow Infrastructure Documentation

> Last updated: 21 Jan 2026

## Velocity Server

**Server:** 100.96.203.105 (Tailscale) / 192.168.1.150 (LAN)
**Access:** `ssh velo@100.96.203.105` (password: velo2026)
**Specs:** RTX 5090 GPU, 128GB RAM, Ubuntu Server

---

## FibreFlow Deployments

All three environments share the **same production database** (Neon PostgreSQL).

| Environment | Port | Directory | URL | Service |
|-------------|------|-----------|-----|---------|
| **Production** | 3008* | `/home/velo/fibreflow-production` | app.fibreflow.app | `fibreflow-production.service` |
| **Staging** | 3006 | `/home/louis/apps/fibreflow` | vf.fibreflow.app | `fibreflow.service` |
| **Dev** | 3004 | `/home/velo/fibreflow` | dev.fibreflow.app | `fibreflow-dev.service` |

*Note: Production currently runs on port 3008, should be migrated to 3000.

### Database (Shared)

All environments connect to the **production Neon database**:

```
Host: ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech
Database: neondb
User: neondb_owner
Password: npg_MIUZXrg1tEY0
```

**Connection String:**
```bash
DATABASE_URL='postgresql://neondb_owner:npg_MIUZXrg1tEY0@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require&channel_binding=require'
```

### Deployment Commands

**Deploy to Staging (vf.fibreflow.app):**
```bash
sshpass -p 'velo2026' ssh velo@100.96.203.105 "echo 'velo2026' | sudo -S bash -c 'cd /home/louis/apps/fibreflow && chown -R louis:louis .git && su louis -c \"git pull origin master && npm run build\"' && sudo systemctl restart fibreflow.service"
```

**Deploy to Production (app.fibreflow.app):**
```bash
sshpass -p 'velo2026' ssh velo@100.96.203.105 "cd /home/velo/fibreflow-production && git pull origin master && npm run build && echo 'velo2026' | sudo -S systemctl restart fibreflow-production.service"
```

---

## Cloudflare Configuration

| Domain | Points To | Proxy |
|--------|-----------|-------|
| **app.fibreflow.app** | Cloudflare Tunnel → localhost:3000 | Yes |
| **vf.fibreflow.app** | Cloudflare Tunnel → nginx:80 → localhost:3006 | Yes |

**Cloudflare Tunnel Service:** `cloudflared-tunnel.service`
- Tunnel name: `vf-downloads`
- Config: `/home/louis/.cloudflared/config.yml`

---

## Related Services

### Core Services

| Service | Port | Description |
|---------|------|-------------|
| `fibreflow-production.service` | 3008 (should be 3000) | Production FibreFlow |
| `fibreflow.service` | 3006 | Staging FibreFlow |
| `fibreflow-storage.service` | 8091 | Storage API (`/srv/data/fibreflow-storage`) |
| `pdfcraft.service` | 3007 | PDFCraft (vf.fibreflow.app/pdf-tools/) |

### AI/VLM Services

| Service | Port | Description |
|---------|------|-------------|
| `vllm-qwen.service` | 8100 | Qwen3-VL-8B VLM (primary) |
| `ollama.service` | 11434 | Ollama (localhost only) |

### WhatsApp Services

| Service | Port | Description |
|---------|------|-------------|
| `whatsapp-bridge.service` | - | Go bridge for WA messages |
| `whatsapp-sender.service` | - | WA sender (082 418 9511) |
| `wa-feedback.service` | 8090 | QA feedback microservice |
| `bridge-proxy.service` | - | WA bridge DB proxy |

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

**Location:** `/home/louis/qfieldcloud/`
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
cd /home/louis/qfieldcloud/source && docker-compose restart

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
| 3000 | Production FibreFlow | **SHOULD BE** (currently 3008) |
| 3005 | Dev FibreFlow | Active |
| 3006 | Staging FibreFlow | Active |
| 3007 | PDFCraft | Active |
| 3008 | Production FibreFlow | **WRONG PORT** |
| 3010 | Unknown | Active |
| 3030 | Grafana | Active |
| 6333 | Qdrant HTTP | Active |
| 6334 | Qdrant gRPC | Active |
| 8082 | QFieldCloud | Active |
| 8090 | WA Feedback | Active |
| 8091 | FibreFlow Storage | Active |
| 8100 | VLM (Qwen3) | Active |
| 9091 | Prometheus | Active |
| 11434 | Ollama | Active (localhost) |

---

## Nginx Configuration

**Main config:** `/etc/nginx/sites-available/vf-fibreflow`

Routes:
- `/` → localhost:3006 (Staging FibreFlow)
- `/pdf-tools/` → localhost:3007 (PDFCraft)
- `/storage/` → localhost:8091 (Storage API)
- `/wa-proxy/` → localhost:8092 (WhatsApp proxy)

---

## Quick Reference

### Check Service Status
```bash
ssh velo@100.96.203.105
echo 'velo2026' | sudo -S systemctl status fibreflow.service
echo 'velo2026' | sudo -S systemctl status fibreflow-production.service
```

### View Logs
```bash
echo 'velo2026' | sudo -S journalctl -u fibreflow.service -f
echo 'velo2026' | sudo -S journalctl -u fibreflow-production.service -f
```

### Restart Services
```bash
echo 'velo2026' | sudo -S systemctl restart fibreflow.service          # Staging
echo 'velo2026' | sudo -S systemctl restart fibreflow-production.service  # Production
```

### Check Ports
```bash
ss -tlnp | grep -E ':300[0-9]'
```

---

## TODO

- [ ] Migrate production from port 3008 to port 3000
- [ ] Update `fibreflow-production.service` ExecStart to use `-p 3000`
- [ ] Verify Cloudflare tunnel points to correct port after migration
