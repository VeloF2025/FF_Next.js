/**
 * Fleet Check-In History Page
 * View, approve, and audit check-in records with VLM results
 */

import React, { useState, useEffect, useCallback } from 'react';
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
  ThumbsUp,
  ThumbsDown,
  RefreshCw,
  Calendar,
  Car,
  User,
  Gauge,
  Fuel,
  Eye,
  Activity,
  Trash2,
} from 'lucide-react';
import { AppLayout } from '@/components/layout';
import toast from 'react-hot-toast';

interface VlmResult {
  id: string;
  analysisType: string;
  extractedValue: string | null;
  extractedNumeric: number | null;
  confidence: number;
  status: string;
  error: string | null;
  rawResponse: string | null;
  verified: boolean;
  overrideValue: string | null;
  createdAt: string;
}

interface OdometerHistory {
  reading: number;
  previousReading: number | null;
  kmSinceLast: number | null;
  discrepancyFlag: boolean;
  discrepancyReason: string | null;
  vlmConfidence: number;
  source: string;
  recordedAt: string;
}

interface FuelHistory {
  fuelLevel: number;
  previousLevel: number | null;
  levelChange: number | null;
  vlmConfidence: number | null;
  source: string;
  recordedAt: string;
}

interface CheckPhoto {
  id: string;
  photoType: string;
  fileUrl: string;
  latitude: number | null;
  longitude: number | null;
  capturedAt: string | null;
}

interface CheckRecord {
  id: string;
  vehicle_id: string;
  registration: string;
  make: string | null;
  model: string | null;
  driver_id: string | null;
  driver_name: string | null;
  check_type: string;
  check_date: string;
  check_time: string | null;
  odometer_reading: number | null;
  status: string;
  has_critical_issues: boolean;
  has_minor_issues: boolean;
  approved_by: string | null;
  approved_at: string | null;
  approval_notes: string | null;
  created_at: string;
  vlm_results: VlmResult[] | null;
  odometer_history: OdometerHistory | null;
  fuel_history: FuelHistory | null;
  photos: CheckPhoto[] | null;
}

interface Stats {
  total_records: number;
  completed: number;
  in_progress: number;
  with_critical_issues: number;
  with_minor_issues: number;
}

interface DiscrepancyStats {
  total_discrepancies: number;
  digit_confusion: number;
  rollback: number;
  excessive_km: number;
}

function getPhotoUrl(url: string): string {
  if (!url) return '';
  if (url.startsWith('/storage/')) return url;
  if (url.startsWith('/uploads/')) return `/api${url}`;
  return url;
}

