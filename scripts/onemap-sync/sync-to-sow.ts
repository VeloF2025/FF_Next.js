/**
 * Sync onemap schema data to sow_* operational tables
 *
 * Usage:
 *   npx tsx scripts/onemap-sync/sync-to-sow.ts
 *   npx tsx scripts/onemap-sync/sync-to-sow.ts --project LAW
 *   npx tsx scripts/onemap-sync/sync-to-sow.ts --dry-run
 */

import { neon } from '@neondatabase/serverless';

const DATABASE_URL = process.env.DATABASE_URL ||
  'postgresql://neondb_owner:npg_aRNLhZc1G2CD@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require';

const sql = neon(DATABASE_URL);

interface SyncResult {
  table: string;
  inserted: number;
  updated: number;
  skipped: number;
  errors: number;
}

interface ProjectMapping {
  onemapId: string;
  onemapCode: string;
  prodId: string;
  projectName: string;
}

async function getProjectMappings(projectCode?: string): Promise<ProjectMapping[]> {
  const projects = await sql`
    SELECT
      id as onemap_id,
      project_code as onemap_code,
      project_id as prod_id,
      project_name
    FROM onemap.projects
    WHERE project_id IS NOT NULL
    ${projectCode ? sql`AND project_code = ${projectCode}` : sql``}
    ORDER BY project_code
  `;

  return projects.map(p => ({
    onemapId: p.onemap_id,
    onemapCode: p.onemap_code,
    prodId: p.prod_id,
    projectName: p.project_name
  }));
}

async function syncPoles(mapping: ProjectMapping, dryRun: boolean): Promise<SyncResult> {
  const result: SyncResult = { table: 'sharepoint_hld_pole', inserted: 0, updated: 0, skipped: 0, errors: 0 };

  console.log(`\n  Syncing poles for ${mapping.onemapCode} (${mapping.projectName})...`);

  // Get poles from onemap with zone lookup
  const poles = await sql`
    SELECT
      p.pole_number,
      p.latitude,
      p.longitude,
      p.pole_type,
      z.zone_code,
      pn.pon_code
    FROM onemap.poles p
    LEFT JOIN onemap.zones z ON p.zone_id = z.id
    LEFT JOIN onemap.pons pn ON p.pon_id = pn.id
    WHERE p.project_id = ${mapping.onemapId}
  `;

  console.log(`    Found ${poles.length} poles in onemap`);

  if (dryRun) {
    result.skipped = poles.length;
    return result;
  }

  // Insert into sharepoint_hld_pole (base table for sow_poles view)
  for (const pole of poles) {
    try {
      const zoneNo = pole.zone_code ? parseInt(pole.zone_code) || null : null;
      const ponNo = pole.pon_code ? parseInt(pole.pon_code.split('.')[0]) || null : null;

      await sql`
        INSERT INTO sharepoint_hld_pole (
          id, project_id, label_1, lat, lon,
          type_1, zone_no, pon_no, status, source_file, created_at, updated_at
        ) VALUES (
          gen_random_uuid(), ${mapping.prodId}, ${pole.pole_number}, ${pole.latitude}, ${pole.longitude},
          ${pole.pole_type}, ${zoneNo}, ${ponNo}, 'active', 'onemap_sync', NOW(), NOW()
        )
        ON CONFLICT (project_id, label_1)
        DO UPDATE SET
          lat = EXCLUDED.lat,
          lon = EXCLUDED.lon,
          type_1 = EXCLUDED.type_1,
          zone_no = EXCLUDED.zone_no,
          pon_no = EXCLUDED.pon_no,
          updated_at = NOW()
      `;
      result.inserted++;
    } catch (e) {
      result.errors++;
    }
  }

  console.log(`    ✓ Synced ${result.inserted} poles`);
  return result;
}

