# Works QA ↔ QField ingestion: onboard HT projects + close the systemic gap

**Date:** 2026-07-14
**Branch:** `feat/worksqa-qfield-ingest-automation`
**Author:** Claude (with Hein)

## Problem

`/field-ops/works-qa` only shows a project once its pole photos have been ingested
into FibreFlow (`qfield_photo_validations` → `works-qa/sync-qfield` → `pole_qa_photos`).
That ingestion is done by `scripts/extract-gpkg-photos.py`, which is:

1. **Hardcoded** to 8 projects (`PROJECTS` / `ALTERNATE_GPKGS` / `OPTICAL_GPKGS` dicts), and
2. **Manual** — it is not scheduled on any cron.

Consequence: projects that became active today have **543 (Mahikeng) + 7 (Ben Farm)
photos sitting in QFieldCloud/MinIO but zero in Works QA**, and the wired-up projects
run a few hundred photos behind (Etwatwa ≈880, Mamelodi ≈470, Thembelihle ≈274,
Thembisa POP 1 ≈230, POP 3 ≈114). A newly-active project is **silently** invisible.

### Root technical detail — HT schema step offset

HT_Mahikeng's `Civil audit.gpkg` (`civil_audit` table, 4,290 rows, label in the
**`Name`** column, e.g. `HT_MFKGP4_D2964PL`) is a standard civil-audit form **except**
the field team added a `1. Permission Slip Photo` column at the front, shifting every
photo-step number by +1 (their `2. Before Photo` = standard step 1 … `9. Clear Photo
of Pole Label` = standard step 8). The extractor's `STEP_PATTERNS` anchor on **both**
the leading number `^<n>` **and** a keyword, so against HT's shifted numbering they
fail to match — only `8. After photo` matches (wrongly, as the label pattern).

### Root technical detail — aliased QField projects

HT_Mahikeng is *aliased*: `qfield_projects.id` (`53ee8e7c…`) ≠ `qfield_project_id`
(`e801cd43…`). The dashboard's `pole_universe` branch-1 uses a **direct** join
(`l.qfield_project_id = q.project_id`) and therefore does **not** surface aliased
projects from `qfield_photo_validations` alone. `works-qa/sync-qfield` does the correct
two-hop translation into `pole_qa_photos` (dashboard branch-2). **Extraction alone is
insufficient — the Works-QA sync must also run** for aliased projects to appear.

## Goals

1. Get Mahikeng (543) + Ben Farm (7) photos into Works QA now.
2. Make ingestion self-sustaining: a newly-active project is **never silently** missing.
3. Do not regress the 8 already-working projects.

Non-goals: zero-config auto-detection of GPKG structure (rejected — heuristic
mis-detection risks polluting pole labels on the shared prod DB); a Works-QA UI banner;
optical/dome schema changes.

## Design

### A. Step detection — keyword-driven (number-agnostic)

Change `detect_step_columns()` matching so a column maps to a step by **keyword only**,
evaluated in ascending step order (so `after/picture` → 7 wins before the label pattern
can claim `8. After photo`). Keyword → step map:

| step | keyword regex fragment |
|------|------------------------|
| 1 | `before` or `mark` |
| 2 | `during` or `digging` |
| 3 | `depth` or `measuring` |
| 4 | `end.?plate` or `visible` |
| 5 | `compact` or `backfill` |
| 6 | `level` or `spirit` |
| 7 | `after` or `picture` |
| 8 | `label` (civil pole-label photo) |

The leading-number anchor is dropped. This maps FT columns (`1. Before…`) and HT columns
(`2. Before…`) identically. `1. Permission Slip Photo` has no keyword → falls through to
the unassigned bucket (no Works-QA slot exists for a permission slip — correct).
Optical (`OPTICAL_STEP_PATTERNS`) is left unchanged (its keywords already disambiguate).

**Test:** unit test `detect_step_columns()` over both the FT column set and the HT
(shifted) column set, asserting identical step→discipline mappings and that
`Permission Slip` is unmapped.

### B. Register Mahikeng + Ben Farm

Add to `PROJECTS`:
- Mahikeng: `qf_project_id=e801cd43…`, `ff_project_id=7794d0ba…`, `gpkg_path="Civil audit.gpkg"`, `table_name="civil_audit"`, `label_col="Name"`.
- Ben Farm: `qf_project_id=ef0b7147…`, `ff_project_id=67df5c8d…`, `gpkg_path="Civil audit.gpkg"`, `table_name="civil_audit"`, `label_col="Name"` (verify GPKG/table/label at run time; fall back to coverage alert if absent).

### C. Immediate backfill (run against prod from the branch)

`extract-gpkg-photos.py --project Mahikeng --dry-run` (inspect detected step columns +
photo counts) → live → Works-QA sync for Mahikeng → verify 543 rows land and Mahikeng
appears on `/field-ops/works-qa`. Repeat for Ben Farm.

