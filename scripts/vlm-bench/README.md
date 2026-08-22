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
| `serials` | ONT serial OCR, back (step 6) + front (step 9) | 12-char `ALCLB4…` | `vlm_corrections` (corrected) + `ont_serial_scanned` (undisputed) |
| `categorization` | Activate install-photo step | steps 0–12 | `dr_photo_unified_reviews.vlm_categorization_results[]` per-photo human verdict |
| `civil-qa` | Construction QA civil photo step | steps 0–7 | `vlm_corrections` (module `construction_qa`) per-photo human correction |

`optical` is deliberately absent: only 48 usable rows exist, which is too thin
to distinguish a real regression from sampling noise.

### Prompts are imported, never forked

Every pack sends the exact string production sends:

- `serials` → `ONT_SERIAL_BACK_PROMPT` (back) and `STEP9_FRONT_PROMPT` (front),
  both from `src/modules/activate/services/vlmPrompts.ts`. The pack picks by the
  case's `variant`; they return different JSON shapes (`{found,serial}` vs
  `{ontSerial:{found,serial},…}`) and the scorer parses each accordingly.
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

Seeds in use: `v1` for `categorization` and `civil-qa`, **`v2` for `serials`**.
`v1` drew only 7/40 `wrong_serial_on_label` cases against a 36.8% pool rate
(~2.6 SD low), which under-represents the two-serial `S/N` vs `S/N II` failure
this pack exists to catch. Seeds v2–v6 all returned 13–15, so the sampler is
unbiased and v1 was simply an unlucky draw. The seed was changed for failure-mode
coverage BEFORE any model was run, so no score influenced the choice.

Read-only. Selection is deterministic: candidates are ordered by
`sha256(seed:key)`, not by DB order or `Math.random`, so the same seed
reproduces the same set even as new reviews land.

`serials` balances a second axis inside each stratum — 20 back / 20 front —
because front corrections outnumber back ~2:1 and an unbalanced draw would
under-test the back label, which is where the two-serial failure lives.

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
- `vlm_corrections` holds ONLY corrections — all 10,964 activate serial rows have
  `vlm_extracted_value <> corrected_value` — so it cannot supply a confirmed
  stratum. Those cases use the review's barcode-scanned `ont_serial_scanned` on
  reviews with no correction at all. Measured against the 10,881 correction rows
  that also carry a scan, that label disagrees with the photo **~1%** of the
  time, so the serials `vlm_right` stratum carries ~1% expected label noise.
- Serial cases are restricted to reviews with exactly ONE photo at the target
  step whose step a human confirmed. The step in `photos_metadata` comes from
  OneMap's `original_type` and is routinely wrong — labelling a photo that does
  not show the serial would fabricate ground truth. This drops ~85% of
  correction rows (10,964 → 904 usable).

## Scoring

`scoring/text.ts` — serials (exact match + character error rate). A `found:false`
reply scores as an abstention, recorded separately from a wrong serial: refusing
to guess and inventing a serial have very different downstream cost.
`scoring/steps.ts` — step packs. Exact step match with no partial credit for an
adjacent step, plus per-step precision/recall and a pass rate split by stratum,
both printed after a run. One aggregate number hides which step the model
confuses and whether it only passed the easy half.

## Notes
- Runs on velo (where the VLM lives) via tsx.
- DB writes use `@/lib/db-pool` (pg.Pool), never neon(). Harvest is SELECT-only.
- Output uses process.stdout (logger is silent under tsx).
