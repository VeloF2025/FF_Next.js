/** Shared shape of the paper-sheet capture response. */

export interface SheetSummary {
  sheetId: string;
  total: number;
  alreadyRecorded: number;
  /** The actionable finding: stock the system would still hand out. */
  contradictsStock: number;
  unknownSerial: number;
  unclassified: number;
  serials: Array<{ serialNumber: string; status: string | null; verdict: string }>;
}
