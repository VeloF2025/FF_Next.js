<!-- GENERATED — do not edit. Canonical source: ./.claude.md -->
<!-- Regenerate: node scripts/mirror-agents-md.mjs -->
<!-- You are reading the AGENTS.md view of the Claude-facing docs. Prose
     below may refer to ".claude.md" when describing the canonical side;
     that is accurate — only PATH references are rewritten to AGENTS.md. -->
# Construction QA Module

## Purpose and entry points
- `/field-ops` is the QA Centre operational Zone Delivery register: one row per project/zone, server summary, filters, blockers, discipline QA, and handover state.
- `/field-ops/zone?project_id=<uuid>&zone_no=<positive integer>` is the stable audited workspace route.
- Works QA, OTDR Testing, Snags, and Reports remain separate module tabs after QA Centre.
- Zone Delivery UI lives in `src/modules/construction-qa/zone-delivery`; do not revive the legacy project-card dashboard for QA Centre.

## Zone Delivery contract
- Canonical PON lifecycle: Civil complete → Optical complete → Testing passed (active test pack) → Port submitted → Port approved → Technically live.
- All approved-scope included PONs must be technically live before separate Civil and Optical Zone QA.
- Scope approval must cover the exact canonical zone PON set; there is no denominator before approval, and material scope/reopen changes atomically invalidate both current Zone QA outcomes and eligibility with append-only audit.
- Handover is automatic only when both QA disciplines pass, all blocking snags close, and active FAC and CAC certificates exist.
- Gates, blockers, row versions, timestamps, and handover are server-authoritative; the browser must not recalculate them.
- Scope exclusions/cancellations, corrections, backdates, reopen/reconfirm actions, evidence checksums, and old/new values are audited.
- Handed-over zones are terminal; post-handover defects are non-blocking maintenance links.

## Delivery implementation
- Seven flat APIs: `/api/zone-delivery/register`, `/zone`, `/scope`, `/pon-milestone`, `/zone-qa`, `/document`, and `/activity`.
- Migration 470 adds `pon_delivery_state`, `zone_delivery_state`, `zone_delivery_documents`, `zone_delivery_snag_links`, and `zone_delivery_activity`; rollback is `scripts/migrations/sql/rollback_470_zone_delivery_handover.sql`.
- Test packs, FACs, and CACs use VF Storage; persist active document metadata and SHA-256 evidence only after upload succeeds.
- Document JSON is rejected until EXFO ownership can be proven server-side; supervised multipart accepts validated PDF/OOXML packages, and only allow-listed references render as links.
- Snag status PATCH uses `construction-qa.snags:edit`; a recalculation failure is returned, and repeating the saved status retries reconciliation.
- Action permissions:
  - `construction-qa.zone-delivery.scope-manage`
  - `construction-qa.zone-delivery.construction-confirm`
  - `construction-qa.zone-delivery.testing-confirm`
  - `construction-qa.zone-delivery.operations-confirm`
  - `construction-qa.zone-delivery.zone-qa-approve`
  - `construction-qa.zone-delivery.documents-manage`
- Read access remains `construction-qa.qa-centre:view`.

## Existing Construction QA and OTDR
- The 5-phase construction review wizard covers civil, optical, and splicing; VLM suggestions never replace supervised decisions.
- `src/modules/construction-qa/services/qfieldIngestionService.ts` ingests QField photos; `src/modules/construction-qa/services/vlmConstructionService.ts` uses Qwen3-VL on port 8100.
- OTDR results are synced from EXFO Exchange by `src/services/exfo/exfoSyncService.ts`; result evidence is context until explicitly confirmed.
- WhatsApp feedback uses the shared Activate bridge on port 8083; the photo proxy abstracts VF Storage, MinIO, SharePoint, WhatsApp, and uploads.

## Safety
- The self-hosted Supabase database is shared by dev and production: migration 470 requires Hein's explicit approval and must never be applied as part of UI/test verification.
- Contract browser tests must intercept auth and Zone Delivery APIs, use empty storage state and `--no-deps`, and never contact the shared database.
