/**
 * Re-examine existing OLT `not_found` mismatch records against current 1Map.
 *
 * Past auto-detect runs marked a drop `not_found` when its DR returned nothing
 * from 1Map at that moment. Much of that data has since caught up — the DR is
 * now on 1Map (often a plain match). This re-runs the FULL classification
 * (searchDR → match / wrong / serial_other_dr / still-not-found) over those
 * rows so stale ones reconcile.
 *
 * --commit drives the real processOneItem() from the queue-processor service,
 * so the classification is identical to the live nightly path (no drift). The
 * service's match branch resolves a lingering active record; wrong/swap →
 * needs_investigation; serial-on-other-drop → serial_other_dr; genuinely
 * absent → stays not_found.
 *
 * Usage:
 *   tsx scripts/reexamine-olt-not-found.ts            # DRY RUN (read-only preview)
 *   tsx scripts/reexamine-olt-not-found.ts --commit   # re-classify via service
 *
 * Reads DATABASE_URL from the environment. Never hardcode credentials.
 *
 * Status: WORKING | NLNH Confidence: HIGH
 */

import { Pool } from 'pg';
import { oneMapApi } from '@/modules/system/services/oneMapApiService';
import {
  processOneItem,
  findSerialOnOtherDr,
  type QueueItem,
} from '@/modules/data-sync/services/oltQueueProcessorService';

const COMMIT = process.argv.includes('--commit');
const STAGGER_MS = 350;

interface NotFoundRow {
  id: string;
  drop_number: string;
  olt_serial: string | null;
  oes_batch_id: string | null;
  import_id: string | null;
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL is not set');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: databaseUrl });
  const client = await pool.connect();

  const buckets = { now_match: 0, now_other: 0, serial_other_dr: 0, still_not_found: 0, errored: 0 };
  const samples: string[] = [];

  try {
    const { rows } = await client.query<NotFoundRow>(
      `SELECT id, drop_number, olt_serial, oes_batch_id, import_id
       FROM olt_mismatch_records
       WHERE fix_status = 'not_found'
       ORDER BY created_at DESC`
    );
    console.log(`${COMMIT ? '[COMMIT]' : '[DRY RUN]'} re-examining ${rows.length} not_found records...\n`);

    let scanned = 0;
    for (const row of rows) {
      scanned++;
      if (!row.olt_serial) { buckets.still_not_found++; continue; }
      const oesSerial = row.olt_serial.trim().toUpperCase();

      try {
        if (COMMIT) {
          // Find the live queue row id (so the queue tracker updates too); 0 if
          // none — the queue UPDATEs then no-op and only the record is touched.
          const q = await client.query(
            `SELECT id FROM olt_onemap_lookup_queue WHERE drop_number = $1 ORDER BY id DESC LIMIT 1`,
            [row.drop_number]
          );
          const item: QueueItem = {
            id: q.rows[0]?.id ?? 0,
            drop_number: row.drop_number,
            oes_serial: row.olt_serial,
            oes_batch_id: row.oes_batch_id ?? '',
            team: '',
          };
          await processOneItem(client, item, row.import_id ?? undefined);
        } else {
          // Read-only preview: approximate the outcome without writing.
          const dr = await oneMapApi.searchDR(row.drop_number);
          if (dr.success && dr.records.length > 0) {
            const matched = dr.records.some(
              (r) => r.ph_ont?.trim().toUpperCase() === oesSerial,
            );
            if (matched) { buckets.now_match++; if (samples.length < 15) samples.push(`${row.drop_number}  now MATCH`); }
            else { buckets.now_other++; if (samples.length < 15) samples.push(`${row.drop_number}  now MISMATCH (needs investigation)`); }
          } else {
            const other = await findSerialOnOtherDr(client, {
              drop_number: row.drop_number,
              oes_serial: row.olt_serial,
            });
            if (other) { buckets.serial_other_dr++; if (samples.length < 15) samples.push(`${row.drop_number}  → serial on ${other.foundOnDr}`); }
            else { buckets.still_not_found++; }
          }
        }
      } catch (err) {
        buckets.errored++;
        console.warn(`  ! ${row.drop_number}: ${err instanceof Error ? err.message : String(err)}`);
      }

      if (scanned % 25 === 0) console.log(`  ...${scanned}/${rows.length}`);
      await new Promise((r) => setTimeout(r, STAGGER_MS));
    }

    if (COMMIT) {
      const after = await client.query(
        `SELECT fix_status, count(*)::int AS n
         FROM olt_mismatch_records
         WHERE drop_number = ANY($1::text[])
         GROUP BY fix_status ORDER BY n DESC`,
        [rows.map((r) => r.drop_number)]
      );
      console.log('\n──────── AFTER (fix_status of the re-examined drops) ────────');
      for (const a of after.rows) console.log(`  ${a.fix_status.padEnd(22)} ${a.n}`);
      console.log(`  errored (unchanged):   ${buckets.errored}`);
    } else {
      console.log('\n──────── DRY RUN PREVIEW ────────');
      console.log(`  now MATCH (→ resolved):        ${buckets.now_match}`);
      console.log(`  now MISMATCH (→ investigate):  ${buckets.now_other}`);
      console.log(`  serial on other DR:            ${buckets.serial_other_dr}`);
      console.log(`  still not_found:               ${buckets.still_not_found}`);
      console.log(`  errored:                       ${buckets.errored}`);
      if (samples.length) {
        console.log('\nSamples:');
        for (const s of samples) console.log(`  ${s}`);
      }
      console.log('\nRe-run with --commit to apply via the queue-processor service.');
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Re-examine failed:', err);
  process.exit(1);
});
