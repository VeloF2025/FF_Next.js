import { AlertCircle, Send } from 'lucide-react';

import type { ClockEntry, CorrectionHints, CorrectionKind } from '../api';
import type { CorrectionFormModel } from './useCorrectionForm';

const KIND_ORDER: readonly CorrectionKind[] = [
  'forgot_clock_out', 'wrong_clock_in_time', 'wrong_clock_out_time',
  'wrong_site', 'duplicate_entry', 'other',
];

export function CorrectionForm({
  entry,
  entryId,
  hints,
  form,
}: {
  entry: ClockEntry | null;
  entryId: string;
  hints: CorrectionHints | null;
  form: CorrectionFormModel;
}) {
  return (
    <form onSubmit={form.handleSubmit} className="space-y-4">
      <EntryContextCard entry={entry} entryId={entryId} />
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-neutral-300">What needs correcting?</span>
        <select
          value={form.kind}
          disabled={form.requiredFlow}
          onChange={(event) => form.setKind(event.target.value as CorrectionKind)}
          className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
        >
          {KIND_ORDER.map((kind) => (
            <option key={kind} value={kind}>{hints?.[kind]?.label ?? prettyKind(kind)}</option>
          ))}
        </select>
        {form.activeHint?.hint && <p className="mt-1 text-xs text-neutral-400">{form.activeHint.hint}</p>}
      </label>

      <div className={form.requiredFlow ? 'grid grid-cols-1 gap-3' : 'grid grid-cols-2 gap-3'}>
        {!form.requiredFlow && (
          <DateTimeField label="Correct clock-in" value={form.adjustedIn} onChange={form.setAdjustedIn} />
        )}
        <DateTimeField label="Correct clock-out" value={form.adjustedOut} onChange={form.setAdjustedOut} />
      </div>
      <p className="-mt-2 text-xs text-neutral-400">
        {form.requiredFlow
          ? 'Enter the time the previous shift ended.'
          : "Leave blank the side you don't need to change. You must change at least one."}
      </p>

      <label className="block">
        <span className="mb-1 block text-sm font-medium text-neutral-300">Why? (min {form.minChars} chars)</span>
        <textarea
          value={form.reason}
          onChange={(event) => form.setReason(event.target.value)}
          placeholder={form.activeHint?.placeholder ?? ''}
          rows={4}
          className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-500 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
        />
        <div className="mt-1 flex items-center justify-between text-xs">
          <span className={form.reasonOk ? 'text-neutral-400' : 'font-medium text-amber-300'}>
            {form.reasonOk
              ? 'Looks good.'
              : `${Math.max(0, form.minChars - form.reasonTrimmed.length)} more character${form.minChars - form.reasonTrimmed.length === 1 ? '' : 's'} needed.`}
          </span>
          <span className="tabular-nums text-neutral-500">{form.reasonTrimmed.length} / {form.minChars}</span>
        </div>
      </label>

      {form.submitError && (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-800 bg-red-950/50 px-3 py-2 text-sm text-red-200">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> <span>{form.submitError}</span>
        </div>
      )}
      <button
        type="submit"
        disabled={!form.canSubmit}
        className="inline-flex w-full touch-manipulation items-center justify-center gap-2 rounded-xl bg-blue-600 py-3 font-bold text-white shadow-lg shadow-blue-600/20 hover:bg-blue-500 active:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Send className="h-4 w-4" />
        {form.submitting ? 'Submitting…' : form.requiredFlow ? 'Submit clock-out correction' : 'Submit for review'}
      </button>
      <p className="text-center text-xs text-neutral-400">
        Your supervisor will review this and either approve, reject, or you can cancel it from{' '}
        <span className="underline">My corrections</span> while it&apos;s pending.
      </p>
    </form>
  );
}

function DateTimeField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-neutral-300">{label}</span>
      <input
        type="datetime-local"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
      />
    </label>
  );
}

function EntryContextCard({ entry, entryId }: { entry: ClockEntry | null; entryId: string }) {
  if (!entry) {
    return (
      <div className="rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-xs text-neutral-400">
        Entry <code className="font-mono">{entryId.slice(0, 8)}…</code> — not in your last 30 shifts; details will be fetched by the reviewer.
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-xs text-neutral-300">
      <div className="font-medium text-neutral-100">Correcting shift on {formatWorkDate(entry.workDate)}</div>
      <div className="mt-0.5">Recorded: {formatTime(entry.clockInAt)} {entry.clockOutAt ? `→ ${formatTime(entry.clockOutAt)}` : '(no clock-out)'}</div>
    </div>
  );
}

function prettyKind(kind: CorrectionKind): string {
  return kind.replace(/_/g, ' ').replace(/^\w/, (character) => character.toUpperCase());
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Johannesburg' });
}

function formatWorkDate(value: string): string {
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return value;
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString('en-ZA', {
    weekday: 'short', day: '2-digit', month: 'short', timeZone: 'UTC',
  });
}
