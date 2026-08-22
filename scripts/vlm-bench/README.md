# vlm-bench

Process-tuned VLM benchmark engine. See spec:
`docs/superpowers/specs/2026-05-25-vlm-benchmark-design.md`.

## Run
    npx tsx scripts/vlm-bench/cli.ts coverage
    npx tsx scripts/vlm-bench/cli.ts run --pack serials      --mode golden
    npx tsx scripts/vlm-bench/cli.ts run --pack categorization --mode golden
    npx tsx scripts/vlm-bench/cli.ts run --pack civil-qa     --mode golden

Typecheck (the root tsconfig excludes `scripts/**`, so this engine needs its own):

    npx tsc --noEmit -p scripts/vlm-bench

## Packs

| Pack | Task | Labels | Ground truth |
|---|---|---|---|
| `serials` | ONT serial OCR from the device back | 12-char `ALCLB4…` | hand-labelled |
| `categorization` | Activate install-photo step | steps 0–12 | `dr_photo_unified_reviews.vlm_categorization_results[]` per-photo human verdict |
| `civil-qa` | Construction QA civil photo step | steps 0–7 | `vlm_corrections` (module `construction_qa`) per-photo human correction |

`optical` is deliberately absent: only 48 usable rows exist, which is too thin
to distinguish a real regression from sampling noise.

### Prompts are imported, never forked

Every pack sends the exact string production sends:

- `serials` → `ONT_SERIAL_BACK_PROMPT` (`src/modules/activate/services/vlmPrompts.ts`)
- `categorization` → `buildCategorizationPrompt` (`src/modules/activate/services/categorizationPrompt.ts`)
- `civil-qa` → `buildPhotoPrompt` (`src/modules/construction-qa/services/constructionQaPrompt.ts`)

A copied prompt drifts silently and then the bench measures a task nobody runs.

Two deviations are pinned on purpose and apply to both step packs:

1. **No few-shot / positive / gallery sections.** Production loads these from
   tables that change daily. Including them would make two runs of the same
   golden set incomparable. The packs measure the BASE prompt.
2. **One photo per call.** Production categorization batches `VLM_BATCH_SIZE`
   photos; a per-photo golden case cannot reproduce an arbitrary batch. Batch
   effects are therefore **not** measured.

## Golden datasets

`datasets/golden/<pack>/cases.json` plus the images beside it. Every case is
sealed with a sha256 and `engine/goldenLoader.ts` hard-fails the run on a
mismatch — a silently changed image would report a score for a different
dataset under the same name.

Each case carries `expected.provenance` (`{table, rowId}`) so any disputed
label can be traced back to the row it came from.

### Harvest

    DATABASE_URL=... npx tsx scripts/vlm-bench/cli.ts harvest --pack civil-qa --size 80 --seed v1

Read-only. Selection is deterministic: candidates are ordered by
`sha256(seed:key)`, not by DB order or `Math.random`, so the same seed
reproduces the same set even as new reviews land.

The sample is **stratified 50/50**, not proportional:

- `vlm_wrong` — a human corrected the VLM. Half the set.
- `vlm_right` — a human confirmed it (activate) or a named reviewer left it
  unchanged (civil).

Corrections are ~10% of reviewed photos, so a proportional sample would be
almost all confirmations and a model that never changed its mind would still
score ~90%.

### What the ground truth is NOT

- **Not** `dr_photo_unified_reviews.step_01..step_10`. Those are DR-level
  coverage booleans; they cannot say which *photo* a human judged to be which
  step. They also describe a 10-step legacy shape, while the live prompt and
  `STEP_LABELS` use 13 steps (0–12).
- **Not** `construction_qa_reviews.civil_step_01..08`. `vlmConstructionService`
  recomputes those with `bool_or(checklist_step = N)` from the VLM's own
  classifications, so scoring against them would grade the model on its own
  output.

Known gaps, stated rather than hidden:

- Step `-1` ("Duplicate Photo") is the most common human override but is
  excluded: `buildCategorizationPrompt` only offers 0–12, so the model cannot
  answer it. Duplicates are a separate detector's job.
- `construction_qa_photos.manual_reviewed_by` is NULL for all 90,698 civil
  photos, so the civil `vlm_right` stratum rests on "a named human decided this
  review and did not correct this photo" — weaker evidence than a correction.
  Recorded per case as `expected.confirmation`.
- Civil step 8 (Signature) is unreachable: the classification prompt caps at 7.

## Scoring

`scoring/text.ts` — serials (exact match + character error rate).
`scoring/steps.ts` — step packs. Exact step match with no partial credit for an
adjacent step, plus per-step precision/recall and a pass rate split by stratum,
both printed after a run. One aggregate number hides which step the model
confuses and whether it only passed the easy half.

## Notes
- Runs on velo (where the VLM lives) via tsx.
- DB writes use `@/lib/db-pool` (pg.Pool), never neon(). Harvest is SELECT-only.
- Output uses process.stdout (logger is silent under tsx).
