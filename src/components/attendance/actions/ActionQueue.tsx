import { AlertTriangle, MapPin } from 'lucide-react';
import type {
  DayExceptionItem, DayExceptionKind, DayExceptionStatusFilter,
} from '@/modules/attendance/workflow/types';
import { DAY_EXCEPTION_KINDS } from '@/modules/attendance/workflow/types';

interface ActionQueueProps {
  items: DayExceptionItem[];
  selectedId: string | null;
  status: DayExceptionStatusFilter;
  kind?: DayExceptionKind;
  onSelect: (id: string) => void;
  onFiltersChange: (filters: { status: DayExceptionStatusFilter; kind?: DayExceptionKind }) => void;
}

function label(value: string): string {
  return value.replace(/_/g, ' ').replace(/^\w/, (letter) => letter.toUpperCase());
}

function priority(item: DayExceptionItem): number {
  const missingPunch = ['missing_clock_in', 'missing_clock_out'].includes(item.kind) ? 200 : 0;
  const payrollBlocker = item.dailyResult.blockingReasons.length > 0 ? 100 : 0;
  return missingPunch + payrollBlocker;
}

function prioritiseActions(items: DayExceptionItem[]): DayExceptionItem[] {
  return [...items].sort((left, right) => (
    priority(right) - priority(left) || Date.parse(left.createdAt) - Date.parse(right.createdAt)
  ));
}

export function ActionQueue({ items, selectedId, status, kind, onSelect, onFiltersChange }: ActionQueueProps) {
  return (
    <section data-testid="action-queue" aria-labelledby="queue-heading" className="rounded-xl border border-[var(--ff-border-primary)] bg-[var(--ff-surface-primary)]">
      <div className="border-b border-[var(--ff-border-primary)] p-4">
        <h2 id="queue-heading" className="text-sm font-semibold text-[var(--ff-text-primary)]">Priority action queue</h2>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <label className="text-xs text-[var(--ff-text-tertiary)]">
            Action status
            <select value={status} onChange={(event) => onFiltersChange({ status: event.target.value as DayExceptionStatusFilter, kind })} className="mt-1 min-h-[44px] w-full rounded-lg border border-[var(--ff-border-primary)] bg-[var(--ff-bg-primary)] px-2 text-sm text-[var(--ff-text-primary)] focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/30">
              <option value="unresolved">Unresolved</option>
              <option value="open">Open</option>
              <option value="awaiting_worker">Awaiting worker</option>
              <option value="awaiting_supervisor">Awaiting supervisor</option>
              <option value="resolved">Resolved</option>
              <option value="cancelled">Cancelled</option>
              <option value="all">All</option>
            </select>
          </label>
          <label className="text-xs text-[var(--ff-text-tertiary)]">
            Action kind
            <select value={kind ?? ''} onChange={(event) => onFiltersChange({ status, kind: event.target.value ? event.target.value as DayExceptionKind : undefined })} className="mt-1 min-h-[44px] w-full rounded-lg border border-[var(--ff-border-primary)] bg-[var(--ff-bg-primary)] px-2 text-sm text-[var(--ff-text-primary)] focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/30">
              <option value="">All kinds</option>
              {DAY_EXCEPTION_KINDS.map((value) => <option key={value} value={value}>{label(value)}</option>)}
            </select>
          </label>
        </div>
      </div>
      <div className="max-h-[42rem] space-y-2 overflow-y-auto p-2">
        {prioritiseActions(items).map((item) => {
          const urgent = priority(item) >= 100;
          return (
            <button key={item.id} type="button" data-testid={`attendance-action-item-${item.id}`} aria-pressed={selectedId === item.id} onClick={() => onSelect(item.id)} className={`min-h-[44px] w-full rounded-lg border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 ${selectedId === item.id ? 'border-emerald-500 bg-emerald-500/10' : urgent ? 'border-amber-700/70 bg-amber-950/10 hover:bg-amber-950/20' : 'border-[var(--ff-border-primary)] hover:bg-[var(--ff-bg-hover)]'}`}>
              <div className="flex items-start justify-between gap-2">
                <span className="font-medium text-[var(--ff-text-primary)]">{item.staffName}</span>
                {urgent && <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" aria-label="Payroll blocker" />}
              </div>
              <p className="mt-1 text-xs text-[var(--ff-text-secondary)]">{label(item.kind)} · {item.workDate}</p>
              <p className="mt-2 flex items-center gap-1 text-xs text-[var(--ff-text-tertiary)]"><MapPin className="h-3 w-3" />{item.site.name ?? item.crewName ?? 'Site and crew unavailable'}</p>
            </button>
          );
        })}
      </div>
    </section>
  );
}
