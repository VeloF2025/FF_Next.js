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
# It must agree with dotenv on every value, not merely avoid crashing. Where the
# two disagree the wrapper and the app read the SAME file differently, and the
# resulting failure looks like a portal rejecting good credentials. So this
# mirrors dotenv 16.x's grammar (@next/env vendors it): optional `export`,
# optional whitespace around `=`, quoted values kept verbatim (and allowed to
# span lines), unquoted values truncated at `#` and trimmed.
#
# Shell-critical names are refused: this script resolves `timeout` through PATH
# after loading, and an env file is not a place that should be able to change
# that.
__ENV_SET_BY_LOADER=" "

load_env_file() {
  local file="$1" line key val quote buf closed i j n
  # Read the whole file first. A streaming loop cannot back out of a quote that
  # turns out never to close: it consumes the rest of the file into that value
  # and every later key silently vanishes. dotenv instead falls back to reading
  # that one line as unquoted and carries on, which needs lookahead the array
  # gives us for free. These files are a few hundred lines.
  local -a lines=()
  while IFS= read -r line || [ -n "$line" ]; do
    lines+=("${line%$'\r'}")                # CRLF-authored file
  done < "$file"

  n=${#lines[@]}
  i=0
  while [ "$i" -lt "$n" ]; do
    line=${lines[$i]}
    i=$((i + 1))
    line=${line#"${line%%[![:space:]]*}"}   # leading indentation
    case "$line" in ''|'#'*) continue ;; esac
    case "$line" in
      export[[:space:]]*)
        line=${line#export}
        line=${line#"${line%%[![:space:]]*}"}
        ;;
    esac
    case "$line" in *=*) ;; *) continue ;; esac

    key=${line%%=*}
    val=${line#*=}
    key=${key%"${key##*[![:space:]]}"}      # `FOO = bar`
    case "$key" in ''|*[!A-Za-z0-9_.-]*) continue ;; esac
    val=${val#"${val%%[![:space:]]*}"}

    case "$val" in
      \"*|\'*)
        # Quoted: content kept exactly, including '#'. dotenv allows these to
        # span lines, so look ahead for the closing quote.
        quote=${val:0:1}
        buf=${val#?}
        closed=0
        case "$buf" in *"$quote") buf=${buf%"$quote"}; closed=1 ;; esac
        if [ "$closed" -eq 0 ]; then
          j=$i
          while [ "$j" -lt "$n" ]; do
            buf="$buf
${lines[$j]}"
            j=$((j + 1))
            case "$buf" in *"$quote") buf=${buf%"$quote"}; closed=1; break ;; esac
          done
          [ "$closed" -eq 1 ] && i=$j
        fi
        if [ "$closed" -eq 1 ]; then
          val=$buf
        else
          # Never closed. Treat THIS line as unquoted — opening quote and all,
          # exactly as dotenv does — and resume at the next line rather than
          # swallowing the remainder of the file.
          val=${val%%#*}
          val=${val%"${val##*[![:space:]]}"}
        fi
        ;;
      *)
        val=${val%%#*}                      # inline trailing comment
        val=${val%"${val##*[![:space:]]}"}  # trailing whitespace
        ;;
    esac

    case " PATH IFS ENV BASH_ENV SHELLOPTS PS4 LD_PRELOAD LD_LIBRARY_PATH " in
      *" $key "*)
        echo "$LOG_PREFIX WARNING: refusing to import $key from $(basename "$file")" >&2
        continue
        ;;
    esac

    # A value already in the real environment wins over the files (dotenv does
    # not override process.env), but a later FILE overrides an earlier one so
    # .env.local still beats .env.
    case "$__ENV_SET_BY_LOADER" in
      *" $key "*) ;;
      *) [ -n "${!key+isset}" ] && continue ;;
    esac
    __ENV_SET_BY_LOADER="$__ENV_SET_BY_LOADER$key "
    export "$key=$val"
  done
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
  # Indirect expansion, not eval. The `:-` matters: under `set -u` a bare
  # ${!required} aborts on the very case this is meant to report.
  if [ -z "${!required:-}" ]; then
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
