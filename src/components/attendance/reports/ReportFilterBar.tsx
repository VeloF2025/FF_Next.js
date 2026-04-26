/**
 * Pulse · Reports — filter bar (PRD-061 Phase C).
 *
 * Renders the input controls declared in a `ReportDef`'s `inputs` array.
 * Switch-on-kind keeps each input type in one place; adding a new input
 * variant in the future means one new branch here plus a `parseAndScopeInput`
 * arm on the server.
 */

import type { Dispatch, FormEvent, SetStateAction } from 'react';
import type { ReportDef, ReportInputDef } from '@/services/attendance/reports/types';
import type { ReportFormState } from './reportFormatters';

export function ReportFilterBar({
  def, form, setForm, onRun, loading,
}: {
  def: ReportDef;
  form: ReportFormState;
  setForm: Dispatch<SetStateAction<ReportFormState>>;
  onRun: () => void;
  loading: boolean;
}) {
  const setField = <K extends keyof ReportFormState>(k: K, v: ReportFormState[K]) =>
    setForm((s) => ({ ...s, [k]: v }));
  const onSubmit = (e: FormEvent) => { e.preventDefault(); onRun(); };

  return (
    <form onSubmit={onSubmit} className="rounded-xl bg-white border border-gray-200 p-4 flex flex-wrap items-end gap-3">
      {def.inputs.map((inp, i) => renderInput(inp, i, form, setField))}
      <button
        type="submit"
        disabled={loading}
        className="px-4 py-2 rounded bg-emerald-600 text-white text-sm hover:bg-emerald-700 disabled:opacity-50"
      >
        {loading ? 'Running…' : 'Run report'}
      </button>
    </form>
  );
}

function renderInput<K extends keyof ReportFormState>(
  inp: ReportInputDef,
  idx: number,
  form: ReportFormState,
  setField: (k: K, v: ReportFormState[K]) => void,
) {
  switch (inp.kind) {
    case 'month':
      return (
        <label key={idx} className="flex flex-col gap-1 text-sm">
          <span className="text-gray-600">Month</span>
          <input
            type="month"
            value={form.month}
            onChange={(e) => setField('month' as K, e.target.value as ReportFormState[K])}
            className="px-3 py-2 rounded border border-gray-300"
          />
        </label>
      );
    case 'date_range':
      return (
        <div key={idx} className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-gray-600">Date range</span>
            <select
              value={form.dateRange}
              onChange={(e) => setField('dateRange' as K, e.target.value as ReportFormState[K])}
              className="px-3 py-2 rounded border border-gray-300"
            >
              <option value="last_30d">Last 30 days</option>
              <option value="this_month">This month</option>
              <option value="last_month">Last month</option>
              <option value="custom">Custom</option>
            </select>
          </label>
          {form.dateRange === 'custom' && (
            <>
              <input
                type="date"
                value={form.dateFrom}
                onChange={(e) => setField('dateFrom' as K, e.target.value as ReportFormState[K])}
                className="px-3 py-2 rounded border border-gray-300 text-sm"
              />
              <span className="text-gray-500 text-sm">to</span>
              <input
                type="date"
                value={form.dateTo}
                onChange={(e) => setField('dateTo' as K, e.target.value as ReportFormState[K])}
                className="px-3 py-2 rounded border border-gray-300 text-sm"
              />
            </>
          )}
        </div>
      );
    case 'departments_text':
      return (
        <label key={idx} className="flex flex-col gap-1 text-sm flex-1 min-w-[200px]">
          <span className="text-gray-600">Departments (comma-separated)</span>
          <input
            type="text"
            value={form.departments}
            onChange={(e) => setField('departments' as K, e.target.value as ReportFormState[K])}
            placeholder="Civil, Optical"
            className="px-3 py-2 rounded border border-gray-300"
          />
        </label>
      );
    case 'sites_text':
      return (
        <label key={idx} className="flex flex-col gap-1 text-sm flex-1 min-w-[200px]">
          <span className="text-gray-600">Site IDs (UUIDs, comma-separated)</span>
          <input
            type="text"
            value={form.siteIds}
            onChange={(e) => setField('siteIds' as K, e.target.value as ReportFormState[K])}
            placeholder="Optional"
            className="px-3 py-2 rounded border border-gray-300 text-xs font-mono"
          />
        </label>
      );
    case 'staff_ids_text':
      return (
        <label key={idx} className="flex flex-col gap-1 text-sm flex-1 min-w-[200px]">
          <span className="text-gray-600">Staff IDs (UUIDs, comma-separated)</span>
          <input
            type="text"
            value={form.staffIds}
            onChange={(e) => setField('staffIds' as K, e.target.value as ReportFormState[K])}
            placeholder="Optional"
            className="px-3 py-2 rounded border border-gray-300 text-xs font-mono"
          />
        </label>
      );
    case 'group_by':
      return (
        <label key={idx} className="flex flex-col gap-1 text-sm">
          <span className="text-gray-600">Group by</span>
          <select
            value={form.groupBy}
            onChange={(e) => setField('groupBy' as K, e.target.value as ReportFormState[K])}
            className="px-3 py-2 rounded border border-gray-300"
          >
            {inp.options.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>
      );
    default:
      return null;
  }
}
