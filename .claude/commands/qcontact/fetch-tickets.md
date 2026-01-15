# /qcontact-fetch Task

Fetch tickets from QContact and sync to FibreFlow.

## Quick Sync (Preferred)

```bash
curl -X POST http://localhost:3005/api/ticketing/sync/qcontact \
  -H "Content-Type: application/json" \
  -d '{"sync_direction": "inbound"}'
```

## Credentials

```
URL: https://fibertime.qcontact.com
Username: velocity@fibertimemaintenance.com
Password: Changeme2025
Velocity User ID: 21924332416
```

---

## Method 1: API Sync (Recommended)

### Step 1: Ensure Server Running

```bash
curl -s http://localhost:3005/api/health | jq -r '.status'
# Should return: healthy
```

### Step 2: Trigger Sync

```bash
curl -s -X POST http://localhost:3005/api/ticketing/sync/qcontact \
  -H "Content-Type: application/json" \
  -d '{"sync_direction": "inbound"}' | jq '.data.summary'
```

### Expected Response

```json
{
  "direction": "inbound",
  "duration_seconds": 34.435,
  "total_success": 50,
  "total_failed": 0,
  "success_rate": 1,
  "inbound": {
    "processed": 50,
    "successful": 50,
    "created": 5,
    "updated": 0
  }
}
```

---

## Method 2: Browser Automation (Fallback)

Use when API is unavailable or for debugging.

### Step 1: Login

```javascript
mcp__boss-ghost-mcp__new_page({ url: "https://fibertime.qcontact.com" })
mcp__boss-ghost-mcp__take_snapshot()
mcp__boss-ghost-mcp__fill_form({ elements: [
  { uid: "email-field", value: "velocity@fibertimemaintenance.com" },
  { uid: "password-field", value: "Changeme2025" }
]})
mcp__boss-ghost-mcp__click({ uid: "sign-in-button" })
mcp__boss-ghost-mcp__wait_for({ text: "Cases" })
```

### Step 2: Navigate to Cases

```javascript
mcp__boss-ghost-mcp__navigate_page({
  url: "https://fibertime.qcontact.com/app/Case",
  type: "url"
})
mcp__boss-ghost-mcp__wait_for({ text: "FT" })
mcp__boss-ghost-mcp__take_snapshot()
```

### Step 3: Extract Tokens (for API use)

```javascript
mcp__boss-ghost-mcp__evaluate_script({
  function: `() => {
    const auth = localStorage.getItem('qcontact-authentication');
    return auth ? JSON.parse(auth) : null;
  }`
})
```

---

## Method 3: Direct API Test

### Get Fresh Tokens

```bash
curl -s -D - -X POST "https://fibertime.qcontact.com/api/v2/auth/sign_in" \
  -H "Content-Type: application/json" \
  -d '{"email":"velocity@fibertimemaintenance.com","password":"Changeme2025"}' \
  2>&1 | grep -E "access-token|client"
```

### Fetch Velocity Cases

```bash
curl -s "https://fibertime.qcontact.com/api/v2/entities/Case?items=10&filters=%5B%7B%22operator%22%3A%22all%22%2C%22conditions%22%3A%5B%7B%22name%22%3A%22assigned_to%22%2C%22value%22%3A%2221924332416%22%2C%22operator%22%3A%22equals%22%7D%5D%7D%5D" \
  -H "uid: velocity@fibertimemaintenance.com" \
  -H "access-token: <TOKEN>" \
  -H "client: <CLIENT>" | jq '.results | length'
```

**IMPORTANT**: Do NOT include `view=all` parameter!

---

## DR Number Extraction

DR numbers are in **relationships**, not flat fields:

```bash
# Get case details
curl -s "https://fibertime.qcontact.com/api/v2/entities/Case/{caseId}" \
  -H "uid: velocity@fibertimemaintenance.com" \
  -H "access-token: <TOKEN>" \
  -H "client: <CLIENT>" | jq '.relationships.c__dr_number.label'
# Returns: "DR1734315"
```

---

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| Sync returns 0 | `view=all` in request | Remove parameter (fixed Jan 2026) |
| 401 Unauthorized | Expired tokens | Re-authenticate or set PASSWORD env |
| Server not running | No local server | `npm run build && PORT=3005 npm start` |
| Empty DR numbers | Wrong field path | Use `relationships.c__dr_number.label` |

---

## Output Format

Successful sync returns:

```
QContact Sync Results:
- Processed: 50 tickets
- Created: 5 new
- Skipped: 45 existing
- Failed: 0
- Duration: 34s
- Success Rate: 100%
```

---

## References

- Full docs: `.claude/skills/qcontact/README.md`
- Client: `src/modules/ticketing/services/fibertimeQContactClient.ts`
- Sync: `src/modules/ticketing/services/qcontactSyncInbound.ts`
