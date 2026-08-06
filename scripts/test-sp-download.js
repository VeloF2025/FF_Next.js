const { neon } = require('@neondatabase/serverless');
const fs = require('fs');
const path = require('path');
const { requireEnv } = require('./lib/require-env.cjs');

const sql = neon(requireEnv('DATABASE_URL'));
const STORAGE_ROOT = '/home/velo/storage/qa-photos';
const SP_TENANT_ID = requireEnv('SP_TENANT_ID');
const SP_CLIENT_ID = requireEnv('SP_CLIENT_ID');
const SP_CLIENT_SECRET = requireEnv('SP_CLIENT_SECRET');

async function main() {
  const tokenRes = await fetch(
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
  const { access_token } = await tokenRes.json();
  console.log('Got SP token');

  const rows = await sql`
    SELECT p.id, p.storage_url, p.filename, pr.project_name, r.feature_id
    FROM construction_qa_photos p
    JOIN construction_qa_reviews r ON p.review_id = r.id
    JOIN projects pr ON r.project_id = pr.id
    WHERE p.source = 'sharepoint'
    LIMIT 3
  `;

  for (const row of rows) {
    const projectSlug = String(row.project_name).toLowerCase().replace(/\s+/g, '-');
    const featureId = String(row.feature_id);
    const filename = (row.filename || row.id + '.jpg').replace(/[<>:"|?*]/g, '_');
    const dir = path.join(STORAGE_ROOT, projectSlug, featureId);
    fs.mkdirSync(dir, { recursive: true });
    const destPath = path.join(dir, filename);

    let url = row.storage_url;
    if (url && !url.endsWith('/content')) url += '/content';

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${access_token}` },
      redirect: 'follow',
    });

    if (!res.ok) {
      console.log('FAIL', res.status, row.id);
      continue;
    }

    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(destPath, buf);
    console.log('OK', buf.length, 'bytes →', destPath.replace(STORAGE_ROOT + '/', ''));
  }
}

main().catch(e => console.error(e));
