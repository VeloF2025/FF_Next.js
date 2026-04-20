# Meetings Module Documentation

**Module**: Meetings Management & Recording Automation
**Status**: Active Development (Presence-Based Recording Added Mar 13, 2026)
**Last Updated**: March 13, 2026

---

## 🎯 Module Overview

The Meetings module captures, processes, and analyzes Microsoft Teams meetings. As of **March 13, 2026** (commit `c5f36dd`), the module now includes:

- **Multi-Participant Meeting Resolution**: Fixed "Meet Now" call transcript recovery by trying all tenant participants
- **Presence-Based Automatic Recording**: Detects when users enter Teams calls and dispatches Docker bots to record
- **Automatic Transcription**: Whisper-powered transcription of bot-recorded audio
- **LLM Enrichment**: Summary, action items, and topic extraction via GPT-4o

### Key Capabilities ✅
- 📞 **Call Detection**: Graph API presence webhooks notify when users enter calls
- 🤖 **Bot Recording**: Headless Chromium bot joins Teams meetings and records audio
- 🎙️ **Transcription**: OpenAI Whisper transcription of recorded audio
- 🧠 **Enrichment**: GPT-4o summarization, action item extraction, topic analysis
- 🔄 **Automatic Pipeline**: End-to-end automation from presence detection to enriched transcript

---

## 🏗️ Architecture

```
[Microsoft Graph Presence Webhook]
    ↓ (detects InAConferenceCall)
[POST /api/meetings/presence-webhook]
    ↓ (validates & parses presence changes)
[Presence Processor] → [findActiveMeetingUrl()]
    ↓ (queries recent online meetings)
[Recording Bot Dispatcher]
    ↓ (launches Docker container)
[Docker: screenappai/meeting-bot]
    ├── Chromium headless
    ├── Xvfb (virtual display)
    ├── PulseAudio (virtual audio)
    └── ffmpeg (audio capture)
    ↓ (records audio while meeting is active)
[POST /api/recording-bot/callback]
    ↓ (receives recording metadata)
[Whisper Transcriber]
    ├── faster-whisper on CPU
    └── English translation
    ↓ (transcription complete)
[Existing LLM Pipeline]
    ├── GPT-4o summary
    ├── Action item extraction
    └── Topic classification
    ↓
[Enriched Meeting Record in Database]
```

### Presence Subscription Lifecycle

```
[Application Startup] or [Cron Every 45 Min]
    ↓
[POST /api/cron/manage-presence-subscriptions]
    ├─ Check for active presence subscriptions
    ├─ If none: CREATE new subscription
    ├─ If expiring in <15 min: RENEW by extending expiry
    └─ CLEANUP expired subscriptions
    ↓
[Graph API /subscriptions]
    └─ Receives notifications for 60 minutes (max)
```

---

## 📡 API Endpoints

### Presence Subscription Management
**Cron Endpoint** — Must be called every 45 minutes (subscriptions max lifetime = 60 min)

```
POST /api/cron/manage-presence-subscriptions

Auth: CRON_SECRET bearer token
Response: 202 OK

{
  "success": true,
  "active": 1,
  "renewed": 0,
  "created": 0,
  "failed": 0,
  "cleaned": 0
}
```

**Purpose**: Manages Graph API presence webhooks
- **Creates** new presence subscription if none exists
- **Renews** subscriptions expiring in the next 15 minutes
- **Cleans** expired subscriptions from the graph_subscriptions table

**Schedule**: Every 45 minutes (via crontab or external scheduler)

```bash
# Example crontab entry
*/45 * * * * curl -s -X POST https://app.fibreflow.app/api/cron/manage-presence-subscriptions \
  -H "Authorization: Bearer $CRON_SECRET"
```

---

### Presence Change Webhook
**Inbound Webhook** — Called by Microsoft Graph

