/**
 * ARCH Data Import Script
 *
 * Imports network audit data from Excel files into the database.
 *
 * Usage:
 *   npx ts-node scripts/arch-import/import-arch-data.ts <project_id> <directory>
 *
 * Example:
 *   npx ts-node scripts/arch-import/import-arch-data.ts abc123 ./docs/docs/ARCH
 */

import * as XLSX from 'xlsx';
import * as path from 'path';
import * as fs from 'fs';
import { neon } from '@neondatabase/serverless';

// Configuration
const DATABASE_URL = process.env.DATABASE_URL ||
  'process.env.DATABASE_URL';

const sql = neon(DATABASE_URL);

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Convert Excel serial date to JavaScript Date
 */
function excelToDate(serial: number | string | undefined): Date | null {
  if (!serial || typeof serial === 'string') return null;
  // Excel dates are days since 1900-01-01 (with a leap year bug)
  const date = new Date((serial - 25569) * 86400 * 1000);
  return isNaN(date.getTime()) ? null : date;
}

/**
 * Parse OLT address to extract rack, shelf, slot, port
 */
function parseOltAddress(address: string | undefined): { rack: number; shelf: number; slot: number; port: number } | null {
  if (!address) return null;
  const match = address.match(/law\.olt\.01:(\d+)-(\d+)-(\d+)-(\d+)/);
  if (match) {
    return {
      rack: parseInt(match[1]),
      shelf: parseInt(match[2]),
      slot: parseInt(match[3]),
      port: parseInt(match[4])
    };
  }
  return null;
}

/**
 * Safe number parsing
 */
function safeNumber(value: any): number | null {
  if (value === undefined || value === null || value === '') return null;
  const num = parseFloat(value);
  return isNaN(num) ? null : num;
}

/**
 * Safe string parsing
 */
function safeString(value: any, maxLength = 100): string | null {
  if (value === undefined || value === null) return null;
  return String(value).substring(0, maxLength);
}

// =============================================================================
// IMPORT FUNCTIONS
// =============================================================================

interface ImportResult {
  table: string;
  inserted: number;
  errors: string[];
}

/**
 * Create or get snapshot for the import
 */
async function getOrCreateSnapshot(projectId: string, snapshotDate: Date, sourceFiles: string[]): Promise<string> {
  const dateStr = snapshotDate.toISOString().split('T')[0];

  // Check if snapshot exists
  const existing = await sql`
    SELECT id FROM arch_network_snapshots
    WHERE project_id = ${projectId}::uuid AND snapshot_date = ${dateStr}::date
  `;

  if (existing.length > 0) {
    console.log(`📋 Using existing snapshot: ${existing[0].id}`);
    return existing[0].id;
  }

  // Create new snapshot
  const result = await sql`
    INSERT INTO arch_network_snapshots (project_id, snapshot_date, source_files, import_status)
    VALUES (${projectId}::uuid, ${dateStr}::date, ${JSON.stringify(sourceFiles)}::jsonb, 'processing')
    RETURNING id
  `;

  console.log(`📋 Created new snapshot: ${result[0].id}`);
  return result[0].id;
}

/**
 * Import OES Data
 */
