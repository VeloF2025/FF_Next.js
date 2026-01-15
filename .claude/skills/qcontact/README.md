# QContact Integration Skill

Complete technical reference for FiberTime QContact ticketing integration.

## Quick Reference

| Item | Value |
|------|-------|
| **URL** | https://fibertime.qcontact.com |
| **Username** | velocity@fibertimemaintenance.com |
| **Password** | Changeme2025 |
| **Velocity User ID** | 21924332416 |
| **API Base** | https://fibertime.qcontact.com/api/v2 |

---

## Authentication

### Method 1: API Authentication (Preferred)

```bash
curl -s -D - -X POST "https://fibertime.qcontact.com/api/v2/auth/sign_in" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -d '{"email":"velocity@fibertimemaintenance.com","password":"Changeme2025"}'
```

**Response Headers** (extract these):
```
access-token: C3U99bjlC9RDkq2PlDrhvw
client: d-6QP88LupbdbPyzKyAVtA
uid: velocity@fibertimemaintenance.com
```

### Method 2: Browser Automation

```javascript
// Login via browser
mcp__boss-ghost-mcp__new_page({ url: "https://fibertime.qcontact.com" })
mcp__boss-ghost-mcp__fill_form({ elements: [
  { uid: "email-field", value: "velocity@fibertimemaintenance.com" },
  { uid: "password-field", value: "Changeme2025" }
]})
mcp__boss-ghost-mcp__click({ uid: "sign-in-button" })
```

### Environment Variables

```bash
# .env.local
FIBERTIME_QCONTACT_BASE_URL=https://fibertime.qcontact.com
FIBERTIME_QCONTACT_UID=velocity@fibertimemaintenance.com
FIBERTIME_QCONTACT_ACCESS_TOKEN=<access-token>
FIBERTIME_QCONTACT_CLIENT=<client>
FIBERTIME_QCONTACT_PASSWORD=Changeme2025  # Enables auto-refresh
```

---

## API Endpoints

### Required Headers

```
Content-Type: application/json
Accept: application/json
uid: velocity@fibertimemaintenance.com
access-token: <token>
client: <client>
```

### List Cases (Velocity)

```bash
# Filter by assigned_to = Maintenance - Velocity (ID: 21924332416)
GET /api/v2/entities/Case?page=1&items=50&filters=[{"operator":"all","conditions":[{"name":"assigned_to","value":"21924332416","operator":"equals"}]}]
```

**IMPORTANT**: Do NOT include `view=all` parameter - it causes 0 results!

### Get Case Details

```bash
GET /api/v2/entities/Case/{caseId}
```

**Response Structure**:
```json
{
  "id": 23978236256,
  "label": "Connection Issue FT657323",
  "entity_type": "Case",
  "created_at": "2026-01-14T05:23:32.337Z",
  "fields": {
    "status": "Assigned",
    "category": "Connectivity::ONT/Gizzu",
    "telephone": null,
    "address": null
  },
  "relationships": {
    "contact": { "label": "Customer Name" },
    "assigned_to": { "label": "Maintenance - Velocity" },
    "c__dr_number": { "label": "DR1734315" }  // <-- DR number here!
  }
}
```

### Get Case Activities

```bash
GET /api/v2/entities/Case/{caseId}/events?expand_conversations=false&page=1&sort=id%20DESC
```

---

## Sync Architecture

### Flow

```
POST /api/ticketing/sync/qcontact
    ↓
qcontactSyncOrchestrator.ts (runInboundOnlySync)
    ↓
qcontactSyncInbound.ts (syncFiberTimeInboundTickets)
    ↓
fibertimeQContactClient.ts (listCases, getCase)
    ↓
QContact API
    ↓
tickets table (FibreFlow DB)
```

### Key Files

| File | Purpose |
|------|---------|
| `src/modules/ticketing/services/fibertimeQContactClient.ts` | QContact API client |
| `src/modules/ticketing/services/qcontactSyncInbound.ts` | Inbound sync logic |
| `src/modules/ticketing/services/qcontactSyncOrchestrator.ts` | Sync coordination |
| `src/app/api/ticketing/sync/qcontact/route.ts` | Sync API endpoint |

### Trigger Sync

```bash
# Inbound only (QContact -> FibreFlow)
curl -X POST http://localhost:3005/api/ticketing/sync/qcontact \
  -H "Content-Type: application/json" \
  -d '{"sync_direction": "inbound"}'
```

---

## Field Mapping

### DR Number Extraction

DR numbers are stored in QContact as relationships, NOT flat fields:

```typescript
// CORRECT - from relationships
const drNumber = caseDetail.relationships?.c__dr_number?.label;  // "DR1734315"

// WRONG - flat fields are often empty
const drNumber = caseDetail.c__dr_number;  // null
```

### Category Mapping

| QContact Category | FibreFlow Type |
|-------------------|----------------|
| Connectivity::ONT/Gizzu | fault |
| Maintenance::* | maintenance |
| Installation::* | installation |
| Query::* | query |
| Complaint::* | complaint |

---

## Database Tables

### tickets

Synced QContact cases are stored with:
- `source = 'qcontact'`
- `external_id = <QContact case ID>`
- `dr_number = <extracted DR number>`

### qcontact_sync_log

Audit trail for all sync operations.

---

## Troubleshooting

### Common Issues

| Issue | Cause | Fix |
|-------|-------|-----|
| 0 results from API | `view=all` parameter | Remove it (fixed Jan 2026) |
| 401 Unauthorized | Expired tokens | Re-authenticate via API |
| Empty DR numbers | Wrong field path | Use `relationships.c__dr_number.label` |
| Duplicate tickets | Already synced | Automatic skip by external_id |

### Test API Directly

```bash
# Get fresh tokens
curl -s -D - -X POST "https://fibertime.qcontact.com/api/v2/auth/sign_in" \
  -H "Content-Type: application/json" \
  -d '{"email":"velocity@fibertimemaintenance.com","password":"Changeme2025"}' \
  2>&1 | grep -E "access-token|client"

# Test case fetch (use tokens from above)
curl -s "https://fibertime.qcontact.com/api/v2/entities/Case?items=5" \
  -H "uid: velocity@fibertimemaintenance.com" \
  -H "access-token: <TOKEN>" \
  -H "client: <CLIENT>" | jq '.results | length'
```

---

## Commands

| Command | Description |
|---------|-------------|
| `/qcontact` | Open QContact agent |
| `/qcontact *login` | Browser login & token refresh |
| `/qcontact *sync` | Trigger inbound sync |
| `/qcontact *test` | Test API connectivity |

---

## Recent Fixes

### Jan 2026: view=all Bug

**Commit**: `7d4f879`

The `view=all` parameter in the API request was causing QContact to return 0 results. Removed from `fibertimeQContactClient.ts:545`.

---

## Auto-Refresh

When `FIBERTIME_QCONTACT_PASSWORD` is set, the client automatically:
1. Detects 401 responses
2. Re-authenticates via API
3. Retries the failed request

No manual token refresh needed.
