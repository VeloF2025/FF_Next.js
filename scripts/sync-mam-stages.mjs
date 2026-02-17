/**
 * Standalone 1Map → pon_stage_tracking sync for MAM (Mamelodi).
 * Runs outside Next.js — directly hits 1Map API + Neon DB.
 *
 * Usage: node scripts/sync-mam-stages.mjs
 */

import pg from 'pg';
const { Pool } = pg;

const BASE_URL = 'https://www.1map.co.za';
const EMAIL = 'hein@velocityfibre.co.za';
const PASSWORD = 'VeloF@2025';
const SITE = 'MAM';
const PROJECT_ID = '7003dc06-9af7-4a7c-bc6c-a177d77784f2'; // Mamelodi UUID

const DB_URL = 'postgresql://neondb_owner:npg_MIUZXrg1tEY0@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require';

// ============================================================================
// 1MAP AUTH + FETCH
// ============================================================================

async function authenticate() {
  console.log('Authenticating with 1Map...');
  const loginPage = await fetch(BASE_URL + '/login', { signal: AbortSignal.timeout(30000) });
  const html = await loginPage.text();
  const csrfMatch = html.match(/name="_csrf".*?value="([^"]+)"/);
  const csrf = csrfMatch ? csrfMatch[1] : '';

  const pageCookies = loginPage.headers.get('set-cookie') || '';
  const sidMatch = pageCookies.match(/connect\.sid=([^;]+)/);
  const csrfCookie = pageCookies.match(/csrfToken=([^;]+)/);

  const cookies = [];
  if (sidMatch) cookies.push('connect.sid=' + sidMatch[1]);
  if (csrfCookie) cookies.push('csrfToken=' + csrfCookie[1]);

  const loginRes = await fetch(BASE_URL + '/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': cookies.join('; '),
    },
    body: new URLSearchParams({ _csrf: csrf, email: EMAIL, password: PASSWORD }).toString(),
    redirect: 'manual',
    signal: AbortSignal.timeout(30000),
  });

  const setCookie = loginRes.headers.get('set-cookie') || '';
  const newSid = setCookie.match(/connect\.sid=([^;]+)/);
  const newCsrf = setCookie.match(/csrfToken=([^;]+)/);

  const authCookies = [];
  if (newSid) authCookies.push('connect.sid=' + newSid[1]);
  if (newCsrf) authCookies.push('csrfToken=' + newCsrf[1]);

  await fetch(BASE_URL + '/app?layer=5121', {
    headers: { 'Cookie': authCookies.join('; ') },
    signal: AbortSignal.timeout(30000),
  });

  console.log('Authenticated OK');
  return authCookies.join('; ');
}

async function fetchPage(cookieStr, query, page = 1, limit = 500) {
  const formData = new URLSearchParams({
    ungeocoded: 'false', left: '0', bottom: '0', right: '0', top: '0',
    selfilter: '', action: 'get', email: EMAIL, layerid: '5121',
    sort: 'prop_id', templateExpression: '', q: query,
    page: String(page), start: String((page - 1) * limit), limit: String(limit),
  });

  const res = await fetch(BASE_URL + '/api/apps/app/getattributes', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'Cookie': cookieStr,
    },
    body: formData.toString(),
    redirect: 'manual',
    signal: AbortSignal.timeout(60000),
  });

  return await res.json();
}

async function fetchAllRecords(cookieStr) {
  const allRecords = [];
  let page = 1;

  while (true) {
    console.log(`  Fetching page ${page}...`);
    const data = await fetchPage(cookieStr, SITE, page, 500);

    if (!data.result || data.result.length === 0) break;
    allRecords.push(...data.result);
    console.log(`  Page ${page}: ${data.result.length} records (total: ${allRecords.length}, pages: ${data.total_pages})`);

    if (page >= data.total_pages) break;
    page++;
    await new Promise(r => setTimeout(r, 200));
  }

  return allRecords;
}

// ============================================================================
// STATUS → STAGE MAPPING
// ============================================================================

