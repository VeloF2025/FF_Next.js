<!-- GENERATED — do not edit. Canonical source: ./.claude.md -->
<!-- Regenerate: node scripts/mirror-agents-md.mjs -->
<!-- You are reading the AGENTS.md view of the Claude-facing docs. Prose
     below may refer to ".claude.md" when describing the canonical side;
     that is accurate — only PATH references are rewritten to AGENTS.md. -->
# Module: dr-photo-review
<!-- DR installation photo review with VLM evaluation — proxies to local backend on :8082 -->

## Purpose
Displays DR (Drop) installation photo sessions, shows per-step photos with VLM pass/fail evaluations, and allows human overrides.

## Key Files
| File | Purpose |
|------|---------|
| `components/DRSessionList.tsx` | List of DR sessions to review |
| `components/DRPhotoGallery.tsx` | Grid of step photos for a selected DR |
| `components/DREvaluationPanel.tsx` | VLM evaluation results + human override controls |
| `components/VLMStatusIndicator.tsx` | VLM health status badge |
| `services/drPhotoReviewService.ts` | API client proxying to `/api/dr-dashboard/*` |
| `hooks/useDRSessions.ts` | Fetches + manages DR sessions list |
| `hooks/useDREvaluation.ts` | Manages VLM evaluation state for a single DR |

## API Endpoints (proxied — do not call :8082 directly)
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/dr-dashboard/sessions` | All DR sessions |
| GET | `/api/dr-dashboard/sessions/:drNumber/photos?project=VPS` | Photos for a DR |
| GET | `/api/dr-dashboard/photos/:drNumber/:filename` | Single photo |

## Installation Steps (12 standard steps)
Steps 1–12: property_photo, cable_from_pole, cable_entry_outside (critical), cable_entry_inside, wall_for_installation, ont_back_after_install, power_meter_reading (critical), ont_barcode_serial (critical), ups_serial_number (critical), final_installation (critical), green_lights (critical), + additional steps.

## Critical Rules
- Default project is `'VPS'` — always pass `project` param to photo endpoint
- Photos are proxied via `/api/dr-dashboard/photos/` — never expose the :8082 backend directly
- UPS serial VLM known issue: Gizzu stickers (rotated) hallucinate `GU18W12V` — blocklist in place (see `project_vlm_ups_hallucination.md`)
- Steps are mapped by index (step_number || index+1) — missing step_number defaults to sequential order
- For new QA work use `@/modules/activate` (12-step wizard) — this module is the older review-only view

## Common Issues
| Problem | Fix |
|---------|-----|
| Photos 404 | Verify `:8082` backend is running; check `/api/dr-dashboard` proxy config |
| Wrong step labels | Step detection uses step_number field; fallback is array index + 1 |
| VLM shows wrong serial | UPS blocklist may need updating — see `.claude/modules/vlm.md` |

<!-- Auto-updated by /kb. Last: 2026-05-12 -->
