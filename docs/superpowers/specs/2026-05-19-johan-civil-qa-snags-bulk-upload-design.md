# Civil QA Snag UX + Bulk Upload — Design Spec

| Field | Value |
|---|---|
| **Date** | 2026-05-19 |
| **Author** | Hein / Claude (Opus 4.7) |
| **Source** | Johan Scott WhatsApp 2026-05-19 14:29–14:30, 4 screen-recordings |
| **Branch** | `feat/johan-snags-bulk-upload-prd` |
| **Status** | Draft — awaiting Hein approval |
| **Implementation order** | P1 → P2 → P3 → P4 (one PR each, dev sign-off from Johan between phases) |

---

## 1. Problem statement

Johan (Project Manager, Velocity Fibre) reviewed Civil QA on PON 267 (Etwatwa) and recorded four blocking issues:

1. **Cannot snag photos the AI has already passed.** Once VLM-passes a photo (Before, During, Dome-on-pole, etc.), the per-photo card only offers "Override" for fails — no path to flag an AI-passed photo as bad. Johan disagrees with the AI sometimes and needs to override the pass.
2. **"Snag pole" button is binary planted-Y/N only.** The existing `ConfirmPlantedModal` (PR `e8367c189`) asks "Is pole ETW.P.H217 planted on site? Yes / No / Cancel". Johan wants to snag a pole for reasons other than "not planted" — he needs a free-text comment path that lands in the snag report.
3. **Snag reports only generate per pole.** Johan reviews work at PON and zone level. Clicking through 24 poles per PON to pull individual snag reports is unworkable. Reports must support per-pole, per-PON, and per-zone scopes mirroring the Zone → PON → Pole hierarchy already in the Field App.
4. **No bulk-folder upload + AI categorisation for non-QField photos.** Project PAL228 has 228 loose photos in a folder (no QField metadata). User must drag-and-drop each one into the correct slot. Need bulk drop → VLM auto-categorises → user confirms.

## 2. Goals & non-goals

### Goals
- Restore Johan's ability to reject AI verdicts and raise free-text snags at both photo- and pole-level.
- Generate snag reports at three granularities mirroring the existing zone/PON/pole hierarchy.
- Eliminate manual drag-and-drop of 200+ photos by reusing the Qwen3 VLM service for bulk per-pole categorisation.
- Feed every human override back into the VLM training pipeline (`qa_correction_examples`).
- Ship as four independent PRs so each piece can be Johan-validated on dev before the next lands.

### Non-goals
- Project-wide bulk upload spanning multiple poles (filename/EXIF/folder-name pole matching). Per-pole drop zone only — YAGNI; defer until per-pole flow is proven.
- New top-level module. All work lands in `works-qa`, `construction-qa`, and `lib/categorisation`.
- Mobile bulk upload. Desktop-only for P4 (Johan uses the Field App on his ultrawide desktop).
- Replacing the existing `ConfirmPlantedModal` planted-check flow. Two parallel buttons; old flow stays untouched.

## 3. Current state (verified 2026-05-19)

