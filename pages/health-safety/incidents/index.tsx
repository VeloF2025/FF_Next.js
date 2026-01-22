/**
 * H&S Incidents List
 *
 * Lists all H&S incidents with filtering, severity indicators,
 * and DoL reporting status.
 */

import React, { useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import useSWR from 'swr';
import {
  Shield,
  AlertTriangle,
  Plus,
  Search,
  Filter,
  ChevronLeft,
  Calendar,
  MapPin,
  User,
  FileText,
  ExternalLink,
  AlertOctagon,
  CheckCircle,
  Clock,
  Building2,
} from 'lucide-react';
import { AppLayout } from '@/components/layout';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface Incident {
  id: string;
  title: string;
  status: string;
  priority: string;
  ticket_type: string;
  created_at: string;
  updated_at: string;
  due_date: string;
  incident_type: string;
  severity: string;
  incident_date: string;
  incident_time: string | null;
  location: string | null;
  dol_reportable: boolean;
  dol_reported: boolean;
  corrective_action_required: boolean;
  investigation_started_at: string | null;
  investigation_completed_at: string | null;
  project_name: string | null;
  contractor_name: string | null;
  assigned_to_name: string | null;
  injured_count: number;
}

const SEVERITY_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  critical: { label: 'Critical', color: 'text-red-500', bg: 'bg-red-500/20' },
  major: { label: 'Major', color: 'text-orange-500', bg: 'bg-orange-500/20' },
  moderate: { label: 'Moderate', color: 'text-yellow-500', bg: 'bg-yellow-500/20' },
  minor: { label: 'Minor', color: 'text-gray-400', bg: 'bg-gray-500/20' },
};

const INCIDENT_TYPE_CONFIG: Record<string, { label: string; icon: React.ElementType }> = {
  injury: { label: 'Injury', icon: User },
  near_miss: { label: 'Near Miss', icon: AlertTriangle },
  property_damage: { label: 'Property Damage', icon: Building2 },
  environmental: { label: 'Environmental', icon: Shield },
  vehicle: { label: 'Vehicle', icon: AlertOctagon },
  other: { label: 'Other', icon: FileText },
};

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  open: { label: 'Open', color: 'text-blue-400', bg: 'bg-blue-500/20' },
  in_progress: { label: 'In Progress', color: 'text-yellow-400', bg: 'bg-yellow-500/20' },
  resolved: { label: 'Resolved', color: 'text-green-400', bg: 'bg-green-500/20' },
  closed: { label: 'Closed', color: 'text-gray-400', bg: 'bg-gray-500/20' },
};

