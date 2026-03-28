'use client';

import { Search, X } from 'lucide-react';

interface SearchFilterProps {
  search: string;
  onSearchChange: (value: string) => void;
}

export function SearchFilter({ search, onSearchChange }: SearchFilterProps) {
  return (
    <div className="relative flex-1 max-w-md">
      <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-[var(--ff-text-tertiary)]" />
      <input
        type="text"
        placeholder="Search tables by name or module..."
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        className="w-full pl-10 pr-9 py-2 bg-[var(--ff-bg-primary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] placeholder-[var(--ff-text-tertiary)] focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
      />
      {search && (
        <button
          onClick={() => onSearchChange('')}
          className="absolute right-3 top-1/2 transform -translate-y-1/2 text-[var(--ff-text-tertiary)] hover:text-[var(--ff-text-primary)]"
        >
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}