```
POST /api/meetings/presence-webhook

Validation Handshake:
  GET /api/meetings/presence-webhook?validationToken=<token>
  Response: <token> (text/plain)

Notification Payload:
{
  "value": [
    {
      "subscriptionId": "...",
      "clientState": "...",
      "changeType": "updated",
      "resource": "/communications/presences/user-id",
      "resourceData": {
        "id": "user-id",
        "availability": "Available",
        "activity": "InAConferenceCall"
      }
    }
  ]
}
```

**Response**: 202 Accepted (processing async)

**Purpose**: Detects when users enter/leave Teams calls
- **Processing**: Asynchronous (returns 202 immediately)
- **Detection**: Watches for `activity: "InACall"` or `"InAConferenceCall"`
- **Bot Dispatch**: Attempts to find meeting URL and launch recording bot

---

### Recording Bot Callback
**Callback from Docker Bot** — Receives completion metadata

```
POST /api/recording-bot/callback

Auth: CRON_SECRET bearer token
Content-Type: application/json

{
  "recording_id": 42,
  "status": "completed",
  "audio_path": "/output/recording.wav",
  "audio_size": 52428800,
  "duration_sec": 3600,
  "error": null
}
```

**Response**: 202 Accepted (processing async)

**Purpose**: Handles bot recording completion
- **Updates** bot_recordings table with metadata
- **Launches** Whisper transcription pipeline
- **Creates** meeting record if needed
- **Runs** LLM enrichment pipeline
- **Logs** completion status

**Error Handling**: If `status: "failed"`, stores error and stops processing.

---

## 🗄️ Database Schema

### bot_recordings

Tracks all recording bot dispatch and execution.

```sql
CREATE TABLE bot_recordings (
  id              SERIAL PRIMARY KEY,
  meeting_id      INTEGER REFERENCES meetings(id) ON DELETE SET NULL,
  join_url        TEXT NOT NULL,                    -- Teams meeting URL
  container_id    TEXT,                             -- Docker container ID
  status          VARCHAR(30) NOT NULL DEFAULT 'dispatched'
                  CHECK (status IN (
                    'dispatched', 'joining', 'recording', 'uploading',
                    'completed', 'failed', 'timeout'
                  )),
  triggered_by    TEXT,                             -- Graph user ID that triggered detection
  audio_path      TEXT,                             -- Local path to recorded audio
  audio_size      INTEGER,                          -- File size in bytes
  duration_sec    INTEGER,                          -- Recording duration in seconds
  error           TEXT,                             -- Error message on failure
  dispatched_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at      TIMESTAMPTZ,                      -- When bot joined meeting
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_bot_recordings_status ON bot_recordings(status);
CREATE INDEX idx_bot_recordings_join_url ON bot_recordings(join_url);
```

**Status Lifecycle**:
- `dispatched` → Docker command issued
- `joining` → Bot container started, joining meeting
- `recording` → Audio being captured
- `uploading` → Recording complete, transferring to storage
- `completed` → Transcription and enrichment done
- `failed` → Error during execution
- `timeout` → Exceeded max duration (3 hours)

---

### presence_monitor

Tracks real-time presence state per user for deduplication.

