/**
 * BOQStockFilters — Project + Category multi-select dropdowns
 */
import { useState } from 'react';
import { ChevronDown, Check, Search } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';

interface FilterOption {
  value: string;
  label: string;
}

interface MultiSelectProps {
  label: string;
  options: FilterOption[];
  selected: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
}

function MultiSelect({ label, options, selected, onChange, placeholder }: MultiSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const allSelected = selected.length === 0 || selected.length === options.length;
  const filtered = options.filter((o) =>
    o.label.toLowerCase().includes(search.toLowerCase())
  );

  function toggle(value: string) {
    if (selected.includes(value)) {
      const next = selected.filter((v) => v !== value);
      onChange(next.length === options.length ? [] : next);
    } else {
      const next = [...selected, value];
      onChange(next.length === options.length ? [] : next);
    }
  }

  function selectAll() {
    onChange([]);
  }

  const displayLabel = allSelected
    ? `${label}: All`
    : selected.length === 1
    ? options.find((o) => o.value === selected[0])?.label ?? label
    : `${label}: ${selected.length} selected`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 border-zinc-700 bg-zinc-800 text-zinc-200 hover:bg-zinc-700 hover:text-white text-xs font-normal min-w-[140px] justify-between"
        >
          <span className="truncate">{displayLabel}</span>
          <ChevronDown className="h-3 w-3 shrink-0 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-56 p-0 bg-zinc-900 border-zinc-700"
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
        <div className="max-h-52 overflow-y-auto py-1">
          <button
            onClick={selectAll}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800"
          >
            <div className="flex h-3.5 w-3.5 items-center justify-center rounded-sm border border-zinc-500">
              {allSelected && <Check className="h-2.5 w-2.5 text-blue-400" />}
            </div>
            All {label}
          </button>
          {filtered.map((option) => (
            <button
              key={option.value}
              onClick={() => toggle(option.value)}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800"
            >
              <Checkbox
                checked={allSelected ? true : selected.includes(option.value)}
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

interface BOQStockFiltersProps {
  projects: { id: string; name: string }[];
  categories: string[];
  selectedProjectIds: string[];
  selectedCategories: string[];
  onProjectsChange: (ids: string[]) => void;
  onCategoriesChange: (cats: string[]) => void;
  totalCount: number;
  search: string;
  onSearchChange: (v: string) => void;
}

export function BOQStockFilters({
  projects,
  categories,
  selectedProjectIds,
  selectedCategories,
  onProjectsChange,
  onCategoriesChange,
  totalCount,
  search,
  onSearchChange,
}: BOQStockFiltersProps) {
  const projectOptions = projects.map((p) => ({ value: p.id, label: p.name }));
  const categoryOptions = categories.map((c) => ({ value: c, label: c }));

  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-zinc-800">
      <div className="flex items-center gap-2 flex-wrap">
        {/* Search */}
        <div className="flex items-center gap-2 h-8 px-3 rounded border border-zinc-700 bg-zinc-800 min-w-[200px]">
          <Search className="h-3.5 w-3.5 text-zinc-500 shrink-0" />
          <input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search code or description..."
            className="bg-transparent text-xs text-zinc-300 placeholder:text-zinc-500 outline-none flex-1"
          />
        </div>

        {/* Project filter */}
        <MultiSelect
          label="Project"
          options={projectOptions}
          selected={selectedProjectIds}
          onChange={onProjectsChange}
          placeholder="Search projects..."
        />

        {/* Category filter */}
        <MultiSelect
          label="Category"
          options={categoryOptions}
          selected={selectedCategories}
          onChange={onCategoriesChange}
          placeholder="Search categories..."
        />
      </div>

      {/* Item count */}
      <span className="text-xs text-zinc-500 shrink-0">
        {totalCount} item{totalCount !== 1 ? 's' : ''}
      </span>
    </div>
  );
}
