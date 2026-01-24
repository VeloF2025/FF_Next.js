# Module: wa-monitor

## Overview
| Property | Value |
|----------|-------|
| **Purpose** | Real-time WhatsApp QA photo drop monitoring with incorrect photo marking and feedback system |
| **Status** | Active |
| **Complexity** | Medium |
| **Category** | monitoring |
| **Server** | Velocity Server 100.96.203.105 |

## Infrastructure (Updated Jan 2026 - VPS Migration)

### Architecture Overview
```
FibreFlow APIs → wa-feedback (Velocity:8092) → VPS sender (8081) → WhatsApp
                                                                      ↓
                              Neon DB ← VPS bridge (8083) ← WhatsApp incoming
```

**Why VPS?** WhatsApp services run on Hostinger VPS for redundancy. If Velocity goes down, DR submissions still get captured.

### WhatsApp Services on VPS (72.61.197.178)

| Service | Port | Purpose |
|---------|------|---------|
| `whatsapp-sender` | 8081 | **SENDING** - REST API `/send-message` |
| `whatsapp-bridge` | 8083 | **RECEIVING** - Incoming messages → DB |

```bash
ssh root@72.61.197.178

# Health checks
curl http://72.61.197.178:8081/health  # Sender
curl http://72.61.197.178:8083/health  # Bridge

# Logs
tail -f /opt/whatsapp-sender/sender.log
tail -f /opt/whatsapp-bridge/bridge.log

# Restart services
systemctl restart whatsapp-sender whatsapp-bridge
```

### WA Feedback Proxy (Velocity 100.96.203.105:8092)

Routes FibreFlow API calls to VPS sender:
```bash
curl http://100.96.203.105:8092/health
echo 'velo2026' | sudo -S systemctl restart wa-feedback
# Config: /etc/systemd/system/wa-feedback.service
# Code: /home/louis/wa-feedback-service/wa-feedback-service.js
```

### Monitor Service (Velocity)
```
wa-monitor-prod (Port 8090) - Python monitor for group monitoring
```

### Sender Service Endpoints (Port 8081)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check with connection status |
| `/send-message` | POST | Send message with @mention, returns `message_id` |
| `/delete-message` | POST | Delete a sent message (within 1 hour) |
| `/list-recent` | GET | List deletable messages from last hour |

### Monitored WhatsApp Groups

| Project | Group JID |
|---------|-----------|
| Lawley | `120363418298130331@g.us` |
| Mohadin | `120363421532174586@g.us` |
| Velo Test | `120363421664266245@g.us` |
| Mamelodi | `120363408849234743@g.us` |

## Dependencies

