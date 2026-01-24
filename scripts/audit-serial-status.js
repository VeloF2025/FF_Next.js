/**
 * Serial Status Audit Script
 *
 * Compares ONT/UPS serials in database vs 1Map API
 * Generates report of mismatches, missing data, and swaps
 *
 * Usage: node scripts/audit-serial-status.js [--limit N] [--project NAME]
 */

const { Pool } = require('pg');

const ONEMAP_API = 'http://100.96.203.105:8003/api/record';
const DATABASE_URL = process.env.DATABASE_URL ||
  'postgresql://neondb_owner:npg_MIUZXrg1tEY0@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require';

const pool = new Pool({ connectionString: DATABASE_URL });

// Parse args
const args = process.argv.slice(2);
const limitIdx = args.indexOf('--limit');
const projectIdx = args.indexOf('--project');
const LIMIT = limitIdx >= 0 ? parseInt(args[limitIdx + 1]) : 100;
const PROJECT = projectIdx >= 0 ? args[projectIdx + 1] : null;

async function fetchFromOneMap(drNumber) {
  try {
    const response = await fetch(`${ONEMAP_API}/${drNumber}`, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(10000)
    });

    if (!response.ok) {
      return { error: `HTTP ${response.status}` };
    }

    const data = await response.json();
    return {
      ont_serial: data.ont_barcode || null,
      ups_serial: data.ups_serial || null,
      photo_count: data.photos?.length || 0
    };
  } catch (err) {
    return { error: err.message };
  }
}

function detectSwap(ont, ups) {
  // ONT pattern: ALCL* or ALCB*
  // UPS pattern: GU18W*
  const isOntInUpsField = ups?.match(/^ALC[LB]/i);
  const isUpsInOntField = ont?.match(/^GU18W/i);

  if (isOntInUpsField || isUpsInOntField) {
    return {
      swapped: true,
      details: `ONT field has ${ont || 'NULL'}, UPS field has ${ups || 'NULL'}`
    };
  }
  return { swapped: false };
}