async function importOesData(snapshotId: string, data: any[]): Promise<ImportResult> {
  const result: ImportResult = { table: 'arch_oes_data', inserted: 0, errors: [] };

  console.log(`\n📊 Importing OES Data (${data.length} records)...`);

  // Clear existing data for this snapshot
  await sql`DELETE FROM arch_oes_data WHERE snapshot_id = ${snapshotId}::uuid`;

  // Batch insert
  const batchSize = 100;
  for (let i = 0; i < data.length; i += batchSize) {
    const batch = data.slice(i, i + batchSize);

    for (const row of batch) {
      try {
        const oltParsed = parseOltAddress(row.olt_address);
        const activationDate = excelToDate(row.activation_date);

        await sql`
          INSERT INTO arch_oes_data (
            snapshot_id, drop_number, serial_number, olt_address,
            olt_rack, olt_shelf, olt_slot, olt_port,
            ont_rx_signal, olt_rx_signal, link_budget_ont, link_budget_olt,
            current_ont_rx, ont_status, activation_date, geo_latitude, geo_longitude
          ) VALUES (
            ${snapshotId}::uuid,
            ${safeString(row.drop_number, 20)},
            ${safeString(row.serialnumber, 20)},
            ${safeString(row.olt_address, 50)},
            ${oltParsed?.rack || null},
            ${oltParsed?.shelf || null},
            ${oltParsed?.slot || null},
            ${oltParsed?.port || null},
            ${safeNumber(row.ontrxsiglvl)},
            ${safeNumber(row.oltrxsiglvl)},
            ${safeNumber(row.linkbudgetontrx)},
            ${safeNumber(row.linkbudgetoltrx)},
            ${safeNumber(row.current_ont_rx)},
            ${safeString(row.ontstatus, 20)},
            ${activationDate?.toISOString().split('T')[0] || null},
            ${safeNumber(row.geo_latitude)},
            ${safeNumber(row.geo_longitude)}
          )
          ON CONFLICT (snapshot_id, drop_number) DO UPDATE SET
            serial_number = EXCLUDED.serial_number,
            ont_rx_signal = EXCLUDED.ont_rx_signal,
            olt_rx_signal = EXCLUDED.olt_rx_signal,
            ont_status = EXCLUDED.ont_status
        `;
        result.inserted++;
      } catch (err: any) {
        result.errors.push(`Row ${i}: ${err.message}`);
      }
    }

    process.stdout.write(`\r  Progress: ${Math.min(i + batchSize, data.length)}/${data.length}`);
  }

  console.log(`\n  ✅ Inserted ${result.inserted} records`);
  return result;
}

/**
 * Import Offline Data
 */
async function importOfflineData(snapshotId: string, data: any[]): Promise<ImportResult> {
  const result: ImportResult = { table: 'arch_offline_devices', inserted: 0, errors: [] };

  console.log(`\n📊 Importing Offline Data (${data.length} records)...`);

  await sql`DELETE FROM arch_offline_devices WHERE snapshot_id = ${snapshotId}::uuid`;

  const batchSize = 100;
  for (let i = 0; i < data.length; i += batchSize) {
    const batch = data.slice(i, i + batchSize);

    for (const row of batch) {
      try {
        const lastInformDate = excelToDate(row.last_inform_sast);

        await sql`
          INSERT INTO arch_offline_devices (
            snapshot_id, serial_number, drop_number, ont_address,
            area_abbreviation, last_down_reason, last_inform_date,
            days_since_last_inform, offline_bucket
          ) VALUES (
            ${snapshotId}::uuid,
            ${safeString(row.serial_number, 20)},
            ${safeString(row.drop_number, 20)},
            ${safeString(row.ont_address, 50)},
            ${safeString(row.area_abbreviation, 10)},
            ${safeString(row.last_down_reason, 100)},
            ${lastInformDate?.toISOString() || null},
            ${safeNumber(row.days_since_last_inform)},
            ${safeString(row.offline_days_bucket, 50)}
          )
          ON CONFLICT (snapshot_id, serial_number) DO UPDATE SET
            drop_number = EXCLUDED.drop_number,
            last_down_reason = EXCLUDED.last_down_reason,
            days_since_last_inform = EXCLUDED.days_since_last_inform
        `;
        result.inserted++;
      } catch (err: any) {
        result.errors.push(`Row ${i}: ${err.message}`);
      }
    }

    process.stdout.write(`\r  Progress: ${Math.min(i + batchSize, data.length)}/${data.length}`);
  }

  console.log(`\n  ✅ Inserted ${result.inserted} records`);
  return result;
}

/**
 * Import Planning Data
 */
async function importPlanningData(snapshotId: string, data: any[]): Promise<ImportResult> {
  const result: ImportResult = { table: 'arch_planning_data', inserted: 0, errors: [] };

  console.log(`\n📊 Importing Planning Data (${data.length} records)...`);

  await sql`DELETE FROM arch_planning_data WHERE snapshot_id = ${snapshotId}::uuid`;

  const batchSize = 200;
  for (let i = 0; i < data.length; i += batchSize) {
    const batch = data.slice(i, i + batchSize);

    for (const row of batch) {
      try {
        await sql`
          INSERT INTO arch_planning_data (
            snapshot_id, drop_number, zone_number, pon_number,
            pole_number, address, latitude, longitude
          ) VALUES (
            ${snapshotId}::uuid,
            ${safeString(row.drop_no, 20)},
            ${safeNumber(row.zone_no)},
            ${safeNumber(row.pon_no)},
            ${safeString(row.pole_no, 20)},
            ${safeString(row.address, 500)},
            ${safeNumber(row.lat)},
            ${safeNumber(row.lon)}
          )
        `;
        result.inserted++;
      } catch (err: any) {
        result.errors.push(`Row ${i}: ${err.message}`);
      }
    }

    process.stdout.write(`\r  Progress: ${Math.min(i + batchSize, data.length)}/${data.length}`);
  }

  console.log(`\n  ✅ Inserted ${result.inserted} records`);
  return result;
}

