/**
 * Action Centre — unified landing page for non-invoiceables, tickets,
 * anomalies, and the rule engine status.
 *
 * RFC Phase 5 (docs/rfcs/2026-04-17-action-centre-and-dr-timeline.md).
 * Sub-tabs driven by ?tab= query param so links can deep-link straight
 * to the Items view with source/note filters.
 */

import type { NextPage } from 'next';
import { useRouter } from 'next/router';
import { AppLayout } from '@/components/layout/AppLayout';
import { ModulePage } from '@/components/module-page';
import { activateConfig } from '@/modules/navigation';
import { OverviewTab } from '@/modules/action-centre/OverviewTab';
import { ItemsTab } from '@/modules/action-centre/ItemsTab';
import { ReconTab } from '@/modules/action-centre/ReconTab';
import { TicketsTab } from '@/modules/action-centre/TicketsTab';
import { AutomationTab } from '@/modules/action-centre/AutomationTab';
import { DisputesTab } from '@/modules/action-centre/DisputesTab';

type TabId = 'overview' | 'items' | 'recon' | 'disputes' | 'tickets' | 'automation';

const TABS: Array<{ id: TabId; label: string; icon: string }> = [
  { id: 'overview', label: 'Overview', icon: '📊' },
  { id: 'items', label: 'Action items', icon: '📋' },
  { id: 'recon', label: 'Recon', icon: '⚖️' },
  { id: 'disputes', label: 'Disputes', icon: '💼' },
  { id: 'tickets', label: 'Tickets', icon: '🎫' },
  { id: 'automation', label: 'Automation', icon: '⚡' },
];

const ActionCentrePage: NextPage = () => {
  const router = useRouter();
  const rawTab = typeof router.query.tab === 'string' ? router.query.tab : 'overview';
  const activeTab: TabId = TABS.some((t) => t.id === rawTab) ? (rawTab as TabId) : 'overview';

  const setTab = (id: TabId) => {
    const query = { ...router.query };
    query.tab = id;
    router.push({ pathname: '/activate/action-centre', query }, undefined, { shallow: true });
  };

  return (
    <AppLayout>
      <ModulePage config={activateConfig}>
        <div className="space-y-4">
          <div>
            <h2 className="text-2xl font-semibold text-[var(--ff-text-primary)]">Action Centre</h2>
          </div>

          {/* Sub-tab nav */}
          <div className="border-b border-[var(--ff-border-light)]">
            <nav className="flex -mb-px" role="tablist" aria-label="Action Centre sections">
              {TABS.map((tab) => {
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    role="tab"
                    aria-selected={isActive}
                    onClick={() => setTab(tab.id)}
                    className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                      isActive
                        ? 'border-blue-500 text-[var(--ff-text-primary)]'
                        : 'border-transparent text-[var(--ff-text-tertiary)] hover:text-[var(--ff-text-primary)] hover:border-[var(--ff-border-light)]'
                    }`}
                  >
                    <span className="mr-2">{tab.icon}</span>
                    {tab.label}
                  </button>
                );
              })}
            </nav>
          </div>

          {activeTab === 'overview' && <OverviewTab />}
          {activeTab === 'items' && <ItemsTab />}
          {activeTab === 'recon' && <ReconTab />}
          {activeTab === 'disputes' && <DisputesTab />}
          {activeTab === 'tickets' && <TicketsTab />}
          {activeTab === 'automation' && <AutomationTab />}
        </div>
      </ModulePage>
    </AppLayout>
  );
};

export default ActionCentrePage;
