/**
 * Project Incidents Section Component
 * Displays combined view of project incidents and contractor incidents
 */

import { useState } from 'react';
import { useRouter } from 'next/router';
import useSWR from 'swr';
import {
  AlertTriangle,
  AlertCircle,
  ChevronRight,
  ExternalLink,
  Calendar,
  User,
  Building,
  Filter,
  RefreshCw,
} from 'lucide-react';
import { log } from '@/lib/logger';

interface Incident {
  id: string;
  ticket_type: string;
  title: string;
  status: string;
  priority: string;
  created_at: string;
  // H&S specific
  hs_incident_type: string | null;
  hs_severity: string | null;
  incident_date: string | null;
  incident_location: string | null;
  is_dol_reportable: boolean;
  // Source info
  source_type: 'project' | 'contractor';
  source_name: string;
  contractor_id: string | null;
  project_id: string;
}

interface IncidentsResponse {
  incidents: Incident[];
  summary: {
    total: number;
    open: number;
    closed: number;
    by_type: Record<string, number>;
    by_severity: Record<string, number>;
    dol_reportable: number;
  };
}

interface ProjectIncidentsSectionProps {
  projectId: string;
  compact?: boolean;
}

const fetcher = (url: string) => fetch(url).then(r => r.json());

function getSeverityConfig(severity: string | null) {
  switch (severity) {
    case 'fatal':
      return { bg: 'bg-black', text: 'text-white', label: 'Fatal' };
    case 'major':
      return { bg: 'bg-red-100 dark:bg-red-900/30', text: 'text-red-700 dark:text-red-300', label: 'Major' };
    case 'moderate':
      return { bg: 'bg-orange-100 dark:bg-orange-900/30', text: 'text-orange-700 dark:text-orange-300', label: 'Moderate' };
    case 'minor':
      return { bg: 'bg-yellow-100 dark:bg-yellow-900/30', text: 'text-yellow-700 dark:text-yellow-300', label: 'Minor' };
    default:
      return { bg: 'bg-secondary', text: 'text-muted-foreground', label: 'Unknown' };
  }
}

function getIncidentTypeLabel(type: string | null) {
  switch (type) {
    case 'injury': return 'Injury';
    case 'near_miss': return 'Near Miss';
    case 'property_damage': return 'Property Damage';
    case 'environmental': return 'Environmental';
    case 'vehicle': return 'Vehicle';
    case 'other': return 'Other';
    default: return 'Incident';
  }
}

