/**
 * Backfill: reclassify existing OLT `not_found` mismatch records as
 * `serial_other_dr` where the OES serial is actually registered on 1Map under
 * a different drop.
 *
 * Past auto-detect runs (before the serial_other_dr feature) marked a row
 * `not_found` whenever its DR returned nothing from 1Map — looking only at the
 * drop number. This re-runs the reverse serial lookup over those existing rows.
 *
 * Reuses findSerialOnOtherDr from the queue-processor service so the
 * classification logic is identical to the live path (no drift).
 *
 * Usage:
 *   tsx scripts/backfill-olt-serial-other-dr.ts            # DRY RUN (default)
 *   tsx scripts/backfill-olt-serial-other-dr.ts --commit   # write changes
 *
 * Reads DATABASE_URL from the environment. Never hardcode credentials.
 *
 * Status: WORKING | NLNH Confidence: HIGH
 */

import { Pool } from 'pg';
import { findSerialOnOtherDr } from '@/modules/data-sync/services/oltQueueProcessorService';

const COMMIT = process.argv.includes('--commit');
const STAGGER_MS = 350; // be gentle on the 1Map API

interface NotFoundRow {
  id: string;
  drop_number: string;
  olt_serial: string | null;
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL is not set');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: databaseUrl });
  const client = await pool.connect();

  let scanned = 0;
  let reclassified = 0;
  let skippedNoSerial = 0;
  let errored = 0;
  const samples: Array<{ dr: string; serial: string; foundOnDr: string }> = [];

  try {
    const { rows } = await client.query<NotFoundRow>(
      `SELECT id, drop_number, olt_serial
       FROM olt_mismatch_records
       WHERE fix_status = 'not_found'
       ORDER BY created_at DESC`
    );

    console.log(`${COMMIT ? '[COMMIT]' : '[DRY RUN]'} scanning ${rows.length} not_found records...\n`);

    for (const row of rows) {
      scanned++;
      if (!row.olt_serial) { skippedNoSerial++; continue; }

      // findSerialOnOtherDr only reads item.drop_number and item.oes_serial.
      const item = {
        id: 0,
        drop_number: row.drop_number,
        oes_serial: row.olt_serial,
        oes_batch_id: '',
        team: '',
      } as unknown as Parameters<typeof findSerialOnOtherDr>[1];

      // Per-row isolation: a transient 1Map/DB failure on one row shouldn't
      // abort the whole run (and discard already-committed reclassifications).
      let otherDr: Awaited<ReturnType<typeof findSerialOnOtherDr>> = null;
      try {
        otherDr = await findSerialOnOtherDr(client, item);
      } catch (err) {
        errored++;
        console.warn(`  ! ${row.drop_number}: lookup failed — ${err instanceof Error ? err.message : String(err)}`);
        await new Promise((r) => setTimeout(r, STAGGER_MS));
        continue;
      }

      if (otherDr) {
        reclassified++;
        if (samples.length < 15) {
          samples.push({ dr: row.drop_number, serial: row.olt_serial, foundOnDr: otherDr.foundOnDr });
        }

        if (COMMIT) {
          // Both writes for this drop are atomic — never leave the mismatch
          // record reclassified while the queue tracker still says not_found.
          try {
            await client.query('BEGIN');
            await client.query(
              `UPDATE olt_mismatch_records
               SET fix_status = 'serial_other_dr', investigation_context = $1
               WHERE id = $2`,
              [otherDr.context, row.id]
            );
            await client.query(
              `UPDATE olt_onemap_lookup_queue
               SET mismatch_type = 'note2_serial_other_dr'
               WHERE drop_number = $1 AND mismatch_type = 'note2_not_on_1map'`,
              [row.drop_number]
            );
            await client.query('COMMIT');
          } catch (err) {
            await client.query('ROLLBACK').catch(() => { /* connection may be broken */ });
            errored++;
            reclassified--;
            console.warn(`  ! ${row.drop_number}: write failed, rolled back — ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      }

      if (scanned % 25 === 0) {
        console.log(`  ...${scanned}/${rows.length} scanned, ${reclassified} reclassified so far`);
      }
      await new Promise((r) => setTimeout(r, STAGGER_MS));
    }

    console.log('\n──────── SUMMARY ────────');
    console.log(`Mode:                 ${COMMIT ? 'COMMIT (written)' : 'DRY RUN (no writes)'}`);
    console.log(`Scanned:              ${scanned}`);
    console.log(`Skipped (no serial):  ${skippedNoSerial}`);
    console.log(`Reclassified → serial_other_dr: ${reclassified}`);
    console.log(`Errored (skipped):    ${errored}`);
    console.log(`Still not_found:      ${scanned - reclassified - skippedNoSerial - errored}`);
    if (samples.length > 0) {
      console.log('\nSample reclassifications (DR → serial found under):');
      for (const s of samples) {
        console.log(`  ${s.dr}  serial ${s.serial}  →  ${s.foundOnDr}`);
      }
    }
    if (!COMMIT && reclassified > 0) {
      console.log('\nRe-run with --commit to apply these changes.');
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
