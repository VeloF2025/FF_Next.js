/**
 * Searchable multi-select recipient picker
 * Fetches users from /api/admin/users?search=
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { X, Search } from 'lucide-react';
import { InlineSpinner } from '@/components/ui/LoadingSpinner';
import { cn } from '@/lib/utils';
import type { UserOption } from '../types/messaging.types';

interface RecipientPickerProps {
  selected: UserOption[];
  onChange: (users: UserOption[]) => void;
}

export function RecipientPicker({ selected, onChange }: RecipientPickerProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<UserOption[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const containerRef = useRef<HTMLDivElement>(null);

  const search = useCallback(async (searchQuery: string) => {
    if (!searchQuery.trim()) {
      setResults([]);
      return;
    }

    setIsSearching(true);
    try {
      const res = await fetch(
        `/api/admin/users?search=${encodeURIComponent(searchQuery)}&status=active`,
        { credentials: 'include' }
      );
      const json = await res.json();
      if (json.success) {
        const users: UserOption[] = (json.data.users || []).map(
          (u: { id: string; firstName: string; lastName: string; email: string; department: string }) => ({
            id: u.id,
            name: `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email,
            email: u.email,
            department: u.department || null,
          })
        );
        // Filter out already-selected users
        const selectedIds = new Set(selected.map(s => s.id));
        setResults(users.filter(u => !selectedIds.has(u.id)));
      }
    } catch {
      setResults([]);
    } finally {
      setIsSearching(false);
    }
  }, [selected]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) {
      setResults([]);
      return;
    }
    debounceRef.current = setTimeout(() => search(query), 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, search]);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const addRecipient = (user: UserOption) => {
    onChange([...selected, user]);
    setQuery('');
    setResults([]);
  };

  const removeRecipient = (userId: string) => {
    onChange(selected.filter(u => u.id !== userId));
  };

  return (
    <div ref={containerRef} className="relative">
      {/* Selected chips */}
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {selected.map(user => (
            <span
              key={user.id}
              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium bg-blue-500/15 text-blue-400 rounded-full"
            >
              {user.name}
              <button
                type="button"
                onClick={() => removeRecipient(user.id)}
                className="hover:text-blue-200 transition-colors"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Search input */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--ff-text-tertiary)]" />
        <input
          type="text"
          value={query}
          onChange={e => {
            setQuery(e.target.value);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          placeholder="Search users by name or email..."
          className="w-full pl-9 pr-8 py-2 text-sm rounded-lg border border-[var(--ff-border-light)] bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)] placeholder:text-[var(--ff-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-primary)]/50 focus:border-[var(--ff-primary)]"
        />
        {isSearching && (
          <InlineSpinner size="sm" className="absolute right-3 top-1/2 -translate-y-1/2" />
        )}
      </div>

      {/* Dropdown results */}
      {isOpen && results.length > 0 && (
        <div className="absolute z-50 mt-1 w-full max-h-48 overflow-y-auto rounded-lg border border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)] shadow-lg">
          {results.map(user => (
            <button
              key={user.id}
              type="button"
              onClick={() => addRecipient(user)}
              className="w-full text-left px-3 py-2 text-sm hover:bg-[var(--ff-bg-tertiary)] transition-colors"
            >
              <span className="text-[var(--ff-text-primary)]">{user.name}</span>
              <span className="text-xs text-[var(--ff-text-tertiary)] ml-2">{user.email}</span>
              {user.department && (
                <span className={cn(
                  'text-xs text-[var(--ff-text-tertiary)] ml-1',
                  'before:content-["·"] before:mx-1'
                )}>
                  {user.department}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
