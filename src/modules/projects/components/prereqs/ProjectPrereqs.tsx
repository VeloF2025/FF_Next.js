/**
 * Project Pre-requisites Component
 *
 * Checklist grouped by phase (accordion).
 * Each item has: checkbox, description, responsible party badge,
 * date completed, notes field.
 *
 * WCAG 2.1 AA — refactored 2026-02-21
 *   Uses AccessibleAccordion, ProgressBar, AccessibleCheckbox from @/components/accessible
 */

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import toast from 'react-hot-toast';
import { formatDisplayDateShort } from '@/utils/dateFormat';
import type {
  PrereqsResponse,
  PrereqPhaseGroup,
  PrereqItem,
} from '@/types/pon-stages.types';
import {
  AccessibleAccordion,
  AccessibleCheckbox,
  ProgressBar,
  PREREQ_THRESHOLDS,
  type AccordionItemConfig,
} from '@/components/accessible';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

interface ProjectPrereqsProps {
  projectId: string;
}

/** Maps requirement_type to the project tab where it can be completed */
const PREREQ_TAB_MAP: Record<string, string> = {
  // --- Activation-check seeded items ---
  client_po: 'documents',
  boq_approved: 'boq',
  budget_approved: 'budget',
  contractor_appointed: 'team',
  sow_signed: 'agreements',
  mba_signed: 'agreements',
  hs_verified: 'hs',
  team_assigned: 'team',
  wayleave: 'wayleaves',
  permit: 'wayleaves',
  client_agreement: 'agreements',
  documentation: 'documents',
  drops_complete: 'sow',
  qa_passed: 'pon-stages',
  sow_uploaded: 'sow',
  hs_compliance: 'hs',
  contractor_signed: 'agreements',
  // --- VF Standard template items ---
  po_received: 'documents',
  bss_signed: 'documents',
  mss_signed: 'documents',
  hld_complete: 'documents',
  lld_complete: 'documents',
  survey_contractor: 'team',
  wayleave_submitted: 'wayleaves',
  wayleave_approved: 'wayleaves',
  environmental_assessment: 'wayleaves',
  traffic_management: 'wayleaves',
  permits_obtained: 'wayleaves',
  safety_file: 'hs',
  risk_assessment: 'hs',
  insurance_verified: 'hs',
  contractor_sow_signed: 'agreements',
  contractor_mba_signed: 'agreements',
  teams_inducted: 'team',
  ppe_issued: 'hs',
  training_complete: 'team',
  materials_staged: 'procurement',
  as_built_submitted: 'documents',
  // Key milestones → PON stages
  first_pole_planted: 'pon-stages',
  first_pon_strung: 'pon-stages',
  first_splice_complete: 'pon-stages',
  first_home_connected: 'pon-stages',
  first_activation: 'pon-stages',
  '25_pct_activation': 'pon-stages',
  '50_pct_activation': 'pon-stages',
  '75_pct_activation': 'pon-stages',
  '90_pct_activation': 'pon-stages',
};

const PARTY_COLORS: Record<string, string> = {
  velocity: 'bg-blue-500/20 text-blue-400',
  fibertime: 'bg-purple-500/20 text-purple-400',
  client: 'bg-amber-500/20 text-amber-400',
};

// ─── PrereqItemRow ────────────────────────────────────────────────────────────

