# Backfilling many recordings

For one video, follow SKILL.md. This is for "transcribe everything that's missing".

## Size the job first

```sql
SELECT count(*) AS untranscribed,
       pg_size_pretty(sum(recording_size_bytes)) AS bytes,
       count(*) - count(DISTINCT recording_size_bytes) AS duplicates
FROM meetings
WHERE recording_path IS NOT NULL AND coalesce(length(raw_transcript),0) < 200;
```

At ~9.4× realtime, GB ≈ hours of audio ÷ 3.5 (recordings run ~287 kbps). 39 GB
took roughly 20 hours of Mac Mini time. Run it detached:

```bash
setsid nohup nice -n 19 ionice -c3 ./backfill.sh > run.out 2>&1 < /dev/null & disown
```

`nice`/`ionice` matter — the ffmpeg chunking is CPU work on the same box as
production FibreFlow.

## The loop trap — read this before writing the script

A resumable worker that **re-queries its queue each iteration** loops forever if
the queue predicate overlaps the accept threshold.

Real failure: queue selected `length(raw_transcript) <= 500`, the accept floor
wrote at `>= 200`. A 92-second recording transcribed to 479 chars — written,
marked OK, immediately re-selected. **82 iterations on one meeting**, each
burning Mac Mini time and a paid summary call.

Use one constant for both, and prove the overlap is empty:

```sql
SELECT count(*) FROM meetings
WHERE coalesce(length(raw_transcript),0) >= 200      -- accepted
  AND coalesce(length(raw_transcript),0) <  200;     -- still queued  → must be 0
```

Then watch the first minute of the log:

```bash
grep -oP '#\d+ start' backfill.log | sort | uniq -c | sort -rn | head   # every count must be 1
```

**Count unique completions, not increments.** A counter reported `done:159` when
only 52 distinct meetings had been processed.

## Empty numeric variables fall through to success

```bash
chars=$(wc -c < "$F")                  # file gone → chars is EMPTY, not 0
if [ "$ok" -eq 0 ] || [ "$chars" -lt 200 ]; then   # [ "" -lt 200 ] ERRORS (rc 2) → false
```

`[ "" -lt 200 ]` is a bash *error*, not "false because too small", so `||`
short-circuits into the success branch and an empty transcript is written and
reported OK. Always:

```bash
chars=$(wc -c < "$F" 2>/dev/null || echo 0); chars=${chars:-0}
```

A `trap cleanup EXIT INT TERM` that `rm -rf`s the work dir must also stop the
loop. On SIGTERM the trap fired, deleted the temp dir, and the loop kept running
against a directory that no longer existed — which is how the empty counts arose.

## Deduplicate

Identical `recording_size_bytes` ⇒ identical bytes (verified by md5 of the first
10 MB). Copy the transcript instead of re-transcribing; it turned a 487-row queue
into 409 real jobs and a 7-minute job into seconds.

```sql
SELECT id FROM meetings
WHERE recording_size_bytes = (SELECT recording_size_bytes FROM meetings WHERE id = $ID)
  AND recording_size_bytes IS NOT NULL
  AND coalesce(length(raw_transcript),0) > 500 AND id <> $ID
LIMIT 1;
```

## Order the queue

Named meetings before generic ones — `ORDER BY (title NOT LIKE 'Teams Meeting%') DESC,
meeting_date DESC`. Roughly 60% of rows are untitled ad-hoc calls; the named ones
carry the content someone will actually ask about.

## Record failures loudly

A recording that yields nothing must land as `processing_status='failed'` with a
stated reason. Silently marking it `completed` is the bug #2393 existed to fix —
do not reintroduce it in a script.

## Cost

Transcription is free. Summaries go through the Cloudflare AI Gateway to gpt-4o —
about $15–25 for 489 meetings (~26.6k chars each). Verify against the gateway's
spend dashboard rather than trusting this estimate.
