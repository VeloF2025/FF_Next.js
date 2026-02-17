/**
 * Standalone 1Map → pon_stage_tracking sync.
 * Dynamically discovers projects with metadata.onemap_prefix set.
 * Runs outside Next.js — directly hits 1Map API + Neon DB.
 *
 * Usage:
 *   node scripts/sync-stages.mjs          # Sync all projects with onemap_prefix
 *   node scripts/sync-stages.mjs MAM      # Sync single site prefix
 *   node scripts/sync-stages.mjs LAW MOH  # Sync specific prefixes
 *
 * New projects: Set metadata.onemap_prefix on the project to include it.
 *   UPDATE projects SET metadata = metadata || '{"onemap_prefix": "TEM"}' WHERE id = '...';
 *
 * Cron (every 4 hours): see crontab on Velocity (velo user)
 */

import pg from 'pg';
const { Pool } = pg;

const BASE_URL = 'https://www.1map.co.za';
const EMAIL = 'hein@velocityfibre.co.za';
const PASSWORD = 'VeloF@2025';

const DB_URL = 'postgresql://neondb_owner:npg_MIUZXrg1tEY0@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require';

// ============================================================================
// 1MAP AUTH + FETCH
// ============================================================================

async function authenticate() {
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

async function fetchAllRecords(cookieStr, site) {
  const allRecords = [];
  let page = 1;

  while (true) {
    const data = await fetchPage(cookieStr, site, page, 500);
    if (!data.result || data.result.length === 0) break;
    allRecords.push(...data.result);

    if (page % 5 === 0 || page >= data.total_pages) {
      log(`  ${site}: page ${page}/${data.total_pages} (${allRecords.length} records)`);
    }

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
    permissions: false, poles: false, cwc: false,
    optical: false, atp: false, activation: false,
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

  const drNumber = record.drp || '';

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
    stages: stageComplete,
    permissions_date: polesDate,
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

function log(msg) {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  console.log(`[${ts}] ${msg}`);
}

async function syncSite(site, projectId, cookieStr, pool, projectName) {
  const startTime = Date.now();
  log(`--- ${site} (${projectName}) ---`);

  // Fetch from 1Map
  const records = await fetchAllRecords(cookieStr, site);
  log(`  ${site}: fetched ${records.length} records from 1Map`);

  if (records.length === 0) {
    log(`  ${site}: no records found, skipping`);
    return null;
  }

  const parsed = records.map(parseRecord);

  const client = await pool.connect();
  try {
    // DR → zone/pon lookup
    const drLookup = new Map();
    const drResult = await client.query(
      `SELECT DISTINCT drop_number, zone_no, pon_no
       FROM drops
       WHERE project_id = $1 AND zone_no IS NOT NULL AND pon_no IS NOT NULL`,
      [projectId]
    );
    for (const row of drResult.rows) {
      drLookup.set(row.drop_number, { zone_no: row.zone_no, pon_no: row.pon_no });
    }
    log(`  ${site}: DR lookup: ${drLookup.size} DRs`);

    // Per-PON totals: poles (for permissions/poles/cwc), joints (for optical), drops (for activation)
    const polesTotalResult = await client.query(
      `SELECT zone_no, pon_no,
         COUNT(DISTINCT pole_number)::int as poles,
         COUNT(DISTINCT drop_number)::int as drops
       FROM drops
       WHERE project_id = $1 AND zone_no IS NOT NULL AND pon_no IS NOT NULL
       GROUP BY zone_no, pon_no`,
      [projectId]
    );

    const jointsTotalResult = await client.query(
      `SELECT zone_no, pon_no, COUNT(*)::int as joints
       FROM joints
       WHERE project_id = $1 AND zone_no IS NOT NULL AND pon_no IS NOT NULL
       GROUP BY zone_no, pon_no`,
      [projectId]
    );
    const jointsMap = new Map();
    for (const row of jointsTotalResult.rows) {
      jointsMap.set(`${row.zone_no}-${row.pon_no}`, Number(row.joints));
    }

    const ponMap = new Map();
    for (const row of polesTotalResult.rows) {
      const key = `${row.zone_no}-${row.pon_no}`;
      const polesTotal = Number(row.poles);
      const dropsTotal = Number(row.drops);
      const jointsTotal = jointsMap.get(key) || 0;
      ponMap.set(key, {
        zone_no: row.zone_no, pon_no: row.pon_no,
        permissions: { total: polesTotal, complete: 0, firstDate: null, lastDate: null },
        poles:       { total: polesTotal, complete: 0, firstDate: null, lastDate: null },
        cwc:         { total: polesTotal, complete: 0, firstDate: null, lastDate: null },
        optical:     { total: jointsTotal, complete: 0, firstDate: null, lastDate: null },
        atp:         { total: jointsTotal, complete: 0, firstDate: null, lastDate: null },
        activation:  { total: dropsTotal, complete: 0, firstDate: null, lastDate: null },
      });
    }

    if (ponMap.size === 0) {
      log(`  ${site}: no PONs in drops table, skipping`);
      return null;
    }

    // Count 1Map stages (permissions only — poles/cwc/activation come from DB below)
    // Collect permitted DRs to convert to pole count after loop
    let unmapped = 0;
    const stageCounts = { permissions: 0, poles: 0, cwc: 0, optical: 0, atp: 0, activation: 0 };
    const permittedDRs = new Set(); // all DRs with permission approved
    const counted = new Map(); // key -> { permissions: Set }

    for (const rec of parsed) {
      const lookup = drLookup.get(rec.dr_number);
      const zoneNo = lookup?.zone_no ?? rec.zone_no;
      const ponNo = lookup?.pon_no;

      if (zoneNo == null || ponNo == null) { unmapped++; continue; }

      const key = `${zoneNo}-${ponNo}`;
      const agg = ponMap.get(key);
      if (!agg) continue;

      if (!counted.has(key)) {
        counted.set(key, { permissions: new Set() });
      }
      const sets = counted.get(key);

      // Permissions from 1Map: track DRs, convert to pole count below
      if (rec.stages.permissions && rec.dr_number && !sets.permissions.has(rec.dr_number)) {
        sets.permissions.add(rec.dr_number);
        permittedDRs.add(rec.dr_number);
      }

      updateDateRange(agg.permissions, rec.permissions_date);
    }

    // Convert permitted DRs → distinct poles per PON
    if (permittedDRs.size > 0) {
      const permResult = await client.query(
        `SELECT zone_no, pon_no, COUNT(DISTINCT pole_number)::int as permitted_poles
         FROM drops
         WHERE project_id = $1
           AND zone_no IS NOT NULL AND pon_no IS NOT NULL
           AND drop_number = ANY($2::text[])
         GROUP BY zone_no, pon_no`,
        [projectId, [...permittedDRs]]
      );
      for (const row of permResult.rows) {
        const key = `${row.zone_no}-${row.pon_no}`;
        const agg = ponMap.get(key);
        if (!agg) continue;
        const poles = Number(row.permitted_poles);
        agg.permissions.complete = poles;
        stageCounts.permissions += poles;
      }
    }

    // Merge poles planted + CWC + activation from DB (QField + OES)
    // Poles planted = distinct POLES where pole_planted='Pole Planted' OR any DR on pole activated
    // CWC = distinct POLES where audit_complete IS NOT NULL (pole passed QA)
    // Activation = distinct DROPS where OES activation_date IS NOT NULL
    const dbStagesResult = await client.query(
      `SELECT d.zone_no, d.pon_no,
         COUNT(DISTINCT CASE WHEN p.pole_planted = 'Pole Planted' OR oes.activation_date IS NOT NULL THEN d.pole_number END)::int as poles_planted,
         COUNT(DISTINCT CASE WHEN p.audit_complete IS NOT NULL THEN d.pole_number END)::int as cwc_complete,
         MIN(p.audit_complete)::text as cwc_first_date,
         MAX(p.audit_complete)::text as cwc_last_date,
         COUNT(DISTINCT CASE WHEN oes.activation_date IS NOT NULL THEN d.drop_number END)::int as activated,
         MIN(oes.activation_date)::text as act_first_date,
         MAX(oes.activation_date)::text as act_last_date
       FROM drops d
       LEFT JOIN poles p ON p.pole_number = d.pole_number AND p.project_id = d.project_id
       LEFT JOIN oes_activations oes ON oes.drop_number = d.drop_number
       WHERE d.project_id = $1 AND d.zone_no IS NOT NULL AND d.pon_no IS NOT NULL
       GROUP BY d.zone_no, d.pon_no`,
      [projectId]
    );

    for (const row of dbStagesResult.rows) {
      const key = `${row.zone_no}-${row.pon_no}`;
      const agg = ponMap.get(key);
      if (!agg) continue;

      // Poles planted (QField + OES activation implies planted)
      const planted = Number(row.poles_planted);
      if (planted > 0) {
        agg.poles.complete = planted;
        stageCounts.poles += planted;
      }

      // CWC (QField audit_complete)
      const cwc = Number(row.cwc_complete);
      if (cwc > 0) {
        agg.cwc.complete = cwc;
        agg.cwc.firstDate = row.cwc_first_date;
        agg.cwc.lastDate = row.cwc_last_date;
        stageCounts.cwc += cwc;
      }

      // Activation (OES)
      const activated = Number(row.activated);
      if (activated > 0) {
        agg.activation.complete = activated;
        agg.activation.firstDate = row.act_first_date;
        agg.activation.lastDate = row.act_last_date;
        stageCounts.activation += activated;
      }
    }

    // UPSERT into pon_stage_tracking
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
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
          $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23,
          $24, $25, $26, $27, $28, NOW(), '1map'
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
          projectId, agg.zone_no, agg.pon_no,
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

    const durationS = ((Date.now() - startTime) / 1000).toFixed(1);
    log(`  ${site}: ${upsertCount} PONs synced, ${unmapped} unmapped, ${durationS}s`);
    log(`  ${site}: stages — perm:${stageCounts.permissions} poles:${stageCounts.poles} cwc:${stageCounts.cwc} opt:${stageCounts.optical} act:${stageCounts.activation}`);

    return { site, records: records.length, pons: upsertCount, unmapped, duration: durationS, stageCounts };
  } finally {
    client.release();
  }
}

// ============================================================================
// MAIN — discovers projects dynamically from DB
// ============================================================================

async function discoverProjects(pool, filterPrefixes) {
  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT id, project_name, metadata->>'onemap_prefix' as prefix
      FROM projects
      WHERE status = 'active'
        AND metadata->>'onemap_prefix' IS NOT NULL
      ORDER BY project_name
    `);

    let projects = result.rows.map(r => ({
      uuid: r.id,
      name: r.project_name,
      prefix: r.prefix,
    }));

    // Filter to specific prefixes if provided via CLI args
    if (filterPrefixes.length > 0) {
      projects = projects.filter(p => filterPrefixes.includes(p.prefix.toUpperCase()));
    }

    return projects;
  } finally {
    client.release();
  }
}

async function main() {
  const args = process.argv.slice(2).map(s => s.toUpperCase());

  const totalStart = Date.now();
  const pool = new Pool({ connectionString: DB_URL });

  try {
    // Discover projects from DB
    const projects = await discoverProjects(pool, args);

    if (projects.length === 0) {
      log('No projects found with onemap_prefix set. Set metadata.onemap_prefix on projects to enable sync.');
      process.exit(0);
    }

    log(`=== Stage Sync Starting: ${projects.map(p => `${p.prefix} (${p.name})`).join(', ')} ===`);

    // Authenticate once, reuse for all sites
    log('Authenticating with 1Map...');
    const cookieStr = await authenticate();
    log('Authenticated OK');

    const results = [];

    for (const project of projects) {
      try {
        const result = await syncSite(project.prefix, project.uuid, cookieStr, pool, project.name);
        if (result) results.push(result);
      } catch (err) {
        log(`  ${project.prefix}: ERROR — ${err.message}`);
      }
    }

    const totalDuration = ((Date.now() - totalStart) / 1000).toFixed(1);
    log(`=== Stage Sync Complete: ${results.length}/${projects.length} projects, ${totalDuration}s total ===`);

    for (const r of results) {
      log(`  ${r.site}: ${r.records} records → ${r.pons} PONs (${r.duration}s)`);
    }
  } finally {
    await pool.end();
  }
}

main().catch(err => {
  log(`FATAL: ${err.message}`);
  process.exit(1);
});
