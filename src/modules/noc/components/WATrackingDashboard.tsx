/**
 * WhatsApp Maintenance Tracking Dashboard Component
 *
 * Displays all DRs flagged from the Mohadin QA WhatsApp group.
 * Shows message counts, photos, and allows ticket creation.
 *
 * Used in:
 * - /noc/wa-tracking (standalone page)
 * - /noc/data-sync (as a tab)
 */

import { useState, useEffect, useCallback } from 'react';
import { formatDisplayDateTime } from '@/utils/dateFormat';
import Link from 'next/link';
import Image from 'next/image';
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
  ChevronDown,
  ChevronUp,
  X,
  Loader2,
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

interface Photo {
  id: string;
  filename: string;
  url: string;
  timestamp: string;
  sender: string;
}

type StatusFilter = 'all' | 'flagged' | 'reviewing' | 'ticket_created' | 'resolved';

export function WATrackingDashboard() {
  const [flags, setFlags] = useState<MaintenanceFlag[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [page, setPage] = useState(0);
  const limit = 20;

  // Photo viewing state
  const [expandedDr, setExpandedDr] = useState<string | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [photosLoading, setPhotosLoading] = useState(false);
  const [lightboxPhoto, setLightboxPhoto] = useState<Photo | null>(null);

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

  const toggleExpand = async (dropNumber: string) => {
    if (expandedDr === dropNumber) {
      setExpandedDr(null);
      setPhotos([]);
      return;
    }

    setExpandedDr(dropNumber);
    setPhotosLoading(true);

    try {
      const response = await fetch(`/api/noc/wa-dr-photos?dropNumber=${dropNumber}`);
      if (response.ok) {
        const result = await response.json();
        setPhotos(result.data?.photos || []);
      } else {
        setPhotos([]);
      }
    } catch {
      setPhotos([]);
    } finally {
      setPhotosLoading(false);
    }
  };

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
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-[var(--ff-text-primary)] flex items-center gap-2">
            <MessageSquare className="h-5 w-5 text-orange-600" />
            Offline Tracking
          </h2>
          <p className="text-sm text-[var(--ff-text-secondary)] mt-1">
            Monitor DRs flagged from WhatsApp QA groups
          </p>
        </div>
        <button
          onClick={fetchData}
          disabled={isLoading}
          className="px-4 py-2 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg hover:bg-[var(--ff-bg-tertiary)] transition-colors flex items-center gap-2 text-[var(--ff-text-primary)]"
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
                : 'border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)] hover:border-[var(--ff-border-medium)]'
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
              <span className="text-2xl font-bold text-[var(--ff-text-primary)]">
                {statusCounts[status.value] || 0}
              </span>
            </div>
          </button>
        ))}
      </div>

      {/* Filter Bar */}
      <div className="flex items-center justify-between bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-4">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-[var(--ff-text-secondary)]" />
            <span className="text-sm font-medium text-[var(--ff-text-primary)]">Filter:</span>
          </div>
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value as StatusFilter);
              setPage(0);
            }}
            className="px-3 py-1.5 border border-[var(--ff-border-light)] rounded-lg text-sm bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)]"
          >
            {statusOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        {pagination && (
          <span className="text-sm text-[var(--ff-text-secondary)]">
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
            <p className="text-[var(--ff-text-secondary)]">Loading...</p>
          </div>
        </div>
      )}

      {/* Empty State */}
      {!isLoading && !error && flags.length === 0 && (
        <div className="bg-[var(--ff-bg-tertiary)] rounded-lg p-12 text-center">
          <MessageSquare className="h-12 w-12 text-[var(--ff-text-secondary)] mx-auto mb-4" />
          <h3 className="text-lg font-medium text-[var(--ff-text-primary)] mb-2">
            No Flagged DRs
          </h3>
          <p className="text-[var(--ff-text-secondary)]">
            {statusFilter === 'all'
              ? 'No maintenance issues have been reported yet.'
              : `No DRs with status "${statusFilter}".`}
          </p>
        </div>
      )}

      {/* Data Table */}
      {!isLoading && !error && flags.length > 0 && (
        <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg overflow-hidden">
          <table className="w-full">
            <thead className="bg-[var(--ff-bg-tertiary)] border-b border-[var(--ff-border-light)]">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] uppercase">
                  DR Number
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] uppercase">
                  Status
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] uppercase">
                  Messages
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] uppercase">
                  Photos
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] uppercase">
                  Latest Message
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] uppercase">
                  Last Activity
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium text-[var(--ff-text-secondary)] uppercase">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--ff-border-light)]">
              {flags.map((flag) => (
                <>
                  <tr
                    key={flag.id}
                    className={`hover:bg-[var(--ff-bg-tertiary)] cursor-pointer ${
                      expandedDr === flag.drop_number ? 'bg-[var(--ff-bg-tertiary)]' : ''
                    }`}
                    onClick={() => flag.wa_photo_count > 0 && toggleExpand(flag.drop_number)}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {flag.wa_photo_count > 0 && (
                          <button className="text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]">
                            {expandedDr === flag.drop_number ? (
                              <ChevronUp className="h-4 w-4" />
                            ) : (
                              <ChevronDown className="h-4 w-4" />
                            )}
                          </button>
                        )}
                        <div>
                          <Link
                            href={`/activate/${flag.drop_number}`}
                            className="font-medium text-blue-600 dark:text-blue-400 hover:underline"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {flag.drop_number}
                          </Link>
                          {flag.project && (
                            <div className="text-xs text-[var(--ff-text-secondary)] mt-0.5">
                              {flag.project}
                            </div>
                          )}
                        </div>
                      </div>
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
                      <div className="flex items-center gap-1.5 text-sm text-[var(--ff-text-secondary)]">
                        <MessageSquare className="h-4 w-4" />
                        {flag.wa_message_count}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5 text-sm text-[var(--ff-text-secondary)]">
                        <ImageIcon className="h-4 w-4" />
                        {flag.wa_photo_count}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="max-w-xs truncate text-sm text-[var(--ff-text-primary)]">
                        {flag.latest_message || '-'}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-sm text-[var(--ff-text-secondary)]">
                        {formatDisplayDateTime(flag.last_activity_at)}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/activate/${flag.drop_number}`}
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-sm text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors"
                        onClick={(e) => e.stopPropagation()}
                      >
                        View
                        <ExternalLink className="h-3.5 w-3.5" />
                      </Link>
                    </td>
                  </tr>
                  {/* Expanded Photo Row */}
                  {expandedDr === flag.drop_number && (
                    <tr key={`${flag.id}-photos`}>
                      <td colSpan={7} className="px-4 py-4 bg-[var(--ff-bg-primary)]">
                        <div className="pl-8">
                          <h4 className="text-sm font-medium text-[var(--ff-text-primary)] mb-3 flex items-center gap-2">
                            <ImageIcon className="h-4 w-4" />
                            Photos for {flag.drop_number}
                          </h4>
                          {photosLoading ? (
                            <div className="flex items-center gap-2 text-sm text-[var(--ff-text-secondary)]">
                              <Loader2 className="h-4 w-4 animate-spin" />
                              Loading photos...
                            </div>
                          ) : photos.length === 0 ? (
                            <p className="text-sm text-[var(--ff-text-secondary)]">
                              No photos found in database. Photos may exist on VPS but not yet synced.
                            </p>
                          ) : (
                            <div className="flex flex-wrap gap-3">
                              {photos.map((photo) => (
                                <button
                                  key={photo.id}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setLightboxPhoto(photo);
                                  }}
                                  className="relative group rounded-lg overflow-hidden border border-[var(--ff-border-light)] hover:border-orange-500 transition-colors"
                                >
                                  <Image
                                    src={photo.url}
                                    alt={photo.filename}
                                    width={120}
                                    height={90}
                                    className="object-cover w-[120px] h-[90px]"
                                    unoptimized
                                  />
                                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors" />
                                  <div className="absolute bottom-0 left-0 right-0 bg-black/60 px-2 py-1">
                                    <p className="text-[10px] text-white truncate">
                                      {formatDisplayDateTime(photo.timestamp)}
                                    </p>
                                  </div>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>

          {/* Pagination */}
          {pagination && pagination.total > limit && (
            <div className="border-t border-[var(--ff-border-light)] px-4 py-3 flex items-center justify-between">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="px-3 py-1.5 text-sm border border-[var(--ff-border-light)] rounded-lg hover:bg-[var(--ff-bg-tertiary)] disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1 text-[var(--ff-text-primary)]"
              >
                <ChevronLeft className="h-4 w-4" />
                Previous
              </button>
              <span className="text-sm text-[var(--ff-text-secondary)]">
                Page {page + 1} of {Math.ceil(pagination.total / limit)}
              </span>
              <button
                onClick={() => setPage((p) => p + 1)}
                disabled={!pagination.has_more}
                className="px-3 py-1.5 text-sm border border-[var(--ff-border-light)] rounded-lg hover:bg-[var(--ff-bg-tertiary)] disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1 text-[var(--ff-text-primary)]"
              >
                Next
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      )}

      {/* Photo Lightbox */}
      {lightboxPhoto && (
        <div
          className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
          onClick={() => setLightboxPhoto(null)}
        >
          <div className="relative max-w-4xl max-h-[90vh] bg-[var(--ff-bg-secondary)] rounded-lg overflow-hidden">
            <button
              onClick={() => setLightboxPhoto(null)}
              className="absolute top-2 right-2 z-10 p-2 bg-black/50 rounded-full text-white hover:bg-black/70 transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
            <Image
              src={lightboxPhoto.url}
              alt={lightboxPhoto.filename}
              width={800}
              height={600}
              className="object-contain max-h-[80vh]"
              unoptimized
              onClick={(e) => e.stopPropagation()}
            />
            <div className="p-3 border-t border-[var(--ff-border-light)]">
              <p className="text-sm text-[var(--ff-text-primary)]">{lightboxPhoto.filename}</p>
              <p className="text-xs text-[var(--ff-text-secondary)]">
                {formatDisplayDateTime(lightboxPhoto.timestamp)} • {lightboxPhoto.sender}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
