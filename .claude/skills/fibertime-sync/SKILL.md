---
name: fibertime-sync
description: Fibertime SharePoint syncs — OES activation reports + Offline ONT reports. Cookie refresh, manual trigger, PP backfill, offline dispute detection. USE WHEN user says 'fibertime sync', 'fibertime sharepoint', 'OES cron', 'offline sync', 'offline ONT', 'SP cookies', 'cookie expired', 'refresh cookies', 'fibertime auth', 'PP backfill', 'dispute candidate', 'offline report'.
---

# Fibertime SharePoint Syncs

Two nightly SharePoint pulls from Fibertime into FibreFlow:

| Sync | Schedule | Endpoint | Folder |
|------|----------|----------|--------|
| **OES Activation** | 22:30 SAST | `POST /api/fibertime/oes-sync` | `OES Report/Sites/{SITE}/` |
| **Offline ONT** | 22:45 SAST | `POST /api/fibertime/offline-sync` | `Offline ONT Report/Sites/{SITE}/` |

| What | Detail |
|------|--------|
| **Sites** | LAW, MAM, MOA, TEM (ETW excluded) |
| **Auth** | Playwright cookie file (refreshed every 30–90 days) |
| **Cookie file** | `/home/velo/.fibertime-sp-cookies.json` |
| **Login email** | `reporting@velocityfibre.co.za` |
| **SharePoint** | `isizweprojects.sharepoint.com/sites/FibertimeReports` |

---

## OES Activation Sync

### File Naming
Nokia names files: `oes_status_report_{SITE}_{YYYYMMDD}.xlsx`
Draft files (with numeric suffix) are ignored: `oes_status_report_LAW_20260411 1.xlsx`

### Key Files

| File | Purpose |
|------|---------|
| `pages/api/fibertime/oes-sync.ts` | API endpoint |
| `src/services/fibertime-oes-sync.ts` | Core sync logic |
| `src/lib/sharepoint/fibertime-sp-client.ts` | Cookie-based SP REST client |
| `src/modules/activate/services/oes/oesExcelParser.ts` | Excel parser incl. PP sheet |

### Manual Trigger

```bash
curl -s -X POST https://app.fibreflow.app/api/fibertime/oes-sync \
  -H "Authorization: Bearer $(sudo -u velo grep CRON_SECRET /home/velo/fibreflow-production/.env.local | cut -d= -f2)" \
  -H "Content-Type: application/json" | jq .

# Specific date
curl -s -X POST https://app.fibreflow.app/api/fibertime/oes-sync \
  -H "Authorization: Bearer $(sudo -u velo grep CRON_SECRET /home/velo/fibreflow-production/.env.local | cut -d= -f2)" \
  -H "Content-Type: application/json" -d '{"date":"20260410"}' | jq .
```

Site statuses: `imported` | `skipped` (already done) | `not_available` (file not on SP yet) | `error`

---

## Offline ONT Sync

Nightly pull of offline ONT reports. Creates `offline_devices` records and NOC maintenance tickets.

### File Naming
`offline_ont_report_{SITE}_{YYYYMMDD}.xlsx` — sheet: "Offline ONTs"
Columns: Drop Number, Area, Serial Number, Reason, Last Event Time, ONT Address

### Key Files

| File | Purpose |
|------|---------|
| `pages/api/fibertime/offline-sync.ts` | API endpoint |
| `src/services/fibertime-offline-sync.ts` | Core sync logic |
| `src/services/fibertime-offline-db.ts` | DB upsert, recovery detection, NOC tickets |
| `src/lib/sharepoint/offlineOntParser.ts` | Excel parser |

### Manual Trigger

```bash
curl -s -X POST https://app.fibreflow.app/api/fibertime/offline-sync \
  -H "Authorization: Bearer $(sudo -u velo grep CRON_SECRET /home/velo/fibreflow-production/.env.local | cut -d= -f2)" \
  -H "Content-Type: application/json" | jq .

# Specific date
curl -s -X POST https://app.fibreflow.app/api/fibertime/offline-sync \
  -H "Authorization: Bearer $(sudo -u velo grep CRON_SECRET /home/velo/fibreflow-production/.env.local | cut -d= -f2)" \
  -H "Content-Type: application/json" -d '{"date":"20260411"}' | jq .
```

### Dispute Detection (Note 5)

Note 5 billing deductions (Offline) are cross-referenced with `offline_devices`:
- **dispute_candidate** — Note 5 deduction but no offline record in 14-day window
- **recovered** — offline record exists but device already recovered before billing
- **dying_gasp** — transient signal loss (Dying Gasp reason)

View at: `/activate/data-sync?group=non_invoiceables` → Billing Crossref tab

### Maintenance Teams (NOC tickets)

| Site | Team UUID |
|------|-----------|
| LAW | `0c15b3b9-a878-4fef-8291-772dcd1460c3` |
| MAM | `ed032579-91ad-45e2-9e25-c41c5f9217dd` |
| MOA | `e3dd6115-c874-4bdb-a5f5-091f472bef1e` |
| TEM | `827cf861-c798-4e4d-812d-79ff2f2b750f` |

