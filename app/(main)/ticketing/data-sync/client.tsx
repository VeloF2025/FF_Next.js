'use client';

/**
 * Data Sync Page Client Component
 *
 * Combined page with tabs for:
 * - QContact Sync: Bidirectional synchronization with QContact system
 * - Weekly Import: Excel file imports for maintenance reports
 */

import { useState } from 'react';
import { RefreshCw, FileUp } from 'lucide-react';

// QContact Sync components
import { SyncDashboard } from '@/modules/ticketing/components/QContact/SyncDashboard';
import { SyncTrigger } from '@/modules/ticketing/components/QContact/SyncTrigger';
import { SyncAuditLog } from '@/modules/ticketing/components/QContact/SyncAuditLog';
import { useTriggerManualSync } from '@/modules/ticketing/hooks/useQContactSync';

// Weekly Import component
import { WeeklyImportWizard } from '@/modules/ticketing/components/WeeklyImport/WeeklyImportWizard';

type TabId = 'qcontact' | 'weekly';

interface Tab {
  id: TabId;
  label: string;
  icon: typeof RefreshCw;
}

const tabs: Tab[] = [
  { id: 'qcontact', label: 'QContact Sync', icon: RefreshCw },
  { id: 'weekly', label: 'Weekly Import', icon: FileUp },
];

export default function DataSyncPageClient() {
  const [activeTab, setActiveTab] = useState<TabId>('qcontact');
  const [showAuditLog, setShowAuditLog] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const triggerSync = useTriggerManualSync();

  return (
    <div className="p-6">
      {/* Page Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">Data Sync</h1>
        <p className="text-[var(--ff-text-secondary)]">
          Sync tickets with QContact or import weekly maintenance reports
        </p>
      </div>

      {/* Tab Navigation */}
      <div className="mb-6 border-b border-[var(--ff-border-light)]">
        <nav className="flex gap-1" aria-label="Tabs">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`
                  flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors
                  ${isActive
                    ? 'border-[var(--ff-accent)] text-[var(--ff-accent)]'
                    : 'border-transparent text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:border-[var(--ff-border-medium)]'
                  }
                `}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Tab Content */}
      {activeTab === 'qcontact' && (
        <div>
          {/* Sync Dashboard - Shows current status and metrics */}
          <div className="mb-6">
            <SyncDashboard />
          </div>

          {/* Manual Sync Trigger */}
          <div className="mb-6">
            <SyncTrigger
              onTriggerSync={triggerSync.mutateAsync}
              disabled={triggerSync.isPending}
            />
          </div>

          {/* Toggle for Audit Log */}
          <div className="mb-4">
            <button
              onClick={() => setShowAuditLog(!showAuditLog)}
              className="px-4 py-2 text-sm text-[var(--ff-text-primary)] bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg hover:bg-[var(--ff-bg-tertiary)] transition-colors"
            >
              {showAuditLog ? 'Hide Audit Log' : 'View Audit Log'}
            </button>
          </div>

          {/* Sync Audit Log */}
          {showAuditLog && (
            <div>
              <SyncAuditLog />
            </div>
          )}
        </div>
      )}

      {activeTab === 'weekly' && (
        <div>
          <div className="mb-4">
            <button
              onClick={() => setShowHistory(!showHistory)}
              className="px-4 py-2 text-sm text-[var(--ff-text-primary)] bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg hover:bg-[var(--ff-bg-tertiary)] transition-colors"
            >
              {showHistory ? 'Hide History' : 'View Import History'}
            </button>
          </div>

          {showHistory ? (
            <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow-md p-6 border border-[var(--ff-border-light)]">
              <h2 className="text-lg font-semibold mb-4 text-[var(--ff-text-primary)]">
                Import History
              </h2>
              <p className="text-[var(--ff-text-tertiary)]">
                Import history will be displayed here
              </p>
            </div>
          ) : (
            <WeeklyImportWizard />
          )}
        </div>
      )}
    </div>
  );
}
