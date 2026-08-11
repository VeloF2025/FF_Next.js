#!/usr/bin/env bash
# ============================================================
# FibreFlow Database Backup (pg_dump)
# ============================================================
# Cron: 0 2 * * *  (daily 02:00 SAST) on Velocity
# Usage: bash scripts/db-backup.sh
# Install on Velocity: crontab -e (as velo)
#   0 2 * * * /home/velo/fibreflow-production/scripts/db-backup.sh \
#     >> /home/velo/backups/fibreflow/backup.log 2>&1
#
# ------------------------------------------------------------
# WHY THIS WAS REWRITTEN (2026-08-09)
#
# This script pointed at the Neon endpoint that was retired at the 2026-04-18
# cutover, with the credentials hardcoded below. Every weekly run since then
# failed authentication and produced a 20-byte file that decompressed to zero
# bytes:
#
#   pg_dump: error: connection to server at "ep-dry-night-...neon.tech" failed:
#            password authentication failed for user 'neondb_owner'
#
# Those files still carried the name `fibreflow-<date>.sql.gz`, so the backup
# directory looked healthy while containing nothing. FibreFlow's production
# database went ~16 weeks with no recoverable copy, and it was only noticed
# when someone went looking for a restore point.
#
# Three things caused that, and all three are addressed here:
#
#   1. Wrong target, hardcoded.   The connection is now read from the app's env
#      file at run time, so it follows the database rather than a literal baked
#      into a tracked file. No credential lives in this script.
#
#   2. Failure left a plausible artefact.   `pg_dump | gzip > "$FILE"` creates
#      the file via the redirect BEFORE pg_dump fails, and nothing removed it.
#      We now dump to a temp file and only move it into place after it passes
#      verification, so a failed run leaves no file at all — an absent backup
#      is obvious, a zero-byte one is not.
#
#   3. Nothing verified the result.   scripts/db-backup-verify.sh exists but was
#      never added to any crontab, and it checked the same stale directory. The
#      integrity checks below are therefore done inline, on every run, rather
#      than deferred to a separate job that may not be scheduled.
# ------------------------------------------------------------

set -euo pipefail

# --- Paths (resolved from the script's own location; cron does not cd) ---
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(dirname "$SCRIPT_DIR")"

BACKUP_DIR="${FF_BACKUP_DIR:-/home/velo/backups/fibreflow}"
LOG_FILE="${BACKUP_DIR}/backup.log"
RETENTION_COUNT="${FF_BACKUP_RETENTION:-14}"   # 14 daily backups
DATE=$(date +%Y-%m-%d)
DUMP_FILE="${BACKUP_DIR}/fibreflow-${DATE}.sql.gz"

# A dump of this database is hundreds of MB. Anything under this is not a
# backup, whatever pg_dump's exit status said.
MIN_BYTES="${FF_BACKUP_MIN_BYTES:-10485760}"   # 10 MB

# Optional WhatsApp alerting. Unset -> alerting is skipped, and the script says
# so, rather than silently doing nothing.
WA_BRIDGE="${FF_BACKUP_WA_BRIDGE:-}"
WA_GROUP_JID="${FF_BACKUP_WA_GROUP:-}"

# `|| true` is load-bearing, not defensive noise. $LOG_FILE lives in $BACKUP_DIR,
# the same filesystem the dump is written to, so the most likely real failure —
# a full disk — breaks the dump and this tee in the same instant. Every failure
# branch below calls log() and *then* alert(); under `set -e` a failing tee
# aborts the script between the two, so the one run that most needs an alert
# would send none. tee still writes to stdout, which cron appends to the log.
log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE" || true
}

alert() {
  local message="$1"
  if [[ -z "$WA_BRIDGE" || -z "$WA_GROUP_JID" ]]; then
    log "ALERT (not sent — FF_BACKUP_WA_BRIDGE/FF_BACKUP_WA_GROUP unset): ${message}"
    return 0
  fi
  curl -s --max-time 15 -X POST "$WA_BRIDGE" \
    -H "Content-Type: application/json" \
    -d "{\"group_jid\":\"${WA_GROUP_JID}\",\"message\":\"${message}\"}" \
    >/dev/null 2>&1 || log "WARNING: alert delivery failed"
}

mkdir -p "$BACKUP_DIR"