function PrereqItemRow({
  item,
  onToggle,
  onUpdateNotes,
  onNavigate,
}: {
  item: PrereqItem;
  onToggle: (id: string, completed: boolean) => void;
  onUpdateNotes: (id: string, notes: string) => void;
  onNavigate?: (tab: string) => void;
}) {
  const [showNotes, setShowNotes] = useState(false);
  const [notes, setNotes] = useState(item.notes || '');
  const targetTab = PREREQ_TAB_MAP[item.requirement_type];

  const partyColor = item.responsible_party
    ? PARTY_COLORS[item.responsible_party] || 'bg-gray-500/20 text-gray-400'
    : '';

  // Unique IDs for aria relationships
  const nameId = `prereq-name-${item.id}`;
  const hintId = item.auto_status === 'auto' ? `prereq-hint-${item.id}` : undefined;
  const notesId = `prereq-notes-${item.id}`;

  return (
    <div
      className={`border-b border-[var(--ff-border-light)] last:border-0 ${
        item.is_completed ? 'opacity-70' : ''
      }`}
    >
      <div className="flex items-center gap-3 px-4 py-3">
        {/* ── Checkbox (WCAG: real input, labelled by name span) ── */}
        <AccessibleCheckbox
          id={`prereq-check-${item.id}`}
          checked={item.is_completed}
          onChange={(checked) =>
            item.auto_status !== 'auto' && onToggle(item.id, checked)
          }
          labelledById={nameId}
          describedById={hintId}
          readOnly={item.auto_status === 'auto'}
          readOnlyTitle="Auto-detected from project data"
          size="md"
        />

        {/* ── Description ── */}
        <div className="flex-1 min-w-0 flex items-center gap-1.5">
          {targetTab && onNavigate && (!item.is_completed || item.auto_status === 'auto') ? (
            <button
              id={nameId}
              type="button"
              onClick={() => onNavigate(targetTab)}
              className="text-sm text-[var(--ff-text-primary)] hover:text-blue-400 hover:underline transition-colors text-left focus:outline-none focus:ring-2 focus:ring-[var(--ff-accent)] rounded"
            >
              {item.requirement_name}
            </button>
          ) : (
            <span
              id={nameId}
              className={`text-sm ${
                item.is_completed
                  ? 'line-through text-[var(--ff-text-secondary)]'
                  : 'text-[var(--ff-text-primary)]'
              }`}
            >
              {item.requirement_name}
            </span>
          )}

          {item.auto_status === 'auto' && (
            <span
              id={hintId}
              className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 whitespace-nowrap"
            >
              Auto
            </span>
          )}
        </div>

        {/* ── Responsible party badge ── */}
        {item.responsible_party && (
          <span className={`text-xs px-2 py-0.5 rounded-full ${partyColor}`}>
            {item.responsible_party}
          </span>
        )}

        {/* ── Completed date ── */}
        {item.completed_at && (
          <span className="text-xs text-[var(--ff-text-secondary)]">
            {formatDisplayDateShort(item.completed_at)}
          </span>
        )}

        {/* ── Notes toggle (WCAG: aria-label, aria-expanded, aria-controls) ── */}
        <button
          type="button"
          onClick={() => setShowNotes((v) => !v)}
          aria-label={`${showNotes ? 'Hide' : 'Show'} notes for ${item.requirement_name}`}
          aria-expanded={showNotes}
          aria-controls={notesId}
          className="text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] p-1 rounded focus:outline-none focus:ring-2 focus:ring-[var(--ff-accent)]"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z"
            />
          </svg>
        </button>
      </div>

      {/* ── Notes area ── */}
      <div id={notesId} hidden={!showNotes} className="px-4 pb-3 pl-12">
        <label
          htmlFor={`notes-textarea-${item.id}`}
          className="sr-only"
        >
          Notes for {item.requirement_name}
        </label>
        <textarea
          id={`notes-textarea-${item.id}`}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => onUpdateNotes(item.id, notes)}
          placeholder="Add notes..."
          rows={2}
          className="w-full text-sm bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded px-3 py-2 text-[var(--ff-text-primary)] placeholder:text-[var(--ff-text-secondary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-accent)] focus:border-transparent"
        />
      </div>
    </div>
  );
}

// ─── PhaseHeader ──────────────────────────────────────────────────────────────

function PhaseHeader({
  group,
  isExpanded,
  headingId,
}: {
  group: PrereqPhaseGroup;
  isExpanded: boolean;
  headingId: string;
}) {
  return (
    <div className="w-full flex items-center justify-between">
      <div className="flex items-center gap-3">
        <svg
          className={`w-3 h-3 text-[var(--ff-text-secondary)] transition-transform ${
            isExpanded ? 'rotate-90' : ''
          }`}
          fill="currentColor"
          viewBox="0 0 20 20"
          aria-hidden="true"
        >
          <path
            fillRule="evenodd"
            d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z"
            clipRule="evenodd"
          />
        </svg>
        <span id={headingId} className="font-medium text-[var(--ff-text-primary)]">
          {group.phase_label}
        </span>
        <span className="text-xs text-[var(--ff-text-secondary)]">
          {group.completed}/{group.total}
        </span>
      </div>
      <div className="flex items-center gap-3">
        <span
          className={`text-sm font-medium ${
            group.pct >= 100
              ? 'text-emerald-400'
              : group.pct > 0
              ? 'text-amber-400'
              : 'text-[var(--ff-text-secondary)]'
          }`}
          aria-hidden="true"
        >
          {group.pct}%
        </span>
        <ProgressBar
          value={group.pct}
          labelledById={headingId}
          thresholds={PREREQ_THRESHOLDS}
          size="sm"
          className="w-24"
        />
      </div>
    </div>
  );
}

// ─── ProjectPrereqs ───────────────────────────────────────────────────────────

