---
name: qa-ingest
description: Construction QA photo ingestion management. SharePoint and QField photo pipelines into Construction QA system. USE WHEN user says 'ingest photos', 'sharepoint ingest', 'qfield ingest', 'missing photos', 'photo sync', 're-ingest', 'qa ingest', 'ingest all projects'.
---

# /qa-ingest — Construction QA Photo Ingestion

Manage SharePoint and QField photo ingestion into the Construction QA system.

USE WHEN user says "ingest photos", "sharepoint ingest", "qfield ingest", "missing photos", "photo sync", "re-ingest", "qa ingest", "ingest all projects", OR wants to check/fix photo coverage across projects.

## Overview

Two photo ingestion pipelines:
1. **SharePoint** — Python script scans MS Graph API folders, matches photos to poles by filename/folder name
2. **QField** — Node.js service reads `qfield_photo_validations` table, creates review + photo records

## Commands

### SharePoint Ingest

```bash
# Dry-run single project
export $(grep DATABASE_URL .env.local | head -1 | xargs)
python3 scripts/ingest-sharepoint-qa.py --project "Thembisa POP 1" --dry-run

# Live ingest single project
python3 scripts/ingest-sharepoint-qa.py --project "Thembisa POP 1"

# All projects (dry-run)
python3 scripts/ingest-sharepoint-qa.py --project all --dry-run

# All projects (live)
python3 scripts/ingest-sharepoint-qa.py --project all

# Override scan folder
python3 scripts/ingest-sharepoint-qa.py --project Lawley --folder-id 01XUF54K...
```

Available projects: `Lawley`, `Mohadin`, `Mamelodi`, `Etwatwa`, `Thembisa POP 1`, `Thembisa POP 3`

### QField Ingest

```bash
# Via API (dry-run all projects)
CRON_SECRET=$(grep CRON_SECRET .env.local | head -1 | cut -d= -f2)
curl -s -X POST https://dev.fibreflow.app/api/construction-qa/ingest-qfield \
  -H "Content-Type: application/json" \
  -H "x-cron-secret: $CRON_SECRET" \
  -d '{"dryRun": true}' | python3 -m json.tool

# Live ingest all projects
curl -s -X POST https://dev.fibreflow.app/api/construction-qa/ingest-qfield \
  -H "Content-Type: application/json" \
  -H "x-cron-secret: $CRON_SECRET" \
  -d '{"dryRun": false}'

# Single project
curl -s -X POST https://dev.fibreflow.app/api/construction-qa/ingest-qfield \
  -H "Content-Type: application/json" \
  -H "x-cron-secret: $CRON_SECRET" \
  -d '{"projectId": "7d8b94d6-8e5a-4dbb-9ede-69ce3884e004", "dryRun": true}'
```

### Check Coverage

```bash
# Poles vs reviews per project
export $(grep DATABASE_URL .env.local | head -1 | xargs)
node -e "
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);
(async () => {
  const r = await sql\`
    SELECT p.project_name,
      (SELECT COUNT(*)::int FROM poles po WHERE po.project_id = p.id) as poles,
      (SELECT COUNT(*)::int FROM construction_qa_reviews r WHERE r.project_id = p.id) as reviews,
      (SELECT COUNT(DISTINCT r2.feature_id)::int FROM construction_qa_reviews r2 WHERE r2.project_id = p.id) as unique_features
    FROM projects p
    WHERE EXISTS (SELECT 1 FROM poles po WHERE po.project_id = p.id)
    ORDER BY (SELECT COUNT(*)::int FROM poles po WHERE po.project_id = p.id) DESC
  \`;
  console.log('Project'.padEnd(25), 'Poles'.padStart(7), 'Reviews'.padStart(9), 'Gap'.padStart(7));
  r.forEach(x => console.log(x.project_name.padEnd(25), String(x.poles).padStart(7), String(x.reviews).padStart(9), String(x.poles - x.unique_features).padStart(7)));
})();
"

# Check for duplicate reviews
node -e "
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);
(async () => {
  const d = await sql\`SELECT project_id, feature_id, COUNT(*)::int as dupes FROM construction_qa_reviews GROUP BY project_id, feature_id HAVING COUNT(*) > 1\`;
  console.log('Duplicates:', d.length === 0 ? 'None' : d);
})();
"
```

## Key Files

| File | Purpose |
|------|---------|
| `scripts/ingest-sharepoint-qa.py` | SharePoint photo scanner + ingestor |
| `src/modules/construction-qa/services/qfieldIngestionService.ts` | QField photo ingestor |
| `pages/api/construction-qa/ingest-qfield.ts` | QField ingest API endpoint |
| `pages/api/construction-qa/zone-hierarchy.ts` | Zone/PON tree API |
| `pages/api/construction-qa/pon-features.ts` | Feature list per PON |

## How SharePoint Matching Works

1. Scans folders recursively via MS Graph API
2. Skips DR/RD folders (case-insensitive)
3. Extracts pole number from:
   - Filename: `LAW.P.A013.JPG` → `LAW.P.A013`
   - Parent folder: `TEM.P.CO24/photo.jpg` → `TEM.P.CO24`
   - Grandparent folder: `LAW.P.A001/After/photo.jpg` → `LAW.P.A001`
4. Fuzzy matching: O→0 substitution + number padding
   - `TEM.P.CO24` → tries `TEM.P.C024` (O is 0)
5. Extracts zone/PON from CPAC path: `CPAC/Zone 17/PON 190/...`
6. Deterministic UUIDs for idempotent inserts

## Known Limitations

- **"No pole no." folders** (Lawley) — cannot be matched, need manual pole assignment
- **WhatsApp images** in date folders or generic folders — no pole reference available
- **Manhole photos** (`TEM.MH.*`) — not handled (poles only)
- **Etwatwa** SP scan times out — large folder tree needs pagination improvements

## Database Tables

- `construction_qa_reviews` — one row per feature (pole/joint/cable) per project
- `construction_qa_photos` — one row per photo, FK to review
- `qfield_photo_validations` — QField photos with VLM validation results
- `poles` — pole geometry from QField GPKG imports

## Troubleshooting

**"0 new reviews" on dry-run**: All matchable photos already ingested. Check unmatched count — remaining files may have no pole reference.

**FK violation on add-to-existing**: Review was created by different pipeline (WA bridge, etc.) with different UUID. Script now uses actual review_id from DB lookup.

**Neon timeout (error 1033)**: Transient. Retry or use `--db-url` with direct (non-pooler) connection string.

**SharePoint token expired**: Token auto-refreshes per run. If persistent, check `SP_CLIENT_SECRET` in script.
