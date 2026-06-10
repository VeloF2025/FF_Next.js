/**
 * Pure classification of a weekly FT billing deduction against our own
 * evidence. No DB access, no live 1Map calls — pure function so every
 * branch is unit-testable (pattern mirrors classifyReconRow.ts).
 *
 * FT note semantics (see non-invoiceables/types.ts NOTE_TO_CATEGORY):
 *   note1 — Low Signal (< -26 dBm)        → check our latest OES RX reading
 *   note2 — No entry on Field App         → check our DR submission record
 *   note3 — Degraded (> 2dB vs budget)    → monitor-only, never judged
 *   note4 — Drop#/serial mismatch on OLT  → check 1Map fix history vs OES
 *   note5 — Offline / fiber break         → check OES status + offline evidence
 *
 * Evidence is "as of latest sync", not as of FT's snapshot — the verdict
 * evidence JSON carries timestamps so a dispute pack can state this.
 */

export type DeductionVerdict = 'legitimate' | 'disputable' | 'insufficient_evidence';

export const LOW_SIGNAL_THRESHOLD_DBM = -26;

/**
 * Single source of truth for picking the RX reading: active ONTs use the
 * activation-date reading (the authoritative billing value); non-active ONTs
 * prefer the latest polled reading (current_ont_rx), falling back to the
 * activation reading. Shared by the verdict service and billing-crossref so
 * the Disputes UI and the verifier always judge the same number.
 */
export function selectSignalDbm(
  oesStatus: string | null,
  activationRx: number | null,
  currentRx: number | null,
): number | null {
  const active = (oesStatus ?? '').toLowerCase() === 'active';
  return active ? activationRx : (currentRx ?? activationRx);
}

/**
 * Parse the reasons array out of verdict_evidence->>'reasons'. Never throws —
 * malformed JSON yields []. Callers log if the empty result matters to them.
 */
export function parseVerdictReasons(raw: string | null): string[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (err) {
    // Pure module — no logger import; surface the parse problem in the value.
    parsed = [`unparseable verdict reasons: ${err instanceof Error ? err.message : String(err)}`];
  }
  return Array.isArray(parsed) ? parsed.map(String) : [];
}

export interface DeductionEvidence {
  noteCode: string;
  // OES (network truth, latest sync)
  oesStatus: string | null;
  oesSerial: string | null;
  oesActivatedAt: string | null;
  /** Best available RX reading: current_ont_rx for inactive ONTs, else activation RX. */
  signalDbm: number | null;
  // Field submission (WhatsApp → dr_photo_unified_reviews)
  hasDrRecord: boolean;
  waReceivedAt: string | null;
  // 1Map fix history (serial_change_history, olt_report_fix)
  lastFixSerial: string | null;
  lastFixAt: string | null;
  /** olt_mismatch_records.fix_status for this DR, if any. */
  oltFixStatus: string | null;
  // Offline evidence (offline_devices within the report window)
  offlineConfirmed: boolean;
  offlineReason: string | null;
  offlineRecoveredAt: string | null;
}

export interface VerdictResult {
  verdict: DeductionVerdict | null;
  /** Human-readable reasons, included in the evidence JSON and dispute pack. */
  reasons: string[];
}

export function classifyDeductionVerdict(e: DeductionEvidence): VerdictResult {
  switch (e.noteCode) {
    case 'note1': return classifyNote1(e);
    case 'note2': return classifyNote2(e);
    case 'note4': return classifyNote4(e);
    case 'note5': return classifyNote5(e);
    default:
      // note3 is monitor-only; unknown notes are never judged.
      return { verdict: null, reasons: ['note is monitor-only or unknown — not judged'] };
  }
}

/** Note 1 — FT claims RX below -26 dBm. Disputable if our reading is healthy. */
function classifyNote1(e: DeductionEvidence): VerdictResult {
  if (e.signalDbm === null) {
    return { verdict: 'insufficient_evidence', reasons: ['no RX reading in our OES data'] };
  }
  if (e.signalDbm > LOW_SIGNAL_THRESHOLD_DBM) {
    return {
      verdict: 'disputable',
      reasons: [`our latest RX is ${e.signalDbm} dBm (healthier than ${LOW_SIGNAL_THRESHOLD_DBM} dBm threshold)`],
    };
  }
  return { verdict: 'legitimate', reasons: [`our latest RX is ${e.signalDbm} dBm (at/below threshold)`] };
}

/** Note 2 — FT claims no field-app entry. Disputable if we hold a DR submission. */
function classifyNote2(e: DeductionEvidence): VerdictResult {
  if (e.hasDrRecord) {
    const when = e.waReceivedAt ? ` (received ${e.waReceivedAt.slice(0, 10)})` : '';
    return { verdict: 'disputable', reasons: [`DR submission exists in FibreFlow${when}`] };
  }
  return { verdict: 'legitimate', reasons: ['no DR submission record found on our side'] };
}

/**
 * Note 4 — FT claims drop#/serial mismatch between OLT and the field entry.
 * Disputable if we already wrote the OES-matching serial to 1Map, or the
 * mismatch record is closed on our side.
 */
function classifyNote4(e: DeductionEvidence): VerdictResult {
  if (!e.oesSerial) {
    return { verdict: 'insufficient_evidence', reasons: ['no OES activation record for this DR'] };
  }
  if (
    e.lastFixSerial &&
    e.lastFixSerial.toUpperCase() === e.oesSerial.toUpperCase()
  ) {
    const when = e.lastFixAt ? ` on ${e.lastFixAt.slice(0, 10)}` : '';
    return {
      verdict: 'disputable',
      reasons: [`1Map serial already corrected to match OES (${e.oesSerial})${when}`],
    };
  }
  if (e.oltFixStatus === 'fixed' || e.oltFixStatus === 'resolved') {
    return {
      verdict: 'disputable',
      reasons: [`our OLT mismatch record is ${e.oltFixStatus} — mismatch was addressed`],
    };
  }
  return { verdict: 'legitimate', reasons: ['mismatch not yet fixed on our side'] };
}

/**
 * Note 5 — FT claims device offline / fiber break. Disputable if OES shows
 * the ONT active, or our offline tracking shows it recovered, or the only
 * offline evidence is a transient Dying Gasp.
 */
function classifyNote5(e: DeductionEvidence): VerdictResult {
  const oesActive = (e.oesStatus ?? '').toLowerCase() === 'active';

  if (e.offlineConfirmed && !e.offlineRecoveredAt && e.offlineReason !== 'Dying Gasp') {
    return { verdict: 'legitimate', reasons: [`offline confirmed by our sync (${e.offlineReason ?? 'reason unknown'})`] };
  }
  if (e.offlineRecoveredAt) {
    return { verdict: 'disputable', reasons: [`device recovered on ${e.offlineRecoveredAt.slice(0, 10)}`] };
  }
  if (e.offlineConfirmed && e.offlineReason === 'Dying Gasp') {
    return { verdict: 'disputable', reasons: ['only offline evidence is a transient Dying Gasp'] };
  }
  if (oesActive) {
    return { verdict: 'disputable', reasons: ['ONT shows Active on latest OES report; no offline evidence in window'] };
  }
  if (!e.oesStatus) {
    return { verdict: 'insufficient_evidence', reasons: ['no OES record and no offline evidence'] };
  }
  return { verdict: 'legitimate', reasons: [`OES status is ${e.oesStatus}`] };
}
