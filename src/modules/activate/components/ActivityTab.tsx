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

export function ActivityTab({ dropNumber, feedbackSentAt }: ActivityTabProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('timeline');
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
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 dark:border-blue-400"></div>
        <span className="ml-3 text-gray-600 dark:text-gray-400">Loading activity...</span>
      </div>
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
        <div className="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <h4 className="font-medium text-gray-900 dark:text-white">Current Phase</h4>
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
                        : 'bg-gray-200 dark:bg-gray-700'
                    }`}
                  />
                </div>
              );
            })}
          </div>
          <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mt-1">
            <span>Submitted</span>
            <span>Complete</span>
          </div>
        </div>
      )}

      {/* View Toggle */}
      <div className="flex items-center justify-between">
        <div className="flex rounded-lg bg-gray-100 dark:bg-gray-800 p-1">
          <button
            onClick={() => setViewMode('timeline')}
            className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
              viewMode === 'timeline'
                ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow'
                : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
            }`}
          >
            📅 Timeline
          </button>
          <button
            onClick={() => setViewMode('history')}
            className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
              viewMode === 'history'
                ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow'
                : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
            }`}
          >
            📋 QA History ({reviews.length})
          </button>
          <button
            onClick={() => setViewMode('serials')}
            className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
              viewMode === 'serials'
                ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow'
                : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
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
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              {formatDate(feedbackSentAt)}
            </p>
          </div>
        )}
      </div>

      {/* Timeline View */}
      {viewMode === 'timeline' && (
        <div className="space-y-4">
          {timeline.length === 0 ? (
            <div className="text-center py-8 text-gray-500 dark:text-gray-400">
              <span className="text-4xl mb-4 block">📅</span>
              <p>No activity recorded yet</p>
            </div>
          ) : (
            <div className="relative">
              {/* Timeline Line */}
              <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-gray-200 dark:bg-gray-700" />

              {/* Timeline Events */}
              {timeline.map((entry, index) => (
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
                  <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-3">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <h5 className="font-medium text-gray-900 dark:text-white">
                          {entry.title}
                        </h5>
                        <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                          {entry.description}
                        </p>

                        {/* Show detailed changes for SERIAL_UPDATE events */}
                        {entry.eventType === 'SERIAL_UPDATE' && entry.metadata?.changes && (
                          <div className="mt-3 space-y-2 text-sm">
                            {(entry.metadata.changes as { ont?: { old: string; new: string }; ups?: { old: string; new: string } }).ont && (
                              <div className="flex items-center gap-2 p-2 bg-orange-50 dark:bg-orange-900/20 rounded border border-orange-200 dark:border-orange-800">
                                <span className="font-medium text-orange-700 dark:text-orange-300 w-12">ONT:</span>
                                <span className="text-gray-500 dark:text-gray-400 font-mono text-xs">
                                  {(entry.metadata.changes as { ont: { old: string; new: string } }).ont.old || 'null'}
                                </span>
                                <span className="text-orange-500">→</span>
                                <span className="text-gray-900 dark:text-white font-mono text-xs font-medium">
                                  {(entry.metadata.changes as { ont: { old: string; new: string } }).ont.new}
                                </span>
                              </div>
                            )}
                            {(entry.metadata.changes as { ont?: { old: string; new: string }; ups?: { old: string; new: string } }).ups && (
                              <div className="flex items-center gap-2 p-2 bg-orange-50 dark:bg-orange-900/20 rounded border border-orange-200 dark:border-orange-800">
                                <span className="font-medium text-orange-700 dark:text-orange-300 w-12">UPS:</span>
                                <span className="text-gray-500 dark:text-gray-400 font-mono text-xs">
                                  {(entry.metadata.changes as { ups: { old: string; new: string } }).ups.old || 'null'}
                                </span>
                                <span className="text-orange-500">→</span>
                                <span className="text-gray-900 dark:text-white font-mono text-xs font-medium">
                                  {(entry.metadata.changes as { ups: { old: string; new: string } }).ups.new}
                                </span>
                              </div>
                            )}
                            {entry.metadata.swap_corrected && (
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
                            <div className="mt-2 text-xs text-gray-600 dark:text-gray-400 font-mono">
                              <div>ONT field: {entry.metadata.ont_serial as string}</div>
                              <div>UPS field: {entry.metadata.ups_serial as string}</div>
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
                            <div className="mt-2 text-xs text-gray-600 dark:text-gray-400 font-mono">
                              <div>1Map shows: {entry.metadata.onemap_serial as string}</div>
                              <div>OES activated: {entry.metadata.oes_serial as string}</div>
                            </div>
                          </div>
                        )}
                      </div>
                      <div className="text-right ml-4 flex-shrink-0">
                        {/* Show "Detected" label for batch sync events */}
                        {entry.actor === 'batch_sync' && (
                          <span className="text-xs text-gray-400 dark:text-gray-500 block">
                            Detected:
                          </span>
                        )}
                        <span className="text-xs text-gray-500 dark:text-gray-400">
                          {formatDateTime(entry.timestamp)}
                        </span>
                        {entry.actor && (
                          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                            by {entry.actor === 'batch_sync' ? 'Auto Sync' : entry.actor}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* History View */}
      {viewMode === 'history' && (
        <>
          {/* No reviews */}
          {reviews.length === 0 && (
            <div className="text-center py-8 text-gray-500 dark:text-gray-400">
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
            : 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200 border-gray-200 dark:border-gray-600';

          return (
            <div
              key={review.id}
              className={`border rounded-lg overflow-hidden ${statusColor}`}
            >
              {/* Review Header - Clickable */}
              <button
                onClick={() => toggleExpand(review.id)}
                className="w-full px-4 py-3 flex items-center justify-between hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
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
                        <span className="px-1.5 py-0.5 text-xs rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400">
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
                    <div className="mt-4 p-3 bg-white/50 dark:bg-black/20 rounded-lg">
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
            <div className="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-4">
              <h4 className="font-medium text-gray-900 dark:text-white mb-3">Change Summary</h4>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
                <div className="p-3 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
                  <p className="text-2xl font-bold text-gray-900 dark:text-white">{serialSummary.total_changes}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">Total Changes</p>
                </div>
                <div className="p-3 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
                  <p className="text-2xl font-bold text-orange-600 dark:text-orange-400">{serialSummary.ont_changes}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">ONT Changes</p>
                </div>
                <div className="p-3 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
                  <p className="text-2xl font-bold text-purple-600 dark:text-purple-400">{serialSummary.ups_changes}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">UPS Changes</p>
                </div>
                <div className="p-3 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
                  <p className="text-2xl font-bold text-red-600 dark:text-red-400">{serialSummary.swaps_detected}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">Swaps Detected</p>
                </div>
              </div>
              {serialSummary.first_recorded && (
                <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
                  Tracking since {formatDate(serialSummary.first_recorded)}
                </p>
              )}
            </div>
          )}

          {/* Serial Change History */}
          {serialHistory.length === 0 ? (
            <div className="text-center py-8 text-gray-500 dark:text-gray-400">
              <span className="text-4xl mb-4 block">🔢</span>
              <p>No serial changes recorded yet</p>
              <p className="text-sm mt-2">Changes will be tracked when serials are updated</p>
            </div>
          ) : (
            <div className="space-y-3">
              <h4 className="font-medium text-gray-900 dark:text-white">Change History</h4>
              {serialHistory.map((entry) => {
                const isOnt = entry.change_type === 'ont_serial';
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

                return (
                  <div
                    key={entry.id}
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
                            <span className="text-xs px-2 py-0.5 bg-gray-200 dark:bg-gray-700 rounded text-gray-600 dark:text-gray-300">
                              {sourceLabel[entry.change_source] || entry.change_source}
                            </span>
                          </div>
                          {/* Value Change */}
                          <div className="mt-2 flex items-baseline gap-2 text-sm font-mono flex-wrap">
                            <span className="text-gray-500 dark:text-gray-400 break-all" title={entry.old_value || 'null'}>
                              {entry.old_value || '(empty)'}
                            </span>
                            <span className={`shrink-0 ${isOnt ? 'text-orange-500' : 'text-purple-500'}`}>→</span>
                            <span className="font-medium text-gray-900 dark:text-white break-all" title={entry.new_value || 'null'}>
                              {entry.new_value || '(empty)'}
                            </span>
                          </div>
                          {/* Reason */}
                          {entry.change_reason && (
                            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                              Reason: {reasonLabel[entry.change_reason] || entry.change_reason}
                            </p>
                          )}
                          {/* Swap indicator */}
                          {entry.metadata?.swap_detected && (
                            <div className="mt-2 flex items-center gap-1 text-xs text-red-600 dark:text-red-400">
                              <span>⚠️</span>
                              <span>Swap pattern detected at time of change</span>
                            </div>
                          )}
                        </div>
                      </div>
                      {/* Timestamp & Actor */}
                      <div className="text-right text-xs text-gray-500 dark:text-gray-400">
                        <p>{formatDateTime(entry.detected_at)}</p>
                        <p className="mt-1">by {entry.actor}</p>
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
