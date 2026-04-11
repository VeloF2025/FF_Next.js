/**
 * OLT Report Group Component — thin shell
 * Delegates to useOltState hook and per-tab components.
 */

'use client';

import { Lock } from 'lucide-react';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { useOltState, OLT_TABS } from '../../hooks/useOltState';
import { OltAutoDetectBanner } from './olt/OltAutoDetectBanner';
import { OltImportTab } from './olt/OltImportTab';
import { OltFixableTab } from './olt/OltFixableTab';
import { OltInvestigateTab } from './olt/OltInvestigateTab';
import { OltEscalationsTab } from './olt/OltEscalationsTab';
import { OltFixLogTab } from './olt/OltFixLogTab';
import { OltReportingTab } from './olt/OltReportingTab';

interface OltReportGroupProps {
  activeTab: string | null;
  onTabChange: (tabId: string) => void;
}

export function OltReportGroup({ activeTab, onTabChange }: OltReportGroupProps) {
  const state = useOltState(activeTab, onTabChange);

  // Loading state while permissions resolve
  if (state.permissionsLoading) {
    return (
      <LoadingSpinner className="py-16" size="lg" label="Loading..." />
    );
  }

  // Access denied
  if (state.accessibleTabs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="w-16 h-16 mb-4 rounded-full bg-red-500/10 flex items-center justify-center">
          <Lock className="w-8 h-8 text-red-400" />
        </div>
        <h2 className="text-xl font-semibold text-[var(--ff-text-primary)] mb-2">Access Restricted</h2>
        <p className="text-[var(--ff-text-secondary)] max-w-md">
          You don&apos;t have permission to access any OLT Report tabs.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Auto-Detect Banner — visible on all tabs */}
      <OltAutoDetectBanner autoDetectStatus={state.autoDetectStatus} />

      {/* Tab Navigation */}
      <div className="border-b border-[var(--ff-border-light)]">
        <nav className="flex gap-1 overflow-x-auto scrollbar-hide" aria-label="OLT Report Tabs">
          {state.accessibleTabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = state.currentTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => {
                  state.setPage(1);
                  onTabChange(tab.id);
                }}
                className={`
                  flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap
                  ${isActive
                    ? 'border-[var(--ff-accent)] text-[var(--ff-accent)]'
                    : 'border-transparent text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:border-[var(--ff-border-medium)]'
                  }
                `}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
                {tab.id === 'pending' && state.stats.pending > 0 && (
                  <span className="ml-1 px-2 py-0.5 text-xs bg-amber-500/20 text-amber-400 rounded-full">
                    {state.stats.pending}
                  </span>
                )}
                {tab.id === 'investigate' && state.stats.needs_investigation > 0 && (
                  <span className="ml-1 px-2 py-0.5 text-xs bg-red-500/20 text-red-400 rounded-full">
                    {state.stats.needs_investigation}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Error Display */}
      {state.error && (
        <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400">
          {state.error}
          <button onClick={() => state.setError(null)} className="ml-4 text-sm underline hover:no-underline">
            Dismiss
          </button>
        </div>
      )}

      {/* Tab Content */}
      {state.currentTab === 'import' && (
        <OltImportTab
          autoDetectStatus={state.autoDetectStatus}
          fetchStats={state.fetchStats}
        />
      )}

      {state.currentTab === 'pending' && (
        <OltFixableTab
          records={state.records}
          stats={state.stats}
          isLoading={state.isLoading}
          page={state.page}
          total={state.total}
          pageSize={state.pageSize}
          setPage={state.setPage}
          fixing={state.fixing}
          fixErrors={state.fixErrors}
          setFixErrors={state.setFixErrors}
          handleFix={state.handleFix}
          isStatusMismatch={state.isStatusMismatch}
          getInvestigationContext={state.getInvestigationContext}
          fetchRecords={state.fetchRecords}
          fetchStats={state.fetchStats}
        />
      )}

      {state.currentTab === 'investigate' && (
        <OltInvestigateTab
          records={state.records}
          stats={state.stats}
          isLoading={state.isLoading}
          page={state.page}
          total={state.total}
          pageSize={state.pageSize}
          setPage={state.setPage}
          setError={state.setError}
          isStatusMismatch={state.isStatusMismatch}
          getInvestigationContext={state.getInvestigationContext}
          fetchRecords={state.fetchRecords}
          fetchStats={state.fetchStats}
        />
      )}

      {state.currentTab === 'escalations' && (
        <OltEscalationsTab
          records={state.records}
          isLoading={state.isLoading}
          page={state.page}
          total={state.total}
          pageSize={state.pageSize}
          setPage={state.setPage}
          isStatusMismatch={state.isStatusMismatch}
          getInvestigationContext={state.getInvestigationContext}
        />
      )}

      {state.currentTab === 'history' && (
        <OltFixLogTab
          fixHistory={state.fixHistory}
          imports={state.imports}
          stats={state.stats}
          isLoading={state.isLoading}
          total={state.total}
          dateFilter={state.dateFilter}
          customDate={state.customDate}
          statusFilter={state.statusFilter}
          setDateFilter={state.setDateFilter}
          setCustomDate={state.setCustomDate}
          setStatusFilter={state.setStatusFilter}
        />
      )}

      {state.currentTab === 'reporting' && (
        <OltReportingTab setError={state.setError} />
      )}
    </div>
  );
}