export default function CheckInHistoryPage() {
  const router = useRouter();
  const { currentUser } = useAuth();
  const { recordId } = router.query;

  const [records, setRecords] = useState<CheckRecord[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [discrepancyStats, setDiscrepancyStats] = useState<DiscrepancyStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Filters
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [showDiscrepanciesOnly, setShowDiscrepanciesOnly] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  // Pagination
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: '50',
      });

      if (dateFrom) params.set('dateFrom', dateFrom);
      if (dateTo) params.set('dateTo', dateTo);
      if (statusFilter !== 'all') params.set('status', statusFilter);
      if (showDiscrepanciesOnly) params.set('hasDiscrepancy', 'true');

      const res = await fetch(`/api/fleet/check-in/audit?${params}`);
      const data = await res.json();

      if (data.success) {
        setRecords(data.data.records);
        setStats(data.data.stats);
        setDiscrepancyStats(data.data.discrepancyStats);
        setTotalPages(data.data.pagination.totalPages);

        // Auto-expand if recordId in query
        if (recordId && typeof recordId === 'string') {
          setExpandedId(recordId);
        }
      } else {
        toast.error(data.error || 'Failed to fetch data');
      }
    } catch (err) {
      toast.error('Failed to fetch data');
    } finally {
      setLoading(false);
    }
  }, [page, dateFrom, dateTo, statusFilter, showDiscrepanciesOnly, recordId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Handle approval
  const handleApprove = async (id: string, approve: boolean) => {
    if (!currentUser?.id) {
      toast.error('You must be logged in to approve records');
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

      toast.success(approve ? 'Approved' : 'Rejected');
      // Refresh data
      fetchData();
    } catch (err) {
      toast.error('Failed to update status');
    }
  };

  // Handle delete (admin only)
  const handleDelete = async (id: string, registration: string) => {
    if (!confirm(`Delete check-in for ${registration}? This cannot be undone.`)) {
      return;
    }

    try {
      const response = await fetch(`/api/fleet/check-in/records/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error?.message || 'Failed to delete');
      }

      toast.success('Check-in deleted');
      fetchData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete');
    }
  };

  const isAdmin = currentUser?.role === 'admin' || currentUser?.role === 'super_admin';

  // Filter records by search term
  const filteredRecords = records.filter((r) => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    return (
      r.registration?.toLowerCase().includes(term) ||
      r.driver_name?.toLowerCase().includes(term) ||
      r.id.toLowerCase().includes(term)
    );
  });

  const getStatusBadge = (record: CheckRecord) => {
    if (record.has_critical_issues) {
      return (
        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">
          <XCircle className="w-3 h-3 mr-1" />
          Critical
        </span>
      );
    }
    if (record.has_minor_issues) {
      return (
        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
          <AlertTriangle className="w-3 h-3 mr-1" />
          Review
        </span>
      );
    }
    return (
      <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
        <CheckCircle className="w-3 h-3 mr-1" />
        Passed
      </span>
    );
  };

  const getApprovalBadge = (status: string) => {
    switch (status) {
      case 'approved':
        return (
          <span className="px-2 py-1 text-xs font-medium bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 rounded-full">
            Approved
          </span>
        );
      case 'rejected':
        return (
          <span className="px-2 py-1 text-xs font-medium bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 rounded-full">
            Rejected
          </span>
        );
      default:
        return (
          <span className="px-2 py-1 text-xs font-medium bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400 rounded-full flex items-center gap-1">
            <Clock className="w-3 h-3" />
            Pending
          </span>
        );
    }
  };

  const getConfidenceBadge = (confidence: number) => {
    const pct = Math.round(confidence * 100);
    if (pct >= 80) {
      return <span className="text-green-600 dark:text-green-400 font-medium">{pct}%</span>;
    } else if (pct >= 50) {
      return <span className="text-yellow-600 dark:text-yellow-400 font-medium">{pct}%</span>;
    }
    return <span className="text-red-600 dark:text-red-400 font-medium">{pct}%</span>;
  };

  return (
    <>
      <Head>
        <title>Check-Ins | Fleet | FibreFlow</title>
      </Head>

      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
              Vehicle Check-Ins
            </h1>
            <p className="text-gray-500 dark:text-gray-400 mt-1">
              Review, approve, and audit check-in records
            </p>
          </div>
          <button
            onClick={fetchData}
            disabled={loading}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium flex items-center gap-2 disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow-sm border border-gray-200 dark:border-gray-700">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
                <Car className="w-5 h-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900 dark:text-white">
                  {stats?.total_records || 0}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400">Total</p>
              </div>
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow-sm border border-gray-200 dark:border-gray-700">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-amber-100 dark:bg-amber-900/30 rounded-lg">
                <Clock className="w-5 h-5 text-amber-600 dark:text-amber-400" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900 dark:text-white">
                  {stats?.in_progress || 0}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400">Pending</p>
              </div>
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow-sm border border-gray-200 dark:border-gray-700">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-red-100 dark:bg-red-900/30 rounded-lg">
                <XCircle className="w-5 h-5 text-red-600 dark:text-red-400" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900 dark:text-white">
                  {stats?.with_critical_issues || 0}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400">Critical</p>
              </div>
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow-sm border border-gray-200 dark:border-gray-700">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-orange-100 dark:bg-orange-900/30 rounded-lg">
                <AlertTriangle className="w-5 h-5 text-orange-600 dark:text-orange-400" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900 dark:text-white">
                  {discrepancyStats?.total_discrepancies || 0}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400">Discrepancies</p>
              </div>
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow-sm border border-gray-200 dark:border-gray-700">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-purple-100 dark:bg-purple-900/30 rounded-lg">
                <Activity className="w-5 h-5 text-purple-600 dark:text-purple-400" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900 dark:text-white">
                  {discrepancyStats?.excessive_km || 0}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400">Excess KM</p>
              </div>
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow-sm border border-gray-200 dark:border-gray-700">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-100 dark:bg-green-900/30 rounded-lg">
                <CheckCircle className="w-5 h-5 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900 dark:text-white">
                  {stats?.completed || 0}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400">Completed</p>
              </div>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow-sm border border-gray-200 dark:border-gray-700">
          <div className="flex flex-wrap items-center gap-4">
            {/* Search */}
            <div className="flex-1 min-w-[200px]">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search by registration, driver..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-900 text-sm"
                />
              </div>
            </div>

            {/* Date filters */}
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-gray-400" />
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="px-3 py-2 border border-gray-600 rounded-lg bg-[#1a1d23] text-white text-sm hover:border-gray-500"
              />
              <span className="text-gray-400">to</span>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="px-3 py-2 border border-gray-600 rounded-lg bg-[#1a1d23] text-white text-sm hover:border-gray-500"
              />
            </div>

            {/* Status filter */}
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-2 border border-gray-600 rounded-lg bg-[#1a1d23] text-white text-sm hover:border-gray-500"
            >
              <option value="all">All Status</option>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
            </select>

            {/* Discrepancy toggle */}
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={showDiscrepanciesOnly}
                onChange={(e) => setShowDiscrepanciesOnly(e.target.checked)}
                className="w-4 h-4 rounded border-gray-300 text-red-600 focus:ring-red-500"
              />
              <span className="text-sm text-gray-700 dark:text-gray-300">
                Discrepancies only
              </span>
            </label>
          </div>
        </div>

        {/* Records Table */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
              <tr>
                <th className="w-8 px-4 py-3"></th>
                <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-gray-400">
                  Vehicle
                </th>
                <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-gray-400">
                  Driver
                </th>
                <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-gray-400">
                  Date
                </th>
                <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-gray-400">
                  Odometer
                </th>
                <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-gray-400">
                  Fuel
                </th>
                <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-gray-400">
                  Status
                </th>
                <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-gray-400">
                  Approval
                </th>
                <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-gray-400">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {loading ? (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-gray-500">
                    <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
                    Loading...
                  </td>
                </tr>
              ) : filteredRecords.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-gray-500">
                    No records found
                  </td>
                </tr>
              ) : (
                filteredRecords.map((record) => (
                  <React.Fragment key={record.id}>
                    <tr
                      className={`hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer ${
                        record.odometer_history?.discrepancyFlag
                          ? 'bg-red-50/50 dark:bg-red-900/10'
                          : ''
                      }`}
                      onClick={() =>
                        setExpandedId(expandedId === record.id ? null : record.id)
                      }
                    >
                      <td className="px-4 py-3">
                        {expandedId === record.id ? (
                          <ChevronDown className="w-4 h-4 text-gray-400" />
                        ) : (
                          <ChevronRight className="w-4 h-4 text-gray-400" />
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Car className="w-4 h-4 text-gray-400" />
                          <span className="font-medium text-gray-900 dark:text-white">
                            {record.registration}
                          </span>
                        </div>
                        {record.make && (
                          <p className="text-xs text-gray-500 mt-0.5">
                            {record.make} {record.model}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <User className="w-4 h-4 text-gray-400" />
                          <span className="text-gray-700 dark:text-gray-300">
                            {record.driver_name || '-'}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                        {new Date(record.check_date).toLocaleDateString('en-ZA')}
                        {record.check_time && (
                          <span className="text-xs ml-1">
                            {record.check_time.substring(0, 5)}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {record.odometer_reading ? (
                          <div className="flex items-center gap-2">
                            <Gauge className="w-4 h-4 text-gray-400" />
                            <span className="font-mono text-gray-900 dark:text-white">
                              {record.odometer_reading.toLocaleString()} km
                            </span>
                            {record.odometer_history?.discrepancyFlag && (
                              <AlertTriangle className="w-4 h-4 text-red-500" />
                            )}
                          </div>
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {record.fuel_history?.fuelLevel !== undefined ? (
                          <div className="flex items-center gap-2">
                            <Fuel className="w-4 h-4 text-gray-400" />
                            <span className="font-mono text-gray-900 dark:text-white">
                              {record.fuel_history.fuelLevel}%
                            </span>
                            {record.fuel_history.levelChange !== null && record.fuel_history.levelChange !== 0 && (
                              <span className={`text-xs ${record.fuel_history.levelChange > 0 ? 'text-green-500' : 'text-amber-500'}`}>
                                {record.fuel_history.levelChange > 0 ? '+' : ''}{record.fuel_history.levelChange}%
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </td>
                      <td className="px-4 py-3">{getStatusBadge(record)}</td>
                      <td className="px-4 py-3">{getApprovalBadge(record.status)}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                          {record.status === 'pending' && (
                            <>
                              <button
                                onClick={() => handleApprove(record.id, true)}
                                className="p-1.5 rounded-lg bg-green-100 text-green-600 hover:bg-green-200 dark:bg-green-900/30 dark:text-green-400"
                                title="Approve"
                              >
                                <ThumbsUp className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => handleApprove(record.id, false)}
                                className="p-1.5 rounded-lg bg-red-100 text-red-600 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-400"
                                title="Reject"
                              >
                                <ThumbsDown className="w-4 h-4" />
                              </button>
                            </>
                          )}
                          {isAdmin && (
                            <button
                              onClick={() => handleDelete(record.id, record.registration)}
                              className="p-1.5 rounded-lg bg-gray-100 text-gray-600 hover:bg-red-100 hover:text-red-600 dark:bg-gray-700 dark:text-gray-400 dark:hover:bg-red-900/30 dark:hover:text-red-400"
                              title="Delete"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {/* Expanded details */}
                    {expandedId === record.id && (
                      <tr className="bg-gray-50 dark:bg-gray-900/50">
                        <td colSpan={9} className="px-4 py-4">
                          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                            {/* Odometer Details */}
                            {record.odometer_history && (
                              <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
                                <h4 className="font-medium text-gray-900 dark:text-white mb-3 flex items-center gap-2">
                                  <Gauge className="w-4 h-4" />
                                  Odometer Details
                                </h4>
                                <div className="space-y-2 text-sm">
                                  <div className="flex justify-between">
                                    <span className="text-gray-500">Reading:</span>
                                    <span className="font-mono font-medium">
                                      {record.odometer_history.reading.toLocaleString()} km
                                    </span>
                                  </div>
                                  <div className="flex justify-between">
                                    <span className="text-gray-500">Previous:</span>
                                    <span className="font-mono">
                                      {record.odometer_history.previousReading?.toLocaleString() || '-'} km
                                    </span>
                                  </div>
                                  <div className="flex justify-between">
                                    <span className="text-gray-500">KM Since Last:</span>
                                    <span className={`font-mono ${
                                      record.odometer_history.kmSinceLast && record.odometer_history.kmSinceLast > 1000
                                        ? 'text-red-600 font-medium'
                                        : ''
                                    }`}>
                                      {record.odometer_history.kmSinceLast?.toLocaleString() || '-'} km
                                    </span>
                                  </div>
                                  <div className="flex justify-between">
                                    <span className="text-gray-500">VLM Confidence:</span>
                                    {getConfidenceBadge(record.odometer_history.vlmConfidence || 0)}
                                  </div>
                                  <div className="flex justify-between">
                                    <span className="text-gray-500">Source:</span>
                                    <span className="uppercase text-xs">
                                      {record.odometer_history.source}
                                    </span>
                                  </div>
                                  {record.odometer_history.discrepancyFlag && (
                                    <div className="mt-3 p-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded">
                                      <div className="flex items-start gap-2">
                                        <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                                        <div>
                                          <p className="font-medium text-red-700 dark:text-red-300 text-xs">
                                            Discrepancy Detected
                                          </p>
                                          <p className="text-xs text-red-600 dark:text-red-400 mt-1">
                                            {record.odometer_history.discrepancyReason}
                                          </p>
                                        </div>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </div>
                            )}

                            {/* VLM Results */}
                            {record.vlm_results && record.vlm_results.length > 0 && (
                              <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
                                <h4 className="font-medium text-gray-900 dark:text-white mb-3 flex items-center gap-2">
                                  <Eye className="w-4 h-4" />
                                  VLM Extraction Results
                                </h4>
                                <div className="space-y-3">
                                  {record.vlm_results.map((vlm) => (
                                    <div
                                      key={vlm.id}
                                      className="p-2 bg-gray-50 dark:bg-gray-900 rounded border border-gray-200 dark:border-gray-700"
                                    >
                                      <div className="flex justify-between items-start">
                                        <span className="text-xs font-medium text-gray-600 dark:text-gray-400 uppercase">
                                          {vlm.analysisType.replace('_', ' ')}
                                        </span>
                                        {getConfidenceBadge(vlm.confidence)}
                                      </div>
                                      <p className="font-mono text-sm mt-1 text-gray-900 dark:text-white">
                                        {vlm.extractedNumeric?.toLocaleString() || vlm.extractedValue || '-'}
                                      </p>
                                      {vlm.error && (
                                        <p className="text-xs text-red-600 dark:text-red-400 mt-1">
                                          ⚠️ {vlm.error}
                                        </p>
                                      )}
                                      {vlm.overrideValue && (
                                        <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">
                                          Override: {vlm.overrideValue}
                                        </p>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>

                          {/* Check-In Photos */}
                          {record.photos && record.photos.length > 0 && (
                            <div className="mt-4 bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
                              <h4 className="font-medium text-gray-900 dark:text-white mb-3 flex items-center gap-2">
                                <Eye className="w-4 h-4" />
                                Check-In Photos ({record.photos.length})
                              </h4>
                              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                {record.photos.map((photo) => (
                                  <div key={photo.id} className="relative aspect-video rounded-lg overflow-hidden bg-gray-200 dark:bg-gray-700 group">
                                    <img
                                      src={getPhotoUrl(photo.fileUrl)}
                                      alt={photo.photoType}
                                      className="w-full h-full object-cover"
                                      loading="lazy"
                                    />
                                    <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent p-2">
                                      <span className="text-white text-xs capitalize">
                                        {photo.photoType.replace('_', ' ')}
                                      </span>
                                    </div>
                                    {/* GPS indicator */}
                                    {photo.latitude && photo.longitude && (
                                      <div className="absolute top-2 right-2 bg-blue-500/80 rounded-full p-1" title={`${photo.latitude.toFixed(4)}, ${photo.longitude.toFixed(4)}`}>
                                        <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                                          <path fillRule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" />
                                        </svg>
                                      </div>
                                    )}
                                    {/* Click to enlarge */}
                                    <a
                                      href={getPhotoUrl(photo.fileUrl)}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity"
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      <span className="text-white text-xs font-medium">View full size</span>
                                    </a>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-500">
              Page {page} of {totalPages}
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1 border rounded-lg text-sm disabled:opacity-50"
              >
                Previous
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="px-3 py-1 border rounded-lg text-sm disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

CheckInHistoryPage.getLayout = (page: React.ReactElement) => <AppLayout>{page}</AppLayout>;
