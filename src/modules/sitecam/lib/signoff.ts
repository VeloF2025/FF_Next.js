/**
 * Customer sign-off (SiteCam step 10) — the consent statement and the pure
 * gate that decides when the sign-off may be confirmed. Kept framework-free so
 * the gating rule is unit-testable without a canvas/DOM.
 */

/** Consent the customer confirms before signing. */
export const SIGNOFF_CONSENT_TEXT =
  'I confirm the fibre installation at my premises is complete and working.';

export interface SignoffState {
  /** Printed customer name. */
  name: string;
  /** Whether the consent checkbox is ticked. */
  consent: boolean;
  /** The drawn signature as a data URL, or null when the pad is empty. */
  signatureDataUrl: string | null;
}

/**
 * The sign-off may be confirmed only when the customer has provided all three:
 * a printed name, the consent tick, and a signature.
 */
export function canSubmitSignoff({ name, consent, signatureDataUrl }: SignoffState): boolean {
  return name.trim().length > 0 && consent === true && signatureDataUrl !== null;
}
