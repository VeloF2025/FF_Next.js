/**
 * Header Search Bar Component
 */

import { Search, X } from 'lucide-react';
import { useState } from 'react';
import { SearchBarProps } from './HeaderTypes';

export function SearchBar({ searchQuery, onSearchChange }: SearchBarProps) {
  const [showMobileSearch, setShowMobileSearch] = useState(false);

  return (
    <>
      {/* Desktop search — unchanged */}
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

      {/* Mobile search trigger */}
      <div className="relative md:hidden">
        {showMobileSearch ? (
          <div className="flex items-center gap-1">
            <div className="relative">
              <input
                id="global-search-mobile"
                name="global-search-mobile"
                type="text"
                placeholder="Search..."
                value={searchQuery}
                onChange={(e) => onSearchChange(e.target.value)}
                autoFocus
                className="pl-8 pr-4 py-1.5 w-48 border border-[var(--ff-border-primary)] rounded-lg bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] placeholder:text-[var(--ff-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                autoComplete="off"
              />
              <Search className="absolute left-2 top-2 h-4 w-4 text-[var(--ff-text-tertiary)]" />
            </div>
            <button
              onClick={() => { setShowMobileSearch(false); onSearchChange(''); }}
              className="p-1.5 text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:bg-[var(--ff-surface-secondary)] rounded-lg transition-colors"
              aria-label="Close search"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <button
            onClick={() => setShowMobileSearch(true)}
            className="p-2 text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:bg-[var(--ff-surface-secondary)] rounded-lg transition-colors"
            aria-label="Search"
          >
            <Search className="h-4 w-4" />
          </button>
        )}
      </div>
    </>
  );
}