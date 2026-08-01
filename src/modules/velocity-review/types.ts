export const CANDIDATE_SOURCES = [
  'dr_submitted',
  'drops_installed',
  'stock_installed',
  'oes_activated',
  'pp_activated',
  'olt_mismatch_created',
] as const;

export type CandidateSource = typeof CANDIDATE_SOURCES[number];
export type PhoneSource = 'onemap' | 'subscriber_cache' | 'qcontact';
export type ConsentEvidenceSource = 'onemap_home_signup' | 'onemap_install_signature';
export const QUARANTINE_REASONS = [
  'no_safe_phone',
  'phone_conflict',
  'consent_missing',
  'consent_withdrawn',
] as const;
export type QuarantineReason = typeof QUARANTINE_REASONS[number];
export type ExportState =
  | 'ready'
  | 'upserting'
  | 'contact_upserted'
  | 'trigger_requested'
  | 'retryable_failure'
  | 'ambiguous'
  | 'ack_cleanup_pending'
  | 'completed'
  | 'permanent_failure';

export interface ConsentEvidence {
  source: ConsentEvidenceSource;
  grantedAt: Date;
}

export interface CandidateDbRow {
  dr_number: string;
  sources: CandidateSource[];
  onemap_phone: string | null;
  subscriber_phone: string | null;
  qcontact_phone: string | null;
  contact_name: string | null;
  contact_surname: string | null;
  home_signup_date: Date | string | null;
  signature_present: boolean;
  signature_evidence_at: Date | string | null;
}

export interface PreparedCandidate {
  drNumber: string;
  sources: CandidateSource[];
  msisdn: string;
  phoneE164: string;
  phoneFingerprint: string;
  phoneSource: PhoneSource;
  firstName: string;
  lastName: string | null;
  consentEvidence: ConsentEvidence;
}

export type CandidateDecision =
  | { status: 'ready'; candidate: PreparedCandidate }
  | { status: 'quarantined'; drNumber: string; reason: QuarantineReason };

export interface RunSummaryCounts {
  [count: string]: number;
}

export const RUN_SUMMARY_COUNT_KEYS = [
  'candidate_total', 'ready', 'contacts_upserted', 'duplicates', 'quarantined',
  'completed', 'permanent_failure', 'retryable', 'ambiguous',
  'ack_cleanup_pending', 'pilot_deferred',
  ...CANDIDATE_SOURCES.map((source) => `source_${source}`),
  ...QUARANTINE_REASONS.map((reason) => `quarantine_${reason}`),
] as const;

export function workflowAcknowledgedCount(counts: RunSummaryCounts): number {
  return (counts.completed ?? 0) + (counts.ack_cleanup_pending ?? 0);
}
