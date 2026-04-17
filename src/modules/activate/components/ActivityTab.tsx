/**
 * ActivityTab Component
 *
 * Shows activity timeline and QA review history for a DR.
 * Data sources:
 * - dr_activity_log table (new - Phase 3 workflow events)
 * - qa_review_history table (imported from Excel)
 * - dr_photo_unified_reviews.feedback_sent_at
 *
 * Following PAI 3-Phase QA Workflow (wobbly-leaping-sparkle.md)
 */

'use client';

import { useState, useEffect } from 'react';
import { STEP_LABELS } from '../types/unified.types';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

// ============================================================================
// ACTIVITY TIMELINE TYPES
// ============================================================================

interface TimelineEntry {
  id: string;
  timestamp: string;
  eventType: string;
  title: string;
  description: string;
  icon: string;
  iconColor: string;
  actor: string | null;
  metadata?: Record<string, unknown>;
  change_reason?: string;
  change_source?: string;
  change_type?: string;
  detected_at?: string;
  new_value?: string;
  old_value?: string;
}

interface ActivitySummary {
  drNumber: string;
  totalEvents: number;
  currentPhase: 'submitted' | 'categorizing' | 'qa_validation' | 'human_review' | 'complete';
  phaseTimestamps: {
    submitted?: string;
    categorized?: string;
    qaStarted?: string;
    qaCompleted?: string;
    reviewStarted?: string;
    reviewCompleted?: string;
    feedbackSent?: string;
  };
}

interface QAReviewHistory {
  id: string;
  drop_number: string;
  project: string;
  review_date: string | null;
  reviewer: string | null;
  step_01_house_photo: boolean;
  step_02_cable_from_pole: boolean;
  step_03_cable_entry_outside: boolean;
  step_04_cable_entry_inside: boolean;
  step_05_wall_installation: boolean;
  step_06_ont_back: boolean;
  step_07_power_meter: boolean;
  step_08_final_installation: boolean;
  step_09_green_lights: boolean;
  step_10_signature: boolean;
  completed_photos: number | null;
  outstanding_photos: number | null;
  pass_fail: string | null;
  percent_complete: string | null;
  comment: string | null;
  steps_passed: number;
  steps_total: number;
  steps_percent: number;
  imported_at: string;
  source?: 'excel_import' | 'desktop_qa';
}

interface SerialHistoryEntry {
  id: string;
  drop_number: string;
  change_type: 'ont_serial' | 'ups_serial';
  old_value: string | null;
  new_value: string | null;
  change_source: string;
  change_reason: string | null;
  actor: string;
  metadata: Record<string, unknown>;
  detected_at: string;
}

interface SerialHistorySummary {
  total_changes: number;
  ont_changes: number;
  ups_changes: number;
  swaps_detected: number;
  first_recorded: string | null;
  last_change: string | null;
}

interface ActivityTabProps {
  dropNumber: string;
  feedbackSentAt?: string | null;
}

type ViewMode = 'timeline' | 'history' | 'serials';

// Timeline filter chips. Maps a user-facing category to the set of event types
// that belong to it. "All" is the default and skips filtering entirely.
type TimelineCategory = 'all' | 'oes' | '1map' | 'wa_qa' | 'billing' | 'tickets' | 'pre_prov' | 'anomaly';

const TIMELINE_CATEGORY_MEMBERS: Record<Exclude<TimelineCategory, 'all'>, ReadonlyArray<string>> = {
  oes: ['oes_activated', 'SWAP_DETECTED'],
  '1map': [
    'SERIAL_UPDATE', 'SERIAL_VERIFIED', 'SERIAL_CONFIRMED', 'SERIAL_VERIFICATION_COMPUTED',
    'MANUAL_SERIAL_EDIT', 'INVESTIGATE', 'INSTALLATION_MISMATCH', 'STATUS_UPDATE',
    'SERIAL_HISTORY_ENTRY', 'ONT_SWAP_REPORTED',
    'serial_reconciled', '1map_write_rejected',
  ],
  wa_qa: [
    'whatsapp_submitted', 'dr_acknowledged', 'photos_fetched', 'PHOTOS_SYNCED',
    'attribute_categorized', 'vlm_qa_started', 'vlm_qa_completed', 'vlm_qa_failed',
    'WA_PHOTO_VLM_PROCESSED', 'human_review_started', 'human_review_completed',
    'step_approved', 'step_rejected', 'AUTO_QA_COMPLETED', 'AUTO_QA_RESET',
    'HITL_STEP_CORRECTION', 'HITL_PASSFAIL_CORRECTION', 'HITL_COMMENT_CORRECTION',
    'feedback_generated', 'feedback_sent',
  ],
  billing: ['non_invoiceable_flagged', 'non_invoiceable_resolved'],
  tickets: ['ticket_created', 'ticket_status_changed', 'ticket_auto_closed',
            'INVESTIGATION_RESOLVED', 'ESCALATED_TO_ADMIN'],
  pre_prov: ['pre_prov_added', 'pre_prov_resolved'],
  anomaly: ['anomaly_fixed_still_billed', 'anomaly_persistent_note', 'anomaly_stale_pp', 'error'],
};

