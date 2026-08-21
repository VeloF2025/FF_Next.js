#!/usr/bin/env bash
# Decide a cron wrapper's exit code from the RUN's status, not just the HTTP code.
#
# These endpoints answer 200 with the outcome in the body:
#   {"success":true,"data":{"status":"failed","errorSummary":"...","skipped":false}}
# so `curl -f`, which only reacts to 4xx/5xx, logged "done" and exited 0 for a run
# that had failed. On 2026-08-21 the operational monitor failed on every tick for
# months' worth of would-be runs while reporting success; the wrapper is why nobody
# saw it.
#
# `skipped` is NOT a failure: it means another run held the advisory lock, which is
# the lock working as designed.

# Usage: report_run_status "<label>" "<json>" "<log prefix>"  -> exits 1 on a bad run
report_run_status() {
  local label="$1" body="$2" prefix="$3" status skipped summary

  status=$(printf '%s' "$body" | jq -r '.data.status // empty' 2>/dev/null || true)
  skipped=$(printf '%s' "$body" | jq -r '.data.skipped // false' 2>/dev/null || true)
  summary=$(printf '%s' "$body" | jq -r '.data.errorSummary // .error // empty' 2>/dev/null || true)

  if [ "$skipped" = "true" ]; then
    echo "$prefix $label skipped — another run holds the lock"
    return 0
  fi

  # An unparseable body is itself a failure: the contract changed, or something
  # returned 200 with a non-JSON payload. Treating it as success is how this
  # class of bug survives.
  if [ -z "$status" ]; then
    echo "$prefix ERROR: $label returned no run status; body was: $body" >&2
    return 1
  fi

  if [ "$status" != "succeeded" ]; then
    echo "$prefix ERROR: $label run status=$status${summary:+ — $summary}" >&2
    return 1
  fi

  echo "$prefix $label succeeded"
  return 0
}
