# VLM Benchmark Engine — Design Spec

**Date:** 2026-05-25
**Status:** Design approved, pending spec review
**Owner:** Hein

## Problem

Our VLM (`vllm-qwen.service`, `QuantTrio/Qwen3-VL-30B-A3B-Instruct-AWQ` on the RTX 5090) drives several production processes, but our only accuracy benchmark (`/home/velo/scripts/vllm/benchmark.sh`) covers just fleet plate/odometer + SA ID/license OCR — 6 hand-coded cases. The **primary** production use cases (Activate 10-step photo categorization, DR ONT/UPS serial extraction) are **not tested at all**. A separate `model-shootout.sh` exists for model comparison but shares no dataset or scoring with the daily benchmark, and there is no production accuracy/drift monitoring.

We want one benchmark that is **fine-tuned to our actual processes**: it tests exactly what production does, on labelled data drawn from our real work, and drives four decisions.

## Purpose (four consumers, one engine)

1. **Model-selection gate** — regression-test candidate models/quants (Qwen3.6, fresh Qwen3.5-VL, Qwen3-VL-32B-AWQ, etc.) on OUR data before swapping the live model. Successor to `model-shootout.sh`.
2. **Production drift monitor** — track live VLM accuracy over time vs human-verified labels per use case; alert when a category/serial/reading degrades.
3. **Prompt/config tuning** — A/B test prompt + config changes per use case; winners feed back into the modules.
4. **Coverage assurance** — guarantee every real process has labelled test cases; flag any use case below a minimum count.

## Scope (v1)

All current VLM use cases, each as a pluggable pack:
- **Categorization** — Activate 10-step install photo categorization (PRIMARY)
- **Serials** — DR ONT/UPS serial extraction
- **Power meter** — optical power-meter reading
- **Fleet OCR** — odometer, fuel gauge, license plate
- **Documents** — SA ID, drivers license (13-digit)
- **Construction-QA** — civil QA photo validation
- **Receipts** — receipt/expense field extraction

## Architecture

One generic **engine** + per-use-case **test packs**. The engine knows nothing about serials or odometers; it loads cases, calls the live VLM endpoint, runs the pack's scorer, and stores results.

```
vlm-bench/
  engine/        runner · scorer-registry · result-store · reporter
  packs/         categorization/ serials/ power-meter/ fleet-ocr/ documents/ construction-qa/ receipts/
  datasets/
    golden/      frozen, version-controlled cases (in-repo; image refs → VF Storage URL + sha256)
    live/        sampled-from-HITL snapshots (captured per run, replayable by snapshot id)
```

### Test-pack interface (the core unit)

```ts
interface VlmTestPack {
  id: string;                                                       // "categorization" | "serials" | ...
  loadCases(mode: "golden" | "live", opts: LoadOpts): Promise<BenchCase[]>;  // files OR HITL query
  buildPrompt(c: BenchCase, variant?: string): VlmRequest;          // the SAME prompt production uses
  score(expected: unknown, actual: unknown): CaseScore;             // use-case-specific metric
}
```

A new use case = a new folder implementing this interface. Nothing else changes.

### Deliberate decisions
- **TypeScript, in-repo, run on velo via `tsx`** — not bash. Reuses our real production code (`vlmClient`, `categorizationVlmService`, the actual prompts) so the benchmark tests *exactly* what production does. Versioned, typed, testable.
- **Critical principle:** `buildPrompt` pulls the *same prompt the module uses in production*. The benchmark must never drift from real behaviour or it stops measuring our processes. Where practical, packs import the module's prompt builder rather than copying it.
- **Retires** `benchmark.sh` and `model-shootout.sh`; the daily cron repoints to the new engine.

## Ground-truth sourcing

| Mode | Source | Reproducible? | Used by |
|------|--------|---------------|---------|
| **Golden** | Curated files in-repo: `case.json` (expected output) + image ref (VF Storage URL + sha256) | byte-identical every run | model-selection, prompt A/B, coverage |
| **Live** | `loadCases` queries HITL tables for human-verified records since last run; snapshots the sampled `{caseId, label}` set into the result record | replayable by snapshot id | drift monitor |

**Trust rule for live labels:** only pull records a human actually touched — e.g. `vlm_categorization_status='approved'` *after* a human edit, serials verified against OES/Fibertime, confirmed odometer/plate. Auto-approvals with no human in the loop are **excluded** (they would measure the model against itself).

**Golden seeding + promotion:** seed each pack from existing test images + a first hand-verified pull from HITL; thereafter any live case the model *fails* becomes a candidate for promotion into golden, so the golden set grows from real failures.