export function ProjectPrereqs({ projectId }: ProjectPrereqsProps) {
  const router = useRouter();
  const [data, setData] = useState<PrereqsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedPhases, setExpandedPhases] = useState<Set<string>>(new Set());
  const [applying, setApplying] = useState(false);

  const handleNavigateToTab = useCallback(
    (tab: string) => {
      router.push(
        { pathname: router.pathname, query: { ...router.query, tab } },
        undefined,
        { shallow: true },
      );
    },
    [router],
  );

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/projects/${projectId}/prereqs`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error(`Failed to fetch: ${res.status}`);
      const json = await res.json();
      setData(json);
      setError(null);
      // Auto-expand phases with incomplete items
      const toExpand = new Set<string>();
      if (json.phases) {
        for (const phase of json.phases) {
          if (phase.pct < 100) toExpand.add(phase.phase);
        }
      }
      setExpandedPhases(toExpand);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load pre-requisites');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const togglePhase = (phase: string) => {
    setExpandedPhases((prev) => {
      const next = new Set(prev);
      if (next.has(phase)) next.delete(phase);
      else next.add(phase);
      return next;
    });
  };

  const handleToggleItem = async (reqId: string, completed: boolean) => {
    try {
      const res = await fetch(`/api/projects/${projectId}/prereqs`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ reqId, is_completed: completed }),
      });
      if (!res.ok) throw new Error('Failed to update');
      // Optimistic update
      setData((prev) => {
        if (!prev) return prev;
        const updated = { ...prev };
        for (const phase of updated.phases) {
          for (const item of phase.items) {
            if (item.id === reqId) {
              item.is_completed = completed;
              item.completed_at = completed ? new Date().toISOString() : null;
            }
          }
          phase.completed = phase.items.filter((i) => i.is_completed).length;
          phase.pct =
            phase.total > 0
              ? Math.round((phase.completed / phase.total) * 10000) / 100
              : 0;
        }
        updated.overall.completed = updated.phases.reduce(
          (sum, p) => sum + p.completed,
          0,
        );
        updated.overall.total = updated.phases.reduce(
          (sum, p) => sum + p.total,
          0,
        );
        updated.overall.pct =
          updated.overall.total > 0
            ? Math.round(
                (updated.overall.completed / updated.overall.total) * 10000,
              ) / 100
            : 0;
        return updated;
      });
    } catch {
      toast.error('Failed to update — please try again');
      fetchData();
    }
  };

  const handleUpdateNotes = async (reqId: string, notes: string) => {
    try {
      await fetch(`/api/projects/${projectId}/prereqs`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ reqId, notes }),
      });
    } catch {
      // Silent fail for notes
    }
  };

  const handleApplyTemplate = async () => {
    try {
      setApplying(true);
      const res = await fetch(`/api/projects/${projectId}/prereqs-apply-template`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ template_name: 'VF Standard' }),
      });
      if (!res.ok) throw new Error('Failed to apply template');
      const json = await res.json();
      if (json.success) fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to apply template');
    } finally {
      setApplying(false);
    }
  };

  // ── Loading / error / empty states ─────────────────────────────────────────

  if (loading) {
    return (
      <div className="bg-[var(--ff-card-bg)] rounded-lg border border-[var(--ff-border-light)] p-8">
        <div className="flex items-center justify-center gap-3">
          <LoadingSpinner size="sm" aria-label="Loading pre-requisites" />
          <span className="text-[var(--ff-text-secondary)]">Loading pre-requisites...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="bg-[var(--ff-card-bg)] rounded-lg border border-red-500/30 p-6"
        role="alert"
      >
        <p className="text-red-400">{error}</p>
        <button
          type="button"
          onClick={fetchData}
          className="mt-3 px-4 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!data || data.phases.length === 0) {
    return (
      <div className="bg-[var(--ff-card-bg)] rounded-lg border border-[var(--ff-border-light)] p-8 text-center">
        <p className="text-[var(--ff-text-secondary)] mb-4">
          No pre-requisites configured for this project.
        </p>
        <button
          type="button"
          onClick={handleApplyTemplate}
          disabled={applying}
          className="px-4 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          {applying ? 'Applying...' : 'Apply VF Standard Template (45 items)'}
        </button>
      </div>
    );
  }

  // ── Build accordion items ───────────────────────────────────────────────────

  const accordionItems: AccordionItemConfig[] = data.phases.map((group) => {
    const headingId = `phase-heading-${group.phase}`;
    return {
      id: group.phase,
      header: (isExpanded) => (
        <PhaseHeader group={group} isExpanded={isExpanded} headingId={headingId} />
      ),
      body: (
        <>
          {group.items.map((item) => (
            <PrereqItemRow
              key={item.id}
              item={item}
              onToggle={handleToggleItem}
              onUpdateNotes={handleUpdateNotes}
              onNavigate={handleNavigateToTab}
            />
          ))}
        </>
      ),
    };
  });

  const overallHeadingId = 'prereqs-overall-heading';

  return (
    <div className="space-y-4">
      {/* ── Overall progress header ── */}
      <div className="bg-[var(--ff-card-bg)] rounded-lg border border-[var(--ff-border-light)] p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3
              id={overallHeadingId}
              className="text-lg font-semibold text-[var(--ff-text-primary)]"
            >
              Project Pre-requisites
            </h3>
            <p className="text-sm text-[var(--ff-text-secondary)]">
              {data.overall.completed}/{data.overall.total} complete ({data.overall.pct}%)
            </p>
          </div>
        </div>
        <ProgressBar
          value={data.overall.pct}
          labelledById={overallHeadingId}
          thresholds={PREREQ_THRESHOLDS}
          size="md"
        />
      </div>

      {/* ── Phase accordions ── */}
      <AccessibleAccordion
        items={accordionItems}
        expandedIds={expandedPhases}
        onToggle={togglePhase}
      />
    </div>
  );
}

export default ProjectPrereqs;
