/**
 * Bulk download SharePoint photos to local storage and update DB source to 'local'.
 * Usage: node scripts/migrate-sp-photos.js [--project "Name"] [--batch-size 20]
 */
const { neon } = require('@neondatabase/serverless');
const fs = require('fs');
const path = require('path');

const sql = neon('postgresql://neondb_owner:npg_MIUZXrg1tEY0@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require');
const STORAGE_ROOT = '/home/velo/storage/qa-photos';
const SP_TENANT_ID = 'f22e6344-a35d-43b0-ad8c-a247f513c1ee';
const SP_CLIENT_ID = '075bd672-bffa-45ba-9fd0-724535e612db';
const SP_CLIENT_SECRET = 'Ozw8Q~HG1PMZFPNb0Ze1f-eTYrtglVioRzy2lakF';

const args = process.argv.slice(2);
const projectIdx = args.indexOf('--project');
const projectFilter = projectIdx >= 0 ? args[projectIdx + 1] : null;
const bsIdx = args.indexOf('--batch-size');
const BATCH_SIZE = bsIdx >= 0 ? parseInt(args[bsIdx + 1]) : 20;

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

async function downloadOne(row) {
  const projectSlug = String(row.project_name).toLowerCase().replace(/\s+/g, '-');
  const featureId = sanitize(String(row.feature_id));
  const filename = sanitize(row.filename || `${row.id}.jpg`);
  const relPath = `${projectSlug}/${featureId}/${filename}`;
  const destPath = path.join(STORAGE_ROOT, relPath);

  // Skip if exists
  if (fs.existsSync(destPath)) {
    return { status: 'skipped', relPath };
  }

  const dir = path.dirname(destPath);
  fs.mkdirSync(dir, { recursive: true });

  let url = row.storage_url;
  if (!url) return { status: 'fail', reason: 'no URL' };
  if (!url.endsWith('/content')) url += '/content';

  const token = await getToken();
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    redirect: 'follow',
  });

  if (res.status === 429) {
    // Throttled — wait and retry
    const retryAfter = parseInt(res.headers.get('Retry-After') || '10');
    console.log(`  [429] Throttled, waiting ${retryAfter}s...`);
    await new Promise(r => setTimeout(r, retryAfter * 1000));
    return { status: 'retry' };
  }

  if (!res.ok) {
    return { status: 'fail', reason: `HTTP ${res.status}` };
  }

  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 100) {
    return { status: 'fail', reason: `tiny ${buf.length}b` };
  }

  fs.writeFileSync(destPath, buf);

  // Update DB
  await sql`
    UPDATE construction_qa_photos
    SET source = 'local',
        storage_key = ${relPath},
        updated_at = NOW()
    WHERE id = ${row.id}::uuid
  `;

  return { status: 'ok', bytes: buf.length, relPath };
}

async function main() {
  console.log('=== SharePoint → Local Storage Migration ===');
  console.log(`Project filter: ${projectFilter || 'ALL'}`);
  console.log(`Batch size: ${BATCH_SIZE}`);
  console.log(`Storage: ${STORAGE_ROOT}`);

  // Count total
  const countRows = projectFilter
    ? await sql`
        SELECT COUNT(*) as cnt FROM construction_qa_photos p
        JOIN construction_qa_reviews r ON p.review_id = r.id
        JOIN projects pr ON r.project_id = pr.id
        WHERE p.source = 'sharepoint' AND pr.project_name = ${projectFilter}
      `
    : await sql`SELECT COUNT(*) as cnt FROM construction_qa_photos WHERE source = 'sharepoint'`;

  const total = parseInt(countRows[0].cnt);
  console.log(`Total to migrate: ${total}\n`);

  let offset = 0;
  const stats = { ok: 0, fail: 0, skipped: 0, retries: 0 };
  const startTime = Date.now();

  while (offset < total) {
    const rows = projectFilter
      ? await sql`
          SELECT p.id, p.storage_url, p.filename, pr.project_name, r.feature_id
          FROM construction_qa_photos p
          JOIN construction_qa_reviews r ON p.review_id = r.id
          JOIN projects pr ON r.project_id = pr.id
          WHERE p.source = 'sharepoint' AND pr.project_name = ${projectFilter}
          ORDER BY pr.project_name, r.feature_id, p.created_at
          LIMIT ${BATCH_SIZE} OFFSET ${offset}
        `
      : await sql`
          SELECT p.id, p.storage_url, p.filename, pr.project_name, r.feature_id
          FROM construction_qa_photos p
          JOIN construction_qa_reviews r ON p.review_id = r.id
          JOIN projects pr ON r.project_id = pr.id
          WHERE p.source = 'sharepoint'
          ORDER BY pr.project_name, r.feature_id, p.created_at
          LIMIT ${BATCH_SIZE} OFFSET ${offset}
        `;

    if (rows.length === 0) break;

    for (const row of rows) {
      let result;
      let attempts = 0;
      do {
        result = await downloadOne(row);
        if (result.status === 'retry') {
          attempts++;
          stats.retries++;
        }
      } while (result.status === 'retry' && attempts < 3);

      if (result.status === 'ok') stats.ok++;
      else if (result.status === 'skipped') stats.skipped++;
      else {
        stats.fail++;
        console.error(`  [FAIL] ${row.id}: ${result.reason || 'unknown'}`);
      }

      // Small delay to avoid throttling (50ms between requests)
      await new Promise(r => setTimeout(r, 50));
    }

    offset += rows.length;
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    const pct = ((offset / total) * 100).toFixed(1);
    const rate = (stats.ok / (elapsed / 60)).toFixed(0);
    console.log(`[${pct}%] ${offset}/${total} | OK: ${stats.ok} | Skip: ${stats.skipped} | Fail: ${stats.fail} | ${elapsed}s | ~${rate}/min`);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
  console.log(`\n=== Done in ${elapsed}s ===`);
  console.log(`OK: ${stats.ok} | Skipped: ${stats.skipped} | Failed: ${stats.fail} | Retries: ${stats.retries}`);

  // Report storage size
  const { execSync } = require('child_process');
  const size = execSync(`du -sh ${STORAGE_ROOT}`).toString().trim();
  console.log(`Storage size: ${size}`);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
