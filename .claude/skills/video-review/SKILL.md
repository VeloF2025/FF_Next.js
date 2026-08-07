---
name: video-review
description: Watch, transcribe and analyse a Teams meeting recording — audio via on-prem Whisper, screen-share frames via ffmpeg. USE WHEN a staff member shares a Teams recording, meeting link, or meeting ID and wants it transcribed, summarised, or reviewed; when asked "what did they say in this video", "review this recording", "transcribe this meeting", "watch this walkthrough"; or when a meeting summary reads "No transcript available for analysis."
---

# Video Review — Teams recordings

Staff record walkthroughs of systems, workflows and automations and share them
as Teams meetings. This turns one into a transcript, the on-screen content, and
an opinion.

**Transcription is free** (on-prem Whisper). Summaries cost a few cents via the
Cloudflare AI Gateway. Never route audio to paid OpenAI STT.

## 1. Find the recording

| What you're given | How to resolve |
|---|---|
| `app.fibreflow.app/communications?tab=meetings&meeting=251591` | id is the `meeting=` param |
| A title and rough date | `SELECT id, title, meeting_date, recording_path FROM meetings WHERE title ILIKE '%…%' ORDER BY meeting_date DESC;` |
| "the one X sent yesterday" | filter on `organizer_name` / `organizer_email` |

```bash
DBURL=$(grep -m1 '^DATABASE_URL=postgresql.*localhost:5437' .claude/credentials.local.md | sed 's/^DATABASE_URL=//')
psql "$DBURL" -x -c "SELECT id,title,meeting_date,duration,organizer_name,recording_path,
  recording_size_bytes, coalesce(length(raw_transcript),0) AS tlen, transcript_source,
  processing_status, processing_error FROM meetings WHERE id = <ID>;"
```

Recordings live at `/home/velo/meeting-recordings/YYYY/MM/<id>.mp4`, world-readable
(no sudo). You are already on velo — never SSH.

**Trust the file on disk, not `recording_size_bytes`.** They diverge when a
download raced (see `processing_error` containing `.part`). Always `ffprobe` for
the real duration before planning work.

## 2. Decide whether it is worth transcribing

```bash
ffprobe -v error -show_entries format=duration -show_entries stream=codec_type,width,height \
  -of csv=p=0 "$MP4"
ffmpeg -nostdin -i "$MP4" -af volumedetect -f null - 2>&1 | grep -E "mean_volume|max_volume"
```

**Judge silence on `mean_volume`, never `max_volume`.** A single click gives
`max_volume: -13 dB` on a recording whose `mean_volume` is `-45.9 dB` — i.e.
silent. Anything at `-91.0 dB` is digital silence: no one spoke, skip it.

Whisper **hallucinates on near-silence**, typically returning `" I don't know."`
(15 chars). Treat any transcript under ~200 characters as a failure, not content.

## 3. Transcribe (free, on-prem)

Mac Mini whisper.cpp — `http://100.117.249.72:8009/inference`, `/health` → `{"status":"ok"}`.

Chunk to 15-minute 16 kHz mono WAVs and post each one. `translate=true` renders
Afrikaans and code-switched speech as English, which is what most of these are.

```bash
scripts/transcribe-recording.sh <meeting_id>     # see references/batch.md
```

**Throughput is ~9.4× realtime** (measured over 11 recordings; slowest 8.3×).
So 1 h of audio ≈ 7 min, 2 h ≈ 15 min. Budget accordingly before promising a turnaround.

That assumes the Mac Mini is otherwise idle. Whisper serves one queue: with a
backfill running, a 2-minute clip measured 61 s (~2×) instead of ~13 s. Check
`/health` and whether a batch is in flight before quoting a time.

## 4. Read the screen — do not skip this

Most of these videos are screen recordings. **The audio alone loses the
specification.** In meeting 251591 the speaker drew the button he wanted in MS
Paint and built the dashboard he wanted in Excel; a transcript-only pass would
have missed the entire ask.

```bash
# a frame every 30s, readable width
ffmpeg -nostdin -v error -i "$MP4" -vf "fps=1/30,scale=1280:-1" -q:v 3 frames/f_%03d.jpg
```

Frame `N` ≈ `(N-1) × 30` seconds. Read a spread first, then go back for detail:

```bash
# full-res crop of a UI region, upscaled — for reading Excel cells or form labels
ffmpeg -nostdin -v error -ss <SEC> -i "$MP4" -frames:v 1 \
  -vf "crop=720:300:975:575,scale=2160:-1:flags=lanczos" -q:v 2 crop.jpg
```

Cross-reference the two: the transcript gives intent and timestamps, the frames
give the concrete artefact. Whisper mangles proper nouns — "Lawley" became
"Loli", "Jarvis" became "javascript" — so confirm names against what's on screen.

## 5. Persist (optional — ask first)

Writing to `meetings` changes what the whole company sees in the app. Only do it
when asked, or when the stored transcript is demonstrably wrong.

```bash
B64=$(base64 -w0 transcript.txt)
psql "$DBURL" -c "UPDATE meetings SET raw_transcript=convert_from(decode('$B64','base64'),'UTF8'),
  transcript_source='whisper', processing_error=NULL, updated_at=now() WHERE id=<ID>;"
```

Base64 avoids every quoting problem with transcript text.

Then regenerate the summary **in-app** — `processWithLLM` uses the neon driver and
fails standalone in tsx:

```bash
curl -s -X POST "http://localhost:3000/api/meetings/process/<ID>" -H "Cookie: ff_auth_token=$TOKEN"
```

Minting `$TOKEN` (admin-only endpoint): `references/auth-token.md`. **The
`user_sessions.id` must equal the JWT's `sessionId` claim** — the lookup joins on
both, and a random UUID silently 401s.

A human-reviewed summary (`summary_source='cortex_human_reviewed'`) is locked and
will not be overwritten. That is intentional.

## 6. Report

Lead with what the person actually wants, not a chronological retelling. For a
walkthrough of a system, cover:

- **What they demonstrated** — the real workflow, including manual steps
- **What they asked for** — quote them, with timestamps
- **What they explicitly do *not* want changed** — people say this and it gets ignored
- **Whether it already exists** — check the schema and `origin/master` before proposing to build. In 251591 the feature had shipped 6 days earlier; the speaker was rejecting it.
- **Your assessment** — including where you think they are wrong

Check `git log origin/master --grep=<feature>` and the live schema before
concluding anything is unbuilt. Your local tree may be far behind.

## Gotchas

- **Duplicate rows are normal.** The OneDrive scraper and the Teams webhook each
  create a row for the same recording — identical `recording_size_bytes`, often
  a `-YYYYMMDD_HHMMSSUTC` title suffix. Same size ⇒ same bytes; transcribe once
  and copy, don't pay twice. (~16% of the backlog were duplicates.)
- **A "completed" meeting with an empty summary is a failure, not an empty meeting.**
  Historic rows say `"No transcript available for analysis."` with
  `processing_status='completed'` — that was a bug, fixed in #2393.
- **`length(raw_transcript)` is not the whole story.** A VTT over the inline limit
  spills to `meeting_transcripts`; check both before deciding a meeting needs work.
- **Never edit files in `/home/velo/fibreflow-*/`.** Read recordings from there; nothing else.

## Related

- `.claude/modules/meetings.md` — module reference (note: its Fireflies content is stale; the live pipeline is Teams + Graph)
- `references/batch.md` — backfilling many recordings safely
- `references/auth-token.md` — minting a session for the admin endpoints
