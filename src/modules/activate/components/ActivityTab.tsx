/**
 * ActivityTab Component
 *
 * Shows QA review history, comments, and activity timeline for a DR.
 * Data sources:
 * - qa_review_history table (imported from Excel)
 * - dr_photo_unified_reviews.feedback_sent_at
 *
 * Following FibreFlow UI/UX patterns with TailwindCSS
 */

'use client';

import { useState, useEffect } from 'react';
import { STEP_LABELS } from '../types/unified.types';

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
}

interface ActivityTabProps {
  dropNumber: string;
  feedbackSentAt?: string | null;
}

export function ActivityTab({ dropNumber, feedbackSentAt }: ActivityTabProps) {
  const [reviews, setReviews] = useState<QAReviewHistory[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedReviews, setExpandedReviews] = useState<Set<string>>(new Set());

  useEffect(() => {
    async function fetchHistory() {
      setIsLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/qa-review-history?dropNumber=${dropNumber}`);
        const data = await res.json();
        if (data.success) {
          setReviews(data.reviews);
        } else {
          setError(data.error || 'Failed to fetch history');
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setIsLoading(false);
      }
    }
    fetchHistory();
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
      return new Date(dateStr).toLocaleDateString('en-ZA', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
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

  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
              Review History
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {reviews.length} review{reviews.length !== 1 ? 's' : ''} found
            </p>
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
      </div>

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
                    <div className="font-medium">
                      {formatDate(review.review_date)}
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
    </div>
  );
}