/**
 * Import POI Data
 */
async function importPoiData(snapshotId: string, data: any[]): Promise<ImportResult> {
  const result: ImportResult = { table: 'arch_poi', inserted: 0, errors: [] };

  console.log(`\n📊 Importing POI Data (${data.length} records)...`);

  await sql`DELETE FROM arch_poi WHERE snapshot_id = ${snapshotId}::uuid`;

  for (const row of data) {
    try {
      await sql`
        INSERT INTO arch_poi (
          snapshot_id, site_name, drop_number, poi_type, poi_name,
          branding_location, voucher_info, agent_name, zone_number, pon_number
        ) VALUES (
          ${snapshotId}::uuid,
          ${safeString(row.site_name, 100)},
          ${safeString(row.drop_no, 20)},
          ${safeString(row.poi_type, 50)},
          ${safeString(row.poi_name, 100)},
          ${safeString(row.branding_location, 100)},
          ${safeString(row.vouch, 100)},
          ${safeString(row.agent_name, 100)},
          ${safeNumber(row.zone_no)},
          ${safeNumber(row.pon_no)}
        )
      `;
      result.inserted++;
    } catch (err: any) {
      result.errors.push(`${row.poi_name}: ${err.message}`);
    }
  }

  console.log(`  ✅ Inserted ${result.inserted} records`);
  return result;
}

/**
 * Import PON Index mapping
 */
async function importPonIndex(projectId: string, data: any[]): Promise<ImportResult> {
  const result: ImportResult = { table: 'arch_pon_index', inserted: 0, errors: [] };

  console.log(`\n📊 Importing PON Index (${data.length} records)...`);

  for (const row of data) {
    try {
      await sql`
        INSERT INTO arch_pon_index (project_id, area_name, vlan, pon_number)
        VALUES (
          ${projectId}::uuid,
          ${safeString(row.area_name, 50)},
          ${safeString(row.vlan, 50)},
          ${safeNumber(row.pon)}
        )
        ON CONFLICT (project_id, vlan) DO UPDATE SET
          pon_number = EXCLUDED.pon_number
      `;
      result.inserted++;
    } catch (err: any) {
      result.errors.push(`${row.vlan}: ${err.message}`);
    }
  }

  console.log(`  ✅ Inserted ${result.inserted} records`);
  return result;
}

/**
 * Import Area Metrics (ARCH Summary)
 */
async function importAreaMetrics(projectId: string, data: any[], headers: string[]): Promise<ImportResult> {
  const result: ImportResult = { table: 'arch_area_metrics', inserted: 0, errors: [] };

  console.log(`\n📊 Importing Area Metrics...`);

  // Headers contain dates starting from column 4
  const dateColumns = headers.slice(4).filter(h => h && h.match(/^\d{4}-\d{2}-\d{2}$/));

  // Group data by metric
  const metricsMap: Record<string, any> = {};
  for (const row of data) {
    if (row['Metrics']) {
      metricsMap[row['Metrics']] = row;
    }
  }

  // Insert each date's metrics
  for (const dateStr of dateColumns) {
    try {
      const homesConnected = safeNumber(metricsMap['Homes connected']?.[dateStr]);
      const revenue = safeNumber(metricsMap['Revenue']?.[dateStr]);
      const trueRevenue = safeNumber(metricsMap['True Revenue']?.[dateStr]);
      const activeBundles = safeNumber(metricsMap['Active bundles']?.[dateStr]);
      const trphc = safeNumber(metricsMap['TRPHC']?.[dateStr]);
      const abHc = safeNumber(metricsMap['AB/HC']?.[dateStr]);

      if (homesConnected !== null) {
        await sql`
          INSERT INTO arch_area_metrics (
            project_id, report_date, area_name, homes_connected, revenue,
            true_revenue, active_bundles, trphc, ab_hc_ratio
          ) VALUES (
            ${projectId}::uuid, ${dateStr}::date, 'Lawley',
            ${homesConnected}, ${revenue}, ${trueRevenue},
            ${activeBundles}, ${trphc}, ${abHc}
          )
          ON CONFLICT (project_id, report_date, area_name) DO UPDATE SET
            homes_connected = EXCLUDED.homes_connected,
            revenue = EXCLUDED.revenue,
            true_revenue = EXCLUDED.true_revenue,
            active_bundles = EXCLUDED.active_bundles,
            trphc = EXCLUDED.trphc,
            ab_hc_ratio = EXCLUDED.ab_hc_ratio,
            updated_at = NOW()
        `;
        result.inserted++;
      }
    } catch (err: any) {
      result.errors.push(`${dateStr}: ${err.message}`);
    }
  }

  console.log(`  ✅ Inserted ${result.inserted} daily records`);
  return result;
}

