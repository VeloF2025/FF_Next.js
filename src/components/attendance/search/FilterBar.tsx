/**
 * FilterBar — filter controls for Pulse · Search.
 *
 * Renders: date preset chips, custom date range inputs, department free-text,
 * day-of-week chips, boolean toggles, and Search / Reset action buttons.
 * The collapsible exception-kind chips and advanced ID fields are in
 * `AdvancedFilters` (extracted to keep this file under 200 lines).
 *
 * Design contract:
 *  - `setForm` mutates the local draft only (free-text inputs). Keystrokes
 *    do NOT trigger a fetch.
 *  - `setCommittedForm` is called for chip/checkbox/date changes (immediate
 *    filter commits); the page watches `committedForm` to auto-fetch.
 *  - `onSubmit` commits the current draft and resets to page 1.
 */

import type { Dispatch, FormEvent, SetStateAction } from 'react';
import type { FormState } from './types';
import { DATE_PRESETS, DAYS_OF_WEEK } from './types';
import { AdvancedFilters } from './AdvancedFilters';

interface FilterBarProps {
  form: FormState;
  setForm: Dispatch<SetStateAction<FormState>>;
  setCommittedForm: Dispatch<SetStateAction<FormState>>;
  onSubmit: (e: FormEvent) => void;
  onReset: () => void;
  confirmLong: boolean;
  loading: boolean;
}

export function FilterBar({
  form, setForm, setCommittedForm, onSubmit, onReset, confirmLong, loading,
}: FilterBarProps) {
  const setField = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((s) => ({ ...s, [k]: v }));

  const commitField = <K extends keyof FormState>(k: K, v: FormState[K]) => {
    setForm((s) => ({ ...s, [k]: v }));
    setCommittedForm((s) => ({ ...s, [k]: v }));
  };

  const toggleDay = (d: number) =>
    commitField(
      'daysOfWeek',
      form.daysOfWeek.includes(d)
        ? form.daysOfWeek.filter((x) => x !== d)
        : [...form.daysOfWeek, d].sort()
    );

  const toggleException = (k: string) =>
    commitField(
      'exceptionKinds',
      form.exceptionKinds.includes(k)
        ? form.exceptionKinds.filter((x) => x !== k)
        : [...form.exceptionKinds, k]
    );

  return (
    <form onSubmit={onSubmit} className="rounded-xl bg-neutral-900 border border-neutral-800 p-4">
      {/* Date preset chips */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        {DATE_PRESETS.map((p) => (
          <button
            key={p.value}
            type="button"
            aria-pressed={form.dateRange === p.value}
            onClick={() => commitField('dateRange', p.value)}
            className={`px-3 py-1 rounded-full text-xs border ${
              form.dateRange === p.value
                ? 'bg-emerald-600 border-emerald-600 text-white'
                : 'bg-neutral-900 border-neutral-700 text-neutral-300 hover:bg-neutral-800/60'
            }`}
          >
            {p.label}
          </button>
        ))}
        {form.dateRange === 'custom' && (
          <span className="flex items-center gap-2 ml-2">
            <input
              type="date"
              value={form.dateFrom}
              onChange={(e) => commitField('dateFrom', e.target.value)}
              className="px-2 py-1 rounded border border-neutral-700 bg-neutral-900 text-neutral-100 text-sm focus:border-emerald-600 focus:outline-none"
            />
            <span className="text-neutral-500 text-sm">to</span>
            <input
              type="date"
              value={form.dateTo}
              onChange={(e) => commitField('dateTo', e.target.value)}
              className="px-2 py-1 rounded border border-neutral-700 bg-neutral-900 text-neutral-100 text-sm focus:border-emerald-600 focus:outline-none"
            />
          </span>
        )}
      </div>

      {/* Department + day-of-week + toggles */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-neutral-400">Departments (comma-separated)</span>
          <input
            type="text"
            value={form.departments}
            onChange={(e) => setField('departments', e.target.value)}
            placeholder="Civil, Optical"
            className="px-3 py-2 rounded border border-neutral-700 bg-neutral-900 text-neutral-100 focus:border-emerald-600 focus:outline-none"
          />
        </label>

        <div className="flex flex-col gap-1 text-sm">
          <span className="text-neutral-400">Days of week</span>
          <div className="flex flex-wrap gap-1">
            {DAYS_OF_WEEK.map((d) => (
              <button
                key={d.value}
                type="button"
                onClick={() => toggleDay(d.value)}
                className={`px-2 py-1 rounded text-xs border ${
                  form.daysOfWeek.includes(d.value)
                    ? 'bg-emerald-900/40 border-emerald-600 text-emerald-200'
                    : 'bg-neutral-900 border-neutral-700 text-neutral-300 hover:bg-neutral-800/60'
                }`}
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-1 text-sm">
          <span className="text-neutral-400">Quick toggles</span>
          <div className="flex flex-wrap gap-3 text-sm">
            <label className="inline-flex items-center gap-1">
              <input type="checkbox" checked={form.onlyWithOt}
                onChange={(e) => commitField('onlyWithOt', e.target.checked)} />
              <span>Only with OT</span>
            </label>
            <label className="inline-flex items-center gap-1">
              <input type="checkbox" checked={form.onlySundayHoliday}
                onChange={(e) => commitField('onlySundayHoliday', e.target.checked)} />
              <span>Only Sun/holiday</span>
            </label>
            <label className="inline-flex items-center gap-1">
              <input type="checkbox" checked={form.onlyActive}
                onChange={(e) => commitField('onlyActive', e.target.checked)} />
              <span>Only active staff</span>
            </label>
          </div>
        </div>
      </div>

      <AdvancedFilters
        form={form}
        toggleException={toggleException}
        onStaffIdsChange={(v) => setField('staffIds', v)}
        onSiteIdsChange={(v) => setField('siteIds', v)}
      />

      {/* Search/Reset action row */}
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs text-neutral-500">
          {confirmLong && 'Long-range queries are enabled. '}
          Times shown in SAST.
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={onReset}
            className="px-3 py-2 rounded border border-neutral-700 text-sm hover:bg-neutral-800/60">
            Reset
          </button>
          <button type="submit" disabled={loading}
            className="px-4 py-2 rounded bg-emerald-600 text-white text-sm hover:bg-emerald-700 disabled:opacity-50">
            {loading ? 'Searching…' : 'Search'}
          </button>
        </div>
      </div>
    </form>
  );
}