| Piece | Where | Behaviour today |
|---|---|---|
| Per-photo Approve/Snag | `src/modules/works-qa/components/PhotoSlotCard.tsx` | Snag button hidden when slot status is `pass` or `overridden`. Per commit `99a33c89b`. |
| Pole-level "Snag pole" | `src/modules/works-qa/components/ConfirmPlantedModal.tsx` (commit `07ded2352`, NOC auto-create `e8367c189`) | Asks "Is pole planted on site? Yes/No/Cancel". "No" creates a `verification` snag + auto-creates NOC ticket. No comment field. |
| Snag reports | `pages/api/snags/reports.ts` | Scoped by `projectId` only. No `pon_no` / `zone_no` filter. |
| `snags` table | Postgres on Supabase | Has `pole_qa_photo_id` (migration #353, commit `756268fbb`). No `slot_key`, no `scope_zone_no`, no `scope_pon_no`. |
| VLM categorisation | `photo-categorization` skill | 10-step OneMap mapping (`ph_*` → step 1–10). Civil QA buckets (Before, During, Depth, End Plates, Compaction, Level Check, After + 8 optical) are NOT in the canonical map. |
| Bulk upload | — | Does not exist. QField auto-buckets via `sync-qfield.ts`; loose folders require manual drag-drop. |

## 4. Design

### 4.1 Architecture & module shape

```
src/modules/works-qa/
├── components/
│   ├── PhotoSlotCard.tsx              [EDIT] add Snag button for all states (pass | overridden | fail)
│   ├── SnagPhotoModal.tsx             [NEW]  textarea + severity + auto-attach photo URL
│   ├── SnagPoleCommentModal.tsx       [NEW]  free-text pole snag, separate from ConfirmPlantedModal
│   ├── PoleDetailPanel.tsx            [EDIT] add second header button "⚠ Snag (other)"
│   ├── BulkUploadDrawer.tsx           [NEW]  drop-zone + VLM categorisation review grid
│   └── ReportButton.tsx               [NEW]  contextual quick-report + Advanced... link
├── hooks/
│   └── usePhotoSnag.ts                [NEW]  POST /api/snags with slot_key, optimistic SWR mutate
└── services/
    └── worksQaBulkCategoriser.ts      [NEW]  client → /api/works-qa/bulk-categorise wrapper

src/modules/construction-qa/
├── types/snag.types.ts                [EDIT] add slot_key, photo_url, scope, scope_zone_no, scope_pon_no
└── components/reports/
    └── SnagReportScopeDialog.tsx      [NEW]  multi-select zones/PONs/poles + date range + severity filter

src/lib/categorisation/
└── civilQaCategoryMap.ts              [NEW]  7 civil + 8 optical buckets, parallel to photo-categorization skill

pages/api/
├── snags/
│   ├── index.ts                       [EDIT] accept slot_key on POST/PATCH; dedup on (pole_qa_photo_id, slot_key) WHERE status='open'
│   └── reports.ts                     [EDIT] add scope=pole|pon|zone, generate scoped PDF
└── works-qa/
    ├── bulk-categorise.ts             [NEW]  POST {poleId, photo_urls[]} → VLM → {slot_key, confidence, reasoning}[]
    └── bulk-commit.ts                 [NEW]  POST {poleId, assignments: [{photo_url, slot_key}]} → writes pole_qa_photos

scripts/migrations/sql/
├── 354_snags_slot_key.sql             [NEW]  ALTER snags; partial unique index; scope columns; backfill
├── 355_snag_demotes_vlm.sql           [NEW]  TRIGGER: open photo-snag → demote slot vlm_status to 'snagged'
└── 356_snag_reports_scope.sql         [NEW]  ALTER snag_reports: scope, scope_zone_no, scope_pon_no, scope_poles
```

### 4.2 Feature 1 — Snag on AI-passed photos (P1)

**UI** (`PhotoSlotCard.tsx`):
- Add `🚩 Snag` button on every state (`pass | overridden | fail`).
- Hidden if user lacks `qa:snag:create` permission.
- Clicking opens `SnagPhotoModal` with the photo thumbnail and slot label pre-filled.

**Modal** (`SnagPhotoModal.tsx`):
- Fields:
  - `description` — required textarea, min 10 chars, max 2000.
  - `severity` — select: `minor` | `major` | `critical` (default `minor`).
  - `attach_photo_to_ticket` — checkbox, default `true`.
- On submit: `POST /api/snags` with `{pole_qa_photo_id, slot_key, category:'photo_quality', description, severity, photo_url, attach_to_noc}`.
- On 409 (dedup): modal switches to "An open snag already exists for this slot — view existing snag" with link to the existing snag UID.

**Backend** (`pages/api/snags/index.ts`):
- POST handler accepts new fields `slot_key`, `photo_url`, `category`.
- Pre-insert check: if `(pole_qa_photo_id, slot_key, status='open')` row exists, return 409 with existing id.
- Unique partial index enforces at DB level (race-safe).
- Insert row → DB trigger `snag_demotes_vlm` fires.

**DB trigger** (migration 355):
- On `INSERT OR UPDATE OF status` on `snags` where `slot_key IS NOT NULL`:
  - If `status='open'`: set `pole_qa_photos.<slot>_vlm_status = 'snagged'`, write old value to `qa_correction_examples` with `workflow_type='works_qa'`, `vlm_verdict='pass'|'overridden'`, `human_verdict='snagged'`, `correction_notes=description`.
  - If `status='resolved'` or `status='dismissed'`: recompute `<slot>_vlm_status` from the last `qa_correction_examples` row or re-run VLM-verify.
- Trigger is wrapped in `SECURITY DEFINER` with explicit `search_path`.

**Approval gate**:
- `allGatesPass()` in `src/modules/works-qa/utils/approval-gates.ts` extended: a pole fails if ANY slot has `<slot>_vlm_status='snagged'`. No change to the slot-fill or VLM-pass-or-override checks.

### 4.3 Feature 2 — Snag pole with free-text comment (P2)

**UI** (`PoleDetailPanel.tsx`):
- Header gets a second button next to existing "🚩 Snag pole" (which keeps its planted-check meaning):
  - `[🚩 Snag pole (planted check)]` — existing, opens `ConfirmPlantedModal`. Label changes to clarify intent.
  - `[⚠ Snag (other issue)]` — NEW, opens `SnagPoleCommentModal`.
- Both buttons hidden if user lacks `qa:snag:create`.

**Modal** (`SnagPoleCommentModal.tsx`):
- Fields:
  - `description` — required textarea, min 10 chars, max 2000.
  - `severity` — `minor` | `major` | `critical` (default `minor`).
  - `pole_references` — optional comma-separated list of additional pole numbers if snag affects multiple poles.
  - `attach_photo` — optional file upload (single image, max 5 MB).
  - `create_noc_ticket` — toggle, default `true` for severity ≥ minor.
- On submit: `POST /api/snags` with `{pole_qa_photo_id, category:'pole_quality', description, severity, pole_references, photo_url?, create_noc_ticket}`.
- Backend reuses existing snag→NOC ticket pipeline (commit `e8367c189`).

**Reports**:
- Pole-level snags appear under category "Pole Quality" in PDF reports (per Section 4.4).

### 4.4 Feature 3 — Per-PON / per-zone snag reports (P3)

**UI** (`ReportButton.tsx`):
- Lives in Field App pole list header.
- Primary label is context-aware: "Pole report" when a single pole is selected, "PON report" when viewing a PON, "Zone report" when viewing a zone. Driven by URL params (`zone_no`, `pon_no`, `pole_number`).
- Dropdown caret → `Advanced…` → opens `SnagReportScopeDialog`.

**Dialog** (`SnagReportScopeDialog.tsx`):
- Fields:
  - `scope` — radio: `pole | pon | zone` (default = current context).
  - `zones[]` — multi-select chip list (when scope ≠ pole).
  - `pons[]` — multi-select, filtered to selected zones.
  - `poles[]` — multi-select, filtered to selected PONs.
  - `from_date`, `to_date` — date range, default last 30 days.
  - `severity[]` — multi-select: `minor | major | critical`, default all.
  - `categories[]` — multi-select: `photo_quality | pole_quality | verification | other`, default all.
  - `format` — radio: `PDF | CSV`, default PDF.
- Submit: `POST /api/snags/reports` with all params + `format`.

**Backend** (`pages/api/snags/reports.ts`):
- New query path when `scope` provided:
  ```sql
  SELECT s.*, p.pole_number, p.zone_no, p.pon_no, p.before_photo_url, ...
  FROM snags s
  LEFT JOIN pole_qa_photos p ON p.id = s.pole_qa_photo_id
  WHERE s.project_id = $1
    AND ($2::int[] IS NULL OR p.zone_no = ANY($2))
    AND ($3::int[] IS NULL OR p.pon_no = ANY($3))
    AND ($4::text[] IS NULL OR p.pole_number = ANY($4))
    AND s.created_at BETWEEN $5 AND $6
    AND s.severity = ANY($7)
    AND s.category = ANY($8)
  ORDER BY p.zone_no, p.pon_no, p.pole_number, s.created_at;
  ```
- PDF template (Puppeteer, reuses `project_reusable_report_template`):
  - **Cover**: project name + scope summary ("Zone 24, PONs 265/266/267") + total snags by severity + Velocity Fibre logo (per [[feedback_report_tense_rectification]]).
  - **Per-zone section**: list of PONs.
  - **Per-PON section**: list of poles with ≥1 snag.
  - **Per-pole section**: pole label + photo thumbnails (snagged slots highlighted red) + snag descriptions + status + assignee + NOC ticket UID.
- CSV format: flat rows, ISO dates per [[feedback_excel_date_format]].

### 4.5 Feature 4 — Bulk per-pole VLM upload (P4)

**UI** (`BulkUploadDrawer.tsx`):
- Triggered from `PoleDetailPanel` header: `[+ Bulk upload]` button (disabled when all 21 slots filled).
- **Step 1** (Upload): drop zone or multi-file picker. Accepts JPG/PNG, **max 250 photos per upload session, max 5 MB each** (covers Johan's PAL228 case of 228 photos). If user drops > 250, the picker rejects with "Please split into multiple uploads".
- **Empty-slot guard**: by default, bulk upload only suggests empty slots. If a suggested slot is already filled, the review grid shows `[⚠ slot already filled — replace? ]` next to the row; user must explicitly check to replace. Replaced photos are archived to `pole_qa_photos_archive` for audit.
- **Step 2** (Categorise): progress bar — uploads to VF Storage at `/storage/works-qa/<projectId>/<poleId>/bulk/<filename>`, then calls `/api/works-qa/bulk-categorise`.
- **Step 3** (Review): grid sorted by confidence ascending — one row per photo:
  ```
  [thumbnail] [filename] [suggested slot ▼] [confidence: 87%] [✓ accept | ✗ reject | drag to slot]
  ```
  - Confidence ≥ 0.85 → pre-checked.
  - Confidence 0.5–0.85 → unchecked, user must explicitly accept.
  - Confidence < 0.5 → marked "unknown", user must drag to a slot or reject.
- **Step 4** (Commit): `[Commit to pole]` button → `POST /api/works-qa/bulk-commit` with accepted assignments. Writes photos to matching slots in `pole_qa_photos`. Triggers per-slot VLM-verify on each (existing `worksQaVlmService.ts`).

**Backend** (`pages/api/works-qa/bulk-categorise.ts`):
- POST `{poleId, photo_urls: string[]}` — max 250 URLs.
- Batches into VLM calls of 10 photos each (25 batches max). Batches dispatched in parallel with concurrency limit of 4 (matches VLM service `:8100` GPU capacity per [[vlm-infra]]).
- VLM prompt: *"Categorise this fibre construction photo into one of: [civil: before, during, depth, end_plates, compaction, level_check, after] [optical: dome_on_pole, dome_label, open_dome, splice_protectors, slack_management, strength_members, seals_dust_caps, pole_id]. Return JSON: {category, confidence: 0-1, reasoning}. If photo doesn't fit any category, return category='unknown'."*
- Response: `[{photo_url, suggested_slot, confidence, reasoning}]`.
- 60s timeout per batch — on timeout, mark batch as `{confidence: 0, suggested_slot: 'unknown'}` and continue (no silent failure).
- Invalid VLM response → 422, log to `vlm_errors`, return `{confidence: 0, suggested_slot: 'unknown'}` for that photo.

**Backend** (`pages/api/works-qa/bulk-commit.ts`):
- POST `{poleId, assignments: [{photo_url, slot_key}]}`.
- For each assignment: write to `pole_qa_photos.<slot>_url` and `<slot>_uploaded_at`. Trigger per-slot VLM-verify async (existing pipeline).
- Returns: `{committed: N, vlm_jobs: [job_ids]}`.

**Category map** (`src/lib/categorisation/civilQaCategoryMap.ts`):
- Single source of truth for slot_key → human label + which discipline (civil | optical | tray).
- Used by `BulkUploadDrawer`, `SnagPhotoModal`, `worksQaBulkCategoriser`, and report PDF generator.

### 4.6 Data model (migrations)

**354_snags_slot_key.sql**:
```sql
ALTER TABLE snags ADD COLUMN slot_key TEXT;
ALTER TABLE snags ADD COLUMN photo_url TEXT;
ALTER TABLE snags ADD COLUMN scope_zone_no INT;
ALTER TABLE snags ADD COLUMN scope_pon_no INT;

UPDATE snags s SET
  scope_zone_no = p.zone_no,
  scope_pon_no  = p.pon_no
FROM pole_qa_photos p
WHERE s.pole_qa_photo_id = p.id
  AND s.scope_zone_no IS NULL;

CREATE UNIQUE INDEX snags_open_slot_uniq
  ON snags (pole_qa_photo_id, slot_key)
  WHERE status = 'open' AND slot_key IS NOT NULL;

CREATE INDEX snags_scope_idx
  ON snags (project_id, scope_zone_no, scope_pon_no, status);
```

**355_snag_demotes_vlm.sql**:
```sql
CREATE OR REPLACE FUNCTION snag_demotes_vlm() RETURNS TRIGGER AS $$
DECLARE
  vlm_status_col TEXT;
  vlm_feedback_col TEXT;
  old_status TEXT;
BEGIN
  IF NEW.slot_key IS NULL OR NEW.pole_qa_photo_id IS NULL THEN
    RETURN NEW;
  END IF;

  vlm_status_col := NEW.slot_key || '_vlm_status';
  vlm_feedback_col := NEW.slot_key || '_vlm_feedback';

  IF NEW.status = 'open' AND (OLD IS NULL OR OLD.status != 'open') THEN
    -- Capture old verdict for rollback + training
    EXECUTE format(
      'INSERT INTO qa_correction_examples (workflow_type, pole_qa_photo_id, slot_key, vlm_verdict, human_verdict, correction_notes, created_at)
       SELECT ''works_qa'', $1, $2, %I, ''snagged'', $3, NOW()
       FROM pole_qa_photos WHERE id = $1',
       vlm_status_col
    ) USING NEW.pole_qa_photo_id, NEW.slot_key, NEW.description;

    EXECUTE format(
      'UPDATE pole_qa_photos SET %I = ''snagged'', %I = $1 WHERE id = $2',
      vlm_status_col, vlm_feedback_col
    ) USING NEW.description, NEW.pole_qa_photo_id;
  ELSIF NEW.status IN ('resolved', 'dismissed') AND OLD.status = 'open' THEN
    -- Mark slot as 'pending_revalidation'; queue async VLM re-run via NOTIFY
    EXECUTE format(
      'UPDATE pole_qa_photos SET %I = ''pending_revalidation'', %I = NULL WHERE id = $1',
      vlm_status_col, vlm_feedback_col
    ) USING NEW.pole_qa_photo_id;
    PERFORM pg_notify('vlm_revalidate', json_build_object(
      'pole_qa_photo_id', NEW.pole_qa_photo_id,
      'slot_key', NEW.slot_key
    )::text);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER snag_demotes_vlm_trg
  AFTER INSERT OR UPDATE OF status ON snags
  FOR EACH ROW EXECUTE FUNCTION snag_demotes_vlm();
```

**356_snag_reports_scope.sql**:
```sql
ALTER TABLE snag_reports
  ADD COLUMN scope TEXT NOT NULL DEFAULT 'project',
  ADD COLUMN scope_zone_no INT,
  ADD COLUMN scope_pon_no INT,
  ADD COLUMN scope_poles TEXT[];

CREATE INDEX snag_reports_scope_idx
  ON snag_reports (project_id, scope, scope_zone_no, scope_pon_no);
```

### 4.7 RBAC

Permission keys (registered in `pages/api/_permissions/seed.ts` per `/audit-rbac` skill convention):

| Action | Permission key | super_admin | manager | project_manager | technician | viewer |
|---|---|:-:|:-:|:-:|:-:|:-:|
| Snag any photo (incl. AI-pass) | `qa:snag:create` | ✓ | ✓ | ✓ | ✓ | ✗ |
| Snag pole (comment) | `qa:snag:create` | ✓ | ✓ | ✓ | ✓ | ✗ |
| Resolve / dismiss snag | `qa:snag:resolve` | ✓ | ✓ | ✗ | ✗ | ✗ |
| Generate snag report | `qa:report:read` | ✓ | ✓ | ✓ | ✗ | ✓ |
| Bulk upload photos | `qa:photo:upload` | ✓ | ✓ | ✓ | ✓ | ✗ |

Explicit deny rows for `technician` and `viewer` on `qa:snag:resolve` per [[feedback_rbac_parent_override_cascade]] — parent `qa:view=true` would otherwise cascade.

Additional approver allow-list for `qa:snag:resolve`: Chantall, Jacques White (per [[project_snag_qa_approvers]]).

### 4.8 Error handling

| Failure mode | Behaviour | Reference |
|---|---|---|
| Snag dedup race | 409 with existing snag id + message | [[feedback_check_existing_ticket]] |
| Missing `photo_url` on photo-snag POST | 400, modal keeps state, inline error | — |
| VLM bulk-categorise timeout (60s/batch) | Mark batch as `confidence=0, slot='unknown'`, continue | [[feedback_trace_actual_error]] |
| VLM returns invalid category | 422, log to `vlm_errors`, return unknown for that photo | — |
| Report PDF generation failure | 503 + retry-after; frontend offers CSV fallback | — |
| Snag-demote trigger fails | Snag insert ROLLED BACK; user sees error | — |
| Bulk-commit writes partial rows | Wrap in TX; on any per-slot failure, ROLLBACK + return per-photo error map | [[feedback_data_safety]] |
| User snags AI-pass photo without permission | 403, button hidden in UI (defense in depth) | — |

No silent failures. Every error path logs to `errors.isaflow.co.za` (Bugsink) with `project_id`, `pole_qa_photo_id`, `slot_key` tags.

### 4.9 Testing strategy

| Layer | Tests |
|---|---|
| **Unit** | `allGatesPass()` with snagged-slot fixtures; `civilQaCategoryMap` slot lookups; report aggregation SQL on fixture data; `usePhotoSnag` hook with mocked SWR |
| **Integration** | `POST /api/snags` with `slot_key` → row + demote trigger + `qa_correction_examples` entry (real DB per [[feedback_qa_standards]]); `POST /api/works-qa/bulk-categorise` hits live VLM on `:8100` with a known photo set |
| **E2E (Playwright)** | (a) Snag a VLM-pass photo → gate fails → resolve → slot status flips to `pending_revalidation` → VLM re-runs → gate passes; (b) Generate per-PON report → PDF contains all snags in PON 267; (c) Bulk upload 50 + 100 photos to a pole → review grid → commit → slots filled; (d) Bulk upload where suggested slot is already filled → replace confirmation flow |
| **Regression** | Existing 5 `ConfirmPlantedModal` test cases stay green; `allGatesPass` test suite stays green; existing snag→NOC ticket flow from `e8367c189` unchanged |
| **VLM accuracy** | Track `vlm_bulk_categorise_accuracy` metric: (correct slot per human review) / total. Target ≥ 80% at GA. Per [[vlm-serial-accuracy]] feedback loop. |
| **Manual** | Johan signs off on dev (dev.fibreflow.app) before each phase merges to production. |

### 4.10 Observability

- All 4 features tagged in Bugsink (`feature:works-qa-snag-ai-pass | feature:snag-pole-comment | feature:snag-reports-scope | feature:bulk-categorise`).
- Logs to `@/lib/logger` at INFO for happy path, WARN for dedup hits, ERROR for VLM failures.
- VLM bulk-categorise latency tracked in Grafana dashboard `vlm-bulk-latency` (new panel).
- Snag creation rate per category tracked; alert if >50 photo-snags/day (signals VLM degradation per [[project_vlm_ups_hallucination]]).

## 5. Rollout plan

| # | PR title | Branch | Migration | Estimated effort |
|---|---|---|---|---|
| **P1** | `feat(works-qa): snag AI-passed photos with VLM demote` | `feat/works-qa-snag-ai-pass` | 354, 355 | 1–2 days |
| **P2** | `feat(works-qa): snag pole with free-text comment` | `feat/works-qa-snag-pole-comment` | — | 1 day |
| **P3** | `feat(snags): per-PON and per-zone snag reports` | `feat/snags-scoped-reports` | 356 | 2 days |
| **P4** | `feat(works-qa): bulk-folder upload with VLM categorisation` | `feat/works-qa-bulk-categorise` | — | 3–4 days |

**Per-PR gates**:
1. `npm run ci:quick` passes locally (lint ratchets per [[project_local_ci_pipeline]]).
2. PR opened, GHA on self-hosted runner passes.
3. `/review` (blind reviewer, fresh Agent, no session context) approves.
4. Merge → `bash scripts/deploy-local.sh dev`.
5. Johan WA confirmation on dev.fibreflow.app.
6. Production deploy after-hours with Hein's explicit approval.

## 6. Risks & mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Demote trigger breaks existing snag flows | Medium | High | Comprehensive trigger tests + manual smoke on dev before P1 prod deploy. Migration is reversible (drop trigger, restore `vlm_status` from `qa_correction_examples`). |
| VLM accuracy < 80% on bulk-categorise | Medium | Medium | Confidence thresholds force manual review for ambiguous photos. Confidence < 0.5 = mandatory user action. Track accuracy, retrain when < 80%. |
| Dedup race produces 409s in normal use | Low | Low | UI shows "view existing snag" link instead of error. Existing snag becomes editable. |
| Report PDF generation OOMs on large zones | Low | Medium | Cap report at 500 snags. CSV fallback for larger scopes. Test with PAL228 + Etwatwa Zone 24 (largest known). |
| RBAC parent-cascade kills technician access | Medium | High | Explicit deny rows on `qa:snag:resolve` for technician/viewer per existing pattern in `2c93d2821`. Manual RBAC audit before P1 deploy. |
| Conditional SQL via Neon shim breaks scoped report query | Medium | Medium | Use `pg.Pool` directly (per CLAUDE.md tech debt note); avoid `sql\`AND x\`` patterns. |

## 7. Open questions

None at spec-write time. All UX decisions locked via AskUserQuestion 2026-05-19.

## 8. References

- Source: Johan Scott WhatsApp 2026-05-19 14:29–14:30 (4 screen-recordings, `/tmp/johan-videos/`)
- Existing snag/works-qa code: commits `99a33c89b`, `07ded2352`, `e8367c189`, `756268fbb`, `c388c4c42`, `2c93d2821`
- Related memory: [[feedback_snag_report_granularity]], [[feedback_check_existing_ticket]], [[feedback_qa_standards]], [[feedback_rbac_parent_override_cascade]], [[project_snag_qa_approvers]], [[project_snags_module]], [[project_reusable_report_template]]
- Related skills: `photo-categorization`, `vlm-serial-accuracy`, `civil-qa`, `pr-pipeline`, `audit-rbac`