/**
 * Import PON Revenue (TRCH PON Level)
 */
async function importPonRevenue(projectId: string, data: any[], headers: string[]): Promise<ImportResult> {
  const result: ImportResult = { table: 'arch_pon_revenue', inserted: 0, errors: [] };

  console.log(`\n📊 Importing PON Revenue (${data.length} PONs)...`);

  // Find date columns
  const dateColumns = headers.filter(h => h && h.match(/^\d{4}-\d{2}-\d{2}$/));

  for (const row of data) {
    const ponNumber = safeNumber(row['# PON']);
    if (!ponNumber) continue;

    const firstInstalled = excelToDate(row['First Installed Home']);
    const homesCount = safeNumber(row['# of Homes']);
    const ponAge = safeNumber(row['PON Age']);
    const thirtyDayAvg = safeNumber(row['30-day Avg']);

    for (const dateStr of dateColumns) {
      try {
        const dailyRevenue = safeNumber(row[dateStr]);
        if (dailyRevenue !== null) {
          await sql`
            INSERT INTO arch_pon_revenue (
              project_id, report_date, pon_number, first_installed_home,
              homes_count, pon_age_days, daily_revenue, thirty_day_avg
            ) VALUES (
              ${projectId}::uuid, ${dateStr}::date, ${ponNumber},
              ${firstInstalled?.toISOString().split('T')[0] || null},
              ${homesCount}, ${ponAge}, ${dailyRevenue}, ${thirtyDayAvg}
            )
            ON CONFLICT (project_id, report_date, pon_number) DO UPDATE SET
              daily_revenue = EXCLUDED.daily_revenue,
              thirty_day_avg = EXCLUDED.thirty_day_avg
          `;
          result.inserted++;
        }
      } catch (err: any) {
        result.errors.push(`PON ${ponNumber} ${dateStr}: ${err.message}`);
      }
    }
  }

  console.log(`  ✅ Inserted ${result.inserted} records`);
  return result;
}

/**
 * Import Free Voucher Usage
 */
async function importVoucherUsage(projectId: string, data: any[], reportDate: Date): Promise<ImportResult> {
  const result: ImportResult = { table: 'arch_voucher_usage', inserted: 0, errors: [] };

  console.log(`\n📊 Importing Voucher Usage (${data.length} records)...`);

  const dateStr = reportDate.toISOString().split('T')[0];

  for (const row of data) {
    try {
      await sql`
        INSERT INTO arch_voucher_usage (
          project_id, report_date, vlan, pon_number,
          free_30min_yesterday, free_1day_yesterday, promo_free_yesterday, total_free_yesterday,
          free_30min_week, free_1day_week, promo_free_week, total_free_week,
          free_30min_month, free_1day_month, promo_free_month, total_free_month
        ) VALUES (
          ${projectId}::uuid, ${dateStr}::date,
          ${safeString(row.vlan, 50)},
          ${null}, -- Will be linked via PON index
          ${safeNumber(row['Yesterday - First 30min Free']) || 0},
          ${safeNumber(row['Yesterday - First Day Free']) || 0},
          ${safeNumber(row['Yesterday - 10 x 1 Day FREE']) || 0},
          ${safeNumber(row['Yesterday - Grand Total']) || 0},
          ${safeNumber(row['This Week - First 30min Free']) || 0},
          ${safeNumber(row['This Week - First Day Free']) || 0},
          ${safeNumber(row['This Week - 10 x 1 Day FREE']) || 0},
          ${safeNumber(row['This Week - Grand Total']) || 0},
          ${safeNumber(row['This Month - First 30min Free']) || 0},
          ${safeNumber(row['This Month - First Day Free']) || 0},
          ${safeNumber(row['This Month - 10 x 1 Day FREE']) || 0},
          ${safeNumber(row['This Month - Grand Total']) || 0}
        )
        ON CONFLICT (project_id, report_date, vlan) DO UPDATE SET
          free_30min_yesterday = EXCLUDED.free_30min_yesterday,
          free_1day_yesterday = EXCLUDED.free_1day_yesterday,
          total_free_yesterday = EXCLUDED.total_free_yesterday
      `;
      result.inserted++;
    } catch (err: any) {
      result.errors.push(`${row.vlan}: ${err.message}`);
    }
  }

  console.log(`  ✅ Inserted ${result.inserted} records`);
  return result;
}

