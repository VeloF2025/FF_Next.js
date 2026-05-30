# CodeGraph A/B Benchmark Pilot — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce FibreFlow-specific cost/time/token/tool-call evidence for whether to adopt `colbymchenry/codegraph`, via a formal with/without A/B benchmark with a blind correctness gate.

**Architecture:** A bash harness runs `claude -p` headlessly for 8 fixed questions × 2 arms (CodeGraph MCP on / empty MCP config) × 4 runs = 64 runs, parsing each run's JSON for cost/time/tokens/tool-calls. A separate blind judge agent scores answer correctness against pre-authored rubrics. An analysis step tabulates medians and applies the decision rule.

**Tech Stack:** `claude` CLI (headless `-p`, `--strict-mcp-config`, `--output-format json`), `@colbymchenry/codegraph` (npm, MCP server), `jq`, bash.

**Spec:** `docs/superpowers/specs/2026-05-30-codegraph-pilot-design.md`

**Working location:** All artifacts live under `docs/superpowers/benchmarks/2026-05-30-codegraph/` and `scripts/codegraph-bench/` in a worktree off `origin/master`. `.codegraph/` is gitignored. Pin and record the benchmark commit SHA + model id in results.

---

## Pre-flight facts (verified 2026-05-30)

- `claude` = `/home/hein/.local/bin/claude` v2.1.157; `node` v20.20.1; `npm` 10.8.2; `jq` 1.7 — all present.
- Rubric anchors verified to exist:
  - Q2 → `recordVlmCorrection` defined at `src/services/vlmLearningService.ts:42`, **11 call sites** across construction-qa / fleet / qfield / system / activate / data-sync / projects. (Original spec said `promoteSerial`; that symbol no longer exists in the tree — **swapped to `recordVlmCorrection`**, a real bounded caller/callee graph.)
  - Q3 → `src/lib/neon-shim.ts`, `lib/db/pool.js`.
  - Q6 → writers incl. `pages/api/activate/{import-offline,pp-data-resolve,sync-installer-names}.ts`.
  - Q7 → `scripts/deploy-local.sh`.
  - Q8 → `src/modules/noc/components/KanbanBoard/{KanbanBoard,KanbanCard,KanbanColumn}.tsx`.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `scripts/codegraph-bench/questions.tsv` | The 8 fixed questions (id ⇥ text). Single source of truth for the run loop. |
| `scripts/codegraph-bench/rubrics.md` | Expected files/symbols per question (correctness ground truth). |
| `scripts/codegraph-bench/empty-mcp.json` | Empty MCP config (WITHOUT arm). |
| `scripts/codegraph-bench/with-mcp.json` | CodeGraph MCP config (WITH arm). |
| `scripts/codegraph-bench/run-bench.sh` | Runs 64 headless `claude -p` runs, saves raw JSON + parsed CSV row per run. |
| `scripts/codegraph-bench/judge.sh` | Dispatches the blind judge per answer, writes correctness CSV. |
| `scripts/codegraph-bench/analyze.sh` | Joins run + judge CSVs, computes medians + deltas, emits results markdown. |
| `docs/superpowers/benchmarks/2026-05-30-codegraph/` | Output dir: raw JSON, `runs.csv`, `correctness.csv`, `results.md`. |

---

## Task 1: Scaffold + isolation guardrails

**Files:**
- Create: `scripts/codegraph-bench/.gitignore`
- Modify: repo root `.gitignore`

- [ ] **Step 1: Create the bench output + script dirs**

Run:
```bash
mkdir -p scripts/codegraph-bench docs/superpowers/benchmarks/2026-05-30-codegraph/raw
```

- [ ] **Step 2: Gitignore the local CodeGraph index and raw run dumps**

Append to repo-root `.gitignore`:
```
# CodeGraph local index (pilot — never commit)
.codegraph/
# Benchmark raw per-run JSON (large; keep only parsed CSV + results.md)
docs/superpowers/benchmarks/2026-05-30-codegraph/raw/
```

- [ ] **Step 3: Verify .codegraph is ignored**

Run: `git check-ignore .codegraph || echo "NOT IGNORED"`
Expected: prints `.codegraph` (ignored). If "NOT IGNORED", fix the glob.

