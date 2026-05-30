# Correctness Rubrics — CodeGraph Pilot

A run PASSES a question if its answer names the required files/symbols below and
states the relationships correctly. Missing a required anchor = FAIL.

## q1 — PWA upload flow
Required: `pages/api/photo-guide/upload.ts` (route + `uploadToVfStorage`), VF Storage POST to `${VF_STORAGE_URL}/upload`, DB write to `dr_photo_unified_reviews` (`pwa_submission_at`, `pwa_photo_urls` columns) or `pole_install_sessions` (`pwa_submission_at`).
Verified columns (git grep -n "pwa_photo_urls\|pwa_submission_at" -- pages/api/photo-guide/upload.ts): line 78 SET pwa_submission_at, line 82 pwa_photo_urls = $3, line 89 SET pwa_submission_at — both tables written.

## q2 — recordVlmCorrection caller/callee
Required callers (≥9 of 11): pages/api/construction-qa/photo-step.ts, pages/api/fleet/check-in/photos.ts, pages/api/fleet/check-in/process-vlm.ts, pages/api/qfield/qa-actions.ts, pages/api/system/vlm/corrections.ts, src/modules/activate/services/oes/oesPostImportService.ts, src/modules/activate/services/oes/oesVlmLearningService.ts, src/modules/activate/services/serialRecheckBatchService.ts, src/modules/activate/services/serialRecheckService.ts, src/modules/data-sync/services/eodLearningService.ts, src/modules/projects/services/poExtractionService.ts.
Definition: src/services/vlmLearningService.ts:42. Callees (verified via grep -A60 of function body): classifyErrorPattern (internal helper), sql INSERT INTO vlm_corrections (direct tagged-template SQL), recordExtractionMetric (imported from same file), mapCorrectionRow (internal mapper), log.info / log.error.

## q3 — Neon shim importers
Required: shim defined in `src/lib/neon-shim.ts`; consumed via `lib/db/pool.js` (imports `@neondatabase/serverless` directly); webpack alias in `next.config.js` (line 277) rewrites `@neondatabase/serverless` → `./src/lib/neon-shim` for all bundled code. Answer must name the alias mechanism + at minimum: src/lib/neon-shim.ts (definition), lib/db/pool.js (direct importer, not aliased), next.config.js (alias config), lib/db-logger.ts, lib/db.mjs, and the large set of pages/api/** importers (441 files total via git grep).

## q4 — WA mention → NOC ticket
Required: entry point `pages/api/noc/wa-message.ts` (POST, receives bridge message) → calls `processMaintenanceMessage` in `src/modules/noc/services/waMaintenanceProcessor.ts` → extracts DR numbers / ONT serials via `waReferenceExtractor` → calls `linkMessageToTicket` from `src/modules/noc/services/waTicketLinker.ts` (which writes to `maintenance_notes` and `maintenance_activities`). Separate manual-creation path: `pages/api/noc/wa-ticket.ts` → `createTicket` in `src/modules/noc/services/ticketService.ts` → INSERT INTO `maintenance_tickets`. Answer must name these files and distinguish the automated mention-linking path from the manual ticket-creation path.

## q5 — Procurement RBAC
Required: procurement API routes under `pages/api/procurement*` (133 files total) use `withAuth` from `@/lib/auth` as the primary wrapper (verified in adjustments/index.ts, approvals/all.ts, boq/index.ts and all others). Answer must name `withAuth` as the enforcement wrapper and list at least the key route files. No `withRole`/`withPermission` wrappers found in procurement routes — `withAuth` (session validation) is the sole enforced gate.

## q6 — drops-table writers
Required (verified via git grep -lE "INTO drops|UPDATE drops"): pages/api/activate/import-offline.ts, pages/api/activate/pp-data-resolve.ts, pages/api/activate/sync-installer-names.ts, pages/api/drops/sync-serials.ts, pages/api/projects/{projectId}/client-pos/{poId}/assign-drops.ts, pages/api/projects/{projectId}/customer-invoices/{invoiceId}.ts, pages/api/projects/{projectId}/customer-invoices/generate.ts, pages/api/sow/drops.ts, src/lib/qfield/gpkg-import-layers.ts, src/modules/activate/services/cascadePpResolution.ts, src/modules/activate/services/dr/drDropsService.ts, src/modules/activate/services/oes/oesImportService.ts, src/modules/procurement/field-stock/services/consumptionService.ts. MUST NOT confuse with qa_photo_reviews.

## q7 — deploy gate
Required: `scripts/deploy-local.sh` ordered gates — Step 1: ownership fix; Step 2: git pull (code sync); Step 3: npm ci (deps install, atomic with rollback); Step 3a: DB migrations (fail-fast before build); Step 3a': nginx config sync; Step 3b: lint gates (error/warning ratchet, Zero Tolerance); Step 4: systemctl stop service; Step 5: .next backup; Step 6: npm run build (with retry); Step 7: build validation (critical files check); Step 8: systemctl start service; Step 9: health check (HTTP status); Step 10: backup cleanup.
Verified order (grep -nE on scripts/deploy-local.sh): migrations at line 245, lint at line 309, stop at line 341, build at line 354, build-validate at line 379, start at line 413, health at line 431.

## q8 — KanbanBoard tree
Required: src/modules/noc/components/KanbanBoard/KanbanBoard.tsx (root, renders KanbanColumn per status group) → src/modules/noc/components/KanbanBoard/KanbanColumn.tsx (renders KanbanCard per ticket) → src/modules/noc/components/KanbanBoard/KanbanCard.tsx (leaf). Data source: `useTickets` hook (src/modules/noc/hooks/useTickets.ts) called at line 121 of KanbanBoard.tsx, fetching via `ticketFetchFilters` — verified by git grep "useTickets" KanbanBoard.tsx.
