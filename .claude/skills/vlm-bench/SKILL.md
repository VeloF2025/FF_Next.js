---
name: vlm-bench
description: Run the process-tuned VLM benchmark engine (scripts/vlm-bench) that scores the live VLM on FibreFlow's real use cases against labelled golden/HITL data, stores results in vlm_bench_runs, and powers model-selection, drift monitoring, prompt A/B, and coverage. USE WHEN the user says '/vlm-bench', 'run the vlm benchmark', 'benchmark the VLM', 'how accurate is the VLM', 'score the VLM', 'check VLM accuracy', 'vlm regression test', 'compare VLM models', 'is the new model better', 'VLM drift', or wants to measure/track VLM extraction accuracy on serials, categorization, fleet, or document OCR.
---

# /vlm-bench — VLM Benchmark Engine

Scores the live VLM (`vllm-qwen.service`, port 8100) on FibreFlow's real use cases using labelled cases, and stores each run in the `vlm_bench_runs` table. One generic engine + pluggable per-use-case **packs**. See `scripts/vlm-bench/` and the spec `docs/superpowers/specs/2026-05-25-vlm-benchmark-design.md`.

## Where it must run

The VLM (`:8100`) and the Supabase DB are only reachable from **velo** — never from a laptop. So the benchmark runs on velo, where the repo (`/home/velo/fibreflow-dev`) has the code, `node_modules`, and `.env.local` (DATABASE_URL). Connect: `ssh velo@100.96.203.105`.

The benchmark only reads the VLM (inference) and writes the isolated `vlm_bench_runs` table — it does **not** restart `vllm-qwen` or disrupt production. The exception is `compare` (model selection), which swaps the served model and is **after-hours only** (Plan 4, not yet built).

## Commands

Run from a checkout of the branch on velo (once merged, `/home/velo/fibreflow-dev` after a deploy). Env: `DATABASE_URL` from `.env.local`, and `VLM_API_URL=http://localhost:8100`.

```bash
# Coverage — how many golden cases per pack (no GPU/DB needed)
npx tsx scripts/vlm-bench/cli.ts coverage

# Golden run — reproducible, against the in-repo labelled set
DATABASE_URL="$DB" VLM_API_URL="http://localhost:8100" \
  npx tsx scripts/vlm-bench/cli.ts run --pack serials --mode golden
```

Output line: `run #<id> <pack> <mode>: <passed>/<scored> pass, scorePct=<n> (errors=<n>)`.
- `errors` = VLM calls that failed (infra), **excluded** from `scorePct` — distinguishes an infra problem from an accuracy problem.
- If the VLM is unhealthy, the run records a `status='infra_error'` row and exits 2 (no scores).

## Modes & packs

- **golden** — frozen, version-controlled cases (`scripts/vlm-bench/datasets/golden/<pack>/cases.json` + images, sha256-sealed). Reproducible; use for model-selection and prompt A/B.
- **live** — sampled from human-verified HITL corrections (Plan 2, not yet built).

Packs (Plan 1 ships `serials`; the rest are Plan 3): `serials`, `categorization`, `power-meter`, `fleet-ocr`, `documents`, `construction-qa`, `receipts`. Add a pack by implementing `VlmTestPack` (see `packs/serials.ts`), registering it in `cli.ts`, and adding a golden manifest.

## Reading results

```bash
# latest runs
psql "$DATABASE_URL" -c "SELECT id, mode, model, status, started_at,
  pack_scores->0->>'scorePct' AS score, pack_scores->0->>'errors' AS errors
  FROM vlm_bench_runs ORDER BY id DESC LIMIT 10;"
```

`vlm_bench_runs`: `id, mode, model, git_sha, status, started_at, pack_scores (jsonb summaries), live_snapshot, created_at`. Each run records the git sha + model id so any result is reproducible.

## Critical: prompt fidelity

A pack's `buildPrompt` MUST send the **same prompt production uses**, or the benchmark stops measuring real behaviour. Known gap (run #1, 2026-05-25): the `serials` pack uses a generic prompt while production uses the specific `ALCLB4` ONT prompt — Nokia ONT backs show two serials (`S/N: ALCLB4…` vs device `S/N II:`), so a generic prompt grabs the wrong one and scores low even though the data is correct. See `[[feedback_vlm_serial_prompt_fidelity]]`. Fixing pack prompts to match production is Plan 2.

## References
- Code: `scripts/vlm-bench/` (`README.md`, `engine/`, `packs/`, `cli.ts`)
- Spec: `docs/superpowers/specs/2026-05-25-vlm-benchmark-design.md`
- Plan 1: `docs/superpowers/plans/2026-05-25-vlm-benchmark-engine-plan1.md`
- Infra (the VLM service itself, GPU, troubleshooting): the `vlm-infra` skill.
