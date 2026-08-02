import { AlertCircle, Camera, Clock3, MapPin, Users } from 'lucide-react';
import type { ApprovedHours, DayExceptionItem } from '@/modules/attendance/workflow/types';
import { DecisionForm, type AttendanceDecisionDraft } from './DecisionForm';

interface ActionDetailPanelProps {
  item: DayExceptionItem;
  lastCheckedAt: string | null;
  busy: boolean;
  onSubmit: (decision: AttendanceDecisionDraft) => void | Promise<void>;
}

const HOUR_KEYS: readonly (keyof ApprovedHours)[] = [
  'regular', 'overtime', 'sunday', 'holiday', 'leave', 'unpaid',
];

function title(value: string): string {
  return value.replace(/_/g, ' ').replace(/^\w/, (letter) => letter.toUpperCase());
}

function timestamp(value: string | null): string {
  if (!value) return 'Unavailable';
  return new Date(value).toLocaleString('en-ZA', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Johannesburg',
  });
}

function checkedLabel(lastCheckedAt: string | null): string {
  if (!lastCheckedAt) return 'Last checked: queue refresh pending';
  return `Last checked ${new Date(lastCheckedAt).toLocaleTimeString('en-ZA', {
    hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Johannesburg',
  })} with the current queue refresh`;
}

function EvidenceRow({ label, available, value, lastCheckedAt }: { label: string; available: boolean; value?: string; lastCheckedAt: string | null }) {
  return (
    <div className="rounded-lg border border-[var(--ff-border-primary)] bg-[var(--ff-bg-primary)] p-3">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="text-[var(--ff-text-secondary)]">{label}</span>
        <span data-evidence-status={available ? 'available' : 'unavailable'} className={available ? 'text-[var(--ff-text-primary)]' : 'font-medium text-amber-300'}>{available ? value ?? 'Available' : 'Unavailable'}</span>
      </div>
      {!available && <p className="mt-1 text-xs text-[var(--ff-text-tertiary)]">{checkedLabel(lastCheckedAt)}</p>}
    </div>
  );
}

function HoursGrid({ label, hours }: { label: string; hours: ApprovedHours | null }) {
  return (
    <div>
      <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--ff-text-tertiary)]">{label}</h4>
      {hours ? (
        <dl className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {HOUR_KEYS.map((key) => (
            <div key={key} className="rounded-lg border border-[var(--ff-border-primary)] bg-[var(--ff-bg-primary)] p-2">
              <dt className="text-[11px] capitalize text-[var(--ff-text-tertiary)]">{key}</dt>
              <dd className="text-sm font-semibold tabular-nums text-[var(--ff-text-primary)]">{hours[key]}h</dd>
            </div>
          ))}
        </dl>
      ) : <p className="mt-2 text-sm text-[var(--ff-text-tertiary)]">Not approved yet</p>}
    </div>
  );
}

export function ActionDetailPanel({ item, lastCheckedAt, busy, onSubmit }: ActionDetailPanelProps) {
  const selfieKinds = new Set(item.evidence.selfies.map((selfie) => selfie.kind));
  return (
    <section data-testid="action-detail" aria-labelledby="detail-heading" className="space-y-4">
      <div className="rounded-xl border border-[var(--ff-border-primary)] bg-[var(--ff-surface-primary)] p-4 lg:p-5">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-400">{title(item.kind)}</p>
            <h2 id="detail-heading" className="mt-1 text-xl font-semibold text-[var(--ff-text-primary)]">{item.staffName}</h2>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--ff-text-tertiary)]">
              <span className="inline-flex items-center gap-1"><Clock3 className="h-3.5 w-3.5" />{item.workDate}</span>
              <span className="inline-flex items-center gap-1"><Users className="h-3.5 w-3.5" />{item.crewName ?? 'Crew unavailable'}</span>
              <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{item.site.name ?? 'Site unavailable'}</span>
            </div>
          </div>
          <span className="rounded-full border border-amber-700 bg-amber-950/30 px-3 py-1 text-xs font-medium text-amber-200">{title(item.status)}</span>
        </div>
        {item.dailyResult.blockingReasons.length > 0 && (
          <div className="mt-4 rounded-lg border border-red-800 bg-red-950/20 p-3 text-sm text-red-200">
            <p className="flex items-center gap-2 font-medium"><AlertCircle className="h-4 w-4" />Payroll blockers</p>
            <p className="mt-1 text-xs">{item.dailyResult.blockingReasons.map(title).join(', ')}</p>
          </div>
        )}
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <section aria-labelledby="evidence-heading" className="rounded-xl border border-[var(--ff-border-primary)] bg-[var(--ff-surface-primary)] p-4">
          <h3 id="evidence-heading" className="text-sm font-semibold text-[var(--ff-text-primary)]">Evidence</h3>
          <div className="mt-3 space-y-2">
            <EvidenceRow label="Clock in" available={Boolean(item.evidence.clockInAt)} value={timestamp(item.evidence.clockInAt)} lastCheckedAt={lastCheckedAt} />
            <EvidenceRow label="Clock out" available={Boolean(item.evidence.clockOutAt)} value={timestamp(item.evidence.clockOutAt)} lastCheckedAt={lastCheckedAt} />
            <EvidenceRow label="Clock-in GPS" available={item.evidence.clockInGpsAvailable} lastCheckedAt={lastCheckedAt} />
            <EvidenceRow label="Clock-out GPS" available={item.evidence.clockOutGpsAvailable} lastCheckedAt={lastCheckedAt} />
            <EvidenceRow label="Clock-in selfie" available={selfieKinds.has('in')} lastCheckedAt={lastCheckedAt} />
            <EvidenceRow label="Clock-out selfie" available={selfieKinds.has('out')} lastCheckedAt={lastCheckedAt} />
          </div>
          {item.evidence.selfies.length > 0 && <p className="mt-3 flex items-center gap-1 text-xs text-[var(--ff-text-tertiary)]"><Camera className="h-3.5 w-3.5" />Selfies are opened through the audited attendance-selfie route.</p>}
        </section>

        <section aria-labelledby="hours-heading" className="rounded-xl border border-[var(--ff-border-primary)] bg-[var(--ff-surface-primary)] p-4">
          <h3 id="hours-heading" className="text-sm font-semibold text-[var(--ff-text-primary)]">Hours and correction</h3>
          <div className="mt-3 space-y-4">
            <HoursGrid label="Proposed hours" hours={item.dailyResult.proposedHours} />
            <HoursGrid label="Approved hours" hours={item.dailyResult.approvedHours} />
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--ff-text-tertiary)]">Worker adjustment</h4>
              {item.adjustment ? (
                <div className="mt-2 rounded-lg border border-[var(--ff-border-primary)] bg-[var(--ff-bg-primary)] p-3 text-sm text-[var(--ff-text-secondary)]">
                  <p>{title(item.adjustment.kind)} · {item.adjustment.status}</p>
                  <p className="mt-1 text-xs text-[var(--ff-text-tertiary)]">{item.adjustment.reason}</p>
                </div>
              ) : <p className="mt-2 text-sm text-[var(--ff-text-tertiary)]">No worker correction submitted</p>}
            </div>
          </div>
        </section>
      </div>
      <DecisionForm key={item.id} item={item} busy={busy} onSubmit={onSubmit} />
    </section>
  );
}
