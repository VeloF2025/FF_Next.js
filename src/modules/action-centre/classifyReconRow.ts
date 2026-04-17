/**
 * Pure classification of a recon row.
 *
 * Given FT's billed serial + our local OES + 1Map fix + OLT-rejected state,
 * decide which dispute/fix bucket a DR falls into. No live 1Map calls, no
 * DB access — pure function so we can cover every branch in unit tests.
 *
 * See docs/rfcs/2026-04-17-action-centre-and-dr-timeline.md §5 for the
 * behavioural contract of each bucket.
 */

export type Classification =
  | 'already_fixed_still_billed'
  | 'actionable'
  | 'blocked_no_installed'
  | 'no_oes'
  | 'unknown';

export interface ClassifyInput {
  oesSerial: string | null;
  ftSerial: string | null;
  lastFixSerial: string | null;
  lastFixAt: string | null;
  oltRejected: boolean;
}

export function classifyReconRow(input: ClassifyInput): Classification {
  if (!input.oesSerial) return 'no_oes';

  if (input.lastFixSerial && input.lastFixAt) {
    // We wrote to 1Map at some point. If our fix matches OES, then FT's
    // continued billing is disputable — we already corrected the record.
    const fixedMatches =
      input.lastFixSerial.toUpperCase() === input.oesSerial.toUpperCase();
    if (fixedMatches) return 'already_fixed_still_billed';
  }

  if (input.oltRejected) return 'blocked_no_installed';

  return 'actionable';
}
