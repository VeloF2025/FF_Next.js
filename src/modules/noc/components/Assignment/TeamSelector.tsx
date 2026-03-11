/**
 * TeamSelector Component - Team dropdown for assignment
 *
 * Features:
 * - Shows both internal and contractor teams
 * - Filter by team type
 * - Search by name
 * - Shows team lead and member count
 * - Color-coded by team type
 * - Clear selection option
 * - Loading and error states
 */

'use client';

import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Users, Search, X, ChevronDown, Loader2, Building2, Wrench } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTeamsForAssignment } from '../../hooks/useAssignment';
import type { TeamDropdownOption } from '../../types/team';

interface TeamSelectorProps {
  /** Currently selected team ID */
  value: string | null;
  /** Callback when selection changes */
  onChange: (teamId: string | null, team?: TeamDropdownOption) => void;
  /** Placeholder text */
  placeholder?: string;
  /** Whether the selector is disabled */
  disabled?: boolean;
  /** Error message */
  error?: string | null;
  /** Show clear button */
  showClear?: boolean;
  /** Compact mode */
  compact?: boolean;
  /** Filter to specific team types */
  filterTypes?: ('internal' | 'contractor')[];
}

export function TeamSelector({
  value,
  onChange,
  placeholder = 'Select team...',
  disabled = false,
  error = null,
  showClear = true,
  compact = false,
  filterTypes,
}: TeamSelectorProps) {
  const { teams, isLoading, isError } = useTeamsForAssignment();
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'internal' | 'contractor'>('all');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Find selected team
  const selectedTeam = useMemo(
    () => teams.find((t) => t.id === value),
    [teams, value]
  );

  // Filter teams by search query and type
  const filteredTeams = useMemo(() => {
    let result = teams;

    // Apply filterTypes prop if provided
    if (filterTypes && filterTypes.length > 0) {
      result = result.filter((t) => filterTypes.includes(t.type));
    }

    // Apply type filter from UI
    if (typeFilter !== 'all') {
      result = result.filter((t) => t.type === typeFilter);
    }

    // Apply search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        (t) =>
          t.name.toLowerCase().includes(query) ||
          t.team_type?.toLowerCase().includes(query) ||
          t.lead_name?.toLowerCase().includes(query)
      );
    }

    return result;
  }, [teams, searchQuery, typeFilter, filterTypes]);

  // Group teams by type, sort internal-type teams first within each group
  const groupedTeams = useMemo(() => {
    const sortByType = (a: TeamDropdownOption, b: TeamDropdownOption) => {
      // 'internal' team_type first, then alphabetical
      if (a.team_type === 'internal' && b.team_type !== 'internal') return -1;
      if (a.team_type !== 'internal' && b.team_type === 'internal') return 1;
      return a.name.localeCompare(b.name);
    };
    const internal = filteredTeams.filter((t) => t.type === 'internal').sort(sortByType);
    const contractor = filteredTeams.filter((t) => t.type === 'contractor').sort(sortByType);
    return { internal, contractor };
  }, [filteredTeams]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setSearchQuery('');
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Focus input when dropdown opens
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  const handleSelect = (team: TeamDropdownOption) => {
    onChange(team.id, team);
    setIsOpen(false);
    setSearchQuery('');
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange(null);
    setSearchQuery('');
  };

  const getTeamIcon = (type: 'internal' | 'contractor') => {
    return type === 'internal' ? Building2 : Wrench;
  };

  const getTeamTypeColor = (type: 'internal' | 'contractor') => {
    return type === 'internal'
      ? 'text-blue-400 bg-blue-500/10'
      : 'text-orange-400 bg-orange-500/10';
  };

  const renderTeamOption = (team: TeamDropdownOption) => {
    const Icon = getTeamIcon(team.type);
    const isSelected = team.id === value;

    return (
      <button
        key={team.id}
        type="button"
        onClick={() => handleSelect(team)}
        className={cn(
          'w-full flex items-center gap-3 px-3 py-2 text-left transition-colors',
          'hover:bg-[var(--ff-bg-hover)]',
          isSelected && 'bg-blue-500/10'
        )}
      >
        <div className={cn(
          'w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0',
          getTeamTypeColor(team.type)
        )}>
          <Icon className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={cn(
              'font-medium text-sm truncate',
              isSelected ? 'text-blue-400' : 'text-[var(--ff-text-primary)]'
            )}>
              {team.name}
            </span>
            {isSelected && (
              <span className="text-xs text-blue-400">(Current)</span>
            )}
          </div>
          <div className="flex items-center gap-2 text-xs text-[var(--ff-text-secondary)]">
            <span className="capitalize">{team.team_type.replace('_', ' ')}</span>
            <span>•</span>
            <span>{team.member_count} member{team.member_count !== 1 ? 's' : ''}</span>
            {team.lead_name && (
              <>
                <span>•</span>
                <span className="truncate">Lead: {team.lead_name}</span>
              </>
            )}
          </div>
        </div>
      </button>
    );
  };

  return (
    <div className="relative space-y-1" ref={containerRef}>
      {/* Trigger Button */}
      <button
        type="button"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        className={cn(
          'w-full flex items-center justify-between gap-2 px-3 rounded-lg border transition-all duration-200',
          'bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)]',
          'hover:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          error ? 'border-red-500' : 'border-[var(--ff-border-light)]',
          compact ? 'h-9 text-sm' : 'h-10'
        )}
      >
        <div className="flex items-center gap-2 min-w-0">
          {selectedTeam ? (
            <>
              <div className={cn(
                'w-6 h-6 rounded flex items-center justify-center flex-shrink-0',
                getTeamTypeColor(selectedTeam.type)
              )}>
                {React.createElement(getTeamIcon(selectedTeam.type), { className: 'w-3.5 h-3.5' })}
              </div>
              <span className="truncate">{selectedTeam.name}</span>
            </>
          ) : (
            <>
              <Users className={cn('flex-shrink-0 text-[var(--ff-text-tertiary)]', compact ? 'w-4 h-4' : 'w-5 h-5')} />
              <span className="text-[var(--ff-text-tertiary)] truncate">{placeholder}</span>
            </>
          )}
        </div>

        <div className="flex items-center gap-1">
          {isLoading && <Loader2 className="w-4 h-4 animate-spin text-[var(--ff-text-tertiary)]" />}
          {showClear && selectedTeam && !disabled && (
            <button
              type="button"
              onClick={handleClear}
              className="p-0.5 hover:bg-[var(--ff-bg-hover)] rounded transition-colors"
            >
              <X className="w-4 h-4 text-[var(--ff-text-tertiary)]" />
            </button>
          )}
          <ChevronDown
            className={cn(
              'w-4 h-4 text-[var(--ff-text-tertiary)] transition-transform',
              isOpen && 'rotate-180'
            )}
          />
        </div>
      </button>

      {/* Error Message */}
      {error && (
        <p className="text-xs text-red-400">{error}</p>
      )}

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute z-50 w-full mt-1 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg shadow-xl overflow-hidden">
          {/* Search and Filter */}
          <div className="p-2 border-b border-[var(--ff-border-light)] space-y-2">
            {/* Search Input */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--ff-text-tertiary)]" />
              <input
                ref={inputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search teams..."
                className={cn(
                  'w-full pl-9 pr-3 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-md',
                  'text-sm text-[var(--ff-text-primary)] placeholder-[var(--ff-text-tertiary)]',
                  'focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500'
                )}
              />
            </div>

            {/* Type Filter Tabs */}
            {!filterTypes && (
              <div className="flex gap-1">
                {(['all', 'internal', 'contractor'] as const).map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setTypeFilter(type)}
                    className={cn(
                      'px-3 py-1 text-xs font-medium rounded-md transition-colors',
                      typeFilter === type
                        ? 'bg-blue-500/20 text-blue-400'
                        : 'bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]'
                    )}
                  >
                    {type === 'all' ? 'All Teams' : type === 'internal' ? 'Internal' : 'Contractor'}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Options List */}
          <div className="max-h-80 overflow-y-auto">
            {isLoading ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="w-5 h-5 animate-spin text-[var(--ff-text-tertiary)]" />
              </div>
            ) : isError ? (
              <div className="px-3 py-4 text-sm text-red-400 text-center">
                Failed to load teams
              </div>
            ) : filteredTeams.length === 0 ? (
              <div className="px-3 py-4 text-sm text-[var(--ff-text-secondary)] text-center">
                {searchQuery ? 'No teams found' : 'No teams available'}
              </div>
            ) : (
              <>
                {/* Internal Teams */}
                {groupedTeams.internal.length > 0 && (typeFilter === 'all' || typeFilter === 'internal') && (
                  <div>
                    {typeFilter === 'all' && (
                      <div className="px-3 py-1.5 text-xs font-medium text-[var(--ff-text-secondary)] bg-[var(--ff-bg-tertiary)]">
                        Internal Teams
                      </div>
                    )}
                    {groupedTeams.internal.map(renderTeamOption)}
                  </div>
                )}

                {/* Contractor Teams */}
                {groupedTeams.contractor.length > 0 && (typeFilter === 'all' || typeFilter === 'contractor') && (
                  <div>
                    {typeFilter === 'all' && (
                      <div className="px-3 py-1.5 text-xs font-medium text-[var(--ff-text-secondary)] bg-[var(--ff-bg-tertiary)]">
                        Contractor Teams
                      </div>
                    )}
                    {groupedTeams.contractor.map(renderTeamOption)}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Clear Option */}
          {value && showClear && (
            <div className="border-t border-[var(--ff-border-light)] p-2">
              <button
                type="button"
                onClick={() => {
                  onChange(null);
                  setIsOpen(false);
                  setSearchQuery('');
                }}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg-hover)] rounded-md transition-colors"
              >
                <X className="w-4 h-4" />
                Clear Team Assignment
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
