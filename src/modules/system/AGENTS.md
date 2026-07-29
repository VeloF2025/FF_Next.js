<!-- GENERATED — do not edit. Canonical source: ./.claude.md -->
<!-- Regenerate: node scripts/mirror-agents-md.mjs -->
<!-- You are reading the AGENTS.md view of the Claude-facing docs. Prose
     below may refer to ".claude.md" when describing the canonical side;
     that is accurate — only PATH references are rewritten to AGENTS.md. -->
# Module: system
<!-- System administration: infrastructure health dashboard + QField infra monitor -->

## Purpose
Admin-only dashboards for real-time service health monitoring (14+ services), auto-recovery logging, and QField infrastructure control.

## Key Files
| File | Purpose |
|------|---------|
| `components/InfrastructureHealthDashboard.tsx` | 14-service health grid, 30s auto-refresh, trend chart |
| `components/ServiceStatusCard.tsx` | Reusable compact/expanded service status card |
| `components/HealthTrendChart.tsx` | 24-hour health history bar chart |
| `qfield/QFieldDashboard.tsx` | QFieldCloud container status + restart/clear-cache actions |
| `services/` | Health check orchestration |

## API Endpoints
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/system/health` | Full health check for all 14+ services |
| GET | `/api/system/health?history=true` | 24h trend data |
| GET | `/api/system/health?save=true` | Health check + save snapshot to DB |
| GET | `/api/system/qfield/health` | QFieldCloud container health |
| POST | `/api/system/qfield/restart` | Restart QField services |
| POST | `/api/system/qfield/clear-cache` | Clear sync caches |

## Database Tables
- `system_health_logs` — periodic health snapshots
- `system_recovery_actions` — auto-recovery attempt log
- `system_service_config` — 22 seeded service definitions

## Services Monitored
| Category | Examples |
|----------|---------|
| Apps | prod / staging / dev / backup VPS |
| AI/ML | VLM (Qwen3), Ollama, Qdrant |
| Messaging | WA sender-2 (8081), WA bridge-2 (8083) |
| QFieldCloud | nginx, app, db, minio, memcached, 8 workers |
| Infrastructure | Cloudflared, PDFCraft, Grafana, Portainer |

## Critical Rules
- Route `/system/infrastructure` is admin-only
- Auto-recovery cron: `/home/velo/scripts/fibreflow-health-check-v2.sh` runs every 5 min
- Historical trend data only appears after cron runs with `?save=true`
- Service names must match systemd unit names exactly for restart to work
- Old `.claude.md` still referenced Neon DB in monitored services — DB is now self-hosted Supabase on `100.96.203.105:5437`

<!-- Auto-updated by /kb. Last: 2026-05-12 -->
