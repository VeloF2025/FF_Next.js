/**
 * PickTechStep — step 2 of the stores issue flow (the warehouse is step 1).
 *
 * Renders a searchable list of the people stock can be issued to. If the target
 * person is not in the list, the "+ Add new technician" button expands
 * InlineAddTech inline (no modal — simpler, matches the clockSteps.tsx
 * inline-form precedent).
 *
 * SITE FILTERING: the list defaults to people who work at the store being
 * issued from. Casuals do not move between sites, so a Lawley casual appearing
 * in a Tembisa handout is noise at best and a mis-issue at worst.
 *
 * Only people KNOWN to work elsewhere are hidden. Someone with no site, or any
 * person when the store itself is unmapped, still shows — hiding a name on
 * missing data would make stock un-issuable to a real worker, which is worse
 * than one extra name in the list. "Show everyone" reveals the hidden ones for
 * the genuine cross-site exception, so this never blocks a handout.
 *
 * Theme: dark — bg-neutral-900 / bg-neutral-950 / border-neutral-700/800,
 * matching /my/attendance/clock step components.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Search, UserPlus } from 'lucide-react';
import { fetchTechnicians } from '@/modules/field-stock-pwa/api';
import type { PwaTechSummary } from '@/modules/field-stock-pwa/types';
import { InlineAddTech } from './InlineAddTech';
import { isVisibleByDefault } from '@/modules/field-stock-pwa/lib/staffSite';

// ⚪ UNTESTED: no integration tests yet (Task 2.9)

export interface PickTechStepProps {
  onPick: (tech: PwaTechSummary) => void;
  /** The source warehouse. The server resolves which site it serves. */
  storeLocationId?: string | null;
  /** Store name, for explaining what the list is filtered to. */
  storeName?: string | null;
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
function EmptyState({ search, hiddenCount }: { search: string; hiddenCount: number }) {
  return (
    <div className="py-8 text-center rounded-lg bg-neutral-950 border border-neutral-800">
      <p className="text-sm text-neutral-400">
        {search ? `Nobody matches "${search}"` : 'Nobody is assigned to this site yet'}
      </p>
      {hiddenCount > 0 && (
        <p className="text-xs text-neutral-500 mt-1">
          {hiddenCount} {hiddenCount === 1 ? 'person works' : 'people work'} at another site — use
          &ldquo;Show everyone&rdquo; below.
        </p>
      )}
    </div>
  );
}

export function PickTechStep({ onPick, storeLocationId, storeName }: PickTechStepProps) {
  const [search, setSearch] = useState('');
  const [techs, setTechs] = useState<PwaTechSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showEveryone, setShowEveryone] = useState(false);

  // Generation guard. Each load claims a number; only the newest may write.
  // Without it a slower earlier request (the immediate mount fetch, or a fetch
  // for the previous store) can resolve last and overwrite the current list —
  // leaving rows whose siteMatch was computed against a DIFFERENT warehouse,
  // which is precisely the wrong-site display this feature exists to prevent.
  const loadGeneration = useRef(0);

  const loadTechs = useCallback(async (term: string) => {
    const generation = ++loadGeneration.current;
    setLoading(true);
    setFetchError(null);
    try {
      const result = await fetchTechnicians({ search: term, storeLocationId });
      if (generation !== loadGeneration.current) return; // superseded
      setTechs(result);
    } catch (err) {
      if (generation !== loadGeneration.current) return;
      setFetchError(err instanceof Error ? err.message : 'Failed to load technicians');
    } finally {
      if (generation === loadGeneration.current) setLoading(false);
    }
  }, [storeLocationId]);

  // A different store means a different filter; revealing everyone should not
  // silently carry over to it.
  useEffect(() => { setShowEveryone(false); }, [storeLocationId]);

  // Initial load + debounced reload on search change (300 ms, matching PickItemStep).
  useEffect(() => {
    const timer = setTimeout(() => {
      loadTechs(search);
    }, search ? 300 : 0);
    return () => clearTimeout(timer);
  }, [search, loadTechs]);

  // Visibility policy comes from staffSite.ts — the same function the server
  // annotates with — so the two cannot drift on what "works at this site"
  // means. Re-implementing the predicate here is exactly how that drift starts.
  const defaultVisible = techs.filter((t) => isVisibleByDefault(t.siteMatch));
  const visible = showEveryone ? techs : defaultVisible;
  const hiddenCount = techs.length - defaultVisible.length;

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
      ) : visible.length === 0 ? (
        <EmptyState search={search} hiddenCount={hiddenCount} />
      ) : (
        <ul className="divide-y divide-neutral-800 rounded-lg bg-neutral-950 border border-neutral-800">
          {visible.map((t) => (
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
                  {t.siteProjectName ?? 'No site set'}
                  {t.siteSource === 'declared' && t.siteProjectName ? ' (self-declared)' : ''}
                </div>
              </div>
              {t.siteMatch === 'elsewhere' && (
                <span className="text-[10px] uppercase tracking-wide rounded bg-orange-950 text-orange-300 px-2 py-0.5 flex-shrink-0 mr-2">
                  Other site
                </span>
              )}
              {t.accountStatus === 'pending' && (
                <span className="text-[10px] uppercase tracking-wide rounded bg-amber-950 text-amber-300 px-2 py-0.5 flex-shrink-0">
                  Pending
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Site filter notice + escape hatch. Never blocks: the toggle is always
          available, so a genuine cross-site handout stays possible in the app
          rather than falling back to paper. */}
      {hiddenCount > 0 && (
        <button
          type="button"
          onClick={() => setShowEveryone((v) => !v)}
          className="w-full min-h-[44px] px-4 py-2.5 rounded-lg border border-neutral-800 text-neutral-400 hover:bg-neutral-900 hover:text-neutral-200 text-xs"
        >
          {showEveryone
            ? `Showing everyone — filter to ${storeName ?? 'this site'}`
            : `${hiddenCount} ${hiddenCount === 1 ? 'person works' : 'people work'} at another site — show everyone`}
        </button>
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
