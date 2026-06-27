/** Pure formatters + contract types for Cortex grounded-answer rendering.
 *
 * Mirrors the bridge contract (apps/bridge/brain/evidence.py). The data shapes use
 * the enumerated unions for exhaustiveness; the label mappers below accept the wider
 * `string` ON PURPOSE — they are the runtime boundary for untrusted / forward-compatible
 * payloads (a future bridge gap type or confidence level must degrade, not crash).
 */

export type Confidence = 'high' | 'medium' | 'low';
export type GapType = 'missing' | 'low_evidence' | 'stale' | 'conflicting';

export interface AnswerGap {
  type: GapType;
  description: string;
  suggested_follow_up: string;
}

const CONFIDENCE_LABELS: Record<string, string> = {
  high: 'High confidence',
  medium: 'Medium confidence',
  low: 'Low confidence',
};

/** Map the bridge confidence level to a display label; 'Unverified' for unknowns. */
export function confidenceLabel(confidence: string): string {
  return CONFIDENCE_LABELS[confidence] ?? 'Unverified';
}

const GAP_LABELS: Record<string, string> = {
  missing: 'No evidence',
  low_evidence: 'Limited evidence',
  stale: 'Possibly outdated',
  conflicting: 'Conflicting sources',
};

/** Map a bridge gap type to a short banner label; 'Note' for unknowns. */
export function gapLabel(type: string): string {
  return GAP_LABELS[type] ?? 'Note';
}
