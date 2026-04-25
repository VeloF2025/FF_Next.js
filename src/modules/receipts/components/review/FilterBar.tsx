import React from 'react';
import { RotateCcw } from 'lucide-react';
import {
  RECEIPT_CATEGORIES,
  RECEIPT_CATEGORY_LABELS,
  type ReceiptCategory,
} from '@/modules/receipts/categories';
import type { ReceiptStatus } from '@/modules/receipts/queries';
import type { Filters } from './types';

export function FilterBar({
  filters,
  onChange,
  onReset,
}: {
  filters: Filters;
  onChange: (f: Filters) => void;
  onReset: () => void;
}) {
  const update = <K extends keyof Filters>(k: K, v: Filters[K]) => {
    onChange({ ...filters, [k]: v });
  };
  return (
    <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        <Field label="Status">
          <select
            value={filters.status}
            onChange={(e) => update('status', e.target.value as ReceiptStatus | '')}
            className="w-full rounded-lg bg-neutral-800 border border-neutral-700 text-sm text-neutral-100 px-3 py-2"
          >
            <option value="">All statuses</option>
            <option value="submitted">Submitted</option>
            <option value="approved">Approved</option>
            <option value="reconciled">Reconciled</option>
            <option value="rejected">Rejected</option>
          </select>
        </Field>
        <Field label="Category">
          <select
            value={filters.category}
            onChange={(e) => update('category', e.target.value as ReceiptCategory | '')}
            className="w-full rounded-lg bg-neutral-800 border border-neutral-700 text-sm text-neutral-100 px-3 py-2"
          >
            <option value="">All categories</option>
            {[...RECEIPT_CATEGORIES]
              .sort((a, b) => RECEIPT_CATEGORY_LABELS[a].localeCompare(RECEIPT_CATEGORY_LABELS[b]))
              .map((c) => (
                <option key={c} value={c}>
                  {RECEIPT_CATEGORY_LABELS[c]}
                </option>
              ))}
          </select>
        </Field>
        <Field label="Month">
          <input
            type="month"
            value={filters.month}
            onChange={(e) => update('month', e.target.value)}
            className="w-full rounded-lg bg-neutral-800 border border-neutral-700 text-sm text-neutral-100 px-3 py-2"
          />
        </Field>
        <Field label="Staff (UUID)">
          <input
            type="text"
            value={filters.staffId}
            onChange={(e) => update('staffId', e.target.value.trim())}
            placeholder="Paste a staff UUID"
            className="w-full rounded-lg bg-neutral-800 border border-neutral-700 text-sm text-neutral-100 px-3 py-2 font-mono"
          />
        </Field>
        <Field label="Project (UUID)">
          <input
            type="text"
            value={filters.projectId}
            onChange={(e) => update('projectId', e.target.value.trim())}
            placeholder="Paste a project UUID"
            className="w-full rounded-lg bg-neutral-800 border border-neutral-700 text-sm text-neutral-100 px-3 py-2 font-mono"
          />
        </Field>
      </div>
      <div className="mt-3 flex justify-end">
        <button
          type="button"
          onClick={onReset}
          className="inline-flex items-center gap-1.5 text-xs text-neutral-400 hover:text-neutral-200"
        >
          <RotateCcw className="w-3 h-3" />
          Reset filters
        </button>
      </div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs uppercase tracking-wide text-neutral-400 mb-1">{label}</span>
      {children}
    </label>
  );
}
