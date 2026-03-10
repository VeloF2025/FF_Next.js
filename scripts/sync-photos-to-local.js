#!/usr/bin/env node
/**
 * Continuous sync: download any remaining SharePoint photos to local storage.
 * Run as a cron job (e.g. every 30 min) to catch newly ingested SP photos.
 *
 * Usage: node scripts/sync-photos-to-local.js [--limit 500]
 *
 * Only processes source='sharepoint' photos (QField photos are served
 * directly from MinIO on Velo — no need to copy).
 */
const { neon } = require('@neondatabase/serverless');
const fs = require('fs');
const path = require('path');

const DB_URL = process.env.DATABASE_URL || 'postgresql://neondb_owner:npg_MIUZXrg1tEY0@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require';
const sql = neon(DB_URL);
const STORAGE_ROOT = process.env.QA_PHOTO_STORAGE || '/home/velo/storage/qa-photos';

const SP_TENANT_ID = 'f22e6344-a35d-43b0-ad8c-a247f513c1ee';
const SP_CLIENT_ID = '075bd672-bffa-45ba-9fd0-724535e612db';
const SP_CLIENT_SECRET = 'Ozw8Q~HG1PMZFPNb0Ze1f-eTYrtglVioRzy2lakF';

const args = process.argv.slice(2);
const limitIdx = args.indexOf('--limit');
const LIMIT = limitIdx >= 0 ? parseInt(args[limitIdx + 1]) : 500;

let spToken = null;
let tokenExpiry = 0;

async function getToken() {
  if (spToken && Date.now() < tokenExpiry) return spToken;
  const res = await fetch(
    `https://login.microsoftonline.com/${SP_TENANT_ID}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: SP_CLIENT_ID,
        client_secret: SP_CLIENT_SECRET,
        scope: 'https://graph.microsoft.com/.default',
        grant_type: 'client_credentials',
      }).toString(),
    }
  );
  if (!res.ok) throw new Error(`Token failed: ${res.status}`);
  const data = await res.json();
  spToken = data.access_token;
  tokenExpiry = Date.now() + 50 * 60 * 1000;
  return spToken;
}

function sanitize(name) {
  return name.replace(/[<>:"|?*]/g, '_');
}

async function main() {
  // Get SharePoint photos not yet in local storage
  const rows = await sql`
    SELECT p.id, p.storage_url, p.filename, pr.project_name, r.feature_id
    FROM construction_qa_photos p
    JOIN construction_qa_reviews r ON p.review_id = r.id
    JOIN projects pr ON r.project_id = pr.id
    WHERE p.source = 'sharepoint'
    ORDER BY p.created_at DESC
    LIMIT ${LIMIT}
  `;

  if (rows.length === 0) {
    console.log('No SharePoint photos to sync');
    return;
  }

  console.log(`Syncing ${rows.length} SharePoint photos to local storage...`);
  const stats = { ok: 0, skip: 0, fail: 0 };

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const projectSlug = String(row.project_name).toLowerCase().replace(/\s+/g, '-');
    const featureId = sanitize(String(row.feature_id));
    const filename = sanitize(row.filename || `${row.id}.jpg`);
    const relPath = `${projectSlug}/${featureId}/${filename}`;
    const destPath = path.join(STORAGE_ROOT, relPath);

    if (fs.existsSync(destPath)) {
      // File exists, just update DB
      await sql`
        UPDATE construction_qa_photos
        SET source = 'local', storage_key = ${relPath}, updated_at = NOW()
        WHERE id = ${row.id}::uuid AND source = 'sharepoint'
      `;
      stats.skip++;
      continue;
    }

    if (!row.storage_url) {
      stats.fail++;
      continue;
    }

    try {
      const token = await getToken();
      let url = row.storage_url;
      if (!url.endsWith('/content')) url += '/content';

      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        redirect: 'follow',
      });

      if (!res.ok) {
        stats.fail++;
        continue;
      }

      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 100) {
        stats.fail++;
        continue;
      }

      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.writeFileSync(destPath, buf);

      await sql`
        UPDATE construction_qa_photos
        SET source = 'local', storage_key = ${relPath}, updated_at = NOW()
        WHERE id = ${row.id}::uuid
      `;
      stats.ok++;

      // Throttle
      await new Promise(r => setTimeout(r, 50));
    } catch (err) {
      stats.fail++;
    }

    if ((i + 1) % 100 === 0) {
      console.log(`  ${i + 1}/${rows.length} | OK: ${stats.ok} | Skip: ${stats.skip} | Fail: ${stats.fail}`);
    }
  }

  console.log(`Done: OK=${stats.ok} Skip=${stats.skip} Fail=${stats.fail}`);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
