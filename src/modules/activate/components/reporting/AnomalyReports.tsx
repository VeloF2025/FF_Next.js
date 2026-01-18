/**
 * AnomalyReports - Anomaly detection report section
 *
 * Reports:
 * - Discrepancy Summary (WA vs OES)
 * - Serial Mismatch Tracker
 * - Resubmission Analysis
 *
 * Status: WORKING
 * NLNH Confidence: HIGH
 */

'use client';

import { useState, useEffect } from 'react';
import { AlertTriangle, Hash, RotateCcw, ExternalLink } from 'lucide-react';
import type {
  ReportFilters,
  DiscrepancyReportResponse,
  SerialValidationReportResponse,
  ResubmissionAnalysisResponse,
} from '../../types/reporting.types';
import { ReportCard, ReportCardGrid } from './shared';

interface AnomalyReportsProps {
  filters: ReportFilters;
  refreshKey: number;
}

type AnomalySubReport = 'discrepancy' | 'serial' | 'resubmission';

export function AnomalyReports({ filters, refreshKey }: AnomalyReportsProps) {
  const [activeSubReport, setActiveSubReport] = useState<AnomalySubReport>('discrepancy');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Data states
  const [discrepancyData, setDiscrepancyData] = useState<DiscrepancyReportResponse | null>(null);
  const [serialData, setSerialData] = useState<SerialValidationReportResponse | null>(null);
  const [resubmissionData, setResubmissionData] = useState<ResubmissionAnalysisResponse | null>(
    null
  );

  // Fetch data based on active sub-report
  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams();
        params.set('dateFrom', filters.dateFrom);
        params.set('dateTo', filters.dateTo);
        if (filters.project) params.set('project', filters.project);

        switch (activeSubReport) {
          case 'discrepancy': {
            const res = await fetch(
              `/api/activate/reporting/discrepancy?waDate=${filters.dateFrom}${filters.project ? `&project=${filters.project}` : ''}`
            );
            if (!res.ok) throw new Error('Failed to fetch discrepancy report');
            setDiscrepancyData(await res.json());
            break;
          }
          case 'serial': {
            const res = await fetch(`/api/activate/reporting/serial-validation?${params}`);
            if (!res.ok) throw new Error('Failed to fetch serial validation report');
            setSerialData(await res.json());
            break;
          }
          case 'resubmission': {
            const res = await fetch(`/api/activate/reporting/resubmissions?${params}`);
            if (!res.ok) throw new Error('Failed to fetch resubmission report');
            setResubmissionData(await res.json());
            break;
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch data');
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [activeSubReport, filters, refreshKey]);

  const subReports: { id: AnomalySubReport; label: string; icon: typeof AlertTriangle }[] = [
    { id: 'discrepancy', label: 'Discrepancy', icon: AlertTriangle },
    { id: 'serial', label: 'Serial Mismatch', icon: Hash },
    { id: 'resubmission', label: 'Resubmissions', icon: RotateCcw },
  ];

  return (
    <div className="p-6 space-y-6">
      {/* Sub-report tabs */}
      <div className="flex flex-wrap gap-2 border-b border-gray-200 dark:border-gray-700 pb-4">
        {subReports.map((sub) => {
          const Icon = sub.icon;
          return (
            <button
              key={sub.id}
              onClick={() => setActiveSubReport(sub.id)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-t text-sm font-medium transition-colors ${
                activeSubReport === sub.id
                  ? 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300 border-b-2 border-orange-500'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
              }`}
            >
              <Icon className="h-4 w-4" />
              {sub.label}
            </button>
          );
        })}
      </div>

      {/* Error display */}
      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <p className="text-red-600 dark:text-red-400">{error}</p>
        </div>
      )}

      {/* Content */}
      {activeSubReport === 'discrepancy' && (
        <DiscrepancySection data={discrepancyData} isLoading={isLoading} />
      )}
      {activeSubReport === 'serial' && (
        <SerialSection data={serialData} isLoading={isLoading} />
      )}
      {activeSubReport === 'resubmission' && (
        <ResubmissionSection data={resubmissionData} isLoading={isLoading} />
      )}
    </div>
  );
}

// ============================================================================
// DISCREPANCY SECTION
// ============================================================================

function DiscrepancySection({
  data,
  isLoading,
}: {
  data: DiscrepancyReportResponse | null;
  isLoading: boolean;
}) {
  const [showMatched, setShowMatched] = useState(false);

  if (isLoading) {
    return <LoadingSkeleton cards={5} />;
  }

  if (!data) {
    return <EmptyState message="No discrepancy data available" />;
  }

  const filteredRecords = showMatched
    ? data.records
    : data.records.filter((r) => r.discrepancy_type !== 'matched');

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <ReportCardGrid columns={5}>
        <ReportCard
          title="WA Submissions"
          value={data.summary.total_wa_submissions}
          color="blue"
          icon={<AlertTriangle className="h-4 w-4" />}
        />
        <ReportCard
          title="OES Activations"
          value={data.summary.total_oes_activations}
          color="purple"
        />
        <ReportCard
          title="Matched"
          value={data.summary.matched}
          color="green"
          subtitle={`${Math.round((data.summary.matched / Math.max(data.summary.total_wa_submissions, 1)) * 100)}% match rate`}
        />
        <ReportCard
          title="WA Only"
          value={data.summary.wa_only}
          color="yellow"
          subtitle="Not yet activated"
          onClick={() => setShowMatched(false)}
        />
        <ReportCard
          title="OES Only"
          value={data.summary.oes_only}
          color="orange"
          subtitle="Manual install?"
          onClick={() => setShowMatched(false)}
        />
      </ReportCardGrid>

      {/* Toggle and Table */}
      <div className="space-y-4">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={showMatched}
            onChange={(e) => setShowMatched(e.target.checked)}
            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          <span className="text-sm text-gray-700 dark:text-gray-300">
            Show matched records ({data.summary.matched})
          </span>
        </label>

        <DiscrepancyTable records={filteredRecords} />
      </div>
    </div>
  );
}

function DiscrepancyTable({
  records,
}: {
  records: DiscrepancyReportResponse['records'];
}) {
  if (records.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500 dark:text-gray-400">
        No anomalies found for the selected date
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
        <thead className="bg-gray-50 dark:bg-gray-900/50">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
              DR Number
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
              Project
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
              Status
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
              WA Submitted By
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
              OES Team
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
              Action
            </th>
          </tr>
        </thead>
        <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
          {records.slice(0, 50).map((record) => (
            <tr
              key={record.drop_number}
              className={`${
                record.discrepancy_type === 'matched'
                  ? 'bg-green-50 dark:bg-green-900/10'
                  : record.discrepancy_type === 'wa_only'
                    ? 'bg-yellow-50 dark:bg-yellow-900/10'
                    : 'bg-orange-50 dark:bg-orange-900/10'
              }`}
            >
              <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-white">
                {record.drop_number}
              </td>
              <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                {record.project || '-'}
              </td>
              <td className="px-4 py-3 text-sm">
                <StatusBadge type={record.discrepancy_type} />
              </td>
              <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                {record.wa_submitted_by || record.wa_sender_phone || '-'}
              </td>
              <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                {record.oes_team || '-'}
              </td>
              <td className="px-4 py-3 text-sm">
                <a
                  href={`/activate/${record.drop_number}`}
                  className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
                >
                  <ExternalLink className="h-4 w-4" />
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {records.length > 50 && (
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-2 text-center">
          Showing first 50 of {records.length} records
        </p>
      )}
    </div>
  );
}

// ============================================================================
// SERIAL SECTION
// ============================================================================

function SerialSection({
  data,
  isLoading,
}: {
  data: SerialValidationReportResponse | null;
  isLoading: boolean;
}) {
  const [showMismatchesOnly, setShowMismatchesOnly] = useState(true);

  if (isLoading) {
    return <LoadingSkeleton cards={6} />;
  }

  if (!data) {
    return <EmptyState message="No serial validation data available" />;
  }

  const displayRecords = showMismatchesOnly ? data.mismatches_only : data.records;

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <ReportCardGrid columns={6}>
        <ReportCard title="Total Checked" value={data.summary.total_checked} color="gray" />
        <ReportCard title="ONT Matches" value={data.summary.ont_matches} color="green" />
        <ReportCard
          title="ONT Mismatches"
          value={data.summary.ont_mismatches}
          color="red"
          subtitle="CRITICAL - Wrong ONT"
        />
        <ReportCard title="ONT Missing" value={data.summary.ont_missing} color="yellow" />
        <ReportCard title="UPS Present" value={data.summary.ups_present} color="green" />
        <ReportCard title="UPS Missing" value={data.summary.ups_missing} color="yellow" />
      </ReportCardGrid>

      {/* Toggle and Table */}
      <div className="space-y-4">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={showMismatchesOnly}
            onChange={(e) => setShowMismatchesOnly(e.target.checked)}
            className="rounded border-gray-300 text-red-600 focus:ring-red-500"
          />
          <span className="text-sm text-gray-700 dark:text-gray-300">
            Show mismatches only ({data.mismatches_only.length})
          </span>
        </label>

        <SerialTable records={displayRecords} />
      </div>
    </div>
  );
}

function SerialTable({
  records,
}: {
  records: SerialValidationReportResponse['records'];
}) {
  if (records.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500 dark:text-gray-400">
        No serial validation issues found
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
        <thead className="bg-gray-50 dark:bg-gray-900/50">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
              DR Number
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
              ONT (WA/Scanned)
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
              ONT (OES)
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
              Status
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
              UPS Scanned
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
          {records.slice(0, 50).map((r) => (
            <tr
              key={r.drop_number}
              className={
                r.ont_match_status === 'mismatch' ? 'bg-red-50 dark:bg-red-900/10' : ''
              }
            >
              <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-white">
                {r.drop_number}
              </td>
              <td className="px-4 py-3 text-sm font-mono text-gray-600 dark:text-gray-400">
                {r.ont_serial_wa || '-'}
              </td>
              <td className="px-4 py-3 text-sm font-mono text-gray-600 dark:text-gray-400">
                {r.ont_serial_oes || '-'}
              </td>
              <td className="px-4 py-3 text-sm">
                <span
                  className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${
                    r.ont_match_status === 'match'
                      ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-200'
                      : r.ont_match_status === 'mismatch'
                        ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-200'
                        : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-200'
                  }`}
                >
                  {r.ont_match_status}
                </span>
              </td>
              <td className="px-4 py-3 text-sm">
                {r.ups_serial_exists ? (
                  <span className="text-green-600 dark:text-green-400">Yes</span>
                ) : (
                  <span className="text-yellow-600 dark:text-yellow-400">No</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {records.length > 50 && (
        <p className="text-sm text-gray-500 mt-2 text-center">
          Showing first 50 of {records.length}
        </p>
      )}
    </div>
  );
}

// ============================================================================
// RESUBMISSION SECTION
// ============================================================================

function ResubmissionSection({
  data,
  isLoading,
}: {
  data: ResubmissionAnalysisResponse | null;
  isLoading: boolean;
}) {
  if (isLoading) {
    return <LoadingSkeleton cards={4} />;
  }

  if (!data) {
    return <EmptyState message="No resubmission data available" />;
  }

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <ReportCardGrid columns={4}>
        <ReportCard title="Total DRs" value={data.summary.total_drs} color="gray" />
        <ReportCard
          title="Resubmitted DRs"
          value={data.summary.resubmitted_drs}
          color="orange"
        />
        <ReportCard
          title="Resubmission Rate"
          value={`${data.summary.resubmission_rate.toFixed(1)}%`}
          color={data.summary.resubmission_rate > 20 ? 'red' : 'yellow'}
        />
        <ReportCard
          title="Avg Submissions"
          value={data.summary.avg_submissions.toFixed(1)}
          color="blue"
        />
      </ReportCardGrid>

      {/* By Project */}
      {data.by_project.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">
            By Project
          </h4>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700 text-sm">
              <thead className="bg-gray-50 dark:bg-gray-900/50">
                <tr>
                  <th className="px-4 py-2 text-left font-medium text-gray-500 uppercase text-xs">
                    Project
                  </th>
                  <th className="px-4 py-2 text-left font-medium text-gray-500 uppercase text-xs">
                    Total
                  </th>
                  <th className="px-4 py-2 text-left font-medium text-gray-500 uppercase text-xs">
                    Resubmitted
                  </th>
                  <th className="px-4 py-2 text-left font-medium text-gray-500 uppercase text-xs">
                    Rate
                  </th>
                  <th className="px-4 py-2 text-left font-medium text-gray-500 uppercase text-xs">
                    Avg Submissions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {data.by_project.map((p) => (
                  <tr key={p.group_name}>
                    <td className="px-4 py-2 font-medium text-gray-900 dark:text-white">
                      {p.group_name}
                    </td>
                    <td className="px-4 py-2 text-gray-600 dark:text-gray-400">{p.total_drs}</td>
                    <td className="px-4 py-2 text-orange-600 dark:text-orange-400">
                      {p.resubmitted_drs}
                    </td>
                    <td className="px-4 py-2">
                      <span
                        className={
                          p.resubmission_rate > 20
                            ? 'text-red-600 dark:text-red-400'
                            : 'text-yellow-600 dark:text-yellow-400'
                        }
                      >
                        {p.resubmission_rate.toFixed(1)}%
                      </span>
                    </td>
                    <td className="px-4 py-2 text-gray-600 dark:text-gray-400">
                      {p.avg_submissions.toFixed(1)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Top Resubmitted */}
      {data.top_resubmitted.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">
            Top Resubmitted DRs (Quality Issues?)
          </h4>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700 text-sm">
              <thead className="bg-gray-50 dark:bg-gray-900/50">
                <tr>
                  <th className="px-4 py-2 text-left font-medium text-gray-500 uppercase text-xs">
                    DR Number
                  </th>
                  <th className="px-4 py-2 text-left font-medium text-gray-500 uppercase text-xs">
                    Project
                  </th>
                  <th className="px-4 py-2 text-left font-medium text-gray-500 uppercase text-xs">
                    Submissions
                  </th>
                  <th className="px-4 py-2 text-left font-medium text-gray-500 uppercase text-xs">
                    Submitted By
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {data.top_resubmitted.slice(0, 10).map((dr) => (
                  <tr key={dr.drop_number}>
                    <td className="px-4 py-2">
                      <a
                        href={`/activate/${dr.drop_number}`}
                        className="font-medium text-blue-600 hover:text-blue-800 dark:text-blue-400"
                      >
                        {dr.drop_number}
                      </a>
                    </td>
                    <td className="px-4 py-2 text-gray-600 dark:text-gray-400">
                      {dr.project || '-'}
                    </td>
                    <td className="px-4 py-2 font-medium text-orange-600 dark:text-orange-400">
                      {dr.submission_count}x
                    </td>
                    <td className="px-4 py-2 text-gray-600 dark:text-gray-400">
                      {dr.submitted_by || '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// SHARED COMPONENTS
// ============================================================================

function StatusBadge({ type }: { type: 'matched' | 'wa_only' | 'oes_only' }) {
  const styles = {
    matched: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-200',
    wa_only: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-200',
    oes_only: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-200',
  };

  const labels = {
    matched: 'Matched',
    wa_only: 'WA Only',
    oes_only: 'OES Only',
  };

  return (
    <span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${styles[type]}`}>
      {labels[type]}
    </span>
  );
}

function LoadingSkeleton({ cards }: { cards: number }) {
  return (
    <div className="space-y-6">
      <div className={`grid grid-cols-${Math.min(cards, 6)} gap-4`}>
        {Array.from({ length: cards }).map((_, i) => (
          <div key={i} className="h-24 animate-pulse bg-gray-200 dark:bg-gray-700 rounded-lg" />
        ))}
      </div>
      <div className="h-64 animate-pulse bg-gray-200 dark:bg-gray-700 rounded" />
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="text-center py-12 text-gray-500 dark:text-gray-400">
      <AlertTriangle className="h-12 w-12 mx-auto mb-4 opacity-50" />
      <p>{message}</p>
    </div>
  );
}

export default AnomalyReports;
