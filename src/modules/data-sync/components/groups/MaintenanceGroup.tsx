/**
 * Maintenance Group Component
 * Wraps maintenance sync tabs: QContact Sync, Alignment, 3-Way Alignment, Weekly Import, WA Tracking
 */

'use client';

import React, { useState, useEffect, useMemo } from 'react';
import {
  RefreshCw,
  GitCompare,
  FileSpreadsheet,
  FileUp,
  MessageSquare,
  Loader2,
  Lock,
} from 'lucide-react';
import type { MaintenanceTabId } from '../../types';
import { usePermission } from '@/hooks/usePermission';

// Import existing maintenance components
import { SyncDashboard } from '@/modules/maintenance/components/QContact/SyncDashboard';
import { SyncTrigger } from '@/modules/maintenance/components/QContact/SyncTrigger';
import { SyncAuditLog } from '@/modules/maintenance/components/QContact/SyncAuditLog';
import { AlignmentReport } from '@/modules/maintenance/components/QContact/AlignmentReport';
import { ThreeWayAlignmentReport } from '@/modules/maintenance/components/ThreeWayAlignmentReport';
import { WeeklyImportWizard } from '@/modules/maintenance/components/WeeklyImport/WeeklyImportWizard';
import { WATrackingDashboard } from '@/modules/maintenance/components/WATrackingDashboard';
import { useTriggerManualSync } from '@/modules/maintenance/hooks/useQContactSync';

// Tab configuration with permission keys
const TABS: { id: MaintenanceTabId; label: string; icon: React.ElementType; permissionKey: string }[] = [
  { id: 'qcontact', label: 'QContact Sync', icon: RefreshCw, permissionKey: 'system.data-sync.maintenance.qcontact' },
  { id: 'alignment', label: 'QC Alignment', icon: GitCompare, permissionKey: 'system.data-sync.maintenance.alignment' },
  { id: 'three-way', label: '3-Way Alignment', icon: FileSpreadsheet, permissionKey: 'system.data-sync.maintenance.three-way' },
  { id: 'weekly', label: 'Weekly Import', icon: FileUp, permissionKey: 'system.data-sync.maintenance.weekly' },
  { id: 'wa-tracking', label: 'Offline Tracking', icon: MessageSquare, permissionKey: 'system.data-sync.maintenance.wa-tracking' },
];

interface MaintenanceGroupProps {
  activeTab: string | null;
  onTabChange: (tabId: string) => void;
}

