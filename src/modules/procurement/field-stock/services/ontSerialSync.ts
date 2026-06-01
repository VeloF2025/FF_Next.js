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
import { parseOntGizzuWorkbook } from './ontSerialWorkbook';

/** Warn if more than this many OES-active ONTs remain unreceived after a sync. */
const GAP_WARN_THRESHOLD = 50;

const DOWNLOAD_TIMEOUT_MS = 60_000;

export interface OntSerialSyncReport {
  ontReceived: number;
  ontSkipped: number;
  gizzuReceived: number;
  gizzuSkipped: number;
  skippedSheets: string[];
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
    `SELECT count(DISTINCT upper(oa.serial_number))::int AS gap
       FROM oes_activations oa
      WHERE oa.serial_number ILIKE 'ALCL%'
        AND NOT EXISTS (
          SELECT 1 FROM stock_serials ss WHERE ss.serial_number = oa.serial_number
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
  const parsed = parseOntGizzuWorkbook(workbook, XLSX);

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

  const oesGapRemaining = await measureOesGap(pool);
  const sourceLikelyStale = oesGapRemaining > GAP_WARN_THRESHOLD;

  const report: OntSerialSyncReport = {
    ontReceived: ont.received,
    ontSkipped: ont.skipped,
    gizzuReceived: gizzu.received,
    gizzuSkipped: gizzu.skipped,
    skippedSheets: parsed.skippedSheets,
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