/**
 * Import Offline Summary
 */
async function importOfflineSummary(snapshotId: string, zoneData: any[], ponData: any[]): Promise<ImportResult> {
  const result: ImportResult = { table: 'arch_offline_summary', inserted: 0, errors: [] };

  console.log(`\n📊 Importing Offline Summary...`);

  await sql`DELETE FROM arch_offline_summary WHERE snapshot_id = ${snapshotId}::uuid`;

  // Import zone summary
  for (const row of zoneData) {
    try {
      await sql`
        INSERT INTO arch_offline_summary (
          snapshot_id, summary_type, zone_or_pon, dying_gasp_count,
          device_not_active_count, total_offline, percentage_of_total, rank
        ) VALUES (
          ${snapshotId}::uuid, 'zone', ${safeNumber(row.Zone)},
          ${safeNumber(row['Dying Gasp']) || 0},
          ${safeNumber(row['Device Not Active']) || 0},
          ${safeNumber(row.Total) || 0},
          ${safeNumber(row['% of Total'])},
          ${safeNumber(row.Rank)}
        )
      `;
      result.inserted++;
    } catch (err: any) {
      result.errors.push(`Zone ${row.Zone}: ${err.message}`);
    }
  }

  // Import PON summary
  for (const row of ponData) {
    try {
      await sql`
        INSERT INTO arch_offline_summary (
          snapshot_id, summary_type, zone_or_pon, dying_gasp_count,
          device_not_active_count, total_offline, percentage_of_total, rank
        ) VALUES (
          ${snapshotId}::uuid, 'pon', ${safeNumber(row.PON)},
          ${safeNumber(row['Dying Gasp']) || 0},
          ${safeNumber(row['Device Not Active']) || 0},
          ${safeNumber(row.Total) || 0},
          ${safeNumber(row['% of Total'])},
          ${safeNumber(row.Rank)}
        )
      `;
      result.inserted++;
    } catch (err: any) {
      result.errors.push(`PON ${row.PON}: ${err.message}`);
    }
  }

  console.log(`  ✅ Inserted ${result.inserted} records`);
  return result;
}