const STATUS_PATTERNS = [
  { pattern: /^brand awareness$/i, stage: 'permissions', complete: false, implies: [] },
  { pattern: /pole permission.*approved/i, stage: 'permissions', complete: true, implies: [] },
  { pattern: /pole permission.*declined/i, stage: 'permissions', complete: false, implies: [] },
  { pattern: /home sign.*up.*approved.*scheduled/i, stage: 'optical', complete: true, implies: ['permissions', 'poles'] },
  { pattern: /home sign.*up.*approved.*re-scheduled/i, stage: 'optical', complete: true, implies: ['permissions', 'poles'] },
  { pattern: /home sign.*up.*approved.*no drop/i, stage: 'optical', complete: true, implies: ['permissions', 'poles'] },
  { pattern: /home sign.*up.*declined/i, stage: 'optical', complete: false, implies: ['permissions', 'poles'] },
  { pattern: /home installation.*installed/i, stage: 'activation', complete: true, implies: ['permissions', 'poles', 'optical'] },
  { pattern: /home installation.*in progress/i, stage: 'activation', complete: false, implies: ['permissions', 'poles', 'optical'] },
];

function parseRecord(record) {
  const status = record.status || '';

  const stageComplete = {
    permissions: false,
    poles: false,
    cwc: false,
    optical: false,
    atp: false,
    activation: false,
  };

  for (const mapping of STATUS_PATTERNS) {
    if (mapping.pattern.test(status)) {
      if (mapping.complete) stageComplete[mapping.stage] = true;
      for (const implied of mapping.implies) stageComplete[implied] = true;
    }
  }

  // Date evidence: if poles date exists and permissions done → poles planted
  const polesDate = record.last_modified_poles_date || null;
  if (polesDate && stageComplete.permissions) stageComplete.poles = true;

  // Extract DR number
  const drNumber = record.drp || '';

  // PON from 1Map field
  const ponsField = record.pons;
  const ponNo = ponsField ? parseInt(ponsField, 10) : null;

  // Zone from pole label (e.g., MAM.P.C334 → zone C = 3)
  let zoneNo = null;
  const pole = record.pole || '';
  const match = pole.match(/\.P\.([A-Z])\d+/i);
  if (match) {
    zoneNo = match[1].toUpperCase().charCodeAt(0) - 64;
  }

  return {
    dr_number: drNumber,
    zone_no: zoneNo,
    pon_no: isNaN(ponNo) ? null : ponNo,
    status,
    stages: stageComplete,
    permissions_date: polesDate,  // closest proxy
    optical_date: record.last_modified_signup_date || null,
    activation_date: record.last_modified_install_date || null,
  };
}

// ============================================================================
// AGGREGATION + DB SYNC
// ============================================================================

function computeOverallStage(agg) {
  const stages = [
    { key: 'activation', ...agg.activation },
    { key: 'atp', ...agg.atp },
    { key: 'optical', ...agg.optical },
    { key: 'cwc', ...agg.cwc },
    { key: 'poles', ...agg.poles },
    { key: 'permissions', ...agg.permissions },
  ];

  const allComplete = stages.every(s => s.total > 0 && s.complete >= s.total);
  if (allComplete) return 'complete';

  for (const s of stages) {
    if (s.total > 0 && s.complete >= s.total) return s.key;
  }

  const anyStarted = stages.some(s => s.complete > 0);
  if (anyStarted) {
    const ordered = [...stages].reverse();
    for (const s of ordered) {
      if (s.complete > 0 && s.complete < s.total) return s.key;
    }
  }

  return 'not_started';
}

function updateDateRange(current, newDate) {
  if (!newDate) return;
  if (!current.firstDate || newDate < current.firstDate) current.firstDate = newDate;
  if (!current.lastDate || newDate > current.lastDate) current.lastDate = newDate;
}

