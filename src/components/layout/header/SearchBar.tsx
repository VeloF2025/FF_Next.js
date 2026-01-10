/**
 * Header Search Bar Component
 */

import { Search } from 'lucide-react';
import { SearchBarProps } from './HeaderTypes';

export function SearchBar({ searchQuery, onSearchChange }: SearchBarProps) {
  return (
    <div className="relative hidden md:block">
      <input
        id="global-search"
        name="global-search"
        type="text"
        placeholder="Search projects, clients..."
        value={searchQuery}
        onChange={(e) => onSearchChange(e.target.value)}
        className="pl-10 pr-4 py-2 w-64 border border-[var(--ff-border-primary)] rounded-lg bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] placeholder:text-[var(--ff-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        autoComplete="off"
      />
      <Search className="absolute left-3 top-2.5 h-4 w-4 text-[var(--ff-text-tertiary)]" />
    </div>
  );
}