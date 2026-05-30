# CodeGraph A/B Benchmark Pilot — Design

**Date:** 2026-05-30
**Status:** Spec — awaiting review
**Owner:** Hein (decision) · Claude Code (execution)
**Tool under test:** [`colbymchenry/codegraph`](https://github.com/colbymchenry/codegraph) (MIT, npm `@colbymchenry/codegraph`)

---

## 1. Goal

Decide, with FibreFlow-specific evidence, whether to adopt CodeGraph as standing
tooling for Claude Code on this repo. CodeGraph pre-indexes the repo into a local
symbol/call graph (`.codegraph/`) and exposes it to the agent over MCP
(`codegraph_context`, `codegraph_explore`, `codegraph_status`), so the agent
queries the graph instead of grep/glob/Read.

The pilot is a **formal A/B benchmark**: the same set of real FibreFlow questions
answered **with** and **without** CodeGraph, measuring cost, tokens, tool calls,
and wall-clock time — plus a correctness gate so we never reward cheap-but-wrong
answers.

**Why it plausibly helps here:** FibreFlow is TypeScript at ~5,500 TS/TSX files.
The vendor's closest benchmark analog — VS Code (TS, ~10k files) — showed 63%
fewer tokens, 82% fewer tool calls, 13% cheaper, 11% faster. Re-validated on
Opus 4.8 (2026-05-29). Since Claude Code works this repo daily, any real
reduction lands directly on the bill.

**Honesty caveat baked into the design:** we run inside the real repo with our
existing `CLAUDE.md` + 56 module `.claude.md` docs present. That scaffolding
already cuts the agent's discovery cost, so our delta will likely be **smaller
than the vendor's headline 22%**. That smaller, real number is the point.

---

## 2. Non-Goals

- Not replacing Qdrant / semantic search / Cortex. CodeGraph is structural
  code navigation (caller/callee, imports, symbol structure), not RAG. Prior
  cross-project evaluation already classified it as "developer-only code
  navigation tooling," and this pilot does not revisit that.
- Not a permanent rollout decision for Zander / other agents — that is a
  follow-up only if the FibreFlow pilot passes.
- Not modifying any application code. The pilot adds only benchmark tooling +
  this spec; `.codegraph/` is gitignored.

---

## 3. Setup (isolation-first)

1. **Install via npm**, not `curl | sh` — auditable, pinned:
   `npm i -g @colbymchenry/codegraph` (bundles its own runtime).
2. **Do NOT auto-wire into day-to-day Claude Code.** Run the installer with
   `--target=none` (or skip it entirely) so CodeGraph is not silently enabled in
   normal sessions during the trial. The benchmark harness supplies the MCP
   config **explicitly per run** instead.
3. **Index a pinned checkout** of FibreFlow at a fixed commit SHA (recorded in
   the results), so both arms answer against identical source. `codegraph init -i`
   builds the graph.
4. `.codegraph/` added to `.gitignore` (local index, never committed).
5. Fully reversible: `codegraph uninit` (drops the index) + `codegraph uninstall`
   (strips any agent config). Recorded in the runbook.

---

## 4. Question Set (8 representative FibreFlow tasks)

Chosen to mirror the work Claude Code actually does here — cross-module traces,
caller/callee lookups, impact maps, auth-surface and data-flow questions — and to
span modules (activate, serials, NOC, procurement, deploy, DB).

| # | Question | Type |
|---|----------|------|
| 1 | Trace the photo-guide PWA upload flow end-to-end (route → VF storage → DB). | cross-module data flow |
| 2 | What calls `recordVlmCorrection` and what does it call? (11 call sites across 7 modules) | caller/callee |
| 3 | Everywhere the Neon serverless shim is imported. | impact map |
| 4 | How does a NOC ticket get created from a WhatsApp mention? | cross-module trace |
| 5 | Where is RBAC enforced for the procurement module? | auth surface |
| 6 | All API routes that write to the `drops` table (not `qa_photo_reviews`). | data-write surface |
| 7 | How does `deploy-local.sh` gate a release? | script/control flow |
| 8 | Component tree for the KanbanBoard NOC view (render + data deps). | component graph |

The set is fixed before the runs (no tuning to favour either arm). Each question
has a pre-written **expected-evidence rubric** (key files + symbols a correct
answer must reference), authored from the codebase before benchmarking.

---

## 5. Harness & Metrics

Replicates the vendor's own method so numbers are comparable:

- Each arm is a headless `claude -p "<question>"` run with `--strict-mcp-config`:
  - **WITH** = CodeGraph MCP server enabled (`--mcp-config with-codegraph.json`)
  - **WITHOUT** = empty MCP config (`--mcp-config empty.json`)
  - Built-in Read / Grep / Bash available to **both** arms.
- **8 questions × 2 arms × 4 runs = 64 headless runs.** Median of 4 per cell.
- Model pinned (Opus 4.8) and recorded; same machine; index built by the same
  CodeGraph build that serves it.
- Output format `json`; harness parses per run:

| Metric | Source | Role |
|--------|--------|------|
| Cost (USD) | `total_cost_usd` | **primary keep-gate** |
| Wall-clock time | run duration | reported secondary |
| Total tokens (input incl. cached + output) | usage | reported |
| Tool calls (incl. sub-agent calls) | transcript | reported |
| File reads / grep count | transcript | reported (discovery proxy) |

Harness emits a markdown table (per-question + aggregate deltas) **and** a CSV,
written to `docs/superpowers/benchmarks/2026-05-30-codegraph/`.

---

## 6. Correctness Gate

Cheaper-but-wrong is a loss, not a win. A **blind judge agent** (fresh context,
no knowledge of which arm produced which answer) scores every one of the 64
answers against that question's expected-evidence rubric: did it identify the
right files/symbols and the correct relationships? Pass/fail + short reason.

CodeGraph is only credited as a win on questions where its arm holds correctness.
Any correctness regression vs the WITHOUT arm is a blocker regardless of cost.

---

## 7. Decision Rule

**Keep** CodeGraph for FibreFlow if **all** hold:
- Median cost reduction **≥ 15%** across the question set (primary gate), **and**
- Tool calls **and** total tokens both down on aggregate, **and**
- **Zero** correctness regressions vs the WITHOUT arm.

Time-saved is reported and informs the writeup but is **not** a gate (vendor's own
data shows time is the noisiest metric run-to-run).

**Otherwise drop** — `codegraph uninit` + `uninstall`, archive the results table
as the record of why.

**If kept:** a short follow-up phase decides (a) how indexing behaves across our
git-worktree workflow (the watcher's connect-time reconciliation should absorb
`git pull` / worktree switches — to be confirmed in practice), and (b) whether to
roll out to Zander's Claude Code.

---

## 8. Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Index goes stale vs a worktree edit → wrong answer | CodeGraph's inotify watcher + debounced auto-sync + connect-time `(size,mtime)`+hash reconciliation; `codegraph_status` surfaces pending files. Benchmark uses a pinned, fully-indexed checkout so staleness can't skew results. |
| Tool silently enabled in normal sessions skews the trial / changes behaviour | Install `--target=none`; MCP config supplied only by the harness per run. |
| Benchmark questions cherry-picked to favour a tool | Question set + rubrics fixed before any run; blind correctness judge. |
| Supply-chain (running a third-party indexer over our code) | 100% local (no network egress per vendor); MIT; install via pinned npm, not `curl\|sh`; review the package before global install. |
| Small-repo effect (modern models already grep cheaply) | We measure on OUR ~5.5k-file repo, not a toy; decision rule is FibreFlow-specific, not the vendor headline. |

---

## 9. Deliverables

1. `docs/superpowers/specs/2026-05-30-codegraph-pilot-design.md` (this file).
2. Benchmark harness script (runs the 64 runs, parses JSON, emits md+csv).
3. Question rubrics file (expected files/symbols per question).
4. Results: `docs/superpowers/benchmarks/2026-05-30-codegraph/` (md table + csv + commit SHA + model id).
5. A one-paragraph keep/drop recommendation against the decision rule.
