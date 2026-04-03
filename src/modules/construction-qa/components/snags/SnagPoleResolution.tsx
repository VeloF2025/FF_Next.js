/**
 * SnagPoleResolution — Inline pole linking UI for SnagDetail.
 *
 * Shows resolved pole info (zone/PON/number) or, if unresolved,
 * a "Link Pole" button that opens an inline searchable dropdown.
 *
 * WORKING: Numeric suffix search + one-click link via resolve-poles API.
 */

'use client';

import { useState, useCallback } from 'react';
import { CheckCircle, Link2 } from 'lucide-react';
import type { Snag, PoleCandidate } from '../../types/snag.types';
import { searchPoles, linkSnagToPole } from '../../services/snagService';
import { log } from '@/lib/logger';

interface SnagPoleResolutionProps {
  snag: Snag;
  onLinked: (updated: Snag) => void;
}

/** Inline pole resolution widget — shows resolved state or search UI */
export function SnagPoleResolution({ snag, onLinked }: SnagPoleResolutionProps) {
  const [showSearch, setShowSearch] = useState(false);
  const [query, setQuery] = useState('');
  const [candidates, setCandidates] = useState<PoleCandidate[]>([]);
  const [searching, setSearching] = useState(false);
  const [linking, setLinking] = useState(false);

  const isResolved = (snag.pole_ids?.length ?? 0) > 0;
  const poleRefs = snag.pole_references?.join(', ') ?? '—';

  const handleSearch = useCallback(async (value: string) => {
    setQuery(value);
    const ref = value.trim() || (snag.pole_references?.[0] ?? '');
    if (!ref) return;

    setSearching(true);
    try {
      const results = await searchPoles(snag.project_id, ref);
      setCandidates(results);
    } catch (err) {
      log.error('SnagPoleResolution: search failed', { err, snagId: snag.id });
    } finally {
      setSearching(false);
    }
  }, [snag.project_id, snag.id, snag.pole_references]);

  const handleLink = useCallback(async (poleId: string) => {
    setLinking(true);
    try {
      const updated = await linkSnagToPole(snag.id, poleId);
      onLinked(updated);
      setShowSearch(false);
      setQuery('');
      setCandidates([]);
    } catch (err) {
      log.error('SnagPoleResolution: link failed', { err, snagId: snag.id, poleId });
    } finally {
      setLinking(false);
    }
  }, [snag.id, onLinked]);

  const openSearch = useCallback(() => {
    setShowSearch(true);
    setQuery(snag.pole_references?.[0] ?? '');
  }, [snag.pole_references]);

  if (isResolved) {
    return (
      <div className="mb-3 px-1">
        <p className="flex items-center gap-1.5 text-xs text-green-400">
          <CheckCircle className="h-3.5 w-3.5 shrink-0" />
          <span className="font-mono">{poleRefs}</span>
          {snag.pole_zone_no != null && (
            <span className="text-zinc-400">Zone {snag.pole_zone_no}</span>
          )}
          {snag.pole_pon_no != null && (
            <span className="text-zinc-400">PON {snag.pole_pon_no}</span>
          )}
        </p>
      </div>
    );
  }

  return (
    <div className="mb-3 px-1 flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <p className="text-xs text-zinc-500">Pole unresolved: {poleRefs}</p>
        {!showSearch && (
          <button
            type="button"
            onClick={openSearch}
            className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 border border-blue-700 rounded px-2 py-0.5"
          >
            <Link2 className="h-3 w-3" />
            Link Pole
          </button>
        )}
      </div>

      {showSearch && (
        <div className="flex flex-col gap-1">
          <input
            type="text"
            value={query}
            onChange={(e) => { void handleSearch(e.target.value); }}
            placeholder="Search pole (e.g. PH258)"
            className="text-xs bg-zinc-800 border border-zinc-600 rounded px-2 py-1 text-zinc-200 placeholder-zinc-500 w-full focus:outline-none focus:border-blue-500"
            disabled={linking}
          />

          {searching && <p className="text-xs text-zinc-500">Searching...</p>}

          {candidates.length > 0 && (
            <ul className="bg-zinc-800 border border-zinc-700 rounded divide-y divide-zinc-700 max-h-40 overflow-y-auto">
              {candidates.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => { void handleLink(c.id); }}
                    disabled={linking}
                    className="w-full text-left px-2 py-1.5 text-xs text-zinc-200 hover:bg-zinc-700 disabled:opacity-50"
                  >
                    <span className="font-mono">{c.pole_number}</span>
                    {c.zone_no !== null && (
                      <span className="text-zinc-400 ml-2">Zone {c.zone_no}</span>
                    )}
                    {c.pon_no !== null && (
                      <span className="text-zinc-400 ml-1">PON {c.pon_no}</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}

          {!searching && query.length > 0 && candidates.length === 0 && (
            <p className="text-xs text-zinc-500">No matching poles found</p>
          )}

          <button
            type="button"
            onClick={() => { setShowSearch(false); setCandidates([]); }}
            className="text-xs text-zinc-500 hover:text-zinc-300 self-start"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