// =============================================================================
// MAIN IMPORT FUNCTION
// =============================================================================

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.log('Usage: npx ts-node scripts/arch-import/import-arch-data.ts <project_id> <directory>');
    console.log('Example: npx ts-node scripts/arch-import/import-arch-data.ts abc123 ./docs/docs/ARCH');
    process.exit(1);
  }

  const [projectId, directory] = args;

  console.log('='.repeat(80));
  console.log('ARCH Network Audit Data Import');
  console.log('='.repeat(80));
  console.log(`Project ID: ${projectId}`);
  console.log(`Directory: ${directory}`);

  // Find Excel files
  const files = fs.readdirSync(directory)
    .filter(f => f.endsWith('.xlsx'))
    .map(f => path.join(directory, f));

  console.log(`\nFound ${files.length} Excel files:`);
  files.forEach(f => console.log(`  - ${path.basename(f)}`));

  // Parse report date from filename
  const dateMatch = files[0]?.match(/(\d{2})([A-Za-z]{3})(\d{4})/);
  const reportDate = dateMatch
    ? new Date(`${dateMatch[2]} ${dateMatch[1]}, ${dateMatch[3]}`)
    : new Date();

  console.log(`\nReport date: ${reportDate.toISOString().split('T')[0]}`);

  // Create snapshot
  const snapshotId = await getOrCreateSnapshot(
    projectId,
    reportDate,
    files.map(f => path.basename(f))
  );

  const results: ImportResult[] = [];

  // Process each file
  for (const file of files) {
    const filename = path.basename(file);
    console.log(`\n${'='.repeat(80)}`);
    console.log(`Processing: ${filename}`);
    console.log('='.repeat(80));

    const workbook = XLSX.readFile(file);

    if (filename.includes('audit_detail')) {
      // OES Data
      if (workbook.Sheets['OES Data']) {
        const data = XLSX.utils.sheet_to_json(workbook.Sheets['OES Data']);
        results.push(await importOesData(snapshotId, data));
      }

      // Offline Data
      if (workbook.Sheets['Offline Data']) {
        const data = XLSX.utils.sheet_to_json(workbook.Sheets['Offline Data']);
        results.push(await importOfflineData(snapshotId, data));
      }

      // Planning Data
      if (workbook.Sheets['Planning Data']) {
        const data = XLSX.utils.sheet_to_json(workbook.Sheets['Planning Data']);
        results.push(await importPlanningData(snapshotId, data));
      }

      // POI Data
      if (workbook.Sheets['Point of Interest Data']) {
        const data = XLSX.utils.sheet_to_json(workbook.Sheets['Point of Interest Data']);
        results.push(await importPoiData(snapshotId, data));
      }
    }

    if (filename.includes('summary_report')) {
      // ARCH Summary (Area Metrics)
      if (workbook.Sheets['ARCH Summary']) {
        const rawData = XLSX.utils.sheet_to_json(workbook.Sheets['ARCH Summary'], { header: 1 }) as any[][];
        const headers = rawData[0] || [];
        const data = XLSX.utils.sheet_to_json(workbook.Sheets['ARCH Summary']);
        results.push(await importAreaMetrics(projectId, data, headers));
      }

      // TRCH PON Level (PON Revenue)
      if (workbook.Sheets['TRCH PON Level']) {
        const rawData = XLSX.utils.sheet_to_json(workbook.Sheets['TRCH PON Level'], { header: 1 }) as any[][];
        const headers = rawData[0] || [];
        const data = XLSX.utils.sheet_to_json(workbook.Sheets['TRCH PON Level']);
        results.push(await importPonRevenue(projectId, data, headers));
      }

      // Free Vouchers
      if (workbook.Sheets['Previous Day Free Vouchers']) {
        const data = XLSX.utils.sheet_to_json(workbook.Sheets['Previous Day Free Vouchers']);
        results.push(await importVoucherUsage(projectId, data, reportDate));
      }

      // Offline Summaries
      if (workbook.Sheets['Offline - Zone Summary'] && workbook.Sheets['Offline - PON Summary']) {
        const zoneData = XLSX.utils.sheet_to_json(workbook.Sheets['Offline - Zone Summary']);
        const ponData = XLSX.utils.sheet_to_json(workbook.Sheets['Offline - PON Summary']);
        results.push(await importOfflineSummary(snapshotId, zoneData, ponData));
      }
    }

    if (filename.includes('Performance')) {
      // PON Index
      if (workbook.Sheets['area_pon_index_lawley']) {
        const data = XLSX.utils.sheet_to_json(workbook.Sheets['area_pon_index_lawley']);
        results.push(await importPonIndex(projectId, data));
      }
    }
  }

  // Update snapshot status
  const recordCounts = results.reduce((acc, r) => {
    acc[r.table] = r.inserted;
    return acc;
  }, {} as Record<string, number>);

  await sql`
    UPDATE arch_network_snapshots
    SET import_status = 'completed',
        record_counts = ${JSON.stringify(recordCounts)}::jsonb,
        updated_at = NOW()
    WHERE id = ${snapshotId}::uuid
  `;

  // Summary
  console.log('\n' + '='.repeat(80));
  console.log('IMPORT SUMMARY');
  console.log('='.repeat(80));

  let totalInserted = 0;
  let totalErrors = 0;

  for (const r of results) {
    console.log(`${r.table}: ${r.inserted} records`);
    if (r.errors.length > 0) {
      console.log(`  ⚠️ ${r.errors.length} errors`);
      r.errors.slice(0, 3).forEach(e => console.log(`    - ${e}`));
    }
    totalInserted += r.inserted;
    totalErrors += r.errors.length;
  }

  console.log(`\nTotal: ${totalInserted} records imported`);
  if (totalErrors > 0) console.log(`Errors: ${totalErrors}`);
  console.log(`\nSnapshot ID: ${snapshotId}`);
  console.log('✅ Import complete!');
}

main().catch(console.error);