**Golden size (v1):** target **~100 cases per pack** (~600+ total) for strong statistical signal, including a usable confusion matrix for categorization.

## Scoring (each pack owns its metric; all emit a common `score_pct`)

| Pack | Primary metric | Failure signal |
|------|----------------|----------------|
| Categorization | Per-step accuracy + macro-F1 + confusion matrix | step mix-ups (e.g. 6↔8) |
| Serials (ONT/UPS) | Normalised exact-match + char-error-rate (partial credit) | digit/char drops, O↔0 |
| Power meter | Numeric exact + tolerance band | sign/decimal misreads |
| Fleet odometer | Exact + leading-digit-drop flag | 167443→47457 class |
| Fuel | Categorical bucket (E/¼/½/¾/F) | inverted E↔F |
| Documents (ID/license) | 13-digit exact-match | transposition |
| Construction-QA | Pass/fail per rule + aggregate | false-pass (worst case) |
| Receipts | Field-level: amount / date / vendor | amount errors |

## Consumers / entry points

```bash
tsx vlm-bench run --mode golden --model <endpoint>
tsx vlm-bench compare --models <a,b,c>          # model-selection (after-hours; swaps vllm-qwen per model)
tsx vlm-bench drift                             # scheduled; live model; golden + live sample
tsx vlm-bench prompt-ab --pack serials --variants <x,y>
tsx vlm-bench coverage                          # static scan; flags packs below min-N
```

| Consumer | Run | Output / action |
|----------|-----|-----------------|
| Model-selection | golden over N endpoints, stop/swap `vllm-qwen` per model | comparison table + per-pack deltas; after-hours only |
| Drift monitor | scheduled (cron, SAST) on live model: golden + fresh live sample | append time-series; alert if score drops >X% vs trailing avg OR below per-pack floor |
| Prompt A/B | golden, current model, 2+ `buildPrompt` variants | per-variant scores; winner feeds back into module |
| Coverage | static scan of packs/datasets | cases-per-use-case; flag packs below min-N (configurable warning floor, lower than the ~100 seeding target) |

## Storage & alerting

- **Result store:** Postgres table `vlm_bench_runs` (run id, mode, model id, git sha, per-pack scores JSONB, live-sample snapshot of case ids). Migration in `scripts/migrations/sql/`. Raw per-case JSON also written to disk on velo for debugging.
- **Reproducibility:** every run records git sha + model id + dataset snapshot → any run is replayable.
- **Alerting (drift):** reuse existing channels — a NOC/DevOps ticket + WA notification on regression. No new alerting infra.
- **Runtime:** runs on velo (where the VLM is) via `tsx`. Per our tsx-script gotchas: use `pg.Pool` via db-pool (neon() can't reach Supabase), and `process.stdout` for output (`@/lib/logger` is silent in Node).

## Error handling
- VLM endpoint unreachable / model not loaded → fail fast with clear message; do not record a 0% "regression" (distinguish infra failure from accuracy failure via `vlm_bench_runs.status`).
- Per-case VLM error (timeout, 400) → record as `error`, excluded from `score_pct` denominator but reported in a separate error count.
- Image ref sha256 mismatch → hard fail the run (golden corrupted/changed).
- Model-selection swaps: on any failure, the runner must restore and restart the incumbent `vllm-qwen.service` before exiting.

## Testing
- Unit tests for each pack's `score()` with crafted expected/actual pairs (incl. the known failure patterns: digit-drop, O↔0, step 6↔8, inverted fuel).
- Engine unit test with a stubbed VLM endpoint (no GPU needed) to verify load→call→score→store flow.
- Drift-alert test: inject a synthetic regression and assert the alert fires.

## Success criteria (v1)
- Every use case has a golden pack with ≥ minimum case count, scored, reproducible.
- A single command produces the model-comparison table (retires `model-shootout.sh`).
- Drift monitor runs nightly and has fired ≥1 verified alert on an injected regression.
- `benchmark.sh` retired; the daily cron points at the new engine.

## Out of scope (v2+)
- Web dashboard over `vlm_bench_runs` (data model is built to support it later).
- Automated prompt optimisation loop (this provides the scoring substrate it would use).
- Audio/video modalities.

## Open items to resolve during planning
- Exact HITL source tables + columns per pack (confirm against live schema with `\d` before writing queries).
- Drift thresholds per pack (initial floors + % drop tolerance).
- Where golden images physically live (VF Storage bucket/path) and how the runner fetches them on velo.
