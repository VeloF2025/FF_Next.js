/**
 * ReportTabLayout — Shared tab wrapper for analytics reports.
 * Provides Table / Charts toggle used by all 5 analytics report components.
 *
 * Tab 1: Table (existing content — always rendered first)
 * Tab 2: Charts & Graphs (placeholder until chart implementations are added)
 */

'use client';

import { useState } from 'react';
import { Table2, BarChart2 } from 'lucide-react';

type Tab = 'table' | 'charts';

interface ReportTabLayoutProps {
  /** Content for the Table tab (existing report content) */
  tableContent: React.ReactNode;
  /** Optional content for the Charts tab — defaults to placeholder */
  chartsContent?: React.ReactNode;
}

function ChartsPlaceholder() {
  return (
    <div className="flex flex-col items-center justify-center h-64 text-gray-500 gap-3">
      <BarChart2 className="w-12 h-12 opacity-30" />
      <p className="text-sm font-medium">Charts coming soon</p>
      <p className="text-xs text-gray-600">Visual representation of this report will appear here.</p>
    </div>
  );
}

export function ReportTabLayout({ tableContent, chartsContent }: ReportTabLayoutProps) {
  const [activeTab, setActiveTab] = useState<Tab>('table');

  return (
    <div className="space-y-4">
      {/* Tab toggle */}
      <div className="flex items-center gap-1 border-b border-gray-700 pb-0">
        <button
          onClick={() => setActiveTab('table')}
          className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'table'
              ? 'border-blue-500 text-blue-400'
              : 'border-transparent text-gray-400 hover:text-gray-200 hover:border-gray-600'
          }`}
        >
          <Table2 className="w-4 h-4" />
          Table
        </button>
        <button
          onClick={() => setActiveTab('charts')}
          className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'charts'
              ? 'border-blue-500 text-blue-400'
              : 'border-transparent text-gray-400 hover:text-gray-200 hover:border-gray-600'
          }`}
        >
          <BarChart2 className="w-4 h-4" />
          Charts &amp; Graphs
        </button>
      </div>

      {/* Tab content */}
      {activeTab === 'table' ? (
        tableContent
      ) : (
        chartsContent ?? <ChartsPlaceholder />
      )}
    </div>
  );
}