### Internal FF Modules
**NONE** - Fully isolated module (no @/lib/* or @/services/* imports)

### External Packages
- @neondatabase/serverless
- lucide-react
- axios

## Database

### Tables
- `qa_photo_reviews` - Main drop records with 12 QA step booleans

### Key Queries
- getAllDrops() with filters
- getDropById(id)
- getDropsByStatus()
- calculateSummary() - Dashboard stats
- getDailyDropsPerProject()
- getProjectStats()

## API Endpoints
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/wa-monitor-drops` | List all drops with summary |
| PATCH | `/api/wa-monitor-drops/[id]` | Update drop review |
| GET | `/api/wa-monitor-daily-drops` | Daily drops per project |
| GET | `/api/wa-monitor-projects-summary` | Project statistics |
| POST | `/api/wa-monitor-send-feedback` | Send WhatsApp feedback |
| GET | `/api/wa-monitor-health` | Health check |
| GET | `/api/wa-monitor-dr-validation` | Validate DR format |

## Services

### waMonitorService
```typescript
getAllDrops()
getDropById(id)
getDropsByStatus(status)
updateDrop(id, data)
calculateSummary()
getDailyDropsPerProject(date)
getProjectStats(projectName)
```

### waMonitorApiService
Frontend API client for dashboard

## Components
- `WaMonitorDashboard` - Main dashboard container
- `WaMonitorGrid` - Sortable drop grid display
- `QaReviewCard` - Individual drop review with incorrect marking
- `WaMonitorFilters` - Filter controls
- `DropStatusBadge` - Status indicator badge
- `SystemHealthPanel` - VPS agent health

## Hooks
- `useWaMonitorStats()` - Dashboard statistics and refresh

## QA Steps (12 total)
Steps are stored as `step_01` through `step_12` boolean columns in database.

**CRITICAL**: Use `ORDERED_STEP_KEYS` constant for correct display order - database column order differs from display order!

## Patterns
- Fully isolated module (no @/lib/* or @/services/* imports)
- Frozen API contracts (see API_CONTRACT.md)
- Edit locking system (prevents concurrent editing)
- Three-state logic for QA photos (correct/incorrect/missing)
- Incorrect photos tracked via `incorrectSteps` array and `incorrectComments` JSONB

## Gotchas
- **COLUMN ORDER**: 12 database columns (step_01...step_12) are NOT in display order - must use ORDERED_STEP_KEYS
- **Text Input**: Incorrect photo marking uses text input approach
- **VPS Writes Basic**: VPS Python monitor writes only basic step booleans
- **Frontend Enriches**: Frontend users populate incorrectSteps and incorrectComments
- **Auto Feedback**: Feedback generation auto-creates message from missing/incorrect items
- **Edit Locking**: Drop locking prevents multiple users editing same record
- **Microservice Ready**: Module intentionally isolated for future extraction
- **Unified Phone Number**: All messages (acks + feedback) come from 082 418 9511
- **Message Deletion**: Messages can be deleted within 1 hour via `/delete-message`
- **Ack Filter**: Bridge skips messages containing "Received!" to prevent infinite loop

## Quick Commands

### SSH Access
```bash
ssh velo@100.96.203.105  # Password: velo2026
```

### Service Management
```bash
# Check services
echo 'velo2026' | sudo -S systemctl status whatsapp-sender.service whatsapp-bridge.service

# Restart services
echo 'velo2026' | sudo -S systemctl restart whatsapp-sender.service whatsapp-bridge.service

# View logs
tail -f /home/louis/whatsapp-sender/sender.log
tail -f /home/louis/whatsapp-bridge-go/bridge.log
```

### Delete Sent Messages
```bash
# List recent deletable messages
curl http://localhost:8081/list-recent

# Delete specific message
curl -X POST http://localhost:8081/delete-message \
  -H "Content-Type: application/json" \
  -d '{"message_id":"3EB0xxx","group_jid":"120363408849234743@g.us"}'
```

### Manual DR Acknowledgment (when bridge fails)
If the bridge failed to send an acknowledgment (e.g., 401 auth errors):
```bash
# 1. Get the ack message from FibreFlow API
ACK_DATA=$(curl -s -X POST "https://app.fibreflow.app/api/activate/dr-acknowledgment" \
  -H "Content-Type: application/json" \
  -d '{"dropNumber": "DR1234567"}')

# 2. Extract and review message
MESSAGE=$(echo "$ACK_DATA" | jq -r '.data.message')
echo "$MESSAGE"

# 3. Send to correct group (use JID from Monitored Groups above)
curl -s -X POST http://72.61.197.178:8081/send-message \
  -H "Content-Type: application/json" \
  -d "{
    \"group_jid\": \"120363418298130331@g.us\",
    \"recipient_jid\": \"0@s.whatsapp.net\",
    \"message\": $(echo "$MESSAGE" | jq -Rs .)
  }"
```

### Check Bridge Logs for Failed Acks
```bash
ssh root@72.61.197.178 "tail -100 /opt/whatsapp-bridge/bridge.log | grep -E '(401|FAILED|ERROR)'"
```

## WhatsApp Portal (Admin UI)

### Overview
Web-based admin interface at `/communications/whatsapp` for managing WhatsApp services.

**Status:** Production - Dark theme compliant (Jan 2026)

### Tabs
| Tab | Purpose |
|-----|---------|
| **Services** | View service status, restart services, manage phone pairing |
| **Groups** | Manage monitored WhatsApp groups |
| **Templates** | Message templates for feedback |
| **Logs** | View message logs |
| **Settings** | Configuration settings |

### API Endpoints (waAdminApi)

**Services API:**
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/communications/whatsapp/services/status` | GET | Get all service statuses |
| `/api/communications/whatsapp/services/[service]/restart` | POST | Restart a service |
| `/api/communications/whatsapp/services/[service]/pair` | POST | Initiate pairing |
| `/api/communications/whatsapp/services/[service]/pairing-status` | GET | Check pairing status |
| `/api/communications/whatsapp/services/[service]/logout` | POST | Logout and clear session |

**Phones API:**
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/communications/whatsapp/phones` | GET | List registered phone numbers |
| `/api/communications/whatsapp/phones` | POST | Register new phone |
| `/api/communications/whatsapp/phones/[id]` | GET/PUT/DELETE | Manage phone |

### Frontend Service (waAdminApiService.ts)
```typescript
import { waAdminApi } from '@/modules/communications/whatsapp/services/waAdminApiService';

// Services
waAdminApi.services.status()
waAdminApi.services.restart('bridge' | 'sender')
waAdminApi.services.pair('bridge' | 'sender', phoneNumber?)
waAdminApi.services.pairingStatus('bridge' | 'sender')
waAdminApi.services.logout('bridge' | 'sender')

// Phones
waAdminApi.phones.list(service?)
waAdminApi.phones.get(id)
waAdminApi.phones.create(input)
waAdminApi.phones.update(id, input)
waAdminApi.phones.delete(id)
waAdminApi.phones.setPrimary(id)
```

### Dark Theme Styling (Jan 2026)
All components use semi-transparent dark-compatible colors:
- Status badges: `bg-green-500/20 text-green-400 border-green-500/30`
- Error boxes: `bg-red-500/10 border border-red-500/30 text-red-400`
- Phone badges: CSS variables (`--ff-bg-tertiary`, `--ff-text-secondary`)

## Related Documentation
- `src/modules/wa-monitor/README.md` - Full module documentation
- `src/modules/wa-monitor/ISOLATION_GUIDE.md` - Branch and testing strategy
- `src/modules/wa-monitor/API_CONTRACT.md` - API contracts (frozen)
- `src/modules/wa-monitor/TROUBLESHOOTING.md` - Common issues
- `docs/wa-monitor/WHATSAPP_ARCHITECTURE.md` - Infrastructure details
- `.claude/agents/wa-agent.md` - WA Agent for troubleshooting
- `src/modules/communications/whatsapp/` - WhatsApp Portal admin UI
