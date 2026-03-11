/**
 * WhatsApp Maintenance Tracking Dashboard
 *
 * Displays all DRs flagged from the Mohadin QA WhatsApp group.
 * Shows message counts, photos, and allows ticket creation.
 *
 * URL: /noc/wa-tracking
 */

import { useState, useEffect, useCallback } from 'react';
import { AppLayout } from '@/components/layout';
import { format } from 'date-fns';
import Link from 'next/link';
import {
  MessageSquare,
  Image as ImageIcon,
  AlertTriangle,
  CheckCircle,
  Clock,
  Ticket,
  RefreshCw,
  ExternalLink,
  Filter,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';

interface MaintenanceFlag {
  id: string;
  drop_number: string;
  project: string | null;
  has_maintenance_issue: boolean;
  issue_status: string;
  issue_type: string | null;
  issue_description: string | null;
  maintenance_ticket_id: string | null;
  wa_message_count: number;
  wa_photo_count: number;
  first_reported_at: string;
  last_activity_at: string;
  resolved_at: string | null;
  latest_message: string | null;
}

interface Pagination {
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
}

type StatusFilter = 'all' | 'flagged' | 'reviewing' | 'ticket_created' | 'resolved';

export default function WATrackingDashboard() {
  const [flags, setFlags] = useState<MaintenanceFlag[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [page, setPage] = useState(0);
  const limit = 20;

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        limit: limit.toString(),
        offset: (page * limit).toString(),
      });

      if (statusFilter !== 'all') {
        params.set('status', statusFilter);
      }

      const response = await fetch(`/api/noc/wa-messages?${params}`);

      if (!response.ok) {
        throw new Error('Failed to fetch data');
      }

      const result = await response.json();
      if (result.success) {
        setFlags(result.data.items || []);
        setPagination(result.data.pagination || null);
      } else {
        throw new Error(result.error || 'Unknown error');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setIsLoading(false);
    }
  }, [statusFilter, page, limit]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const statusColors: Record<string, string> = {
    flagged: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-200',
    reviewing: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-200',
    ticket_created: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-200',
    resolved: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-200',
  };

  const statusIcons: Record<string, React.ReactNode> = {
    flagged: <AlertTriangle className="h-3.5 w-3.5" />,
    reviewing: <Clock className="h-3.5 w-3.5" />,
    ticket_created: <Ticket className="h-3.5 w-3.5" />,
    resolved: <CheckCircle className="h-3.5 w-3.5" />,
  };

  const statusOptions: { value: StatusFilter; label: string }[] = [
    { value: 'all', label: 'All Statuses' },
    { value: 'flagged', label: 'Flagged' },
    { value: 'reviewing', label: 'Reviewing' },
    { value: 'ticket_created', label: 'Ticket Created' },
    { value: 'resolved', label: 'Resolved' },
  ];

  // Count by status for summary
  const statusCounts = flags.reduce((acc, flag) => {
    acc[flag.issue_status] = (acc[flag.issue_status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-3">
              <MessageSquare className="h-7 w-7 text-orange-600" />
              WhatsApp Maintenance Tracking
            </h1>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
              Monitor DRs flagged from the Mohadin QA WhatsApp group
            </p>
          </div>
          <button
            onClick={fetchData}
            disabled={isLoading}
            className="px-4 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors flex items-center gap-2"
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        {/* Status Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {statusOptions.slice(1).map((status) => (
            <button
              key={status.value}
              onClick={() => {
                setStatusFilter(status.value);
                setPage(0);
              }}
              className={`p-4 rounded-lg border transition-all ${
                statusFilter === status.value
                  ? 'border-orange-500 bg-orange-50 dark:bg-orange-900/20'
                  : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-gray-300 dark:hover:border-gray-600'
              }`}
            >
              <div className="flex items-center justify-between">
                <span
                  className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium ${
                    statusColors[status.value]
                  }`}
                >
                  {statusIcons[status.value]}
                  {status.label}
                </span>
                <span className="text-2xl font-bold text-gray-900 dark:text-white">
                  {statusCounts[status.value] || 0}
                </span>
              </div>
            </button>
          ))}
        </div>

        {/* Filter Bar */}
        <div className="flex items-center justify-between bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-gray-500" />
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Filter:</span>
            </div>
            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value as StatusFilter);
                setPage(0);
              }}
              className="px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            >
              {statusOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          {pagination && (
            <span className="text-sm text-gray-600 dark:text-gray-400">
              Showing {pagination.offset + 1}-{Math.min(pagination.offset + flags.length, pagination.total)} of {pagination.total}
            </span>
          )}
        </div>

        {/* Error State */}
        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400" />
              <span className="text-red-800 dark:text-red-200">{error}</span>
            </div>
          </div>
        )}

        {/* Loading State */}
        {isLoading && (
          <div className="flex items-center justify-center py-12">
            <div className="text-center">
              <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-orange-600 mx-auto mb-3"></div>
              <p className="text-gray-600 dark:text-gray-400">Loading...</p>
            </div>
          </div>
        )}

        {/* Empty State */}
        {!isLoading && !error && flags.length === 0 && (
          <div className="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-12 text-center">
            <MessageSquare className="h-12 w-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
              No Flagged DRs
            </h3>
            <p className="text-gray-600 dark:text-gray-400">
              {statusFilter === 'all'
                ? 'No maintenance issues have been reported yet.'
                : `No DRs with status "${statusFilter}".`}
            </p>
          </div>
        )}

        {/* Data Table */}
        {!isLoading && !error && flags.length > 0 && (
          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50 dark:bg-gray-900/50 border-b border-gray-200 dark:border-gray-700">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                    DR Number
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                    Status
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                    Messages
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                    Photos
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                    Latest Message
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                    Last Activity
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {flags.map((flag) => (
                  <tr key={flag.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                    <td className="px-4 py-3">
                      <Link
                        href={`/activate/${flag.drop_number}`}
                        className="font-medium text-blue-600 dark:text-blue-400 hover:underline"
                      >
                        {flag.drop_number}
                      </Link>
                      {flag.project && (
                        <div className="text-xs text-gray-500 dark:text-gray-500 mt-0.5">
                          {flag.project}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium ${
                          statusColors[flag.issue_status] || statusColors.flagged
                        }`}
                      >
                        {statusIcons[flag.issue_status] || statusIcons.flagged}
                        {flag.issue_status.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5 text-sm text-gray-600 dark:text-gray-400">
                        <MessageSquare className="h-4 w-4" />
                        {flag.wa_message_count}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5 text-sm text-gray-600 dark:text-gray-400">
                        <ImageIcon className="h-4 w-4" />
                        {flag.wa_photo_count}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="max-w-xs truncate text-sm text-gray-700 dark:text-gray-300">
                        {flag.latest_message || '-'}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-sm text-gray-600 dark:text-gray-400">
                        {format(new Date(flag.last_activity_at), 'dd MMM HH:mm')}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/activate/${flag.drop_number}`}
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-sm text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors"
                      >
                        View
                        <ExternalLink className="h-3.5 w-3.5" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Pagination */}
            {pagination && pagination.total > limit && (
              <div className="border-t border-gray-200 dark:border-gray-700 px-4 py-3 flex items-center justify-between">
                <button
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
                >
                  <ChevronLeft className="h-4 w-4" />
                  Previous
                </button>
                <span className="text-sm text-gray-600 dark:text-gray-400">
                  Page {page + 1} of {Math.ceil(pagination.total / limit)}
                </span>
                <button
                  onClick={() => setPage((p) => p + 1)}
                  disabled={!pagination.has_more}
                  className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
                >
                  Next
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
