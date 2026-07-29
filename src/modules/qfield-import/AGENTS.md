<!-- GENERATED — do not edit. Canonical source: ./.claude.md -->
<!-- Regenerate: node scripts/mirror-agents-md.mjs -->
<!-- You are reading the AGENTS.md view of the Claude-facing docs. Prose
     below may refer to ".claude.md" when describing the canonical side;
     that is accurate — only PATH references are rewritten to AGENTS.md. -->
# Module: qfield-import
<!-- 4-phase wizard: GPKG file scan > layer preview > import > results -->

## Purpose
One-way import of GeoPackage data from QFieldCloud MinIO into FibreFlow DB tables (poles, joints, cable_spans, drops, zone/pon boundaries, pops) with merge or replace modes.

## Key Files
| File | Purpose |
|------|---------|
| `components/QFieldImportPanel.tsx` | 4-phase wizard UI: select > preview > importing > complete |
| `components/LayerPreviewCard.tsx` | Clickable layer card with count + selection state |
| `components/ImportProgressBar.tsx` | Spinner during import; results table on complete |
| `hooks/useQFieldImport.ts` | State machine: phase, preview, selectedLayers, importMode |
| `types/index.ts` | `GpkgFile`, `LayerPreview`, `ImportResult`, `ImportMode`, `LayerType`, `ImportPhase` |

## API Endpoints
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/qfield/gpkg-layers?qfieldProjectId=<uuid>` | List GPKG files in MinIO |
| POST | `/api/qfield/gpkg-preview` | Layer counts + sample fields (fast path) |
| POST | `/api/qfield/gpkg-import` | Execute import job; returns jobId + results |

## Database Tables
- `poles`, `joints`, `cable_spans`, `drops`, `zone_boundaries`, `pon_boundaries`, `pops` — target tables
- `qfield_import_jobs` — job tracking (status, layer_counts, records_created/updated, errors)

## Critical Rules
- All fetch calls require `credentials: 'include'` (cookie auth)
- **Merge mode**: `COALESCE(existing, new)` — preserves non-null existing fields; use for incremental sync
- **Replace mode**: DELETE project rows then INSERT fresh — use for full refresh
- Auto-selects all layers with count > 0 after preview; user can deselect before import
- GPKG reader is `scripts/qfield-sync/read_gpkg.py` invoked server-side on Velocity — use `execFileNoThrow` (not bare exec) to avoid shell injection
- Import batches at 1000 features per UNNEST query (memory guard)
- Timeouts: 120s for import, 60s for preview; buffer limits: 50MB import / 10MB preview
- Coordinates outside SA bounds (22S–35S, 16E–33E) are silently discarded by Python reader
- Source field: set to `'qfield'` or `'sow+qfield'` (if previously SOW-imported)

## Common Issues
| Problem | Fix |
|---------|-----|
| "Failed to parse GPKG reader output" | Python crashed; check server stderr logs; verify MinIO project exists |
| Timeout on large datasets | Normal for 10k+ features; may need timeout increase in API config |
| Merge not updating fields | COALESCE only fills NULL — use Replace mode for full overwrite |
| Coordinates filtered out | Python reader SA bounds filter; check lat/lng are within SA range |

<!-- Auto-updated by /kb. Last: 2026-05-12 -->