### Historical Backfill

```bash
# Run from offline-sync worktree
cd /home/hein/Workspace/FF_Next.js-offline-sync
FIBERTIME_SP_COOKIE_FILE=/home/velo/.fibertime-sp-cookies.json \
  npx tsx backfill-offline-ont.ts

# Single site
FIBERTIME_SP_COOKIE_FILE=/home/velo/.fibertime-sp-cookies.json \
  BACKFILL_SITE=LAW npx tsx backfill-offline-ont.ts

# Dry run (list only, no DB writes)
FIBERTIME_SP_COOKIE_FILE=/home/velo/.fibertime-sp-cookies.json \
  BACKFILL_DRY_RUN=1 npx tsx backfill-offline-ont.ts
```

**Note**: Uses `listFolderFilesAlt` (GetFolderByServerRelativeUrl) — the Path API returns 403 for this folder.

---

## Cookie Refresh (Auth Expired)

Both syncs use the same cookie file. When expired the API returns HTTP 503.

**Must run headed (requires display) on Velocity:**

```bash
DISPLAY=:1 FIBERTIME_SP_COOKIE_FILE=/tmp/fibertime-sp-cookies.json \
  npx tsx -r dotenv/config scripts/fibertime-sp-login.ts
```

1. Chromium opens at `https://fibertime.com/contractor-reports`
2. Email `reporting@velocityfibre.co.za` is pre-filled
3. Complete OTP in browser (check email)
4. Script polls until SharePoint URL detected — auto-saves cookies

```bash
sudo cp /tmp/fibertime-sp-cookies.json /home/velo/.fibertime-sp-cookies.json
sudo chown velo:velo /home/velo/.fibertime-sp-cookies.json
rm /tmp/fibertime-sp-cookies.json
```

**Verify:**
```bash
python3 -c "
import json
cookies = json.load(open('/home/velo/.fibertime-sp-cookies.json'))
sp = [c for c in cookies if 'sharepoint.com' in c['domain']]
print(f'Total: {len(cookies)}, SharePoint: {len(sp)}')
"
```

---

## PP Data (Pre-Provisioned)

Each OES per-site file may contain a PP DATA sheet. Imported automatically during OES sync.

### PP Backfill

```bash
cd /home/hein/Workspace/FF_Next.js
FIBERTIME_SP_COOKIE_FILE=/home/velo/.fibertime-sp-cookies.json \
  npx tsx backfill-pp.ts 20260410
```

---

## Database Queries

```sql
-- Recent OES syncs
SELECT filename, report_date, total_rows, matched_drops, imported_at
FROM oes_import_batches ORDER BY imported_at DESC LIMIT 10;

-- Recent Offline ONT syncs
SELECT filename, report_date, total_rows, imported_by, imported_at
FROM offline_import_batches ORDER BY imported_at DESC LIMIT 20;

-- Offline devices by site and recovery status
SELECT area_code, COUNT(*) FILTER (WHERE recovered_at IS NULL) AS still_offline,
       COUNT(*) FILTER (WHERE recovered_at IS NOT NULL) AS recovered
FROM offline_devices GROUP BY area_code;

-- Note 5 dispute candidates for latest billing week
SELECT dr_number, od_note5_reason, recovered_at
FROM v_offline_billing_crossref
WHERE dispute_flag = 'dispute_candidate' LIMIT 20;

-- PP import history
SELECT filename, total_rows, created_at
FROM oes_pp_import_batches ORDER BY created_at DESC LIMIT 10;
```

---

## Cron Configuration

```bash
sudo -u velo crontab -l | grep -E "oes-sync|offline-sync"
```

Current schedule:
```
30 20 * * *   /api/fibertime/oes-sync         # 22:30 SAST
45 20 * * *   /api/fibertime/offline-sync      # 22:45 SAST
```

Logs: `/home/velo/logs/fibertime-offline-sync.log`

---

## Troubleshooting

### Auth expired (503 response)
→ Run cookie refresh (see above).

### File not available
Nokia uploads files in the evening. Re-trigger manually next morning with the correct date.

### File already imported (`skipped`)
Normal — both syncs are idempotent via batch check.

### `channel_binding` error in tsx scripts
`DATABASE_URL` has `channel_binding=require` which breaks `pg` in tsx context. Standalone scripts must strip it. The backfill scripts do this automatically.

### Cookies saved but still 401
Check `FedAuth`/`rtFa` cookies:
```bash
python3 -c "
import json
cookies = json.load(open('/home/velo/.fibertime-sp-cookies.json'))
key = [c for c in cookies if c['name'] in ('FedAuth', 'rtFa')]
for c in key: print(c['name'], 'expires:', c['expires'])
"
```

---

## Related

- `/oes` — manual OES Excel import via UI
- `/activate/data-sync?group=non_invoiceables` — billing crossref with dispute flags
- `src/lib/sharepoint/fibertime-sp-client.ts` — SP REST client
- `.env.local` keys: `FIBERTIME_SP_COOKIE_FILE`, `CRON_SECRET`
