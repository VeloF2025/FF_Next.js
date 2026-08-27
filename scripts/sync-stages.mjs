/**
 * Standalone 1Map → pon_stage_tracking sync.
 * Dynamically discovers projects with metadata.onemap_prefix or
 * metadata.stage_tracking = 'sow' set.
 * Runs outside Next.js — directly hits 1Map API + Neon DB.
 *
 * Usage:
 *   node scripts/sync-stages.mjs          # Sync every opted-in project
 *   node scripts/sync-stages.mjs MAM      # Sync single site prefix
 *   node scripts/sync-stages.mjs LAW MOA  # Sync specific prefixes
 *   node scripts/sync-stages.mjs SOW      # Sync only the SOW-tracked projects
 *
 * Opting a project in — either of:
 *   1Map-backed (a prefix may be shared by several projects; each is synced from
 *   the same sweep, attributing records through its own drops lookup):
 *     UPDATE projects SET metadata = metadata || '{"onemap_prefix": "TEM"}' WHERE id = '...';
 *   SOW-only (no 1Map presence — totals plus the DB-derived stages; permissions
 *   stays at zero):
 *     UPDATE projects SET metadata = metadata || '{"stage_tracking": "sow"}' WHERE id = '...';
 *
 * Cron (every 4 hours): see crontab on Velocity (velo user)
 */

import { config } from 'dotenv';
import pg from 'pg';
import { authenticate, fetchAllRecords, summariseSites } from './lib/onemap-client.mjs';
import { upsertProperties } from './lib/onemap-property-sync.mjs';
import { discoverProjects, SOW_SITE_CODE, syncSourceFor } from './lib/sync-stages-discovery.mjs';
import { applyPoleFallback, shouldUsePolesTable } from './lib/sync-stages-poles.mjs';
// Load both: prod keeps DATABASE_URL in .env and ONEMAP_PASSWORD in .env.local
// (.env.local wins for overlapping keys). On the workstation .env.local has both.
config({ path: ['.env.local', '.env'] });
const { Pool } = pg;

// Env-only config (issue #2029 — no hardcoded creds, no retired Neon URL).
const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) throw new Error('DATABASE_URL not set');

// 1Map site codes swept into onemap_properties (flat, property-keyed). A code
// shared by several projects (TEM = Thembisa POP 1 + POP 3) drives stage tracking
// for every one of them off the same sweep.
//
// These are free-text `q=` searches, NOT a site filter — a code only reaches its
// properties while 1Map's own site string still starts with it. Mohadin was `MOH`
// until 2026-07-27, when 1Map re-coded its site value to `MOA`: `q=MOH` stopped
// matching and the sweep silently fell 24,411 -> 1,613 records (all of them
// incidental matches from unrelated sites), stranding 15,162 drops without a
// contact number for three days. Hence the site histogram logged per sweep below.
//
// A code here only drives pon_stage_tracking when some project carries it in
// `metadata.onemap_prefix` (see scripts/lib/sync-stages-discovery.mjs); otherwise
// the sweep refreshes onemap_properties and skips stage tracking. So renaming a code here without
// repointing that column does not corrupt anything — it stops stage tracking for
// that project until the column follows. Mohadin's `projects.metadata.onemap_prefix`
// row was repointed to `MOA` in the database on 2026-07-30, so the pair is in step.
//
// `MOH` is deliberately gone rather than kept alongside `MOA`: it now returns only
// ~1,613 records from sites that were never in this list (NYA, KAT, IVO, SOS, …),
// which were being mirrored purely as a side effect of the stale query. They go
// stale rather than disappear.
//
// Two other maps key off the same 1Map query and must be kept in step:
// SITE_PROJECT_MAP in src/services/onemap/oneMapClient.ts and in
// scripts/onemap-sync/fetch-gps-from-1map.ts.
const ALL_SITE_CODES = ['LAW', 'MAM', 'MOA', 'TEM', 'ETW'];

// onemap_properties is keyed by (import_id, property_id). Recurring syncs reuse ONE
// "live API" import row so upserts are idempotent and don't bloat the table; the old
// NULL-import rows are left untouched.
const LIVE_IMPORT_FILENAME = 'live-1map-api-sync';

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

// ============================================================================
// onemap_properties UPSERT (flat, current 1Map snapshot per property)
// ============================================================================

