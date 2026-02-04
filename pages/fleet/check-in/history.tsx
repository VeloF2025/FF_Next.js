/**
 * Fleet Check-In History Page
 * View and manage check-in records with approval workflow
 */

import React, { useState, useEffect } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { useAuth } from '@/contexts/AuthContext';
import {
  CheckCircle,
  XCircle,
  AlertTriangle,
  Clock,
  Filter,
  Search,
  ChevronDown,
  ChevronRight,
  Loader2,
  Eye,
  ThumbsUp,
  ThumbsDown,
} from 'lucide-react';
import { AppLayout } from '@/components/layout';
import type {
  CheckRecordWithDetails,
  CheckRecordStatus,
} from '@/modules/fleet/types/check-in.types';

interface CheckInHistoryResponse {
  records: CheckRecordWithDetails[];
  total: number;
}

/**
 * Convert storage URL to API URL for serving files
 * /uploads/... -> /api/uploads/...
 */
function getPhotoUrl(url: string): string {
  if (url.startsWith('/uploads/')) {
    return `/api${url}`;
  }
  return url;
}

export default function CheckInHistoryPage() {
  const router = useRouter();
  const { currentUser } = useAuth();
  const { recordId } = router.query;

  const [records, setRecords] = useState<CheckRecordWithDetails[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedRecord, setExpandedRecord] = useState<string | null>(null);

  // Filters
  const [statusFilter, setStatusFilter] = useState<CheckRecordStatus | ''>('');
  const [searchTerm, setSearchTerm] = useState('');
  const [page, setPage] = useState(0);
  const limit = 20;

  // Load records
  useEffect(() => {
    async function loadRecords() {
      setIsLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams();
        params.set('limit', limit.toString());
        params.set('offset', (page * limit).toString());
        if (statusFilter) params.set('status', statusFilter);

        const response = await fetch(`/api/fleet/check-in/records?${params}`);
        const data = await response.json();

        if (!response.ok) throw new Error(data.error || 'Failed to load records');

        // API wraps response in { success, data, meta } - extract the inner data
        const result = (data.data || data) as CheckInHistoryResponse;
        setRecords(result.records || []);
        setTotal(result.total || 0);

        // Auto-expand if recordId in query
        if (recordId && typeof recordId === 'string') {
          setExpandedRecord(recordId);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load records');
      } finally {
        setIsLoading(false);
      }
    }

    loadRecords();
  }, [page, statusFilter, recordId]);

  // Handle approval
  const handleApprove = async (id: string, approve: boolean) => {
    if (!currentUser?.id) {
      setError('You must be logged in to approve records');
      return;
    }

    try {
      const response = await fetch(`/api/fleet/check-in/records/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: approve ? 'approved' : 'rejected',
          approvedBy: currentUser.id,
        }),
      });

      if (!response.ok) throw new Error('Failed to update status');

      // Refresh records
      setRecords(prev => prev.map(r =>
        r.id === id ? { ...r, status: approve ? 'approved' : 'rejected' } : r
      ));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update status');
    }
  };

  // Filter records by search term
  const filteredRecords = records.filter(r =>
    r.vehicle.registration.toLowerCase().includes(searchTerm.toLowerCase()) ||
    r.driverName.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const getStatusBadge = (record: CheckRecordWithDetails) => {
    if (record.hasCriticalIssues) {
      return (
        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">
          <XCircle className="w-3 h-3 mr-1" />
          Critical Issues
        </span>
      );
    }
    if (record.hasMinorIssues) {
      return (
        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
          <AlertTriangle className="w-3 h-3 mr-1" />
          Minor Issues
        </span>
      );
    }
    return (
      <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
        <CheckCircle className="w-3 h-3 mr-1" />
        All Passed
      </span>
    );
  };

  const getApprovalBadge = (status: CheckRecordStatus) => {
    switch (status) {
      case 'approved':
        return (
          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
            Approved
          </span>
        );
      case 'rejected':
        return (
          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">
            Rejected
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400">
            <Clock className="w-3 h-3 mr-1" />
            Pending
          </span>
        );
    }
  };

  return (
    <AppLayout>
      <Head>
        <title>Check-In History | FibreFlow</title>
      </Head>

      <div className="p-6">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            Check-In History
          </h1>
          <p className="text-gray-600 dark:text-gray-400 mt-1">
            View and manage vehicle check-in records
          </p>
        </div>

        {/* Filters */}
        <div className="mb-6 flex flex-wrap gap-4">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search by vehicle or driver..."
              className="w-full pl-10 pr-4 py-2 border border-gray-600 rounded-lg bg-[#1a1d23] text-white hover:border-gray-500"
            />
          </div>
          <div className="relative">
            <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as CheckRecordStatus | '')}
              className="pl-10 pr-8 py-2 border border-gray-600 rounded-lg bg-[#1a1d23] text-white hover:border-gray-500 appearance-none"
            >
              <option value="">All Status</option>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
            </select>
          </div>
        </div>

        {/* Error message */}
        {error && (
          <div className="mb-4 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
            <p className="text-red-700 dark:text-red-400">{error}</p>
          </div>
        )}

        {/* Records list */}
        {isLoading ? (
          <div className="flex items-center justify-center p-8">
            <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
          </div>
        ) : filteredRecords.length === 0 ? (
          <div className="text-center py-8 text-gray-500 dark:text-gray-400">
            No check-in records found
          </div>
        ) : (
          <div className="space-y-4">
            {filteredRecords.map((record) => (
              <div
                key={record.id}
                className="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-lg overflow-hidden"
              >
                {/* Record header */}
                <div
                  className="p-4 flex items-center gap-4 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50"
                  onClick={() => setExpandedRecord(expandedRecord === record.id ? null : record.id)}
                >
                  {expandedRecord === record.id ? (
                    <ChevronDown className="w-5 h-5 text-gray-400" />
                  ) : (
                    <ChevronRight className="w-5 h-5 text-gray-400" />
                  )}

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className="font-semibold text-gray-900 dark:text-white">
                        {record.vehicle.registration}
                      </span>
                      {getStatusBadge(record)}
                      {getApprovalBadge(record.status)}
                    </div>
                    <div className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                      {record.driverName} • {new Date(record.checkDate).toLocaleDateString()} at {record.checkTime.substring(0, 5)}
                    </div>
                  </div>

                  {/* Quick actions */}
                  {record.status === 'pending' && (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={(e) => { e.stopPropagation(); handleApprove(record.id, true); }}
                        className="p-2 rounded-lg bg-green-100 text-green-600 hover:bg-green-200 dark:bg-green-900/30 dark:text-green-400"
                        title="Approve"
                      >
                        <ThumbsUp className="w-4 h-4" />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleApprove(record.id, false); }}
                        className="p-2 rounded-lg bg-red-100 text-red-600 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-400"
                        title="Reject"
                      >
                        <ThumbsDown className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </div>

                {/* Expanded details */}
                {expandedRecord === record.id && (
                  <div className="border-t dark:border-gray-700 p-4 bg-gray-50 dark:bg-gray-900/50">
                    {/* Responses */}
                    <h4 className="font-medium text-gray-900 dark:text-white mb-3">
                      Checklist Results
                    </h4>
                    <div className="grid gap-2 mb-4">
                      {record.responses.map((response) => (
                        <div
                          key={response.id}
                          className="flex items-center gap-3 p-2 rounded-lg bg-white dark:bg-gray-800"
                        >
                          {response.isPassed ? (
                            <CheckCircle className="w-5 h-5 text-green-500" />
                          ) : response.item.isCritical ? (
                            <XCircle className="w-5 h-5 text-red-500" />
                          ) : (
                            <AlertTriangle className="w-5 h-5 text-amber-500" />
                          )}
                          <span className="flex-1 text-gray-900 dark:text-white">
                            {response.item.name}
                          </span>
                          {response.notes && (
                            <span className="text-sm text-gray-500 dark:text-gray-400">
                              {response.notes}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>

                    {/* Photos */}
                    {record.photos.length > 0 && (
                      <>
                        <h4 className="font-medium text-gray-900 dark:text-white mb-3">
                          Photos
                        </h4>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                          {record.photos.map((photo) => (
                            <div key={photo.id} className="relative aspect-video rounded-lg overflow-hidden bg-gray-200 dark:bg-gray-700">
                              <img
                                src={getPhotoUrl(photo.fileUrl)}
                                alt={photo.photoType}
                                className="w-full h-full object-cover"
                              />
                              <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent p-2">
                                <span className="text-white text-xs capitalize">
                                  {photo.photoType}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </>
                    )}

                    {/* Odometer */}
                    {record.odometerReading && (
                      <div className="mt-4 text-sm text-gray-600 dark:text-gray-400">
                        Odometer: {record.odometerReading.toLocaleString()} km
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Pagination */}
        {total > limit && (
          <div className="mt-6 flex items-center justify-between">
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Showing {page * limit + 1} to {Math.min((page + 1) * limit, total)} of {total}
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setPage(Math.max(0, page - 1))}
                disabled={page === 0}
                className="px-4 py-2 border rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                Previous
              </button>
              <button
                onClick={() => setPage(page + 1)}
                disabled={(page + 1) * limit >= total}
                className="px-4 py-2 border rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}

export async function getServerSideProps() {
  return { props: {} };
}
