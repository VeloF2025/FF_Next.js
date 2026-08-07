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
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const { requireEnv } = require('./lib/require-env.cjs');

/**
 * Tagged-template query helper over pg, API-compatible with neon()'s.
 *
 * This script used `neon()` from @neondatabase/serverless. Inside the Next.js
 * build that import is webpack-aliased to the pg-backed shim (src/lib/neon-shim
 * .ts), so it works — but a standalone cron script gets the REAL Neon driver,
 * which speaks Neon's HTTP/WS protocol and cannot talk to a plain Postgres.
 * Against the self-hosted Supabase that replaced Neon on 2026-04-18 it fails at
 * the TLS handshake:
 *
 *   ERR_TLS_CERT_ALTNAME_INVALID: Host: localhost is not in the cert's altnames
 *
 * So supplying the right credentials was necessary but not sufficient — the
 * driver itself had to change. Uses pg directly, matching the repo convention
 * that new code uses pg.Pool rather than the Neon shim.
 */
function makeSql(pool) {
  return async function sql(strings, ...values) {
    const text = strings.reduce(
      (acc, part, i) => acc + part + (i < values.length ? `$${i + 1}` : ''),
      ''
    );
    const result = await pool.query(text, values);
    return result.rows;
  };
}

// Require DATABASE_URL rather than falling back to a literal. The previous
// fallback pointed at Neon, which was retired at the 2026-04-18 Supabase
// cutover: this script's cron never sets DATABASE_URL, so every run since then
// silently dialled a dead database and died with "password authentication
// failed" (151 consecutive failures, 3126 SharePoint photos never copied).
//
// Worse than the downtime is the shape of the bug: before the cutover the same
// fallback would have written to the WRONG LIVE DATABASE instead of erroring.
// A missing connection string must stop the job, never redirect it.
const DB_URL = requireEnv('DATABASE_URL');
// ssl:false — the replacement Postgres is reached over the loopback/Tailscale
// interface and presents an unrelated certificate; the Neon driver's forced TLS
// was itself part of why this script could not connect after the cutover.
const pool = new Pool({ connectionString: DB_URL, max: 4, ssl: false });
const sql = makeSql(pool);
const STORAGE_ROOT = process.env.QA_PHOTO_STORAGE || '/home/velo/storage/qa-photos';

// SharePoint app credentials. Never hardcode: a tracked literal is a published
// secret, and this file already leaked one once.
const SP_TENANT_ID = requireEnv('SP_TENANT_ID');
const SP_CLIENT_ID = requireEnv('SP_CLIENT_ID');
const SP_CLIENT_SECRET = requireEnv('SP_CLIENT_SECRET');

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
      // Log rather than swallow. This counter-only catch is part of why the
      // sync's failure went unnoticed: per-photo errors vanished and the run
      // still printed a tidy summary.
      stats.fail++;
      console.error(`  FAIL ${row.filename ?? row.id}: ${err instanceof Error ? err.message : String(err)}`);
    }

    if ((i + 1) % 100 === 0) {
      console.log(`  ${i + 1}/${rows.length} | OK: ${stats.ok} | Skip: ${stats.skip} | Fail: ${stats.fail}`);
    }
  }

  console.log(`Done: OK=${stats.ok} Skip=${stats.skip} Fail=${stats.fail}`);
}

// pg keeps its sockets open, so the pool must be closed or the process hangs
// forever — which for a */30 cron would stack up idle node processes.
main()
  .catch(e => {
    console.error('Fatal:', e);
    process.exitCode = 1;
  })
  .finally(() => pool.end().catch(() => {}));
