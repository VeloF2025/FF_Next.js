/**
 * Fleet Check-In Audit Trail Page
 * Admin view for reviewing check-in records, VLM extractions, and discrepancies
 */

import React, { useState, useEffect, useCallback } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { AppLayout } from '@/components/layout';
import {
  ClipboardList,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Search,
  Filter,
  ChevronDown,
  ChevronRight,
  Eye,
  RefreshCw,
  Calendar,
  Car,
  User,
  Gauge,
  AlertCircle,
  Clock,
  FileText,
  Activity,
} from 'lucide-react';
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

interface AuditRecord {
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
  updated_at: string;
  vlm_results: VlmResult[] | null;
  odometer_history: OdometerHistory | null;
}

interface AuditStats {
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

export default function CheckInAuditPage() {
  const router = useRouter();
  const [records, setRecords] = useState<AuditRecord[]>([]);
  const [stats, setStats] = useState<AuditStats | null>(null);
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

  const fetchAuditData = useCallback(async () => {
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
      } else {
        toast.error(data.error || 'Failed to fetch audit data');
      }
    } catch (err) {
      toast.error('Failed to fetch audit data');
    } finally {
      setLoading(false);
    }
  }, [page, dateFrom, dateTo, statusFilter, showDiscrepanciesOnly]);

  useEffect(() => {
    fetchAuditData();
  }, [fetchAuditData]);

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

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return (
          <span className="px-2 py-1 text-xs font-medium bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 rounded-full flex items-center gap-1">
            <CheckCircle className="w-3 h-3" />
            Completed
          </span>
        );
      case 'in_progress':
        return (
          <span className="px-2 py-1 text-xs font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 rounded-full flex items-center gap-1">
            <Clock className="w-3 h-3" />
            In Progress
          </span>
        );
      default:
        return (
          <span className="px-2 py-1 text-xs font-medium bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300 rounded-full">
            {status}
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
        <title>Check-In Audit Trail | Fleet | FibreFlow</title>
      </Head>

      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-3">
              <ClipboardList className="w-7 h-7 text-blue-600" />
              Check-In Audit Trail
            </h1>
            <p className="text-gray-500 dark:text-gray-400 mt-1">
              Review check-in records, VLM extractions, and discrepancies
            </p>
          </div>
          <button
            onClick={fetchAuditData}
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
                <FileText className="w-5 h-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900 dark:text-white">
                  {stats?.total_records || 0}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400">Total Records</p>
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

          <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow-sm border border-gray-200 dark:border-gray-700">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-red-100 dark:bg-red-900/30 rounded-lg">
                <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400" />
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
              <div className="p-2 bg-amber-100 dark:bg-amber-900/30 rounded-lg">
                <AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-400" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900 dark:text-white">
                  {discrepancyStats?.digit_confusion || 0}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400">Digit Confusion</p>
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
                <p className="text-xs text-gray-500 dark:text-gray-400">Excessive KM</p>
              </div>
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow-sm border border-gray-200 dark:border-gray-700">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-orange-100 dark:bg-orange-900/30 rounded-lg">
                <XCircle className="w-5 h-5 text-orange-600 dark:text-orange-400" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900 dark:text-white">
                  {discrepancyStats?.rollback || 0}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400">Rollbacks</p>
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
              <option value="completed">Completed</option>
              <option value="in_progress">In Progress</option>
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
                  Type
                </th>
                <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-gray-400">
                  Date
                </th>
                <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-gray-400">
                  Odometer
                </th>
                <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-gray-400">
                  Status
                </th>
                <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-gray-400">
                  Issues
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-gray-500">
                    <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2" />
                    Loading audit data...
                  </td>
                </tr>
              ) : filteredRecords.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-gray-500">
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
                      <td className="px-4 py-3">
                        <span className="capitalize text-gray-700 dark:text-gray-300">
                          {record.check_type?.replace('_', ' ') || '-'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                        {new Date(record.check_date).toLocaleDateString('en-ZA')}
                      </td>
                      <td className="px-4 py-3">
                        {record.odometer_reading ? (
                          <div className="flex items-center gap-2">
                            <Gauge className="w-4 h-4 text-gray-400" />
                            <span className="font-mono text-gray-900 dark:text-white">
                              {record.odometer_reading.toLocaleString()} km
                            </span>
                          </div>
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </td>
                      <td className="px-4 py-3">{getStatusBadge(record.status)}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {record.has_critical_issues && (
                            <span className="px-2 py-0.5 text-xs bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 rounded">
                              Critical
                            </span>
                          )}
                          {record.has_minor_issues && (
                            <span className="px-2 py-0.5 text-xs bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400 rounded">
                              Minor
                            </span>
                          )}
                          {record.odometer_history?.discrepancyFlag && (
                            <span className="px-2 py-0.5 text-xs bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 rounded flex items-center gap-1">
                              <AlertTriangle className="w-3 h-3" />
                              Discrepancy
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                    {/* Expanded details */}
                    {expandedId === record.id && (
                      <tr className="bg-gray-50 dark:bg-gray-900/50">
                        <td colSpan={8} className="px-4 py-4">
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
                                      {vlm.rawResponse && (
                                        <details className="mt-2">
                                          <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-700">
                                            Raw VLM Response
                                          </summary>
                                          <pre className="mt-1 p-2 bg-gray-100 dark:bg-gray-800 rounded text-xs overflow-auto max-h-32">
                                            {vlm.rawResponse}
                                          </pre>
                                        </details>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
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

CheckInAuditPage.getLayout = (page: React.ReactElement) => <AppLayout>{page}</AppLayout>;
