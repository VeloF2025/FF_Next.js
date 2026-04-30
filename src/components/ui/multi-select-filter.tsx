/**
 * MultiSelectFilter — Dark-themed dropdown with checkbox multi-select and search.
 *
 * Empty `selected` array means "All" (no filter applied). Selecting every option
 * collapses back to the empty-array sentinel so the caller doesn't have to track
 * "all selected" vs "none filtered" separately.
 */

'use client';

import { useState } from 'react';
import { ChevronDown, Check, Search } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';

export interface MultiSelectOption {
  value: string;
  label: string;
}

export interface MultiSelectFilterProps {
  /** Short label used in the collapsed trigger ("All Statuses", "2 Statuses selected") */
  label: string;
  options: MultiSelectOption[];
  selected: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
  /** Trigger width (Tailwind class e.g. "w-40") */
  triggerClassName?: string;
  /** Popover content width (Tailwind class e.g. "w-56") */
  contentClassName?: string;
  /** Override the "All …" pluralisation if it doesn't match the label */
  allLabel?: string;
}

export function MultiSelectFilter({
  label,
  options,
  selected,
  onChange,
  placeholder,
  disabled,
  triggerClassName,
  contentClassName,
  allLabel,
}: MultiSelectFilterProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const allSelected = selected.length === 0 || selected.length === options.length;
  const filtered = options.filter((o) =>
    o.label.toLowerCase().includes(search.toLowerCase())
  );

  const toggle = (value: string) => {
    const next = selected.includes(value)
      ? selected.filter((v) => v !== value)
      : [...selected, value];
    onChange(next.length === options.length ? [] : next);
  };

  const clear = () => onChange([]);

  const effectiveAllLabel = allLabel ?? `All ${label}`;

  const displayLabel = allSelected
    ? effectiveAllLabel
    : selected.length === 1
    ? options.find((o) => o.value === selected[0])?.label ?? label
    : `${selected.length} ${label} selected`;

  return (
    <Popover open={open} onOpenChange={(v) => !disabled && setOpen(v)}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled}
          className={`h-9 gap-1.5 border-zinc-700 bg-zinc-800 text-zinc-100 hover:bg-zinc-700 hover:text-white text-sm font-normal justify-between disabled:opacity-40 ${triggerClassName ?? 'min-w-[140px]'}`}
        >
          <span className="truncate">{displayLabel}</span>
          <ChevronDown className="h-3 w-3 shrink-0 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className={`p-0 bg-zinc-900 border-zinc-700 ${contentClassName ?? 'w-56'}`}
        align="start"
      >
        <div className="p-2 border-b border-zinc-700">
          <div className="flex items-center gap-2 px-2 py-1 rounded bg-zinc-800">
            <Search className="h-3 w-3 text-zinc-500 shrink-0" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={placeholder ?? `Search ${label.toLowerCase()}...`}
              className="bg-transparent text-xs text-zinc-300 placeholder:text-zinc-500 outline-none flex-1 w-full"
            />
          </div>
        </div>
        <div className="max-h-64 overflow-y-auto py-1">
          <button
            type="button"
            onClick={clear}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800"
          >
            <div className="flex h-3.5 w-3.5 items-center justify-center rounded-sm border border-zinc-500">
              {allSelected && <Check className="h-2.5 w-2.5 text-blue-400" />}
            </div>
            {effectiveAllLabel}
          </button>
          {filtered.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => toggle(option.value)}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800"
            >
              <Checkbox
                checked={allSelected ? false : selected.includes(option.value)}
                className="h-3.5 w-3.5 rounded-sm border-zinc-500 data-[state=checked]:bg-blue-500 data-[state=checked]:border-blue-500"
                onCheckedChange={() => toggle(option.value)}
              />
              <span className="truncate">{option.label}</span>
            </button>
          ))}
          {filtered.length === 0 && (
            <p className="px-3 py-2 text-xs text-zinc-500">No results</p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
