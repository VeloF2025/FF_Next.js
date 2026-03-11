'use client';

/**
 * Data Sync Page Client Component
 *
 * Combined page with tabs for:
 * - QContact Sync: Bidirectional synchronization with QContact system
 * - Weekly Import: Excel file imports for maintenance reports
 *
 * 🟢 WORKING: Data sync page integrates ModulePage for consistent tab navigation
 */

import React, { useState, useEffect } from 'react';
import { ModulePage } from '@/components/module-page';
import { nocConfig } from '@/modules/navigation';
import { RefreshCw, FileUp, CheckCircle, XCircle, Clock, Loader2, ChevronDown, ChevronRight, AlertTriangle, GitCompare, FileSpreadsheet, MessageSquare } from 'lucide-react';

// QContact Sync components
import { SyncDashboard } from '@/modules/noc/components/QContact/SyncDashboard';
import { SyncTrigger } from '@/modules/noc/components/QContact/SyncTrigger';
import { SyncAuditLog } from '@/modules/noc/components/QContact/SyncAuditLog';
import { AlignmentReport } from '@/modules/noc/components/QContact/AlignmentReport';
import { useTriggerManualSync } from '@/modules/noc/hooks/useQContactSync';

// Three-Way Alignment component
import { ThreeWayAlignmentReport } from '@/modules/noc/components/ThreeWayAlignmentReport';

// Weekly Import component
import { WeeklyImportWizard } from '@/modules/noc/components/WeeklyImport/WeeklyImportWizard';

// WA Tracking component
import { WATrackingDashboard } from '@/modules/noc/components/WATrackingDashboard';

// Import History types
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

