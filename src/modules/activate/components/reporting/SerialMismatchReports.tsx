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
import { Button } from '@/components/ui/button';
import type {
  ReportFilters,
  SerialMismatchRecord,
  MismatchStatus,
  MismatchResolution,
} from '../../types/reporting.types';
import { ReportCard, ReportCardGrid } from './shared';

interface SerialMismatchReportsProps {
  filters: ReportFilters;
  refreshKey: number;
}

interface SerialComparison {
  oes: string | null;
  offline: string | null;
  onemap: string | null;
  wa_photo: string | null;
  wa_photo_confidence: number | null;
  wa_photo_processed: boolean;
  sources_agree: boolean;
  unique_count: number;
}

interface MismatchRecordExtended extends SerialMismatchRecord {
  installation_team: string | null;
  serial_comparison?: SerialComparison;
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
  records: MismatchRecordExtended[];
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
      // Include current filters in export
      if (selectedStatus) params.set('status', selectedStatus);
      if (selectedTeam) params.set('team', selectedTeam);
      if (selectedZone) params.set('zone', selectedZone);

      const res = await fetch(`/api/activate/reporting/serial-mismatches?${params}`);
      if (!res.ok) throw new Error('Failed to export');

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      // Build descriptive filename with active filters
      const statusLabel = selectedStatus ? selectedStatus.replace(/_/g, '-') : 'all';
      const teamLabel = selectedTeam ? `-${selectedTeam.replace(/\s+/g, '-')}` : '';
      const zoneLabel = selectedZone ? `-zone${selectedZone}` : '';
      a.download = `ont-serial-mismatches-${statusLabel}${teamLabel}${zoneLabel}-${new Date().toISOString().split('T')[0]}.csv`;
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
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-secondary text-gray-800 dark:bg-gray-700 dark:text-gray-300">
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
        <Button variant="link" className="mt-2" onClick={fetchData}>
          Retry
        </Button>
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
      <ReportCardGrid columns={4}>
        <ReportCard
          title="Total Mismatches"
          value={isLoading ? '...' : data?.summary.total ?? 0}
          color="gray"
          icon={<AlertTriangle className="h-4 w-4" />}
          isLoading={isLoading}
        />
        <ReportCard
          title="Pending Investigation"
          value={isLoading ? '...' : data?.summary.pending_investigation ?? 0}
          color="red"
          subtitle="Needs attention"
          onClick={() => setSelectedStatus('pending_investigation')}
          isLoading={isLoading}
        />
        <ReportCard
          title="Tickets Created"
          value={isLoading ? '...' : data?.summary.ticket_created ?? 0}
          color="blue"
          subtitle="Being tracked"
          onClick={() => setSelectedStatus('ticket_created')}
          isLoading={isLoading}
        />
        <ReportCard
          title="Resolved"
          value={isLoading ? '...' : data?.summary.resolved ?? 0}
          color="green"
          subtitle="Investigated"
          onClick={() => setSelectedStatus('resolved')}
          isLoading={isLoading}
        />
      </ReportCardGrid>

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
          <label className="text-sm font-medium text-muted-foreground">
            Status:
          </label>
          <select
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value)}
            className="px-3 py-1.5 border border-border rounded text-sm bg-card text-foreground"
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
            <label className="text-sm font-medium text-muted-foreground">
              Team:
            </label>
            <select
              value={selectedTeam}
              onChange={(e) => setSelectedTeam(e.target.value)}
              className="px-3 py-1.5 border border-border rounded text-sm bg-card text-foreground"
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
            <label className="text-sm font-medium text-muted-foreground">
              Zone:
            </label>
            <select
              value={selectedZone}
              onChange={(e) => setSelectedZone(e.target.value)}
              className="px-3 py-1.5 border border-border rounded text-sm bg-card text-foreground"
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

        <Button
          variant="primary"
          size="sm"
          className="ml-auto"
          onClick={handleExport}
          title={`Export ${selectedStatus ? selectedStatus.replace(/_/g, ' ') : 'all'} records${selectedTeam ? ` for ${selectedTeam}` : ''}${selectedZone ? ` in zone ${selectedZone}` : ''}`}
        >
          <Download className="h-4 w-4" />
          Export {selectedStatus ? selectedStatus.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : 'All'} CSV
        </Button>
      </div>

      {/* Data Table */}
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
          <thead className="bg-input">
            <tr>
              <th className="px-3 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
                DR Number
              </th>
              <th className="px-3 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
                Team
              </th>
              <th className="px-3 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
                Zone
              </th>
              <th className="px-3 py-3 text-left text-xs font-medium text-muted-foreground uppercase" title="Serial from OES activation">
                OES
              </th>
              <th className="px-3 py-3 text-left text-xs font-medium text-muted-foreground uppercase" title="Serial from offline report">
                Offline
              </th>
              <th className="px-3 py-3 text-left text-xs font-medium text-muted-foreground uppercase" title="Serial from 1Map database">
                1Map
              </th>
              <th className="px-3 py-3 text-left text-xs font-medium text-muted-foreground uppercase" title="Serial from WhatsApp photo VLM">
                WA Photo
              </th>
              <th className="px-3 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
                Status
              </th>
              <th className="px-3 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="bg-background divide-y divide-gray-200 dark:divide-gray-700">
            {isLoading ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">
                  Loading...
                </td>
              </tr>
            ) : data?.records.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">
                  No serial mismatches found for the selected filters
                </td>
              </tr>
            ) : (
              data?.records.map((record) => {
                const sc = record.serial_comparison;
                // Determine which serials match (for highlighting)
                const oesSerial = sc?.oes?.toUpperCase();
                const offlineSerial = sc?.offline?.toUpperCase();
                const onemapSerial = sc?.onemap?.toUpperCase();
                const waPhotoSerial = sc?.wa_photo?.toUpperCase();

                // Helper to get cell color based on agreement with OES (reference)
                const getSerialColor = (serial: string | null | undefined, isReference = false) => {
                  if (!serial) return 'text-gray-400 dark:text-muted-foreground';
                  if (isReference) return 'text-green-600 dark:text-green-400';
                  if (oesSerial && serial.toUpperCase() === oesSerial) return 'text-green-600 dark:text-green-400';
                  return 'text-red-600 dark:text-red-400';
                };

                return (
                  <tr key={record.id} className="hover:bg-accent">
                    <td className="px-3 py-3">
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
                    <td className="px-3 py-3">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400">
                        <Users className="h-3 w-3" />
                        {record.installation_team || 'Unknown'}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-sm text-foreground">
                      {record.zone || '-'}
                    </td>
                    {/* 4-Way Serial Comparison */}
                    <td className="px-3 py-2 text-xs font-mono" title="OES activation (reference)">
                      <span className={getSerialColor(sc?.oes, true)}>
                        {sc?.oes ? sc.oes.substring(sc.oes.length - 6) : '-'}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs font-mono" title="Offline report">
                      <span className={getSerialColor(sc?.offline)}>
                        {sc?.offline ? sc.offline.substring(sc.offline.length - 6) : '-'}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs font-mono" title="1Map database">
                      <span className={getSerialColor(sc?.onemap)}>
                        {sc?.onemap ? sc.onemap.substring(sc.onemap.length - 6) : '-'}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs font-mono" title={sc?.wa_photo_processed ? `VLM confidence: ${((sc?.wa_photo_confidence || 0) * 100).toFixed(0)}%` : 'Not processed'}>
                      {sc?.wa_photo_processed ? (
                        <span className={getSerialColor(sc?.wa_photo)}>
                          {sc?.wa_photo ? sc.wa_photo.substring(sc.wa_photo.length - 6) : '-'}
                          {sc?.wa_photo_confidence && sc.wa_photo_confidence >= 0.8 && (
                            <CheckCircle className="inline h-3 w-3 ml-1 text-green-500" />
                          )}
                        </span>
                      ) : (
                        <span className="text-gray-400 italic">pending</span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      {getStatusBadge(record.status)}
                      {record.ticket_id && (
                        <span className="ml-1 text-xs text-muted-foreground">
                          ({record.ticket_status})
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      {record.status === 'pending_investigation' && (
                        <div className="flex gap-1">
                          <Button
                            variant="danger"
                            size="sm"
                            onClick={() => handleCreateTicket(record.id)}
                            disabled={actionLoading === record.id}
                            loading={actionLoading === record.id}
                            title="Create investigation ticket"
                          >
                            {actionLoading === record.id ? '' : '🎫'}
                          </Button>
                          <Button
                            variant="primary"
                            size="sm"
                            onClick={() =>
                              setResolutionModal({
                                record,
                                resolution: 'ont_replaced',
                                notes: '',
                              })
                            }
                          >
                            ✓
                          </Button>
                        </div>
                      )}
                      {record.status === 'ticket_created' && (
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={() =>
                            setResolutionModal({
                              record,
                              resolution: 'ont_replaced',
                              notes: '',
                            })
                          }
                        >
                          ✓
                        </Button>
                      )}
                      {record.status === 'resolved' && record.resolved_at && (
                        <span className="text-xs text-muted-foreground">
                          {new Date(record.resolved_at).toISOString().split('T')[0]}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {data && data.total_count > pageSize && (
        <div className="flex items-center justify-between border-t border-border pt-4">
          <p className="text-sm text-muted-foreground">
            Showing {(page - 1) * pageSize + 1} to{' '}
            {Math.min(page * pageSize, data.total_count)} of {data.total_count} results
          </p>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="icon"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              aria-label="Previous page"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="secondary"
              size="icon"
              onClick={() => setPage((p) => p + 1)}
              disabled={page * pageSize >= data.total_count}
              aria-label="Next page"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Resolution Modal */}
      {resolutionModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-card rounded-lg p-6 max-w-md w-full mx-4 shadow-xl">
            <h3 className="text-lg font-semibold text-foreground mb-4">
              Resolve Mismatch: {resolutionModal.record.drop_number}
            </h3>

            <div className="mb-4 p-3 bg-secondary rounded text-sm space-y-2">
              <div><strong>Team:</strong> {resolutionModal.record.installation_team || 'Unknown'}</div>
              <div className="pt-2 border-t border-gray-200 dark:border-gray-600">
                <strong className="block mb-1">4-Way Serial Comparison:</strong>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-muted-foreground">OES:</span>{' '}
                    <span className="font-mono text-green-600">{resolutionModal.record.serial_comparison?.oes || '-'}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Offline:</span>{' '}
                    <span className={`font-mono ${resolutionModal.record.serial_comparison?.offline?.toUpperCase() === resolutionModal.record.serial_comparison?.oes?.toUpperCase() ? 'text-green-600' : 'text-red-600'}`}>
                      {resolutionModal.record.serial_comparison?.offline || '-'}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">1Map:</span>{' '}
                    <span className={`font-mono ${resolutionModal.record.serial_comparison?.onemap?.toUpperCase() === resolutionModal.record.serial_comparison?.oes?.toUpperCase() ? 'text-green-600' : 'text-red-600'}`}>
                      {resolutionModal.record.serial_comparison?.onemap || '-'}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">WA Photo:</span>{' '}
                    <span className={`font-mono ${resolutionModal.record.serial_comparison?.wa_photo?.toUpperCase() === resolutionModal.record.serial_comparison?.oes?.toUpperCase() ? 'text-green-600' : 'text-red-600'}`}>
                      {resolutionModal.record.serial_comparison?.wa_photo || (resolutionModal.record.serial_comparison?.wa_photo_processed ? '-' : 'pending')}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-1">
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
                  className="w-full px-3 py-2 border border-border rounded bg-card text-foreground"
                >
                  <option value="ont_replaced">ONT Replaced (legitimate - documented)</option>
                  <option value="data_corrected">Data Entry Corrected</option>
                  <option value="theft_confirmed">⚠️ Theft/Loss Confirmed</option>
                  <option value="false_alarm">False Alarm (data sync issue)</option>
                  <option value="other">Other</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-1">
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
                  className="w-full px-3 py-2 border border-border rounded bg-card text-foreground"
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <Button
                variant="secondary"
                onClick={() => setResolutionModal(null)}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={() =>
                  handleStatusUpdate(
                    resolutionModal.record.id,
                    'resolved',
                    resolutionModal.resolution,
                    resolutionModal.notes
                  )
                }
                disabled={actionLoading === resolutionModal.record.id}
                loading={actionLoading === resolutionModal.record.id}
              >
                {actionLoading === resolutionModal.record.id ? 'Saving...' : 'Resolve'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default SerialMismatchReports;
