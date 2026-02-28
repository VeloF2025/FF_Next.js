# Module: wa-monitor

## Overview
| Property | Value |
|----------|-------|
| **Purpose** | Real-time WhatsApp QA photo drop monitoring with incorrect photo marking and feedback system |
| **Status** | Active |
| **Complexity** | Medium |
| **Category** | monitoring |
| **Server** | Velocity Server 100.96.203.105 |

## Infrastructure (Updated Jan 2026 - Unified Bridge)

### Architecture Overview
```
                    ┌─────────────────────────────────────────────────────┐
                    │           UNIFIED BRIDGE (VPS:8083)                 │
                    │              +27638412276                           │
                    ├─────────────────────────────────────────────────────┤
FibreFlow APIs ───► │  SEND                    │  RECEIVE                │
wa-feedback:8092    │  • /send-message         │  • DR submissions       │
                    │  • /delete-message       │  • Maintenance photos   │
                    │  • /react                │  • Admin commands       │
                    │  • /groups               │                         │
                    │  • /reload-groups        │                         │
                    └─────────────────────────────────────────────────────┘
                                          │
                    ┌─────────────────────┼─────────────────────┐
                    ▼                     ▼                     ▼
              SQLite (local)        Neon DB               Command Bot
              messages.db        wa_monitored_groups        (8086)
```

**Why Unified?** Single service handles both sending and receiving. Groups are DB-driven via `wa_monitored_groups` table, manageable from FibreFlow WA Portal UI.

### WhatsApp Services on VPS (72.61.197.178)

| Service | Port | Purpose |
|---------|------|---------|
| `whatsapp-bridge` | 8083 | **UNIFIED** - Send + Receive + Groups from DB (direct-send via whatsmeow client) |
| `wa-command-bot` | 8086 | **COMMANDS** - `!status`, `!restart` from admin groups |

> **Note:** `whatsapp-sender` (port 8081) was **permanently disabled** on 2026-02-18. ACKs are now sent directly through the bridge's own WhatsApp client — no external sender needed. This eliminates WebSocket session conflicts and the single-point-of-failure sender dependency.

```bash
ssh root@72.61.197.178

# Health check
curl http://72.61.197.178:8083/health

# List groups (from database)
curl http://72.61.197.178:8083/groups

# Reload groups from DB (no restart needed)
curl http://72.61.197.178:8083/reload-groups

# Logs
tail -f /opt/whatsapp-bridge/bridge.log

# Restart service
systemctl restart whatsapp-bridge
```

### WA Feedback Proxy (Velocity 100.96.203.105:8092)

Routes FibreFlow API calls to unified bridge:
```bash
curl http://100.96.203.105:8092/health
sudo systemctl restart wa-feedback
# Config: /etc/systemd/system/wa-feedback.service
# Code: /home/louis/wa-feedback-service/wa-feedback-service.js
```

### Monitor Service (Velocity)
```
wa-monitor-prod (Port 8090) - Python monitor for group monitoring
```

### Unified Bridge Endpoints (Port 8083)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check with connection status |
| `/send-message` | POST | Send message with @mention, returns `message_id` |
| `/delete-message` | POST | Delete a sent message (within 1 hour) |
| `/list-recent` | GET | List deletable messages from last hour |
| `/react` | POST | Send emoji reaction (👍 or ❌) |
| `/groups` | GET | List monitored groups from database |
| `/reload-groups` | GET | Reload groups from DB without restart |

### Monitored WhatsApp Groups (Database-Driven)

Groups are managed via the FibreFlow WA Portal UI (`/communications/whatsapp` → Groups tab) and stored in `wa_monitored_groups` table.

| Group Name | Type | Project | JID |
|------------|------|---------|-----|
| Lawley | dr_submission | Lawley | `120363418298130331@g.us` |
| Mohadin | dr_submission | Mohadin | `120363421532174586@g.us` |
| Mamelodi | dr_submission | Mamelodi | `120363408849234743@g.us` |
| Mamelodi Internal | dr_submission | Mamelodi | `120363425029043207@g.us` |
| Marketing Activations | dr_submission | Marketing | `120363422808656601@g.us` |
| Mohadin Maintenance | maintenance | Mohadin | `120363424360693693@g.us` |
| Lawley Maintenance | maintenance | Lawley | `120363423947610853@g.us` |
| Velo Server | admin | - | `120363423864087150@g.us` |

**Group Types (business terminology → code type):**
- `dr_submission` (**"Activations" groups**) — The ONLY groups for 1st DR submissions (new installations). Triggers `dr-acknowledgment` + `process-new-dr` flow. Receives detailed text acknowledgments.
- `maintenance` (**"Non-invoicable" groups**) — Maintenance/follow-up photos only. Does NOT trigger DR submission processing. Receives emoji reactions (👍 success, ❌ failure).
- `admin` — Commands only (for wa-command-bot: `!status`, `!restart`, etc.)

**Critical:** When debugging DR submission issues (false resubmissions, missing acks), only Activations (`dr_submission`) groups are relevant. Non-invoicable (`maintenance`) groups are a completely separate flow.

