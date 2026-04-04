/**
 * Reports Tab Component
 *
 * Main container for all reporting functionality in Activate
 * Provides sub-navigation between report types and shared filters
 *
 * Report Types:
 * - Daily Counts: Zone/PON breakdown by project
 * - Discrepancy: WhatsApp vs OES comparison
 * - Serial Validation: ONT/UPS serial matching
 * - User/Team Attribution: Performance metrics
 *
 * Uses shared context for filter synchronization with Dashboard tab
 */

'use client';

import { useState, useEffect } from 'react';
import {
  AlertTriangle,
  Hash,
  Users,
  Calendar,
  RefreshCw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import type {
  ReportType,
  ReportFilters,
  DiscrepancyReportResponse,
  SerialValidationReportResponse,
  UserTeamAttributionResponse,
} from '../../types/reporting.types';
import { useActivateData, getTodaySAST, getYesterdaySAST } from '../../context';

export function ReportsTab() {
  // Get shared filters from context
  const { filters: sharedFilters, lastRefreshAt } = useActivateData();

  // Active report type (Daily Counts moved to Dashboard)
  const [activeReport, setActiveReport] = useState<ReportType>('discrepancy');

  // Local filters - synced with shared context
  const [filters, setFilters] = useState<ReportFilters>({
    dateFrom: sharedFilters.dateFrom || getTodaySAST(),
    dateTo: sharedFilters.dateTo || getTodaySAST(),
    project: sharedFilters.projectFilter !== 'all' ? sharedFilters.projectFilter : undefined,
  });

  // Sync filters when shared context changes
  useEffect(() => {
    setFilters({
      dateFrom: sharedFilters.dateFrom || getTodaySAST(),
      dateTo: sharedFilters.dateTo || getTodaySAST(),
      project: sharedFilters.projectFilter !== 'all' ? sharedFilters.projectFilter : undefined,
    });
  }, [sharedFilters.dateFrom, sharedFilters.dateTo, sharedFilters.projectFilter]);

  // Loading and error states
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Report data states (Daily Counts moved to Dashboard)
  const [discrepancyData, setDiscrepancyData] =
    useState<DiscrepancyReportResponse | null>(null);
  const [serialData, setSerialData] =
    useState<SerialValidationReportResponse | null>(null);
  const [userTeamData, setUserTeamData] =
    useState<UserTeamAttributionResponse | null>(null);

  // Track last refresh to trigger re-fetch on background refresh
  const [lastContextRefresh, setLastContextRefresh] = useState<Date | null>(null);

  // Trigger refetch when context does background refresh
  useEffect(() => {
    if (lastRefreshAt && lastContextRefresh && lastRefreshAt > lastContextRefresh) {
      // Background refresh happened, refetch report data silently
      fetchReportData(true);
    }
    setLastContextRefresh(lastRefreshAt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastRefreshAt]);

  // Fetch report data when filters or report type changes
  useEffect(() => {
    fetchReportData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeReport, filters]);

  const fetchReportData = async (silent = false) => {
    if (!silent) setIsLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      params.set('dateFrom', filters.dateFrom);
      params.set('dateTo', filters.dateTo);
      if (filters.project) params.set('project', filters.project);

      let endpoint = '';
      switch (activeReport) {
        case 'discrepancy':
          endpoint = `/api/activate/reporting/discrepancy?waDate=${filters.dateFrom}`;
          if (filters.project) endpoint += `&project=${filters.project}`;
          break;
        case 'serial-validation':
          endpoint = `/api/activate/reporting/serial-validation?${params.toString()}`;
          break;
        case 'user-attribution':
          endpoint = `/api/activate/reporting/user-attribution?${params.toString()}`;
          break;
      }

      const response = await fetch(endpoint);
      if (!response.ok) {
        throw new Error(`Failed to fetch ${activeReport} report`);
      }

      const data = await response.json();

      switch (activeReport) {
        case 'discrepancy':
          setDiscrepancyData(data);
          break;
        case 'serial-validation':
          setSerialData(data);
          break;
        case 'user-attribution':
          setUserTeamData(data);
          break;
      }
    } catch (err) {
      if (!silent) {
        setError(err instanceof Error ? err.message : 'Failed to fetch report');
      }
    } finally {
      if (!silent) setIsLoading(false);
    }
  };

  // Quick filter handlers
  const handleQuickFilter = (filter: 'today' | 'yesterday' | 'last7days') => {
    const todayStr = getTodaySAST();

    switch (filter) {
      case 'today':
        setFilters({ ...filters, dateFrom: todayStr, dateTo: todayStr });
        break;
      case 'yesterday': {
        const yesterdayStr = getYesterdaySAST();
        setFilters({ ...filters, dateFrom: yesterdayStr, dateTo: yesterdayStr });
        break;
      }
      case 'last7days': {
        const last7DaysDate = new Date(todayStr);
        last7DaysDate.setDate(last7DaysDate.getDate() - 7);
        const last7DaysStr = last7DaysDate.toISOString().split('T')[0] as string;
        setFilters({ ...filters, dateFrom: last7DaysStr, dateTo: todayStr });
        break;
      }
    }
  };

  // Get active quick filter
  const getActiveQuickFilter = (): 'today' | 'yesterday' | 'last7days' | null => {
    const todayStr = getTodaySAST();
    const yesterdayStr = getYesterdaySAST();
    const last7DaysDate = new Date(todayStr);
    last7DaysDate.setDate(last7DaysDate.getDate() - 7);
    const last7DaysStr = last7DaysDate.toISOString().split('T')[0] as string;

    if (filters.dateFrom === todayStr && filters.dateTo === todayStr)
      return 'today';
    if (filters.dateFrom === yesterdayStr && filters.dateTo === yesterdayStr)
      return 'yesterday';
    if (filters.dateFrom === last7DaysStr && filters.dateTo === todayStr)
      return 'last7days';

    return null;
  };

  // Skeleton component
  const Skeleton = ({ className }: { className?: string }) => (
    <div
      className={`animate-pulse bg-secondary rounded ${className || ''}`}
    />
  );

  return (
    <div className="space-y-6">
      {/* Report Type Navigation (Daily Counts moved to Dashboard) */}
      <div className="bg-card rounded-lg shadow-md dark:shadow-gray-900/50 p-4">
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setActiveReport('discrepancy')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm transition-colors ${
              activeReport === 'discrepancy'
                ? 'bg-blue-600 text-white'
                : 'bg-secondary text-muted-foreground hover:bg-gray-200 dark:hover:bg-gray-600'
            }`}
          >
            <AlertTriangle className="h-4 w-4" />
            Discrepancy
          </button>
          <button
            onClick={() => setActiveReport('serial-validation')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm transition-colors ${
              activeReport === 'serial-validation'
                ? 'bg-blue-600 text-white'
                : 'bg-secondary text-muted-foreground hover:bg-gray-200 dark:hover:bg-gray-600'
            }`}
          >
            <Hash className="h-4 w-4" />
            Serial Validation
          </button>
          <button
            onClick={() => setActiveReport('user-attribution')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm transition-colors ${
              activeReport === 'user-attribution'
                ? 'bg-blue-600 text-white'
                : 'bg-secondary text-muted-foreground hover:bg-gray-200 dark:hover:bg-gray-600'
            }`}
          >
            <Users className="h-4 w-4" />
            User/Team
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-card rounded-lg shadow-md dark:shadow-gray-900/50 p-4">
        <div className="flex flex-wrap items-center gap-4">
          {/* Quick Filters */}
          <div className="flex gap-2">
            <button
              onClick={() => handleQuickFilter('today')}
              className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                getActiveQuickFilter() === 'today'
                  ? 'bg-blue-600 text-white'
                  : 'bg-secondary text-muted-foreground hover:bg-gray-200 dark:hover:bg-gray-600'
              }`}
            >
              Today
            </button>
            <button
              onClick={() => handleQuickFilter('yesterday')}
              className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                getActiveQuickFilter() === 'yesterday'
                  ? 'bg-blue-600 text-white'
                  : 'bg-secondary text-muted-foreground hover:bg-gray-200 dark:hover:bg-gray-600'
              }`}
            >
              Yesterday
            </button>
            <button
              onClick={() => handleQuickFilter('last7days')}
              className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                getActiveQuickFilter() === 'last7days'
                  ? 'bg-blue-600 text-white'
                  : 'bg-secondary text-muted-foreground hover:bg-gray-200 dark:hover:bg-gray-600'
              }`}
            >
              Last 7 Days
            </button>
          </div>

          {/* Date Range */}
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-gray-400" />
            <input
              type="date"
              value={filters.dateFrom}
              onChange={(e) =>
                setFilters({ ...filters, dateFrom: e.target.value })
              }
              className="px-2 py-1.5 border border-border rounded text-sm bg-card text-foreground"
            />
            <span className="text-muted-foreground">to</span>
            <input
              type="date"
              value={filters.dateTo}
              onChange={(e) =>
                setFilters({ ...filters, dateTo: e.target.value })
              }
              className="px-2 py-1.5 border border-border rounded text-sm bg-card text-foreground"
            />
          </div>

          {/* Refresh Button */}
          <Button
            variant="secondary"
            size="sm"
            onClick={() => { void fetchReportData(); }}
            disabled={isLoading}
            loading={isLoading}
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <p className="text-red-600 dark:text-red-400">{error}</p>
        </div>
      )}

      {/* Report Content */}
      <div className="bg-card rounded-lg shadow-md dark:shadow-gray-900/50 p-6">
        {/* Discrepancy Report */}
        {activeReport === 'discrepancy' && (
          <DiscrepancyContent data={discrepancyData} isLoading={isLoading} />
        )}

        {/* Serial Validation Report */}
        {activeReport === 'serial-validation' && (
          <SerialValidationContent data={serialData} isLoading={isLoading} />
        )}

        {/* User/Team Attribution Report */}
        {activeReport === 'user-attribution' && (
          <UserTeamContent data={userTeamData} isLoading={isLoading} />
        )}
      </div>
    </div>
  );
}

