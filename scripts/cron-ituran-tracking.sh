#!/usr/bin/env bash
# 2-hourly Ituran tracking poll (Avis account).
#
# Unlike cron-portal-tracking.sh this does NOT call an API route: the Ituran
# portal is behind a bot challenge that needs a real browser to clear, and
# Playwright is a devDependency that must not be reachable from the Next.js
# runtime. So the tick runs as a script, which loads the deploy dir's env file
# itself rather than passing a secret over HTTP.
#
# Install on velo (times are SAST — velo cron runs in local time). Offset by 30
# minutes from the Netstar poll so two browser-less-and-browser jobs do not
# contend, and so the logs are readable:
#   30 */2 * * * /home/velo/fibreflow-production/scripts/cron-ituran-tracking.sh >> /home/velo/logs/poll-ituran-tracking.log 2>&1
#
# Requires the full Chromium build (not the headless shell) in the running
# user's Playwright cache: npx playwright install chromium
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

LOG_PREFIX="[$(date '+%Y-%m-%d %H:%M:%S')]"
echo "$LOG_PREFIX === Ituran tracking poll start ==="

# The script reads ITURAN_* and DATABASE_URL from the environment. Export the
# deploy dir's env file into it.
#
# Deliberately NOT `set -a; . file`. A .env is not a shell script: values may
# legitimately contain spaces, and unquoted. Production's file really does
# carry `NETSTAR_PORTAL_USER=Velocity FIBRE`, which `.` parses as an assignment
# followed by a command, so sourcing dies with "FIBRE: command not found" and
# the whole tick exits 127 before it starts. Next.js's own dotenv loader reads
# these files literally, so the wrapper must too: split on the FIRST `=`, never
# evaluate the value.
load_env_file() {
  local file="$1" line key val
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in ''|'#'*) continue ;; esac
    key=${line%%=*}
    val=${line#*=}
    # Skip anything that is not a plain KEY= assignment (stray text, `export `
    # prefixes, continuation lines from a multi-line value).
    case "$key" in ''|*[!A-Za-z0-9_]*) continue ;; esac
    # Strip one layer of matching surrounding quotes, as dotenv does.
    case "$val" in
      \"*\") val=${val#\"}; val=${val%\"} ;;
      \'*\') val=${val#\'}; val=${val%\'} ;;
    esac
    export "$key=$val"
  done < "$file"
}

# BOTH files, `.env` first so `.env.local` wins — the same precedence Next.js
# applies. Not either/or: production splits them, with DATABASE_URL only in
# `.env` and the ITURAN_*/NETSTAR_* credentials only in `.env.local`. Loading
# just one leaves the tick unable to reach either the database or the portal.
loaded=0
for envfile in "$PROJECT_DIR/.env" "$PROJECT_DIR/.env.local"; do
  if [ -f "$envfile" ]; then
    load_env_file "$envfile"
    loaded=$((loaded + 1))
  fi
done
if [ "$loaded" -eq 0 ]; then
  echo "$LOG_PREFIX ERROR: no .env or .env.local in $PROJECT_DIR" >&2
  exit 1
fi

# Fail here rather than inside tsx with a stack trace: these are the two things
# the tick cannot run without, and a missing one is a deploy/config fault that
# needs naming, not debugging.
for required in DATABASE_URL ITURAN_PORTAL_USER ITURAN_PORTAL_PASS; do
  if [ -z "$(eval "printf '%s' \"\${$required:-}\"")" ]; then
    echo "$LOG_PREFIX ERROR: $required is not set (checked .env and .env.local in $PROJECT_DIR)" >&2
    exit 1
  fi
done

# A hung browser must not run into the next tick. The mint is ~5s and the grid
# fetch is one request, so 10 minutes is generous headroom before something is
# genuinely wrong.
#
# Playwright installs its own SIGTERM handler (handleSIGTERM defaults to true)
# and kills the browser process, so the plain TERM below does NOT orphan
# Chromium — measured: 10 chromium processes spawned, 0 left 6s after SIGTERM.
# --kill-after adds a SIGKILL backstop for the case where that graceful close
# is itself what has hung. A concurrent tick is prevented by an advisory lock in
# the script, not by this timeout.
if ! timeout --kill-after=30s 600 ./node_modules/.bin/tsx scripts/poll-ituran-tracking.ts; then
  echo "$LOG_PREFIX ERROR: ituran tracking poll failed" >&2
  exit 1
fi

echo "$LOG_PREFIX === Ituran tracking poll done ==="