- [ ] **Step 4: Commit**

```bash
git add .gitignore
git commit -m "chore(codegraph-bench): scaffold + gitignore local index"
```

---

## Task 2: Author the question set

**Files:**
- Create: `scripts/codegraph-bench/questions.tsv`

- [ ] **Step 1: Write the 8 questions (tab-separated: id ⇥ text)**

`scripts/codegraph-bench/questions.tsv`:
```
q1	Trace the photo-guide PWA upload flow end to end: which API route receives the upload, how does it reach VF Storage, and which database table/columns are written? List the exact files and functions in the path.
q2	What functions call recordVlmCorrection, and what does recordVlmCorrection itself call? List every caller file and the functions it invokes.
q3	List every file that imports the Neon serverless shim (directly or via the webpack alias). Which module defines the shim?
q4	How does a NOC ticket get created from a WhatsApp mention? Trace the path from the WhatsApp mention ingestion to the ticket row insert, naming each file and function.
q5	Where is RBAC / permission enforcement applied for the procurement module's API routes? List the routes and the auth middleware or permission checks they use.
q6	Which API routes write (INSERT or UPDATE) to the `drops` table — not the qa_photo_reviews table? List each route file.
q7	How does scripts/deploy-local.sh gate a release before swapping it live? Describe the ordered gates/checks it runs.
q8	What is the component tree for the NOC KanbanBoard view: which components render which, and where does the board data come from? List the component files and the data source.
```

- [ ] **Step 2: Verify 8 rows, no blank lines**

Run: `grep -c . scripts/codegraph-bench/questions.tsv`
Expected: `8`

- [ ] **Step 3: Commit**

```bash
git add scripts/codegraph-bench/questions.tsv
git commit -m "test(codegraph-bench): add 8 fixed benchmark questions"
```

---

## Task 3: Author correctness rubrics

**Files:**
- Create: `scripts/codegraph-bench/rubrics.md`

- [ ] **Step 1: Author expected evidence per question**

Author from the codebase (not from memory). For each question, list the
minimum set of files/symbols a correct answer MUST name. Verify each anchor
with `git grep` before writing it. Template + the already-verified anchors:

