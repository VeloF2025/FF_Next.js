import { AlertTriangle, Clock3, ShieldAlert, UserCheck } from 'lucide-react';
import type { DayExceptionItem } from '@/modules/attendance/workflow/types';

interface ActionSummaryCardsProps { items: DayExceptionItem[]; }

export function ActionSummaryCards({ items }: ActionSummaryCardsProps) {
  const present = new Set(items.filter((item) => item.evidence.clockInAt).map((item) => item.staffId)).size;
  const open = items.filter((item) => !['resolved', 'cancelled'].includes(item.status)).length;
  const missingClock = items.filter((item) => ['missing_clock_in', 'missing_clock_out'].includes(item.kind)).length;
  const cards = [
    { id: 'present', label: 'Present', value: present, note: 'With clock-in evidence', icon: UserCheck, tone: 'text-emerald-400' },
    { id: 'flagged', label: 'Flagged', value: items.length, note: 'In this bounded result', icon: AlertTriangle, tone: 'text-amber-400' },
    { id: 'open', label: 'Open', value: open, note: 'Awaiting action', icon: ShieldAlert, tone: 'text-red-400' },
    { id: 'missing-clock', label: 'Missing clock', value: missingClock, note: 'In or out punch', icon: Clock3, tone: 'text-sky-400' },
  ];

  return (
    <section data-testid="action-summary" aria-label="Attendance action summary" className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      {cards.map(({ id, label, value, note, icon: Icon, tone }) => (
        <div key={id} data-testid={`action-summary-${id}`} className="rounded-xl border border-[var(--ff-border-primary)] bg-[var(--ff-surface-primary)] p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ff-text-tertiary)]">{label}</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-[var(--ff-text-primary)]">{value}</p>
            </div>
            <Icon className={`h-5 w-5 ${tone}`} aria-hidden="true" />
          </div>
          <p className="mt-2 text-xs text-[var(--ff-text-tertiary)]">{note}</p>
        </div>
      ))}
    </section>
  );
}
