# /qcontact Command

When this command is used, adopt the QContact Integration Agent persona.

## QContact Integration Agent

**Purpose**: Manage FiberTime QContact ticketing integration for FibreFlow.

## Quick Reference

| Item | Value |
|------|-------|
| **URL** | https://fibertime.qcontact.com |
| **Username** | velocity@fibertimemaintenance.com |
| **Password** | Changeme2025 |
| **Velocity User ID** | 21924332416 |

---

## Commands

| Command | Description |
|---------|-------------|
| `*sync` | Trigger inbound sync (QContact -> FibreFlow) |
| `*login` | Browser login & token refresh |
| `*test` | Test API connectivity |
| `*status` | Check sync status and recent logs |
| `*help` | Show this help |

---

## *sync - Trigger Inbound Sync

```bash
curl -s -X POST http://localhost:3005/api/ticketing/sync/qcontact \
  -H "Content-Type: application/json" \
  -d '{"sync_direction": "inbound"}' | jq '.data.summary'
```

---

## *login - Browser Login & Token Refresh

1. Open browser to QContact
2. Login with credentials
3. Extract tokens from response headers or localStorage
4. Update `.env.local` with fresh tokens

```javascript
mcp__boss-ghost-mcp__new_page({ url: "https://fibertime.qcontact.com" })
// ... login flow
```

---

## *test - Test API Connectivity

```bash
# Get fresh tokens
curl -s -D - -X POST "https://fibertime.qcontact.com/api/v2/auth/sign_in" \
  -H "Content-Type: application/json" \
  -d '{"email":"velocity@fibertimemaintenance.com","password":"Changeme2025"}' \
  2>&1 | grep -E "HTTP|access-token|client"

# Test case fetch
curl -s "https://fibertime.qcontact.com/api/v2/entities/Case?items=3" \
  -H "uid: velocity@fibertimemaintenance.com" \
  -H "access-token: <TOKEN>" \
  -H "client: <CLIENT>" | jq '.results | length'
```

---

## API Details

### Authentication Headers

```
uid: velocity@fibertimemaintenance.com
access-token: <from auth or .env.local>
client: <from auth or .env.local>
```

### Key Endpoints

| Endpoint | Purpose |
|----------|---------|
| `POST /api/v2/auth/sign_in` | Get fresh tokens |
| `GET /api/v2/entities/Case?items=N&filters=...` | List Velocity cases |
| `GET /api/v2/entities/Case/{id}` | Get case details |
| `GET /api/v2/entities/Case/{id}/events` | Get case activities |

### Filter for Velocity Cases

```json
[{"operator":"all","conditions":[{"name":"assigned_to","value":"21924332416","operator":"equals"}]}]
```

**CRITICAL**: Do NOT include `view=all` parameter - it causes 0 results!

---

## DR Number Extraction

DR numbers are in `relationships.c__dr_number.label`, NOT flat fields:

```javascript
const drNumber = caseDetail.relationships?.c__dr_number?.label;  // "DR1734315"
```

---

## Environment Variables

```bash
# .env.local
FIBERTIME_QCONTACT_BASE_URL=https://fibertime.qcontact.com
FIBERTIME_QCONTACT_UID=velocity@fibertimemaintenance.com
FIBERTIME_QCONTACT_ACCESS_TOKEN=<token>
FIBERTIME_QCONTACT_CLIENT=<client>
FIBERTIME_QCONTACT_PASSWORD=Changeme2025  # Enables auto-refresh on 401
```

---

## Sync Architecture

```
POST /api/ticketing/sync/qcontact
    ↓
qcontactSyncOrchestrator.ts
    ↓
qcontactSyncInbound.ts (syncFiberTimeInboundTickets)
    ↓
fibertimeQContactClient.ts (listCases, getCase)
    ↓
QContact API
    ↓
tickets table
```

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Sync returns 0 | Remove `view=all` (fixed Jan 2026) |
| 401 Unauthorized | Re-authenticate or set PASSWORD env |
| Empty DR numbers | Use `relationships.c__dr_number.label` |
| Server not running | `npm run build && PORT=3005 npm start` |

---

## Full Documentation

See: `.claude/skills/qcontact/README.md`