const TIMELINE_CATEGORY_LABELS: Record<TimelineCategory, { label: string; icon: string }> = {
  all: { label: 'All', icon: '📅' },
  oes: { label: 'OES', icon: '⚡' },
  '1map': { label: '1Map', icon: '🗺️' },
  wa_qa: { label: 'WhatsApp / QA', icon: '📱' },
  billing: { label: 'Billing', icon: '💰' },
  tickets: { label: 'Tickets', icon: '🎫' },
  pre_prov: { label: 'Pre-Prov', icon: '⏳' },
  anomaly: { label: 'Anomalies', icon: '⚠️' },
};

/**
 * Compute the source-record link for a timeline entry. Returns {href, label}
 * when the event_data carries enough context to deep-link to the thing that
 * produced it (ticket detail, billing week, etc). Returns null otherwise.
 *
 * The link targets the same app (not a new tab) so the back button returns to
 * the DR detail page. Callers render this as a small button next to the
 * timestamp.
 */
function deepLinkForEntry(
  entry: TimelineEntry,
): { href: string; label: string } | null {
  const data = (entry.metadata as Record<string, unknown> | undefined) ?? {};

  // Ticket events → NOC ticket detail
  if (
    entry.eventType === 'ticket_created' ||
    entry.eventType === 'ticket_status_changed' ||
    entry.eventType === 'ticket_auto_closed'
  ) {
    const id = typeof data.ticketId === 'string' ? data.ticketId : null;
    const uid = typeof data.ticketUid === 'string' ? data.ticketUid : null;
    if (id) return { href: `/noc/tickets/${id}`, label: uid ? `Open ${uid}` : 'Open ticket' };
  }

  // Billing / anomaly events → weekly billing summary, scrolled to the week
  if (
    entry.eventType === 'non_invoiceable_flagged' ||
    entry.eventType === 'non_invoiceable_resolved' ||
    entry.eventType === 'anomaly_fixed_still_billed'
  ) {
    const week = typeof data.weekEnding === 'string' ? data.weekEnding.slice(0, 10) : null;
    const base = '/activate/data-sync?group=billing&tab=summary';
    return {
      href: week ? `${base}&week=${week}` : base,
      label: week ? `Open week ${week}` : 'Open billing',
    };
  }

  return null;
}

