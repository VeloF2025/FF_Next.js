---
name: qcontact-recovery
description: QContact auto-recovery skill. Detect and recover from QContact API issues. USE WHEN QContact API errors occur or recovery is needed.
---

# QContact Auto-Recovery Skill

Automatically detect and recover from QContact API issues.

## Full Documentation

See: `.claude/skills/qcontact/README.md` for complete technical reference.

---

## Quick Reference

| Item | Value |
|------|-------|
| **URL** | https://fibertime.qcontact.com |
| **Username** | velocity@fibertimemaintenance.com |
| **Password** | Changeme2025 |
| **Velocity User ID** | 21924332416 |

---

## Trigger Conditions

### Auto-Activate When:

1. **401 Unauthorized** from QContact API
2. **Token expired** errors
3. **Sync returns 0 results** (may need re-auth)
4. User says "refresh qcontact", "qcontact login", "fix qcontact"

### Actions:

1. Detect authentication error
2. Re-authenticate via API: `POST /api/v2/auth/sign_in`
3. Update `.env.local` with fresh tokens
4. Retry failed operation

---

## Auto-Recovery Flow

```bash
# Step 1: Get fresh tokens
curl -s -D - -X POST "https://fibertime.qcontact.com/api/v2/auth/sign_in" \
  -H "Content-Type: application/json" \
  -d '{"email":"velocity@fibertimemaintenance.com","password":"Changeme2025"}'

# Step 2: Extract from response headers
access-token: <new-token>
client: <new-client>

# Step 3: Update .env.local
FIBERTIME_QCONTACT_ACCESS_TOKEN=<new-token>
FIBERTIME_QCONTACT_CLIENT=<new-client>

# Step 4: Restart server if running
fuser -k 3005/tcp; PORT=3005 npm start &
```

---

## Auto-Refresh Feature

When `FIBERTIME_QCONTACT_PASSWORD` is set in `.env.local`, the client automatically:

1. Detects 401 responses
2. Re-authenticates via API
3. Retries the failed request

**No manual intervention needed!**

---

## Known Issues & Fixes

| Issue | Cause | Fix |
|-------|-------|-----|
| Sync returns 0 | `view=all` parameter | Removed in commit 7d4f879 (Jan 2026) |
| Empty DR numbers | Wrong field path | Use `relationships.c__dr_number.label` |
| 401 after login | Tokens not updated | Restart server to pick up new .env.local |

---

## Status Messages

- "Detecting auth error..."
- "Re-authenticating with QContact..."
- "Tokens refreshed successfully"
- "Retrying request..."
- "Authentication failed - check credentials"

---

## Commands

| Command | Description |
|---------|-------------|
| `/qcontact` | QContact agent |
| `/qcontact *sync` | Trigger sync |
| `/qcontact *login` | Browser login |
| `/qcontact *test` | Test API |
