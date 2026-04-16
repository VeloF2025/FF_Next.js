/**
 * SnagSummaryFiltersBar — filter controls for SnagSummaryPage.
 *
 * Filters:
 *   - Projects (multi-select popover)
 *   - Import date range (from/to)
 *   - Severity (multi-select popover)
 *   - Report type (multi-select popover)
 *
 * All selections are optional; no selection = no filter on that dimension.
 */

'use client';
import { useEffect, useRef, useState } from 'react';
import { Filter, X } from 'lucide-react';
import type { SnagSummaryFilters } from '../../services/snagService';

// ============================================================
// Types
// ============================================================

export interface ProjectOption {
  id: string;
  name: string;
}

interface Props {
  filters:     SnagSummaryFilters;
  onChange:    (next: SnagSummaryFilters) => void;
  projectOptions: ProjectOption[];
}

const SEVERITY_OPTIONS = [
  { value: 'major',    label: 'Major' },
  { value: 'minor',    label: 'Minor' },
  { value: 'critical', label: 'Critical' },
];

const REPORT_TYPE_OPTIONS = [
  { value: 'tqr',          label: 'TQR Audit' },
  { value: 'field_report', label: 'Field Report' },
];

// ============================================================
// Active-count helper
// ============================================================

function activeFilterCount(f: SnagSummaryFilters): number {
  let n = 0;
  if (f.projectIds?.length) n++;
  if (f.severity?.length)   n++;
  if (f.reportType?.length) n++;
  if (f.importFrom)         n++;
  if (f.importTo)           n++;
  return n;
}

// ============================================================
// Main component
// ============================================================

export function SnagSummaryFiltersBar({ filters, onChange, projectOptions }: Props) {
  const count = activeFilterCount(filters);

  const updateList = (key: 'projectIds' | 'severity' | 'reportType', value: string) => {
    const current = filters[key] ?? [];
    const next = current.includes(value)
      ? current.filter((v) => v !== value)
      : [...current, value];
    onChange({ ...filters, [key]: next.length > 0 ? next : undefined });
  };

  const clearAll = () => {
    onChange({ search: filters.search });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <MultiSelectPopover
        label="Projects"
        activeCount={filters.projectIds?.length ?? 0}
        options={projectOptions.map((p) => ({ value: p.id, label: p.name }))}
        selected={filters.projectIds ?? []}
        onToggle={(v) => updateList('projectIds', v)}
      />

      <DateRangeField
        from={filters.importFrom}
        to={filters.importTo}
        onChange={(from, to) => onChange({ ...filters, importFrom: from, importTo: to })}
      />

      <MultiSelectPopover
        label="Severity"
        activeCount={filters.severity?.length ?? 0}
        options={SEVERITY_OPTIONS}
        selected={filters.severity ?? []}
        onToggle={(v) => updateList('severity', v)}
      />

      <MultiSelectPopover
        label="Report Type"
        activeCount={filters.reportType?.length ?? 0}
        options={REPORT_TYPE_OPTIONS}
        selected={filters.reportType ?? []}
        onToggle={(v) => updateList('reportType', v)}
      />

      {count > 0 && (
        <button
          type="button"
          onClick={clearAll}
          className="flex items-center gap-1 px-2 py-1.5 text-xs text-zinc-400 hover:text-zinc-200"
        >
          <X className="w-3 h-3" />
          Clear ({count})
        </button>
      )}
    </div>
  );
}

// ============================================================
// MultiSelectPopover
// ============================================================

interface PopoverProps {
  label: string;
  activeCount: number;
  options: Array<{ value: string; label: string }>;
  selected: string[];
  onToggle: (value: string) => void;
}

function MultiSelectPopover({ label, activeCount, options, selected, onToggle }: PopoverProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-md border transition-colors ${
          activeCount > 0
            ? 'bg-blue-900/30 border-blue-700/50 text-blue-200'
            : 'bg-zinc-800 border-zinc-700 text-zinc-300 hover:bg-zinc-700'
        }`}
      >
        <Filter className="w-3 h-3" />
        {label}
        {activeCount > 0 && (
          <span className="ml-1 px-1.5 py-0.5 text-[10px] rounded-full bg-blue-600 text-white">
            {activeCount}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 z-20 min-w-[200px] max-h-64 overflow-auto bg-zinc-900 border border-zinc-700 rounded-md shadow-lg py-1">
          {options.length === 0 && (
            <p className="px-3 py-2 text-xs text-zinc-500">No options</p>
          )}
          {options.map((opt) => {
            const checked = selected.includes(opt.value);
            return (
              <label
                key={opt.value}
                className="flex items-center gap-2 px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-800 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggle(opt.value)}
                  className="accent-blue-500"
                />
                <span className="flex-1">{opt.label}</span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ============================================================
// DateRangeField
// ============================================================

interface DateRangeProps {
  from: string | undefined;
  to: string | undefined;
  onChange: (from: string | undefined, to: string | undefined) => void;
}

function DateRangeField({ from, to, onChange }: DateRangeProps) {
  const active = Boolean(from || to);
  return (
    <div
      className={`flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md border ${
        active
          ? 'bg-blue-900/30 border-blue-700/50'
          : 'bg-zinc-800 border-zinc-700'
      }`}
    >
      <span className="text-zinc-400">Imported</span>
      <input
        type="date"
        value={from ?? ''}
        onChange={(e) => onChange(e.target.value || undefined, to)}
        className="bg-transparent text-zinc-200 text-xs outline-none [color-scheme:dark] w-[115px]"
        aria-label="Import date from"
      />
      <span className="text-zinc-500">–</span>
      <input
        type="date"
        value={to ?? ''}
        onChange={(e) => onChange(from, e.target.value || undefined)}
        className="bg-transparent text-zinc-200 text-xs outline-none [color-scheme:dark] w-[115px]"
        aria-label="Import date to"
      />
    </div>
  );
}
