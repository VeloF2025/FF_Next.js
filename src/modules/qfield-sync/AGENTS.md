<!-- GENERATED — do not edit. Canonical source: ./.claude.md -->
<!-- Regenerate: node scripts/mirror-agents-md.mjs -->
<!-- You are reading the AGENTS.md view of the Claude-facing docs. Prose
     below may refer to ".claude.md" when describing the canonical side;
     that is accurate — only PATH references are rewritten to AGENTS.md. -->
# Module: qfield-sync
<!-- Bidirectional sync between QFieldCloud GIS app and FibreFlow database -->

## Purpose
Synchronises fiber cable and installation data between QFieldCloud (field GIS) and FibreFlow; includes dashboard, conflict resolution, and infrastructure monitoring.

## Key Files
| File | Purpose |
|------|---------|
| `services/qfieldSyncService.ts` | Core sync orchestration (fiber_cables, field_installations) |
| `services/qfieldcloudApiService.ts` | QFieldCloud REST API client |
| `services/qfieldSyncApiService.ts` | Frontend API client |
| `project-stats/` | Read-only QField project-statistics service |
| `config/sync-config.ts` | Batch size, retry limits, status mapping |
| `components/QFieldSyncDashboard.tsx` | Main sync dashboard (jobs, stats, history) |
| `components/ConflictResolver.tsx` | UI for resolving sync conflicts |

## API Endpoints
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/qfield/sync-status` | Current sync job status |
| POST | `/api/qfield/sync` | Trigger sync job |
| GET | `/api/qfield/sync-history` | Past sync jobs |
| GET | `/api/qfield/project-stats` | Read-only project statistics |

## Critical Rules
- **MinIO internal DNS**: use `http://minio:9000` — NEVER `172.17.0.1:8009` (Docker bridge, causes HTTP-524)
- **CSRF patch is permanent** via `entrypoint-wrapper.sh` + `docker-compose.override.yml` — do not re-apply manually
- **After `.env` changes**: restart BOTH `app` AND `worker_wrapper` — workers have a separate copy of STORAGES
- `Master_2026` project times out on every QFC sync — excluded by circuit breaker; do not re-enable
- Tonga = QField; Etwatwa = OneDrive; Thembisa = SharePoint — never confuse field sync sources
- Project statistics use QFieldCloud `core_delta` through the read-only pool.
- Never use the legacy `core_layer`/`core_feature` readers for statistics; those relations are absent in production and their callers currently produce false zeros.
- `poles planted` means the last applied physical-state event leaves the pole in the ground; photo and QA states do not change physical state.
- Sync-job statistics are system-scoped until the schema contains a project ID.

## Common Issues
| Issue | Fix |
|-------|-----|
| HTTP-524 timeout on STORAGES | Switch MinIO URL to `http://minio:9000` in `.env`, then `docker-compose up -d worker_wrapper` |
| CSRF SyntaxError crashing Django | Check `entrypoint-wrapper.sh` is mounted; never re-run manual `sed` patch |
| Jobs stuck after `.env` change | Workers need `docker-compose up -d worker_wrapper` — recreate all 8 workers |
| Master_2026 timeout loop | Excluded by circuit breaker; check per-project job count before adding |

<!-- Auto-updated by /kb. Last: 2026-05-12 -->
