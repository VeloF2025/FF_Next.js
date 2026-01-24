#!/usr/bin/env node
/**
 * Serial Status Audit Script
 *
 * Phase 0 of the 4-way serial verification plan.
 * Generates a comprehensive report of current ONT/UPS serial status across all DRs.
 *
 * Compares serials from:
 * 1. OES - Original activation record
 * 2. Offline - Offline device reports
 * 3. OneMap - 1Map database (scanned barcodes)
 * 4. WA Photo - VLM extracted from WhatsApp submissions
 *
 * Usage:
 *   DATABASE_URL='...' node scripts/audit-serial-status.js [--project PROJECT_NAME] [--output csv|json]
 */

const { neon } = require('@neondatabase/serverless');

// Parse command line arguments
const args = process.argv.slice(2);
const projectFilter = args.includes('--project') ? args[args.indexOf('--project') + 1] : null;
const outputFormat = args.includes('--output') ? args[args.indexOf('--output') + 1] : 'summary';

const DATABASE_URL = process.env.DATABASE_URL ||
  'postgresql://neondb_owner:npg_MIUZXrg1tEY0@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require';

const sql = neon(DATABASE_URL);

async function runAudit() {
  try {
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║           SERIAL STATUS AUDIT REPORT                         ║');
    console.log('║           Phase 0: Discovery & Analysis                      ║');
    console.log('╚══════════════════════════════════════════════════════════════╝\n');
    console.log(`Timestamp: ${new Date().toISOString()}`);
    console.log(`Database: Production\n`);

    // 1. Get all DRs with serial data from all sources
    const rows = await sql`
      WITH onemap_serials AS (
        SELECT
          drop_number,
          ont_serial_scanned as onemap_ont,
          ups_serial_scanned as onemap_ups,
          project as project_name,
          updated_at
        FROM dr_photo_unified_reviews
        WHERE ont_serial_scanned IS NOT NULL OR ups_serial_scanned IS NOT NULL
      ),
      oes_serials AS (
        SELECT
          drop_number,
          serial_number as oes_ont
        FROM oes_activations
        WHERE serial_number IS NOT NULL
      ),
      offline_serials AS (
        SELECT
          drop_number,
          serial_number as offline_ont
        FROM offline_devices
        WHERE serial_number IS NOT NULL
      ),
      wa_serials AS (
        SELECT DISTINCT ON (drop_number)
          drop_number,
          vlm_ont_serial as wa_ont,
          vlm_ups_serial as wa_ups,
          vlm_confidence as wa_confidence,
          vlm_processed
        FROM wa_photos
        WHERE purpose = 'activation'
          AND (vlm_ont_serial IS NOT NULL OR vlm_ups_serial IS NOT NULL)
        ORDER BY drop_number, vlm_confidence DESC NULLS LAST, message_timestamp DESC
      ),
      all_drs AS (
        SELECT drop_number FROM onemap_serials
        UNION SELECT drop_number FROM oes_serials
        UNION SELECT drop_number FROM offline_serials
        UNION SELECT drop_number FROM wa_serials
      )
      SELECT
        a.drop_number,
        COALESCE(om.project_name, r.project) as project_name,
        om.onemap_ont,
        om.onemap_ups,
        oes.oes_ont,
        off.offline_ont,
        wa.wa_ont,
        wa.wa_ups,
        wa.wa_confidence,
        wa.vlm_processed as wa_vlm_processed
      FROM all_drs a
      LEFT JOIN onemap_serials om ON a.drop_number = om.drop_number
      LEFT JOIN oes_serials oes ON a.drop_number = oes.drop_number
      LEFT JOIN offline_serials off ON a.drop_number = off.drop_number
      LEFT JOIN wa_serials wa ON a.drop_number = wa.drop_number
      LEFT JOIN dr_photo_unified_reviews r ON a.drop_number = r.drop_number
      ORDER BY a.drop_number
    `;

    console.log('Total DRs with serial data:', rows.length, '\n');

    // 2. Analyze the data
    const stats = {
      total: rows.length || 1,
      withOesOnt: 0,
      withOfflineOnt: 0,
      withOnemapOnt: 0,
      withOnemapUps: 0,
      withWaOnt: 0,
      withWaUps: 0,
      waVlmProcessed: 0,
      ontAllMatch: 0,
      ontPartialMatch: 0,
      ontMismatch: 0,
      ontNoComparison: 0,
      oesVsOnemapMismatch: 0,
      offlineVsOnemapMismatch: 0,
      waVsOnemapMismatch: 0,
      byProject: {}
    };

    const mismatches = [];
    const missing = [];

    for (const row of rows) {
      if (row.oes_ont) stats.withOesOnt++;
      if (row.offline_ont) stats.withOfflineOnt++;
      if (row.onemap_ont) stats.withOnemapOnt++;
      if (row.onemap_ups) stats.withOnemapUps++;
      if (row.wa_ont) stats.withWaOnt++;
      if (row.wa_ups) stats.withWaUps++;
      if (row.wa_vlm_processed) stats.waVlmProcessed++;

      const normalize = (s) => s ? s.trim().toUpperCase() : null;
      const oesOnt = normalize(row.oes_ont);
      const offlineOnt = normalize(row.offline_ont);
      const onemapOnt = normalize(row.onemap_ont);
      const waOnt = normalize(row.wa_ont);

      const ontSources = [
        { source: 'OES', value: oesOnt },
        { source: 'Offline', value: offlineOnt },
        { source: 'OneMap', value: onemapOnt },
        { source: 'WA', value: waOnt }
      ].filter(s => s.value);

      if (ontSources.length <= 1) {
        stats.ontNoComparison++;
      } else {
        const unique = [...new Set(ontSources.map(s => s.value))];
        if (unique.length === 1) {
          stats.ontAllMatch++;
        } else {
          const mismatchInfo = {
            dropNumber: row.drop_number,
            project: row.project_name || 'Unknown',
            sources: ontSources,
            unique: unique
          };

          if (oesOnt && onemapOnt && oesOnt !== onemapOnt) {
            stats.oesVsOnemapMismatch++;
            mismatchInfo.type = 'OES vs OneMap';
          }
          if (offlineOnt && onemapOnt && offlineOnt !== onemapOnt) {
            stats.offlineVsOnemapMismatch++;
            mismatchInfo.type = mismatchInfo.type ? mismatchInfo.type + ', Offline vs OneMap' : 'Offline vs OneMap';
          }
          if (waOnt && onemapOnt && waOnt !== onemapOnt) {
            stats.waVsOnemapMismatch++;
            mismatchInfo.type = mismatchInfo.type ? mismatchInfo.type + ', WA vs OneMap' : 'WA vs OneMap';
          }

          if (unique.length === ontSources.length) {
            stats.ontMismatch++;
          } else {
            stats.ontPartialMatch++;
          }
          mismatches.push(mismatchInfo);
        }
      }

      const projectName = row.project_name || 'Unknown';
      if (!stats.byProject[projectName]) {
        stats.byProject[projectName] = { total: 0, mismatches: 0, missing: 0 };
      }
      stats.byProject[projectName].total++;

      if (!onemapOnt && (oesOnt || offlineOnt)) {
        missing.push({
          dropNumber: row.drop_number,
          project: projectName,
          hasOes: !!oesOnt,
          hasOffline: !!offlineOnt,
          missingFrom: 'OneMap'
        });
        stats.byProject[projectName].missing++;
      }
    }

    // 3. Print Summary Report
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('                    DATA COVERAGE SUMMARY');
    console.log('═══════════════════════════════════════════════════════════════\n');

    console.log('ONT Serial Sources:');
    console.log('  • OES Activations:   ' + stats.withOesOnt.toString().padStart(5) + ' DRs (' + (stats.withOesOnt/stats.total*100).toFixed(1) + '%)');
    console.log('  • Offline Devices:   ' + stats.withOfflineOnt.toString().padStart(5) + ' DRs (' + (stats.withOfflineOnt/stats.total*100).toFixed(1) + '%)');
    console.log('  • OneMap Scanned:    ' + stats.withOnemapOnt.toString().padStart(5) + ' DRs (' + (stats.withOnemapOnt/stats.total*100).toFixed(1) + '%)');
    console.log('  • WA Photo (VLM):    ' + stats.withWaOnt.toString().padStart(5) + ' DRs (' + (stats.withWaOnt/stats.total*100).toFixed(1) + '%)');

    console.log('\nUPS Serial Sources:');
    console.log('  • OneMap Scanned:    ' + stats.withOnemapUps.toString().padStart(5) + ' DRs (' + (stats.withOnemapUps/stats.total*100).toFixed(1) + '%)');
    console.log('  • WA Photo (VLM):    ' + stats.withWaUps.toString().padStart(5) + ' DRs (' + (stats.withWaUps/stats.total*100).toFixed(1) + '%)');

    console.log('\nWA Photo VLM Processing:');
    console.log('  • Processed:         ' + stats.waVlmProcessed.toString().padStart(5) + ' photos');

    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('                    ONT SERIAL VERIFICATION');
    console.log('═══════════════════════════════════════════════════════════════\n');

    console.log('Match Status (multi-source comparison):');
    console.log('  ✅ All Match:        ' + stats.ontAllMatch.toString().padStart(5) + ' DRs (' + (stats.ontAllMatch/stats.total*100).toFixed(1) + '%)');
    console.log('  ⚠️  Partial Match:    ' + stats.ontPartialMatch.toString().padStart(5) + ' DRs (' + (stats.ontPartialMatch/stats.total*100).toFixed(1) + '%)');
    console.log('  ❌ Mismatch:         ' + stats.ontMismatch.toString().padStart(5) + ' DRs (' + (stats.ontMismatch/stats.total*100).toFixed(1) + '%)');
    console.log('  ➖ Single Source:    ' + stats.ontNoComparison.toString().padStart(5) + ' DRs (cannot compare)');

    if (mismatches.length > 0) {
      console.log('\n═══════════════════════════════════════════════════════════════');
      console.log('                    MISMATCH DETAILS');
      console.log('═══════════════════════════════════════════════════════════════\n');

      console.log('Found ' + mismatches.length + ' DRs with serial mismatches:\n');

      const displayMismatches = mismatches.slice(0, 20);
      for (const m of displayMismatches) {
        console.log(m.dropNumber + ' (' + m.project + '):');
        for (const s of m.sources) {
          console.log('  • ' + s.source.padEnd(8) + ': ' + s.value);
        }
        if (m.type) console.log('  → Type: ' + m.type);
        console.log('');
      }

      if (mismatches.length > 20) {
        console.log('... and ' + (mismatches.length - 20) + ' more mismatches\n');
      }
    }

    // 4. Project Breakdown
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('                    PROJECT BREAKDOWN');
    console.log('═══════════════════════════════════════════════════════════════\n');

    const sortedProjects = Object.entries(stats.byProject)
      .sort((a, b) => b[1].total - a[1].total);

    console.log('Project'.padEnd(35) + 'Total'.padStart(8) + 'Mismatch'.padStart(10) + 'Missing'.padStart(10));
    console.log('─'.repeat(63));

    for (const [project, data] of sortedProjects.slice(0, 15)) {
      const mismatchCount = mismatches.filter(m => m.project === project).length;
      console.log(
        project.substring(0, 33).padEnd(35) +
        data.total.toString().padStart(8) +
        mismatchCount.toString().padStart(10) +
        data.missing.toString().padStart(10)
      );
    }

    if (sortedProjects.length > 15) {
      console.log('\n... and ' + (sortedProjects.length - 15) + ' more projects');
    }

    // 5. Recommendations
    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('                    RECOMMENDATIONS');
    console.log('═══════════════════════════════════════════════════════════════\n');

    if (stats.waVlmProcessed < stats.total * 0.1) {
      console.log('⚠️  LOW WA PHOTO VLM COVERAGE');
      console.log('   Only ' + stats.waVlmProcessed + ' photos have been VLM processed.');
      console.log('   Consider running batch VLM extraction on wa_photos table.\n');
    }

    if (mismatches.length > 0) {
      console.log('⚠️  SERIAL MISMATCHES DETECTED');
      console.log('   ' + mismatches.length + ' DRs have conflicting serial numbers.');
      console.log('   Review these cases to identify:');
      console.log('   - Technician typos during data entry');
      console.log('   - Device swaps not updated in all systems');
      console.log('   - OCR/barcode scanning errors\n');
    }

    console.log('✅ NEXT STEPS');
    console.log('   1. Create serial_change_history table to track all future changes');
    console.log('   2. Hook into OneMap sync to log serial updates');
    console.log('   3. Process WA photos through VLM for 4-way verification');
    console.log('   4. Implement Activity tab serial history display\n');

    if (outputFormat === 'csv') {
      console.log('\n═══════════════════════════════════════════════════════════════');
      console.log('                    CSV EXPORT');
      console.log('═══════════════════════════════════════════════════════════════\n');

      console.log('drop_number,project,oes_ont,offline_ont,onemap_ont,onemap_ups,wa_ont,wa_ups,status');
      for (const row of rows) {
        const ontSources = [row.oes_ont, row.offline_ont, row.onemap_ont, row.wa_ont].filter(Boolean);
        const unique = [...new Set(ontSources.map(s => s?.trim().toUpperCase()))];
        const status = ontSources.length <= 1 ? 'single_source' :
                       unique.length === 1 ? 'match' : 'mismatch';
        console.log([
          row.drop_number,
          '"' + (row.project_name || 'Unknown') + '"',
          row.oes_ont || '',
          row.offline_ont || '',
          row.onemap_ont || '',
          row.onemap_ups || '',
          row.wa_ont || '',
          row.wa_ups || '',
          status
        ].join(','));
      }
    }

    if (outputFormat === 'json') {
      const jsonOutput = {
        timestamp: new Date().toISOString(),
        summary: stats,
        mismatches: mismatches,
        missing: missing,
        data: rows
      };
      console.log(JSON.stringify(jsonOutput, null, 2));
    }

    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('                    AUDIT COMPLETE');
    console.log('═══════════════════════════════════════════════════════════════\n');

  } catch (error) {
    console.error('Audit failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

runAudit();
