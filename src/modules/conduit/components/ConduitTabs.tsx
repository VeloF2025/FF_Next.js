/**
 * ConduitTabs — client-side tab switcher for Current / Baseline / Scoping views.
 * Current: live editing (Prospective / Executable / WIP)
 * Baseline: read-only immutable snapshots
 * Scoping: standalone PM calculator — isolated from Current/Baseline, no actuals
 */
'use client';

import { useState, useCallback } from 'react';
import { LayoutGrid, BookMarked, Calculator } from 'lucide-react';
import { PortfolioTable, ProjectsGrid } from './PortfolioTable';
import { BaselineList } from './BaselineList';
import type { ConduitProject } from '../types';
import type { ConduitBaseline } from '../types';

interface Props {
  prospectiveProjects: ConduitProject[];
  executableProjects:  ConduitProject[];
  wipProjects:         ConduitProject[];
  scopingProjects:     ConduitProject[];
  initialBaselines:    ConduitBaseline[];
}

type Tab = 'current' | 'baseline' | 'scoping';

export function ConduitTabs({ prospectiveProjects, executableProjects, wipProjects, scopingProjects, initialBaselines }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>('current');
  const [baselines, setBaselines] = useState<ConduitBaseline[]>(initialBaselines);

  const handleBaselineSaved = useCallback(async () => {
    try {
      const res = await fetch('/api/conduit/baselines');
      if (res.ok) {
        const { data } = await res.json() as { data: ConduitBaseline[] };
        setBaselines(data ?? []);
      }
    } catch { /* silent */ }
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
        <button className={tabClass('scoping')} onClick={() => setActiveTab('scoping')}>
          <Calculator className="w-4 h-4" />
          Scoping
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

      {activeTab === 'scoping' && (
        <div className="space-y-6">
          <div className="flex items-center gap-3">
            <span className="text-sm font-bold uppercase tracking-widest border border-cyan-500 text-cyan-400 px-3 py-1 rounded">
              Scoping
            </span>
            <div className="flex-1 border-t border-gray-700" />
            <span className="text-xs text-gray-500">PM costing calculator — independent from Current &amp; Baseline</span>
          </div>
          <ProjectsGrid
            initialProjects={scopingProjects}
            tableLabel="Project Scope — Scoping"
            defaultStatus="scoping"
            showAddButton
            showDeleteButton
          />
        </div>
      )}
    </div>
  );
}
