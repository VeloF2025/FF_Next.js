/**
 * ReportTabLayout — Shared tab wrapper for analytics reports.
 * Provides Table / Charts toggle used by all 5 analytics report components.
 *
 * WCAG 2.1 AA compliant tablist:
 * - role="tablist" on container
 * - role="tab" + aria-selected + aria-controls on each tab button
 * - role="tabpanel" + aria-labelledby on each panel
 * - Arrow key navigation (keyboard accessible)
 *
 * Colours: PBI dark theme tokens (no hardcoded Tailwind colour classes)
 */

'use client';

import { useState, useRef, KeyboardEvent } from 'react';
import { Table2, BarChart2 } from 'lucide-react';

type Tab = 'table' | 'charts';

const TABS: { id: Tab; label: string; icon: typeof Table2 }[] = [
  { id: 'table',  label: 'Table',           icon: Table2   },
  { id: 'charts', label: 'Charts & Graphs', icon: BarChart2 },
];

interface ReportTabLayoutProps {
  tableContent: React.ReactNode;
  chartsContent?: React.ReactNode;
}

function ChartsPlaceholder() {
  return (
    <div className="flex flex-col items-center justify-center h-64 gap-3" style={{ color: '#6B7280' }}>
      <BarChart2 className="w-12 h-12 opacity-30" />
      <p className="text-sm font-medium">Charts coming soon</p>
      <p className="text-xs" style={{ color: '#4B5563' }}>Visual representation of this report will appear here.</p>
    </div>
  );
}

export function ReportTabLayout({ tableContent, chartsContent }: ReportTabLayoutProps) {
  const [activeTab, setActiveTab] = useState<Tab>('table');
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  /** Arrow-key navigation per WCAG 4.1.2 */
  function handleKeyDown(e: KeyboardEvent<HTMLButtonElement>, idx: number) {
    let next = idx;
    if (e.key === 'ArrowRight') next = (idx + 1) % TABS.length;
    else if (e.key === 'ArrowLeft') next = (idx - 1 + TABS.length) % TABS.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = TABS.length - 1;
    else return;
    e.preventDefault();
    tabRefs.current[next]?.focus();
    setActiveTab(TABS[next]!.id);
  }

  const panelContent: Record<Tab, React.ReactNode> = {
    table:  tableContent,
    charts: chartsContent ?? <ChartsPlaceholder />,
  };

  return (
    <div className="space-y-4">
      {/* WCAG tablist */}
      <div
        role="tablist"
        aria-label="Report view"
        className="flex items-center gap-1 border-b"
        style={{ borderColor: '#374151', paddingBottom: 0 }}
      >
        {TABS.map((tab, idx) => {
          const active = activeTab === tab.id;
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              ref={el => { tabRefs.current[idx] = el; }}
              role="tab"
              id={`report-tab-${tab.id}`}
              aria-selected={active}
              aria-controls={`report-panel-${tab.id}`}
              tabIndex={active ? 0 : -1}
              onClick={() => setActiveTab(tab.id)}
              onKeyDown={e => handleKeyDown(e, idx)}
              className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
              style={{
                borderBottomColor: active ? '#118DFF' : 'transparent',
                color: active ? '#118DFF' : '#9CA3AF',
                // focus-visible ring colour
                '--tw-ring-color': '#118DFF',
              } as React.CSSProperties}
            >
              <Icon className="w-4 h-4" aria-hidden="true" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab panels — only active panel is visible, but both are in DOM for WCAG */}
      {TABS.map(tab => (
        <div
          key={tab.id}
          role="tabpanel"
          id={`report-panel-${tab.id}`}
          aria-labelledby={`report-tab-${tab.id}`}
          hidden={activeTab !== tab.id}
        >
          {panelContent[tab.id]}
        </div>
      ))}
    </div>
  );
}
