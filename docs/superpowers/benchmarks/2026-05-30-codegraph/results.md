# CodeGraph Pilot — Results

Commit: `914c4fd8e0861a9ae98020c3c2f5744dfc2ea1fe`  ·  Model: opus  ·  4 runs/arm, median.

| Q | Cost w/o | Cost w | Cost Δ | Tokens Δ | Turns w/o | Turns w | Correct w/o | Correct w |
|---|---|---|---|---|---|---|---|---|
| q1 | 0.4945 | 0.6467 | -31% | +19% | 9.0 | 7.0 | 1/4 | 2/4 |
| q2 | 2.0902 | 1.2184 | +42% | -115% | 10.0 | 16.0 | 0/4 | 3/4 |
| q3 | 1.7976 | 1.1157 | +38% | -117% | 11.0 | 14.5 | 0/4 | 1/4 |
| q4 | 1.3583 | 1.3303 | +2% | -153% | 10.0 | 12.0 | 1/4 | 1/4 |
| q5 | 3.0638 | 1.3122 | +57% | -186% | 10.0 | 16.0 | 2/4 | 2/4 |
| q6 | 2.3833 | 0.9544 | +60% | -184% | 10.0 | 14.5 | 2/4 | 1/4 |
| q7 | 1.7422 | 0.6499 | +63% | +17% | 9.5 | 7.5 | 3/4 | 2/4 |
| q8 | 1.9438 | 1.7174 | +12% | -208% | 10.0 | 28.5 | 2/4 | 4/4 |

**Aggregate cost reduction:** +39.9%  (keep-gate ≥15%)
**Aggregate token reduction:** -106.3%
**Correctness regressions (PASS→FAIL with CodeGraph):** 4

## Decision: DROP
- cost ≥15%: ✅ (+39.9%)
- tokens down: ❌ (-106.3%)
- zero correctness regressions: ❌ (4)

---

## Corrected Interpretation (controller analysis, cross-checked)

The pre-registered mechanical rule returns **DROP**, but two of its three gates
are flawed proxies. Both are reported honestly: the mechanical verdict above
stands as pre-registered (no post-hoc goalpost moving); this section explains
why it misleads.

### Verified headline numbers (sum of per-question medians, n=4/arm)
| Metric | WITHOUT | WITH CodeGraph | Delta |
|--------|---------|----------------|-------|
| **Cost** | $14.90 | $8.90 | **40% cheaper** |
| **Wall-clock time** | 1,734 s | 1,030 s | **41% faster** |
| **Correctness (pass rate)** | 11/32 = 34% | 16/32 = 50% | **+16 pts more accurate** |
| Total tokens (incl. cache reads) | 2.33 M | 4.81 M | 2x more |
| Median turns / tool-calls | ~10 | up to 28 | more, not fewer |

Cost is cheaper on 6/8 questions; time faster on 6/8.

### Why the two "failing" gates mislead
1. **"tokens down" FAIL (-106%).** The token total counts cheap *cache-read*
   tokens. CodeGraph re-reads its structured graph context across more turns, so
   total tokens balloon — but those tokens are ~10x cheaper than the fresh
   file-content tokens the without-arm spends. Cost already captures efficiency
   correctly, and cost dropped 40%. Token-count is the wrong proxy here.
2. **"zero regressions" FAIL (4).** The analyzer pairs run-index i without vs
   run-index i with — but those are independent samples, so index-pairing is
   statistically invalid. The proper aggregate is the pass *rate*: CodeGraph is
   more accurate (50% vs 34%), not less. The "4 regressions" are q6/q7 per-run
   noise.

### Honest caveats (do not oversell)
- **Both arms are unreliable** (34-50% pass against a strict all-anchors
  rubric). At n=4/question the correctness signal has wide error bars; 50% vs
  34% is suggestive, not conclusive.
- **CodeGraph makes MORE tool calls, not fewer** — the opposite of the vendor's
  headline. On FibreFlow (with our existing CLAUDE.md + module scaffolding) the
  win comes from *cheaper* tokens/turns, not *fewer* of them.
- q6 and q7 were slightly *worse* with CodeGraph; q2 (0->3) and q8 (2->4) were
  strong wins (caller enumeration + component-tree — graph-shaped questions).
- **Known judge anomaly (disclosed, not corrected):** blind review flagged
  `correctness.csv` row `q6/with/4` as verdict=FAIL while its own reason text
  describes a clear PASS ("all 13 required files present and relationships
  correct") — a judge error. The raw verdict is left **unaltered** to avoid
  cherry-picking in our favour (we did not re-audit the without-arm for
  symmetric errors). If corrected, WITH accuracy would rise to 17/32 = 53%, so
  the reported 50% if anything *understates* CodeGraph's correctness edge.

### Recommendation
On the metrics that actually matter — **cost (-40%), wall-clock (-41%), and
correctness (+16 pts)** — CodeGraph wins on FibreFlow: decisively on cost/time,
and at-worst-neutral / likely-better on accuracy. The pre-registered rule's DROP
is an artifact of a token-count gate (dominated by cheap cached reads) and an
invalid index-paired regression gate.

**Recommend: KEEP for a real-use trial** (enable for this user only), with a
follow-up to (a) re-confirm the correctness edge with easier-to-grade questions
/ a partial-credit scale and a larger n, and (b) confirm index freshness across
our worktree + pull workflow. **Not** a fleet-wide rollout to other engineers
until the trial confirms the day-to-day win. Final keep/adopt call is Hein's —
this pilot delivers the evidence, not the decree.
