/**
 * SerialMismatchReports - ONT Serial Change Tracking Report
 *
 * Tracks ONTs where the serial at installation differs from the current serial.
 * Critical for:
 * - Detecting potential ONT theft/loss
 * - Identifying unreported ONT replacements
 * - Team accountability (which team's installations have issues)
 *
 * Status: WORKING
 * NLNH Confidence: HIGH
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  AlertTriangle,
  CheckCircle,
  XCircle,
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  Ticket,
  Search,
  Users,
  Shield,
} from 'lucide-react';
import type {
  ReportFilters,
  SerialMismatchRecord,
  MismatchStatus,
  MismatchResolution,
} from '../../types/reporting.types';

interface SerialMismatchReportsProps {
  filters: ReportFilters;
  refreshKey: number;
}

interface MismatchData {
  summary: {
    total: number;
    pending_investigation: number;
    ticket_created: number;
    resolved: number;
    false_positive: number;
    by_zone: Record<string, number>;
    by_reason: Record<string, number>;
    by_team: Record<string, number>;
  };
  records: (SerialMismatchRecord & { installation_team: string | null })[];
  total_count: number;
  page: number;
  page_size: number;
  available_teams: string[];
  available_zones: string[];
}

export function SerialMismatchReports({ filters, refreshKey }: SerialMismatchReportsProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<MismatchData | null>(null);

  // Filter states
  const [selectedStatus, setSelectedStatus] = useState<string>('pending_investigation');
  const [selectedTeam, setSelectedTeam] = useState<string>('');
  const [selectedZone, setSelectedZone] = useState<string>('');

  // Pagination
  const [page, setPage] = useState(1);
  const pageSize = 50;

  // Action states
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [resolutionModal, setResolutionModal] = useState<{
    record: SerialMismatchRecord;
    resolution: MismatchResolution;
    notes: string;
  } | null>(null);

  // Fetch data
  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      if (selectedZone) params.set('zone', selectedZone);
      if (selectedTeam) params.set('team', selectedTeam);
      if (selectedStatus) params.set('status', selectedStatus);
      params.set('page', page.toString());
      params.set('pageSize', pageSize.toString());

      const res = await fetch(`/api/activate/reporting/serial-mismatches?${params}`);
      if (!res.ok) throw new Error('Failed to fetch serial mismatch report');
      const json = await res.json();
      setData(json.data || json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch data');
    } finally {
      setIsLoading(false);
    }
  }, [selectedStatus, selectedTeam, selectedZone, page, refreshKey]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Reset page when filters change
  useEffect(() => {
    setPage(1);
  }, [selectedStatus, selectedTeam, selectedZone]);

  // Handle status update
  const handleStatusUpdate = async (
    id: string,
    newStatus: MismatchStatus,
    resolution?: MismatchResolution,
    notes?: string
  ) => {
    setActionLoading(id);
    try {
      const res = await fetch('/api/activate/reporting/serial-mismatches/update-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status: newStatus, resolution, notes }),
      });

      if (!res.ok) throw new Error('Failed to update status');
      fetchData();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update status');
    } finally {
      setActionLoading(null);
      setResolutionModal(null);
    }
  };

  // Handle create ticket
  const handleCreateTicket = async (id: string) => {
    setActionLoading(id);
    try {
      const res = await fetch('/api/activate/reporting/serial-mismatches/create-ticket', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, priority: 'high' }),
      });

      if (!res.ok) throw new Error('Failed to create ticket');
      const result = await res.json();
      const resultData = result.data || result;

      if (resultData.success) {
        alert(`Ticket created: ${resultData.ticket_title}`);
        fetchData();
      } else {
        alert(resultData.message || 'Failed to create ticket');
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to create ticket');
    } finally {
      setActionLoading(null);
    }
  };

  // Export to CSV
  const handleExport = async () => {
    try {
      const params = new URLSearchParams();
      params.set('format', 'csv');

      const res = await fetch(`/api/activate/reporting/serial-mismatches?${params}`);
      if (!res.ok) throw new Error('Failed to export');

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ont-serial-mismatches-${new Date().toISOString().split('T')[0]}.csv`;
      a.click();
    } catch (err) {
      alert('Export failed');
    }
  };

  // Get status badge style
  const getStatusBadge = (status: MismatchStatus) => {
    switch (status) {
      case 'pending_investigation':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400">
            <Search className="h-3 w-3" />
            Pending
          </span>
        );
      case 'ticket_created':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400">
            <Ticket className="h-3 w-3" />
            Ticket
          </span>
        );
      case 'resolved':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
            <CheckCircle className="h-3 w-3" />
            Resolved
          </span>
        );
      case 'false_positive':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300">
            <XCircle className="h-3 w-3" />
            False +
          </span>
        );
    }
  };

  if (error) {
    return (
      <div className="p-6 text-center">
        <AlertTriangle className="h-8 w-8 text-red-500 mx-auto mb-2" />
        <p className="text-red-600 dark:text-red-400">{error}</p>
        <button onClick={fetchData} className="mt-2 text-blue-600 hover:underline">
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Alert Banner */}
      <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
        <div className="flex items-start gap-3">
          <Shield className="h-5 w-5 text-red-600 dark:text-red-400 mt-0.5" />
          <div className="text-sm">
            <p className="font-medium text-red-800 dark:text-red-300">
              ⚠️ ONT Serial Discrepancies - Potential Inventory Loss
            </p>
            <p className="text-red-700 dark:text-red-400 mt-1">
              These DRs show a <strong>different ONT serial</strong> in the offline report compared to what was activated.
              The original ONT may have been replaced without documentation, stolen, or there&apos;s a data entry error.
            </p>
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
          <div className="text-sm text-gray-500 dark:text-gray-400">Total Mismatches</div>
          <div className="text-2xl font-bold text-gray-900 dark:text-white">
            {isLoading ? '...' : data?.summary.total ?? 0}
          </div>
        </div>
        <div
          className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 cursor-pointer hover:bg-red-100 dark:hover:bg-red-900/30"
          onClick={() => setSelectedStatus('pending_investigation')}
        >
          <div className="text-sm text-red-600 dark:text-red-400">Pending Investigation</div>
          <div className="text-2xl font-bold text-red-700 dark:text-red-300">
            {isLoading ? '...' : data?.summary.pending_investigation ?? 0}
          </div>
        </div>
        <div
          className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4 cursor-pointer hover:bg-blue-100 dark:hover:bg-blue-900/30"
          onClick={() => setSelectedStatus('ticket_created')}
        >
          <div className="text-sm text-blue-600 dark:text-blue-400">Tickets Created</div>
          <div className="text-2xl font-bold text-blue-700 dark:text-blue-300">
            {isLoading ? '...' : data?.summary.ticket_created ?? 0}
          </div>
        </div>
        <div
          className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4 cursor-pointer hover:bg-green-100 dark:hover:bg-green-900/30"
          onClick={() => setSelectedStatus('resolved')}
        >
          <div className="text-sm text-green-600 dark:text-green-400">Resolved</div>
          <div className="text-2xl font-bold text-green-700 dark:text-green-300">
            {isLoading ? '...' : data?.summary.resolved ?? 0}
          </div>
        </div>
      </div>

      {/* Team Breakdown (Critical for accountability) */}
      {data?.summary.by_team && Object.keys(data.summary.by_team).length > 0 && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-3">
            <Users className="h-5 w-5 text-amber-600 dark:text-amber-400" />
            <span className="font-medium text-amber-800 dark:text-amber-300">Mismatches by Installation Team</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {Object.entries(data.summary.by_team)
              .sort((a, b) => b[1] - a[1])
              .map(([team, count]) => (
                <button
                  key={team}
                  onClick={() => setSelectedTeam(selectedTeam === team ? '' : team)}
                  className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                    selectedTeam === team
                      ? 'bg-amber-600 text-white'
                      : 'bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300 hover:bg-amber-200 dark:hover:bg-amber-900/60'
                  }`}
                >
                  {team}: {count}
                </button>
              ))}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Status:
          </label>
          <select
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value)}
            className="px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
          >
            <option value="">All</option>
            <option value="pending_investigation">Pending Investigation</option>
            <option value="ticket_created">Ticket Created</option>
            <option value="resolved">Resolved</option>
            <option value="false_positive">False Positive</option>
          </select>
        </div>

        {data?.available_teams && data.available_teams.length > 0 && (
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Team:
            </label>
            <select
              value={selectedTeam}
              onChange={(e) => setSelectedTeam(e.target.value)}
              className="px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            >
              <option value="">All Teams</option>
              {data.available_teams.map((t) => (
                <option key={t} value={t}>
                  {t} ({data.summary.by_team?.[t] || 0})
                </option>
              ))}
            </select>
          </div>
        )}

        {data?.available_zones && data.available_zones.length > 0 && (
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Zone:
            </label>
            <select
              value={selectedZone}
              onChange={(e) => setSelectedZone(e.target.value)}
              className="px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            >
              <option value="">All Zones</option>
              {data.available_zones.map((z) => (
                <option key={z} value={z}>
                  Zone {z} ({data.summary.by_zone?.[z] || 0})
                </option>
              ))}
            </select>
          </div>
        )}

        <button
          onClick={handleExport}
          className="ml-auto flex items-center gap-2 px-3 py-1.5 bg-green-600 text-white rounded text-sm font-medium hover:bg-green-700"
        >
          <Download className="h-4 w-4" />
          Export CSV
        </button>
      </div>

      {/* Data Table */}
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
          <thead className="bg-gray-50 dark:bg-gray-800">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                DR Number
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                Team
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                Zone
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                Original Serial (OES)
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                Current Serial (Offline)
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                Status
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                Days Offline
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="bg-white dark:bg-gray-900 divide-y divide-gray-200 dark:divide-gray-700">
            {isLoading ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-gray-500">
                  Loading...
                </td>
              </tr>
            ) : data?.records.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-gray-500">
                  No serial mismatches found for the selected filters
                </td>
              </tr>
            ) : (
              data?.records.map((record) => (
                <tr key={record.id} className="hover:bg-gray-50 dark:hover:bg-gray-800">
                  <td className="px-4 py-3">
                    <a
                      href={`/activate/${record.drop_number}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:underline flex items-center gap-1"
                    >
                      {record.drop_number}
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400">
                      <Users className="h-3 w-3" />
                      {record.installation_team || 'Unknown'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-900 dark:text-gray-100">
                    {record.zone || '-'}
                  </td>
                  <td className="px-4 py-3 text-sm font-mono text-green-600 dark:text-green-400" title="Expected serial from OES activation">
                    {record.expected_serial || '-'}
                  </td>
                  <td className="px-4 py-3 text-sm font-mono text-red-600 dark:text-red-400" title="Current serial from offline report">
                    {record.current_serial || '-'}
                  </td>
                  <td className="px-4 py-3">
                    {getStatusBadge(record.status)}
                    {record.ticket_id && (
                      <span className="ml-1 text-xs text-gray-500">
                        ({record.ticket_status})
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <span
                      className={`font-medium ${
                        record.days_offline > 60
                          ? 'text-red-600 dark:text-red-400'
                          : record.days_offline > 30
                            ? 'text-yellow-600 dark:text-yellow-400'
                            : 'text-gray-600 dark:text-gray-400'
                      }`}
                    >
                      {record.days_offline} days
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {record.status === 'pending_investigation' && (
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleCreateTicket(record.id)}
                          disabled={actionLoading === record.id}
                          className="px-2 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
                          title="Create investigation ticket"
                        >
                          {actionLoading === record.id ? '...' : '🎫 Investigate'}
                        </button>
                        <button
                          onClick={() =>
                            setResolutionModal({
                              record,
                              resolution: 'ont_replaced',
                              notes: '',
                            })
                          }
                          className="px-2 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700"
                        >
                          Resolve
                        </button>
                      </div>
                    )}
                    {record.status === 'ticket_created' && (
                      <button
                        onClick={() =>
                          setResolutionModal({
                            record,
                            resolution: 'ont_replaced',
                            notes: '',
                          })
                        }
                        className="px-2 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700"
                      >
                        Resolve
                      </button>
                    )}
                    {record.status === 'resolved' && record.resolved_at && (
                      <span className="text-xs text-gray-500">
                        {new Date(record.resolved_at).toLocaleDateString()}
                      </span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {data && data.total_count > pageSize && (
        <div className="flex items-center justify-between border-t border-gray-200 dark:border-gray-700 pt-4">
          <p className="text-sm text-gray-700 dark:text-gray-300">
            Showing {(page - 1) * pageSize + 1} to{' '}
            {Math.min(page * pageSize, data.total_count)} of {data.total_count} results
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded text-sm disabled:opacity-50 hover:bg-gray-100 dark:hover:bg-gray-700"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={page * pageSize >= data.total_count}
              className="px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded text-sm disabled:opacity-50 hover:bg-gray-100 dark:hover:bg-gray-700"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* Resolution Modal */}
      {resolutionModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-md w-full mx-4 shadow-xl">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
              Resolve Mismatch: {resolutionModal.record.drop_number}
            </h3>

            <div className="mb-4 p-3 bg-gray-50 dark:bg-gray-700 rounded text-sm">
              <div><strong>Team:</strong> {resolutionModal.record.installation_team || 'Unknown'}</div>
              <div><strong>Original:</strong> <span className="font-mono text-green-600">{resolutionModal.record.expected_serial}</span></div>
              <div><strong>Current:</strong> <span className="font-mono text-red-600">{resolutionModal.record.current_serial}</span></div>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Resolution Type
                </label>
                <select
                  value={resolutionModal.resolution}
                  onChange={(e) =>
                    setResolutionModal({
                      ...resolutionModal,
                      resolution: e.target.value as MismatchResolution,
                    })
                  }
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                >
                  <option value="ont_replaced">ONT Replaced (legitimate - documented)</option>
                  <option value="data_corrected">Data Entry Corrected</option>
                  <option value="theft_confirmed">⚠️ Theft/Loss Confirmed</option>
                  <option value="false_alarm">False Alarm (data sync issue)</option>
                  <option value="other">Other</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Investigation Notes
                </label>
                <textarea
                  value={resolutionModal.notes}
                  onChange={(e) =>
                    setResolutionModal({
                      ...resolutionModal,
                      notes: e.target.value,
                    })
                  }
                  rows={3}
                  placeholder="Where is the original ONT? What happened?"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setResolutionModal(null)}
                className="px-4 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                Cancel
              </button>
              <button
                onClick={() =>
                  handleStatusUpdate(
                    resolutionModal.record.id,
                    'resolved',
                    resolutionModal.resolution,
                    resolutionModal.notes
                  )
                }
                disabled={actionLoading === resolutionModal.record.id}
                className="px-4 py-2 text-sm bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
              >
                {actionLoading === resolutionModal.record.id ? 'Saving...' : 'Resolve'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default SerialMismatchReports;
