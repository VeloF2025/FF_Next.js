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

/**
 * The full status vocabulary, from the CHECK constraint on stock_serials
 * (migration 387), verified against the live database 2026-08-21:
 *
 *   available  in_stock  allocated_to_project  issued  installed
 *   activated  faulty    returned              scrapped
 *
 * Every one is deliberately accounted for below. An earlier version covered
 * only five, which quietly sent four real statuses to 'unclassified'.
 */

/** The handout happened — the system already knows the ONT left the shelf. */
const GONE_STATUSES: readonly string[] = ['activated', 'issued', 'installed'];

/**
 * The system still believes this ONT is at the store and un-handed-out, so the
 * paper contradicts it.
 *
 * `allocated_to_project` belongs here even though it is not directly issuable
 * (ISSUABLE_STATUSES is available|in_stock): the paper says it went out in
 * May, while the system has it reserved and waiting. That belief is wrong and
 * someone should look.
 */
const ON_SHELF_STATUSES: readonly string[] = ['available', 'in_stock', 'allocated_to_project'];

/**
 * States that follow a handout OR follow stock never leaving — genuinely
 * ambiguous, so classified as 'unclassified' rather than guessed at.
 *
 * `returned` is the interesting one, and NOT a contradiction: the returns flow
 * is issue -> return -> inspect -> disposition, so a returned serial is at the
 * store awaiting inspection and is not issuable. The paper saying it was
 * handed out in May is entirely consistent with that. `faulty` and `scrapped`
 * are the same shape — reachable both from a unit that went out and came back,
 * and from one that was dead on arrival and never left.
 *
 * Listed explicitly so the next person can see they were considered, not
 * missed. These serials ARE named in the UI, not just counted.
 */
const AMBIGUOUS_STATUSES: readonly string[] = ['returned', 'faulty', 'scrapped'];

export type PaperSheetVerdict =
  /** The system already knows this one left. Nothing to do. */
  | 'already-recorded'
  /** The system thinks it is on the shelf; the paper says it went out. */
  | 'contradicts-stock'
  /** No stock row at all — the serial never entered the system. */
  | 'unknown-serial'
  /**
   * A status that is genuinely ambiguous (returned / faulty / scrapped), or one
   * the constraint has gained since this was written. Surfaced BY SERIAL rather
   * than guessed at or reduced to a count.
   */
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
  // AMBIGUOUS_STATUSES and anything the constraint gains later both land here.
  if (AMBIGUOUS_STATUSES.includes(serial.status)) return 'unclassified';
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