function getStatusConfig(status: string) {
  switch (status) {
    case 'open':
    case 'new':
      return { bg: 'bg-blue-100 dark:bg-blue-900/30', text: 'text-blue-700 dark:text-blue-300', label: 'Open' };
    case 'in_progress':
      return { bg: 'bg-amber-100 dark:bg-amber-900/30', text: 'text-amber-700 dark:text-amber-300', label: 'In Progress' };
    case 'resolved':
    case 'closed':
      return { bg: 'bg-green-100 dark:bg-green-900/30', text: 'text-green-700 dark:text-green-300', label: 'Closed' };
    case 'cancelled':
      return { bg: 'bg-secondary', text: 'text-muted-foreground', label: 'Cancelled' };
    default:
      return { bg: 'bg-secondary', text: 'text-muted-foreground', label: status };
  }
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return 'N/A';
  return new Date(dateStr).toLocaleDateString('en-ZA', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function ProjectIncidentsSection({ projectId, compact = false }: ProjectIncidentsSectionProps) {
  const router = useRouter();
  const [filterStatus, setFilterStatus] = useState<'all' | 'open' | 'closed'>('all');

  const { data, error, isLoading, mutate } = useSWR<{ data: IncidentsResponse }>(
    `/api/projects/${projectId}/incidents`,
    fetcher
  );

  const incidents = data?.data?.incidents || [];
  const summary = data?.data?.summary;

  // Filter incidents based on status
  const filteredIncidents = incidents.filter(incident => {
    if (filterStatus === 'all') return true;
    if (filterStatus === 'open') return !['closed', 'cancelled', 'resolved'].includes(incident.status);
    return ['closed', 'cancelled', 'resolved'].includes(incident.status);
  });

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-16 bg-secondary rounded-lg" />
        <div className="space-y-2">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-20 bg-secondary rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    log.error('Failed to load project incidents', { error, projectId }, 'ProjectIncidentsSection');
    return (
      <div className="p-4 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800">
        <div className="flex items-center gap-2 text-red-700 dark:text-red-300">
          <AlertTriangle className="w-5 h-5" />
          <span>Failed to load incidents</span>
          <button
            onClick={() => mutate()}
            className="ml-auto text-sm underline hover:no-underline"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary Stats */}
      {!compact && summary && (
        <div className="flex flex-wrap items-center gap-4 p-4 bg-input rounded-lg">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Total:</span>
            <span className="font-semibold text-foreground">{summary.total}</span>
          </div>
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-blue-500" />
            <span className="text-sm text-blue-700 dark:text-blue-300">{summary.open} Open</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">{summary.closed} Closed</span>
          </div>
          {summary.dol_reportable > 0 && (
            <div className="flex items-center gap-2 px-2 py-1 bg-red-100 dark:bg-red-900/30 rounded">
              <AlertTriangle className="w-4 h-4 text-red-500" />
              <span className="text-sm text-red-700 dark:text-red-300">{summary.dol_reportable} DoL Reportable</span>
            </div>
          )}

          {/* Filter & Refresh */}
          <div className="flex items-center gap-2 ml-auto">
            <div className="flex items-center gap-1 text-sm">
              <Filter className="w-4 h-4 text-gray-400" />
              <select
                value={filterStatus}
                onChange={e => setFilterStatus(e.target.value as 'all' | 'open' | 'closed')}
                className="bg-transparent border-none text-muted-foreground focus:ring-0 text-sm"
              >
                <option value="all">All</option>
                <option value="open">Open</option>
                <option value="closed">Closed</option>
              </select>
            </div>
            <button
              onClick={() => mutate()}
              className="p-1.5 text-muted-foreground hover:text-muted-foreground dark:hover:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700 rounded transition-colors"
              title="Refresh"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Incidents List */}
      {filteredIncidents.length === 0 ? (
        <div className="p-6 bg-input rounded-lg border border-border text-center">
          <AlertCircle className="w-12 h-12 mx-auto mb-3 text-gray-400" />
          <h4 className="font-medium text-foreground mb-1">No Incidents</h4>
          <p className="text-sm text-muted-foreground">
            {filterStatus === 'all'
              ? 'No H&S incidents have been reported for this project or its contractors.'
              : filterStatus === 'open'
                ? 'No open incidents.'
                : 'No closed incidents.'}
          </p>
        </div>
      ) : (
        <div className="bg-card rounded-lg border border-border overflow-hidden">
          {/* Table Header */}
          <div className="grid grid-cols-12 gap-4 px-4 py-3 bg-secondary/50 border-b border-border text-sm font-medium text-muted-foreground">
            <div className="col-span-1">Type</div>
            <div className="col-span-3">Description</div>
            <div className="col-span-2">Source</div>
            <div className="col-span-2">Severity</div>
            <div className="col-span-2">Date</div>
            <div className="col-span-1">Status</div>
            <div className="col-span-1"></div>
          </div>

          {/* Table Rows */}
          <div className="divide-y divide-gray-200 dark:divide-gray-700">
            {filteredIncidents.map(incident => {
              const severityConfig = getSeverityConfig(incident.hs_severity);
              const statusConfig = getStatusConfig(incident.status);

              return (
                <div
                  key={incident.id}
                  className="grid grid-cols-12 gap-4 px-4 py-3 hover:bg-accent/50 cursor-pointer transition-colors items-center"
                  onClick={() => router.push(`/health-safety/incidents/${incident.id}`)}
                >
                  {/* Type */}
                  <div className="col-span-1">
                    <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-orange-100 dark:bg-orange-900/30">
                      <AlertTriangle className="w-4 h-4 text-orange-600 dark:text-orange-400" />
                    </span>
                  </div>

                  {/* Description */}
                  <div className="col-span-3">
                    <p className="text-sm font-medium text-foreground truncate">
                      {incident.title || getIncidentTypeLabel(incident.hs_incident_type)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {getIncidentTypeLabel(incident.hs_incident_type)}
                    </p>
                  </div>

                  {/* Source */}
                  <div className="col-span-2">
                    <div className="flex items-center gap-1.5">
                      {incident.source_type === 'contractor' ? (
                        <Building className="w-4 h-4 text-gray-400" />
                      ) : (
                        <User className="w-4 h-4 text-gray-400" />
                      )}
                      <span className="text-sm text-muted-foreground truncate">
                        {incident.source_name}
                      </span>
                    </div>
                  </div>

                  {/* Severity */}
                  <div className="col-span-2">
                    <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${severityConfig.bg} ${severityConfig.text}`}>
                      {severityConfig.label}
                    </span>
                    {incident.is_dol_reportable && (
                      <span className="ml-1 inline-flex px-1.5 py-0.5 text-xs font-medium rounded bg-red-600 text-white">
                        DoL
                      </span>
                    )}
                  </div>

                  {/* Date */}
                  <div className="col-span-2">
                    <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                      <Calendar className="w-4 h-4" />
                      <span>{formatDate(incident.incident_date || incident.created_at)}</span>
                    </div>
                  </div>

                  {/* Status */}
                  <div className="col-span-1">
                    <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${statusConfig.bg} ${statusConfig.text}`}>
                      {statusConfig.label}
                    </span>
                  </div>

                  {/* Action */}
                  <div className="col-span-1 text-right">
                    <ChevronRight className="w-5 h-5 text-gray-400 inline-block" />
                  </div>
                </div>
              );
            })}
          </div>

          {/* View All Link */}
          {incidents.length > 5 && (
            <div className="px-4 py-3 bg-secondary/50 border-t border-border">
              <a
                href={`/health-safety/incidents?project_id=${projectId}`}
                className="flex items-center justify-center gap-2 text-sm text-blue-600 dark:text-blue-400 hover:underline"
              >
                View All Incidents
                <ExternalLink className="w-4 h-4" />
              </a>
            </div>
          )}
        </div>
      )}

      {/* Report Incident Button */}
      <div className="flex justify-end">
        <button
          onClick={() => router.push(`/health-safety/incidents/new?project_id=${projectId}`)}
          className="inline-flex items-center gap-2 px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded-lg text-sm transition-colors"
        >
          <AlertTriangle className="w-4 h-4" />
          Report Incident
        </button>
      </div>
    </div>
  );
}

export default ProjectIncidentsSection;
