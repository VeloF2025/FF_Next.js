/**
 * ontMismatchFallback — reclassify an ONT serial mismatch using the step-9
 * "Green Lights & DR Label" (ph_bl) photo extraction as a fallback.
 *
 * Context: the ONT serial-verification badge fires "Serial Mismatch" whenever a
 * photo-derived read disagrees with 1Map. Measured against OES (the ONT source of
 * truth), ~99% of those VLM-vs-1Map disagreements are VLM OCR misreads, not 1Map
 * errors — and ~19% of the photos are misattached to the wrong DR entirely. So a
 * raw mismatch flag is almost always noise.
 *
 * This fallback uses two facts already extracted from the ph_bl photo
 * (vlm_dr_number_step9, vlm_ont_serial_step9) plus OES to reclassify the mismatch:
 *   - OES confirms 1Map        → false alarm, suppress.
 *   - ph_bl DR# ≠ this drop     → misattached photo, the read is not evidence.
 *   - 1Map ≠ OES (OES present)  → genuine 1Map error; OES is the fix (cron path).
 *   - no OES + same-DR conflict → needs a human to read the ph_bl label.
 *
 * It NEVER auto-writes a serial. The VLM read is recon only.
 */

export type OntFallbackOutcome =
  | 'confirmed_oes'
  | 'wrong_photo'
  | 'oes_correction'
  | 'needs_human'
  | 'none';

export type VerificationStatus = 'gold' | 'silver' | 'bronze' | 'warning' | 'none';

export interface OntFallbackResult {
  outcome: OntFallbackOutcome;
  status: VerificationStatus;
  label: string;
  detail: string;
}

export interface OntFallbackInput {
  dropNumber: string;
  /** vlm_dr_number_step9 — DR number read off the ph_bl front label. */
  dr9: string | null;
  /** vlm_ont_serial_step9 — ONT serial read off the ph_bl front label. */
  ont9: string | null;
  /** ont_serial_scanned — the 1Map value. */
  onemap: string | null;
  /** oes_serial — OES activation serial (ONT source of truth) if present. */
  oes: string | null;
}

const norm = (s: string | null): string | null => (s ? s.trim().toUpperCase() : null);

/**
 * Reclassify an ONT mismatch. Call only when the ONT verification is already a
 * mismatch; returns outcome 'none' when the fallback has no better answer.
 */
export function classifyOntMismatch(input: OntFallbackInput): OntFallbackResult {
  const drop = norm(input.dropNumber);
  const dr9 = norm(input.dr9);
  const ont9 = norm(input.ont9);
  const onemap = norm(input.onemap);
  const oes = norm(input.oes);

  // 1. OES confirms 1Map → the disagreeing photo read is the outlier. 1Map stands.
  if (oes && onemap && oes === onemap) {
    return {
      outcome: 'confirmed_oes',
      status: 'bronze',
      label: 'Serial Confirmed (OES)',
      detail: 'ONT photo read differs, but OES confirms the 1Map serial — false-alarm mismatch suppressed.',
    };
  }

  // 2. Misattached photo: the ph_bl front label shows a different DR number, so
  //    its serial is not evidence for this drop. Do not treat as a 1Map error.
  if (dr9 && drop && dr9 !== drop) {
    return {
      outcome: 'wrong_photo',
      status: 'warning',
      label: 'Serial Mismatch — wrong photo',
      detail: `ONT front photo shows ${dr9}, not ${input.dropNumber}; the photo serial is not reliable evidence for this drop.`,
    };
  }

  // 3. OES present and differs from 1Map → genuine 1Map error; OES is the fix.
  if (oes && onemap && oes !== onemap) {
    return {
      outcome: 'oes_correction',
      status: 'warning',
      label: '1Map ≠ OES — correct to OES',
      detail: `1Map ${onemap} ≠ OES ${oes}; OES is the source of truth (handled by the recheck cron).`,
    };
  }

  // 4. No OES oracle, ph_bl DR# matches, and a real photo-vs-1Map conflict →
  //    a human must read the front label (VLM read is too unreliable to auto-act).
  if (!oes && dr9 && drop && dr9 === drop && ont9 && onemap && ont9 !== onemap) {
    return {
      outcome: 'needs_human',
      status: 'warning',
      label: 'Serial Mismatch — needs photo review',
      detail: `No OES oracle; ph_bl DR# matches but photo ONT ${ont9} ≠ 1Map ${onemap}. Human to verify from the front-label photo.`,
    };
  }

  return { outcome: 'none', status: 'warning', label: 'Serial Mismatch', detail: '' };
}
