/**
 * ontSerialSync.ts — recurring ONT/Gizzu serial intake from the Velocity-
 * maintained SharePoint master workbook (issue #1864).
 *
 * Downloads "ONT & Gizzu Serials.xlsx" from an anonymous SharePoint share,
 * parses it, and receives any new serials into stock_serials via receiveSerials
 * (idempotent). After import it measures the residual #1864 gap (ONT serials
 * Active in OES but still absent from stock) so a stale/incomplete source file
 * is visible rather than silent.
 *
 * The share is an anonymous "anyone with link" download — no auth/cookies. The
 * full download URL (including the share token, a capability secret) is supplied
 * via the ONT_SERIAL_SHEET_URL env var and is NOT committed to the repo. Use the
 * SharePoint "…/_layouts/15/download.aspx?share=<ShareId>" form so fetch yields
 * the raw xlsx rather than the HTML viewer.
 */

import type { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { log } from '@/lib/logger';
import { receiveSerials } from './serialIntake';
import { closeOesIntakeGap, liveGapDeps } from './oesIntakeGap';
import type { OesIntakeGapReport } from './oesIntakeGap';
import { parseOntGizzuWorkbook } from './ontSerialWorkbook';
import type { UnresolvedSheet, ParsedWorkbook } from './ontSerialWorkbook';
import type { LocationRef } from './sheetLocation';

/** Warn if more than this many OES-active ONTs remain unreceived after a sync. */
const GAP_WARN_THRESHOLD = 50;

const DOWNLOAD_TIMEOUT_MS = 60_000;

export interface OntSerialSyncReport {
  ontReceived: number;
  ontSkipped: number;
  gizzuReceived: number;
  gizzuSkipped: number;
  skippedSheets: string[];
  /** Tabs that produced nothing, each with the reason and the rows it cost. */
  unresolvedSheets: UnresolvedSheet[];
  /** Tabs whose stock imported but could not be tied to exactly one project. */
  unallocatedSheets: ParsedWorkbook['unallocatedSheets'];
  /** Serials imported without an allocation, across all such tabs. */
  serialsWithoutAllocation: number;
  /** Serial-bearing rows lost across all unresolved project tabs. */
  rowsLostToUnresolvedSheets: number;
  /** The #1864 receive-and-promote pass run before the gap was measured. */
  oesIntakeGap: OesIntakeGapReport;
  /** OES-active ONT serials still not present in stock_serials after this run. */
  oesGapRemaining: number;
  /** True when oesGapRemaining exceeds the warn threshold (source likely stale/incomplete). */
  sourceLikelyStale: boolean;
}

/** Download the master workbook bytes from the anonymous SharePoint share. */
async function downloadWorkbook(url: string): Promise<Buffer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (FibreFlow ONT serial sync)' },
      signal: controller.signal,
    });
    if (!resp.ok) {
      throw new Error(`SharePoint download failed: HTTP ${resp.status} ${resp.statusText}`);
    }
    const ct = resp.headers.get('content-type') ?? '';
    if (ct.includes('text/html')) {
      // SharePoint serves the login page as 200 text/html when the share is no
      // longer anonymous — surface that explicitly instead of parsing garbage.
      throw new Error(
        'SharePoint returned HTML (login page) — the share link is no longer anonymous. ' +
          'Re-enable "anyone with the link" sharing on the master workbook.',
      );
    }
    const buf = Buffer.from(await resp.arrayBuffer());
    if (buf.length < 1024) {
      throw new Error(`Downloaded workbook is implausibly small (${buf.length} bytes)`);
    }
    return buf;
  } finally {
    clearTimeout(timer);
  }
}

async function measureOesGap(pool: Pool): Promise<number> {
  const { rows } = await pool.query<{ gap: string }>(
    `SELECT count(DISTINCT upper(trim(oa.serial_number)))::int AS gap
       FROM oes_activations oa
      WHERE oa.serial_number ILIKE 'ALCL%'
        AND NOT EXISTS (
          SELECT 1 FROM stock_serials ss
           WHERE ss.serial_number = upper(trim(oa.serial_number))
        )`,
  );
  return Number(rows[0]?.gap ?? 0);
}

/**
 * Run a full sync: download → parse → receive ONT + Gizzu → measure residual gap.
 * Throws on download/parse failure (cron maps to a non-2xx so the failure is
 * visible in cron logs).
 */