```sql
CREATE TABLE presence_monitor (
  user_id         TEXT PRIMARY KEY,                 -- Graph user ID
  display_name    TEXT,
  email           TEXT,
  last_status     VARCHAR(30),                      -- Last known presence status
  in_call_since   TIMESTAMPTZ,                      -- When current call started
  bot_dispatched  BOOLEAN DEFAULT FALSE,            -- Whether bot dispatched for this call
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**Purpose**: Prevents bot dispatch duplication for the same call
- On presence change, check if bot already dispatched
- If new call detected (presence changed from non-in-call), dispatch bot once
- Reset when user leaves call

---

### graph_subscriptions

Tracks active Microsoft Graph API subscriptions.

```
(Used by presence subscription management)
```

---

## 🐳 Recording Bot Setup

### Prerequisites

1. **Azure AD Application Permissions**
   - `Presence.Read.All` — Read all users' presence
   - `OnlineMeetings.Read.All` — Read online meetings (for URL discovery)

2. **Docker**
   ```bash
   docker pull ghcr.io/screenappai/meeting-bot:latest
   mkdir -p /home/velo/bot-recordings
   ```

3. **Python + Whisper**
   ```bash
   pip install faster-whisper
   ```

4. **Environment Variables** (`.env.local`)
   ```bash
   # Recording bot
   RECORDING_BOT_IMAGE=ghcr.io/screenappai/meeting-bot:latest
   BOT_RECORDINGS_PATH=/home/velo/bot-recordings
   RECORDING_BOT_CALLBACK_URL=https://app.fibreflow.app/api/recording-bot/callback
   RECORDING_BOT_NAME=VF Recorder
   RECORDING_BOT_NETWORK=bridge
   
   # Whisper
   WHISPER_MODEL=medium
   WHISPER_SCRIPT_PATH=/home/velo/fibreflow-production/scripts/recording-bot/transcribe.py
   
   # Graph API
   GRAPH_WEBHOOK_SECRET=<random-secure-token>
   ```

5. **Database Migration**
   ```bash
   npx tsx scripts/run-migration.ts 311
   ```

6. **Cron Job** — Add to crontab (presence subscriptions expire every 60 min)
   ```bash
   */45 * * * * curl -s -X POST https://app.fibreflow.app/api/cron/manage-presence-subscriptions \
     -H "Authorization: Bearer $CRON_SECRET"
   ```

---

## ⚙️ Configuration

### Max Concurrent Bots

Default: **5** concurrent recordings

Edit `src/lib/recording-bot/dispatcher.ts`:

```typescript
const MAX_CONCURRENT_BOTS = 5;  // Increase for more parallel recordings
```

### Recording Timeout

Default: **3 hours** per recording

Edit `src/lib/recording-bot/dispatcher.ts`:

```typescript
const RECORDING_TIMEOUT_MS = 3 * 60 * 60 * 1000;  // milliseconds
```

### Whisper Model

Default: **medium** (430MB)

Options: `tiny`, `base`, `small`, `medium`, `large`

Edit `.env.local`:
```bash
WHISPER_MODEL=medium    # Balance between speed and accuracy
```

---

## 🔧 Library Modules

### src/lib/graph/presence.ts

Presence monitoring and webhook integration.

**Exports**:

| Function | Purpose |
|----------|---------|
| `createPresenceSubscription(notificationUrl)` | Creates Graph webhook for presence changes |
| `getPresence(userId)` | Query current presence status for a user |
| `findActiveMeetingUrl(userId)` | Find the active Teams meeting URL for an in-call user |
| `processPresenceChanges(changes, onCallDetected)` | Process batch of presence changes; dispatch bots on call detection |

---

### src/lib/recording-bot/dispatcher.ts

Docker bot orchestration.

**Exports**:

| Function | Purpose |
|----------|---------|
| `dispatchRecordingBot(joinUrl, triggeredBy)` | Launch Docker recording bot; returns botRecordingId & containerId |
| `cleanupTimedOutBot(botRecordingId, containerName)` | Stop/remove timed-out bot (called after 3-hour timeout) |
| `getActiveBots()` | List all active (dispatched/joining/recording) bots |

---

### src/lib/recording-bot/transcriber.ts

Audio transcription wrapper.

**Exports**:

| Function | Purpose |
|----------|---------|
| `transcribeAudio(audioPath, meetingId)` | Transcribe bot-recorded audio using Whisper; return transcript text |

---

### src/lib/graph/meeting-processor.ts (Updated)

Enhanced meeting resolution for "Meet Now" calls.

**Changes in commit c5f36dd**:

- Added `resolveOnlineMeeting(joinWebUrl, organizerParticipant, participants)` function
- Tries organizer first, then falls back to all internal (velocityfibre.co.za, blitzfibre.com) participants
- Fixes transcript/recording recovery when organizer lookup fails
- Returns `{ userId, meetingInfo }` so transcription/recording use correct participant

**Example**:
```typescript
const { userId: resolvedUserId, meetingInfo } = await resolveOnlineMeeting(
  callRecord.joinWebUrl,
  organizerParticipant,
  participants
);

