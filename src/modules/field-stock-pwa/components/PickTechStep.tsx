/**
 * PickTechStep — step 1 of the stores issue flow.
 *
 * Renders a searchable list of technicians. If the target tech is not in
 * the list, the "+ Add new technician" button expands InlineAddTech inline
 * (no modal — simpler, matches the clockSteps.tsx inline-form precedent).
 *
 * Theme: dark — bg-neutral-900 / bg-neutral-950 / border-neutral-700/800,
 * matching /my/attendance/clock step components.
 */

import { useState, useEffect, useCallback } from 'react';
import { Search, UserPlus } from 'lucide-react';
import { fetchTechnicians } from '@/modules/field-stock-pwa/api';
import type { PwaTechSummary } from '@/modules/field-stock-pwa/types';
import { InlineAddTech } from './InlineAddTech';

// ⚪ UNTESTED: no integration tests yet (Task 2.9)

export interface PickTechStepProps {
  onPick: (tech: PwaTechSummary) => void;
}

/** Loading skeleton — three placeholder rows */
function TechListSkeleton() {
  return (
    <ul className="divide-y divide-neutral-800 rounded-lg bg-neutral-950 border border-neutral-800">
      {[0, 1, 2].map((i) => (
        <li key={i} className="px-4 py-3 flex justify-between items-center">
          <div className="space-y-1.5">
            <div className="h-4 w-36 rounded bg-neutral-800 animate-pulse" />
            <div className="h-3 w-24 rounded bg-neutral-800 animate-pulse" />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Empty state when no technicians match the search */
function EmptyState({ search }: { search: string }) {
  return (
    <div className="py-8 text-center rounded-lg bg-neutral-950 border border-neutral-800">
      <p className="text-sm text-neutral-400">
        {search
          ? `No technicians match "${search}"`
          : 'No technicians found'}
      </p>
    </div>
  );
}

export function PickTechStep({ onPick }: PickTechStepProps) {
  const [search, setSearch] = useState('');
  const [techs, setTechs] = useState<PwaTechSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  const loadTechs = useCallback(async (term: string) => {
    setLoading(true);
    setFetchError(null);
    try {
      const result = await fetchTechnicians({ search: term });
      setTechs(result);
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : 'Failed to load technicians');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTechs(search);
  }, [search, loadTechs]);

  const handleCreated = useCallback(
    (tech: PwaTechSummary) => {
      setShowAdd(false);
      onPick(tech);
    },
    [onPick]
  );

  return (
    <div className="space-y-3">
      {/* Search input */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500 pointer-events-none" />
        <input
          autoFocus
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or phone"
          className="w-full pl-9 pr-4 py-3 rounded-lg bg-neutral-900 border border-neutral-700 text-white placeholder:text-neutral-500 focus:outline-none focus:border-blue-500"
        />
      </div>

      {/* Fetch error */}
      {fetchError && (
        <div className="px-4 py-3 rounded-lg bg-red-950 border border-red-800 text-red-300 text-sm">
          {fetchError}
        </div>
      )}

      {/* Tech list / skeleton / empty state */}
      {loading ? (
        <TechListSkeleton />
      ) : techs.length === 0 ? (
        <EmptyState search={search} />
      ) : (
        <ul className="divide-y divide-neutral-800 rounded-lg bg-neutral-950 border border-neutral-800">
          {techs.map((t) => (
            <li
              key={t.id}
              role="button"
              tabIndex={0}
              onClick={() => onPick(t)}
              onKeyDown={(e) => e.key === 'Enter' && onPick(t)}
              className="px-4 py-3 hover:bg-neutral-900 cursor-pointer flex justify-between items-center"
            >
              <div>
                <div className="text-white text-sm font-medium">{t.name}</div>
                <div className="text-xs text-neutral-500 mt-0.5">
                  {t.contractorName ?? 'Unassigned'}
                </div>
              </div>
              {t.accountStatus === 'pending' && (
                <span className="text-[10px] uppercase tracking-wide rounded bg-amber-950 text-amber-300 px-2 py-0.5 flex-shrink-0">
                  Pending
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Add new technician */}
      {!showAdd ? (
        <button
          type="button"
          onClick={() => setShowAdd(true)}
          className="w-full min-h-[48px] inline-flex items-center justify-center gap-2 px-4 py-3 rounded-lg border border-neutral-700 text-neutral-300 hover:bg-neutral-800 hover:text-white text-sm font-medium"
        >
          <UserPlus className="w-4 h-4" />
          Add new technician
        </button>
      ) : (
        <InlineAddTech
          onCreated={handleCreated}
          onCancel={() => setShowAdd(false)}
        />
      )}
    </div>
  );
}
