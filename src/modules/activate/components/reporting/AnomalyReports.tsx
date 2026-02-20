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
import { AlertTriangle, Hash, RotateCcw, ExternalLink, Clock } from 'lucide-react';
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

type AnomalySubReport = 'discrepancy' | 'pending' | 'serial' | 'resubmission';

interface PendingAgingResponse {
  summary: {
    total_pending: number;
    critical_30plus: number;
    warning_15_30: number;
    recent_0_7: number;
  };
  buckets: Array<{
    bucket: string;
    count: number;
    min_days: number;
    max_days: number;
  }>;
  records: Array<{
    drop_number: string;
    project: string;
    wa_submitted: string;
    days_pending: number;
    submitted_by: string | null;
    sender_phone: string | null;
    completed_photos: number;
  }>;
}

export function AnomalyReports({ filters, refreshKey }: AnomalyReportsProps) {
  const [activeSubReport, setActiveSubReport] = useState<AnomalySubReport>('discrepancy');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Data states
  const [discrepancyData, setDiscrepancyData] = useState<DiscrepancyReportResponse | null>(null);
  const [pendingData, setPendingData] = useState<PendingAgingResponse | null>(null);
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
            // Use same date for both WA and OES - compare same day submissions vs activations
            // (Previously defaulted oesDate to waDate+1, which caused missing data when today's OES wasn't imported)
            const res = await fetch(
              `/api/activate/reporting/discrepancy?waDate=${filters.dateFrom}&oesDate=${filters.dateFrom}${filters.project ? `&project=${filters.project}` : ''}`
            );
            if (!res.ok) throw new Error('Failed to fetch discrepancy report');
            setDiscrepancyData(await res.json());
            break;
          }
          case 'pending': {
            const pendingParams = new URLSearchParams();
            if (filters.project) pendingParams.set('project', filters.project);
            const res = await fetch(`/api/activate/reporting/pending-aging?${pendingParams}`);
            if (!res.ok) throw new Error('Failed to fetch pending aging report');
            setPendingData(await res.json());
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

  const subReports: { id: AnomalySubReport; label: string; icon: typeof AlertTriangle; badge?: number }[] = [
    { id: 'discrepancy', label: 'Discrepancy', icon: AlertTriangle },
    { id: 'pending', label: 'Pending Aging', icon: Clock, badge: pendingData?.summary.critical_30plus },
    { id: 'serial', label: 'Serial Mismatch', icon: Hash },
    { id: 'resubmission', label: 'Resubmissions', icon: RotateCcw },
  ];

  return (
    <div className="p-6 space-y-6">
      {/* Sub-report tabs */}
      <div className="flex flex-wrap gap-2 border-b border-border pb-4">
        {subReports.map((sub) => {
          const Icon = sub.icon;
          return (
            <button
              key={sub.id}
              onClick={() => setActiveSubReport(sub.id)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-t text-sm font-medium transition-colors ${
                activeSubReport === sub.id
                  ? 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300 border-b-2 border-orange-500'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Icon className="h-4 w-4" />
              {sub.label}
              {sub.badge && sub.badge > 0 && (
                <span className="ml-1 px-1.5 py-0.5 text-xs bg-red-500 text-white rounded-full">
                  {sub.badge}
                </span>
              )}
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
      {activeSubReport === 'pending' && (
        <PendingAgingSection data={pendingData} isLoading={isLoading} />
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

type DiscrepancyFilter = 'all_anomalies' | 'wa_only' | 'oes_only' | 'matched' | 'all';

function DiscrepancySection({
  data,
  isLoading,
}: {
  data: DiscrepancyReportResponse | null;
  isLoading: boolean;
}) {
  const [activeFilter, setActiveFilter] = useState<DiscrepancyFilter>('all_anomalies');

  if (isLoading) {
    return <LoadingSkeleton cards={5} />;
  }

  if (!data) {
    return <EmptyState message="No discrepancy data available" />;
  }

  // Filter records based on active filter
  const filteredRecords = data.records.filter((r) => {
    switch (activeFilter) {
      case 'wa_only':
        return r.discrepancy_type === 'wa_only';
      case 'oes_only':
        return r.discrepancy_type === 'oes_only';
      case 'matched':
        return r.discrepancy_type === 'matched';
      case 'all_anomalies':
        return r.discrepancy_type !== 'matched';
      case 'all':
      default:
        return true;
    }
  });

  const filterButtons: { id: DiscrepancyFilter; label: string; count: number; color: string }[] = [
    { id: 'all_anomalies', label: 'All Anomalies', count: data.summary.wa_only + data.summary.oes_only, color: 'gray' },
    { id: 'wa_only', label: 'WA Only', count: data.summary.wa_only, color: 'yellow' },
    { id: 'oes_only', label: 'OES Only', count: data.summary.oes_only, color: 'orange' },
    { id: 'matched', label: 'Matched', count: data.summary.matched, color: 'green' },
    { id: 'all', label: 'All Records', count: data.records.length, color: 'blue' },
  ];

  // Detect when WA and OES datasets are non-overlapping (both non-zero but 0 matched)
  const hasNonOverlappingData =
    data.summary.matched === 0 &&
    data.summary.total_wa_submissions > 0 &&
    data.summary.total_oes_activations > 0;

  // Detect when only one side has data (possible date range issue)
  const onlyWaData =
    data.summary.total_wa_submissions > 0 &&
    data.summary.total_oes_activations === 0;
  const onlyOesData =
    data.summary.total_oes_activations > 0 &&
    data.summary.total_wa_submissions === 0;

  return (
    <div className="space-y-6">
      {/* Contextual warnings for date mismatch */}
      {hasNonOverlappingData && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
          <p className="text-sm text-amber-800 dark:text-amber-300">
            <span className="font-medium">Date mismatch detected:</span> WA submissions and OES activations exist but none overlap.
            Try a wider date range or check if OES data has been imported for this period.
          </p>
        </div>
      )}
      {onlyWaData && (
        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 text-blue-600 dark:text-blue-400 mt-0.5 shrink-0" />
          <p className="text-sm text-blue-800 dark:text-blue-300">
            <span className="font-medium">No OES activations found</span> for this date.
            OES data is typically imported the next business day — try selecting a date from a previous day.
          </p>
        </div>
      )}
      {onlyOesData && (
        <div className="bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded-lg p-3 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 text-purple-600 dark:text-purple-400 mt-0.5 shrink-0" />
          <p className="text-sm text-purple-800 dark:text-purple-300">
            <span className="font-medium">No WA submissions found</span> for this date, but OES activations exist.
            These may be manual activations or the WA date filter needs adjustment.
          </p>
        </div>
      )}

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
          onClick={() => setActiveFilter('matched')}
        />
        <ReportCard
          title="WA Only"
          value={data.summary.wa_only}
          color="yellow"
          subtitle="Not yet activated"
          onClick={() => setActiveFilter('wa_only')}
        />
        <ReportCard
          title="OES Only"
          value={data.summary.oes_only}
          color="orange"
          subtitle="Manual install?"
          onClick={() => setActiveFilter('oes_only')}
        />
      </ReportCardGrid>

      {/* Filter Buttons */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-muted-foreground">Filter:</span>
        {filterButtons.map((btn) => {
          const isActive = activeFilter === btn.id;
          const colorStyles: Record<string, string> = {
            gray: isActive ? 'bg-gray-600 text-white' : 'bg-secondary text-muted-foreground hover:bg-gray-200 dark:hover:bg-gray-600',
            yellow: isActive ? 'bg-yellow-500 text-white' : 'bg-yellow-50 dark:bg-yellow-900/20 text-yellow-700 dark:text-yellow-300 hover:bg-yellow-100 dark:hover:bg-yellow-900/40',
            orange: isActive ? 'bg-orange-500 text-white' : 'bg-orange-50 dark:bg-orange-900/20 text-orange-700 dark:text-orange-300 hover:bg-orange-100 dark:hover:bg-orange-900/40',
            green: isActive ? 'bg-green-600 text-white' : 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300 hover:bg-green-100 dark:hover:bg-green-900/40',
            blue: isActive ? 'bg-blue-600 text-white' : 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/40',
          };

          return (
            <button
              key={btn.id}
              onClick={() => setActiveFilter(btn.id)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${colorStyles[btn.color]}`}
            >
              {btn.label} ({btn.count})
            </button>
          );
        })}
      </div>

      {/* Table */}
      <DiscrepancyTable records={filteredRecords} />
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
      <div className="text-center py-8 text-muted-foreground">
        No anomalies found for the selected date
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
        <thead className="bg-background/50">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
              DR Number
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
              Project
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
              Status
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
              WA Submitted By
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
              OES Team
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
              Action
            </th>
          </tr>
        </thead>
        <tbody className="bg-card divide-y divide-gray-200 dark:divide-gray-700">
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
              <td className="px-4 py-3 text-sm font-medium text-foreground">
                {record.drop_number}
              </td>
              <td className="px-4 py-3 text-sm text-muted-foreground">
                {record.project || '-'}
              </td>
              <td className="px-4 py-3 text-sm">
                <StatusBadge type={record.discrepancy_type} />
              </td>
              <td className="px-4 py-3 text-sm text-muted-foreground">
                {record.wa_submitted_by || record.wa_sender_phone || '-'}
              </td>
              <td className="px-4 py-3 text-sm text-muted-foreground">
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
        <p className="text-sm text-muted-foreground mt-2 text-center">
          Showing first 50 of {records.length} records
        </p>
      )}
    </div>
  );
}

// ============================================================================
// PENDING AGING SECTION
// ============================================================================

function PendingAgingSection({
  data,
  isLoading,
}: {
  data: PendingAgingResponse | null;
  isLoading: boolean;
}) {
  const [selectedBucket, setSelectedBucket] = useState<string | null>(null);

  if (isLoading) {
    return <LoadingSkeleton cards={4} />;
  }

  if (!data) {
    return <EmptyState message="No pending activation data available" />;
  }

  // Filter records by selected bucket
  const filteredRecords = selectedBucket
    ? data.records.filter((r) => {
        if (selectedBucket === '30+ days') return r.days_pending > 30;
        if (selectedBucket === '15-30 days') return r.days_pending >= 15 && r.days_pending <= 30;
        if (selectedBucket === '8-14 days') return r.days_pending >= 8 && r.days_pending <= 14;
        if (selectedBucket === '4-7 days') return r.days_pending >= 4 && r.days_pending <= 7;
        if (selectedBucket === '2-3 days') return r.days_pending >= 2 && r.days_pending <= 3;
        if (selectedBucket === '0-1 days') return r.days_pending <= 1;
        return true;
      })
    : data.records;

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <ReportCardGrid columns={4}>
        <ReportCard
          title="Total Pending"
          value={data.summary.total_pending}
          color="gray"
          icon={<Clock className="h-4 w-4" />}
          subtitle="Not yet activated"
        />
        <ReportCard
          title="Critical (30+ days)"
          value={data.summary.critical_30plus}
          color="red"
          subtitle="Forgotten activations"
          onClick={() => setSelectedBucket(selectedBucket === '30+ days' ? null : '30+ days')}
        />
        <ReportCard
          title="Warning (15-30 days)"
          value={data.summary.warning_15_30}
          color="orange"
          subtitle="Getting stale"
          onClick={() => setSelectedBucket(selectedBucket === '15-30 days' ? null : '15-30 days')}
        />
        <ReportCard
          title="Recent (0-7 days)"
          value={data.summary.recent_0_7}
          color="green"
          subtitle="Normal processing"
        />
      </ReportCardGrid>

      {/* Aging Buckets Distribution */}
      <div className="bg-background/50 rounded-lg p-4">
        <h4 className="text-sm font-semibold text-foreground mb-3">
          Aging Distribution
        </h4>
        <div className="flex flex-wrap gap-2">
          {data.buckets.map((bucket) => {
            const isSelected = selectedBucket === bucket.bucket;
            const colorClass = getBucketColorClass(bucket.bucket);
            return (
              <button
                key={bucket.bucket}
                onClick={() => setSelectedBucket(isSelected ? null : bucket.bucket)}
                className={`px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                  isSelected
                    ? 'ring-2 ring-blue-500 ring-offset-2 dark:ring-offset-gray-900'
                    : ''
                } ${colorClass}`}
              >
                {bucket.bucket}: <span className="font-bold">{bucket.count}</span>
              </button>
            );
          })}
          {selectedBucket && (
            <button
              onClick={() => setSelectedBucket(null)}
              className="px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
            >
              Clear filter
            </button>
          )}
        </div>
      </div>

      {/* Records Table */}
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
          <thead className="bg-background/50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
                DR Number
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
                Project
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
                WA Submitted
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
                Days Pending
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
                Submitted By
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
                Photos
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
                Action
              </th>
            </tr>
          </thead>
          <tbody className="bg-card divide-y divide-gray-200 dark:divide-gray-700">
            {filteredRecords.slice(0, 50).map((record) => (
              <tr
                key={record.drop_number}
                className={`${
                  record.days_pending > 30
                    ? 'bg-red-50 dark:bg-red-900/10'
                    : record.days_pending > 14
                      ? 'bg-orange-50 dark:bg-orange-900/10'
                      : record.days_pending > 7
                        ? 'bg-yellow-50 dark:bg-yellow-900/10'
                        : ''
                }`}
              >
                <td className="px-4 py-3 text-sm font-medium text-foreground">
                  {record.drop_number}
                </td>
                <td className="px-4 py-3 text-sm text-muted-foreground">
                  {record.project}
                </td>
                <td className="px-4 py-3 text-sm text-muted-foreground">
                  {new Date(record.wa_submitted).toISOString().split('T')[0]}
                </td>
                <td className="px-4 py-3 text-sm">
                  <span
                    className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${
                      record.days_pending > 30
                        ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-200'
                        : record.days_pending > 14
                          ? 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-200'
                          : record.days_pending > 7
                            ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-200'
                            : 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-200'
                    }`}
                  >
                    {record.days_pending} days
                  </span>
                </td>
                <td className="px-4 py-3 text-sm text-muted-foreground">
                  {record.submitted_by || record.sender_phone || '-'}
                </td>
                <td className="px-4 py-3 text-sm text-muted-foreground">
                  {record.completed_photos}
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
        {filteredRecords.length > 50 && (
          <p className="text-sm text-muted-foreground mt-2 text-center">
            Showing first 50 of {filteredRecords.length} records
          </p>
        )}
        {filteredRecords.length === 0 && (
          <div className="text-center py-8 text-muted-foreground">
            No pending activations in this category
          </div>
        )}
      </div>
    </div>
  );
}

function getBucketColorClass(bucket: string): string {
  if (bucket.includes('30+')) return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-200';
  if (bucket.includes('15-30')) return 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-200';
  if (bucket.includes('8-14')) return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-200';
  if (bucket.includes('4-7')) return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-200';
  return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-200';
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
            className="rounded border-border text-red-600 focus:ring-red-500"
          />
          <span className="text-sm text-muted-foreground">
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
      <div className="text-center py-8 text-muted-foreground">
        No serial validation issues found
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
        <thead className="bg-background/50">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
              DR Number
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
              ONT (WA/Scanned)
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
              ONT (OES)
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
              Status
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
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
              <td className="px-4 py-3 text-sm font-medium text-foreground">
                {r.drop_number}
              </td>
              <td className="px-4 py-3 text-sm font-mono text-muted-foreground">
                {r.ont_serial_wa || '-'}
              </td>
              <td className="px-4 py-3 text-sm font-mono text-muted-foreground">
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
        <p className="text-sm text-muted-foreground mt-2 text-center">
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

  const firstTimePassRate = 100 - data.summary.resubmission_rate;

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <ReportCardGrid columns={5}>
        <ReportCard
          title="First-time Pass"
          value={`${firstTimePassRate.toFixed(1)}%`}
          color={firstTimePassRate >= 80 ? 'green' : firstTimePassRate >= 60 ? 'yellow' : 'red'}
          subtitle="Got it right first time"
        />
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
          <h4 className="text-sm font-semibold text-foreground mb-3">
            By Project
          </h4>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700 text-sm">
              <thead className="bg-background/50">
                <tr>
                  <th className="px-4 py-2 text-left font-medium text-muted-foreground uppercase text-xs">
                    Project
                  </th>
                  <th className="px-4 py-2 text-left font-medium text-muted-foreground uppercase text-xs">
                    Total
                  </th>
                  <th className="px-4 py-2 text-left font-medium text-muted-foreground uppercase text-xs">
                    Resubmitted
                  </th>
                  <th className="px-4 py-2 text-left font-medium text-muted-foreground uppercase text-xs">
                    Rate
                  </th>
                  <th className="px-4 py-2 text-left font-medium text-muted-foreground uppercase text-xs">
                    Avg Submissions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {data.by_project.map((p) => (
                  <tr key={p.group_name}>
                    <td className="px-4 py-2 font-medium text-foreground">
                      {p.group_name}
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">{p.total_drs}</td>
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
                    <td className="px-4 py-2 text-muted-foreground">
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
          <h4 className="text-sm font-semibold text-foreground mb-3">
            Top Resubmitted DRs (Quality Issues?)
          </h4>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700 text-sm">
              <thead className="bg-background/50">
                <tr>
                  <th className="px-4 py-2 text-left font-medium text-muted-foreground uppercase text-xs">
                    DR Number
                  </th>
                  <th className="px-4 py-2 text-left font-medium text-muted-foreground uppercase text-xs">
                    Project
                  </th>
                  <th className="px-4 py-2 text-left font-medium text-muted-foreground uppercase text-xs">
                    Submissions
                  </th>
                  <th className="px-4 py-2 text-left font-medium text-muted-foreground uppercase text-xs">
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
                    <td className="px-4 py-2 text-muted-foreground">
                      {dr.project || '-'}
                    </td>
                    <td className="px-4 py-2 font-medium text-orange-600 dark:text-orange-400">
                      {dr.submission_count}x
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">
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
          <div key={i} className="h-24 animate-pulse bg-secondary rounded-lg" />
        ))}
      </div>
      <div className="h-64 animate-pulse bg-secondary rounded" />
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="text-center py-12 text-muted-foreground">
      <AlertTriangle className="h-12 w-12 mx-auto mb-4 opacity-50" />
      <p>{message}</p>
    </div>
  );
}

export default AnomalyReports;
