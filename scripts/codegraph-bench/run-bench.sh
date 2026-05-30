#!/usr/bin/env bash
# Runs 8 questions × 2 arms × N runs headlessly, one raw JSON + one CSV row each.
set -uo pipefail
cd "$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"

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
