---
name: fibertime-sync
description: Fibertime SharePoint OES sync — nightly pull of Nokia OES activation reports from isizweprojects.sharepoint.com into FibreFlow. Covers cookie refresh, manual trigger, PP data backfill, and auth troubleshooting. USE WHEN user says 'fibertime sync', 'fibertime sharepoint', 'OES cron', 'SP cookies', 'cookie expired', 'refresh cookies', 'fibertime auth', 'PP backfill'.
---

# Fibertime SharePoint OES Sync

Nightly automated pull of Nokia OES reports from Fibertime's SharePoint into FibreFlow's OES pipeline.

## Overview

| What | Detail |
|------|--------|
| **Sites** | LAW, MAM, MOA, TEM (ETW excluded) |
| **Schedule** | 22:30 SAST nightly (cron on Velocity) |
| **Endpoint** | `POST /api/fibertime/oes-sync` |
| **Auth** | Playwright cookie file (refreshed every 30–90 days) |
| **Cookie file** | `/home/velo/.fibertime-sp-cookies.json` |
| **Login email** | `reporting@velocityfibre.co.za` |
| **SharePoint** | `isizweprojects.sharepoint.com/sites/FibertimeReports` |

## File Naming Convention

Nokia names files: `oes_status_report_{SITE}_{YYYYMMDD}.xlsx`
Draft files (with numeric suffix) are ignored: `oes_status_report_LAW_20260411 1.xlsx`

Each site's file lives at: `OES Report/Sites/{SITE}/`

## Key Files

| File | Purpose |
|------|---------|
| `pages/api/fibertime/oes-sync.ts` | API endpoint (cron calls this) |
| `src/services/fibertime-oes-sync.ts` | Core sync logic |
| `src/lib/sharepoint/fibertime-sp-client.ts` | Cookie-based SP REST client |
| `src/modules/activate/services/oes/oesExcelParser.ts` | Excel parser incl. PP sheet |
| `scripts/fibertime-sp-login.ts` | Interactive cookie refresh script |

---

## Cookie Refresh (Auth Expired)

Cookies last 30–90 days. When expired the API returns HTTP 503:

```json
{
  "success": false,
  "error": "Fibertime SharePoint session expired",
  "action": "Run scripts/fibertime-sp-login.ts on the Velocity server to refresh cookies"
}
```

### How to Refresh

**Must run headed (requires display) on Velocity:**

```bash
# Run as hein on Velocity — needs DISPLAY for Playwright browser
DISPLAY=:1 FIBERTIME_SP_COOKIE_FILE=/tmp/fibertime-sp-cookies.json \
  npx tsx -r dotenv/config scripts/fibertime-sp-login.ts
```

1. A Chromium window opens at `https://fibertime.com/contractor-reports`
2. Email `reporting@velocityfibre.co.za` is pre-filled
3. Complete OTP in the browser (check email for the code)
4. Script polls until SharePoint URL is detected — no manual step needed
5. Cookies saved to temp file automatically

Then copy to velo's home:
```bash
sudo cp /tmp/fibertime-sp-cookies.json /home/velo/.fibertime-sp-cookies.json
sudo chown velo:velo /home/velo/.fibertime-sp-cookies.json
rm /tmp/fibertime-sp-cookies.json
```

**Verify** the cookie file was populated:
```bash
python3 -c "
import json
cookies = json.load(open('/home/velo/.fibertime-sp-cookies.json'))
sp = [c for c in cookies if 'sharepoint.com' in c['domain']]
print(f'Total: {len(cookies)}, SharePoint: {len(sp)}')
"
```

---

## Manual Sync Trigger

Trigger a sync for any date:

```bash
# Trigger for today (SAST default)
curl -s -X POST https://app.fibreflow.app/api/fibertime/oes-sync \
  -H "Authorization: Bearer $(sudo -u velo grep CRON_SECRET /home/velo/fibreflow-production/.env.local | cut -d= -f2)" \
  -H "Content-Type: application/json" | jq .

# Trigger for a specific date
curl -s -X POST https://app.fibreflow.app/api/fibertime/oes-sync \
  -H "Authorization: Bearer $(sudo -u velo grep CRON_SECRET /home/velo/fibreflow-production/.env.local | cut -d= -f2)" \
  -H "Content-Type: application/json" \
  -d '{"date":"20260410"}' | jq .
```