export async function syncOntSerialsFromSharePoint(pool: Pool): Promise<OntSerialSyncReport> {
  const url = process.env.ONT_SERIAL_SHEET_URL;
  if (!url) {
    throw new Error(
      'ONT_SERIAL_SHEET_URL is not set — configure the SharePoint anonymous ' +
        'download.aspx?share=<ShareId> URL for the ONT & Gizzu master workbook.',
    );
  }

  const buf = await downloadWorkbook(url);
  const XLSX = await import('xlsx');
  const workbook = XLSX.read(buf, { type: 'buffer' });
  // Warehouses come from the database so a new project imports as soon as it
  // has one — the hardcoded map this replaced dropped whole tabs in silence.
  const locRows = await pool.query<{ id: string; name: string }>(
    `SELECT id, name FROM stock_locations WHERE location_type = 'warehouse'`,
  );
  const locations: LocationRef[] = locRows.rows;

  // The tab also names the PROJECT the stock is allocated to. That is what the
  // workbook actually asserts; the warehouse is only where we assume it sits.
  const projRows = await pool.query<{ id: string; name: string }>(
    `SELECT id, project_name AS name FROM projects`,
  );

  const parsed = parseOntGizzuWorkbook(workbook, XLSX, locations, projRows.rows);

  // A tab whose stock imported but could not be tied to a project is a real
  // reporting gap — the allocation is the thing the sheet exists to record.
  for (const u of parsed.unallocatedSheets) {
    log.warn(
      'ONT serial sync: tab imported but NOT allocated to a project',
      { sheet: u.sheetName, reason: u.reason, serials: u.serialsUnallocated, candidates: u.candidates },
      'ont-serial-sync',
    );
  }

  // A tab that carries serials but resolves to no warehouse is a real loss, not
  // a summary tab being ignored. Say so at warn level with the row count.
  const costly = parsed.unresolvedSheets.filter(
    (u) => u.reason !== 'not-a-project' && u.rowsLost > 0,
  );
  for (const u of costly) {
    log.warn(
      'ONT serial sync: tab not imported',
      { sheet: u.sheetName, reason: u.reason, rowsLost: u.rowsLost, candidates: u.candidates },
      'ont-serial-sync',
    );
  }

  const reference = `FT SharePoint Sync ${new Date().toISOString().split('T')[0]}`;
  const sourceId = randomUUID();

  const ont = await receiveSerials(pool, parsed.ontItems, {
    sourceTable: 'ont_serial_sync',
    sourceId,
    receivedReference: reference,
    payload: { source: 'sharepoint_sync', kind: 'ont' },
  });
  const gizzu = await receiveSerials(pool, parsed.gizzuItems, {
    sourceTable: 'ont_serial_sync',
    sourceId,
    receivedReference: reference,
    payload: { source: 'sharepoint_sync', kind: 'gizzu' },
  });

  // Close the #1864 gap before measuring it: OES-active serials with no stock
  // row are received and promoted to `activated` in the same pass, so they
  // never sit as location-less `in_stock` rows that any warehouse could issue.
  // The sync used to only ever report this number, which is why it never moved.
  //
  // Wrapped: this is a reconciliation pass bolted onto a sheet import. If it
  // fails, the sheet import that already succeeded must still be reported.
  let oesIntakeGap: OesIntakeGapReport;
  try {
    oesIntakeGap = await closeOesIntakeGap(pool, liveGapDeps(pool));
  } catch (error) {
    log.error(
      'OES intake gap pass failed — sheet import above still applied',
      { error },
      'ont-serial-sync',
    );
    oesIntakeGap = {
      candidates: 0, received: 0, skipped: 0, promoted: 0, stillInStock: 0, promotionFailed: true,
    };
  }

  // Logged whenever the pass did ANYTHING — not gated on `candidates`, because
  // the self-healing branch promotes with zero candidates by design, and an
  // unattended write to `activated` on a shared database must never be silent.
  if (
    oesIntakeGap.candidates > 0 ||
    oesIntakeGap.promoted > 0 ||
    oesIntakeGap.stillInStock > 0 ||
    oesIntakeGap.promotionFailed
  ) {
    log.info(
      'OES intake gap pass',
      {
        candidates: oesIntakeGap.candidates,
        received: oesIntakeGap.received,
        promoted: oesIntakeGap.promoted,
        stillInStock: oesIntakeGap.stillInStock,
        promotionFailed: oesIntakeGap.promotionFailed ?? false,
      },
      'ont-serial-sync',
    );
  }

  const oesGapRemaining = await measureOesGap(pool);
  const sourceLikelyStale = oesGapRemaining > GAP_WARN_THRESHOLD;

  const report: OntSerialSyncReport = {
    ontReceived: ont.received,
    ontSkipped: ont.skipped,
    gizzuReceived: gizzu.received,
    gizzuSkipped: gizzu.skipped,
    skippedSheets: parsed.skippedSheets,
    oesIntakeGap,
    unresolvedSheets: parsed.unresolvedSheets,
    unallocatedSheets: parsed.unallocatedSheets,
    serialsWithoutAllocation: parsed.unallocatedSheets.reduce((n, u) => n + u.serialsUnallocated, 0),
    rowsLostToUnresolvedSheets: costly.reduce((n, u) => n + u.rowsLost, 0),
    oesGapRemaining,
    sourceLikelyStale,
  };

  if (sourceLikelyStale) {
    log.warn(
      'ontSerialSync: OES gap still high after sync — master workbook may be stale/incomplete',
      { oesGapRemaining, ontReceived: ont.received },
      'ontSerialSync',
    );
  }
  log.info('ontSerialSync: complete', { ...report }, 'ontSerialSync');
  return report;
}