async function syncDrops(mapping: ProjectMapping, dryRun: boolean): Promise<SyncResult> {
  const result: SyncResult = { table: 'sharepoint_hld_home', inserted: 0, updated: 0, skipped: 0, errors: 0 };

  console.log(`\n  Syncing drops for ${mapping.onemapCode} (${mapping.projectName})...`);

  // Get drops from onemap
  const drops = await sql`
    SELECT
      dr_number,
      pole_number,
      latitude,
      longitude,
      address,
      current_status,
      zone_code,
      pon_code
    FROM onemap.drops
    WHERE project_id = ${mapping.onemapId}
  `;

  console.log(`    Found ${drops.length} drops in onemap`);

  if (dryRun) {
    result.skipped = drops.length;
    return result;
  }

  // Process in batches - insert into sharepoint_hld_home (base table for sow_drops view)
  const batchSize = 100;
  for (let i = 0; i < drops.length; i += batchSize) {
    const batch = drops.slice(i, i + batchSize);

    for (const drop of batch) {
      try {
        const zoneNo = drop.zone_code ? parseInt(drop.zone_code) || null : null;
        const ponNo = drop.pon_code ? parseInt(drop.pon_code.split('.')[0]) || null : null;

        await sql`
          INSERT INTO sharepoint_hld_home (
            id, project_id, label, strtfeat, lat, lon,
            address, zone_no, pon_no, source_file, created_at, updated_at
          ) VALUES (
            gen_random_uuid(), ${mapping.prodId}, ${drop.dr_number}, ${drop.pole_number},
            ${drop.latitude}, ${drop.longitude}, ${drop.address},
            ${zoneNo}, ${ponNo}, 'onemap_sync', NOW(), NOW()
          )
          ON CONFLICT (project_id, label)
          DO UPDATE SET
            strtfeat = EXCLUDED.strtfeat,
            lat = EXCLUDED.lat,
            lon = EXCLUDED.lon,
            address = EXCLUDED.address,
            zone_no = EXCLUDED.zone_no,
            pon_no = EXCLUDED.pon_no,
            updated_at = NOW()
        `;
        result.inserted++;
      } catch (e) {
        result.errors++;
      }
    }

    // Progress update
    if ((i + batchSize) % 5000 === 0 || i + batchSize >= drops.length) {
      process.stdout.write(`\r    Progress: ${Math.min(i + batchSize, drops.length)} / ${drops.length}`);
    }
  }

  console.log(`\n    ✓ Synced ${result.inserted} drops`);
  return result;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const projectIndex = args.indexOf('--project');
  const projectCode = projectIndex !== -1 ? args[projectIndex + 1] : undefined;

  console.log('========================================');
  console.log('  ONEMAP → SOW SYNC');
  console.log('========================================');
  console.log(`Mode: ${dryRun ? 'DRY RUN (no changes)' : 'LIVE'}`);
  console.log(`Project: ${projectCode || 'ALL'}`);
  console.log('========================================');

  // Get project mappings
  const mappings = await getProjectMappings(projectCode);

  if (mappings.length === 0) {
    console.log('\n❌ No projects found with valid prod mapping!');
    process.exit(1);
  }

  console.log(`\nFound ${mappings.length} project(s) to sync:`);
  mappings.forEach(m => console.log(`  - ${m.onemapCode}: ${m.projectName}`));

  // Note: Data is synced to sharepoint_hld_pole and sharepoint_hld_home base tables
  // The sow_poles and sow_drops views read from these tables

  // Sync each project
  const allResults: SyncResult[] = [];

  for (const mapping of mappings) {
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`Processing: ${mapping.onemapCode} - ${mapping.projectName}`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

    const polesResult = await syncPoles(mapping, dryRun);
    const dropsResult = await syncDrops(mapping, dryRun);

    allResults.push(polesResult, dropsResult);
  }

  // Summary
  console.log('\n========================================');
  console.log('  SYNC COMPLETE');
  console.log('========================================');

  const totalPoles = allResults.filter(r => r.table === 'sow_poles').reduce((sum, r) => sum + r.inserted, 0);
  const totalDrops = allResults.filter(r => r.table === 'sow_drops').reduce((sum, r) => sum + r.inserted, 0);

  console.log(`\nTotal synced:`);
  console.log(`  Poles: ${totalPoles}`);
  console.log(`  Drops: ${totalDrops}`);

  if (dryRun) {
    console.log('\n⚠️  DRY RUN - No changes made. Run without --dry-run to apply.');
  }
}

main().catch(console.error);
