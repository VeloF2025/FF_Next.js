#!/usr/bin/env bash
#
# Transcribe one Teams meeting recording with the on-prem Whisper (free).
#
#   scripts/transcribe-recording.sh <meeting_id> [outfile]
#
# Prints the transcript to stdout (and to outfile if given). Does NOT write to
# the database — persisting changes what the whole company sees in the app, so
# that stays an explicit, separate step. See .claude/skills/video-review/.
#
set -uo pipefail

MEETING_ID=${1:-}
OUT=${2:-}
[ -z "$MEETING_ID" ] && { echo "usage: $0 <meeting_id> [outfile]" >&2; exit 2; }

# The id is interpolated into a psql -c string, so constrain it to digits before
# it gets anywhere near SQL. Without this, `'1; DROP TABLE meetings--'` is a
# valid argument.
case "$MEETING_ID" in
  ''|*[!0-9]*) echo "meeting id must be a positive integer, got: $MEETING_ID" >&2; exit 2 ;;
esac

WHISPER=${WHISPER_REMOTE_URL:-http://100.117.249.72:8009}/inference
CHUNK_SEC=900          # 15 min per request
MIN_CHARS=200          # below this, Whisper hallucinated on silence — not content
SILENCE_DB=-70         # mean_volume at or below this is effectively silent

REPO=$(cd "$(dirname "$0")/.." && pwd)

# credentials.local.md is gitignored, so it is absent from every worktree.
# Precedence: explicit env → this checkout → the main tree (worktree fallback).
if [ -n "${DATABASE_URL:-}" ]; then
  DBURL="$DATABASE_URL"
else
  for c in "$REPO/.claude/credentials.local.md" \
           "/home/hein/Workspace/FF_Next.js/.claude/credentials.local.md"; do
    [ -r "$c" ] || continue
    DBURL=$(grep -m1 '^DATABASE_URL=postgresql.*localhost:5437' "$c" | sed 's/^DATABASE_URL=//')
    [ -n "$DBURL" ] && break
  done
fi
[ -n "${DBURL:-}" ] || {
  echo "No database URL. Set DATABASE_URL, or run from a checkout with .claude/credentials.local.md" >&2
  exit 1
}

say() { echo "[$(date +%H:%M:%S)] $*" >&2; }

# Keep psql's exit status distinct from "row has no recording" — otherwise a DB
# outage and a genuinely missing row report the same thing.
PSQL_ERR=$(mktemp /tmp/tr-psql-XXXXXX) || { echo "could not create temp file" >&2; exit 1; }
if ! path=$(psql "$DBURL" -t -A -c \
      "SELECT recording_path FROM meetings WHERE id = $MEETING_ID;" 2>"$PSQL_ERR"); then
  echo "meeting $MEETING_ID: database query failed" >&2
  sed 's/^/  /' "$PSQL_ERR" >&2
  rm -f "$PSQL_ERR"
  exit 1
fi
rm -f "$PSQL_ERR"
[ -n "$path" ] || { echo "meeting $MEETING_ID: no recording_path in DB" >&2; exit 1; }
[ -f "$path" ] || { echo "meeting $MEETING_ID: file missing on disk: $path" >&2; exit 1; }

# Duration from the FILE, never recording_size_bytes — they diverge when a
# download raced (processing_error containing '.part').
dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$path" 2>/dev/null | cut -d. -f1)
[ "${dur:-0}" -gt 0 ] 2>/dev/null || { echo "meeting $MEETING_ID: unreadable media" >&2; exit 1; }

# Silence check on MEAN volume. max_volume is misleading: one click reads -13dB
# on a recording whose mean is -46dB, i.e. nobody spoke.
mean=$(ffmpeg -nostdin -i "$path" -af volumedetect -f null - 2>&1 \
       | grep -oP 'mean_volume: \K[-0-9.]+' | head -1)
if [ -n "$mean" ] && awk "BEGIN{exit !($mean <= $SILENCE_DB)}"; then
  echo "meeting $MEETING_ID: mean_volume ${mean}dB — silent, nothing to transcribe" >&2
  exit 3
fi

say "meeting $MEETING_ID: ${dur}s audio, mean_volume ${mean:-?}dB"

WORK=$(mktemp -d /tmp/tr-XXXXXX) || { echo "could not create temp dir" >&2; exit 1; }
[ -d "$WORK" ] || { echo "temp dir missing after mktemp" >&2; exit 1; }
cleanup() { rm -rf "$WORK"; }
# INT/TERM must also EXIT. A trap that only cleans up lets bash resume the script
# afterwards, so the loop carries on against a work dir that no longer exists —
# the incident documented in references/batch.md.
trap cleanup EXIT
trap 'cleanup; exit 130' INT TERM

: > "$WORK/out.txt"
n=0
for (( s=0; s<dur; s+=CHUNK_SEC )); do
  w="$WORK/c.wav"
  ffmpeg -nostdin -v error -ss "$s" -t "$CHUNK_SEC" -i "$path" \
         -vn -ac 1 -ar 16000 -c:a pcm_s16le -y "$w" 2>/dev/null
  [ -s "$w" ] || { say "chunk $n: empty wav, stopping"; break; }

  say "chunk $n (t+${s}s) -> whisper"
  # -f is load-bearing: without it `curl -s` exits 0 on 4xx/5xx and writes the
  # error body to c.json. The parse below would then fail, contribute nothing,
  # and the remaining chunks could still push the total past MIN_CHARS — leaving
  # a transcript reported as complete while silently missing a whole chunk.
  # translate=true renders Afrikaans / code-switched speech as English.
  # -w still reports the status under -f, which suppresses the body — so the
  # HTTP code is the diagnostic, not the (absent) response text.
  if ! http=$(curl -sf -m 1800 -F "file=@${w}" -F response_format=verbose_json \
                   -F temperature=0.0 -F translate=true "$WHISPER" \
                   -o "$WORK/c.json" -w '%{http_code}'); then
    echo "meeting $MEETING_ID: whisper request failed on chunk $n (t+${s}s) — HTTP ${http:-<no response>}" >&2
    echo "  endpoint: $WHISPER" >&2
    exit 1
  fi

  # A malformed body is a failure of THIS chunk, not an empty chunk. Say so and
  # stop, rather than emitting a partial transcript that looks complete.
  if ! python3 - "$WORK/c.json" "$s" >> "$WORK/out.txt" <<'PY'
import json, sys
try:
    d = json.load(open(sys.argv[1]))
except Exception as e:
    print(f"whisper returned unparseable JSON: {e}", file=sys.stderr)
    sys.exit(1)
if 'segments' not in d:
    print("whisper response has no 'segments' key", file=sys.stderr)
    sys.exit(1)
off = int(sys.argv[2])
for i, seg in enumerate(d['segments']):
    # A segment missing text/start means the response shape changed. Stop with a
    # readable reason rather than a traceback — and never skip it silently, which
    # would drop audio from a transcript that still looks complete.
    if 'text' not in seg or 'start' not in seg:
        print(f"segment {i} missing text/start — unexpected whisper response shape",
              file=sys.stderr)
        sys.exit(1)
    t = seg['text'].strip()
    if t:
        st = off + int(float(seg['start']))
        print(f"({st//60}:{st%60:02d}) {t}")
PY
  then
    echo "meeting $MEETING_ID: could not read whisper response for chunk $n (t+${s}s)" >&2
    exit 1
  fi
  rm -f "$w"
  n=$(( n + 1 ))
done

# Guard the capture: an empty var makes `[ "$c" -lt N ]` ERROR (rc 2), which a
# bare `||` would treat as success and emit an empty transcript as if it worked.
chars=$(wc -c < "$WORK/out.txt" 2>/dev/null || echo 0)
chars=${chars:-0}

if [ "$chars" -lt "$MIN_CHARS" ]; then
  echo "meeting $MEETING_ID: only ${chars} chars (min ${MIN_CHARS}) — treat as FAILED, not as content." >&2
  echo "  Whisper returns a short hallucination (often \" I don't know.\") on near-silence." >&2
  exit 3
fi

say "meeting $MEETING_ID: ${chars} chars from ${n} chunk(s)"
[ -n "$OUT" ] && cp "$WORK/out.txt" "$OUT" && say "written to $OUT"
cat "$WORK/out.txt"
