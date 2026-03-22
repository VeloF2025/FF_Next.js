/**
 * ConduitTabs — client-side tab switcher for Current / Baseline views.
 * Current: live editing (Prospective / Executable / WIP / Actual)
 * Baseline: read-only immutable snapshots
 */
'use client';

import { useState, useCallback } from 'react';
import { LayoutGrid, BookMarked } from 'lucide-react';
import { PortfolioTable } from './PortfolioTable';
import { BaselineList } from './BaselineList';
import type { ConduitProject } from '../types';
import type { ConduitBaseline } from '../types';

interface Props {
  prospectiveProjects: ConduitProject[];
  executableProjects:  ConduitProject[];
  wipProjects:         ConduitProject[];
  initialBaselines:    ConduitBaseline[];
}

type Tab = 'current' | 'baseline';

export function ConduitTabs({ prospectiveProjects, executableProjects, wipProjects, initialBaselines }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>('current');
  const [baselines, setBaselines] = useState<ConduitBaseline[]>(initialBaselines);

  // Called by PortfolioTable when a new baseline is saved — refetch to update list
  const handleBaselineSaved = useCallback(async () => {
    try {
      const res = await fetch('/api/conduit/baselines');
      if (res.ok) {
        const { data } = await res.json() as { data: ConduitBaseline[] };
        setBaselines(data ?? []);
      }
    } catch {
      // silent — the save succeeded, list just won't refresh until tab switch
    }
  }, []);

  const tabClass = (tab: Tab) =>
    `flex items-center gap-2 px-5 py-2.5 text-sm font-semibold rounded-t-lg border-b-2 transition-colors ${
      activeTab === tab
        ? 'border-teal-500 text-white bg-gray-800'
        : 'border-transparent text-gray-500 hover:text-gray-300 hover:bg-gray-800/50'
    }`;

  return (
    <div>
      {/* Tab bar */}
      <div className="flex items-end gap-1 border-b border-gray-700 mb-6">
        <button className={tabClass('current')} onClick={() => setActiveTab('current')}>
          <LayoutGrid className="w-4 h-4" />
          Current
        </button>
        <button className={tabClass('baseline')} onClick={() => setActiveTab('baseline')}>
          <BookMarked className="w-4 h-4" />
          Baseline
          {baselines.length > 0 && (
            <span className="ml-1 px-1.5 py-0.5 text-[10px] font-bold rounded-full bg-indigo-800 text-indigo-200">
              {baselines.length}
            </span>
          )}
        </button>
      </div>

      {/* Tab content */}
      {activeTab === 'current' && (
        <PortfolioTable
          prospectiveProjects={prospectiveProjects}
          executableProjects={executableProjects}
          wipProjects={wipProjects}
          onBaselineSaved={handleBaselineSaved}
        />
      )}

      {activeTab === 'baseline' && (
        <BaselineList initialBaselines={baselines} />
      )}
    </div>
  );
}
