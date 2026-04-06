/**
 * Site Visits Page
 * Shows upcoming site visits across all projects for the next 7 days.
 */

'use client';

import { useState, useEffect } from 'react';
import { CalendarDays, AlertCircle, Clock, CheckCircle2, XCircle, User, MapPin } from 'lucide-react';
import { getUpcomingSiteVisits } from '@/services/siteVisitsService';
import type { SiteVisitWithDetails, SiteVisitStatus, SiteVisitType } from '@/types/site-visit.types';
import { log } from '@/lib/logger';

// ==================== Labels ====================

const VISIT_TYPE_LABELS: Record<SiteVisitType, string> = {
  inspection: 'Inspection',
  progress_check: 'Progress Check',
  handover: 'Handover',
  safety_audit: 'Safety Audit',
};

const STATUS_CONFIG: Record<SiteVisitStatus, { label: string; className: string; icon: React.ElementType }> = {
  scheduled: { label: 'Scheduled',  className: 'bg-blue-500/20 text-blue-300 border-blue-500/30',      icon: Clock },
  completed: { label: 'Completed',  className: 'bg-green-500/20 text-green-300 border-green-500/30',   icon: CheckCircle2 },
  cancelled: { label: 'Cancelled',  className: 'bg-red-500/20 text-red-300 border-red-500/30',         icon: XCircle },
  no_show:   { label: 'No Show',    className: 'bg-orange-500/20 text-orange-300 border-orange-500/30', icon: XCircle },
};

function StatusBadge({ status }: { status: SiteVisitStatus }) {
  const cfg = STATUS_CONFIG[status];
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${cfg.className}`}>
      <Icon className="h-3 w-3" />
      {cfg.label}
    </span>
  );
}

// ==================== Page ====================

export default function SiteVisitsPage() {
  const [visits, setVisits] = useState<SiteVisitWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await getUpcomingSiteVisits();
        setVisits(data);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Failed to load upcoming site visits';
        log.error('Error loading upcoming site visits', { error: err }, 'SiteVisitsPage');
        setError(message);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[var(--ff-text-primary)] flex items-center gap-2">
          <CalendarDays className="h-6 w-6" />
          Site Visits
        </h1>
        <p className="text-[var(--ff-text-secondary)] mt-1">
          Upcoming site visits in the next 7 days
        </p>
      </div>

      {/* Content */}
      {loading ? (
        <div className="bg-[var(--ff-bg-secondary)] p-6 rounded-lg border border-[var(--ff-border-light)]">
          <div className="animate-pulse space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-20 bg-[var(--ff-bg-tertiary)] rounded" />
            ))}
          </div>
        </div>
      ) : error ? (
        <div className="flex items-center gap-2 p-4 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400">
          <AlertCircle className="h-5 w-5 flex-shrink-0" />
          {error}
        </div>
      ) : visits.length === 0 ? (
        <div className="bg-[var(--ff-bg-secondary)] p-12 rounded-lg border border-[var(--ff-border-light)] text-center">
          <CalendarDays className="h-12 w-12 mx-auto mb-3 text-[var(--ff-text-tertiary)] opacity-50" />
          <p className="text-[var(--ff-text-primary)] font-medium">No upcoming visits</p>
          <p className="text-sm text-[var(--ff-text-secondary)] mt-1">
            No site visits are scheduled for the next 7 days.
          </p>
        </div>
      ) : (
        <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)]">
          <div className="px-6 py-4 border-b border-[var(--ff-border-light)]">
            <p className="text-sm text-[var(--ff-text-secondary)]">
              {visits.length} visit{visits.length !== 1 ? 's' : ''} scheduled
            </p>
          </div>

          <div className="divide-y divide-[var(--ff-border-light)]">
            {visits.map((visit) => (
              <div key={visit.id} className="px-6 py-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3">
                    <div className="p-2 bg-blue-500/10 rounded-lg mt-0.5">
                      <CalendarDays className="h-4 w-4 text-blue-400" />
                    </div>
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-[var(--ff-text-primary)]">
                          {VISIT_TYPE_LABELS[visit.visitType]}
                        </span>
                        <StatusBadge status={visit.status} />
                      </div>

                      <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-[var(--ff-text-secondary)]">
                        <span className="flex items-center gap-1">
                          <CalendarDays className="h-3 w-3" />
                          {visit.scheduledDate}
                        </span>
                        <span className="flex items-center gap-1">
                          <User className="h-3 w-3" />
                          {visit.inspectorName}
                        </span>
                        {visit.projectName && (
                          <span className="flex items-center gap-1">
                            <MapPin className="h-3 w-3" />
                            {visit.projectName}{visit.projectCode ? ` (${visit.projectCode})` : ''}
                          </span>
                        )}
                        {visit.contractorName && (
                          <span className="text-[var(--ff-text-tertiary)]">
                            {visit.contractorName}
                          </span>
                        )}
                      </div>

                      {visit.notes && (
                        <p className="mt-1 text-xs text-[var(--ff-text-tertiary)] italic">{visit.notes}</p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
