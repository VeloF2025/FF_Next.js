# Module: livekit

## Overview
| Property | Value |
|----------|-------|
| **Purpose** | Video conferencing infrastructure using LiveKit for virtual meetings with recording capabilities |
| **Status** | Active |
| **Complexity** | High |
| **Category** | communication |

## Dependencies

### Internal FF Modules
None

### External Packages
- livekit-server-sdk (AccessToken, RoomServiceClient, EgressClient)
- livekit-client (video track types)
- @livekit/components-react (LiveKitRoom, VideoConference, ControlBar)
- @livekit/components-styles
- lucide-react

## Database

### Tables
- `meetings` - Stores meeting metadata (id, roomName, title, scheduledAt, startedAt, endedAt, recordingPath, createdBy, createdAt)

### Key Queries
- INSERT/UPDATE meetings table when room created or recording starts

## API Endpoints
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/livekit/config` | Get LiveKit configuration |
| POST | `/api/livekit/token` | Generate JWT access token |
| POST | `/api/livekit/rooms` | Create new video room |
| GET | `/api/livekit/rooms` | List active rooms |
| POST | `/api/livekit/schedule` | Schedule a meeting |
| POST | `/api/livekit/recording` | Start room recording |
| GET | `/api/livekit/recording/[egressId]` | Get recording status |
| POST | `/api/livekit/webhooks` | LiveKit event webhooks |

## Services

### livekitService
```typescript
generateRoomName()  // ff-[timestamp]-[random]
generateToken(request)  // 6-hour TTL, publish/subscribe/data
createRoom(request)  // name, title, max participants, empty timeout
listRooms()  // active rooms with participant counts
deleteRoom(roomName)
startRecording(roomName)  // MP4 to EGRESS_OUTPUT_PATH
stopRecording(egressId)
getLiveKitUrl()
```

## Components
- `MeetingRoom` - Full video conference UI
- `ScheduleMeetingModal` - Meeting scheduler
- `PreJoin` - Pre-meeting setup

## Hooks
None module-specific

## Patterns
- Lazy-initialized service clients
- JWT token generation with room and participant grants
- Metadata passed as JSON string
- Recording to filesystem with timestamp filenames
- HTTP URL conversion from WebSocket URL

## Environment Variables (Required)
- `LIVEKIT_URL` - WebSocket URL
- `LIVEKIT_API_KEY` - API key
- `LIVEKIT_API_SECRET` - API secret
- `EGRESS_OUTPUT_PATH` - Recording output path (/opt/recordings)

## Gotchas
- **Required Env Vars**: LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET are required
- **Recording Service**: Recording requires Egress service deployment on VPS
- **Fixed TTL**: Token TTL hardcoded to 6 hours
- **Max Participants**: Default 50 (configurable)
- **Empty Timeout**: Default 300 seconds (5 min) auto-delete
- **URL Conversion**: WebSocket URL must convert to HTTP for API calls
- **Async Recording**: Returns egressId for tracking; must call stopRecording separately
- **Error Objects**: Service returns {success: false} objects, not exceptions
