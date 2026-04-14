/**
 * MultiSelectPopover — compact checkbox-list multi-select in a popover.
 * Used by the snag Reports filter bar.
 */

'use client';

import { useMemo } from 'react';
import { ChevronDown, X } from 'lucide-react';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';

export interface MultiOption<T extends string | number = string> {
  value: T;
  label: string;
}

interface Props<T extends string | number> {
  label: string;
  options: MultiOption<T>[];
  selected: T[];
  onChange: (next: T[]) => void;
  placeholder?: string;
  widthClass?: string;
}

export function MultiSelectPopover<T extends string | number>({
  label, options, selected, onChange, placeholder = 'Any', widthClass = 'w-48',
}: Props<T>) {
  const selectedSet = useMemo(() => new Set(selected), [selected]);

  const summary = selected.length === 0
    ? placeholder
    : selected.length === 1
      ? (options.find((o) => o.value === selected[0])?.label ?? String(selected[0]))
      : `${selected.length} selected`;

  function toggle(v: T) {
    const next = selectedSet.has(v)
      ? selected.filter((x) => x !== v)
      : [...selected, v];
    onChange(next);
  }

  function clear(e: React.MouseEvent) {
    e.stopPropagation();
    onChange([]);
  }

  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs text-zinc-400">{label}</label>
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={`flex items-center justify-between gap-2 px-2.5 py-1.5 text-xs rounded-md bg-zinc-800 border border-zinc-700 text-zinc-100 hover:border-zinc-500 ${widthClass}`}
          >
            <span className={selected.length === 0 ? 'text-zinc-500' : ''}>{summary}</span>
            <span className="flex items-center gap-1">
              {selected.length > 0 && (
                <span
                  role="button"
                  tabIndex={0}
                  onClick={clear}
                  onKeyDown={(e) => { if (e.key === 'Enter') clear(e as unknown as React.MouseEvent); }}
                  className="text-zinc-400 hover:text-zinc-200"
                  aria-label={`Clear ${label}`}
                >
                  <X className="w-3 h-3" />
                </span>
              )}
              <ChevronDown className="w-3 h-3 text-zinc-400" />
            </span>
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-56 p-2 max-h-72 overflow-auto">
          <ul className="flex flex-col gap-0.5">
            {options.map((opt) => {
              const checked = selectedSet.has(opt.value);
              return (
                <li key={String(opt.value)}>
                  <button
                    type="button"
                    onClick={() => toggle(opt.value)}
                    className={`flex items-center gap-2 w-full px-2 py-1.5 rounded text-left text-xs ${checked ? 'bg-zinc-700/60 text-zinc-100' : 'text-zinc-300 hover:bg-zinc-700/40'}`}
                  >
                    <span className={`inline-block w-3 h-3 border rounded-sm ${checked ? 'bg-blue-600 border-blue-500' : 'border-zinc-500'}`} />
                    {opt.label}
                  </button>
                </li>
              );
            })}
            {options.length === 0 && (
              <li className="px-2 py-2 text-xs text-zinc-500">No options</li>
            )}
          </ul>
        </PopoverContent>
      </Popover>
    </div>
  );
}
