# Meetings Module Changelog

All notable changes to the Meetings module will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Documentation
- Initial comprehensive module documentation created (March 13, 2026)
- Added README.md with full endpoint descriptions, architecture, and troubleshooting
- Added CHANGELOG.md tracking historical changes

---

## [2.1.0] - 2026-03-13

### Added - Presence-Based Automatic Recording & Multi-Participant Meeting Resolution

#### New Endpoints
- **POST /api/cron/manage-presence-subscriptions** — Manages Microsoft Graph presence webhook subscriptions
  - Creates new subscription if none exists
  - Renews subscriptions expiring in the next 15 minutes
  - Cleans up expired subscriptions
  - Schedule: Every 45 minutes (Graph API max subscription lifetime = 60 min)
  - Auth: CRON_SECRET bearer token
  
- **POST /api/meetings/presence-webhook** — Inbound webhook from Microsoft Graph API
  - Receives presence change notifications for all monitored users
  - Detects when users enter Teams calls (`InACall`, `InAConferenceCall`)
  - Attempts to find meeting URL via `findActiveMeetingUrl()`
  - Dispatches Docker recording bot on call detection
  - Response: 202 Accepted (processing async to satisfy Graph <3s requirement)
  - Auth: Graph validates via clientState (GRAPH_WEBHOOK_SECRET)

- **POST /api/recording-bot/callback** — Callback from Docker recording bot
  - Receives recording metadata upon completion (audio path, duration, size, error)
  - Updates `bot_recordings` table with final status
  - Triggers Whisper transcription pipeline
  - Runs GPT-4o LLM enrichment (summary, action items, topics)
  - Creates meeting record if not already linked
  - Response: 202 Accepted (processing async)
  - Auth: CRON_SECRET bearer token
  
#### New Library Modules

- **src/lib/graph/presence.ts** — Presence monitoring and webhook integration
  - `createPresenceSubscription(notificationUrl)` — Create Graph webhook subscription for all internal users
  - `getPresence(userId)` — Query current presence status for a user
  - `findActiveMeetingUrl(userId)` — Find active Teams meeting URL for in-call user (queries last 5 minutes of onlineMeetings)
  - `processPresenceChanges(changes, onCallDetected)` — Process batch of presence changes; dispatch bot callback on call detection
  - Handles call detection, meeting URL discovery, and bot dispatch orchestration
  - Deduplicates bot dispatch via `presence_monitor` table (ensures 1 bot per call)
  
- **src/lib/recording-bot/dispatcher.ts** — Docker bot orchestration
  - `dispatchRecordingBot(joinUrl, triggeredBy)` — Launch Docker recording bot container
    - Enforces MAX_CONCURRENT_BOTS limit (default: 5)
    - Creates bot_recordings table row
    - Launches `ghcr.io/screenappai/meeting-bot:latest` Docker image with environment
    - Returns botRecordingId and containerId
    - Schedules automatic cleanup on 3-hour timeout
  - `cleanupTimedOutBot(botRecordingId, containerName)` — Stop/remove timed-out bot after 3 hours
  - `getActiveBots()` — List all active (dispatched/joining/recording) bot recordings
  
- **src/lib/recording-bot/transcriber.ts** — Audio transcription wrapper
  - `transcribeAudio(audioPath, meetingId)` — Transcribe bot-recorded audio using existing Whisper pipeline
    - Delegates to existing `transcribeWithWhisper()` 
    - Handles audio extraction, chunking, English translation
    - Returns full English transcript or null on failure
    
#### Database Migrations

- **Migration 311** (scripts/migrations/sql/311_recording_bot.sql) — Recording bot infrastructure (renamed from 242_ to resolve a duplicate-prefix collision)
  - `bot_recordings` table — Tracks all bot dispatch and execution
    - Columns: id, meeting_id, join_url, container_id, status (7 states), triggered_by, audio_path, audio_size, duration_sec, error, timestamps
    - Status lifecycle: dispatched → joining → recording → uploading → completed | failed | timeout
    - Indexes: status, join_url
  - `presence_monitor` table — Tracks real-time presence state per user
    - Columns: user_id (PK), display_name, email, last_status, in_call_since, bot_dispatched, updated_at
    - Purpose: Prevents duplicate bot dispatch for same call
    
#### Setup & Configuration Files

- **scripts/recording-bot/README.md** — Complete setup and operation guide
  - Detailed architecture diagram
  - Prerequisites (Azure AD permissions, Docker, Whisper)
  - Environment variable configuration
  - Cron job setup
  - Step-by-step operation flow
  - Limitations and troubleshooting
  
- **scripts/recording-bot/docker-compose.yml** — Docker Compose template for testing
  - Test profile for manual bot execution
  - Environment configuration for meeting-bot image
  - Volume mounts for bot-recordings directory
  - Resource limits and shared memory configuration

