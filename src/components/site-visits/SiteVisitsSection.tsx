'use client';

/**
 * Site Visits Section
 * Table showing upcoming and past visits with schedule/complete actions.
 * Used on both project detail and contractor detail pages.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  CalendarDays, Plus, AlertCircle, CheckCircle2, XCircle,
  Clock, MapPin, User, ChevronDown,
} from 'lucide-react';
import { getSiteVisitsByProject, getSiteVisitsByContractor, updateSiteVisit } from '@/services/siteVisitsService';
import { ScheduleVisitModal } from './ScheduleVisitModal';
import { CompleteVisitModal } from './CompleteVisitModal';
import type {
  SiteVisitWithDetails,
  SiteVisitStatus,
  SiteVisitType,
} from '@/types/site-visit.types';
import { log } from '@/lib/logger';

// ==================== Labels & badges ====================

const VISIT_TYPE_LABELS: Record<SiteVisitType, string> = {
  inspection: 'Inspection',
  progress_check: 'Progress Check',
  handover: 'Handover',
  safety_audit: 'Safety Audit',
};

const STATUS_CONFIG: Record<SiteVisitStatus, { label: string; className: string; icon: React.ElementType }> = {
  scheduled:  { label: 'Scheduled',  className: 'bg-blue-500/20 text-blue-300 border-blue-500/30',   icon: Clock },
  completed:  { label: 'Completed',  className: 'bg-green-500/20 text-green-300 border-green-500/30', icon: CheckCircle2 },
  cancelled:  { label: 'Cancelled',  className: 'bg-red-500/20 text-red-300 border-red-500/30',       icon: XCircle },
  no_show:    { label: 'No Show',    className: 'bg-orange-500/20 text-orange-300 border-orange-500/30', icon: XCircle },
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

// ==================== Props ====================

interface SiteVisitsSectionProps {
  /** Pass projectId to load visits for a project */
  projectId?: string;
  projectName?: string;
  /** Pass contractorId to load visits for a contractor */
  contractorId?: string;
  contractorName?: string;
}

// ==================== Visit row ====================

interface VisitRowProps {
  visit: SiteVisitWithDetails;
  mode: 'project' | 'contractor';
  onComplete: (visit: SiteVisitWithDetails) => void;
  onCancel: (visitId: string) => void;
}