Expected success response:
```json
{
  "success": true,
  "data": {
    "date": "20260411",
    "sites": [
      {"site":"LAW","status":"imported","rows":5832,"inserted":12,"updated":5820,...},
      {"site":"MAM","status":"imported",...},
      {"site":"MOA","status":"imported",...},
      {"site":"TEM","status":"imported",...}
    ],
    "durationMs": 12450
  }
}
```

Site statuses: `imported` | `skipped` (already done) | `not_available` (file not on SP yet) | `error`

---

## PP Data (Pre-Provisioned)

Each per-site file may contain a **"Pre-Provisioned Data"** sheet alongside OLT Data.

- Imported automatically during the nightly sync when found
- Sheet names matched: `PP DATA`, `PRE-PROV*`, `PREPROVISIONED`, `PRE PROV`, `PROVISIONED`
- Tables: `oes_pp_data` + `oes_pp_import_batches`
- TEM files typically have no PP sheet

### PP Backfill (missed files)

If PP data was missed for previously-imported files:

```bash
# Backfill for a specific date — run from the main workspace
cd /home/hein/Workspace/FF_Next.js
FIBERTIME_SP_COOKIE_FILE=/home/velo/.fibertime-sp-cookies.json \
  npx tsx backfill-pp.ts 20260410
```

The script downloads each site's file, parses the PP sheet, skips files already in
`oes_pp_import_batches`, and upserts into `oes_pp_data`.

**Note**: `backfill-pp.ts` lives in the worktree root (not committed — a one-time utility).

---

## Database Queries

```sql
-- Recent OES syncs (per-site files)
SELECT filename, report_date, total_rows, matched_drops, imported_at
FROM oes_import_batches
ORDER BY imported_at DESC LIMIT 10;

-- PP import history
SELECT filename, total_rows, created_at
FROM oes_pp_import_batches
ORDER BY created_at DESC LIMIT 10;

-- PP data counts by project and resolution status
SELECT project, resolution_status, COUNT(*)
FROM oes_pp_data
GROUP BY project, resolution_status
ORDER BY project, resolution_status;
```

---

## Troubleshooting

### Auth expired (503 response)
→ Run cookie refresh — see **Cookie Refresh** section above.

### File not available (`not_available` status)
Nokia uploads final files in the evening. If sync runs at 22:30 and the file isn't there yet,
re-trigger manually the next morning with the correct date.

### File already imported (`skipped` status)
Normal — the sync is idempotent. Skipping is correct behaviour.

### `channel_binding` error in tsx scripts
The `DATABASE_URL` has `channel_binding=require` which breaks `pg` in tsx context
(not in the Next.js app itself). The backfill script strips it automatically.
Do not manually add `channel_binding=require` in any standalone scripts.

### Cookies saved but still 401
The `FedAuth` and `rtFa` HttpOnly cookies are critical:
```bash
python3 -c "
import json
cookies = json.load(open('/home/velo/.fibertime-sp-cookies.json'))
key = [c for c in cookies if c['name'] in ('FedAuth', 'rtFa')]
for c in key: print(c['name'], 'expires:', c['expires'])
"
```
If `FedAuth`/`rtFa` are missing, login didn't complete. Re-run the login script and
wait until you can see SharePoint content in the browser before it auto-saves.

---

## Cron Configuration

```bash
# View current cron (Velocity, as hein)
sudo -u velo crontab -l | grep oes-sync
```

Expected entry (22:30 SAST = 20:30 UTC):
```
30 20 * * * curl -s -X POST https://app.fibreflow.app/api/fibertime/oes-sync \
  -H "Authorization: Bearer $CRON_SECRET" >> /var/log/fibertime-oes-sync.log 2>&1
```

---

## Related

- `/oes` — manual OES Excel import via UI
- `src/lib/sharepoint/fibertime-sp-client.ts` — SP REST client (cookie loading, list/download)
- `.env.local` keys: `FIBERTIME_SP_COOKIE_FILE`, `CRON_SECRET`
