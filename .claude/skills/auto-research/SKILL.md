---
name: auto-research
description: Self-improving optimizer using iterative eval loops. Improve skills, VLM prompts, SQL queries, API performance, page load times, bundle size, and any measurable target. USE WHEN user says 'auto-research', 'improve skill', 'optimize skill', 'optimize VLM', 'optimize query', 'improve performance', 'speed up', 'reduce bundle', 'improve accuracy', 'eval loop', 'self-improving', 'benchmark', or wants to iteratively improve anything measurable.
disable-model-invocation: true
argument-hint: <target> [--mode skill|vlm|sql|perf|bundle|lighthouse|custom] [--runs N] [--batch N]
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, Agent
---

# /auto-research — Self-Improving Optimizer

Iteratively improve any measurable target by running it, evaluating against binary criteria, mutating, and keeping the winner. Based on [Andrej Karpathy's auto-research methodology](https://github.com/karpathy/auto-research).

## Core Concept

```
┌─────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│   Run    │───▶│ Evaluate │───▶│  Score   │───▶│  Mutate  │──┐
│  target  │    │ vs Evals │    │  /total  │    │  target  │  │
└─────────┘    └──────────┘    └──────────┘    └──────────┘  │
     ▲                                                        │
     └────────────────── Keep Winner ─────────────────────────┘
```

## Three Ingredients (always required)

1. **Objective metric** — A number you can measure (not vibes)
2. **Measurement tool** — Automated, reliable, no human in the loop
3. **Something to change** — The prompt, query, code, or config being optimized

## Usage

```
/auto-research <target> --mode <mode>
/auto-research dr-categorization --mode vlm --runs 10 --batch 20
/auto-research activate-stats --mode sql --runs 5
/auto-research activate --mode lighthouse --runs 3
/auto-research typescript-fixer --mode skill --runs 5 --batch 5
/auto-research <target> --mode custom --metric "time_ms" --measure "curl -w '%{time_total}' ..."
```

| Parameter | Default | Description |
|-----------|---------|-------------|
| `target` | required | What to optimize (skill name, service name, page path, etc.) |
| `--mode` | `skill` | Optimization mode (see modes below) |
| `--runs` | `5` | Number of optimization iterations |
| `--batch` | `5` | Samples per iteration (more = less noise) |
| `--interval` | `0` | Pause between iterations (e.g., `2m`, `5m`) |

---

## Optimization Modes

### Mode: `skill` — Skill Prompt Optimization

**What changes:** SKILL.md prompt instructions
**Metric:** Eval pass rate (binary criteria)
**Measurement:** Run skill N times, evaluate each output

```
/auto-research typescript-fixer --mode skill --runs 5 --batch 5
```

**Process:**
1. Read `.claude/skills/<target>/SKILL.md`
2. Design binary eval criteria for skill outputs
3. Run skill `--batch` times, score against evals
4. Mutate prompt, re-run, keep winner
5. Backup original as `SKILL.md.original`

### Mode: `vlm` — VLM Prompt Optimization

**What changes:** VLM extraction/categorization prompts in source code
**Metric:** Accuracy % against ground truth data
**Measurement:** Compare VLM outputs to known-correct values in database

```
/auto-research serial-extraction --mode vlm --runs 10 --batch 20
/auto-research dr-categorization --mode vlm --runs 10 --batch 20
/auto-research plate-reading --mode vlm --runs 5 --batch 10
```

**FibreFlow VLM targets:**

| Target | Prompt Location | Ground Truth Source | Metric |
|--------|----------------|---------------------|--------|
| `serial-extraction` | `src/services/vlm/vlmExtractionService.ts` → `buildExtractionPrompt()` | `foto_ai_reviews` where `manual_serial IS NOT NULL` | Match rate % |
| `dr-categorization` | `src/services/vlm/categorizationVlmService.ts` → `buildCategorizationPrompt()` | `qa_correction_examples` (HITL corrections) | Step accuracy % |
| `plate-reading` | `src/services/fleet/fleetVlmService.ts` | `fleet_checkins` where `plate_manual IS NOT NULL` | Match rate % |
| `power-meter` | `src/services/vlm/vlmExtractionService.ts` | `foto_ai_reviews` where `manual_power IS NOT NULL` | Match rate % |
| `odometer` | `src/services/fleet/fleetVlmService.ts` | `fleet_checkins` where `odometer_manual IS NOT NULL` | Match rate % |
| `civil-qa` | `src/services/vlm/vlmConstructionService.ts` | QA overrides (human pass vs AI fail, and vice versa) | F1 score |

**Process:**
1. Read the prompt-building function from source code
2. Query ground truth data from database (N random samples)
3. Run VLM with current prompt against each sample
4. Compare VLM output to ground truth, calculate accuracy
5. Mutate the prompt (add examples, clarify instructions, adjust constraints)
6. Re-run, compare accuracy — keep the winner
7. Write improved prompt back to source file

**Eval criteria for VLM (binary per sample):**
- Did the extracted value match ground truth exactly?
- Did the extracted value match after normalization (trim, case, dashes)?
- Was the confidence score above threshold?
- Did it avoid hallucinating a value when image was unclear?

### Mode: `sql` — Query Performance Optimization

**What changes:** SQL queries in service files
**Metric:** Execution time (ms) via `EXPLAIN ANALYZE`
**Measurement:** Run query N times, take median execution time

```
/auto-research activate-stats --mode sql --runs 5
/auto-research reporting-zones --mode sql --runs 5
```

**FibreFlow SQL targets:**

| Target | File | Description |
|--------|------|-------------|
| `activate-stats` | `src/services/reportingService.ts` | Zone/PON aggregation queries |
| `project-dashboard` | `pages/api/projects/[projectId]/dashboard.ts` | Project stats rollup |
| `dr-lookup` | `src/modules/ticketing/services/drLookupService.ts` | DR search queries |
| `boq-utilization` | `pages/api/projects/[projectId]/boq-utilization.ts` | BOQ line aggregation |
| `kpi-queries` | `src/services/kpiService.ts` | KPI analytics |

**Process:**
1. Extract target query from source file
2. Run `EXPLAIN ANALYZE` to get baseline execution time
3. Analyze the query plan for bottlenecks (seq scans, nested loops, sort spills)
4. Mutate: add indexes, rewrite JOINs, add CTEs, adjust WHERE clauses
5. Re-run `EXPLAIN ANALYZE`, compare median time across `--batch` runs
6. Keep the faster version
7. If index changes needed, generate migration SQL

**Eval criteria for SQL (binary):**
- Is execution time < previous best?
- Does query return identical results to original? (row count + spot check)
- No sequential scans on tables > 10k rows?
- Estimated cost < previous best?

### Mode: `perf` — API Response Time Optimization

**What changes:** API route handler code, database queries, caching
**Metric:** Response time (ms) p50/p95
**Measurement:** `curl` with timing, repeated N times

```
/auto-research /api/activate/stats --mode perf --runs 5 --batch 10
/auto-research /api/projects --mode perf --runs 5 --batch 10
```

**Process:**
1. Identify the API route file from the path
2. Baseline: hit endpoint `--batch` times, record response times
   ```bash
   for i in $(seq 1 $BATCH); do
     curl -s -o /dev/null -w "%{time_total}" \
       -H "Cookie: $SESSION_COOKIE" \
       "http://localhost:3004$ENDPOINT"
   done
   ```
3. Analyze: read the route handler, find bottlenecks
4. Mutate: optimize queries, add caching, reduce payload size, parallelize DB calls
5. Re-run timing, compare p50/p95 — keep the winner
6. Log all changes and timing results

**Eval criteria for API perf (binary):**
- Is p95 response time < previous best?
- Does response body still match expected schema?
- No new TypeScript errors introduced?
- No new `console.log` statements?

### Mode: `bundle` — Bundle Size Optimization

**What changes:** Imports, dynamic imports, tree-shaking, component splitting
**Metric:** Bundle size (KB) per route
**Measurement:** `next build` + `@next/bundle-analyzer`

```
/auto-research bundle --mode bundle --runs 3
```

**Process:**
1. Run `npm run build` and capture route sizes from output
2. Identify largest routes/chunks
3. Mutate: convert static imports to dynamic, split heavy components, remove unused deps
4. Re-build, compare sizes — keep reductions that don't break functionality
5. Verify with `npm run type-check` after each mutation

**Eval criteria (binary):**
- Is total JS bundle size < previous best?
- Does `npm run build` succeed without errors?
- Does `npm run type-check` pass?
- No increase in any individual route size > 5%?

### Mode: `lighthouse` — Page Performance Optimization

**What changes:** Page components, loading strategies, image optimization, CSS
**Metric:** Lighthouse performance score (0-100)
**Measurement:** Chrome Lighthouse CLI or DevTools audit

```
/auto-research /activate --mode lighthouse --runs 3
/auto-research /procurement --mode lighthouse --runs 3
```

**Process:**
1. Start dev server on port 3004 (or use dev.fibreflow.app)
2. Run Lighthouse audit:
   ```bash
   npx lighthouse "http://localhost:3004$PAGE" \
     --output json --output-path /tmp/lighthouse.json \
     --chrome-flags="--headless --no-sandbox" \
     --only-categories=performance
   ```
3. Extract scores: Performance, FCP, LCP, TBT, CLS
4. Analyze: find largest render-blocking resources, unoptimized images, layout shifts
5. Mutate: lazy load components, optimize images, defer scripts, reduce CLS
6. Re-run Lighthouse — keep improvements
7. Verify build still passes

**Eval criteria (binary):**
- Performance score > previous best?
- LCP < 2.5s?
- CLS < 0.1?
- TBT < 200ms?
- FCP < 1.8s?
- No new TypeScript/build errors?

### Mode: `custom` — Bring Your Own Metric

For anything not covered by the built-in modes.

```
/auto-research <target> --mode custom --metric "reply_rate" --measure "curl -s api.instantly.ai/..."
```

**You provide:**
- `--metric`: What you're measuring (name for the log)
- `--measure`: Shell command that outputs the metric value
- `--target-file`: File to mutate (prompt, config, template, etc.)

---

## General Workflow (All Modes)

### Phase 1: Setup

1. **Identify target** and optimization mode
2. **Read current state** of the target (file, query, prompt)
3. **Design eval criteria** (or use mode defaults above)
4. **Ask user to review/approve** the eval suite before proceeding
5. **Back up original** (`.original` suffix)

### Phase 2: Baseline

1. Run measurement `--batch` times
2. Record baseline metric
3. Log to `auto-research-log.md` in target directory (or `.claude/skills/auto-research/logs/`)

### Phase 3: Iteration Loop

For each iteration (1 to `--runs`):

1. **Analyze failures** from previous run
2. **Mutate the target** — make one focused change per iteration
3. **Run measurement** `--batch` times
4. **Compare to previous best:**
   - Better → keep mutation, update best
   - Worse or equal → revert
5. **Log iteration** with metric, change description, kept/reverted

### Phase 4: Results

Write results log:

```markdown
# Auto-Research Results: <target>

## Summary
| Metric | Baseline | Final | Improvement |
|--------|----------|-------|-------------|
| [metric] | X | Y | +Z% |

## Date: YYYY-MM-DD
## Mode: <mode>
## Iterations: N (M kept, P reverted)

## Iteration Log
| Run | Metric | Change Made | Result |
|-----|--------|-------------|--------|
| 0 (baseline) | 1100ms | — | — |
| 1 | 450ms | Added index on drops.project_id | kept |
| 2 | 480ms | Removed unnecessary JOIN | reverted |
| 3 | 320ms | Parallelized 2 queries | kept |

## Best Version Diff
[Show what changed from original to best]

## Remaining Bottlenecks
[What couldn't be improved and why]
```

Report to user with before/after comparison.

---

## FibreFlow Quick Start Recipes

### Improve VLM serial extraction accuracy
```
/auto-research serial-extraction --mode vlm --runs 10 --batch 20
```
Pulls 20 random photos with known serials, tests current prompt, mutates, keeps winner.

### Speed up activate stats page
```
/auto-research activate-stats --mode sql --runs 5
```
Benchmarks the zone/PON aggregation queries, tries index and query rewrites.

### Optimize procurement page load
```
/auto-research /procurement --mode lighthouse --runs 3
```
Runs Lighthouse, identifies render-blocking resources, optimizes iteratively.

### Reduce JS bundle size
```
/auto-research bundle --mode bundle --runs 3
```
Analyzes `next build` output, applies dynamic imports and tree-shaking.

### Speed up DR lookup API
```
/auto-research /api/activate/dr-lookup --mode perf --runs 5 --batch 10
```
Hits the endpoint with timing, optimizes the handler code.

### Improve any skill
```
/auto-research typescript-fixer --mode skill --runs 5 --batch 5
```
Runs the skill 5 times per iteration, scores outputs, mutates prompt.

### Custom: optimize email reply rate
```
/auto-research cold-email --mode custom \
  --metric "reply_rate" \
  --measure "curl -s api.instantly.ai/analytics" \
  --target-file templates/outreach.md
```

---

## Eval Design Rules

- **Binary only** — yes/no, pass/fail. No scales (1-7), no subjective ratings
- **Specific** — "query time < 200ms" not "query is fast"
- **Not too narrow** — Too many rigid constraints cause gaming
- **4-8 criteria** is the sweet spot per mode
- **Automated** — if a human has to judge, it's not an eval, it's a review
- **Deterministic** — same input should produce same eval result

## Important Notes

- **Always backs up** the original before mutating
- **One change per iteration** — isolates what worked
- **Reverts on regression** — never keeps a worse version
- **Costs scale** with batch size × runs × target complexity
- Start with `--batch 3 --runs 3` to validate your eval suite cheaply
- Results compound: pass the log to a smarter model next time
- For VLM mode: ensure the dev server is running (`PORT=3004 npm run dev`)
- For SQL mode: queries run against production DB — mutations are READ-ONLY until approved
- For perf/lighthouse: run against localhost or dev, never production during business hours