export function MaintenanceGroup({ activeTab, onTabChange }: MaintenanceGroupProps) {
  const { can, isLoading: permissionsLoading } = usePermission();
  const [showAuditLog, setShowAuditLog] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const triggerSync = useTriggerManualSync();

  // Filter tabs based on permissions
  const accessibleTabs = useMemo(() => {
    if (permissionsLoading) return [];
    return TABS.filter(tab => can(tab.permissionKey, 'view'));
  }, [permissionsLoading, can]);

  // Default to first accessible tab
  const currentTab = useMemo(() => {
    const requested = activeTab as MaintenanceTabId;
    if (accessibleTabs.some(t => t.id === requested)) {
      return requested;
    }
    return accessibleTabs[0]?.id || 'qcontact';
  }, [activeTab, accessibleTabs]);

  // Sync URL with active tab on mount
  useEffect(() => {
    if (!activeTab && accessibleTabs.length > 0) {
      onTabChange(accessibleTabs[0].id);
    }
  }, [activeTab, onTabChange, accessibleTabs]);

  // Show loading state
  if (permissionsLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-8 h-8 animate-spin text-[var(--ff-accent)]" />
        <span className="ml-3 text-[var(--ff-text-secondary)]">Loading...</span>
      </div>
    );
  }

  // Show access denied if no tabs accessible
  if (accessibleTabs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="w-16 h-16 mb-4 rounded-full bg-red-500/10 flex items-center justify-center">
          <Lock className="w-8 h-8 text-red-400" />
        </div>
        <h2 className="text-xl font-semibold text-[var(--ff-text-primary)] mb-2">Access Restricted</h2>
        <p className="text-[var(--ff-text-secondary)] max-w-md">
          You don&apos;t have permission to access any Maintenance tabs.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Tab Navigation */}
      <div className="border-b border-[var(--ff-border-light)]">
        <nav className="flex gap-1 overflow-x-auto scrollbar-hide" aria-label="Maintenance Tabs">
          {accessibleTabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = currentTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => onTabChange(tab.id)}
                className={`
                  flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap
                  ${
                    isActive
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
      {currentTab === 'qcontact' && (
        <div>
          {/* Sync Dashboard */}
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

      {currentTab === 'alignment' && (
        <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow-md p-6 border border-[var(--ff-border-light)]">
          <AlignmentReport />
        </div>
      )}

      {currentTab === 'three-way' && (
        <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow-md p-6 border border-[var(--ff-border-light)]">
          <ThreeWayAlignmentReport />
        </div>
      )}

      {currentTab === 'weekly' && (
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
              <ImportHistory />
            </div>
          ) : (
            <WeeklyImportWizard />
          )}
        </div>
      )}

      {currentTab === 'wa-tracking' && (
        <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow-md p-6 border border-[var(--ff-border-light)]">
          <WATrackingDashboard />
        </div>
      )}
    </div>
  );
}

// Import History Component (copied from original for self-containment)
function ImportHistory() {
  const [reports, setReports] = useState<WeeklyReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);

  interface ImportError {
    row_number: number;
    error_type: string;
    error_message: string;
    field_name: string | null;
    row_data: Record<string, unknown>;
  }

  interface WeeklyReport {
    id: string;
    report_uid: string;
    week_number: number;
    year: number;
    status: 'pending' | 'processing' | 'completed' | 'failed';
    total_rows: number;
    imported_count: number;
    skipped_count: number;
    error_count: number;
    original_filename: string;
    error_message: string | null;
    created_at: string;
  }

  const parseErrors = (errorMessage: string | null): ImportError[] => {
    if (!errorMessage) return [];
    try {
      return JSON.parse(errorMessage);
    } catch {
      return [];
    }
  };

  const toggleExpand = (reportId: string) => {
    setExpandedRowId(expandedRowId === reportId ? null : reportId);
  };

  const fetchHistory = async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    try {
      const response = await fetch('/api/maintenance/import/weekly/history');
      const data = await response.json();
      if (data.success) {
        setReports(data.data.reports || []);
        setError(null);
      } else {
        setError(data.error?.message || 'Failed to fetch history');
      }
    } catch {
      setError('Failed to fetch import history');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchHistory();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <RefreshCw className="w-6 h-6 animate-spin text-[var(--ff-accent)]" />
        <span className="ml-2 text-[var(--ff-text-secondary)]">Loading history...</span>
      </div>
    );
  }

  if (error) {
    return <div className="text-red-500 py-4">{error}</div>;
  }

  if (reports.length === 0) {
    return <div className="text-[var(--ff-text-tertiary)] py-4">No imports yet</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button
          onClick={() => fetchHistory(true)}
          disabled={refreshing}
          className="flex items-center gap-2 px-3 py-1.5 text-sm text-[var(--ff-text-primary)] bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg hover:bg-[var(--ff-bg-secondary)] transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          {refreshing ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--ff-border-light)]">
              <th className="text-left py-3 px-4 text-[var(--ff-text-secondary)] font-medium">
                Report
              </th>
              <th className="text-left py-3 px-4 text-[var(--ff-text-secondary)] font-medium">
                File
              </th>
              <th className="text-left py-3 px-4 text-[var(--ff-text-secondary)] font-medium">
                Status
              </th>
              <th className="text-right py-3 px-4 text-[var(--ff-text-secondary)] font-medium">
                Rows
              </th>
              <th className="text-right py-3 px-4 text-[var(--ff-text-secondary)] font-medium">
                New
              </th>
              <th className="text-right py-3 px-4 text-[var(--ff-text-secondary)] font-medium">
                Errors
              </th>
              <th className="text-left py-3 px-4 text-[var(--ff-text-secondary)] font-medium">
                Date
              </th>
            </tr>
          </thead>
          <tbody>
            {reports.map((report) => {
              const errors = parseErrors(report.error_message);
              const isExpanded = expandedRowId === report.id;
              const hasErrors = report.error_count > 0;

              return (
                <React.Fragment key={report.id}>
                  <tr className="border-b border-[var(--ff-border-light)] hover:bg-[var(--ff-bg-tertiary)]">
                    <td className="py-3 px-4 text-[var(--ff-text-primary)] font-mono">
                      {report.report_uid}
                    </td>
                    <td
                      className="py-3 px-4 text-[var(--ff-text-secondary)] truncate max-w-[200px]"
                      title={report.original_filename}
                    >
                      {report.original_filename}
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={`flex items-center gap-1 ${
                          report.status === 'completed'
                            ? 'text-green-500'
                            : report.status === 'failed'
                            ? 'text-red-500'
                            : 'text-yellow-500'
                        }`}
                      >
                        {report.status}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right text-[var(--ff-text-primary)]">
                      {report.total_rows}
                    </td>
                    <td className="py-3 px-4 text-right text-green-500">{report.imported_count}</td>
                    <td className="py-3 px-4 text-right">
                      {hasErrors ? (
                        <button
                          onClick={() => toggleExpand(report.id)}
                          className="text-red-500 hover:text-red-400"
                        >
                          {report.error_count}
                        </button>
                      ) : (
                        <span className="text-[var(--ff-text-tertiary)]">0</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-[var(--ff-text-secondary)]">
                      {new Date(report.created_at).toLocaleDateString()}
                    </td>
                  </tr>
                  {isExpanded && hasErrors && (
                    <tr>
                      <td
                        colSpan={7}
                        className="bg-[var(--ff-bg-tertiary)] border-b border-[var(--ff-border-light)]"
                      >
                        <div className="p-4 space-y-2">
                          {errors.slice(0, 10).map((err, idx) => (
                            <div
                              key={idx}
                              className="text-sm text-red-400 bg-[var(--ff-bg-primary)] p-2 rounded"
                            >
                              Row {err.row_number}: {err.error_message}
                            </div>
                          ))}
                          {errors.length > 10 && (
                            <div className="text-sm text-[var(--ff-text-tertiary)]">
                              ...and {errors.length - 10} more errors
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
