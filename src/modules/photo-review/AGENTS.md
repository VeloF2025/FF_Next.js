<!-- GENERATED — do not edit. Canonical source: ./.claude.md -->
<!-- Regenerate: node scripts/mirror-agents-md.mjs -->
<!-- You are reading the AGENTS.md view of the Claude-facing docs. Prose
     below may refer to ".claude.md" when describing the canonical side;
     that is accurate — only PATH references are rewritten to AGENTS.md. -->
# Module: photo-review
<!-- DR installation photo AI review — VLM evaluation, BOSS API integration, WhatsApp feedback -->

## Purpose
AI-powered review of 12-step DR (drop record) installation photos: evaluates via VLM/BOSS API, stores results, and sends WhatsApp feedback to installers.

## Key Files
| File | Purpose |
|------|---------|
| `components/PhotoGallery.tsx` | Grid display of DR photos with click-to-zoom |
| `components/AIEvaluationCard.tsx` | Evaluation trigger + result display |
| `components/EvaluationPanel.tsx` | Full per-step evaluation results |
| `components/FilterControls.tsx` | Project/date/status filters |
| `services/fotoBossService.ts` | Fetches AI results from BOSS VPS API (:8001) |
| `services/fotoDbService.ts` | DB reads/writes for evaluation results |
| `services/fotoEvaluationService.ts` | Frontend API client (calls `/api/foto/*`) |
| `services/fotoVlmService.ts` | **DEPRECATED** — use `activate/unifiedVlmService.ts` |
| `services/autoEvaluator.ts` | Auto-evaluation trigger logic |
| `services/markdownReportService.ts` | Generates markdown evaluation report |
| `hooks/useFotoEvaluation.ts` | Evaluation state management hook |
| `hooks/usePhotos.ts` | DR photo loading + filter hook |
| `utils/drValidator.ts` | DR number format validation |

## API Endpoints
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/foto/photos` | List DRs with photos and filters |
| POST | `/api/foto/evaluate` | Trigger VLM evaluation for a DR |
| GET | `/api/foto/evaluation/[dr_number]` | Fetch stored evaluation |
| POST | `/api/foto/feedback` | Send WhatsApp feedback to installer |
| GET | `/api/foto/photo-proxy` | Proxy photos from 1Map storage |
| POST | `/api/foto/auto-process` | Batch auto-evaluation |
| GET | `/api/foto/download-report` | Download markdown report |

## Database Tables
- `dr_photo_unified_reviews` — AI evaluation results (12-step scores, overall PASS/FAIL, markdown report, feedback_sent status)
- `foto_auto_processor_state` — auto-evaluation cursor/state

## Critical Rules
- `fotoVlmService.ts` is **deprecated** since Phase 6 Week 6.4 — new code uses `src/modules/activate/services/unifiedVlmService.ts`
- BOSS API at `100.96.203.105:8001` auto-evaluates photos when fetched from 1Map; `fotoBossService` polls results
- 12 standard steps: house_photo → cable_span → ont_barcode → ont_installation → power_supply → cable_management → drop_cable → splice_closure → inside_wiring → speed_test → customer_equipment → customer_signature
- `fotoDbService.ts` still uses Neon shim (`@/lib/db-neon`) — 500s → check shim first
- Photo proxy needed because 1Map storage URLs are not directly browser-accessible

## Common Issues
| Issue | Fix |
|-------|-----|
| Evaluation returns null | Check BOSS API health at :8001; retry after delay |
| Photos not loading | Use `/api/foto/photo-proxy` not direct 1Map URL |
| 500 on DB write | Neon shim issue — check `lib/db-neon.ts` connection |

<!-- Auto-updated by /kb. Last: 2026-05-12 -->