function VisitRow({ visit, mode, onComplete, onCancel }: VisitRowProps) {
  return (
    <div className="py-4 border-b border-[var(--ff-border-light)] last:border-0">
      <div className="flex items-start justify-between gap-4">
        {/* Left: date + type + status */}
        <div className="flex items-start gap-3 min-w-0">
          <div className="p-2 bg-blue-500/10 rounded-lg mt-0.5 flex-shrink-0">
            <CalendarDays className="h-4 w-4 text-blue-400" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-[var(--ff-text-primary)]">
                {VISIT_TYPE_LABELS[visit.visitType]}
              </span>
              <StatusBadge status={visit.status} />
            </div>

            <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-[var(--ff-text-secondary)]">
              <span className="flex items-center gap-1">
                <CalendarDays className="h-3 w-3" />
                {visit.status === 'completed' && visit.actualDate
                  ? `Completed ${visit.actualDate}`
                  : `Scheduled ${visit.scheduledDate}`}
              </span>
              <span className="flex items-center gap-1">
                <User className="h-3 w-3" />
                {visit.inspectorName}
              </span>
              {mode === 'project' && visit.contractorName && (
                <span className="flex items-center gap-1">
                  <MapPin className="h-3 w-3" />
                  {visit.contractorName}
                </span>
              )}
              {mode === 'contractor' && visit.projectName && (
                <span className="flex items-center gap-1">
                  <MapPin className="h-3 w-3" />
                  {visit.projectName}{visit.projectCode ? ` (${visit.projectCode})` : ''}
                </span>
              )}
            </div>

            {visit.findings && (
              <p className="mt-2 text-xs text-[var(--ff-text-secondary)] line-clamp-2 italic">
                {visit.findings}
              </p>
            )}

            {visit.actionItems.length > 0 && (
              <ul className="mt-2 space-y-0.5">
                {visit.actionItems.slice(0, 3).map((item, i) => (
                  <li key={i} className="text-xs text-[var(--ff-text-tertiary)] flex items-start gap-1">
                    <span className="mt-0.5 h-1.5 w-1.5 rounded-full bg-[var(--ff-text-tertiary)] flex-shrink-0" />
                    {item}
                  </li>
                ))}
                {visit.actionItems.length > 3 && (
                  <li className="text-xs text-[var(--ff-text-tertiary)]">
                    +{visit.actionItems.length - 3} more items
                  </li>
                )}
              </ul>
            )}
          </div>
        </div>

        {/* Right: actions */}
        {visit.status === 'scheduled' && (
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={() => onComplete(visit)}
              className="px-3 py-1.5 text-xs bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
            >
              Complete
            </button>
            <button
              onClick={() => onCancel(visit.id)}
              className="px-3 py-1.5 text-xs text-[var(--ff-text-secondary)] border border-[var(--ff-border-light)] rounded-lg hover:bg-[var(--ff-bg-tertiary)] transition-colors"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ==================== Main Component ====================

export function SiteVisitsSection({
  projectId,
  projectName,
  contractorId,
  contractorName,
}: SiteVisitsSectionProps) {
  const [visits, setVisits] = useState<SiteVisitWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<SiteVisitStatus | ''>('');
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [visitToComplete, setVisitToComplete] = useState<SiteVisitWithDetails | null>(null);
  const [showAll, setShowAll] = useState(false);

  const mode: 'project' | 'contractor' = projectId ? 'project' : 'contractor';

  const loadVisits = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let result: SiteVisitWithDetails[];
      if (projectId) {
        result = await getSiteVisitsByProject(projectId, {
          status: statusFilter || undefined,
        });
      } else if (contractorId) {
        result = await getSiteVisitsByContractor(contractorId, {
          status: statusFilter || undefined,
        });
      } else {
        result = [];
      }
      setVisits(result);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load site visits';
      log.error('Error loading site visits', { error: err }, 'SiteVisitsSection');
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [projectId, contractorId, statusFilter]);

  useEffect(() => {
    loadVisits();
  }, [loadVisits]);

  const handleCancelVisit = async (visitId: string) => {
    try {
      await updateSiteVisit(visitId, { status: 'cancelled' });
      await loadVisits();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to cancel visit';
      log.error('Error cancelling visit', { error: err, visitId }, 'SiteVisitsSection');
      setError(message);
    }
  };

  const displayedVisits = showAll ? visits : visits.slice(0, 10);
  const upcoming = visits.filter((v) => v.status === 'scheduled').length;
  const completed = visits.filter((v) => v.status === 'completed').length;

  if (loading) {
    return (
      <div className="bg-[var(--ff-bg-secondary)] p-6 rounded-lg border border-[var(--ff-border-light)]">
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-[var(--ff-bg-tertiary)] rounded w-1/4" />
          <div className="h-16 bg-[var(--ff-bg-tertiary)] rounded" />
          <div className="h-16 bg-[var(--ff-bg-tertiary)] rounded" />
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="bg-[var(--ff-bg-secondary)] p-6 rounded-lg border border-[var(--ff-border-light)]">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-xl font-bold text-[var(--ff-text-primary)] flex items-center gap-2">
              <CalendarDays className="h-5 w-5" />
              Site Visits
            </h2>
            <p className="text-sm text-[var(--ff-text-secondary)] mt-1">
              {visits.length} visit{visits.length !== 1 ? 's' : ''} &mdash;{' '}
              <span className="text-blue-400">{upcoming} upcoming</span>
              {' / '}
              <span className="text-green-400">{completed} completed</span>
            </p>
          </div>

          <button
            onClick={() => setShowScheduleModal(true)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm"
          >
            <Plus className="h-4 w-4" />
            Schedule Visit
          </button>
        </div>

        {/* Status filter */}
        <div className="flex flex-wrap gap-2 mb-4">
          {(['', 'scheduled', 'completed', 'cancelled', 'no_show'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1 text-xs rounded-full border transition-colors ${
                statusFilter === s
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'text-[var(--ff-text-secondary)] border-[var(--ff-border-light)] hover:bg-[var(--ff-bg-tertiary)]'
              }`}
            >
              {s === '' ? 'All' : STATUS_CONFIG[s].label}
            </button>
          ))}
        </div>

        {/* Error */}
        {error && (
          <div className="flex items-center gap-2 p-3 mb-4 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
            <AlertCircle className="h-4 w-4 flex-shrink-0" />
            {error}
          </div>
        )}

        {/* List */}
        {visits.length === 0 ? (
          <div className="text-center py-12 text-[var(--ff-text-tertiary)]">
            <CalendarDays className="h-12 w-12 mx-auto mb-3 opacity-50" />
            <p>No site visits found</p>
            <p className="text-sm mt-1">Click &ldquo;Schedule Visit&rdquo; to add the first visit</p>
          </div>
        ) : (
          <>
            <div>
              {displayedVisits.map((visit) => (
                <VisitRow
                  key={visit.id}
                  visit={visit}
                  mode={mode}
                  onComplete={setVisitToComplete}
                  onCancel={handleCancelVisit}
                />
              ))}
            </div>

            {visits.length > 10 && (
              <button
                onClick={() => setShowAll((prev) => !prev)}
                className="mt-4 flex items-center gap-1 text-sm text-blue-400 hover:text-blue-300"
              >
                <ChevronDown className={`h-4 w-4 transition-transform ${showAll ? 'rotate-180' : ''}`} />
                {showAll ? 'Show less' : `Show all ${visits.length} visits`}
              </button>
            )}
          </>
        )}
      </div>

      {/* Schedule Modal */}
      {showScheduleModal && (
        <ScheduleVisitModal
          projectId={projectId}
          projectName={projectName}
          contractorId={contractorId}
          contractorName={contractorName}
          onSuccess={(visit) => {
            setShowScheduleModal(false);
            loadVisits();
            void visit;
          }}
          onCancel={() => setShowScheduleModal(false)}
        />
      )}

      {/* Complete Modal */}
      {visitToComplete && (
        <CompleteVisitModal
          visit={visitToComplete}
          onSuccess={() => {
            setVisitToComplete(null);
            loadVisits();
          }}
          onCancel={() => setVisitToComplete(null)}
        />
      )}
    </>
  );
}
