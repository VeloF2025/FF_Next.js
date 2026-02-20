/**
 * OltReportingTab — reporting with period selector, 3 sub-views, and CSV export
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
import { Download, Loader2 } from 'lucide-react';
import type { ReportPeriod, ReportData, DisplacedReport, OltRecord } from '../../../types';

interface OltReportingTabProps {
  setError: (e: string | null) => void;
}

export function OltReportingTab({ setError }: OltReportingTabProps) {
  // All reporting state is local
  const [reportPeriod, setReportPeriod] = useState<ReportPeriod>('all');
  const [reportStatusFilter, setReportStatusFilter] = useState<string>('all');
  const [reportData, setReportData] = useState<ReportData | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [reportView, setReportView] = useState<'records' | 'imports' | 'displaced'>('records');
  const [displacedReport, setDisplacedReport] = useState<DisplacedReport | null>(null);
  const [displacedReportLoading, setDisplacedReportLoading] = useState(false);

  const fetchReportData = useCallback(async () => {
    setReportLoading(true);
    try {
      const res = await fetch(`/api/system/olt-report/reporting?period=${reportPeriod}`);
      if (res.ok) {
        const data = await res.json();
        setReportData(data.data || data);
      }
    } catch {
      // Silently fail
    } finally {
      setReportLoading(false);
    }
  }, [reportPeriod]);

  const fetchDisplacedReport = useCallback(async (filter = 'all') => {
    setDisplacedReportLoading(true);
    try {
      const res = await fetch(`/api/system/olt-report/displaced-report?filter=${filter}`);
      if (res.ok) {
        const data = await res.json();
        setDisplacedReport(data.data || data);
      }
    } catch {
      // Silently fail
    } finally {
      setDisplacedReportLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchReportData();
    fetchDisplacedReport();
  }, [fetchReportData, fetchDisplacedReport]);

  const handleExportCSV = async () => {
    setExporting(true);
    try {
      let exportUrl: string;
      let downloadName: string;
      const today = new Date().toISOString().split('T')[0];

      if (reportView === 'imports') {
        exportUrl = `/api/system/olt-report/reporting?period=${reportPeriod}&view=imports&format=csv`;
        downloadName = `olt-imports-${reportPeriod}-${today}.csv`;
      } else if (reportView === 'displaced') {
        exportUrl = `/api/system/olt-report/displaced-report?format=csv`;
        downloadName = `olt-displaced-onts-${today}.csv`;
      } else {
        const statusLabel = reportStatusFilter === 'all' ? 'all-records' : reportStatusFilter.replace(/_/g, '-');
        exportUrl = `/api/system/olt-report/reporting?period=${reportPeriod}&status=${reportStatusFilter}&format=csv`;
        downloadName = `olt-report-${statusLabel}-${reportPeriod}-${today}.csv`;
      }

      const res = await fetch(exportUrl);
      if (res.ok) {
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = downloadName;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      } else {
        setError('Export failed');
      }
    } catch {
      setError('Export failed');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Period Selector and Export */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-4">
          <span className="text-sm text-[var(--ff-text-secondary)]">Period:</span>
          <div className="flex gap-2">
            {(['today', 'yesterday', 'week', '30days', 'all'] as ReportPeriod[]).map((period) => (
              <button
                key={period}
                onClick={() => setReportPeriod(period)}
                className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                  reportPeriod === period
                    ? 'bg-[var(--ff-accent)] text-white'
                    : 'bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]'
                }`}
              >
                {period === 'all' ? 'All Time' : period === '30days' ? '30 Days' : period.charAt(0).toUpperCase() + period.slice(1)}
              </button>
            ))}
          </div>
        </div>
        <button
          onClick={handleExportCSV}
          disabled={exporting || !reportData}
          className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 disabled:opacity-50"
          title={`Export ${reportView === 'displaced' ? 'displaced ONTs' : reportView === 'imports' ? 'imports' : reportStatusFilter === 'all' ? 'all records' : reportStatusFilter.replace(/_/g, ' ')} to CSV`}
        >
          {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
          Export {reportView === 'displaced' ? 'Displaced' : reportView === 'imports' ? 'Imports' : reportStatusFilter === 'all' ? 'All' : reportStatusFilter.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())} CSV
        </button>
      </div>

      {reportLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-[var(--ff-accent)]" />
        </div>
      ) : reportData ? (
        <>
          {/* Summary Stats */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            {[
              { key: 'all', label: 'Total Records', value: reportData.summary.total, border: 'border-[var(--ff-accent)]' },
              { key: 'fixed', label: 'Fixed', value: reportData.summary.fixed, border: 'border-green-400' },
              { key: 'pending', label: 'Pending', value: reportData.summary.pending, border: 'border-amber-400' },
              { key: 'empty_serial', label: 'Empty Serial', value: reportData.summary.empty_serial, border: 'border-gray-400' },
              { key: 'not_found', label: 'Not Found', value: reportData.summary.not_found, border: 'border-red-400' },
            ].map(({ key, label, value, border }) => (
              <button
                key={key}
                onClick={() => { setReportStatusFilter(key); setReportView('records'); }}
                className={`bg-[var(--ff-bg-secondary)] rounded-lg p-4 border text-left transition-colors ${
                  reportStatusFilter === key && reportView === 'records' ? border : 'border-[var(--ff-border-light)] hover:border-[var(--ff-border-medium)]'
                }`}
              >
                <div className={`text-2xl font-bold ${
                  key === 'fixed' ? 'text-green-400' : key === 'pending' ? 'text-amber-400' :
                  key === 'empty_serial' ? 'text-[var(--ff-text-tertiary)]' : key === 'not_found' ? 'text-red-400' : 'text-[var(--ff-text-primary)]'
                }`}>{value}</div>
                <div className="text-sm text-[var(--ff-text-secondary)]">{label}</div>
              </button>
            ))}
          </div>

          {/* Report View Sub-tabs */}
          <div className="flex items-center gap-2 border-b border-[var(--ff-border-light)]">
            {([
              { key: 'records' as const, label: 'Records', count: reportData.records.filter((r: OltRecord) => reportStatusFilter === 'all' || r.fix_status === reportStatusFilter).length },
              { key: 'imports' as const, label: 'Imports', count: reportData.imports.length },
              { key: 'displaced' as const, label: 'Displaced ONTs', count: displacedReport?.total || 0 },
            ]).map(({ key, label, count }) => (
              <button
                key={key}
                onClick={() => setReportView(key)}
                className={`px-4 py-2.5 text-sm font-medium transition-colors relative ${
                  reportView === key ? 'text-[var(--ff-accent)]' : 'text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]'
                }`}
              >
                {label}
                {count > 0 && (
                  <span className={`ml-1.5 px-1.5 py-0.5 rounded-full text-[10px] ${
                    reportView === key ? 'bg-[var(--ff-accent)]/20 text-[var(--ff-accent)]' : 'bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-tertiary)]'
                  }`}>{count}</span>
                )}
                {reportView === key && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[var(--ff-accent)]" />}
              </button>
            ))}
          </div>

          {/* Records View */}
          {reportView === 'records' && (
            <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)]">
              <div className="overflow-y-auto max-h-[500px]">
                <table className="w-full text-sm table-fixed">
                  <thead className="sticky top-0 bg-[var(--ff-bg-tertiary)]">
                    <tr className="border-b border-[var(--ff-border-light)]">
                      <th className="text-left py-2 px-3 text-[var(--ff-text-secondary)] font-medium w-[12%]">DR Number</th>
                      <th className="text-left py-2 px-3 text-[var(--ff-text-secondary)] font-medium w-[16%]">OLT Serial</th>
                      <th className="text-left py-2 px-3 text-[var(--ff-text-secondary)] font-medium w-[16%]">1Map Serial</th>
                      <th className="text-left py-2 px-3 text-[var(--ff-text-secondary)] font-medium w-[10%]">Status</th>
                      <th className="text-left py-2 px-3 text-[var(--ff-text-secondary)] font-medium w-[30%]">Import File</th>
                      <th className="text-left py-2 px-3 text-[var(--ff-text-secondary)] font-medium w-[10%]">Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reportData.records
                      .filter((r: OltRecord) => reportStatusFilter === 'all' || r.fix_status === reportStatusFilter)
                      .slice(0, 100)
                      .map((record: OltRecord) => (
                        <tr key={record.id} className="border-b border-[var(--ff-border-light)] hover:bg-[var(--ff-bg-tertiary)]">
                          <td className="py-2 px-3 text-[var(--ff-text-primary)] font-mono text-xs">{record.drop_number}</td>
                          <td className="py-2 px-3 text-green-400 font-mono text-xs truncate">{record.olt_serial || '-'}</td>
                          <td className="py-2 px-3 text-red-400 font-mono text-xs truncate">{record.wrong_onemap_serial || '-'}</td>
                          <td className="py-2 px-3">
                            <span className={`px-1.5 py-0.5 rounded text-xs ${
                              record.fix_status === 'fixed' ? 'bg-green-500/20 text-green-400' :
                              record.fix_status === 'pending' ? 'bg-amber-500/20 text-amber-400' :
                              record.fix_status === 'not_found' ? 'bg-red-500/20 text-red-400' :
                              'bg-gray-500/20 text-gray-400'
                            }`}>{record.fix_status || 'unknown'}</span>
                          </td>
                          <td className="py-2 px-3 text-[var(--ff-text-secondary)] text-xs truncate">{record.import_filename || '-'}</td>
                          <td className="py-2 px-3 text-[var(--ff-text-secondary)] text-xs">
                            {record.created_at ? new Date(record.created_at).toLocaleDateString() : '-'}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
                {reportData.records.filter((r: OltRecord) => reportStatusFilter === 'all' || r.fix_status === reportStatusFilter).length > 100 && (
                  <div className="p-4 text-center text-sm text-[var(--ff-text-secondary)]">
                    Showing first 100 records. Export CSV for complete data.
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Imports View */}
          {reportView === 'imports' && (
            <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)]">
              {reportData.imports.length > 0 ? (
                <div className="overflow-y-auto max-h-[500px]">
                  <table className="w-full text-sm table-fixed">
                    <thead className="sticky top-0 bg-[var(--ff-bg-tertiary)]">
                      <tr className="border-b border-[var(--ff-border-light)]">
                        <th className="text-left py-2 px-3 text-[var(--ff-text-secondary)] font-medium w-[40%]">Filename</th>
                        <th className="text-left py-2 px-3 text-[var(--ff-text-secondary)] font-medium w-[10%]">Project</th>
                        <th className="text-right py-2 px-3 text-[var(--ff-text-secondary)] font-medium w-[10%]">Mismatches</th>
                        <th className="text-right py-2 px-3 text-[var(--ff-text-secondary)] font-medium w-[8%]">Fixed</th>
                        <th className="text-right py-2 px-3 text-[var(--ff-text-secondary)] font-medium w-[8%]">Pending</th>
                        <th className="text-left py-2 px-3 text-[var(--ff-text-secondary)] font-medium w-[18%]">Imported</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reportData.imports.map((imp) => (
                        <tr key={imp.id} className="border-b border-[var(--ff-border-light)] hover:bg-[var(--ff-bg-tertiary)]">
                          <td className="py-2 px-3 text-[var(--ff-text-primary)] text-xs truncate">{imp.filename}</td>
                          <td className="py-2 px-3 text-[var(--ff-text-secondary)] text-xs">{imp.project || '-'}</td>
                          <td className="py-2 px-3 text-right text-amber-400 text-xs">{imp.mismatch_count}</td>
                          <td className="py-2 px-3 text-right text-green-400 text-xs">{imp.fixed_count}</td>
                          <td className="py-2 px-3 text-right text-[var(--ff-text-secondary)] text-xs">{imp.pending_count}</td>
                          <td className="py-2 px-3 text-[var(--ff-text-secondary)] text-xs">{new Date(imp.imported_at).toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-center py-8 text-[var(--ff-text-tertiary)]">No imports found</div>
              )}
            </div>
          )}

          {/* Displaced ONTs View */}
          {reportView === 'displaced' && (
            <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)]">
              <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--ff-border-light)]">
                <p className="text-xs text-[var(--ff-text-tertiary)]">ONT serials overwritten during 1Map fixes — tracked for procurement stock reconciliation</p>
                {displacedReport && (
                  <div className="flex items-center gap-3 text-xs">
                    <span className="text-amber-400 font-medium">{displacedReport.unactivated} unactivated</span>
                    <span className="text-[var(--ff-text-tertiary)]">/</span>
                    <span className="text-blue-400 font-medium">{displacedReport.activated} activated</span>
                  </div>
                )}
              </div>
              {displacedReportLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-5 h-5 animate-spin text-[var(--ff-accent)]" />
                </div>
              ) : displacedReport && displacedReport.records.length > 0 ? (
                <div className="overflow-y-auto max-h-[500px]">
                  <table className="w-full text-sm table-fixed">
                    <thead className="sticky top-0 bg-[var(--ff-bg-tertiary)]">
                      <tr className="border-b border-[var(--ff-border-light)]">
                        <th className="text-left py-2 px-3 text-[var(--ff-text-secondary)] font-medium w-[11%]">DR</th>
                        <th className="text-left py-2 px-3 text-[var(--ff-text-secondary)] font-medium w-[16%]">Displaced Serial</th>
                        <th className="text-left py-2 px-3 text-[var(--ff-text-secondary)] font-medium w-[7%]">Type</th>
                        <th className="text-left py-2 px-3 text-[var(--ff-text-secondary)] font-medium w-[10%]">OES Status</th>
                        <th className="text-left py-2 px-3 text-[var(--ff-text-secondary)] font-medium w-[18%]">Owner</th>
                        <th className="text-left py-2 px-3 text-[var(--ff-text-secondary)] font-medium w-[16%]">Replaced With</th>
                        <th className="text-left py-2 px-3 text-[var(--ff-text-secondary)] font-medium w-[10%]">Fixed On</th>
                      </tr>
                    </thead>
                    <tbody>
                      {displacedReport.records.map((rec, idx) => {
                        const ds = (rec.displaced_serial || '').toUpperCase();
                        const isOnt = /^ALCL|^HWTC/.test(ds);
                        const isUps = ds.startsWith('GU18');
                        const typeLabel = isOnt ? 'ONT' : isUps ? 'UPS' : 'Invalid';
                        const typeColor = isOnt ? 'text-blue-400' : isUps ? 'text-orange-400' : 'text-gray-400';
                        return (
                          <tr key={`${rec.drop_number}-${idx}`} className="border-b border-[var(--ff-border-light)] hover:bg-[var(--ff-bg-tertiary)]">
                            <td className="py-2 px-3 text-[var(--ff-text-primary)] font-mono text-xs">{rec.drop_number}</td>
                            <td className="py-2 px-3 font-mono text-red-400 text-xs truncate">{rec.displaced_serial}</td>
                            <td className="py-2 px-3">
                              <span className={`px-1.5 py-0.5 rounded text-xs ${typeColor} ${isOnt ? 'bg-blue-500/10' : isUps ? 'bg-orange-500/10' : 'bg-gray-500/10'}`}>{typeLabel}</span>
                            </td>
                            <td className="py-2 px-3">
                              {rec.displaced_activated ? (
                                <span className="px-1.5 py-0.5 rounded text-xs bg-green-500/20 text-green-400">Activated</span>
                              ) : (
                                <span className="px-1.5 py-0.5 rounded text-xs bg-amber-500/20 text-amber-400">Unactivated</span>
                              )}
                            </td>
                            <td className="py-2 px-3 text-[var(--ff-text-secondary)] font-mono text-xs truncate">
                              {rec.displaced_owner_dr ? (
                                <span>{rec.displaced_owner_dr} <span className="text-[var(--ff-text-tertiary)]">({rec.displaced_owner_team || '-'})</span></span>
                              ) : <span className="text-[var(--ff-text-tertiary)]">-</span>}
                            </td>
                            <td className="py-2 px-3 font-mono text-green-400 text-xs truncate">{rec.new_value}</td>
                            <td className="py-2 px-3 text-[var(--ff-text-secondary)] text-xs">
                              {rec.created_at ? new Date(rec.created_at).toLocaleDateString() : '-'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-center py-8 text-[var(--ff-text-tertiary)]">No displaced ONT records found</div>
              )}
            </div>
          )}
        </>
      ) : (
        <div className="text-center py-12 text-[var(--ff-text-tertiary)]">No report data available</div>
      )}
    </div>
  );
}
