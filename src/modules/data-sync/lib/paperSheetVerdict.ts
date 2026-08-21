/**
 * paperSheetVerdict — what a serial scanned off a historical paper sheet means.
 *
 * A serial on an old install sheet is NOT a receipt. The ONT left the shelf
 * months ago; the paper is a record of that, and scanning it is a claim about
 * the past which the system may already know, may contradict, or may never
 * have heard of.
 *
 * Measured against the 21 sheets captured in May 2026 (190 ONT serials):
 *
 *   activated              137  (72%)  already recorded — nothing to do
 *   not in stock_serials    43  (23%)  never entered the system
 *   in_stock                10  ( 5%)  the system thinks it is ON THE SHELF
 *
 * The last group is the one that matters. Those ten sit at Mamelodi Pop1 as
 * available stock while the paper says they were handed out in May, and
 * several carry a DR number — so they went to a named customer. A storeman
 * could issue one today to somebody else.
 *
 * This module CLASSIFIES only. It deliberately writes nothing: back-dating
 * stock movement is irreversible, 72% of rows need no action at all, and what
 * the unknown ones should become is a decision that has not been taken.
 */

/** Statuses meaning the ONT has genuinely left the shelf. */
const GONE_STATUSES: readonly string[] = ['activated', 'issued', 'installed'];
/** Statuses meaning the system believes the ONT is still available to issue. */
const ON_SHELF_STATUSES: readonly string[] = ['available', 'in_stock'];

export type PaperSheetVerdict =
  /** The system already knows this one left. Nothing to do. */
  | 'already-recorded'
  /** The system thinks it is on the shelf; the paper says it went out. */
  | 'contradicts-stock'
  /** No stock row at all — the serial never entered the system. */
  | 'unknown-serial'
  /** A status we do not have a rule for. Surfaced rather than guessed at. */
  | 'unclassified';

export interface PaperSheetSerial {
  serialNumber: string;
  /** Status from stock_serials, or null when there is no row. */
  status: string | null;
}

export interface ClassifiedSerial extends PaperSheetSerial {
  verdict: PaperSheetVerdict;
}

/**
 * Classify one scanned serial against what stock currently says.
 *
 * `null` status means no row exists — distinct from a row whose status we do
 * not recognise, which is reported as 'unclassified' rather than quietly
 * folded into one of the known buckets.
 */
export function verdictForPaperSerial(serial: PaperSheetSerial): PaperSheetVerdict {
  if (serial.status === null) return 'unknown-serial';
  if (GONE_STATUSES.includes(serial.status)) return 'already-recorded';
  if (ON_SHELF_STATUSES.includes(serial.status)) return 'contradicts-stock';
  return 'unclassified';
}

export interface PaperSheetSummary {
  total: number;
  alreadyRecorded: number;
  /** The actionable finding: stock the system would still hand out. */
  contradictsStock: number;
  unknownSerial: number;
  unclassified: number;
  serials: ClassifiedSerial[];
}

/** Classify a whole scanned sheet, keeping per-serial detail for the UI. */
export function summarisePaperSheet(serials: PaperSheetSerial[]): PaperSheetSummary {
  const classified = serials.map((s) => ({ ...s, verdict: verdictForPaperSerial(s) }));
  const count = (v: PaperSheetVerdict) => classified.filter((c) => c.verdict === v).length;
  return {
    total: classified.length,
    alreadyRecorded: count('already-recorded'),
    contradictsStock: count('contradicts-stock'),
    unknownSerial: count('unknown-serial'),
    unclassified: count('unclassified'),
    serials: classified,
  };
}
