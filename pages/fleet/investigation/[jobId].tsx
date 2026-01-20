/**
 * Fleet GPS Investigation Detail Page
 * View analysis results and trip details for a specific investigation
 */

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import { AppLayout } from '@/components/layout/AppLayout';
import Link from 'next/link';
import {
  ArrowLeft,
  Car,
  Calendar,
  FileSpreadsheet,
  MapPin,
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  TrendingUp,
  DollarSign,
  Filter,
  ChevronLeft,
  ChevronRight,
  Moon,
  Sun,
  Briefcase,
  Home,
  Navigation,
} from 'lucide-react';

// ============================================================================
// Types
// ============================================================================

interface InvestigationJob {
  id: string;
  vehicleId: string;
  vehicleRegistration: string;
  vehicleMake: string | null;
  vehicleModel: string | null;
  fileName: string;
  fileSize: number | null;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress: number;
  errorMessage: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  totalGpsPoints: number | null;
  reportUrl: string | null;
  createdAt: string;
  completedAt: string | null;
  // Summary data
  totalTrips: number | null;
  authorizedTrips: number | null;
  unauthorizedTrips: number | null;
  totalKm: number | null;
  authorizedKm: number | null;
  unauthorizedKm: number | null;
  weekendTrips: number | null;
  afterHoursTrips: number | null;
  workHoursViolations: number | null;
  suspiciousPoiVisits: number | null;
  unauthorizedNights: number | null;
  totalCost: number | null;
  unauthorizedCost: number | null;
  // Pattern counts
  patterns: {
    weekend: number;
    afterHours: number;
    nightTravel: number;
    workViolations: number;
  };
}

interface Trip {
  id: string;
  tripNumber: number;
  startTime: string;
  endTime: string;
  startLat: number;
  startLon: number;
  endLat: number;
  endLon: number;
  startLocation: string | null;
  endLocation: string | null;
  distanceKm: number;
  classification: 'AUTHORIZED' | 'UNAUTHORIZED';
  timeCategory: 'WORK_HOURS' | 'AFTER_HOURS' | 'NIGHT_TRAVEL';
  dayType: 'WEEKDAY' | 'WEEKEND';
  isWorkHoursViolation: boolean;
  nearestAuthLocation: string | null;
  distanceFromAuthKm: number | null;
}

type ClassificationFilter = '' | 'AUTHORIZED' | 'UNAUTHORIZED';
type DayTypeFilter = '' | 'WEEKDAY' | 'WEEKEND';
type TimeCategoryFilter = '' | 'WORK_HOURS' | 'AFTER_HOURS' | 'NIGHT_TRAVEL';

const statusConfig = {
  pending: { label: 'Pending', bgColor: 'bg-gray-500/20', textColor: 'text-gray-400', icon: Clock },
  processing: { label: 'Processing', bgColor: 'bg-yellow-500/20', textColor: 'text-yellow-400', icon: Clock },
  completed: { label: 'Completed', bgColor: 'bg-green-500/20', textColor: 'text-green-400', icon: CheckCircle2 },
  failed: { label: 'Failed', bgColor: 'bg-red-500/20', textColor: 'text-red-400', icon: XCircle },
};

const classificationConfig = {
  AUTHORIZED: { label: 'Authorized', bgColor: 'bg-green-500/20', textColor: 'text-green-400', icon: CheckCircle2 },
  UNAUTHORIZED: { label: 'Unauthorized', bgColor: 'bg-red-500/20', textColor: 'text-red-400', icon: AlertTriangle },
};

const timeCategoryConfig = {
  WORK_HOURS: { label: 'Work Hours', icon: Briefcase, color: 'text-blue-400' },
  AFTER_HOURS: { label: 'After Hours', icon: Sun, color: 'text-orange-400' },
  NIGHT_TRAVEL: { label: 'Night Travel', icon: Moon, color: 'text-purple-400' },
};

// ============================================================================
// Component
// ============================================================================

