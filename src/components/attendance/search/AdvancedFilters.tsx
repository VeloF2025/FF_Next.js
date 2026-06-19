/**
 * AdvancedFilters — collapsible exception-kind chips and advanced ID inputs.
 *
 * Rendered inside FilterBar inside a `<details>` element. Extracted to keep
 * FilterBar under the 200-line component limit.
 *
 * `onStaffIdsChange` / `onSiteIdsChange` mutate the local draft only (not
 * the committed form) so typing a UUID doesn't trigger a fetch per keystroke.
 */

import type { FormState } from './types';
import { EXCEPTION_KINDS } from './types';

interface AdvancedFiltersProps {
  form: FormState;
  toggleException: (k: string) => void;
  onStaffIdsChange: (v: string) => void;
  onSiteIdsChange: (v: string) => void;
}

export function AdvancedFilters({
  form, toggleException, onStaffIdsChange, onSiteIdsChange,
}: AdvancedFiltersProps) {
  return (
    <details className="mb-3">
      <summary className="cursor-pointer text-sm font-medium text-neutral-300">
        Exception filters · advanced ID filters
      </summary>
      <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="md:col-span-2">
          <span className="text-sm text-neutral-400">Exception kinds</span>
          <div className="mt-1 flex flex-wrap gap-1">
            {EXCEPTION_KINDS.map((k) => (
              <button
                key={k.value}
                type="button"
                onClick={() => toggleException(k.value)}
                className={`px-2 py-1 rounded text-xs border ${
                  form.exceptionKinds.includes(k.value)
                    ? 'bg-amber-900/40 border-amber-700 text-amber-200'
                    : 'bg-neutral-900 border-neutral-700 text-neutral-300 hover:bg-neutral-800/60'
                }`}
              >
                {k.label}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-1 gap-2">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-neutral-400">Staff IDs (UUIDs, comma-separated)</span>
            <input
              type="text"
              value={form.staffIds}
              onChange={(e) => onStaffIdsChange(e.target.value)}
              placeholder="Optional — pickers ship in Phase B"
              className="px-3 py-2 rounded border border-neutral-700 bg-neutral-900 text-neutral-100 text-xs font-mono focus:border-emerald-600 focus:outline-none"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-neutral-400">Site IDs (UUIDs, comma-separated)</span>
            <input
              type="text"
              value={form.siteIds}
              onChange={(e) => onSiteIdsChange(e.target.value)}
              placeholder="Optional — pickers ship in Phase B"
              className="px-3 py-2 rounded border border-neutral-700 bg-neutral-900 text-neutral-100 text-xs font-mono focus:border-emerald-600 focus:outline-none"
            />
          </label>
        </div>
      </div>
    </details>
  );
}
