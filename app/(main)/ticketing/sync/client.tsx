'use client';

/**
 * QContact Sync Page Client Component
 *
 * Manages bidirectional synchronization with QContact system:
 * - Sync status dashboard
 * - Manual sync trigger
 * - Sync history log
 * - Success/failure metrics
 * - Error tracking and reporting
 *
 * 🟢 WORKING: QContact sync page integrates sync components
 */

import { SyncDashboard } from '@/modules/ticketing/components/QContact/SyncDashboard';
import { SyncTrigger } from '@/modules/ticketing/components/QContact/SyncTrigger';
import { SyncAuditLog } from '@/modules/ticketing/components/QContact/SyncAuditLog';
import { useTriggerManualSync } from '@/modules/ticketing/hooks/useQContactSync';
import { useState } from 'react';

export default function QContactSyncPageClient() {
  const [showAuditLog, setShowAuditLog] = useState(false);
  const triggerSync = useTriggerManualSync();

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">QContact Synchronization</h1>
        <p className="text-[var(--ff-text-secondary)]">Manage bidirectional sync with QContact ticketing system</p>
      </div>

      {/* Sync Dashboard - Shows current status and metrics */}
      <div className="mb-6">
        <SyncDashboard />
      </div>

      {/* Manual Sync Trigger */}
      <div className="mb-6">
        <SyncTrigger onTriggerSync={triggerSync.mutateAsync} disabled={triggerSync.isPending} />
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
  );
}
