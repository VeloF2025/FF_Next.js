/**
 * Retire synthetic technician van-stock locations (Sprint D).
 *
 * Finds all stock_locations rows with location_type='technician', verifies each
 * holds no stock (quants / serials / movement references), reports any draft
 * pickings that still reference them, and — when --commit is passed — marks
 * them is_active=false.
 *
 * tsx conventions: dotenv first, then DYNAMIC import of db-pool (which binds
 * DATABASE_URL at import time); RELATIVE imports only (@/ alias not honoured
 * at runtime); process.stdout for output (logger silent under tsx;
 * console.* is lint-banned); exit(0) on success, exit(1) on error.
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

interface TechLocation {
  id: string;
  code: string;
  name: string;
  assigned_to_id: string | null;
}

interface Picking {
  id: string;
  picking_number: string;
  status: string;
}

async function main(): Promise<void> {
  const commit = process.argv.includes('--commit');
  const out = (m: string) => process.stdout.write(m + '\n');

  // Dynamic import AFTER dotenv so db-pool binds the loaded DATABASE_URL.
  const { query } = await import('../src/lib/db-pool');

  out(`=== Retire Technician Locations (${commit ? 'COMMIT' : 'DRY-RUN'}) ===`);
  out('');

  // Step 1: fetch all technician locations
  const techLocations = (await query(
    `SELECT id, code, name, assigned_to_id FROM stock_locations WHERE location_type = 'technician'`
  )) as unknown as TechLocation[];

  out(`Found ${techLocations.length} technician location(s).`);
  out('');

  if (techLocations.length === 0) {
    out('Nothing to do.');
    process.exit(0);
  }

  const techIds = techLocations.map((l) => l.id);

  // Step 2: per-location stock audit
  let cleanCount = 0;
  let skippedCount = 0;
  const cleanIds: string[] = [];

  for (const loc of techLocations) {
    const [quantRow] = (await query(
      `SELECT COUNT(*)::int AS cnt FROM stock_quants WHERE location_id = $1`,
      [loc.id]
    )) as unknown as [{ cnt: number }];

    const [serialRow] = (await query(
      `SELECT COUNT(*)::int AS cnt FROM stock_serials WHERE current_location_id = $1`,
      [loc.id]
    )) as unknown as [{ cnt: number }];

    const [movRow] = (await query(
      `SELECT COUNT(*)::int AS cnt FROM field_stock_movements WHERE from_location_id = $1 OR to_location_id = $1`,
      [loc.id]
    )) as unknown as [{ cnt: number }];

    const totalRefs = quantRow.cnt + serialRow.cnt + movRow.cnt;

    if (totalRefs > 0) {
      out(
        `  SKIP  ${loc.code} (${loc.name}) — holds stock: quants=${quantRow.cnt} serials=${serialRow.cnt} movements=${movRow.cnt}`
      );
      skippedCount++;
    } else {
      out(`  CLEAN ${loc.code} (${loc.name}) — 0 stock refs`);
      cleanIds.push(loc.id);
      cleanCount++;
    }
  }

  out('');

  // Step 3: report draft pickings referencing any tech-location
  const draftPickings = (await query(
    `SELECT id, picking_number, status
     FROM stock_pickings
     WHERE source_location_id = ANY($1::uuid[])
        OR destination_location_id = ANY($1::uuid[])`,
    [techIds]
  )) as unknown as Picking[];

  if (draftPickings.length > 0) {
    out(`WARNING: ${draftPickings.length} picking(s) reference technician locations:`);
    for (const p of draftPickings) {
      out(`  picking ${p.picking_number} (${p.id}) status=${p.status}`);
    }
    out('  → Review these pickings before committing deactivation.');
    out('');
  } else {
    out('No pickings reference technician locations.');
    out('');
  }

  // Step 4: deactivate (or report)
  if (commit) {
    if (cleanIds.length === 0) {
      out('No clean locations to deactivate.');
    } else {
      out(`Deactivating ${cleanIds.length} location(s)...`);
      for (const id of cleanIds) {
        const loc = techLocations.find((l) => l.id === id)!;
        await query(
          `UPDATE stock_locations SET is_active = false, updated_at = NOW() WHERE id = $1`,
          [id]
        );
        out(`  DEACTIVATED id=${id} code=${loc.code} name=${loc.name}`);
      }
    }
  } else {
    if (cleanIds.length > 0) {
      out(`DRY-RUN: Would deactivate ${cleanIds.length} clean location(s):`);
      for (const id of cleanIds) {
        const loc = techLocations.find((l) => l.id === id)!;
        out(`  WOULD deactivate id=${id} code=${loc.code} name=${loc.name}`);
      }
    }
  }

  out('');
  out(
    `Summary: total=${techLocations.length} clean=${cleanCount} skipped-holding-stock=${skippedCount} draft-pickings=${draftPickings.length} ${commit ? '(committed)' : '(dry-run, no writes)'}`
  );

  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(
    `retire-technician-locations failed: ${err instanceof Error ? err.stack : String(err)}\n`
  );
  process.exit(1);
});