export default function IncidentsListPage() {
  const [filters, setFilters] = useState({
    severity: '',
    incident_type: '',
    status: '',
    dol_reportable: false,
  });
  const [searchTerm, setSearchTerm] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  // Build query string
  const queryParams = new URLSearchParams();
  if (filters.severity) queryParams.set('severity', filters.severity);
  if (filters.incident_type) queryParams.set('incident_type', filters.incident_type);
  if (filters.status) queryParams.set('status', filters.status);
  if (filters.dol_reportable) queryParams.set('dol_reportable', 'true');

  const { data, error, isLoading } = useSWR(
    `/api/health-safety/incidents?${queryParams.toString()}`,
    fetcher
  );

  const incidents: Incident[] = data?.data?.incidents || [];
  const stats = data?.data?.stats;

  // Filter by search term
  const filteredIncidents = incidents.filter(
    (inc) =>
      !searchTerm ||
      inc.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      inc.location?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      inc.project_name?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <AppLayout>
      <Head>
        <title>H&S Incidents | FibreFlow</title>
      </Head>

      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link
              href="/health-safety"
              className="p-2 rounded-lg hover:bg-[var(--ff-bg-tertiary)] transition-colors"
            >
              <ChevronLeft className="w-5 h-5 text-[var(--ff-text-secondary)]" />
            </Link>
            <div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-3">
                <AlertTriangle className="w-7 h-7 text-red-500" />
                H&S Incidents
              </h1>
              <p className="text-gray-500 dark:text-gray-400 mt-1">
                Track and manage health & safety incidents
              </p>
            </div>
          </div>

          <Link
            href="/health-safety/incidents/new"
            className="flex items-center gap-2 px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" />
            Report Incident
          </Link>
        </div>

        {/* Stats Cards */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
            <StatCard label="Total" value={stats.total} />
            <StatCard label="Critical" value={stats.critical} color="red" />
            <StatCard label="Major" value={stats.major} color="orange" />
            <StatCard label="Open" value={stats.open} color="blue" />
            <StatCard label="DoL Reportable" value={stats.dol_reportable} color="purple" />
            <StatCard label="DoL Pending" value={stats.dol_pending} color="red" />
            <StatCard label="CA Pending" value={stats.ca_pending} color="yellow" />
          </div>
        )}

        {/* Search and Filters */}
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search incidents..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
            />
          </div>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg border transition-colors ${
              showFilters
                ? 'bg-orange-50 dark:bg-orange-900/20 border-orange-300 dark:border-orange-700 text-orange-600'
                : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300'
            }`}
          >
            <Filter className="w-4 h-4" />
            Filters
          </button>
        </div>

        {/* Filter Panel */}
        {showFilters && (
          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Severity
                </label>
                <select
                  value={filters.severity}
                  onChange={(e) => setFilters({ ...filters, severity: e.target.value })}
                  className="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg"
                >
                  <option value="">All Severities</option>
                  <option value="critical">Critical</option>
                  <option value="major">Major</option>
                  <option value="moderate">Moderate</option>
                  <option value="minor">Minor</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Incident Type
                </label>
                <select
                  value={filters.incident_type}
                  onChange={(e) => setFilters({ ...filters, incident_type: e.target.value })}
                  className="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg"
                >
                  <option value="">All Types</option>
                  <option value="injury">Injury</option>
                  <option value="near_miss">Near Miss</option>
                  <option value="property_damage">Property Damage</option>
                  <option value="environmental">Environmental</option>
                  <option value="vehicle">Vehicle</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Status
                </label>
                <select
                  value={filters.status}
                  onChange={(e) => setFilters({ ...filters, status: e.target.value })}
                  className="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg"
                >
                  <option value="">All Statuses</option>
                  <option value="open">Open</option>
                  <option value="in_progress">In Progress</option>
                  <option value="resolved">Resolved</option>
                  <option value="closed">Closed</option>
                </select>
              </div>
              <div className="flex items-end">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={filters.dol_reportable}
                    onChange={(e) => setFilters({ ...filters, dol_reportable: e.target.checked })}
                    className="w-4 h-4 rounded border-gray-300 text-orange-500 focus:ring-orange-500"
                  />
                  <span className="text-sm text-gray-700 dark:text-gray-300">DoL Reportable Only</span>
                </label>
              </div>
            </div>
          </div>
        )}

        {/* Incidents List */}
        {isLoading ? (
          <LoadingSkeleton />
        ) : error ? (
          <ErrorState />
        ) : filteredIncidents.length === 0 ? (
          <EmptyState hasFilters={!!searchTerm || Object.values(filters).some(Boolean)} />
        ) : (
          <div className="space-y-4">
            {filteredIncidents.map((incident) => (
              <IncidentCard key={incident.id} incident={incident} />
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  );
}

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color?: string;
}) {
  const colors: Record<string, string> = {
    red: 'text-red-500',
    orange: 'text-orange-500',
    yellow: 'text-yellow-500',
    blue: 'text-blue-500',
    purple: 'text-purple-500',
    green: 'text-green-500',
  };

  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
      <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">{label}</p>
      <p className={`text-2xl font-bold ${color ? colors[color] : 'text-gray-900 dark:text-white'}`}>
        {value}
      </p>
    </div>
  );
}

function IncidentCard({ incident }: { incident: Incident }) {
  const severity = SEVERITY_CONFIG[incident.severity] || SEVERITY_CONFIG.minor;
  const incidentType = INCIDENT_TYPE_CONFIG[incident.incident_type] || INCIDENT_TYPE_CONFIG.other;
  const status = STATUS_CONFIG[incident.status] || STATUS_CONFIG.open;
  const TypeIcon = incidentType.icon;

  return (
    <Link
      href={`/health-safety/incidents/${incident.id}`}
      className="block bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4 hover:border-orange-300 dark:hover:border-orange-700 transition-colors"
    >
      <div className="flex items-start gap-4">
        {/* Severity indicator */}
        <div className={`p-3 rounded-lg ${severity.bg}`}>
          <TypeIcon className={`w-6 h-6 ${severity.color}`} />
        </div>

        {/* Main content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="font-semibold text-gray-900 dark:text-white truncate">
                {incident.title}
              </h3>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1 text-sm text-gray-500 dark:text-gray-400">
                <span className="flex items-center gap-1">
                  <Calendar className="w-4 h-4" />
                  {new Date(incident.incident_date).toLocaleDateString()}
                </span>
                {incident.location && (
                  <span className="flex items-center gap-1">
                    <MapPin className="w-4 h-4" />
                    {incident.location}
                  </span>
                )}
                {incident.project_name && (
                  <span className="flex items-center gap-1">
                    <Building2 className="w-4 h-4" />
                    {incident.project_name}
                  </span>
                )}
              </div>
            </div>

            {/* Badges */}
            <div className="flex flex-col items-end gap-2">
              <div className="flex items-center gap-2">
                <span className={`px-2 py-1 text-xs font-medium rounded ${severity.bg} ${severity.color}`}>
                  {severity.label}
                </span>
                <span className={`px-2 py-1 text-xs font-medium rounded ${status.bg} ${status.color}`}>
                  {status.label}
                </span>
              </div>
              {incident.dol_reportable && (
                <span
                  className={`flex items-center gap-1 text-xs ${
                    incident.dol_reported
                      ? 'text-green-500'
                      : 'text-red-500 font-medium animate-pulse'
                  }`}
                >
                  {incident.dol_reported ? (
                    <>
                      <CheckCircle className="w-3 h-3" />
                      DoL Reported
                    </>
                  ) : (
                    <>
                      <AlertOctagon className="w-3 h-3" />
                      DoL Pending
                    </>
                  )}
                </span>
              )}
            </div>
          </div>

          {/* Footer info */}
          <div className="flex items-center gap-4 mt-3 text-xs text-gray-500 dark:text-gray-400">
            <span className="flex items-center gap-1">
              <FileText className="w-3 h-3" />
              {incidentType.label}
            </span>
            {incident.injured_count > 0 && (
              <span className="flex items-center gap-1 text-red-500">
                <User className="w-3 h-3" />
                {incident.injured_count} injured
              </span>
            )}
            {incident.investigation_started_at && !incident.investigation_completed_at && (
              <span className="flex items-center gap-1 text-yellow-500">
                <Clock className="w-3 h-3" />
                Investigation in progress
              </span>
            )}
            {incident.investigation_completed_at && (
              <span className="flex items-center gap-1 text-green-500">
                <CheckCircle className="w-3 h-3" />
                Investigation complete
              </span>
            )}
            {incident.assigned_to_name && (
              <span className="flex items-center gap-1">
                <User className="w-3 h-3" />
                {incident.assigned_to_name}
              </span>
            )}
          </div>
        </div>

        <ExternalLink className="w-5 h-5 text-gray-400 flex-shrink-0" />
      </div>
    </Link>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-4">
      {[1, 2, 3, 4, 5].map((i) => (
        <div
          key={i}
          className="h-24 bg-gray-200 dark:bg-gray-700 rounded-lg animate-pulse"
        />
      ))}
    </div>
  );
}

function ErrorState() {
  return (
    <div className="p-8 text-center bg-red-50 dark:bg-red-900/20 rounded-lg">
      <AlertTriangle className="w-12 h-12 mx-auto mb-4 text-red-500" />
      <p className="text-red-600 dark:text-red-400 font-medium">Failed to load incidents</p>
      <p className="text-sm text-red-500 dark:text-red-300 mt-1">Please try refreshing the page</p>
    </div>
  );
}

function EmptyState({ hasFilters }: { hasFilters: boolean }) {
  return (
    <div className="p-12 text-center bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-dashed border-gray-300 dark:border-gray-600">
      <Shield className="w-12 h-12 mx-auto mb-4 text-gray-400" />
      <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-1">
        {hasFilters ? 'No incidents match your filters' : 'No incidents reported'}
      </h3>
      <p className="text-gray-500 dark:text-gray-400 mb-4">
        {hasFilters
          ? 'Try adjusting your search or filter criteria'
          : 'All clear! No H&S incidents have been reported.'}
      </p>
      {!hasFilters && (
        <Link
          href="/health-safety/incidents/new"
          className="inline-flex items-center gap-2 px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4" />
          Report Incident
        </Link>
      )}
    </div>
  );
}