### D. Cron automation (velo)

New wrapper `scripts/cron/worksqa-qfield-ingest.sh`, scheduled 4×/day aligned with the
existing `cron-classify-photos.sh` window:

1. `extract-gpkg-photos.py --all` (registered projects; existing dedup makes it
   idempotent and clears the standing backlogs).
2. Trigger the Works-QA sync for every active linked project (step E).
3. **Coverage-check** (never-silent guarantee): for each active, non-archived FF project
   linked to a QField project, compare the QFieldCloud DCIM count (source of truth, via
   `docker exec qfieldcloud-db-1 psql …`) against `qfield_photo_validations` count. Any
   project with upstream photos but `0` ingested → **WARN** to the cron log **and** a
   single summary WhatsApp message to the **Velo Test** group
   (`120363421664266245@g.us`) via the existing bridge (`72.61.197.178:8083/send-message`).

### E. Cron-triggering the Works-QA sync

`works-qa/sync-qfield` is `withAuth`/`withPermission` and not cron-callable. Refactor its
core loop into a shared module (`src/modules/works-qa/services/syncQfieldCore.ts`) called
by both the existing endpoint and a new `pages/api/cron/works-qa-sync.ts` guarded by
`CRON_SECRET` (matching the existing `/api/cron/*` pattern), which runs the sync for all
active linked projects (or a single `project_id` from the body).

### F. Namakgale

No QField project/link exists yet — nothing to ingest. When it gets one with photos, the
coverage-check (D3) flags it. No action now.

## Verification / success criteria

- `detect_step_columns` unit test green for FT + HT column sets.
- Dry-run for Mahikeng reports 8 civil step columns detected and ~63 poles with photos.
- After live run + sync: `pole_qa_photos` for Mahikeng FF (`7794d0ba…`) is non-zero and
  Mahikeng appears on the Works-QA dashboard with civil photos populated.
- `/api/cron/works-qa-sync` returns per-project synced counts under `CRON_SECRET`.
- Coverage-check WARNs for any linked/active project with upstream-but-0-ingested.
- `npm run ci:quick` passes.

## Rollout

- Code lands via PR (blind review + CI) → deploy to dev → cron installed on velo.
- The immediate Mahikeng/Ben Farm backfill is a data op run from the branch against the
  shared prod DB (dry-run evidence first, then live). It is independent of the code
  deploy and can run once the extractor change is reviewed.

## As-built notes (deltas from the design above)

The implementation refined several points during build + blind review (PR #2162):

- **§A step detection — leading-word, not keyword-anywhere.** Matching keys on the
  *leading word right after the number* (`^\d+[.\s]*before`), not a keyword appearing
  anywhere (`^\d+.*before`). Keyword-anywhere mis-fires on the verbose descriptions
  ("3. Depth Photo … mark our poles … before planting" contains "mark"/"before").
  Step 8's keyword is **`clear`** (not `label` — the column is "Clear Photo of Pole
  Label", and a leading-word `label` anchor wouldn't match it). Each step also accepts
  the old synonym leading words (mark/digging/measuring/plate/backfill/spirit/picture)
  for forward-robustness. The pattern tables + `detect_step_columns` live in a pure,
  dependency-free `scripts/qfield_step_detection.py` so the test can gate CI without a
  DB (wired into `scripts/ci-local.sh` Gate 2d).
- **Verified no regression.** `extract-gpkg-photos.py --all --dry-run` was diffed
  old-vs-new across all 8 registered projects: every photo-bearing column detects
  identically. The only change is Themb'elihle's optical `8. Final SJC photo…` moving
  from a civil misclassification to the correct optical step 8 (and it holds 0 photos).
- **§B Ben Farm NOT registered.** Its civil audit is split across three team GPKGs
  (`Civil Audit (BF|LLK|MT).gpkg`) with inconsistent table names and only ~7 photos;
  left to the coverage-check to flag when it crosses the threshold.
- **§E — CLI, not a `CRON_SECRET` HTTP endpoint.** The sync core is invoked directly by
  `scripts/works-qa-sync.ts` (a headless tsx CLI, `--all-active` / `--project`), which
  the cron runs. No `pages/api/cron/works-qa-sync.ts` was built — the CLI needs no HTTP
  surface (velo has DB access), which is simpler and lower-risk. Per-project errors are
  isolated so one bad project doesn't starve the batch.
- **§D3 coverage-check covers BOTH halves.** It flags an **extract gap** (QFieldCloud
  DCIM ≥ threshold but 0 in `qfield_photo_validations`) AND a **sync gap** (extracted
  but `pole_qa_photos` empty — the aliased-project failure mode). Threshold default 20
  (noise suppression); self-checks that the `DCIM/%` query returns rows.