`scripts/codegraph-bench/rubrics.md`:
```markdown
# Correctness Rubrics — CodeGraph Pilot

A run PASSES a question if its answer names the required files/symbols below and
states the relationships correctly. Missing a required anchor = FAIL.

## q1 — PWA upload flow
Required: `pages/api/photo-guide/upload.ts` (route + `uploadToVfStorage`), VF Storage POST to `${VF_STORAGE_URL}/upload`, DB write to `dr_photo_unified_reviews` (`pwa_*` columns) or `pole_install_sessions`.
[Confirm exact columns with: git grep -n "pwa_photo_urls\|pwa_submission_at" -- pages/api/photo-guide/upload.ts]

## q2 — recordVlmCorrection caller/callee
Required callers (≥9 of 11): pages/api/construction-qa/photo-step.ts, pages/api/fleet/check-in/photos.ts, pages/api/fleet/check-in/process-vlm.ts, pages/api/qfield/qa-actions.ts, pages/api/system/vlm/corrections.ts, src/modules/activate/services/oes/oesPostImportService.ts, src/modules/activate/services/serialRecheckService.ts, src/modules/data-sync/services/eodLearningService.ts, src/modules/projects/services/poExtractionService.ts.
Definition: src/services/vlmLearningService.ts:42. Callees: confirm via `git grep -n -A40 "export async function recordVlmCorrection" src/services/vlmLearningService.ts` and list the functions/queries it invokes.

## q3 — Neon shim importers
Required: shim defined in `src/lib/neon-shim.ts`; consumed via `lib/db/pool.js` (imports `@neondatabase/serverless`, webpack-aliased). Answer must name the alias mechanism + the importing files.
[Build the authoritative importer list with: git grep -lE "@neondatabase/serverless|neon-shim" -- '*.ts' '*.js']

## q4 — WA mention → NOC ticket
Required: the WA mention ingestion entry point + the ticket insert. 
[Author anchors with: git grep -lniE "mention" -- 'pages/api/wa-monitor*' 'src/modules/**'; and the ticket insert path. Record exact files before benchmarking.]

## q5 — Procurement RBAC
Required: procurement API routes under `pages/api/procurement*` / `pages/api/**/procurement/**` and the `withAuth`/`withRole`/`withPermission` wrappers they use.
[Author with: git grep -lE "withAuth|withRole|withPermission" -- 'pages/api/procurement*' 'pages/api/**/procurement/**']

## q6 — drops-table writers
Required (≥ the verified set): pages/api/activate/import-offline.ts, pages/api/activate/pp-data-resolve.ts, pages/api/activate/sync-installer-names.ts, plus any others from: `git grep -lE "INTO drops|UPDATE drops" -- pages/api src`. MUST NOT confuse with qa_photo_reviews.

## q7 — deploy gate
Required: `scripts/deploy-local.sh` ordered gates — lint/ci gate, service stop, build, health check, swap. 
[Confirm order with: grep -nE "lint|ci|stop|build|health|swap|systemctl" scripts/deploy-local.sh]

## q8 — KanbanBoard tree
Required: src/modules/noc/components/KanbanBoard/{KanbanBoard,KanbanColumn,KanbanCard}.tsx render relationship + the data source (hook/API the board reads).
[Confirm data source with: git grep -n "fetch\|useQuery\|useEffect" -- src/modules/noc/components/KanbanBoard/KanbanBoard.tsx]
```

- [ ] **Step 2: Resolve every `[bracketed]` author-note into concrete anchors**

Run each bracketed `git grep` command and replace the note with the actual
file/symbol list. No `[...]` notes may remain.

Run: `grep -n '\[' scripts/codegraph-bench/rubrics.md || echo "CLEAN — no unresolved notes"`
Expected: `CLEAN — no unresolved notes`

- [ ] **Step 3: Commit**

```bash
git add scripts/codegraph-bench/rubrics.md
git commit -m "test(codegraph-bench): author correctness rubrics from live code"
```

---

## Task 4: MCP config files (both arms)

**Files:**
- Create: `scripts/codegraph-bench/empty-mcp.json`
- Create: `scripts/codegraph-bench/with-mcp.json`

- [ ] **Step 1: Empty config (WITHOUT arm)**

`scripts/codegraph-bench/empty-mcp.json`:
```json
{ "mcpServers": {} }
```

- [ ] **Step 2: CodeGraph config (WITH arm)**

`scripts/codegraph-bench/with-mcp.json`:
```json
{
  "mcpServers": {
    "codegraph": {
      "command": "codegraph",
      "args": ["serve", "--mcp"]
    }
  }
}
```

- [ ] **Step 3: Validate both are well-formed JSON**

Run: `jq . scripts/codegraph-bench/empty-mcp.json && jq . scripts/codegraph-bench/with-mcp.json`
Expected: both pretty-print without error.

- [ ] **Step 4: Commit**

```bash
git add scripts/codegraph-bench/empty-mcp.json scripts/codegraph-bench/with-mcp.json
git commit -m "test(codegraph-bench): add with/without MCP configs"
```

---

## Task 5: Install + index CodeGraph (isolation-first)

**Files:** none committed (global install + local `.codegraph/`).

- [ ] **Step 1: Review the package before global install**

Run: `npm view @colbymchenry/codegraph version repository.url dist.tarball`
Expected: prints a version + the colbymchenry/codegraph repo. (Sanity that we install the audited package.)

- [ ] **Step 2: Global install (pinned to the resolved version)**

Run: `npm i -g @colbymchenry/codegraph`
Expected: installs a `codegraph` binary. Verify: `codegraph --version`

- [ ] **Step 3: Confirm it did NOT auto-wire into Claude Code**

Run: `codegraph install --target=none --yes 2>/dev/null; grep -c codegraph ~/.claude.json || echo 0`
Expected: `0` — CodeGraph must not appear in the global Claude Code MCP config. The harness supplies the MCP config per run instead. If non-zero, run `codegraph uninstall --yes` and re-confirm `0`.

- [ ] **Step 4: Build the index at a pinned commit**

Run:
```bash
git rev-parse HEAD | tee docs/superpowers/benchmarks/2026-05-30-codegraph/COMMIT.txt
codegraph init -i
codegraph status
```
Expected: `codegraph status` reports a populated index with no pending-sync files.

- [ ] **Step 5: Smoke-test the MCP arm answers at all**

Run:
```bash
claude -p "Use codegraph to list the callers of recordVlmCorrection." \
  --strict-mcp-config --mcp-config scripts/codegraph-bench/with-mcp.json \
  --output-format json 2>/dev/null | jq -r '.total_cost_usd, (.num_turns // "n/a")'
```
Expected: a cost number prints (non-null) — confirms the MCP server loads and the run completes. If null/error, stop and debug MCP config before benchmarking.

---

## Task 6: Run harness

**Files:**
- Create: `scripts/codegraph-bench/run-bench.sh`

- [ ] **Step 1: Write the harness**

`scripts/codegraph-bench/run-bench.sh`:
```bash
#!/usr/bin/env bash
# Runs 8 questions × 2 arms × N runs headlessly, one raw JSON + one CSV row each.
set -uo pipefail

BENCH_DIR="docs/superpowers/benchmarks/2026-05-30-codegraph"
RAW="$BENCH_DIR/raw"
RUNS_CSV="$BENCH_DIR/runs.csv"
Q="scripts/codegraph-bench/questions.tsv"
N="${RUNS:-4}"                 # runs per arm per question
MODEL="${MODEL:-opus}"
mkdir -p "$RAW"

echo "qid,arm,run,cost_usd,duration_ms,total_tokens,num_turns,answer_file" > "$RUNS_CSV"

run_arm() {                    # $1=qid  $2=qtext  $3=arm  $4=mcp_config
  local qid="$1" qtext="$2" arm="$3" cfg="$4"
  for r in $(seq 1 "$N"); do
    local raw="$RAW/${qid}_${arm}_${r}.json"
    claude -p "$qtext" --model "$MODEL" \
      --strict-mcp-config --mcp-config "$cfg" \
      --output-format json > "$raw" 2>/dev/null || true
    local cost dur toks turns
    cost=$(jq -r '.total_cost_usd // empty' "$raw")
    dur=$(jq -r '.duration_ms // empty' "$raw")
    toks=$(jq -r '((.usage.input_tokens // 0) + (.usage.cache_read_input_tokens // 0) + (.usage.cache_creation_input_tokens // 0) + (.usage.output_tokens // 0)) // empty' "$raw")
    turns=$(jq -r '.num_turns // empty' "$raw")
    # persist the answer text for the judge
    local ans="$RAW/${qid}_${arm}_${r}.answer.txt"
    jq -r '.result // .text // empty' "$raw" > "$ans"
    echo "${qid},${arm},${r},${cost:-NA},${dur:-NA},${toks:-NA},${turns:-NA},${ans}" >> "$RUNS_CSV"
    echo "  [${qid}/${arm}/${r}] cost=${cost:-NA} dur=${dur:-NA}ms toks=${toks:-NA}"
  done
}

while IFS=$'\t' read -r qid qtext; do
  [ -z "$qid" ] && continue
  echo "== $qid =="
  run_arm "$qid" "$qtext" without scripts/codegraph-bench/empty-mcp.json
  run_arm "$qid" "$qtext" with    scripts/codegraph-bench/with-mcp.json
done < "$Q"

echo "Done → $RUNS_CSV"
```

- [ ] **Step 2: Dry-run with RUNS=1 on a single question**

Run:
```bash
chmod +x scripts/codegraph-bench/run-bench.sh
RUNS=1 head -1 scripts/codegraph-bench/questions.tsv > /tmp/one.tsv
# temporary single-question run:
RUNS=1 Q=/tmp/one.tsv bash -c 'sed -i "s#\$Q#/tmp/one.tsv#" /dev/null; RUNS=1 ./scripts/codegraph-bench/run-bench.sh' 2>/dev/null || \
  RUNS=1 ./scripts/codegraph-bench/run-bench.sh
head -5 docs/superpowers/benchmarks/2026-05-30-codegraph/runs.csv
```
Expected: header + ≥2 rows (one `without`, one `with`) with non-NA `cost_usd`. If `cost_usd=NA`, fix JSON field paths against an actual raw file (`jq . raw/q1_with_1.json | head -40`) before the full run.

- [ ] **Step 3: Full run (RUNS=4, all 8 questions)**

Run: `RUNS=4 ./scripts/codegraph-bench/run-bench.sh | tee $BENCH_DIR/run.log`
Expected: 64 data rows in `runs.csv` (`tail -n +2 runs.csv | wc -l` → `64`), all with non-NA cost.

- [ ] **Step 4: Commit the harness + parsed CSV (raw JSON stays gitignored)**

```bash
git add scripts/codegraph-bench/run-bench.sh docs/superpowers/benchmarks/2026-05-30-codegraph/runs.csv docs/superpowers/benchmarks/2026-05-30-codegraph/COMMIT.txt
git commit -m "test(codegraph-bench): run harness + 64-run results CSV"
```

---

## Task 7: Blind correctness judge

**Files:**
- Create: `scripts/codegraph-bench/judge.sh`

- [ ] **Step 1: Write the judge**

`scripts/codegraph-bench/judge.sh`:
```bash
#!/usr/bin/env bash
# Blindly scores each answer file against its rubric. Judge does NOT know the arm.
set -uo pipefail
BENCH_DIR="docs/superpowers/benchmarks/2026-05-30-codegraph"
RUNS_CSV="$BENCH_DIR/runs.csv"
OUT="$BENCH_DIR/correctness.csv"
RUBRICS="scripts/codegraph-bench/rubrics.md"
echo "qid,arm,run,verdict,reason" > "$OUT"

tail -n +2 "$RUNS_CSV" | while IFS=, read -r qid arm run cost dur toks turns ansfile; do
  [ -f "$ansfile" ] || { echo "${qid},${arm},${run},FAIL,no-answer-file" >> "$OUT"; continue; }
  rubric=$(awk -v q="## ${qid} " 'index($0,q){f=1} f&&/^## /&&index($0,q)==0&&NR>1{f=0} f' "$RUBRICS")
  prompt="You are a strict grader. RUBRIC for ${qid}:
${rubric}

CANDIDATE ANSWER:
$(cat "$ansfile")

Does the answer name the required files/symbols and state the relationships correctly? Reply with exactly one line: PASS|<short reason> or FAIL|<short reason>. You do not know which tool produced this answer; judge only on correctness."
  verdict=$(claude -p "$prompt" --model opus \
            --strict-mcp-config --mcp-config scripts/codegraph-bench/empty-mcp.json \
            --output-format json 2>/dev/null | jq -r '.result // empty' | head -1)
  v=${verdict%%|*}; reason=${verdict#*|}
  echo "${qid},${arm},${run},${v:-FAIL},\"${reason//\"/\047}\"" >> "$OUT"
  echo "  judged ${qid}/${arm}/${run}: ${v:-FAIL}"
done
echo "Done → $OUT"
```

- [ ] **Step 2: Dry-run judge on the first answer only**

Run:
```bash
chmod +x scripts/codegraph-bench/judge.sh
head -2 docs/superpowers/benchmarks/2026-05-30-codegraph/runs.csv > /tmp/runs_head.csv
RUNS_CSV=/tmp/runs_head.csv ./scripts/codegraph-bench/judge.sh 2>/dev/null || ./scripts/codegraph-bench/judge.sh
head -3 docs/superpowers/benchmarks/2026-05-30-codegraph/correctness.csv
```
Expected: a `PASS|...` or `FAIL|...` verdict row. If the rubric slice is empty, fix the `awk` section matcher before the full judge run.

- [ ] **Step 3: Judge all 64 answers**

Run: `./scripts/codegraph-bench/judge.sh | tee $BENCH_DIR/judge.log`
Expected: 64 verdict rows (`tail -n +2 correctness.csv | wc -l` → `64`).

- [ ] **Step 4: Commit**

```bash
git add scripts/codegraph-bench/judge.sh docs/superpowers/benchmarks/2026-05-30-codegraph/correctness.csv
git commit -m "test(codegraph-bench): blind correctness verdicts for 64 answers"
```

---

## Task 8: Analyze + decision

**Files:**
- Create: `scripts/codegraph-bench/analyze.sh`
- Create: `docs/superpowers/benchmarks/2026-05-30-codegraph/results.md`

- [ ] **Step 1: Write the analyzer**

`scripts/codegraph-bench/analyze.sh`:
```bash
#!/usr/bin/env bash
# Joins runs + correctness, computes per-question medians and aggregate deltas.
set -uo pipefail
BENCH_DIR="docs/superpowers/benchmarks/2026-05-30-codegraph"
python3 - "$BENCH_DIR" <<'PY'
import csv, sys, statistics as st
d=sys.argv[1]
runs=list(csv.DictReader(open(f"{d}/runs.csv")))
corr={(r['qid'],r['arm'],r['run']):r['verdict'] for r in csv.DictReader(open(f"{d}/correctness.csv"))}
def num(x):
    try: return float(x)
    except: return None
qids=sorted({r['qid'] for r in runs})
def med(qid,arm,key):
    vals=[num(r[key]) for r in runs if r['qid']==qid and r['arm']==arm and num(r[key]) is not None]
    return st.median(vals) if vals else None
lines=["# CodeGraph Pilot — Results","",
       f"Commit: `{open(d+'/COMMIT.txt').read().strip()}`  ·  Model: opus  ·  4 runs/arm, median.",
       "",
       "| Q | Cost w/o | Cost w | Cost Δ | Tokens Δ | Turns w/o | Turns w | Correct w/o | Correct w |",
       "|---|---|---|---|---|---|---|---|---|"]
agg={'cw':[],'cwo':[],'tw':[],'two':[]}
for q in qids:
    cwo,cw=med(q,'without','cost_usd'),med(q,'with','cost_usd')
    two,tw=med(q,'without','total_tokens'),med(q,'with','total_tokens')
    nwo,nw=med(q,'without','num_turns'),med(q,'with','num_turns')
    def passes(arm): 
        vs=[corr.get((q,arm,str(r))) for r in range(1,5)]
        return sum(1 for v in vs if v=='PASS')
    cdl=f"{(cwo-cw)/cwo*100:+.0f}%" if cwo and cw else "NA"
    tdl=f"{(two-tw)/two*100:+.0f}%" if two and tw else "NA"
    if cwo and cw: agg['cwo'].append(cwo); agg['cw'].append(cw)
    if two and tw: agg['two'].append(two); agg['tw'].append(tw)
    lines.append(f"| {q} | {cwo:.4f} | {cw:.4f} | {cdl} | {tdl} | {nwo} | {nw} | {passes('without')}/4 | {passes('with')}/4 |")
def aggdelta(a,b): 
    A,B=sum(agg[a]),sum(agg[b]); return (A-B)/A*100 if A else 0
cost_red=aggdelta('cwo','cw'); tok_red=aggdelta('two','tw')
reg=sum(1 for q in qids for r in range(1,5)
        if corr.get((q,'without',str(r)))=='PASS' and corr.get((q,'with',str(r)))=='FAIL')
keep = cost_red>=15 and tok_red>0 and reg==0
lines += ["",
  f"**Aggregate cost reduction:** {cost_red:+.1f}%  (keep-gate ≥15%)",
  f"**Aggregate token reduction:** {tok_red:+.1f}%",
  f"**Correctness regressions (PASS→FAIL with CodeGraph):** {reg}",
  "",
  f"## Decision: {'KEEP' if keep else 'DROP'}",
  f"- cost ≥15%: {'✅' if cost_red>=15 else '❌'} ({cost_red:+.1f}%)",
  f"- tokens down: {'✅' if tok_red>0 else '❌'} ({tok_red:+.1f}%)",
  f"- zero correctness regressions: {'✅' if reg==0 else '❌'} ({reg})",
]
open(f"{d}/results.md","w").write("\n".join(lines)+"\n")
print("\n".join(lines))
PY
```

- [ ] **Step 2: Run analysis**

Run: `chmod +x scripts/codegraph-bench/analyze.sh && ./scripts/codegraph-bench/analyze.sh`
Expected: prints the results table + a `## Decision: KEEP|DROP` line; writes `results.md`.

- [ ] **Step 3: Sanity cross-check (avoid quoting a wrong number — per project rule)**

Run:
```bash
# independent recompute of aggregate cost delta from the CSV
python3 - <<'PY'
import csv,statistics as st
runs=list(csv.DictReader(open("docs/superpowers/benchmarks/2026-05-30-codegraph/runs.csv")))
def med(arm,k):
  import statistics as s
  from collections import defaultdict
  g=defaultdict(list)
  for r in runs:
    if r['arm']==arm:
      try:g[r['qid']].append(float(r[k]))
      except:pass
  return sum(s.median(v) for v in g.values())
cwo,cw=med('without','cost_usd'),med('with','cost_usd')
print(f"cross-check cost reduction: {(cwo-cw)/cwo*100:+.1f}%")
PY
```
Expected: matches the analyzer's aggregate cost-reduction figure (±0.1%). If mismatch, debug before trusting `results.md`.

- [ ] **Step 4: Commit results**

```bash
git add scripts/codegraph-bench/analyze.sh docs/superpowers/benchmarks/2026-05-30-codegraph/results.md
git commit -m "test(codegraph-bench): analysis + keep/drop decision"
```

---

## Task 9: Teardown-or-keep + recommendation

**Files:**
- Modify: `docs/superpowers/benchmarks/2026-05-30-codegraph/results.md` (append recommendation paragraph)

- [ ] **Step 1: Write the one-paragraph recommendation**

Append to `results.md` a paragraph stating the decision, the three gate
outcomes, the headline cost/time/token/tool-call deltas, and any caveat (e.g.
worktree-staleness behaviour observed). State it plainly with the numbers — no
"should"/"looks good" without the figures.

- [ ] **Step 2: If DROP — fully reverse**

Run (only if decision is DROP):
```bash
codegraph uninit
codegraph uninstall --yes
npm rm -g @colbymchenry/codegraph
grep -c codegraph ~/.claude.json || echo 0   # expect 0
```
Expected: `0` — no residual config.

- [ ] **Step 3: If KEEP — document follow-up, do not auto-roll-out**

Append to `results.md` a "Follow-up if kept" note: (a) confirm watcher behaviour
across `git worktree` switches + `git pull` (connect-time reconciliation), (b)
decide global `codegraph install --target=claude` for this user only, (c) Zander
rollout is a separate decision. Do NOT wire it into everyone's config in this PR.

- [ ] **Step 4: Commit + open PR**

```bash
git add docs/superpowers/benchmarks/2026-05-30-codegraph/results.md
git commit -m "docs(codegraph-bench): keep/drop recommendation"
git push -u origin chore/codegraph-pilot-spec
gh pr create --base master --title "CodeGraph pilot: spec + A/B benchmark + recommendation" \
  --body "Formal A/B benchmark of colbymchenry/codegraph on FibreFlow. Spec + harness + 64-run results + keep/drop decision. .codegraph/ index and raw JSON gitignored; tool installed --target=none (no change to normal sessions)."
```

---

## Self-Review

**Spec coverage:** §3 isolation → Task 1+5(step3); §4 questions → Task 2 (Q2 anchor corrected, noted); §5 harness/metrics → Task 6; §6 correctness gate → Task 7; §7 decision rule → Task 8 (cost≥15% + tokens↓ + zero regressions, time reported); §8 risks (staleness, isolation, supply-chain) → Task 5 steps 1/3/4 + Task 9; §9 deliverables → all tasks' committed artifacts. No gaps.

**Placeholder scan:** rubric `[bracketed]` notes are explicitly resolved-and-verified in Task 3 Step 2 with a CLEAN gate; no TBDs elsewhere.

**Consistency:** CSV columns emitted in Task 6 (`qid,arm,run,cost_usd,duration_ms,total_tokens,num_turns,answer_file`) are exactly the columns read in Tasks 7–8; arm labels `with`/`without` and verdict tokens `PASS`/`FAIL` consistent across harness, judge, analyzer.

**Known fragility (flagged for executor):** exact `claude --output-format json` field names (`total_cost_usd`, `duration_ms`, `usage.*`, `result`) must be confirmed against a real raw file in Task 6 Step 2 before the full run — the dry-run gate exists precisely to catch a field-name mismatch.
```
