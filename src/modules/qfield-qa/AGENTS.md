<!-- GENERATED — do not edit. Canonical source: ./.claude.md -->
<!-- Regenerate: node scripts/mirror-agents-md.mjs -->
<!-- You are reading the AGENTS.md view of the Claude-facing docs. Prose
     below may refer to ".claude.md" when describing the canonical side;
     that is accurate — only PATH references are rewritten to AGENTS.md. -->
# Module: qfield-qa
<!-- AI-powered photo validation and human QA review for QField field photos -->

## Purpose
Validates QField-synced field photos using VLM (Qwen3-VL) and provides human QA review workflow with assignments, escalation, and bulk actions.

## Key Files
| File | Purpose |
|------|---------|
| `components/QFieldQaDashboard.tsx` | Hybrid sidebar+grid layout (Activate-style) |
| `components/HierarchyTree.tsx` | Zone → PON → Pole/Joint drill-down tree |
| `components/PhotoListTab.tsx` | Photo grid with bulk actions + status badges |
| `components/PhotoDetailModal.tsx` | Full view + VLM results + approve/reject/escalate |
| `hooks/useQFieldQa.ts` | Data fetching, hierarchy nav, auto-refresh |
| `services/qfieldQaApiService.ts` | API client for all QA endpoints |
| `services/qfieldNotificationService.ts` | WhatsApp alerts on reject/escalate |

## API Endpoints
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/qfield/qa-hierarchy` | Zone→PON→feature tree with photo counts |
| GET | `/api/qfield/qa-validations` | List photos with filters + pagination |
| POST | `/api/qfield/qa-validate` | Trigger VLM validation (single or bulk, async) |
| POST | `/api/qfield/qa-actions` | Approve / reject / escalate photos |
| POST | `/api/qfield/qa-assignments` | Assign photos to reviewers with due date + priority |
| GET | `/api/qfield/qa-stats` | Dashboard statistics |
| GET | `/api/qfield/photo-proxy` | Proxy photos from MinIO |

## Database Tables
- `qfield_photo_validations` — main table: photo_key, VLM results, workflow_status
- `qfield_validation_config` — VLM prompts and confidence thresholds per work_type
- `drops` — source for zone_no/pon_no (joined via pole_number = feature_id; poles table has NULLs)

## Critical Rules
- **Zone/PON from `drops`, not `poles`** — use `DISTINCT ON (pole_number)` subquery to avoid inflated counts
- **Pino logger format**: `log.info({ module, photoKey }, 'msg')` — data object FIRST, then message string
- **MinIO path** includes version suffix: `projects/{id}/files/DCIM/{name}.jpg/{version-id}`
- **Badge colors** must be solid (e.g. `bg-yellow-500 text-white shadow-lg`), not semi-transparent — invisible on photos
- VLM endpoint: `http://100.96.203.105:8100/v1/chat/completions` (Qwen3-VL-8B); fetches via `docker exec qfieldcloud-minio-1 mc cat`

## Workflow States
`pending` → `in_review` → `approved` / `rejected` / `escalated`

## Common Issues
| Issue | Fix |
|-------|-----|
| VLM validation never completes | Check logger format; verify VLM health; check MinIO version suffix |
| Hierarchy tree shows NULLs | Zone/PON must come from `drops` table, not `poles` |
| Badges invisible | Use solid colors + `shadow-lg`, not semi-transparent classes |

<!-- Auto-updated by /kb. Last: 2026-05-12 -->
