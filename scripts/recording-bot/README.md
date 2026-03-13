# Teams Recording Bot Setup

Automatic Teams meeting recording via presence detection + headless browser bot.

## Architecture

```
[Graph Presence Webhook] → detects user enters call
        ↓
[Presence Handler] → queries user's online meetings → finds join URL
        ↓
[Bot Dispatcher] → launches Docker container (screenappai/meeting-bot)
        ↓
[Docker: Chromium + Xvfb + PulseAudio + ffmpeg] → joins meeting, records audio
        ↓
[Callback API] → receives recording metadata
        ↓
[Whisper Transcriber] → faster-whisper on CPU → VTT transcript
        ↓
[Existing LLM Pipeline] → GPT-4o summary, action items, topics
```

## Prerequisites

### 1. Azure AD Permissions

Add these application permissions to the Azure AD app registration:

```
Presence.Read.All          — Read all users' presence (for call detection)
OnlineMeetings.Read.All    — Read online meetings (for meeting URL discovery)
```

Then grant admin consent in Azure Portal → App registrations → API permissions.

### 2. Docker

```bash
# Pull the recording bot image
docker pull ghcr.io/screenappai/meeting-bot:latest

# Create recordings directory
sudo -u velo mkdir -p /home/velo/bot-recordings
```

### 3. Whisper (Python)

```bash
pip install faster-whisper
```

### 4. Environment Variables

Add to `.env.local`:

```bash
# Recording bot
RECORDING_BOT_IMAGE=ghcr.io/screenappai/meeting-bot:latest
BOT_RECORDINGS_PATH=/home/velo/bot-recordings
RECORDING_BOT_CALLBACK_URL=https://app.fibreflow.app/api/recording-bot/callback
RECORDING_BOT_NAME=VF Recorder

# Whisper
WHISPER_MODEL=medium
WHISPER_SCRIPT_PATH=/home/hein/Workspace/FF_Next.js/scripts/recording-bot/transcribe.py
```

### 5. Database Migration

```bash
npx tsx scripts/run-migration.ts 242
```

### 6. Cron Jobs

Add to crontab (presence subscriptions expire every 60 min):

```bash
# Renew presence subscriptions every 45 minutes
*/45 * * * * curl -s -X POST https://app.fibreflow.app/api/cron/manage-presence-subscriptions -H "Authorization: Bearer $CRON_SECRET"
```

## How It Works

1. **Presence Detection**: Graph webhook notifies when any internal user's presence changes to `InAConferenceCall`
2. **Meeting Discovery**: Queries the user's recent online meetings to find the active meeting URL
3. **Bot Dispatch**: Launches a Docker container that opens Chromium, navigates to Teams web, joins the meeting
4. **Recording**: ffmpeg captures PulseAudio audio output from the virtual sound device
5. **Callback**: When the meeting ends, the bot POSTs recording metadata to our callback endpoint
6. **Transcription**: faster-whisper transcribes the audio to VTT format
7. **Enrichment**: Existing GPT-4o pipeline generates summary, action items, and topics

## Limitations

- **1:1 peer calls**: No join URL exists for direct 1:1 calls — bot cannot join these
- **Meeting URL timing**: For "Meet Now" calls, there's a brief window where the meeting may not yet be discoverable via Graph API
- **Presence subscription lifetime**: Max 60 minutes — cron must renew frequently
- **Max concurrent bots**: 5 (configurable in dispatcher.ts)

## Troubleshooting

```bash
# Check active bots
docker ps --filter "name=ff-recorder"

# Check bot logs
docker logs ff-recorder-<id>

# Check presence subscription status
curl -s https://app.fibreflow.app/api/cron/manage-presence-subscriptions \
  -X POST -H "Authorization: Bearer $CRON_SECRET" | jq

# Manual test
docker compose -f scripts/recording-bot/docker-compose.yml \
  --profile test run --rm recording-bot-test
```