async function main() {
  const startTime = Date.now();

  // Step 1: Auth + fetch from 1Map
  const cookies = await authenticate();
  console.log(`\nFetching all ${SITE} records from 1Map...`);
  const records = await fetchAllRecords(cookies);
  console.log(`\nFetched ${records.length} records total.`);

  // Step 2: Parse stage data
  console.log('Parsing stage data...');
  const parsed = records.map(parseRecord);

  // Step 3: Connect to DB and get DR → zone/pon lookup
  const pool = new Pool({ connectionString: DB_URL });
  const client = await pool.connect();

  try {
    console.log('Loading DR → zone/pon lookup from drops table...');
    const drLookup = new Map();
    const drResult = await client.query(
      `SELECT DISTINCT drop_number, zone_no, pon_no
       FROM drops
       WHERE project_id = $1 AND zone_no IS NOT NULL AND pon_no IS NOT NULL`,
      [PROJECT_ID]
    );
    for (const row of drResult.rows) {
      drLookup.set(row.drop_number, { zone_no: row.zone_no, pon_no: row.pon_no });
    }
    console.log(`  DR lookup: ${drLookup.size} DRs with zone/pon`);

    // Step 4: Get total drops per (zone_no, pon_no) — this is the universal denominator
    console.log('Loading drops totals per PON...');
    const dropsTotalResult = await client.query(
      `SELECT zone_no, pon_no, COUNT(DISTINCT drop_number)::int as total
       FROM drops
       WHERE project_id = $1 AND zone_no IS NOT NULL AND pon_no IS NOT NULL
       GROUP BY zone_no, pon_no`,
      [PROJECT_ID]
    );

    const ponMap = new Map();
    for (const row of dropsTotalResult.rows) {
      const key = `${row.zone_no}-${row.pon_no}`;
      const total = Number(row.total);
      ponMap.set(key, {
        zone_no: row.zone_no,
        pon_no: row.pon_no,
        permissions: { total, complete: 0, firstDate: null, lastDate: null },
        poles: { total, complete: 0, firstDate: null, lastDate: null },
        cwc: { total, complete: 0, firstDate: null, lastDate: null },
        optical: { total, complete: 0, firstDate: null, lastDate: null },
        atp: { total, complete: 0, firstDate: null, lastDate: null },
        activation: { total, complete: 0, firstDate: null, lastDate: null },
      });
    }
    console.log(`  ${ponMap.size} PONs with drops totals`);

    // Step 5: Count completions from 1Map (numerators only — totals already set)
    let unmapped = 0;
    const stageCounts = { permissions: 0, poles: 0, cwc: 0, optical: 0, atp: 0, activation: 0 };

    for (const rec of parsed) {
      const lookup = drLookup.get(rec.dr_number);
      const zoneNo = lookup?.zone_no ?? rec.zone_no;
      const ponNo = lookup?.pon_no;

      if (zoneNo == null || ponNo == null) {
        unmapped++;
        continue;
      }

      const key = `${zoneNo}-${ponNo}`;
      const agg = ponMap.get(key);
      if (!agg) continue; // PON not in drops table

      for (const stage of ['permissions', 'poles', 'cwc', 'optical', 'atp', 'activation']) {
        if (rec.stages[stage]) {
          agg[stage].complete++;
          stageCounts[stage]++;
        }
      }

      // Date ranges
      updateDateRange(agg.permissions, rec.permissions_date);
      updateDateRange(agg.poles, rec.permissions_date);
      updateDateRange(agg.optical, rec.optical_date);
      updateDateRange(agg.activation, rec.activation_date);
    }

    console.log(`\nAggregation complete:`);
    console.log(`  PONs: ${ponMap.size}`);
    console.log(`  Unmapped: ${unmapped}`);
    console.log(`  Stage counts:`, stageCounts);

    // Step 6: Merge OES activation data (complete count + dates only — total already set from drops)
    console.log('\nMerging OES activation data...');
    const oesResult = await client.query(
      `SELECT d.zone_no, d.pon_no,
         COUNT(DISTINCT CASE WHEN oes.activation_date IS NOT NULL THEN d.drop_number END)::int as activated,
         MIN(oes.activation_date)::text as first_date,
         MAX(oes.activation_date)::text as last_date
       FROM drops d
       LEFT JOIN oes_activations oes ON oes.drop_number = d.drop_number
       WHERE d.project_id = $1 AND d.zone_no IS NOT NULL AND d.pon_no IS NOT NULL
       GROUP BY d.zone_no, d.pon_no`,
      [PROJECT_ID]
    );

    let oesUpdated = 0;
    for (const row of oesResult.rows) {
      const key = `${row.zone_no}-${row.pon_no}`;
      const agg = ponMap.get(key);
      if (!agg) continue;

      const activated = Number(row.activated);
      if (activated > 0) {
        agg.activation.complete = activated;
        agg.activation.firstDate = row.first_date;
        agg.activation.lastDate = row.last_date;
        oesUpdated++;
      }
    }
    console.log(`  OES: ${oesUpdated} PONs with activation data`);

    // Step 6: UPSERT into pon_stage_tracking
    console.log(`\nUpserting ${ponMap.size} PONs into pon_stage_tracking...`);
    let upsertCount = 0;

    for (const agg of ponMap.values()) {
      const overallStage = computeOverallStage(agg);

      await client.query(
        `INSERT INTO pon_stage_tracking (
          project_id, zone_no, pon_no,
          permissions_total, permissions_approved, permissions_first_date, permissions_last_date,
          poles_total, poles_planted, poles_first_date, poles_last_date,
          cwc_total, cwc_complete, cwc_first_date, cwc_last_date,
          optical_total, optical_complete, optical_first_date, optical_last_date,
          atp_total, atp_passed, atp_first_date, atp_last_date,
          activation_total, activation_complete, activation_first_date, activation_last_date,
          overall_stage, last_synced_at, sync_source
        ) VALUES (
          $1, $2, $3,
          $4, $5, $6, $7,
          $8, $9, $10, $11,
          $12, $13, $14, $15,
          $16, $17, $18, $19,
          $20, $21, $22, $23,
          $24, $25, $26, $27,
          $28, NOW(), '1map'
        )
        ON CONFLICT (project_id, zone_no, pon_no) DO UPDATE SET
          permissions_total = EXCLUDED.permissions_total,
          permissions_approved = EXCLUDED.permissions_approved,
          permissions_first_date = EXCLUDED.permissions_first_date,
          permissions_last_date = EXCLUDED.permissions_last_date,
          poles_total = EXCLUDED.poles_total,
          poles_planted = EXCLUDED.poles_planted,
          poles_first_date = EXCLUDED.poles_first_date,
          poles_last_date = EXCLUDED.poles_last_date,
          cwc_total = EXCLUDED.cwc_total,
          cwc_complete = EXCLUDED.cwc_complete,
          cwc_first_date = EXCLUDED.cwc_first_date,
          cwc_last_date = EXCLUDED.cwc_last_date,
          optical_total = EXCLUDED.optical_total,
          optical_complete = EXCLUDED.optical_complete,
          optical_first_date = EXCLUDED.optical_first_date,
          optical_last_date = EXCLUDED.optical_last_date,
          atp_total = EXCLUDED.atp_total,
          atp_passed = EXCLUDED.atp_passed,
          atp_first_date = EXCLUDED.atp_first_date,
          atp_last_date = EXCLUDED.atp_last_date,
          activation_total = EXCLUDED.activation_total,
          activation_complete = EXCLUDED.activation_complete,
          activation_first_date = EXCLUDED.activation_first_date,
          activation_last_date = EXCLUDED.activation_last_date,
          overall_stage = EXCLUDED.overall_stage,
          last_synced_at = NOW(),
          sync_source = '1map'`,
        [
          PROJECT_ID, agg.zone_no, agg.pon_no,
          agg.permissions.total, agg.permissions.complete, agg.permissions.firstDate, agg.permissions.lastDate,
          agg.poles.total, agg.poles.complete, agg.poles.firstDate, agg.poles.lastDate,
          agg.cwc.total, agg.cwc.complete, agg.cwc.firstDate, agg.cwc.lastDate,
          agg.optical.total, agg.optical.complete, agg.optical.firstDate, agg.optical.lastDate,
          agg.atp.total, agg.atp.complete, agg.atp.firstDate, agg.atp.lastDate,
          agg.activation.total, agg.activation.complete, agg.activation.firstDate, agg.activation.lastDate,
          overallStage,
        ]
      );
      upsertCount++;
    }

    const durationMs = Date.now() - startTime;

    console.log(`\n${'='.repeat(60)}`);
    console.log(`SYNC COMPLETE`);
    console.log(`${'='.repeat(60)}`);
    console.log(`  Site:              ${SITE}`);
    console.log(`  Records processed: ${records.length}`);
    console.log(`  PONs synced:       ${upsertCount}`);
    console.log(`  Unmapped:          ${unmapped}`);
    console.log(`  Stage counts:`);
    for (const [stage, count] of Object.entries(stageCounts)) {
      console.log(`    ${stage.padEnd(14)} ${count}`);
    }
    console.log(`  Duration:          ${(durationMs / 1000).toFixed(1)}s`);

    // Quick verification
    const verifyResult = await client.query(
      `SELECT overall_stage, COUNT(*) as cnt
       FROM pon_stage_tracking
       WHERE project_id = $1
       GROUP BY overall_stage
       ORDER BY cnt DESC`,
      [PROJECT_ID]
    );
    console.log(`\n  Overall stage distribution:`);
    for (const row of verifyResult.rows) {
      console.log(`    ${row.overall_stage.padEnd(14)} ${row.cnt} PONs`);
    }

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error('SYNC ERROR:', err.message);
  process.exit(1);
});
