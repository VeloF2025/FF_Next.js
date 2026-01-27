/**
 * H&S Incidents List Page
 * /health-safety/incidents - View and manage all H&S incidents
 */

import type { NextPage } from 'next';
import React, { useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import useSWR from 'swr';
import { AppLayout } from '@/components/layout/AppLayout';
import { ModulePage } from '@/components/module-page';
import { projectsConfig } from '@/modules/navigation';
import {
  AlertTriangle,
  Plus,
  Search,
  Filter,
  ChevronLeft,
  Calendar,
  MapPin,
  User,
  Clock,
} from 'lucide-react';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

function IncidentsListContent() {
  const router = useRouter();
  const [searchTerm, setSearchTerm] = useState('');
  const [severityFilter, setSeverityFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const { data, error, isLoading } = useSWR('/api/health-safety/incidents', fetcher);
  const incidents = data?.data || [];

  // Filter incidents
  const filteredIncidents = incidents.filter((incident: any) => {
    const matchesSearch =
      !searchTerm ||
      incident.title?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      incident.location?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      incident.description?.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesSeverity = severityFilter === 'all' || incident.severity === severityFilter;
    const matchesStatus = statusFilter === 'all' || incident.status === statusFilter;

    return matchesSearch && matchesSeverity && matchesStatus;
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="h-24 bg-[var(--ff-bg-tertiary)] rounded-lg animate-pulse" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8 text-center bg-red-50 dark:bg-red-900/20 rounded-lg">
        <AlertTriangle className="w-12 h-12 mx-auto mb-4 text-red-500" />
        <p className="text-red-600 dark:text-red-400 font-medium">Failed to load incidents</p>
        <p className="text-sm text-red-500 dark:text-red-300 mt-1">Please try refreshing the page</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link
            href="/projects/health-safety"
            className="p-2 hover:bg-[var(--ff-bg-tertiary)] rounded-lg transition-colors"
          >
            <ChevronLeft className="w-5 h-5 text-[var(--ff-text-secondary)]" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">H&S Incidents</h1>
            <p className="text-sm text-[var(--ff-text-secondary)]">
              {filteredIncidents.length} incident{filteredIncidents.length !== 1 ? 's' : ''}
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

      {/* Filters */}
      <div className="flex flex-wrap gap-4">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--ff-text-tertiary)]" />
          <input
            type="text"
            placeholder="Search incidents..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] placeholder:text-[var(--ff-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-primary-500)]"
          />
        </div>
        <select
          value={severityFilter}
          onChange={(e) => setSeverityFilter(e.target.value)}
          className="px-4 py-2 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-primary-500)]"
        >
          <option value="all">All Severities</option>
          <option value="critical">Critical</option>
          <option value="major">Major</option>
          <option value="moderate">Moderate</option>
          <option value="minor">Minor</option>
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-4 py-2 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-primary-500)]"
        >
          <option value="all">All Statuses</option>
          <option value="open">Open</option>
          <option value="investigating">Investigating</option>
          <option value="resolved">Resolved</option>
          <option value="closed">Closed</option>
        </select>
      </div>

      {/* Incidents List */}
      {filteredIncidents.length === 0 ? (
        <div className="text-center py-12 bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)]">
          <AlertTriangle className="w-12 h-12 mx-auto mb-4 text-[var(--ff-text-tertiary)]" />
          <p className="text-[var(--ff-text-secondary)]">No incidents found</p>
          <p className="text-sm text-[var(--ff-text-tertiary)] mt-1">
            {searchTerm || severityFilter !== 'all' || statusFilter !== 'all'
              ? 'Try adjusting your filters'
              : 'No incidents have been reported yet'}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredIncidents.map((incident: any) => (
            <IncidentCard key={incident.id} incident={incident} />
          ))}
        </div>
      )}
    </div>
  );
}

function IncidentCard({ incident }: { incident: any }) {
  const severityColors: Record<string, string> = {
    critical: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
    major: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
    moderate: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
    minor: 'bg-gray-100 text-gray-700 dark:bg-gray-700/50 dark:text-gray-300',
  };

  const statusColors: Record<string, string> = {
    open: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
    investigating: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    resolved: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
    closed: 'bg-gray-100 text-gray-700 dark:bg-gray-700/50 dark:text-gray-300',
  };

  return (
    <Link
      href={`/health-safety/incidents/${incident.id}`}
      className="block bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-4 hover:border-[var(--ff-primary-500)] transition-colors"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 mb-2">
            <h3 className="font-semibold text-[var(--ff-text-primary)] truncate">
              {incident.title || 'Untitled Incident'}
            </h3>
            <span className={`px-2 py-0.5 text-xs font-medium rounded ${severityColors[incident.severity] || severityColors.minor}`}>
              {incident.severity?.toUpperCase() || 'UNKNOWN'}
            </span>
            <span className={`px-2 py-0.5 text-xs font-medium rounded ${statusColors[incident.status] || statusColors.open}`}>
              {incident.status?.toUpperCase() || 'OPEN'}
            </span>
          </div>
          <p className="text-sm text-[var(--ff-text-secondary)] line-clamp-2 mb-3">
            {incident.description || 'No description provided'}
          </p>
          <div className="flex flex-wrap items-center gap-4 text-xs text-[var(--ff-text-tertiary)]">
            {incident.incident_date && (
              <span className="flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5" />
                {new Date(incident.incident_date).toLocaleDateString()}
              </span>
            )}
            {incident.location && (
              <span className="flex items-center gap-1">
                <MapPin className="w-3.5 h-3.5" />
                {incident.location}
              </span>
            )}
            {incident.reported_by && (
              <span className="flex items-center gap-1">
                <User className="w-3.5 h-3.5" />
                {incident.reported_by}
              </span>
            )}
          </div>
        </div>
      </div>
    </Link>
  );
}

const IncidentsPage: NextPage = () => {
  return (
    <AppLayout>
      <Head>
        <title>H&S Incidents | FibreFlow</title>
      </Head>
      <ModulePage config={projectsConfig}>
        <IncidentsListContent />
      </ModulePage>
    </AppLayout>
  );
};

export const getServerSideProps = async () => {
  return { props: {} };
};

export default IncidentsPage;