// Import History Component
function ImportHistory() {
  const [reports, setReports] = useState<WeeklyReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);

  // Parse error message JSON into ImportError array
  const parseErrors = (errorMessage: string | null): ImportError[] => {
    if (!errorMessage) return [];
    try {
      return JSON.parse(errorMessage);
    } catch {
      return [];
    }
  };

  // Toggle row expansion
  const toggleExpand = (reportId: string) => {
    setExpandedRowId(expandedRowId === reportId ? null : reportId);
  };

  // Fetch history function (reusable for refresh)
  const fetchHistory = async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    try {
      const response = await fetch('/api/noc/import/weekly/history');
      const data = await response.json();
      if (data.success) {
        setReports(data.data.reports || []);
        setError(null);
      } else {
        setError(data.error?.message || 'Failed to fetch history');
      }
    } catch (err) {
      setError('Failed to fetch import history');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  // Refresh handler
  const handleRefresh = () => {
    fetchHistory(true);
  };

  useEffect(() => {
    fetchHistory();
  }, []);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'failed':
        return <XCircle className="w-4 h-4 text-red-500" />;
      case 'processing':
        return <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />;
      default:
        return <Clock className="w-4 h-4 text-yellow-500" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed':
        return 'text-green-500';
      case 'failed':
        return 'text-red-500';
      case 'processing':
        return 'text-blue-500';
      default:
        return 'text-yellow-500';
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-6 h-6 animate-spin text-[var(--ff-accent)]" />
        <span className="ml-2 text-[var(--ff-text-secondary)]">Loading history...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-red-500 py-4">{error}</div>
    );
  }

  if (reports.length === 0) {
    return (
      <div className="text-[var(--ff-text-tertiary)] py-4">No imports yet</div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Refresh Button */}
      <div className="flex justify-end">
        <button
          onClick={handleRefresh}
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
              <th className="text-left py-3 px-4 text-[var(--ff-text-secondary)] font-medium">Report</th>
              <th className="text-left py-3 px-4 text-[var(--ff-text-secondary)] font-medium">File</th>
              <th className="text-left py-3 px-4 text-[var(--ff-text-secondary)] font-medium">Status</th>
              <th className="text-right py-3 px-4 text-[var(--ff-text-secondary)] font-medium">Rows</th>
              <th className="text-right py-3 px-4 text-[var(--ff-text-secondary)] font-medium">New</th>
              <th className="text-right py-3 px-4 text-[var(--ff-text-secondary)] font-medium" title="Existing tickets updated">Duplicates</th>
              <th className="text-right py-3 px-4 text-[var(--ff-text-secondary)] font-medium">Errors</th>
              <th className="text-left py-3 px-4 text-[var(--ff-text-secondary)] font-medium">Date</th>
            </tr>
          </thead>
        <tbody>
          {reports.map((report) => {
            const errors = parseErrors(report.error_message);
            const isExpanded = expandedRowId === report.id;
            const hasErrors = report.error_count > 0;
            // Calculate duplicates: total - new - errors
            const duplicateCount = Math.max(0, report.total_rows - report.imported_count - report.error_count);

            return (
              <React.Fragment key={report.id}>
                <tr className="border-b border-[var(--ff-border-light)] hover:bg-[var(--ff-bg-tertiary)]">
                  <td className="py-3 px-4 text-[var(--ff-text-primary)] font-mono">{report.report_uid}</td>
                  <td className="py-3 px-4 text-[var(--ff-text-secondary)] truncate max-w-[200px]" title={report.original_filename}>
                    {report.original_filename}
                  </td>
                  <td className="py-3 px-4">
                    <span className={`flex items-center gap-1 ${getStatusColor(report.status)}`}>
                      {getStatusIcon(report.status)}
                      {report.status}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-right text-[var(--ff-text-primary)]">{report.total_rows}</td>
                  <td className="py-3 px-4 text-right text-green-500">{report.imported_count}</td>
                  <td className="py-3 px-4 text-right text-blue-400">{duplicateCount}</td>
                  <td className="py-3 px-4 text-right">
                    {hasErrors ? (
                      <button
                        onClick={() => toggleExpand(report.id)}
                        className="flex items-center gap-1 text-red-500 hover:text-red-400 transition-colors ml-auto"
                      >
                        {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                        {report.error_count}
                      </button>
                    ) : (
                      <span className="text-[var(--ff-text-tertiary)]">0</span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-[var(--ff-text-secondary)]">
                    {new Date(report.created_at).toLocaleDateString()} {new Date(report.created_at).toLocaleTimeString()}
                  </td>
                </tr>

                {/* Expandable Error Details */}
                {isExpanded && hasErrors && (
                  <tr>
                    <td colSpan={8} className="bg-[var(--ff-bg-tertiary)] border-b border-[var(--ff-border-light)]">
                      <div className="p-4">
                        <h4 className="text-sm font-semibold text-[var(--ff-text-primary)] mb-3 flex items-center gap-2">
                          <AlertTriangle className="w-4 h-4 text-red-500" />
                          Import Errors ({errors.length})
                        </h4>
                        <div className="space-y-3 max-h-[400px] overflow-y-auto">
                          {errors.map((err, idx) => (
                            <div
                              key={idx}
                              className="bg-[var(--ff-bg-primary)] rounded-lg p-3 border border-[var(--ff-border-light)]"
                            >
                              <div className="flex items-start justify-between mb-2">
                                <span className="text-xs font-mono text-[var(--ff-text-tertiary)]">
                                  Row {err.row_number}
                                </span>
                                <span className="text-xs px-2 py-0.5 rounded bg-red-500/20 text-red-400">
                                  {err.error_type.replace(/_/g, ' ')}
                                </span>
                              </div>
                              <p className="text-sm text-red-400 mb-2">{err.error_message}</p>
                              {err.row_data && (
                                <details className="text-xs">
                                  <summary className="cursor-pointer text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]">
                                    View row data
                                  </summary>
                                  <div className="mt-2 p-2 bg-[var(--ff-bg-secondary)] rounded font-mono text-[var(--ff-text-tertiary)] overflow-x-auto">
                                    <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                                      {Object.entries(err.row_data).map(([key, value]) => (
                                        <div key={key} className="flex">
                                          <span className="text-[var(--ff-accent)]">{key}:</span>
                                          <span className="ml-2 truncate">{String(value || '-')}</span>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                </details>
                              )}
                            </div>
                          ))}
                        </div>
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

type TabId = 'qcontact' | 'alignment' | 'three-way' | 'weekly' | 'wa-tracking';

interface Tab {
  id: TabId;
  label: string;
  icon: typeof RefreshCw;
}

const tabs: Tab[] = [
  { id: 'qcontact', label: 'QContact Sync', icon: RefreshCw },
  { id: 'alignment', label: 'QC Alignment', icon: GitCompare },
  { id: 'three-way', label: '3-Way Alignment', icon: FileSpreadsheet },
  { id: 'weekly', label: 'Weekly Import', icon: FileUp },
  { id: 'wa-tracking', label: 'Offline Tracking', icon: MessageSquare },
];

export default function DataSyncPageClient() {
  const [activeTab, setActiveTab] = useState<TabId>('qcontact');
  const [showAuditLog, setShowAuditLog] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const triggerSync = useTriggerManualSync();

  return (
    <ModulePage config={nocConfig}>
      <div className="flex flex-col h-full">
        {/* Sub-Tab Navigation (internal to this page) */}
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

      {activeTab === 'alignment' && (
        <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow-md p-6 border border-[var(--ff-border-light)]">
          <AlignmentReport />
        </div>
      )}

      {activeTab === 'three-way' && (
        <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow-md p-6 border border-[var(--ff-border-light)]">
          <ThreeWayAlignmentReport />
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
              <ImportHistory />
            </div>
          ) : (
            <WeeklyImportWizard />
          )}
        </div>
      )}

      {activeTab === 'wa-tracking' && (
        <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow-md p-6 border border-[var(--ff-border-light)]">
          <WATrackingDashboard />
        </div>
      )}
      </div>
    </ModulePage>
  );
}