# --- Resolve the connection string ---
# Same precedence as scripts/run-pending-migrations.sh: prefer the direct
# superuser URL, fall back to the app URL. pg_dump needs to read every object,
# and the tables are owned by `postgres`, so the app role may not see all of
# them — a dump that silently omits tables is the failure mode this whole
# rewrite exists to prevent.
#
# Search the app dir derived from the script's own location FIRST, because the
# crontab entry invokes the script by absolute path without cd-ing, so $PWD is
# whatever cron hands us (/home/velo). $PWD is checked afterwards so a manual
# run from inside the app directory also works — a copy of this script executed
# from somewhere else would otherwise resolve APP_DIR to "/" and report that no
# database URL exists, which reads as a config fault rather than a bad cwd.
PGURL="${MIGRATION_DATABASE_URL:-${DATABASE_URL:-}}"
if [[ -z "$PGURL" ]]; then
  for env_file in "$APP_DIR/.env.local" "$APP_DIR/.env" "$PWD/.env.local" "$PWD/.env"; do
    [[ -f "$env_file" ]] || continue
    if [[ -z "$PGURL" ]]; then
      PGURL=$(grep -E '^MIGRATION_DATABASE_URL=' "$env_file" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"' || true)
    fi
    if [[ -z "$PGURL" ]]; then
      PGURL=$(grep -E '^DATABASE_URL=' "$env_file" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"' || true)
    fi
  done
fi

if [[ -z "$PGURL" ]]; then
  log "FAILED: no MIGRATION_DATABASE_URL or DATABASE_URL found (checked the environment, ${APP_DIR}/.env{.local}, and ${PWD}/.env{.local})"
  alert "🔴 DB BACKUP FAILED on $(hostname): no database URL resolved. Check ${LOG_FILE}"
  exit 2
fi

# Log where we are dumping from, without the credentials. The previous script
# gave no indication of its target, so a run that authenticated against the
# wrong database would have looked identical to a correct one.
SAFE_TARGET=$(echo "$PGURL" | sed -E 's#(://[^:/]+):[^@]*@#\1:***@#')
log "Starting FibreFlow database backup from ${SAFE_TARGET}"

# libpq percent-decodes URI components but reads PGPASSWORD verbatim, so an
# encoded password has to be decoded here or authentication fails.
#
# Decode ONLY well-formed %XX escapes, one at a time. The obvious shortcut —
# `printf '%b' "${raw//%/\\x}"` — feeds the *whole* password through printf, so
# any unrelated backslash already in it is reinterpreted too: `pa\nss%40end`
# came out as `pa`, a newline, `ss@end`. That corrupts a password which worked
# before, on a future rotation, with no code change to trigger it. Result goes
# in a variable rather than through $(...) because command substitution eats
# trailing newlines and %0A is a legal escape.
PCT_DECODED=''
percent_decode() {
  # Declared separately: bash expands the whole `local` command before any of
  # its assignments take effect, so `local s=$1 n=${#s}` reads an unset `s` and
  # dies under `set -u`.
  local s=$1
  local out='' i=0 ch
  local n=${#s}
  while (( i < n )); do
    if [[ ${s:i:1} == '%' && ${s:i+1:2} =~ ^[0-9A-Fa-f]{2}$ ]]; then
      # The hex goes into the format string itself: bash's printf resolves \x
      # while parsing the format, so '\x%s' is a literal-backslash error, not
      # an escape. The two characters are validated as hex by the test above.
      printf -v ch "\\x${s:i+1:2}"
      out+=$ch
      (( i += 3 ))
    else
      out+=${s:i:1}
      (( i += 1 ))
    fi
  done
  PCT_DECODED=$out
}

# --- Keep the password out of argv ---
# pg_dump does not scrub its own command line: passing the full URI would put
# the password in /proc/<pid>/cmdline and `ps aux` — world-readable — for the
# entire multi-minute dump. Hand it over via PGPASSWORD (only visible through
# /proc/<pid>/environ, which is restricted to the process owner) and give
# pg_dump a URI with the password removed. Everything else about the URI —
# host, port, database, sslmode and friends — is preserved untouched.
PG_PASS_RAW=$(printf '%s' "$PGURL" | sed -nE 's#^[a-zA-Z][a-zA-Z0-9+.-]*://[^:/?#]+:([^@]*)@.*#\1#p')
if [[ -n "$PG_PASS_RAW" ]]; then
  # A stray `%` that is not a valid escape is a malformed URI. libpq used to be
  # the one rejecting it, with a precise message; now that it never sees the
  # password, say so here rather than guessing at the operator's intent.
  if [[ "$PG_PASS_RAW" =~ %([^0-9A-Fa-f]|[0-9A-Fa-f][^0-9A-Fa-f]|.?$) ]]; then
    log "FAILED: the password in the database URL contains a malformed percent-escape"
    alert "🔴 DB BACKUP FAILED on $(hostname): malformed percent-escape in the database URL. Check ${LOG_FILE}"
    exit 2
  fi
  percent_decode "$PG_PASS_RAW"
  PGPASSWORD="$PCT_DECODED"
  export PGPASSWORD
  PG_CONN=$(printf '%s' "$PGURL" | sed -E 's#(^[a-zA-Z][a-zA-Z0-9+.-]*://[^:/?#]+):[^@]*@#\1@#')
else
  PG_CONN="$PGURL"
fi
unset PCT_DECODED PG_PASS_RAW

# There was an assertion here re-checking that $PG_CONN carried no password
# before it reached argv. It is deliberately gone. The strip above handles the
# URI form, which is the only form this repo produces — MIGRATION_DATABASE_URL
# and DATABASE_URL are URIs everywhere, as the SAFE_TARGET regex already
# assumes. The assertion guarded a keyword/value conninfo string that cannot
# occur, and over two review rounds it twice broke in a worse direction than
# the risk it covered: its first regex aborted the run on an `@` in any query
# value and on the unrelated `sslpassword=` keyword. A guard that wrongly stops
# a nightly production backup is a worse outcome than the leak it was watching
# for. If a non-URI conninfo ever becomes reachable here, strip it properly
# rather than re-adding a check downstream of the thing that failed to strip it.

# --- Dump to a temp file; only publish it once it has been verified ---
TMP_FILE=$(mktemp "${BACKUP_DIR}/.fibreflow-${DATE}.XXXXXX.sql.gz")
cleanup() { rm -f "$TMP_FILE"; }
trap cleanup EXIT

DUMP_OK=0
if pg_dump "$PG_CONN" \
      --no-owner \
      --no-acl \
      --format=plain \
      2>>"$LOG_FILE" \
    | gzip -9 > "$TMP_FILE"; then
  DUMP_OK=1
fi

# pg_dump is the only consumer. Unset before the branch, not after it: on the
# failure path `alert()` shells out to curl, so unsetting only on success left
# the one call this was meant to protect still carrying the password.
unset PGPASSWORD

if (( ! DUMP_OK )); then
  log "FAILED: pg_dump did not complete — no backup written for ${DATE}"
  alert "🔴 DB BACKUP FAILED on $(hostname) at $(date '+%H:%M'): pg_dump error. Check ${LOG_FILE}"
  exit 1
fi

# --- Verify before publishing ---
DUMP_BYTES=$(stat -c%s "$TMP_FILE")

if ! gzip -t "$TMP_FILE" 2>>"$LOG_FILE"; then
  log "FAILED: archive is not a valid gzip stream — discarding"
  alert "🔴 DB BACKUP FAILED on $(hostname): corrupt archive. Check ${LOG_FILE}"
  exit 1
fi

if [[ "$DUMP_BYTES" -lt "$MIN_BYTES" ]]; then
  log "FAILED: dump is ${DUMP_BYTES} bytes, below the ${MIN_BYTES}-byte floor — discarding"
  alert "🔴 DB BACKUP FAILED on $(hostname): dump only ${DUMP_BYTES} bytes. Check ${LOG_FILE}"
  exit 1
fi

# Size and gzip validity are not enough on their own:
#
#   * An error page or auth banner compresses to a perfectly well-formed
#     archive, so `gzip -t` passing says nothing about the contents.
#   * `gzip -t` validates the container. If pg_dump were to emit a PARTIAL SQL
#     stream that gzip then closed cleanly, the archive would still test OK
#     while the dump was truncated mid-table.
#
# So verify the contents: schema we know must exist, and pg_dump's own trailing
# completion marker, which is only written once the dump has run to the end.
#
# Deliberately ONE full-scan pass with no early exit. The obvious form,
# `zcat "$f" | grep -qm1 ...`, is a trap: grep exits on first match, closes the
# pipe, zcat dies with SIGPIPE (141), and `set -o pipefail` turns that into a
# failed check — so a dump that DOES contain the table gets discarded. It is
# invisible at small scale (zcat finishes before grep exits) and only appears on
# a real multi-GB dump. Counting every match instead means grep consumes the
# whole stream, so there is no SIGPIPE and no need to toggle pipefail.
MARKERS=$(zcat "$TMP_FILE" | grep -c -e 'CREATE TABLE public.attendance_daily_summaries' \
                                     -e 'PostgreSQL database dump complete' || true)
if [[ "$MARKERS" -lt 2 ]]; then
  log "FAILED: dump failed content verification (expected schema + completion marker; matched ${MARKERS}/2) — discarding"
  alert "🔴 DB BACKUP FAILED on $(hostname): dump incomplete or missing expected tables. Check ${LOG_FILE}"
  exit 1
fi

mv "$TMP_FILE" "$DUMP_FILE"
trap - EXIT
log "SUCCESS: ${DUMP_FILE} ($(du -h "$DUMP_FILE" | cut -f1))"

# --- Retention ---
# Counts only published backups; temp files never reach this pattern, and
# failed runs no longer leave anything to count.
mapfile -t BACKUPS < <(ls -1t "${BACKUP_DIR}"/fibreflow-*.sql.gz 2>/dev/null || true)
# A misconfigured FF_BACKUP_RETENTION=0 would slice the whole array and delete
# the backup published two lines ago along with every older one, leaving no
# backup at all after a successful run. Keeping at least the newest copy is
# never the wrong answer for a script whose only job is to have one.
if [[ "$RETENTION_COUNT" -lt 1 ]]; then
  log "WARNING: FF_BACKUP_RETENTION=${RETENTION_COUNT} would delete every backup; keeping the newest 1"
  RETENTION_COUNT=1
fi
if [[ "${#BACKUPS[@]}" -gt "$RETENTION_COUNT" ]]; then
  for OLD_FILE in "${BACKUPS[@]:$RETENTION_COUNT}"; do
    log "Removing old backup: ${OLD_FILE}"
    rm -f "$OLD_FILE"
  done
fi

log "Backup complete — $(ls -1 "${BACKUP_DIR}"/fibreflow-*.sql.gz 2>/dev/null | wc -l) backup(s) retained in ${BACKUP_DIR}"
log "---"