// Now fetch transcript/recording as the resolved user
if (meetingInfo?.id && resolvedUserId) {
  await fetchAndStoreTranscript(meetingId, resolvedUserId, meetingInfo.id);
  await fetchAndStoreRecording(meetingId, resolvedUserId, meetingInfo.id);
}
```

---

## 🚨 Limitations & Known Issues

### "Meet Now" Calls

- **Issue**: For direct peer calls (1:1), no join URL exists in Teams
- **Impact**: Bot cannot join peer-to-peer calls
- **Workaround**: Only group calls with a meeting URL are recordable

### Meeting URL Timing

- **Issue**: Brief window after call start where meeting may not be discoverable via Graph API
- **Impact**: Bot dispatch may occasionally miss very recently started calls
- **Workaround**: Presence subscription manages this; tolerance is ~30 seconds

### Presence Subscription Lifetime

- **Constraint**: Microsoft Graph max lifetime = 60 minutes per subscription
- **Solution**: Cron renews every 45 minutes (crontab or external scheduler)
- **If missed**: Subscriptions expire silently; re-run cron to re-create

### Docker Resource Limits

Each bot container is limited to:
- **CPU**: 1.5 cores
- **Memory**: 2 GB
- **Shared Memory**: 1 GB (for Chromium)

If hitting limits, increase `MAX_CONCURRENT_BOTS` (reduce parallelism) or increase resource allocation.

---

## 🔍 Troubleshooting

### Check Active Bots

```bash
docker ps --filter "name=ff-recorder"
```

### View Bot Logs

```bash
docker logs ff-recorder-<recording_id>
```

### Check Presence Subscription Status

```bash
curl -s https://app.fibreflow.app/api/cron/manage-presence-subscriptions \
  -X POST -H "Authorization: Bearer $CRON_SECRET" | jq
```

**Expected response**:
```json
{
  "success": true,
  "active": 1,
  "renewed": 0,
  "created": 0,
  "failed": 0,
  "cleaned": 0
}
```

### Database Queries

**Active recordings**:
```sql
SELECT id, join_url, status, dispatched_at
FROM bot_recordings
WHERE status IN ('dispatched', 'joining', 'recording')
ORDER BY dispatched_at DESC;
```

**Recording history**:
```sql
SELECT id, status, duration_sec, audio_size, completed_at
FROM bot_recordings
ORDER BY completed_at DESC
LIMIT 20;
```

**Presence monitor state**:
```sql
SELECT user_id, email, last_status, in_call_since, bot_dispatched
FROM presence_monitor
WHERE in_call_since IS NOT NULL
ORDER BY in_call_since DESC;
```

---

## 📚 Related Documentation

- **[scripts/recording-bot/README.md](../../../scripts/recording-bot/README.md)** — Full bot setup and testing guide
- **[Migration 311](../../../scripts/migrations/sql/311_recording_bot.sql)** — Database schema
- **[Commit c5f36dd](https://github.com/fibreflow/fibreflow/commit/c5f36dd)** — Implementation details

---

## 🔗 Dependencies

| System | Purpose | Version |
|--------|---------|---------|
| Microsoft Graph API | Presence detection + meeting discovery | v1.0 |
| Docker | Bot container runtime | 20.x+ |
| Chromium | Headless browser (in bot image) | Latest |
| PulseAudio | Virtual audio device | Latest |
| ffmpeg | Audio encoding | Latest |
| OpenAI Whisper | Audio transcription | Medium model |
| GPT-4o | Meeting enrichment | Latest |

---

## 📞 Support

**For issues with**:
- **Presence detection**: Check Graph API permissions (Presence.Read.All)
- **Bot recording**: Verify Docker image pulled, check container logs
- **Transcription**: Check Whisper model installed, verify audio path
- **Cron jobs**: Verify CRON_SECRET set, check scheduler (crontab or external)

---

**Last Updated**: March 13, 2026  
**Author**: Claude (Scribe)  
**Commit**: c5f36dd