async function runAudit() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║              SERIAL STATUS AUDIT REPORT                       ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  // 1. Get DB summary
  const dbSummary = await pool.query(`
    SELECT
      COUNT(*) as total_drs,
      COUNT(ont_serial_scanned) as with_ont,
      COUNT(ups_serial_scanned) as with_ups,
      COUNT(CASE WHEN ont_serial_scanned IS NOT NULL AND ups_serial_scanned IS NOT NULL THEN 1 END) as with_both,
      COUNT(CASE WHEN serial_swap_detected = true THEN 1 END) as swaps_flagged
    FROM dr_photo_unified_reviews
  `);

  const summary = dbSummary.rows[0];
  console.log('=== DATABASE SUMMARY ===');
  console.log(`Total DRs:              ${summary.total_drs}`);
  console.log(`With ONT serial:        ${summary.with_ont}`);
  console.log(`With UPS serial:        ${summary.with_ups}`);
  console.log(`With both serials:      ${summary.with_both}`);
  console.log(`Swaps already flagged:  ${summary.swaps_flagged}\n`);

  // 2. Get DRs to audit
  let projectFilter = '';
  let params = [LIMIT];

  if (PROJECT) {
    projectFilter = 'AND project = $2';
    params.push(PROJECT);
  }

  const drsToAudit = await pool.query(`
    SELECT drop_number, ont_serial_scanned as db_ont, ups_serial_scanned as db_ups,
           serial_swap_detected, project, created_at
    FROM dr_photo_unified_reviews
    WHERE (ont_serial_scanned IS NOT NULL OR ups_serial_scanned IS NOT NULL)
    ${projectFilter}
    ORDER BY created_at DESC
    LIMIT $1
  `, params);

  console.log(`=== AUDITING ${drsToAudit.rows.length} DRs (limit: ${LIMIT}${PROJECT ? `, project: ${PROJECT}` : ''}) ===\n`);

  // 3. Compare each DR with 1Map
  const results = {
    matched: [],
    ont_mismatch: [],
    ups_mismatch: [],
    both_mismatch: [],
    missing_in_1map: [],
    swap_detected: [],
    errors: []
  };

  let processed = 0;
  for (const dr of drsToAudit.rows) {
    const oneMapData = await fetchFromOneMap(dr.drop_number);
    processed++;

    if (processed % 20 === 0) {
      process.stdout.write(`Processing: ${processed}/${drsToAudit.rows.length}\r`);
    }

    if (oneMapData.error) {
      results.errors.push({ ...dr, error: oneMapData.error });
      continue;
    }

    if (!oneMapData.ont_serial && !oneMapData.ups_serial) {
      results.missing_in_1map.push(dr);
      continue;
    }

    // Check for swaps in 1Map data
    const swapCheck = detectSwap(oneMapData.ont_serial, oneMapData.ups_serial);
    if (swapCheck.swapped) {
      results.swap_detected.push({ ...dr, onemap: oneMapData, swap: swapCheck });
    }

    // Compare serials
    const ontMatch = dr.db_ont === oneMapData.ont_serial;
    const upsMatch = dr.db_ups === oneMapData.ups_serial;

    if (ontMatch && upsMatch) {
      results.matched.push(dr);
    } else if (!ontMatch && !upsMatch) {
      results.both_mismatch.push({
        ...dr,
        onemap_ont: oneMapData.ont_serial,
        onemap_ups: oneMapData.ups_serial
      });
    } else if (!ontMatch) {
      results.ont_mismatch.push({
        ...dr,
        onemap_ont: oneMapData.ont_serial
      });
    } else {
      results.ups_mismatch.push({
        ...dr,
        onemap_ups: oneMapData.ups_serial
      });
    }

    // Small delay to not hammer the API
    await new Promise(r => setTimeout(r, 50));
  }

  console.log('\n\n=== AUDIT RESULTS ===');
  console.log(`✅ Matched (DB = 1Map):      ${results.matched.length}`);
  console.log(`⚠️  ONT mismatch only:        ${results.ont_mismatch.length}`);
  console.log(`⚠️  UPS mismatch only:        ${results.ups_mismatch.length}`);
  console.log(`❌ Both serials mismatch:    ${results.both_mismatch.length}`);
  console.log(`📭 Missing in 1Map:          ${results.missing_in_1map.length}`);
  console.log(`🔄 Swaps detected in 1Map:   ${results.swap_detected.length}`);
  console.log(`💥 Errors:                   ${results.errors.length}`);

  // 4. Show mismatches details
  if (results.ont_mismatch.length > 0 || results.ups_mismatch.length > 0 || results.both_mismatch.length > 0) {
    console.log('\n=== MISMATCH DETAILS ===');

    const allMismatches = [
      ...results.ont_mismatch.map(m => ({ ...m, type: 'ONT' })),
      ...results.ups_mismatch.map(m => ({ ...m, type: 'UPS' })),
      ...results.both_mismatch.map(m => ({ ...m, type: 'BOTH' }))
    ].slice(0, 20);

    allMismatches.forEach(m => {
      console.log(`\n${m.drop_number} [${m.type}] (${m.project})`);
      if (m.type === 'ONT' || m.type === 'BOTH') {
        console.log(`  ONT: DB=${m.db_ont || 'NULL'} vs 1Map=${m.onemap_ont || 'NULL'}`);
      }
      if (m.type === 'UPS' || m.type === 'BOTH') {
        console.log(`  UPS: DB=${m.db_ups || 'NULL'} vs 1Map=${m.onemap_ups || 'NULL'}`);
      }
    });

    if (results.ont_mismatch.length + results.ups_mismatch.length + results.both_mismatch.length > 20) {
      console.log(`\n... and ${results.ont_mismatch.length + results.ups_mismatch.length + results.both_mismatch.length - 20} more`);
    }
  }

  // 5. Show swaps
  if (results.swap_detected.length > 0) {
    console.log('\n=== SWAP DETAILS ===');
    results.swap_detected.slice(0, 10).forEach(s => {
      console.log(`${s.drop_number}: ${s.swap.details}`);
    });
  }

  // 6. Summary by project
  console.log('\n=== BY PROJECT ===');
  const byProject = {};
  [...results.matched, ...results.ont_mismatch, ...results.ups_mismatch, ...results.both_mismatch].forEach(r => {
    const proj = r.project || 'Unknown';
    if (!byProject[proj]) byProject[proj] = { total: 0, matched: 0, mismatch: 0 };
    byProject[proj].total++;
    if (results.matched.includes(r)) byProject[proj].matched++;
    else byProject[proj].mismatch++;
  });

  Object.entries(byProject).sort((a,b) => b[1].total - a[1].total).forEach(([proj, stats]) => {
    const matchRate = ((stats.matched / stats.total) * 100).toFixed(1);
    console.log(`${proj}: ${stats.total} audited, ${stats.matched} matched (${matchRate}%), ${stats.mismatch} mismatch`);
  });

  console.log('\n=== AUDIT COMPLETE ===');

  await pool.end();
}

runAudit().catch(err => {
  console.error('Audit failed:', err);
  process.exit(1);
});
