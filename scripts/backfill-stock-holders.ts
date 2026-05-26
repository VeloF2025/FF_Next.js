/**
 * Backfill stock_holders from the existing technician locations (Sprint C).
 *
 * Each stock_locations row with location_type='technician' whose assigned_to_id
 * is a real staff member becomes one holder_type='staff' holder. Idempotent via
 * the partial unique index. Dry-run by default; pass --commit to write.
 *
 * tsx conventions: dotenv first, then DYNAMIC import of anything pulling
 * ../src/lib/db-pool (db.ts binds DATABASE_URL at import); RELATIVE imports only
 * (tsx ignores the @/ tsconfig alias at runtime); use process.stdout (not
 * @/lib/logger — silent under tsx; console.* is lint-banned); exit(0) at end.
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { eligibleHolderInput, type TechLocationRow } from '../src/modules/procurement/field-stock/services/holderBackfillMapping';

const TECH_LOCATIONS_SQL = `
  SELECT sl.assigned_to_id, sl.assigned_to_name, sl.assigned_to_phone,
         (s.id IS NOT NULL) AS staff_exists
  FROM stock_locations sl
  LEFT JOIN staff s ON s.id = sl.assigned_to_id
  WHERE sl.location_type = 'technician'`;

async function main(): Promise<void> {
  const commit = process.argv.includes('--commit');
  const out = (m: string) => process.stdout.write(m + '\n');

  // Dynamic imports AFTER dotenv so db-pool binds the loaded DATABASE_URL.
  const { query } = await import('../src/lib/db-pool');
  const { getOrCreateStaffHolder } = await import(
    '../src/modules/procurement/field-stock/services/stockHolderService'
  );

  const rows = (await query(TECH_LOCATIONS_SQL)) as unknown as TechLocationRow[];
  out(`Found ${rows.length} technician location(s). Mode: ${commit ? 'COMMIT' : 'DRY-RUN'}`);

  let created = 0;
  let skipped = 0;
  for (const r of rows) {
    const input = eligibleHolderInput(r);
    if (!input) {
      skipped++;
      out(`  SKIP  assigned_to_id=${r.assigned_to_id ?? 'NULL'} (no staff match)`);
      continue;
    }
    if (commit) {
      const h = await getOrCreateStaffHolder(input.staffId, input.name, input.phone);
      out(`  OK    staff_id=${input.staffId} -> holder ${h.id} (${h.name})`);
    } else {
      out(`  WOULD staff_id=${input.staffId} (${input.name})`);
    }
    created++;
  }

  out(`Done. eligible=${created} skipped=${skipped} ${commit ? '(written)' : '(dry-run, no writes)'}`);
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`backfill failed: ${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
