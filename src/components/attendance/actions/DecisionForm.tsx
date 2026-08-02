import { useState } from 'react';
import type {
  ApprovedHours,
  AttendanceClassification,
  DayExceptionItem,
} from '@/modules/attendance/workflow/types';

export interface AttendanceDecisionDraft {
  action: 'approve' | 'return' | 'classify';
  reason: string;
  approvedHours?: ApprovedHours;
  classification?: AttendanceClassification;
}

interface DecisionFormProps {
  item: DayExceptionItem;
  busy: boolean;
  onSubmit: (decision: AttendanceDecisionDraft) => void | Promise<void>;
}

const HOUR_FIELDS: readonly { key: keyof ApprovedHours; label: string }[] = [
  { key: 'regular', label: 'Regular' },
  { key: 'overtime', label: 'Overtime' },
  { key: 'sunday', label: 'Sunday' },
  { key: 'holiday', label: 'Holiday' },
  { key: 'leave', label: 'Leave' },
  { key: 'unpaid', label: 'Unpaid' },
];

const CLASSIFICATIONS: readonly { value: AttendanceClassification; label: string }[] = [
  { value: 'approved_leave', label: 'Approved leave' },
  { value: 'sick_leave', label: 'Sick leave' },
  { value: 'site_shutdown_weather', label: 'Site shutdown / weather' },
  { value: 'public_holiday', label: 'Public holiday' },
  { value: 'unauthorised_absence', label: 'Unauthorised absence' },
];

function initialHours(item: DayExceptionItem): ApprovedHours {
  return item.dailyResult.approvedHours ?? item.dailyResult.proposedHours;
}

function readableKind(kind: string): string {
  return kind.replace(/_/g, ' ').replace(/^\w/, (letter) => letter.toUpperCase());
}

export function DecisionForm({ item, busy, onSubmit }: DecisionFormProps) {
  const [formItemId, setFormItemId] = useState(item.id);
  const [reason, setReason] = useState('');
  const [hours, setHours] = useState<ApprovedHours>(() => initialHours(item));
  const [classification, setClassification] = useState<AttendanceClassification>(
    item.dailyResult.attendanceClassification ?? 'unauthorised_absence'
  );

  if (formItemId !== item.id) {
    setFormItemId(item.id);
    setReason('');
    setHours(initialHours(item));
    setClassification(item.dailyResult.attendanceClassification ?? 'unauthorised_absence');
  }

  const valid = reason.trim().length > 0;
  const canApprove = item.permittedActions.includes('approve');
  const canReturn = item.permittedActions.includes('return');
  const canClassify = item.permittedActions.includes('classify');
  const readOnly = item.permittedActions.length === 0;
  const submit = (decision: AttendanceDecisionDraft) => {
    if (busy || !valid) return;
    void onSubmit(decision);
  };

  if (readOnly) {
    return (
      <section data-testid="decision-read-only" className="rounded-xl border border-[var(--ff-border-primary)] bg-[var(--ff-surface-primary)] p-4 lg:p-5">
        <h3 className="text-base font-semibold text-[var(--ff-text-primary)]">Decision recorded</h3>
        <p className="mt-2 text-sm text-[var(--ff-text-secondary)]">
          This action is {item.status}. No further decision can be submitted.
        </p>
      </section>
    );
  }

  return (
    <section data-testid="decision-form" aria-labelledby="decision-heading" className="rounded-xl border border-[var(--ff-border-primary)] bg-[var(--ff-surface-primary)] p-4 lg:p-5">
      <div className="mb-4">
        <h3 id="decision-heading" className="text-base font-semibold text-[var(--ff-text-primary)]">Decision</h3>
        <p className="mt-1 text-xs text-[var(--ff-text-tertiary)]">
          {readableKind(item.kind)} · result version {item.resultVersion}
        </p>
      </div>

      <fieldset disabled={busy}>
        {canApprove && <>
          <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--ff-text-tertiary)]">Approved hours</legend>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {HOUR_FIELDS.map(({ key, label }) => (
              <label key={key} className="text-xs text-[var(--ff-text-secondary)]">
                Approved {label} hours
                <input
                  type="number" min="0" max="24" step="0.25" value={hours[key]}
                  onChange={(event) => setHours((current) => ({
                    ...current, [key]: Number(event.target.value),
                  }))}
                  className="mt-1 min-h-[44px] w-full rounded-lg border border-[var(--ff-border-primary)] bg-[var(--ff-bg-primary)] px-3 text-sm text-[var(--ff-text-primary)] focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                />
              </label>
            ))}
          </div>
        </>}

        {canClassify && <label className="mt-4 block text-xs font-medium text-[var(--ff-text-secondary)]">
          Absence classification
          <select value={classification}
            onChange={(event) => setClassification(event.target.value as AttendanceClassification)}
            className="mt-1 min-h-[44px] w-full rounded-lg border border-[var(--ff-border-primary)] bg-[var(--ff-bg-primary)] px-3 text-sm text-[var(--ff-text-primary)] focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/30">
            {CLASSIFICATIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>}

        <label className="mt-4 block text-xs font-medium text-[var(--ff-text-secondary)]">
          Decision reason
          <textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={3}
            maxLength={1000}
            placeholder="Record the evidence and reason for this decision"
            className="mt-1 w-full rounded-lg border border-[var(--ff-border-primary)] bg-[var(--ff-bg-primary)] px-3 py-2 text-sm text-[var(--ff-text-primary)] focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
          />
        </label>
      </fieldset>

      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        {canApprove && <button type="button" aria-label="Approve for payroll" disabled={busy || !valid} onClick={() => submit({ action: 'approve', approvedHours: hours, reason: reason.trim() })} className="min-h-[44px] rounded-lg bg-emerald-600 px-3 text-sm font-semibold text-white hover:bg-emerald-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 disabled:cursor-not-allowed disabled:opacity-50">
          {busy ? 'Saving…' : 'Approve for payroll'}
        </button>}
        {canReturn && (
          <button type="button" disabled={busy || !valid} onClick={() => submit({ action: 'return', reason: reason.trim() })} className="min-h-[44px] rounded-lg border border-amber-600 bg-amber-950/30 px-3 text-sm font-semibold text-amber-200 hover:bg-amber-900/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 disabled:cursor-not-allowed disabled:opacity-50">
            Return to worker
          </button>
        )}
        {canClassify && <button type="button" disabled={busy || !valid} onClick={() => submit({ action: 'classify', classification, reason: reason.trim() })} className="min-h-[44px] rounded-lg border border-red-700 bg-red-950/30 px-3 text-sm font-semibold text-red-200 hover:bg-red-900/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 disabled:cursor-not-allowed disabled:opacity-50">
          Classify absence
        </button>}
      </div>
    </section>
  );
}
