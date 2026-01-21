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
| **Production** | 3000* | `/home/velo/fibreflow-production` | app.fibreflow.app | `fibreflow-production.service` |
| **Staging** | 3006 | `/home/louis/apps/fibreflow` | vf.fibreflow.app | `fibreflow.service` |
| **Dev** | 3005 | `/home/velo/fibreflow` | localhost:3005 | manual |

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
| QFieldCloud (Docker) | 8082 | QField sync server |
| Qdrant | 6333, 6334 | Vector database |

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
