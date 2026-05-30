#!/usr/bin/env bash
# Joins runs + correctness, computes per-question medians and aggregate deltas.
set -uo pipefail
cd "$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
BENCH_DIR="docs/superpowers/benchmarks/2026-05-30-codegraph"
python3 - "$BENCH_DIR" <<'PY'
import csv, sys, os, subprocess, statistics as st
d=sys.argv[1]
model=os.environ.get('MODEL','opus')
runs=list(csv.DictReader(open(f"{d}/runs.csv")))
corr={(r['qid'],r['arm'],r['run']):r['verdict'] for r in csv.DictReader(open(f"{d}/correctness.csv"))}
def num(x):
    try: return float(x)
    except: return None
# H2: robust COMMIT.txt read with git fallback
try:
    commit_sha=open(f"{d}/COMMIT.txt").read().strip()
except FileNotFoundError:
    commit_sha=subprocess.check_output(['git','rev-parse','--short','HEAD'],text=True).strip()
# M1: derive runs_per from actual data instead of hardcoding 4
runs_per = max(int(r['run']) for r in runs) if runs else 4
qids=sorted({r['qid'] for r in runs})
def med(qid,arm,key):
    vals=[num(r[key]) for r in runs if r['qid']==qid and r['arm']==arm and num(r[key]) is not None]
    return st.median(vals) if vals else None
# H1: format helpers — safe for None values
def f4(x): return f"{x:.4f}" if x is not None else "NA"
def fn(x): return str(x) if x is not None else "NA"
lines=["# CodeGraph Pilot — Results","",
       f"Commit: `{commit_sha}`  ·  Model: {model}  ·  {runs_per} runs/arm, median.",
       "",
       "| Q | Cost w/o | Cost w | Cost Δ | Tokens Δ | Turns w/o | Turns w | Correct w/o | Correct w |",
       "|---|---|---|---|---|---|---|---|---|"]
agg={'cw':[],'cwo':[],'tw':[],'two':[]}
for q in qids:
    cwo,cw=med(q,'without','cost_usd'),med(q,'with','cost_usd')
    two,tw=med(q,'without','total_tokens'),med(q,'with','total_tokens')
    nwo,nw=med(q,'without','num_turns'),med(q,'with','num_turns')
    def passes(arm):
        vs=[corr.get((q,arm,str(r))) for r in range(1,runs_per+1)]
        return sum(1 for v in vs if v=='PASS')
    cdl=f"{(cwo-cw)/cwo*100:+.0f}%" if cwo and cw else "NA"
    tdl=f"{(two-tw)/two*100:+.0f}%" if two and tw else "NA"
    if cwo and cw: agg['cwo'].append(cwo); agg['cw'].append(cw)
    if two and tw: agg['two'].append(two); agg['tw'].append(tw)
    lines.append(f"| {q} | {f4(cwo)} | {f4(cw)} | {cdl} | {tdl} | {fn(nwo)} | {fn(nw)} | {passes('without')}/{runs_per} | {passes('with')}/{runs_per} |")
def aggdelta(a,b):
    A,B=sum(agg[a]),sum(agg[b]); return (A-B)/A*100 if A else 0
cost_red=aggdelta('cwo','cw'); tok_red=aggdelta('two','tw')
reg=sum(1 for q in qids for r in range(1,runs_per+1)
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
