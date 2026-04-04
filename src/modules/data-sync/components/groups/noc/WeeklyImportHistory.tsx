/**
 * WeeklyImportHistory — table of weekly import reports with expandable error details
 * Extracted from MaintenanceGroup.tsx for clarity.
 */

'use client';

import React, { useState, useEffect } from 'react';
import { RefreshCw } from 'lucide-react';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { formatDisplayDate } from '@/utils/dateFormat';

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

export function WeeklyImportHistory() {
  const [reports, setReports] = useState<WeeklyReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);

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
      const response = await fetch('/api/noc/import/weekly/history');
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
      <LoadingSpinner className="py-8" size="md" label="Loading history..." />
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
              <th className="text-left py-3 px-4 text-[var(--ff-text-secondary)] font-medium">Report</th>
              <th className="text-left py-3 px-4 text-[var(--ff-text-secondary)] font-medium">File</th>
              <th className="text-left py-3 px-4 text-[var(--ff-text-secondary)] font-medium">Status</th>
              <th className="text-right py-3 px-4 text-[var(--ff-text-secondary)] font-medium">Rows</th>
              <th className="text-right py-3 px-4 text-[var(--ff-text-secondary)] font-medium">New</th>
              <th className="text-right py-3 px-4 text-[var(--ff-text-secondary)] font-medium">Errors</th>
              <th className="text-left py-3 px-4 text-[var(--ff-text-secondary)] font-medium">Date</th>
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
                    <td className="py-3 px-4 text-[var(--ff-text-primary)] font-mono">{report.report_uid}</td>
                    <td className="py-3 px-4 text-[var(--ff-text-secondary)] truncate max-w-[200px]" title={report.original_filename}>
                      {report.original_filename}
                    </td>
                    <td className="py-3 px-4">
                      <span className={`flex items-center gap-1 ${
                        report.status === 'completed' ? 'text-green-500' :
                        report.status === 'failed' ? 'text-red-500' : 'text-yellow-500'
                      }`}>
                        {report.status}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right text-[var(--ff-text-primary)]">{report.total_rows}</td>
                    <td className="py-3 px-4 text-right text-green-500">{report.imported_count}</td>
                    <td className="py-3 px-4 text-right">
                      {hasErrors ? (
                        <button onClick={() => toggleExpand(report.id)} className="text-red-500 hover:text-red-400">
                          {report.error_count}
                        </button>
                      ) : (
                        <span className="text-[var(--ff-text-tertiary)]">0</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-[var(--ff-text-secondary)]">
                      {formatDisplayDate(report.created_at)}
                    </td>
                  </tr>
                  {isExpanded && hasErrors && (
                    <tr>
                      <td colSpan={7} className="bg-[var(--ff-bg-tertiary)] border-b border-[var(--ff-border-light)]">
                        <div className="p-4 space-y-2">
                          {errors.slice(0, 10).map((err, idx) => (
                            <div key={idx} className="text-sm text-red-400 bg-[var(--ff-bg-primary)] p-2 rounded">
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