/** Get-or-create the single "live API sync" onemap_imports row; returns its id. */
async function ensureLiveImport(client) {
  // onemap_imports.filename has no UNIQUE constraint, so a bare SELECT→INSERT
  // could race two concurrent runs into duplicate live-sync rows. Serialise
  // with a session advisory lock (no schema migration needed).
  await client.query(`SELECT pg_advisory_lock(hashtext($1))`, [LIVE_IMPORT_FILENAME]);
  try {
    const found = await client.query(
      `SELECT id FROM onemap_imports WHERE filename = $1 ORDER BY id LIMIT 1`,
      [LIVE_IMPORT_FILENAME],
    );
    if (found.rows[0]) return found.rows[0].id;
    const created = await client.query(
      `INSERT INTO onemap_imports (filename, status, imported_by, created_at)
       VALUES ($1, 'completed', 'sync-stages', NOW()) RETURNING id`,
      [LIVE_IMPORT_FILENAME],
    );
    return created.rows[0].id;
  } finally {
    await client.query(`SELECT pg_advisory_unlock(hashtext($1))`, [LIVE_IMPORT_FILENAME]);
  }
}

async function syncSite(site, projectId, pool, projectName, records) {
  const startTime = Date.now();
  log(`  ${site}: stage tracking (${projectName})`);

  const syncSource = syncSourceFor(site);

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
      // Use joints count for optical/atp; fall back to poles if joints lack pon_no
      const jointsTotal = jointsMap.get(key) || polesTotal;
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

    // Pole scope/progress from `poles` when not one drop carries a pole link
    // (Thembisa POP 1 + POP 3, Themb'elihle). Per project, never per PON — see
    // scripts/lib/sync-stages-poles.mjs for why blending the sources over-counts.
    // "Planted" here is QField only: OES activation implies a planted pole, but
    // without the drop→pole link that inference is unavailable for these projects.
    let poleFallback = { pons: 0, planted: 0, cwc: 0 };
    const usePolesTable = shouldUsePolesTable(polesTotalResult.rows);
    if (usePolesTable) {
      const polesTableResult = await client.query(
        `SELECT zone_no, pon_no,
           COUNT(DISTINCT pole_number)::int as poles,
           COUNT(DISTINCT CASE WHEN pole_planted = 'Pole Planted' THEN pole_number END)::int as planted,
           COUNT(DISTINCT CASE WHEN audit_complete IS NOT NULL THEN pole_number END)::int as cwc,
           MIN(audit_complete)::text as cwc_first,
           MAX(audit_complete)::text as cwc_last
         FROM poles
         WHERE project_id = $1 AND zone_no IS NOT NULL AND pon_no IS NOT NULL
         GROUP BY zone_no, pon_no`,
        [projectId]
      );
      poleFallback = applyPoleFallback(ponMap, polesTableResult.rows);
      log(`  ${site}: pole counts from poles table (drops carry no pole link) — ${poleFallback.pons} PONs; OES-implied planted not counted`);
    }

    // Count 1Map stages (permissions only — poles/cwc/activation come from DB below)
    // Collect permitted DRs to convert to pole count after loop
    let unmapped = 0;
    const stageCounts = {
      permissions: 0, poles: poleFallback.planted, cwc: poleFallback.cwc,
      optical: 0, atp: 0, activation: 0,
    };
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
      // Skipped entirely when shouldUsePolesTable() picked the poles table as the
      // source: one source per project, so a future partial drops.pole_number
      // backfill cannot start blending the two per PON.
      const planted = usePolesTable ? 0 : Number(row.poles_planted);
      if (planted > 0) {
        agg.poles.complete = planted;
        stageCounts.poles += planted;
      }

      // CWC (QField audit_complete)
      const cwc = usePolesTable ? 0 : Number(row.cwc_complete);
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
          $24, $25, $26, $27, $28, NOW(), $29
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
          sync_source = EXCLUDED.sync_source`,
        [
          projectId, agg.zone_no, agg.pon_no,
          agg.permissions.total, agg.permissions.complete, agg.permissions.firstDate, agg.permissions.lastDate,
          agg.poles.total, agg.poles.complete, agg.poles.firstDate, agg.poles.lastDate,
          agg.cwc.total, agg.cwc.complete, agg.cwc.firstDate, agg.cwc.lastDate,
          agg.optical.total, agg.optical.complete, agg.optical.firstDate, agg.optical.lastDate,
          agg.atp.total, agg.atp.complete, agg.atp.firstDate, agg.atp.lastDate,
          agg.activation.total, agg.activation.complete, agg.activation.firstDate, agg.activation.lastDate,
          overallStage, syncSource,
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

async function main() {
  const args = process.argv.slice(2).map(s => s.toUpperCase());
  const sites = args.length > 0 ? ALL_SITE_CODES.filter(s => args.includes(s)) : ALL_SITE_CODES;

  const totalStart = Date.now();
  const pool = new Pool({ connectionString: DB_URL });

  try {
    // prefix → every project carrying it (for pon_stage_tracking), plus the
    // projects tracked from the SOW alone.
    const { byPrefix, sowOnly } = await discoverProjects(pool, args);

    log(`=== 1Map Sync Starting: ${sites.join(', ')} ===`);

    let totalProps = 0;
    let stagedProjects = 0;
    let onemapError = null;

    // The 1Map half — auth, the live-import row, and the per-site sweep — is
    // isolated from the SOW pass below, which needs no 1Map at all. An auth
    // failure used to abort the whole run and silently skip the SOW projects.
    // The failure still reaches cron via the non-zero exit at the end.
    try {
      log('Authenticating with 1Map...');
      const cookieStr = await authenticate();
      log('Authenticated OK');

      const client = await pool.connect();
      let liveImportId;
      try {
        liveImportId = await ensureLiveImport(client);
      } finally {
        client.release();
      }

      for (const site of sites) {
        try {
          const records = await fetchAllRecords(cookieStr, site, (q, page, total, n) =>
            log(`  ${q}: page ${page}/${Math.ceil(total)} (${n} records)`));
          log(`  ${site}: fetched ${records.length} records from 1Map`);
          // Which sites did this free-text query actually reach? A code whose own
          // site has drifted still returns incidental matches from elsewhere, so
          // the record count alone looks merely low rather than wrong. Printing
          // the histogram makes that visible in the log the next time it happens.
          log(`  ${site}: sites returned — ${summariseSites(records)}`);
          if (records.length === 0) continue;

          // Always: refresh the flat onemap_properties snapshot.
          const propClient = await pool.connect();
          try {
            const n = await upsertProperties(propClient, records, liveImportId);
            totalProps += n;
            log(`  ${site}: upserted ${n} onemap_properties rows`);
          } finally {
            propClient.release();
          }

          // Every project on this prefix → refresh pon_stage_tracking from the
          // same records; each attributes them through its own drops lookup.
          const staged = byPrefix.get(site) ?? [];
          if (staged.length === 0) {
            log(`  ${site}: no project carries this prefix — onemap_properties only (no stage tracking)`);
          } else {
            log(`  ${site}: stage tracking for ${staged.length} project(s)`);
            for (const project of staged) {
              if (await syncSite(site, project.uuid, pool, project.name, records)) stagedProjects++;
            }
          }
        } catch (err) {
          log(`  ${site}: ERROR — ${err.message}`);
        }
      }
    } catch (err) {
      onemapError = err;
      log(`1Map sweep FAILED — ${err.message} (continuing with SOW-only projects)`);
    }

    // SOW-only projects: no 1Map records at all, so totals and the DB-derived
    // stages carry the tracking and permissions stays at zero.
    for (const project of sowOnly) {
      try {
        if (await syncSite(SOW_SITE_CODE, project.uuid, pool, project.name, [])) stagedProjects++;
      } catch (err) {
        log(`  ${SOW_SITE_CODE}: ${project.name}: ERROR — ${err.message}`);
      }
    }

    const totalDuration = ((Date.now() - totalStart) / 1000).toFixed(1);
    log(`=== 1Map Sync Complete: ${totalProps} properties upserted, ${stagedProjects} projects staged, ${totalDuration}s total ===`);

    // Rethrow after the SOW pass so the run still exits non-zero for cron; the
    // finally below closes the pool and main()'s own catch logs FATAL.
    if (onemapError) {
      log('=== 1Map half failed — exiting non-zero ===');
      throw onemapError;
    }
  } finally {
    await pool.end();
  }
}

main().catch(err => {
  log(`FATAL: ${err.message}`);
  process.exit(1);
});
