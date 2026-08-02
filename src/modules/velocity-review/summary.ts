import type { VelocityReviewRunResult } from './processor';
import { workflowAcknowledgedCount } from './types';

export interface VelocityReviewSummary {
  subject: string;
  text: string;
  html: string;
}

const COUNT_ROWS = [
  ['candidate_total', 'Discovered'],
  ['ready', 'Ready'],
  ['contacts_upserted', 'Contacts upserted'],
  ['duplicates', 'Duplicates'],
  ['quarantined', 'Quarantined'],
  ['source_dr_submitted', 'Source — DR submitted'],
  ['source_drops_installed', 'Source — drops installed'],
  ['source_stock_installed', 'Source — stock installed'],
  ['source_oes_activated', 'Source — OES activated'],
  ['source_pp_activated', 'Source — PP activated'],
  ['source_olt_mismatch_created', 'Source — OLT mismatch created'],
  ['quarantine_no_safe_phone', 'Quarantine — no safe phone'],
  ['quarantine_phone_conflict', 'Quarantine — phone conflict'],
  ['quarantine_consent_missing', 'Quarantine — consent missing'],
  ['quarantine_consent_withdrawn', 'Quarantine — consent withdrawn'],
  ['completed', 'Workflow acknowledged'],
  ['permanent_failure', 'Permanent failures'],
  ['retryable', 'Retryable failures'],
  ['ambiguous', 'Ambiguous'],
  ['ack_cleanup_pending', 'Acknowledgement cleanup pending'],
  ['pilot_deferred', 'Pilot deferred'],
  ['deadline_deferred', 'Deadline deferred'],
] as const;

function sastToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

function subjectStatus(status: VelocityReviewRunResult['status']): string {
  if (status === 'dry_run') return 'dry run';
  if (status === 'complete' || status === 'partial' || status === 'blocked' || status === 'pilot') return status;
  return 'blocked';
}

export function buildRunSummary(result: VelocityReviewRunResult): VelocityReviewSummary {
  const targetDate = result.dates.at(-1)?.targetDate ?? sastToday();
  const rows = COUNT_ROWS.map(([key, label]) => ({
    label,
    value: key === 'completed' ? workflowAcknowledgedCount(result.counts) : result.counts[key] ?? 0,
  }));
  const dates = result.dates.map((item) => `${item.targetDate} (${item.status})`);
  const reason = result.reason === 'invalid_control' || result.reason === 'gap_older_than_7_days'
    ? result.reason : null;
  const textLines = [
    `Status: ${subjectStatus(result.status)}`,
    `Target dates: ${dates.length > 0 ? dates.join(', ') : 'none'}`,
    ...rows.map((row) => `${row.label}: ${row.value}`),
    ...(reason ? [`Reason: ${reason}`] : []),
  ];
  const htmlRows = rows.map((row) => `<tr><th>${row.label}</th><td>${row.value}</td></tr>`).join('');
  const html = [
    '<h1>Velocity review export</h1>',
    `<p>Status: ${subjectStatus(result.status)}</p>`,
    `<p>Target dates: ${dates.length > 0 ? dates.join(', ') : 'none'}</p>`,
    `<table>${htmlRows}</table>`,
    ...(reason ? [`<p>Reason: ${reason}</p>`] : []),
  ].join('');
  return {
    subject: `Velocity review export — ${targetDate} — ${subjectStatus(result.status)}`,
    text: textLines.join('\n'),
    html,
  };
}
