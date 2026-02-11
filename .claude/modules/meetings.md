# Module: meetings

## Overview
| Property | Value |
|----------|-------|
| **Purpose** | Meeting management system integrating Fireflies.ai transcripts with auto-sync, manual sync, and detailed meeting views |
| **Status** | Active |
| **Complexity** | Medium |
| **Category** | communication |

## Dependencies

### Internal FF Modules
- `livekit` (ScheduleMeetingModal component)

### External Packages
- react
- next
- next/router
- lucide-react
- @neondatabase/serverless
- react-hook-form
- fireflies.ai (GraphQL API)

## Database

### Tables
- `meetings` - Synced meeting data (id, fireflies_id, title, meeting_date, duration, transcript_url, summary JSONB, participants JSONB, created_at, updated_at)

### Key Queries
- GET meetings from Neon database
- UPSERT on fireflies_id for sync
- Summary column: keywords, action_items, outline (JSONB)
- Participants: array of {name, email, displayName}

## API Endpoints
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/meetings` | Fetch meetings from Neon |
| POST | `/api/meetings?action=sync` | Manual Fireflies sync |
| POST | `/api/meetings-sync-cron` | Automated cron (bearer token) |

## Services

### firefliesService
```typescript
fetchFirefliesTranscripts()  // GraphQL API call
syncFirefliesToNeon()  // Fetch and UPSERT
```

## Components
- `MeetingsDashboard` - Main dashboard
- `MeetingsList` - Scrollable list
- `MeetingDetailModal` - Full details
- `MeetingCard` - Card view
- `MeetingStatsCards` - Summary stats
- `MeetingsSidebar` - Upcoming meetings
- `MeetingForm` - Create/edit form
- Form subsections: BasicMeetingFields, ParticipantsSection, AgendaItemsSection, MeetingLocationFields, MeetingNotesField, MeetingFormActions
- `MeetingFormHeader` - Form title

## Hooks
- `useMeetingForm(meeting, onSave, onClose)` - Form state with react-hook-form

## Patterns
- Fireflies GraphQL API integration with periodic sync
- Cron-protected endpoint using CRON_SECRET bearer token
- UPSERT pattern (ON CONFLICT fireflies_id DO UPDATE)
- JSONB storage for nested data
- Scheduled sync at 11am & 5pm SAST (9am & 3pm UTC)
- Manual sync button in dashboard

## Environment Variables
- `FIREFLIES_API_KEY` - Fireflies API key (required)
- `CRON_SECRET` - Cron endpoint protection (required)
- `DATABASE_URL` - Neon connection string

## Gotchas
- **API Key Location**: FIREFLIES_API_KEY must be in .env.local AND .env.production
- **Missing Key Error**: "FIREFLIES_API_KEY not configured" if missing
- **Cron Auth**: CRON_SECRET mismatch causes 401 Unauthorized
- **Timezone**: VPS cron runs at 9am & 3pm UTC = 11am & 5pm SAST
- **Two Sync Methods**: Manual (POST /api/meetings?action=sync) and automatic (cron)
- **Rate Limits**: Fireflies GraphQL API has rate limits per plan
- **Summary Fields**: keywords, action_items, outline in summary JSONB
- **Participants Array**: Array of {name, email, displayName} objects
- **Auto Timestamps**: created_at/updated_at managed by database (NOW())
- **Data Transform**: Manual mapping of db fields to Meeting interface in dashboard
- **Fireflies meeting_attendees EMPTY**: Most meetings return empty meeting_attendees — speakers field (voice recognition) is the real participant source
- **Two Data Pipelines**: MeetingsDashboard.tsx serves /meetings, useCommunications.ts serves /communications?tab=meetings — changes must be applied to BOTH
- **Name-Based Matching**: Non-admin users are matched by email OR name OR displayName — email-only matching misses all speaker-sourced participants
- **UPSERT Must Update All Fields**: ON CONFLICT clause must include participants, duration, transcript_url — not just title/summary
- **Dark Theme**: Modal uses var(--ff-bg-tertiary), blue-400/blue-500 for action items — NOT amber/yellow

## Learnings (Feb 2026)

### Fireflies Speakers Data Integration (2026-02-10)
**Problem**: Meetings showed 0 attendees because `meeting_attendees` returns empty arrays.
**Root Cause**: Fireflies voice recognition populates `speakers` field, not `meeting_attendees`.
**Fix**: Created `mergeParticipants()` in firefliesService.ts that combines all 3 sources (speakers, meeting_attendees, participants) with deduplication.

### Non-Admin Participant Matching (2026-02-10)
**Problem**: Jacques Langenhoven (PROJECT MANAGER) couldn't see today's meetings despite being a participant.
**Root Cause**: API filtered by `LOWER(p->>'email') = userEmail` only, but speaker-sourced participants have names, no emails.
**Fix**: Added `OR LOWER(p->>'name') = userName OR LOWER(p->>'displayName') = userName` to both list and single-meeting queries.

### Communications Portal Data Pipeline (2026-02-10)
**Problem**: Fixed attendees on /meetings but /communications?tab=meetings still showed 0.
**Root Cause**: useCommunications.ts hook has its own data transformation, separate from MeetingsDashboard.
**Fix**: Added rawParticipants mapping and getAttendeeDisplayName() helper to useCommunications.ts.

### Dark Theme Alignment (2026-02-10)
**Problem**: Modal action items used amber/yellow styling that clashed with dark theme.
**Fix**: Changed to bg-[var(--ff-bg-tertiary)], border-blue-500, text-blue-400 for person names, text-blue-400 hover:text-blue-300 for links.
