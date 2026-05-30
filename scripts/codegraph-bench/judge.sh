#!/usr/bin/env bash
# Blindly scores each answer file against its rubric. Judge does NOT know the arm.
set -uo pipefail
cd "$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
BENCH_DIR="docs/superpowers/benchmarks/2026-05-30-codegraph"
RUNS_CSV="$BENCH_DIR/runs.csv"
OUT="$BENCH_DIR/correctness.csv"
RUBRICS="scripts/codegraph-bench/rubrics.md"
echo "qid,arm,run,verdict,reason" > "$OUT"

while IFS=, read -r qid arm run cost dur toks turns ansfile; do
  [ -f "$ansfile" ] || { echo "${qid},${arm},${run},FAIL,no-answer-file" >> "$OUT"; continue; }
  rubric=$(awk -v q="## ${qid} " 'index($0,q){f=1} f&&/^## /&&index($0,q)==0&&NR>1{f=0} f' "$RUBRICS")
  prompt="You are a strict grader. RUBRIC for ${qid}:
${rubric}

CANDIDATE ANSWER:
$(cat "$ansfile")

Does the answer name the required files/symbols and state the relationships correctly? Reply with exactly one line: PASS|<short reason> or FAIL|<short reason>. You do not know which tool produced this answer; judge only on correctness."
  verdict=$(claude -p "$prompt" --model opus \
            --strict-mcp-config --mcp-config scripts/codegraph-bench/empty-mcp.json \
            --output-format json </dev/null 2>/dev/null | jq -r '.result // empty' | head -1)
  # M3: guard against verdict with no pipe separator
  if [[ "$verdict" == *"|"* ]]; then
    v=${verdict%%|*}; reason=${verdict#*|}
  else
    v=${verdict}; reason="(no reason given)"
  fi
  # M2: strip embedded newlines from reason before writing to CSV
  reason=${reason//$'\n'/ }
  echo "${qid},${arm},${run},${v:-FAIL},\"${reason//\"/\047}\"" >> "$OUT"
  echo "  judged ${qid}/${arm}/${run}: ${v:-FAIL}"
done < <(tail -n +2 "$RUNS_CSV")
echo "Done → $OUT"
