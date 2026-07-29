<!-- GENERATED — do not edit. Canonical source: ./.claude.md -->
<!-- Regenerate: node scripts/mirror-agents-md.mjs -->
<!-- You are reading the AGENTS.md view of the Claude-facing docs. Prose
     below may refer to ".claude.md" when describing the canonical side;
     that is accurate — only PATH references are rewritten to AGENTS.md. -->
# Module: meetings
<!-- Meeting management via Fireflies.ai + Microsoft Teams auto-sync -->

## Purpose
Syncs meeting transcripts, summaries, and action items from Fireflies.ai and Microsoft Teams; displays them in a standalone dashboard and the Communications Hub.

## Key Files
| File | Purpose |
|------|---------|
| `MeetingsDashboard.tsx` | Standalone `/meetings` dashboard with source filter + pagination |
| `components/MeetingDetailModal.tsx` | Meeting details modal (transcript, action items, summary) |
| `components/MeetingsList.tsx` | Card list with source badge (fireflies / teams / livekit) |
| `types/meeting.types.ts` | `Meeting`, `MeetingAttendee`, `MeetingSource`, `ProcessingStatus` |
| `@/services/fireflies/firefliesService.ts` | Fireflies GraphQL sync + `mergeParticipants()` |
| `@/hooks/useCommunications.ts` | Communications Hub meetings pipeline (separate from dashboard) |

## API Endpoints
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/meetings` | List meetings, paginated (50/page), filter by source |
| POST | `/api/meetings?action=sync` | Manual Fireflies sync (triggers background job) |
| POST | `/api/meetings/sync-teams` | Manual Teams backfill (admin only, hours param) |
| POST | `/api/meetings-sync-cron` | Automated cron (11am + 5pm SAST, requires `CRON_SECRET`) |
| GET | `/api/meetings/[id]/transcript` | Fetch transcript for a meeting |
| GET | `/api/meetings/[id]/recording` | Fetch recording URL |
| POST | `/api/meetings/[id]/notes` | Save user notes on a meeting |
| POST | `/api/meetings/[id]/resync` | Force re-fetch of single meeting from Fireflies |
| POST | `/api/meetings/distribute-minutes` | Email/WA distribution of meeting minutes |
| POST | `/api/meetings/process/[id]` | Reprocess AI summary for meeting |

## Database Tables
- `meetings` — core meeting rows, JSONB `summary`, `participants`
- `meeting_transcripts` — full transcript text per meeting
- `action_items` — extracted action items linked to `meeting_id`
- `teams_call_record_id` column on `meetings` — Teams dedup key

## Critical Rules
- Fireflies `meeting_attendees` is often empty — use `speakers` as primary participant source; `mergeParticipants()` merges both
- Two parallel pipelines: `MeetingsDashboard.tsx` and `useCommunications.ts` — changes to data shape must be reflected in both
- Teams sync via Microsoft Graph — cross-meeting recording theft bug fixed PR #1572; `scrapeOneDrive` cron still returns 0 (known)
- UPSERT must update ALL fields on conflict, not just title/summary
- `FIREFLIES_API_KEY` must be set in deploy `.env` — missing key is the #1 sync failure cause

## Common Issues
| Issue | Fix |
|-------|-----|
| Sync fails with "FIREFLIES_API_KEY not configured" | Add key to `/home/velo/fibreflow-*/` `.env` files |
| Teams recordings not attributed correctly | Check `teams_call_record_id` dedup; PR #1572 fixed cross-meeting theft |
| Participants show as empty | `mergeParticipants()` falls back to speakers; check Fireflies `speakers` array |
| `useCommunications` shows stale meetings | Separate cache — force refresh via Communications Hub sync button |

<!-- Auto-updated by /kb. Last: 2026-05-12 -->