#### Enhanced Meeting Resolution

- **src/lib/graph/meeting-processor.ts** — Updated `processMeetingFromCallRecord()`
  - New `resolveOnlineMeeting(joinWebUrl, organizerParticipant, participants)` function
  - Fixes "Meet Now" call transcript recovery by trying all internal tenant participants
  - Tries organizer participant first (existing behavior)
  - Falls back to all other internal domain participants (velocityfibre.co.za, blitzfibre.com)
  - Returns { userId, meetingInfo } so transcript/recording use correct participant
  - Logs when meeting resolved via non-organizer (indicates "Meet Now" call)
  - Impact: Recovers transcripts/recordings for "Meet Now" calls where organizer lookup fails

### Changed
- Meetings module now uses Graph API presence webhooks for automatic call detection (replaces or supplements timer-based polling)

### Technical Details

**Presence Subscription Flow**:
1. Cron calls `/api/cron/manage-presence-subscriptions` every 45 minutes
2. Endpoint checks for active presence subscriptions
3. If none: creates new subscription via `createPresenceSubscription()`
4. If expiring soon: renews via Graph API PATCH /subscriptions/{id}
5. Graph API sends notifications to `/api/meetings/presence-webhook` when users' presence changes
6. Webhook processes asynchronously to meet Graph <3s response requirement

**Recording Bot Flow**:
1. Presence webhook detects user in call
2. Queries user's recent onlineMeetings to find active meeting URL
3. Calls `dispatchRecordingBot(joinUrl, userId)` to launch Docker container
4. Bot joins Teams meeting, records audio via ffmpeg + PulseAudio
5. On meeting end (or timeout), bot uploads recording metadata to `/api/recording-bot/callback`
6. Callback endpoint:
   - Updates bot_recordings status
   - Creates meeting row if needed
   - Calls `transcribeAudio()` → Whisper transcription
   - Updates meetings.raw_transcript
   - Runs existing `processWithLLM()` pipeline
   - Updates bot_recordings.status = 'completed'

**Database State**:
- `bot_recordings`: One row per bot dispatch, tracks execution from dispatch → completion
- `presence_monitor`: One row per monitored user, tracks in-call state and bot dispatch flag to prevent duplication
- `graph_subscriptions`: Tracks active Graph API subscriptions (created/renewed by cron)

### Performance Impact
- **Minimal**: Presence detection is event-driven (not polling)
- **Docker overhead**: ~500MB per recording bot (Chromium + Xvfb + PulseAudio)
- **Concurrency**: Limited to 5 concurrent bots by default (configurable via MAX_CONCURRENT_BOTS)
- **Cron overhead**: Presence subscription renewal runs every 45 minutes (~100ms per run)

### Commits Included
- `c5f36dd` — feat(meetings): multi-participant resolution + presence-triggered recording bot
  - Multi-participant `resolveOnlineMeeting()` for "Meet Now" call recovery
  - Presence webhook → meeting URL discovery → bot dispatch flow
  - Database schema for bot_recordings and presence_monitor
  - Complete recording pipeline: join → record → transcribe → enrich

### Security & Permissions

**Azure AD Application Permissions** (added in this version):
- `Presence.Read.All` — Read all users' presence status (required for webhook)
- `OnlineMeetings.Read.All` — Read online meetings (required for URL discovery)

**API Authentication**:
- `/api/cron/manage-presence-subscriptions`: CRON_SECRET bearer token
- `/api/meetings/presence-webhook`: Graph validates clientState (GRAPH_WEBHOOK_SECRET)
- `/api/recording-bot/callback`: CRON_SECRET bearer token

**Deduplication & Safety**:
- `presence_monitor.bot_dispatched` flag prevents duplicate bot dispatch for same call
- Duplicate meeting URLs checked before dispatch (avoids multiple bots on same meeting)
- Max concurrent bot limit (5) prevents resource exhaustion

---

## [2.0.0] - 2026-02-28

### Added
- **enable-auto-recording.ts**: Cron job to enable recording for upcoming Teams meetings
- **poll-teams.ts**: Microsoft Graph API integration for Teams meeting polling
- **renew-graph-subscriptions.ts**: Automatic renewal of Microsoft Graph change notification subscriptions
- Meetings transcript and recording retrieval via Graph API
- LLM enrichment pipeline (summary, action items, topic extraction)

### Changed
- Upgraded meetings module to use Microsoft Graph API directly (replaces Teams Admin Center integration)
- Added graph_subscriptions table for subscription management

### Commits
- `32d10a10` — feat(meetings): auto-recording cron for upcoming Teams meetings
- `e60e6fcc` — feat(meetings): Teams Meeting integration via Microsoft Graph API

---

**Last Updated**: March 13, 2026  
**Maintained By**: Scribe (Claude)
