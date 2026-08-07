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
# deploy dir's env file into it, ignoring comments and blank lines. `set -a`
# marks everything sourced as exported.
if [ -f "$PROJECT_DIR/.env.local" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$PROJECT_DIR/.env.local"
  set +a
elif [ -f "$PROJECT_DIR/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$PROJECT_DIR/.env"
  set +a
else
  echo "$LOG_PREFIX ERROR: no .env.local or .env in $PROJECT_DIR" >&2
  exit 1
fi

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
