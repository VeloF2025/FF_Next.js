'use client';

import { useState, useMemo, useRef, useEffect, type MouseEvent } from 'react';
import { User, Search, X, ChevronDown } from 'lucide-react';
import { useUsersForAssignment } from '../../hooks/useAssignment';
import type { UserDropdownOption } from '../../types/team';

interface StaffFilterPickerProps {
  value: string;
  onChange: (userId: string) => void;
}

export function StaffFilterPicker({ value, onChange }: StaffFilterPickerProps) {
  const { users, isLoading } = useUsersForAssignment();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = useMemo(() => users.find((u: UserDropdownOption) => u.id === value), [users, value]);

  const filtered = useMemo(() => {
    if (!search.trim()) return users;
    const q = search.toLowerCase();
    return users.filter(
      (u: UserDropdownOption) =>
        u.name.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        u.role?.toLowerCase().includes(q)
    );
  }, [users, search]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch('');
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (open && inputRef.current) inputRef.current.focus();
  }, [open]);

  const handleSelect = (userId: string) => {
    onChange(userId);
    setOpen(false);
    setSearch('');
  };

  const handleClear = (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    onChange('');
    setSearch('');
  };

  const isActive = !!value;

  return (
    <div className="relative flex-shrink-0" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-sm border transition-colors whitespace-nowrap
          ${isActive
            ? 'bg-cyan-500/10 border-cyan-500/30 text-cyan-300'
            : 'bg-[var(--ff-bg-secondary)] border-[var(--ff-border-light)] text-[var(--ff-text-secondary)]'
          }`}
      >
        <User className="w-3.5 h-3.5 flex-shrink-0" />
        {selected ? (
          <>
            <span className="max-w-[120px] truncate">{selected.name}</span>
            <button
              type="button"
              onClick={handleClear}
              className="ml-0.5 hover:text-white transition-colors"
              aria-label="Clear staff filter"
            >
              <X className="w-3 h-3" />
            </button>
          </>
        ) : (
          <>
            <span>Staff</span>
            <ChevronDown className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} />
          </>
        )}
      </button>

      {open && (
        <div className="absolute z-50 top-full mt-1 left-0 w-64 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg shadow-xl overflow-hidden">
          <div className="p-2 border-b border-[var(--ff-border-light)]">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--ff-text-tertiary)]" />
              <input
                ref={inputRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search staff..."
                className="w-full pl-8 pr-3 py-1.5 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded text-sm text-[var(--ff-text-primary)] placeholder-[var(--ff-text-tertiary)] focus:outline-none focus:ring-1 focus:ring-cyan-500"
              />
            </div>
          </div>

          <div className="max-h-56 overflow-y-auto">
            {isLoading ? (
              <div className="px-3 py-3 text-sm text-[var(--ff-text-tertiary)] text-center">Loading...</div>
            ) : filtered.length === 0 ? (
              <div className="px-3 py-3 text-sm text-[var(--ff-text-secondary)] text-center">No staff found</div>
            ) : (
              filtered.map((user: UserDropdownOption) => (
                <button
                  key={user.id}
                  type="button"
                  onClick={() => handleSelect(user.id)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors hover:bg-[var(--ff-bg-hover)]
                    ${user.id === value ? 'bg-cyan-500/10' : ''}`}
                >
                  <div className="w-7 h-7 rounded-full bg-[var(--ff-bg-tertiary)] flex items-center justify-center flex-shrink-0">
                    <User className="w-3.5 h-3.5 text-[var(--ff-text-tertiary)]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className={`font-medium truncate ${user.id === value ? 'text-cyan-400' : 'text-[var(--ff-text-primary)]'}`}>
                      {user.name}
                    </div>
                    {user.role && (
                      <div className="text-xs text-[var(--ff-text-tertiary)] truncate">{user.role}</div>
                    )}
                  </div>
                  {user.id === value && (
                    <X className="w-3.5 h-3.5 text-cyan-400 flex-shrink-0" onClick={handleClear} />
                  )}
                </button>
              ))
            )}
          </div>

          {value && (
            <div className="border-t border-[var(--ff-border-light)] p-1.5">
              <button
                type="button"
                onClick={() => { onChange(''); setOpen(false); setSearch(''); }}
                className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg-hover)] rounded transition-colors"
              >
                <X className="w-3 h-3" />
                Clear staff filter
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