### WhatsApp Command Bot (VPS Port 8086)

Infrastructure management via WhatsApp commands from admin groups.

**Admin Groups:** Velo Server

**Commands:**
| Command | Description |
|---------|-------------|
| `!help` | Show all commands |
| `!status` | All service health |
| `!status <service>` | Specific service status |
| `!restart <service>` | Restart a service |
| `!health` | Quick health summary |
| `!pending` | Show pending approvals |
| `!approve <token>` | Approve dangerous action |

**Service Aliases:** `vlm`, `qfield`, `production`, `staging`, `dev`, `grafana`, `portainer`, `pdfcraft`, `wa-feedback`, `wa-bridge`

**How it works:**
1. Bot polls SQLite (`/opt/whatsapp-bridge/store/messages.db`) every 2 seconds
2. Detects commands starting with `!` or `/` from admin groups
3. Executes command and sends response back to WhatsApp
4. Dangerous actions require approval token

```bash
# Service management
ssh root@72.61.197.178
systemctl status wa-command-bot
systemctl restart wa-command-bot
journalctl -u wa-command-bot -f

# Health check
curl http://localhost:8086/health
```

**Code:** `/opt/wa-command-bot/main.py`

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
- **Bridge Group Tracking**: Groups must be in `main.go` PROJECTS map AND `wa_monitored_groups` DB table. SQLite chats table alone is NOT enough
- **Bridge URL Configuration**: Bridge URLs are driven by `FIBREFLOW_URL` env var (default: `app.fibreflow.app`). Set in systemd `whatsapp-bridge.service`. Previously hardcoded to staging — fixed 2026-01-31
- **Maintenance Group Routing**: `processDropNumbers()` skips maintenance groups entirely — only `forwardToMaintenanceAPI()` runs. This prevents activation ack messages in maintenance groups
- **Maintenance API Auth**: `/api/maintenance/wa-message` uses bridge secret (`fibreflow-bridge-2026`), NOT `withAuth`. Bridge has no user session
- **Command Bot Polling**: Bot polls SQLite every 2 seconds, only processes `!` or `/` prefixed messages

## Quick Commands

### Service Management
```bash
# Bridge on VPS (72.61.197.178)
ssh root@72.61.197.178
systemctl status whatsapp-bridge
tail -f /opt/whatsapp-bridge/bridge.log

# CRITICAL: Stop service BEFORE copying binary (Text file busy error if running)
systemctl stop whatsapp-bridge
# ... copy new binary ...
systemctl start whatsapp-bridge

# Bridge source on Velocity — edit main.go or sender_proxy.go, then compile:
cd /home/velo/whatsapp-bridge
go build -o whatsapp-bridge-new .

# Deploy binary (relay via local machine — servers can't SSH to each other directly)
scp /home/velo/whatsapp-bridge/whatsapp-bridge-new root@72.61.197.178:/opt/whatsapp-bridge/

# Deploy on VPS (MUST stop service first)
ssh root@72.61.197.178 "systemctl stop whatsapp-bridge && mv /opt/whatsapp-bridge/whatsapp-bridge /opt/whatsapp-bridge/whatsapp-bridge.backup && mv /opt/whatsapp-bridge/whatsapp-bridge-new /opt/whatsapp-bridge/whatsapp-bridge && chmod +x /opt/whatsapp-bridge/whatsapp-bridge && systemctl start whatsapp-bridge"
```

### Delete Sent Messages
```bash
# List recent deletable messages (use bridge port 8083)
curl http://72.61.197.178:8083/list-recent

# Delete specific message
curl -X POST http://72.61.197.178:8083/delete-message \
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

# 3. Send to correct group via bridge (use JID from Monitored Groups above)
curl -s -X POST http://72.61.197.178:8083/send-message \
  -H "Content-Type: application/json" \
  -d "{
    \"group_jid\": \"120363418298130331@g.us\",
    \"mention_jid\": \"0@s.whatsapp.net\",
    \"message\": $(echo "$MESSAGE" | jq -Rs .)
  }"
```

### Check Bridge Logs for Failed Acks
```bash
ssh root@72.61.197.178 "tail -100 /opt/whatsapp-bridge/bridge.log | grep -E '(401|FAILED|ERROR)'"
```

### Adding New Groups to Bridge

Adding a new WhatsApp group requires **TWO places**: database + compiled Go code.

**Prerequisites:**
- Bridge phone (+27 63 841 2276) must be added to the WhatsApp group
- Someone must send a message in the group to register it

**Step 1: Get the Group JID**

After the bridge phone is added and a message is sent:
```bash
# Check bridge logs for new group JID
ssh root@72.61.197.178 "tail -100 /opt/whatsapp-bridge/bridge.log" | grep "Message event"
# Look for: Chat=120363XXXXXXXXXX@g.us
```