export function ActivityTab({ dropNumber, feedbackSentAt }: ActivityTabProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('timeline');
  const [timelineCategory, setTimelineCategory] = useState<TimelineCategory>('all');
  const [exporting, setExporting] = useState(false);
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [summary, setSummary] = useState<ActivitySummary | null>(null);
  const [reviews, setReviews] = useState<QAReviewHistory[]>([]);
  const [serialHistory, setSerialHistory] = useState<SerialHistoryEntry[]>([]);
  const [serialSummary, setSerialSummary] = useState<SerialHistorySummary | null>(null);
  const [currentSerials, setCurrentSerials] = useState<{ current_ont: string | null; current_ups: string | null } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedReviews, setExpandedReviews] = useState<Set<string>>(new Set());

  // Fetch both timeline and history
  useEffect(() => {
    async function fetchData() {
      setIsLoading(true);
      setError(null);

      try {
        // Fetch timeline, history, and serial history in parallel
        const [timelineRes, summaryRes, historyRes, serialRes] = await Promise.all([
          fetch(`/api/activate/activity-log?dropNumber=${dropNumber}`),
          fetch(`/api/activate/activity-log?dropNumber=${dropNumber}&summary=true`),
          fetch(`/api/qa-review-history?dropNumber=${dropNumber}`),
          fetch(`/api/activate/serial-history?dropNumber=${dropNumber}`),
        ]);

        // Process timeline
        if (timelineRes.ok) {
          const timelineData = await timelineRes.json();
          if (timelineData.success) {
            setTimeline(timelineData.data?.timeline || []);
          }
        }

        // Process summary
        if (summaryRes.ok) {
          const summaryData = await summaryRes.json();
          if (summaryData.success) {
            setSummary(summaryData.data);
          }
        }

        // Process history
        if (historyRes.ok) {
          const historyData = await historyRes.json();
          if (historyData.success) {
            setReviews(historyData.reviews || []);
          }
        }

        // Process serial history
        if (serialRes.ok) {
          const serialData = await serialRes.json();
          if (serialData.success && serialData.data) {
            setSerialHistory(serialData.data.history || []);
            setSerialSummary(serialData.data.summary || null);
            setCurrentSerials(serialData.data.current || null);
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setIsLoading(false);
      }
    }
    fetchData();
  }, [dropNumber]);

  const toggleExpand = (id: string) => {
    setExpandedReviews(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  };

  const exportPdf = async (): Promise<void> => {
    if (exporting || timeline.length === 0) return;
    setExporting(true);
    try {
      const [{ generateDrTimelinePdf, triggerDrTimelineDownload }, contextRes] = await Promise.all([
        import('@/modules/activate/utils/exportDrTimelinePdf'),
        fetch(`/api/activate/dr/${dropNumber}/pdf-context`).catch(() => null),
      ]);

      // Best-effort context — if the endpoint isn't available, the PDF
      // still renders with just the timeline rows.
      let ctx: {
        project?: string | null;
        team?: string | null;
        oesSerial?: string | null;
        oesActivatedAt?: string | null;
        lastFixSerial?: string | null;
        lastFixAt?: string | null;
        latestBillingNote?: string | null;
        latestBillingWeek?: string | null;
      } = {};
      if (contextRes && contextRes.ok) {
        const j = await contextRes.json().catch(() => null);
        if (j?.success && j.data) ctx = j.data;
      }

      const blob = await generateDrTimelinePdf({
        drNumber,
        project: ctx.project ?? null,
        team: ctx.team ?? null,
        oesSerial: ctx.oesSerial ?? null,
        oesActivatedAt: ctx.oesActivatedAt ?? null,
        lastFixSerial: ctx.lastFixSerial ?? null,
        lastFixAt: ctx.lastFixAt ?? null,
        latestBillingNote: ctx.latestBillingNote ?? null,
        latestBillingWeek: ctx.latestBillingWeek ?? null,
        generatedAt: new Date().toISOString(),
        generatedBy: 'FibreFlow Timeline Export',
        timeline: timeline.map((e) => ({
          timestamp: e.timestamp,
          title: e.title,
          description: e.description,
          actor: e.actor,
          eventType: e.eventType,
        })),
      });
      triggerDrTimelineDownload(blob, dropNumber);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'PDF export failed');
    } finally {
      setExporting(false);
    }
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return 'N/A';
    try {
      // Standard YYYY-MM-DD format
      return new Date(dateStr).toISOString().split('T')[0];
    } catch {
      return dateStr;
    }
  };

  const formatDateTime = (dateStr: string | null) => {
    if (!dateStr) return 'N/A';
    try {
      return new Date(dateStr).toLocaleString('en-ZA', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return dateStr;
    }
  };

  if (isLoading) {
    return (
      <LoadingSpinner className="py-12" size="lg" label="Loading activity..." />
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
        <p className="text-red-600 dark:text-red-400">{error}</p>
      </div>
    );
  }

  // Phase labels for summary
  const phaseLabels: Record<string, string> = {
    submitted: 'Submitted',
    categorizing: 'Categorizing',
    qa_validation: 'QA Validation',
    human_review: 'Human Review',
    complete: 'Complete',
  };

  return (
    <div className="space-y-6">
      {/* Phase Progress (if summary available) */}
      {summary && (
        <div className="bg-background/50 rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <h4 className="font-medium text-foreground">Current Phase</h4>
            <span className={`px-3 py-1 rounded-full text-sm font-medium ${
              summary.currentPhase === 'complete'
                ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-200'
                : 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-200'
            }`}>
              {phaseLabels[summary.currentPhase] || summary.currentPhase}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {['submitted', 'categorizing', 'qa_validation', 'human_review', 'complete'].map((phase, index) => {
              const isActive = summary.currentPhase === phase;
              const isPast = ['submitted', 'categorizing', 'qa_validation', 'human_review', 'complete']
                .indexOf(summary.currentPhase) > index;
              return (
                <div key={phase} className="flex-1 flex items-center">
                  <div
                    className={`w-full h-2 rounded-full ${
                      isActive
                        ? 'bg-blue-500 dark:bg-blue-400'
                        : isPast
                        ? 'bg-green-500 dark:bg-green-400'
                        : 'bg-secondary'
                    }`}
                  />
                </div>
              );
            })}
          </div>
          <div className="flex justify-between text-xs text-muted-foreground mt-1">
            <span>Submitted</span>
            <span>Complete</span>
          </div>
        </div>
      )}

      {/* View Toggle */}
      <div className="flex items-center justify-between">
        <div className="flex rounded-lg bg-secondary p-1">
          <button
            onClick={() => setViewMode('timeline')}
            className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
              viewMode === 'timeline'
                ? 'bg-card text-foreground shadow'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            📅 Timeline
          </button>
          <button
            onClick={() => setViewMode('history')}
            className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
              viewMode === 'history'
                ? 'bg-card text-foreground shadow'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            📋 QA History ({reviews.length})
          </button>
          <button
            onClick={() => setViewMode('serials')}
            className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
              viewMode === 'serials'
                ? 'bg-card text-foreground shadow'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            🔢 Serial History ({serialHistory.length})
          </button>
        </div>
        {feedbackSentAt && (
          <div className="text-right">
            <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-200">
              ✓ Feedback Sent
            </span>
            <p className="text-xs text-muted-foreground mt-1">
              {formatDate(feedbackSentAt)}
            </p>
          </div>
        )}
      </div>

      {/* Timeline View */}
      {viewMode === 'timeline' && (
        <div className="space-y-4">
          {/* Category filter chips + export action */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap gap-2 flex-1">
              {(Object.keys(TIMELINE_CATEGORY_LABELS) as TimelineCategory[]).map((key) => {
              const { label, icon } = TIMELINE_CATEGORY_LABELS[key];
              const count =
                key === 'all'
                  ? timeline.length
                  : timeline.filter((e) => TIMELINE_CATEGORY_MEMBERS[key].includes(e.eventType)).length;
              const isActive = timelineCategory === key;
              return (
                <button
                  key={key}
                  onClick={() => setTimelineCategory(key)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                    isActive
                      ? 'bg-blue-600 border-blue-600 text-white'
                      : 'bg-transparent border-border text-muted-foreground hover:bg-secondary hover:text-foreground'
                  }`}
                >
                  <span>{icon}</span>
                  <span>{label}</span>
                  <span
                    className={`ml-0.5 rounded-full px-1.5 tabular-nums ${
                      isActive ? 'bg-blue-700 text-white' : 'bg-secondary text-muted-foreground'
                    }`}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
            </div>
            <button
              onClick={() => exportPdf()}
              disabled={exporting || timeline.length === 0}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border border-border bg-secondary text-foreground hover:bg-card transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
              title="Download a PDF of this DR's timeline for disputes"
            >
              📄 {exporting ? 'Exporting…' : 'Export PDF'}
            </button>
          </div>

          {(() => {
            const filteredTimeline =
              timelineCategory === 'all'
                ? timeline
                : timeline.filter((e) =>
                    TIMELINE_CATEGORY_MEMBERS[timelineCategory].includes(e.eventType),
                  );

            if (filteredTimeline.length === 0) {
              return (
                <div className="text-center py-8 text-muted-foreground">
                  <span className="text-4xl mb-4 block">📅</span>
                  <p>
                    {timelineCategory === 'all'
                      ? 'No activity recorded yet'
                      : `No "${TIMELINE_CATEGORY_LABELS[timelineCategory].label}" events for this DR yet`}
                  </p>
                </div>
              );
            }

            return (
              <div className="relative">
                {/* Timeline Line */}
                <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-secondary" />

                {/* Timeline Events */}
                {filteredTimeline.map((entry, _index) => {
                const meta = entry.metadata as Record<string, unknown> | undefined;
                return (
                <div key={entry.id} className="relative pl-10 pb-6">
                  {/* Timeline Dot */}
                  <div className={`absolute left-2 w-5 h-5 rounded-full border-2 border-white dark:border-gray-800 flex items-center justify-center text-xs ${
                    entry.eventType === 'error'
                      ? 'bg-red-500'
                      : entry.eventType.includes('completed') || entry.eventType.includes('approved')
                      ? 'bg-green-500'
                      : entry.eventType.includes('started') || entry.eventType.includes('processing')
                      ? 'bg-blue-500'
                      : 'bg-gray-400'
                  }`}>
                    <span className="text-white">{entry.icon}</span>
                  </div>

                  {/* Event Card */}
                  <div className="bg-card border border-border rounded-lg p-3">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <h5 className="font-medium text-foreground">
                          {entry.title}
                        </h5>
                        <p className="text-sm text-muted-foreground mt-1">
                          {entry.description}
                        </p>

                        {/* Show detailed changes for SERIAL_UPDATE events */}
                        {entry.eventType === 'SERIAL_UPDATE' && Boolean(meta?.changes) && (
                          <div className="mt-3 space-y-2 text-sm">
                            {(meta?.changes as { ont?: { old: string; new: string }; ups?: { old: string; new: string } }).ont && (
                              <div className="flex items-center gap-2 p-2 bg-orange-50 dark:bg-orange-900/20 rounded border border-orange-200 dark:border-orange-800">
                                <span className="font-medium text-orange-700 dark:text-orange-300 w-12">ONT:</span>
                                <span className="text-muted-foreground font-mono text-xs">
                                  {(meta?.changes as { ont: { old: string; new: string } }).ont.old || 'null'}
                                </span>
                                <span className="text-orange-500">→</span>
                                <span className="text-foreground font-mono text-xs font-medium">
                                  {(meta?.changes as { ont: { old: string; new: string } }).ont.new}
                                </span>
                              </div>
                            )}
                            {(meta?.changes as { ont?: { old: string; new: string }; ups?: { old: string; new: string } }).ups && (
                              <div className="flex items-center gap-2 p-2 bg-orange-50 dark:bg-orange-900/20 rounded border border-orange-200 dark:border-orange-800">
                                <span className="font-medium text-orange-700 dark:text-orange-300 w-12">UPS:</span>
                                <span className="text-muted-foreground font-mono text-xs">
                                  {(meta?.changes as { ups: { old: string; new: string } }).ups.old || 'null'}
                                </span>
                                <span className="text-orange-500">→</span>
                                <span className="text-foreground font-mono text-xs font-medium">
                                  {(meta?.changes as { ups: { old: string; new: string } }).ups.new}
                                </span>
                              </div>
                            )}
                            {Boolean(meta?.swap_corrected) && (
                              <div className="flex items-center gap-2 mt-2 text-green-600 dark:text-green-400">
                                <span>✅</span>
                                <span className="font-medium">Swap was corrected by technician</span>
                              </div>
                            )}
                          </div>
                        )}

                        {/* Show details for SWAP_DETECTED events */}
                        {entry.eventType === 'SWAP_DETECTED' && entry.metadata && (
                          <div className="mt-3 p-2 bg-red-50 dark:bg-red-900/20 rounded border border-red-200 dark:border-red-800">
                            <div className="flex items-center gap-2 text-red-700 dark:text-red-300 text-sm">
                              <span>⚠️</span>
                              <span className="font-medium">Serials appear swapped!</span>
                            </div>
                            <div className="mt-2 text-xs text-muted-foreground font-mono">
                              <div>ONT field: {String(meta?.ont_serial ?? '')}</div>
                              <div>UPS field: {String(meta?.ups_serial ?? '')}</div>
                            </div>
                          </div>
                        )}

                        {/* Show details for INSTALLATION_MISMATCH events */}
                        {entry.eventType === 'INSTALLATION_MISMATCH' && entry.metadata && (
                          <div className="mt-3 p-2 bg-red-50 dark:bg-red-900/20 rounded border border-red-200 dark:border-red-800">
                            <div className="flex items-center gap-2 text-red-700 dark:text-red-300 text-sm">
                              <span>🔴</span>
                              <span className="font-medium">ONT replaced but not updated in 1Map</span>
                            </div>
                            <div className="mt-2 text-xs text-muted-foreground font-mono">
                              <div>1Map shows: {String(meta?.onemap_serial ?? '')}</div>
                              <div>OES activated: {String(meta?.oes_serial ?? '')}</div>
                            </div>
                          </div>
                        )}
                      </div>
                      <div className="text-right ml-4 flex-shrink-0">
                        {/* Show "Detected" label for batch sync events */}
                        {entry.actor === 'batch_sync' && (
                          <span className="text-xs text-gray-400 dark:text-muted-foreground block">
                            Detected:
                          </span>
                        )}
                        <span className="text-xs text-muted-foreground">
                          {formatDateTime(entry.timestamp)}
                        </span>
                        {entry.actor && (
                          <p className="text-xs text-gray-400 dark:text-muted-foreground mt-1">
                            by {entry.actor === 'batch_sync' ? 'Auto Sync' : entry.actor}
                          </p>
                        )}
                        {(() => {
                          const link = deepLinkForEntry(entry);
                          if (!link) return null;
                          return (
                            <a
                              href={link.href}
                              className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap"
                            >
                              {link.label}
                              <span aria-hidden="true">↗</span>
                            </a>
                          );
                        })()}
                      </div>
                    </div>
                  </div>
                </div>
              );
              })}
              </div>
            );
          })()}
        </div>
      )}

      {/* History View */}
      {viewMode === 'history' && (
        <>
          {/* No reviews */}
          {reviews.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              <span className="text-4xl mb-4 block">📋</span>
              <p>No review history found for this DR</p>
            </div>
          )}

      {/* Review Timeline */}
      <div className="space-y-4">
        {reviews.map((review) => {
          const isExpanded = expandedReviews.has(review.id);
          const passFail = review.pass_fail?.toLowerCase();
          const statusColor = passFail === 'pass'
            ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-200 border-green-200 dark:border-green-800'
            : passFail === 'fail'
            ? 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-200 border-red-200 dark:border-red-800'
            : 'bg-secondary text-foreground border-gray-200 dark:border-gray-600';

          return (
            <div
              key={review.id}
              className={`border rounded-lg overflow-hidden ${statusColor}`}
            >
              {/* Review Header - Clickable */}
              <button
                onClick={() => toggleExpand(review.id)}
                className="w-full px-4 py-3 flex items-center justify-between hover:bg-black/5 dark:hover:bg-card/5 transition-colors"
              >
                <div className="flex items-center gap-4">
                  <div className="text-left">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">
                        {formatDate(review.review_date)}
                      </span>
                      {/* Source Badge */}
                      {review.source === 'desktop_qa' ? (
                        <span className="px-1.5 py-0.5 text-xs rounded bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300">
                          Desktop QA
                        </span>
                      ) : (
                        <span className="px-1.5 py-0.5 text-xs rounded bg-secondary text-muted-foreground">
                          Excel Import
                        </span>
                      )}
                    </div>
                    <div className="text-sm opacity-75">
                      by {review.reviewer || 'Unknown'}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  {/* Pass/Fail Badge */}
                  {review.pass_fail && (
                    <span className={`px-2 py-1 rounded text-xs font-bold uppercase ${
                      passFail === 'pass' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'
                    }`}>
                      {review.pass_fail}
                    </span>
                  )}
                  {/* Steps Progress */}
                  <div className="text-right">
                    <div className="text-sm font-medium">
                      {review.steps_passed}/{review.steps_total} steps
                    </div>
                    <div className="text-xs opacity-75">
                      {review.steps_percent}% complete
                    </div>
                  </div>
                  {/* Expand Icon */}
                  <span className={`transform transition-transform ${isExpanded ? 'rotate-180' : ''}`}>
                    ▼
                  </span>
                </div>
              </button>

              {/* Expanded Content */}
              {isExpanded && (
                <div className="px-4 pb-4 border-t border-current/10">
                  {/* Comment */}
                  {review.comment && (
                    <div className="mt-4 p-3 bg-card/50 dark:bg-black/20 rounded-lg">
                      <div className="text-xs font-medium uppercase tracking-wide mb-1 opacity-60">
                        Comment
                      </div>
                      <p className="text-sm whitespace-pre-wrap">{review.comment}</p>
                    </div>
                  )}

                  {/* Steps Grid */}
                  <div className="mt-4">
                    <div className="text-xs font-medium uppercase tracking-wide mb-2 opacity-60">
                      QA Steps
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                      {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((step) => {
                        const stepKey = `step_${step.toString().padStart(2, '0')}_${
                          step === 1 ? 'house_photo' :
                          step === 2 ? 'cable_from_pole' :
                          step === 3 ? 'cable_entry_outside' :
                          step === 4 ? 'cable_entry_inside' :
                          step === 5 ? 'wall_installation' :
                          step === 6 ? 'ont_back' :
                          step === 7 ? 'power_meter' :
                          step === 8 ? 'final_installation' :
                          step === 9 ? 'green_lights' : 'signature'
                        }` as keyof QAReviewHistory;
                        const passed = review[stepKey] === true;

                        return (
                          <div
                            key={step}
                            className={`p-2 rounded text-xs ${
                              passed
                                ? 'bg-green-500/20 text-green-700 dark:text-green-300'
                                : 'bg-red-500/20 text-red-700 dark:text-red-300'
                            }`}
                          >
                            <span className="font-medium">{step}.</span>{' '}
                            {STEP_LABELS[step]}
                            <span className="ml-1">{passed ? '✓' : '✗'}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Photo Stats */}
                  <div className="mt-4 flex gap-4 text-sm">
                    {review.completed_photos !== null && (
                      <div>
                        <span className="opacity-60">Completed:</span>{' '}
                        <span className="font-medium">{review.completed_photos}</span>
                      </div>
                    )}
                    {review.outstanding_photos !== null && review.outstanding_photos > 0 && (
                      <div>
                        <span className="opacity-60">Outstanding:</span>{' '}
                        <span className="font-medium text-orange-600 dark:text-orange-400">
                          {review.outstanding_photos}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
          </div>
        </>
      )}

      {/* Serial History View */}
      {viewMode === 'serials' && (
        <div className="space-y-4">
          {/* Current Serials */}
          {currentSerials && (
            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
              <h4 className="font-medium text-blue-800 dark:text-blue-200 mb-3">Current Serials</h4>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <span className="text-xs text-blue-600 dark:text-blue-400 uppercase font-medium">ONT Serial</span>
                  <p className="font-mono text-sm text-blue-900 dark:text-blue-100 mt-1">
                    {currentSerials.current_ont || 'Not set'}
                  </p>
                </div>
                <div>
                  <span className="text-xs text-blue-600 dark:text-blue-400 uppercase font-medium">UPS Serial</span>
                  <p className="font-mono text-sm text-blue-900 dark:text-blue-100 mt-1">
                    {currentSerials.current_ups || 'Not set'}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Serial History Summary */}
          {serialSummary && serialSummary.total_changes > 0 && (
            <div className="bg-background/50 rounded-lg p-4">
              <h4 className="font-medium text-foreground mb-3">Change Summary</h4>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
                <div className="p-3 bg-card rounded-lg border border-border">
                  <p className="text-2xl font-bold text-foreground">{serialSummary.total_changes}</p>
                  <p className="text-xs text-muted-foreground">Total Changes</p>
                </div>
                <div className="p-3 bg-card rounded-lg border border-border">
                  <p className="text-2xl font-bold text-orange-600 dark:text-orange-400">{serialSummary.ont_changes}</p>
                  <p className="text-xs text-muted-foreground">ONT Changes</p>
                </div>
                <div className="p-3 bg-card rounded-lg border border-border">
                  <p className="text-2xl font-bold text-purple-600 dark:text-purple-400">{serialSummary.ups_changes}</p>
                  <p className="text-xs text-muted-foreground">UPS Changes</p>
                </div>
                <div className="p-3 bg-card rounded-lg border border-border">
                  <p className="text-2xl font-bold text-red-600 dark:text-red-400">{serialSummary.swaps_detected}</p>
                  <p className="text-xs text-muted-foreground">Swaps Detected</p>
                </div>
              </div>
              {serialSummary.first_recorded && (
                <p className="mt-3 text-xs text-muted-foreground">
                  Tracking since {formatDate(serialSummary.first_recorded)}
                </p>
              )}
            </div>
          )}

          {/* Serial Change History */}
          {serialHistory.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <span className="text-4xl mb-4 block">🔢</span>
              <p>No serial changes recorded yet</p>
              <p className="text-sm mt-2">Changes will be tracked when serials are updated</p>
            </div>
          ) : (
            <div className="space-y-3">
              <h4 className="font-medium text-foreground">Change History</h4>
              {serialHistory.map((entry: SerialHistoryEntry) => {
                const safeEntry = entry as SerialHistoryEntry;
                const isOnt = safeEntry.change_type === 'ont_serial';
                const sourceLabel: Record<string, string> = {
                  onemap_sync: '1Map Sync',
                  manual_edit: 'Manual Edit',
                  vlm_extraction: 'VLM Extraction',
                  wa_photo_vlm: 'WA Photo VLM',
                  swap_correction: 'Swap Correction',
                  migration: 'Initial Import',
                };
                const reasonLabel: Record<string, string> = {
                  technician_update: 'Technician Update',
                  swap_correction: 'Swap Correction',
                  replacement: 'Equipment Replaced',
                  data_fix: 'Data Fix',
                  initial_capture: 'Initial Capture',
                };
                
                const getReasonDisplay = (reason: string | null): string => {
                  if (!reason) return '';
                  return String(reasonLabel[reason as keyof typeof reasonLabel] ?? reason);
                };
                
                const reasonText: string = getReasonDisplay(safeEntry.change_reason);

                return (
                  <div
                    key={safeEntry.id}
                    className={`border rounded-lg p-4 ${
                      isOnt
                        ? 'border-orange-200 dark:border-orange-800 bg-orange-50/50 dark:bg-orange-900/10'
                        : 'border-purple-200 dark:border-purple-800 bg-purple-50/50 dark:bg-purple-900/10'
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-start gap-3">
                        {/* Icon */}
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                          isOnt ? 'bg-orange-500' : 'bg-purple-500'
                        }`}>
                          <span className="text-white text-sm">{isOnt ? 'O' : 'U'}</span>
                        </div>
                        {/* Content */}
                        <div>
                          <div className="flex items-center gap-2">
                            <span className={`font-medium ${
                              isOnt ? 'text-orange-700 dark:text-orange-300' : 'text-purple-700 dark:text-purple-300'
                            }`}>
                              {isOnt ? 'ONT Serial' : 'UPS Serial'}
                            </span>
                            <span className="text-xs px-2 py-0.5 bg-secondary rounded text-muted-foreground">
                              {sourceLabel[safeEntry.change_source] || safeEntry.change_source}
                            </span>
                          </div>
                          {/* Value Change */}
                          <div className="mt-2 flex items-baseline gap-2 text-sm font-mono flex-wrap">
                            <span className="text-muted-foreground break-all" title={safeEntry.old_value || 'null'}>
                              {safeEntry.old_value || '(empty)'}
                            </span>
                            <span className={`shrink-0 ${isOnt ? 'text-orange-500' : 'text-purple-500'}`}>→</span>
                            <span className="font-medium text-foreground break-all" title={safeEntry.new_value || 'null'}>
                              {safeEntry.new_value || '(empty)'}
                            </span>
                          </div>
                          {/* Reason */}
                          {reasonText ? (
                            <p className="mt-1 text-xs text-muted-foreground">
                              Reason: {reasonText}
                            </p>
                          ) : null}
                          {/* Swap indicator */}
                          {Boolean(safeEntry.metadata?.swap_detected) && (
                            <div className="mt-2 flex items-center gap-1 text-xs text-red-600 dark:text-red-400">
                              <span>⚠️</span>
                              <span>Swap pattern detected at time of change</span>
                            </div>
                          )}
                        </div>
                      </div>
                      {/* Timestamp & Actor */}
                      <div className="text-right text-xs text-muted-foreground">
                        <p>{formatDateTime(safeEntry.detected_at)}</p>
                        <p className="mt-1">by {safeEntry.actor}</p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