export default function InvestigationDetailPage() {
  const router = useRouter();
  const { jobId } = router.query;

  const [job, setJob] = useState<InvestigationJob | null>(null);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [loading, setLoading] = useState(true);
  const [tripsLoading, setTripsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [classificationFilter, setClassificationFilter] = useState<ClassificationFilter>('');
  const [dayTypeFilter, setDayTypeFilter] = useState<DayTypeFilter>('');
  const [timeCategoryFilter, setTimeCategoryFilter] = useState<TimeCategoryFilter>('');

  // Pagination
  const [page, setPage] = useState(1);
  const [totalTrips, setTotalTrips] = useState(0);
  const pageSize = 25;

  // Fetch job details
  useEffect(() => {
    if (!jobId || typeof jobId !== 'string') return;

    const fetchJob = async () => {
      try {
        setLoading(true);
        const res = await fetch(`/api/fleet/investigation/${jobId}`);
        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error?.message || 'Failed to load investigation');
        }

        setJob(data.data);
        setError(null);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Failed to load investigation';
        setError(message);
      } finally {
        setLoading(false);
      }
    };

    fetchJob();
  }, [jobId]);

  // Fetch trips with filters
  const fetchTrips = useCallback(async () => {
    if (!jobId || typeof jobId !== 'string') return;

    try {
      setTripsLoading(true);
      const params = new URLSearchParams();
      params.append('page', String(page));
      params.append('limit', String(pageSize));
      if (classificationFilter) params.append('classification', classificationFilter);
      if (dayTypeFilter) params.append('dayType', dayTypeFilter);
      if (timeCategoryFilter) params.append('timeCategory', timeCategoryFilter);

      const res = await fetch(`/api/fleet/investigation/${jobId}/trips?${params.toString()}`);
      const data = await res.json();

      if (res.ok) {
        setTrips(data.data || []);
        setTotalTrips(data.pagination?.total || 0);
      }
    } catch {
      // Silent fail for trips
    } finally {
      setTripsLoading(false);
    }
  }, [jobId, page, classificationFilter, dayTypeFilter, timeCategoryFilter]);

  useEffect(() => {
    if (job?.status === 'completed') {
      fetchTrips();
    }
  }, [job?.status, fetchTrips]);

  // Reset page when filters change
  useEffect(() => {
    setPage(1);
  }, [classificationFilter, dayTypeFilter, timeCategoryFilter]);

  const totalPages = Math.ceil(totalTrips / pageSize);

  if (loading) {
    return (
      <AppLayout>
        <div className="p-6">
          <div className="animate-pulse space-y-6">
            <div className="h-8 bg-[var(--ff-bg-tertiary)] rounded w-1/4"></div>
            <div className="h-48 bg-[var(--ff-bg-tertiary)] rounded"></div>
            <div className="h-64 bg-[var(--ff-bg-tertiary)] rounded"></div>
          </div>
        </div>
      </AppLayout>
    );
  }

  if (error || !job) {
    return (
      <AppLayout>
        <div className="p-6">
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-6 text-center">
            <AlertTriangle className="w-12 h-12 text-red-400 mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-[var(--ff-text-primary)] mb-2">
              Investigation Not Found
            </h2>
            <p className="text-[var(--ff-text-secondary)] mb-4">
              {error || 'The investigation you are looking for does not exist.'}
            </p>
            <Link
              href="/fleet/investigation"
              className="inline-flex items-center gap-2 px-4 py-2 bg-[var(--ff-primary)] text-white rounded-lg hover:bg-[var(--ff-primary-dark)] transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              Back to Investigations
            </Link>
          </div>
        </div>
      </AppLayout>
    );
  }

  const status = statusConfig[job.status];
  const StatusIcon = status.icon;
  const unauthorizedPercentage = job.totalTrips && job.unauthorizedTrips
    ? Math.round((job.unauthorizedTrips / job.totalTrips) * 100)
    : 0;

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link
              href="/fleet/investigation"
              className="p-2 bg-[var(--ff-bg-secondary)] rounded-lg hover:bg-[var(--ff-bg-tertiary)] transition-colors"
            >
              <ArrowLeft className="w-5 h-5 text-[var(--ff-text-secondary)]" />
            </Link>
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">
                  Investigation: {job.vehicleRegistration}
                </h1>
                <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${status.bgColor} ${status.textColor}`}>
                  <StatusIcon className="w-3.5 h-3.5" />
                  {status.label}
                </span>
              </div>
              <p className="text-[var(--ff-text-secondary)] mt-1">
                {job.vehicleMake} {job.vehicleModel} &bull; {job.fileName}
              </p>
            </div>
          </div>
          <Link
            href={`/fleet/vehicles/${job.vehicleId}`}
            className="flex items-center gap-2 px-4 py-2 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg hover:bg-[var(--ff-bg-tertiary)] transition-colors text-[var(--ff-text-primary)]"
          >
            <Car className="w-4 h-4" />
            View Vehicle
          </Link>
        </div>

        {/* Job Info Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-500/20 rounded-lg">
                <Calendar className="w-5 h-5 text-blue-400" />
              </div>
              <div>
                <p className="text-sm text-[var(--ff-text-secondary)]">Period</p>
                <p className="font-medium text-[var(--ff-text-primary)]">
                  {job.periodStart && job.periodEnd
                    ? `${new Date(job.periodStart).toLocaleDateString()} - ${new Date(job.periodEnd).toLocaleDateString()}`
                    : 'Not determined'}
                </p>
              </div>
            </div>
          </div>

          <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-purple-500/20 rounded-lg">
                <MapPin className="w-5 h-5 text-purple-400" />
              </div>
              <div>
                <p className="text-sm text-[var(--ff-text-secondary)]">GPS Points</p>
                <p className="font-medium text-[var(--ff-text-primary)]">
                  {job.totalGpsPoints?.toLocaleString() || '0'}
                </p>
              </div>
            </div>
          </div>

          <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-500/20 rounded-lg">
                <Clock className="w-5 h-5 text-green-400" />
              </div>
              <div>
                <p className="text-sm text-[var(--ff-text-secondary)]">Created</p>
                <p className="font-medium text-[var(--ff-text-primary)]">
                  {new Date(job.createdAt).toLocaleDateString()}
                </p>
              </div>
            </div>
          </div>

          <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-orange-500/20 rounded-lg">
                <FileSpreadsheet className="w-5 h-5 text-orange-400" />
              </div>
              <div>
                <p className="text-sm text-[var(--ff-text-secondary)]">File Size</p>
                <p className="font-medium text-[var(--ff-text-primary)]">
                  {job.fileSize ? `${(job.fileSize / 1024).toFixed(1)} KB` : 'Unknown'}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Processing Status (if not completed) */}
        {job.status === 'processing' && (
          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-6">
            <div className="flex items-center gap-4">
              <div className="animate-spin rounded-full h-8 w-8 border-2 border-yellow-400 border-t-transparent"></div>
              <div className="flex-1">
                <p className="font-medium text-yellow-400">Processing GPS Data...</p>
                <div className="mt-2 h-2 bg-yellow-500/20 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-yellow-400 transition-all duration-500"
                    style={{ width: `${job.progress}%` }}
                  ></div>
                </div>
                <p className="text-sm text-yellow-400/70 mt-1">{job.progress}% complete</p>
              </div>
            </div>
          </div>
        )}

        {/* Failed Status */}
        {job.status === 'failed' && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-6">
            <div className="flex items-center gap-4">
              <XCircle className="w-8 h-8 text-red-400" />
              <div>
                <p className="font-medium text-red-400">Investigation Failed</p>
                <p className="text-sm text-red-400/70 mt-1">
                  {job.errorMessage || 'An unknown error occurred during processing.'}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Summary Section (completed only) */}
        {job.status === 'completed' && (
          <>
            {/* Summary Stats */}
            <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-6">
              <h2 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-4">
                Investigation Summary
              </h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                <div>
                  <p className="text-3xl font-bold text-[var(--ff-text-primary)]">
                    {job.totalTrips || 0}
                  </p>
                  <p className="text-sm text-[var(--ff-text-secondary)]">Total Trips</p>
                </div>
                <div>
                  <p className="text-3xl font-bold text-green-400">
                    {job.authorizedTrips || 0}
                  </p>
                  <p className="text-sm text-[var(--ff-text-secondary)]">Authorized</p>
                </div>
                <div>
                  <p className="text-3xl font-bold text-red-400">
                    {job.unauthorizedTrips || 0}
                  </p>
                  <p className="text-sm text-[var(--ff-text-secondary)]">Unauthorized</p>
                </div>
                <div>
                  <p className="text-3xl font-bold text-orange-400">
                    {unauthorizedPercentage}%
                  </p>
                  <p className="text-sm text-[var(--ff-text-secondary)]">Unauthorized Rate</p>
                </div>
              </div>

              {/* Distance & Cost */}
              <div className="mt-6 pt-6 border-t border-[var(--ff-border-light)] grid grid-cols-2 md:grid-cols-4 gap-6">
                <div>
                  <p className="text-xl font-semibold text-[var(--ff-text-primary)]">
                    {job.totalKm ? Number(job.totalKm).toFixed(1) : '0'} km
                  </p>
                  <p className="text-sm text-[var(--ff-text-secondary)]">Total Distance</p>
                </div>
                <div>
                  <p className="text-xl font-semibold text-red-400">
                    {job.unauthorizedKm ? Number(job.unauthorizedKm).toFixed(1) : '0'} km
                  </p>
                  <p className="text-sm text-[var(--ff-text-secondary)]">Unauthorized Distance</p>
                </div>
                <div>
                  <p className="text-xl font-semibold text-[var(--ff-text-primary)]">
                    R{job.totalCost ? Number(job.totalCost).toLocaleString() : '0'}
                  </p>
                  <p className="text-sm text-[var(--ff-text-secondary)]">Total Cost</p>
                </div>
                <div>
                  <p className="text-xl font-semibold text-red-400">
                    R{job.unauthorizedCost ? Number(job.unauthorizedCost).toLocaleString() : '0'}
                  </p>
                  <p className="text-sm text-[var(--ff-text-secondary)]">Unauthorized Cost</p>
                </div>
              </div>
            </div>

            {/* Pattern Analysis */}
            <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-6">
              <h2 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-4">
                Pattern Analysis
              </h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div
                  className="p-4 bg-[var(--ff-bg-tertiary)] rounded-lg cursor-pointer hover:ring-2 hover:ring-[var(--ff-primary)] transition-all"
                  onClick={() => {
                    setClassificationFilter('UNAUTHORIZED');
                    setDayTypeFilter('WEEKEND');
                    setTimeCategoryFilter('');
                  }}
                >
                  <div className="flex items-center gap-3 mb-2">
                    <Home className="w-5 h-5 text-blue-400" />
                    <span className="text-sm text-[var(--ff-text-secondary)]">Weekend Trips</span>
                  </div>
                  <p className="text-2xl font-bold text-[var(--ff-text-primary)]">
                    {job.patterns?.weekend || job.weekendTrips || 0}
                  </p>
                </div>

                <div
                  className="p-4 bg-[var(--ff-bg-tertiary)] rounded-lg cursor-pointer hover:ring-2 hover:ring-[var(--ff-primary)] transition-all"
                  onClick={() => {
                    setClassificationFilter('UNAUTHORIZED');
                    setDayTypeFilter('');
                    setTimeCategoryFilter('AFTER_HOURS');
                  }}
                >
                  <div className="flex items-center gap-3 mb-2">
                    <Sun className="w-5 h-5 text-orange-400" />
                    <span className="text-sm text-[var(--ff-text-secondary)]">After Hours</span>
                  </div>
                  <p className="text-2xl font-bold text-[var(--ff-text-primary)]">
                    {job.patterns?.afterHours || job.afterHoursTrips || 0}
                  </p>
                </div>

                <div
                  className="p-4 bg-[var(--ff-bg-tertiary)] rounded-lg cursor-pointer hover:ring-2 hover:ring-[var(--ff-primary)] transition-all"
                  onClick={() => {
                    setClassificationFilter('UNAUTHORIZED');
                    setDayTypeFilter('');
                    setTimeCategoryFilter('NIGHT_TRAVEL');
                  }}
                >
                  <div className="flex items-center gap-3 mb-2">
                    <Moon className="w-5 h-5 text-purple-400" />
                    <span className="text-sm text-[var(--ff-text-secondary)]">Night Travel</span>
                  </div>
                  <p className="text-2xl font-bold text-[var(--ff-text-primary)]">
                    {job.patterns?.nightTravel || 0}
                  </p>
                </div>

                <div
                  className="p-4 bg-[var(--ff-bg-tertiary)] rounded-lg cursor-pointer hover:ring-2 hover:ring-[var(--ff-primary)] transition-all"
                  onClick={() => {
                    setClassificationFilter('');
                    setDayTypeFilter('');
                    setTimeCategoryFilter('WORK_HOURS');
                  }}
                >
                  <div className="flex items-center gap-3 mb-2">
                    <AlertTriangle className="w-5 h-5 text-red-400" />
                    <span className="text-sm text-[var(--ff-text-secondary)]">Work Violations</span>
                  </div>
                  <p className="text-2xl font-bold text-[var(--ff-text-primary)]">
                    {job.patterns?.workViolations || job.workHoursViolations || 0}
                  </p>
                </div>
              </div>
            </div>

            {/* Trips Table */}
            <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)]">
              {/* Filters */}
              <div className="px-6 py-4 border-b border-[var(--ff-border-light)]">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <h2 className="text-lg font-semibold text-[var(--ff-text-primary)]">
                    Trip Details
                  </h2>
                  <div className="flex flex-wrap items-center gap-3">
                    <Filter className="w-4 h-4 text-[var(--ff-text-secondary)]" />
                    <select
                      value={classificationFilter}
                      onChange={(e) => setClassificationFilter(e.target.value as ClassificationFilter)}
                      className="px-3 py-1.5 bg-[#1a1d23] text-white border border-gray-600 rounded-lg text-sm hover:border-gray-500"
                    >
                      <option value="">All Classifications</option>
                      <option value="AUTHORIZED">Authorized</option>
                      <option value="UNAUTHORIZED">Unauthorized</option>
                    </select>
                    <select
                      value={dayTypeFilter}
                      onChange={(e) => setDayTypeFilter(e.target.value as DayTypeFilter)}
                      className="px-3 py-1.5 bg-[#1a1d23] text-white border border-gray-600 rounded-lg text-sm hover:border-gray-500"
                    >
                      <option value="">All Days</option>
                      <option value="WEEKDAY">Weekday</option>
                      <option value="WEEKEND">Weekend</option>
                    </select>
                    <select
                      value={timeCategoryFilter}
                      onChange={(e) => setTimeCategoryFilter(e.target.value as TimeCategoryFilter)}
                      className="px-3 py-1.5 bg-[#1a1d23] text-white border border-gray-600 rounded-lg text-sm hover:border-gray-500"
                    >
                      <option value="">All Times</option>
                      <option value="WORK_HOURS">Work Hours</option>
                      <option value="AFTER_HOURS">After Hours</option>
                      <option value="NIGHT_TRAVEL">Night Travel</option>
                    </select>
                    {(classificationFilter || dayTypeFilter || timeCategoryFilter) && (
                      <button
                        onClick={() => {
                          setClassificationFilter('');
                          setDayTypeFilter('');
                          setTimeCategoryFilter('');
                        }}
                        className="px-3 py-1.5 text-sm text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]"
                      >
                        Clear filters
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Table */}
              {tripsLoading ? (
                <div className="p-8">
                  <div className="animate-pulse space-y-3">
                    {[...Array(5)].map((_, i) => (
                      <div key={i} className="h-12 bg-[var(--ff-bg-tertiary)] rounded"></div>
                    ))}
                  </div>
                </div>
              ) : trips.length === 0 ? (
                <div className="px-6 py-12 text-center">
                  <Navigation className="w-12 h-12 text-[var(--ff-text-tertiary)] mx-auto mb-4" />
                  <p className="text-[var(--ff-text-secondary)]">No trips match the current filters</p>
                </div>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-[var(--ff-bg-tertiary)]">
                        <tr>
                          <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] uppercase tracking-wider">
                            Trip
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] uppercase tracking-wider">
                            Date/Time
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] uppercase tracking-wider">
                            From
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] uppercase tracking-wider">
                            To
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] uppercase tracking-wider">
                            Distance
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] uppercase tracking-wider">
                            Classification
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] uppercase tracking-wider">
                            Time
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--ff-border-light)]">
                        {trips.map((trip) => {
                          const classification = classificationConfig[trip.classification];
                          const ClassIcon = classification.icon;
                          const timeCategory = timeCategoryConfig[trip.timeCategory];
                          const TimeIcon = timeCategory.icon;

                          return (
                            <tr key={trip.id} className="hover:bg-[var(--ff-bg-tertiary)]">
                              <td className="px-4 py-3 whitespace-nowrap">
                                <span className="text-sm font-medium text-[var(--ff-text-primary)]">
                                  #{trip.tripNumber}
                                </span>
                              </td>
                              <td className="px-4 py-3 whitespace-nowrap">
                                <div className="text-sm text-[var(--ff-text-primary)]">
                                  {new Date(trip.startTime).toLocaleDateString()}
                                </div>
                                <div className="text-xs text-[var(--ff-text-tertiary)]">
                                  {new Date(trip.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                  {' - '}
                                  {new Date(trip.endTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </div>
                              </td>
                              <td className="px-4 py-3">
                                <span className="text-sm text-[var(--ff-text-primary)] line-clamp-1" title={trip.startLocation || undefined}>
                                  {trip.startLocation || `${trip.startLat.toFixed(4)}, ${trip.startLon.toFixed(4)}`}
                                </span>
                              </td>
                              <td className="px-4 py-3">
                                <span className="text-sm text-[var(--ff-text-primary)] line-clamp-1" title={trip.endLocation || undefined}>
                                  {trip.endLocation || `${trip.endLat.toFixed(4)}, ${trip.endLon.toFixed(4)}`}
                                </span>
                              </td>
                              <td className="px-4 py-3 whitespace-nowrap">
                                <span className="text-sm text-[var(--ff-text-primary)]">
                                  {Number(trip.distanceKm).toFixed(1)} km
                                </span>
                              </td>
                              <td className="px-4 py-3 whitespace-nowrap">
                                <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${classification.bgColor} ${classification.textColor}`}>
                                  <ClassIcon className="w-3 h-3" />
                                  {classification.label}
                                </span>
                              </td>
                              <td className="px-4 py-3 whitespace-nowrap">
                                <span className={`inline-flex items-center gap-1.5 text-sm ${timeCategory.color}`}>
                                  <TimeIcon className="w-4 h-4" />
                                  {timeCategory.label}
                                </span>
                                {trip.dayType === 'WEEKEND' && (
                                  <span className="ml-2 text-xs text-blue-400">(Weekend)</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Pagination */}
                  {totalPages > 1 && (
                    <div className="px-6 py-4 border-t border-[var(--ff-border-light)] flex items-center justify-between">
                      <p className="text-sm text-[var(--ff-text-secondary)]">
                        Showing {((page - 1) * pageSize) + 1} - {Math.min(page * pageSize, totalTrips)} of {totalTrips} trips
                      </p>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setPage(p => Math.max(1, p - 1))}
                          disabled={page === 1}
                          className="p-2 rounded-lg bg-[var(--ff-bg-tertiary)] disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[var(--ff-bg-primary)] transition-colors"
                        >
                          <ChevronLeft className="w-4 h-4 text-[var(--ff-text-secondary)]" />
                        </button>
                        <span className="text-sm text-[var(--ff-text-primary)]">
                          Page {page} of {totalPages}
                        </span>
                        <button
                          onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                          disabled={page === totalPages}
                          className="p-2 rounded-lg bg-[var(--ff-bg-tertiary)] disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[var(--ff-bg-primary)] transition-colors"
                        >
                          <ChevronRight className="w-4 h-4 text-[var(--ff-text-secondary)]" />
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </>
        )}
      </div>
    </AppLayout>
  );
}

// Force server-side rendering for dynamic route
export async function getServerSideProps() {
  return { props: {} };
}