// ============================================================================
// DISCREPANCY CONTENT
// ============================================================================

interface DiscrepancyContentProps {
  data: DiscrepancyReportResponse | null;
  isLoading: boolean;
}

function DiscrepancyContent({ data, isLoading }: DiscrepancyContentProps) {
  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-24 animate-pulse bg-secondary rounded-lg"
            />
          ))}
        </div>
        <div className="h-64 animate-pulse bg-secondary rounded" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        No data available for the selected date.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <SummaryCard
          title="WA Submissions"
          value={data.summary.total_wa_submissions}
          color="blue"
        />
        <SummaryCard
          title="OES Activations"
          value={data.summary.total_oes_activations}
          color="purple"
        />
        <SummaryCard
          title="Matched"
          value={data.summary.matched}
          color="green"
        />
        <SummaryCard
          title="WA Only"
          value={data.summary.wa_only}
          color="yellow"
          subtitle="Not yet activated"
        />
        <SummaryCard
          title="OES Only"
          value={data.summary.oes_only}
          color="orange"
          subtitle="Manual install?"
        />
      </div>

      {/* Discrepancy Table */}
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
            </tr>
          </thead>
          <tbody className="bg-card divide-y divide-gray-200 dark:divide-gray-700">
            {data.records.slice(0, 50).map((record) => (
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
                  <span
                    className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${
                      record.discrepancy_type === 'matched'
                        ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-200'
                        : record.discrepancy_type === 'wa_only'
                          ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-200'
                          : 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-200'
                    }`}
                  >
                    {record.discrepancy_type === 'matched'
                      ? 'Matched'
                      : record.discrepancy_type === 'wa_only'
                        ? 'WA Only'
                        : 'OES Only'}
                  </span>
                </td>
                <td className="px-4 py-3 text-sm text-muted-foreground">
                  {record.wa_submitted_by || record.wa_sender_phone || '-'}
                </td>
                <td className="px-4 py-3 text-sm text-muted-foreground">
                  {record.oes_team || '-'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {data.records.length > 50 && (
          <p className="text-sm text-muted-foreground mt-2 text-center">
            Showing first 50 of {data.records.length} records
          </p>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// SERIAL VALIDATION CONTENT
// ============================================================================

interface SerialValidationContentProps {
  data: SerialValidationReportResponse | null;
  isLoading: boolean;
}

function SerialValidationContent({
  data,
  isLoading,
}: SerialValidationContentProps) {
  const [showMismatchesOnly, setShowMismatchesOnly] = useState(false);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="h-24 animate-pulse bg-secondary rounded-lg"
            />
          ))}
        </div>
        <div className="h-64 animate-pulse bg-secondary rounded" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        No data available for the selected date range.
      </div>
    );
  }

  const displayRecords = showMismatchesOnly ? data.mismatches_only : data.records;

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
        <SummaryCard
          title="Total Checked"
          value={data.summary.total_checked}
          color="gray"
        />
        <SummaryCard
          title="ONT Matches"
          value={data.summary.ont_matches}
          color="green"
        />
        <SummaryCard
          title="ONT Mismatches"
          value={data.summary.ont_mismatches}
          color="red"
        />
        <SummaryCard
          title="ONT Missing"
          value={data.summary.ont_missing}
          color="yellow"
        />
        <SummaryCard
          title="UPS Present"
          value={data.summary.ups_present}
          color="green"
        />
        <SummaryCard
          title="UPS Missing"
          value={data.summary.ups_missing}
          color="yellow"
        />
      </div>

      {/* Toggle for mismatches only */}
      <div className="flex items-center gap-2">
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
      </div>

      {/* Validation Table */}
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
          <thead className="bg-background/50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
                DR Number
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
                ONT (WA)
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
                ONT (OES)
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
                Status
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
                UPS
              </th>
            </tr>
          </thead>
          <tbody className="bg-card divide-y divide-gray-200 dark:divide-gray-700">
            {displayRecords.slice(0, 50).map((record) => (
              <tr
                key={record.drop_number}
                className={`${
                  record.ont_match_status === 'match'
                    ? ''
                    : record.ont_match_status === 'mismatch'
                      ? 'bg-red-50 dark:bg-red-900/10'
                      : 'bg-yellow-50 dark:bg-yellow-900/10'
                }`}
              >
                <td className="px-4 py-3 text-sm font-medium text-foreground">
                  {record.drop_number}
                </td>
                <td className="px-4 py-3 text-sm text-muted-foreground font-mono">
                  {record.ont_serial_wa || '-'}
                </td>
                <td className="px-4 py-3 text-sm text-muted-foreground font-mono">
                  {record.ont_serial_oes || '-'}
                </td>
                <td className="px-4 py-3 text-sm">
                  <span
                    className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${
                      record.ont_match_status === 'match'
                        ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-200'
                        : record.ont_match_status === 'mismatch'
                          ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-200'
                          : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-200'
                    }`}
                  >
                    {record.ont_match_status}
                  </span>
                </td>
                <td className="px-4 py-3 text-sm">
                  {record.ups_serial_exists ? (
                    <span className="text-green-600 dark:text-green-500">
                      Yes
                    </span>
                  ) : (
                    <span className="text-yellow-600 dark:text-yellow-500">
                      No
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {displayRecords.length > 50 && (
          <p className="text-sm text-muted-foreground mt-2 text-center">
            Showing first 50 of {displayRecords.length} records
          </p>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// USER/TEAM CONTENT
// ============================================================================

interface UserTeamContentProps {
  data: UserTeamAttributionResponse | null;
  isLoading: boolean;
}

function UserTeamContent({ data, isLoading }: UserTeamContentProps) {
  const [activeView, setActiveView] = useState<'users' | 'teams'>('users');

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="h-24 animate-pulse bg-secondary rounded-lg"
            />
          ))}
        </div>
        <div className="h-64 animate-pulse bg-secondary rounded" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        No data available for the selected date range.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <SummaryCard
          title="Total Users"
          value={data.summary.total_users}
          color="blue"
        />
        <SummaryCard
          title="Total Teams"
          value={data.summary.total_teams}
          color="purple"
        />
        <SummaryCard
          title="Avg Review Rate"
          value={`${data.summary.avg_review_rate}%`}
          color="green"
        />
        <SummaryCard
          title="Avg Serial Compliance"
          value={`${data.summary.avg_serial_compliance}%`}
          color="blue"
        />
      </div>

      {/* View Toggle */}
      <div className="flex gap-2">
        <button
          onClick={() => setActiveView('users')}
          className={`px-4 py-2 rounded-lg font-medium text-sm transition-colors ${
            activeView === 'users'
              ? 'bg-blue-600 text-white'
              : 'bg-secondary text-muted-foreground hover:bg-gray-200 dark:hover:bg-gray-600'
          }`}
        >
          Users ({data.users.length})
        </button>
        <button
          onClick={() => setActiveView('teams')}
          className={`px-4 py-2 rounded-lg font-medium text-sm transition-colors ${
            activeView === 'teams'
              ? 'bg-blue-600 text-white'
              : 'bg-secondary text-muted-foreground hover:bg-gray-200 dark:hover:bg-gray-600'
          }`}
        >
          Teams ({data.teams.length})
        </button>
      </div>

      {/* Users Table */}
      {activeView === 'users' && (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-background/50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
                  User
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
                  Project
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
                  Installed
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
                  Reviewed
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
                  Review %
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
                  Serial %
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
                  Activated %
                </th>
              </tr>
            </thead>
            <tbody className="bg-card divide-y divide-gray-200 dark:divide-gray-700">
              {data.users.map((user, idx) => (
                <tr key={idx}>
                  <td className="px-4 py-3 text-sm">
                    <div className="font-medium text-foreground">
                      {user.user_name || 'Unknown'}
                    </div>
                    <div className="text-muted-foreground text-xs">
                      {user.sender_phone
                        ? user.sender_phone.replace(/^27/, '0')
                        : '-'}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-muted-foreground">
                    {user.project}
                  </td>
                  <td className="px-4 py-3 text-sm text-blue-600 dark:text-blue-400">
                    {user.installed}
                  </td>
                  <td className="px-4 py-3 text-sm text-green-600 dark:text-green-500">
                    {user.reviewed}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <span
                      className={`font-medium ${
                        user.review_rate >= 80
                          ? 'text-green-600 dark:text-green-500'
                          : user.review_rate >= 50
                            ? 'text-yellow-600 dark:text-yellow-500'
                            : 'text-red-600 dark:text-red-500'
                      }`}
                    >
                      {user.review_rate}%
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <span
                      className={`font-medium ${
                        user.serial_compliance_rate >= 80
                          ? 'text-green-600 dark:text-green-500'
                          : user.serial_compliance_rate >= 50
                            ? 'text-yellow-600 dark:text-yellow-500'
                            : 'text-red-600 dark:text-red-500'
                      }`}
                    >
                      {user.serial_compliance_rate}%
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-purple-600 dark:text-purple-400">
                    {user.activation_rate}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Teams Table */}
      {activeView === 'teams' && (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-background/50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
                  Team
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
                  Project
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
                  Total Activations
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
                  Matched to WA
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
                  Match Rate
                </th>
              </tr>
            </thead>
            <tbody className="bg-card divide-y divide-gray-200 dark:divide-gray-700">
              {data.teams.map((team, idx) => (
                <tr key={idx}>
                  <td className="px-4 py-3 text-sm font-medium text-foreground">
                    {team.team}
                  </td>
                  <td className="px-4 py-3 text-sm text-muted-foreground">
                    {team.project || '-'}
                  </td>
                  <td className="px-4 py-3 text-sm text-foreground">
                    {team.total_activations}
                  </td>
                  <td className="px-4 py-3 text-sm text-green-600 dark:text-green-500">
                    {team.matched_to_wa}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <span
                      className={`font-medium ${
                        team.match_rate >= 80
                          ? 'text-green-600 dark:text-green-500'
                          : team.match_rate >= 50
                            ? 'text-yellow-600 dark:text-yellow-500'
                            : 'text-red-600 dark:text-red-500'
                      }`}
                    >
                      {team.match_rate}%
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// SHARED COMPONENTS
// ============================================================================

interface SummaryCardProps {
  title: string;
  value: number | string;
  color: 'blue' | 'green' | 'yellow' | 'red' | 'orange' | 'purple' | 'gray';
  subtitle?: string;
}

function SummaryCard({ title, value, color, subtitle }: SummaryCardProps) {
  const colorClasses = {
    blue: 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400',
    green:
      'bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400',
    yellow:
      'bg-yellow-50 dark:bg-yellow-900/20 text-yellow-600 dark:text-yellow-400',
    red: 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400',
    orange:
      'bg-orange-50 dark:bg-orange-900/20 text-orange-600 dark:text-orange-400',
    purple:
      'bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400',
    gray: 'bg-background/20 text-muted-foreground',
  };

  return (
    <div className={`rounded-lg p-4 ${colorClasses[color]}`}>
      <div className="text-sm font-medium opacity-75">{title}</div>
      <div className="text-2xl font-bold">{value}</div>
      {subtitle && (
        <div className="text-xs opacity-60 mt-1">{subtitle}</div>
      )}
    </div>
  );
}
