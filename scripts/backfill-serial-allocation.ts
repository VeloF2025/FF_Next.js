#!/usr/bin/env tsx
/**
 * Backfill stock_serials.allocated_to_project_id from the SharePoint workbook.
 *
 * The workbook's tabs mean ALLOCATION — "these serials are earmarked for this
 * project". The importer wrote that into current_location_id instead, which
 * asserts physical presence: measured 2026-08-21, only 27.5% of sheet-imported
 * ONTs were installed on the project whose warehouse the tab assigned.
 *
 * Intake now records the allocation for NEW rows, but it is ON CONFLICT DO
 * NOTHING, so the 58,248 rows already in the table stay unallocated. This fills
 * them in — from the WORKBOOK, not from the warehouse. Inferring allocation
 * from the warehouse would just re-record the 27.5% claim this exists to stop.
 *
 * Writes ONE column and nothing else. All three stock_serials triggers
 * (status-validate, status-emit, holder-validate) fire on UPDATE as well as
 * INSERT, so the dry run proves on a real row, inside a rolled-back
 * transaction, that touching only this column emits no lifecycle event.
 *
 * Dry-run by default; pass --commit to apply.
 *
 * tsx conventions (see backfill-ont-intake-from-oes.ts): dotenv first; pg.Pool
 * directly; process.stdout (the pino logger is silent under tsx). The tab
 * resolver is imported by RELATIVE path — it is dependency-free, so the real
 * matching rules are reused rather than reimplemented here.
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { Pool } from 'pg';
import {
  resolveSheetTarget,
  PROJECT_ALIASES,
} from '../src/modules/procurement/field-stock/services/sheetLocation';
import type { NamedRef } from '../src/modules/procurement/field-stock/services/sheetLocation';

const out = (m: string): void => { process.stdout.write(`${m}\n`); };
const err = (m: string): void => { process.stderr.write(`${m}\n`); };

const MIN_SERIAL_LEN = 10;
const CHUNK = 500;

/** Same normalisation the workbook parser applies. */
function cleanSerial(s: string): string {
  let v = s.trim().toUpperCase();
  if (v.startsWith('3ALCL')) v = v.slice(1);
  return v;
}

async function downloadWorkbook(url: string): Promise<Buffer> {
  const resp = await fetch(url, {
    redirect: 'follow',
    headers: { 'User-Agent': 'Mozilla/5.0 (FibreFlow allocation backfill)' },
  });
  if (!resp.ok) throw new Error(`workbook download failed: HTTP ${resp.status}`);
  return Buffer.from(await resp.arrayBuffer());
}

/**
 * Prove, on a real row inside a rolled-back transaction, that writing only
 * allocated_to_project_id emits no serial lifecycle event.
 */
async function proveNoEventsEmitted(pool: Pool, serialNumber: string, projectId: string): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const before = await client.query<{ n: string }>('SELECT count(*) n FROM stock_serial_events');
    await client.query(
      `UPDATE stock_serials SET allocated_to_project_id = $1 WHERE serial_number = $2`,
      [projectId, serialNumber],
    );
    const after = await client.query<{ n: string }>('SELECT count(*) n FROM stock_serial_events');
    const emitted = Number(after.rows[0]!.n) - Number(before.rows[0]!.n);
    await client.query('ROLLBACK');
    out(`  trigger probe on ${serialNumber}: ${emitted} event(s) emitted`);
    return emitted === 0;
  } catch (e) {
    await client.query('ROLLBACK');
    err(`  trigger probe FAILED: ${e instanceof Error ? e.message : String(e)}`);
    return false;
  } finally {
    client.release();
  }
}

async function main(): Promise<void> {
  const commit = process.argv.includes('--commit');
  const url = process.env.ONT_SERIAL_SHEET_URL;
  if (!url) throw new Error('ONT_SERIAL_SHEET_URL is not set');
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const { rows: projects } = await pool.query<NamedRef>(
      `SELECT id, project_name AS name FROM projects`,
    );
    out(`Projects available: ${projects.length}`);

    const XLSX = await import('xlsx');
    const workbook = XLSX.read(await downloadWorkbook(url), { type: 'buffer' });

    // tab -> project, refusing anything the names cannot decide
    const byProject = new Map<string, string[]>();
    for (const sheetName of workbook.SheetNames) {
      const resolved = resolveSheetTarget(sheetName, projects, PROJECT_ALIASES);
      const rows = (
        XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]!, { header: 1 }) as unknown[][]
      ).slice(1);
      const serials = rows
        .flatMap((r) => [cleanSerial(String(r[1] ?? '')), cleanSerial(String(r[2] ?? ''))])
        .filter((s) => s.length >= MIN_SERIAL_LEN);

      if (!resolved.ok) {
        out(`  SKIP ${sheetName}: ${resolved.reason}${resolved.candidates ? ` (${resolved.candidates.join(', ')})` : ''} — ${serials.length} serial(s) left unallocated`);
        continue;
      }
      out(`  ${sheetName} -> ${resolved.locationName} (${resolved.how}): ${serials.length} serial(s)`);
      byProject.set(resolved.locationId, (byProject.get(resolved.locationId) ?? []).concat(serials));
    }

    // What would change: only rows that exist and have no allocation yet.
    let totalPending = 0;
    for (const [projectId, serials] of byProject) {
      const { rows } = await pool.query<{ n: string }>(
        `SELECT count(*) n FROM stock_serials
          WHERE serial_number = ANY($1::text[]) AND allocated_to_project_id IS NULL`,
        [serials],
      );
      const n = Number(rows[0]!.n);
      totalPending += n;
      out(`  project ${projectId}: ${n} serial(s) would be allocated`);
      if (n > 0 && !commit) {
        const { rows: sample } = await pool.query<{ serial_number: string }>(
          `SELECT serial_number FROM stock_serials
            WHERE serial_number = ANY($1::text[]) AND allocated_to_project_id IS NULL LIMIT 1`,
          [serials],
        );
        if (sample[0]) {
          const clean = await proveNoEventsEmitted(pool, sample[0].serial_number, projectId);
          if (!clean) {
            err('ABORTING GUIDANCE: the UPDATE emitted a lifecycle event — do NOT run --commit until that is understood.');
          }
        }
      }
    }

    out(`\nTotal to allocate: ${totalPending}`);
    if (!commit) {
      out('DRY RUN — nothing written. Re-run with --commit to apply.');
      return;
    }

    let updated = 0;
    for (const [projectId, serials] of byProject) {
      for (let i = 0; i < serials.length; i += CHUNK) {
        const res = await pool.query(
          `UPDATE stock_serials SET allocated_to_project_id = $1
            WHERE serial_number = ANY($2::text[]) AND allocated_to_project_id IS NULL`,
          [projectId, serials.slice(i, i + CHUNK)],
        );
        updated += res.rowCount ?? 0;
      }
    }
    out(`Allocated ${updated} serial(s).`);
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  err(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