**Step 2: Add to Database** (from FF_Next.js directory)
```bash
node -e "
const { neon } = require('@neondatabase/serverless');
const sql = neon('postgresql://neondb_owner:$NEON_DB_PASSWORD@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require');
(async () => {
  const result = await sql\`
    INSERT INTO wa_monitored_groups (group_jid, group_name, project_name, group_type, description, is_active)
    VALUES ('GROUP_JID_HERE', 'Group Name', 'Project', 'dr_submission', 'Description', true)
    RETURNING id, group_name
  \`;
  console.log('Added:', result);
})();
"
```
Group types: `dr_submission` (activations), `maintenance`, `admin`

**Step 3: Add to main.go PROJECTS map (run locally on Velocity)**
```bash
sed -i '/\"Mamelodi\": {/i\
\	\"New Group Name\": {\
\		\"group_jid\":          \"120363XXXXXXXXXX@g.us\",\
\		\"project_name\":       \"Project\",\
\		\"group_description\": \"Description\",\
\	},
' /home/velo/whatsapp-bridge/main.go
```

**Step 4: Compile and Deploy**
```bash
# Compile on Velocity (run locally)
cd /home/velo/whatsapp-bridge && go build -o whatsapp-bridge-new .

# Copy to VPS (from Velocity, direct scp to VPS)
scp /home/velo/whatsapp-bridge/whatsapp-bridge-new root@72.61.197.178:/opt/whatsapp-bridge/

# Deploy and restart on VPS
ssh root@72.61.197.178 "systemctl stop whatsapp-bridge && cp /opt/whatsapp-bridge/whatsapp-bridge /opt/whatsapp-bridge/whatsapp-bridge.backup && mv /opt/whatsapp-bridge/whatsapp-bridge-new /opt/whatsapp-bridge/whatsapp-bridge && chmod +x /opt/whatsapp-bridge/whatsapp-bridge && systemctl start whatsapp-bridge"
```

**Step 5: Reload and Verify**
```bash
curl -s http://72.61.197.178:8083/reload-groups
curl -s http://72.61.197.178:8083/groups | jq '.groups[] | {GroupName, GroupJID, GroupType}'
```

**Note:** Adding a group to SQLite `chats` table alone is NOT enough - the filtering is in the compiled Go code.

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

## Bridge Reliability Enhancements (2026-02-10)

### Three Fixes Deployed

**1. Ack Retry Logic** (`main.go` - `sendDRAcknowledgment()`)
- 3 retry attempts with exponential backoff (2s, 4s, 8s)
- Logs `[ACK RETRY X/3]` on failed attempts, `[ACK FAILED]` after exhaustion
- Fixes: Transient API errors (Cloudflare 530/520, temporary 500s)

**2. Google Sheets Removal** (`main.go`)
- Removed all 3 Sheets call sites (new DR, resubmission, receipt handler)
- Root cause of DR474666: Sheets error (no tab configured) → API 500 → no ack
- Functions still exist as dead code, just not called

**3. Direct-Send via Bridge Client** (`sender_proxy.go`)
- ACKs sent directly through the bridge's own whatsmeow WhatsApp client (2026-02-18)
- No external sender service needed — eliminates WebSocket session conflicts
- Dedup TTL = 90 seconds to prevent duplicate sends while allowing genuine resubmissions

### Bridge Log Notes
- **No date stamps** - cross-reference with `qa_photo_reviews.created_at` for date ranges
- Logs at `/opt/whatsapp-bridge/bridge.log` on VPS

### Key Bridge Files
- Source: `/home/velo/whatsapp-bridge/main.go` (Velocity)
- Direct-send: `/home/velo/whatsapp-bridge/sender_proxy.go` (Velocity) — sends ACKs via bridge's own whatsmeow client
- Binary: `/opt/whatsapp-bridge/whatsapp-bridge` (VPS)

## Troubleshooting Quick Reference

### Error Code 1033 (Neon Timeout)
When logs show `[ACK WARN] Acknowledgment API returned 530: error code: 1033`:
1. **Cause**: Transient Neon PostgreSQL timeout
2. **Fix**: Restart bridge: `ssh root@72.61.197.178 "systemctl restart whatsapp-bridge"`
3. **Manual acks**: See `.claude/knowledge-base/wa-monitor/troubleshooting-acks.md`
4. **Now auto-retries**: Bridge now retries 3 times with exponential backoff (Feb 2026)

### WebSocket EOF Errors
Since sender was disabled (2026-02-18), WebSocket EOFs should be rare. If they return constantly, check if another service is using the same WhatsApp session.

## Related Documentation
- `src/modules/wa-monitor/README.md` - Full module documentation
- `src/modules/wa-monitor/ISOLATION_GUIDE.md` - Branch and testing strategy
- `src/modules/wa-monitor/API_CONTRACT.md` - API contracts (frozen)
- `src/modules/wa-monitor/TROUBLESHOOTING.md` - Common issues
- `docs/wa-monitor/WHATSAPP_ARCHITECTURE.md` - Infrastructure details
- `.claude/agents/wa-agent.md` - WA Agent for troubleshooting
- `.claude/knowledge-base/wa-monitor/troubleshooting-acks.md` - ACK troubleshooting (error 1033, manual acks)
- `src/modules/communications/whatsapp/` - WhatsApp Portal admin UI
