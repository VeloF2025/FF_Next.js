/**
 * UnifiedReviewCard Component
 *
 * Main component for unified DR photo review with 4 tabs:
 * 1. Manual QA - 10-step checklist with incorrect marking
 * 2. AI Evaluation - Trigger evaluation, show results, comparison
 * 3. Photos - Photo gallery with step grouping
 * 4. Feedback - Generate and send WhatsApp feedback
 *
 * NOTE: ONT Barcode and UPS Serial are NOT photo steps - they are scanned
 * barcodes stored directly in ont_serial_scanned and ups_serial_scanned fields.
 *
 * Following FibreFlow UI/UX patterns with TailwindCSS
 */

'use client';

import { useState } from 'react';
import { useUnifiedReview } from '../hooks/useUnifiedReview';
import { STEP_LABELS } from '../types/unified.types';
import type { UnifiedReview } from '../types/unified.types';
import { ComparisonTable } from './ComparisonTable';
import { PhotoGalleryUnified } from './PhotoGalleryUnified';

interface UnifiedReviewCardProps {
  dropNumber: string;
}

type TabKey = 'qa' | 'ai' | 'photos' | 'feedback';

export function UnifiedReviewCard({ dropNumber }: UnifiedReviewCardProps) {
  const [activeTab, setActiveTab] = useState<TabKey>('qa');
  const {
    review,
    isLoading,
    error,
    updateStep,
    markIncorrect,
    triggerAiEvaluation,
    generateFeedback,
    sendFeedback,
    refresh,
  } = useUnifiedReview({ dropNumber });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 dark:border-blue-400 mx-auto mb-4"></div>
          <p className="text-gray-600 dark:text-gray-400">Loading review...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-6">
        <h3 className="text-red-800 dark:text-red-200 font-semibold mb-2">Error Loading Review</h3>
        <p className="text-red-600 dark:text-red-400">{error.message}</p>
        <button
          onClick={refresh}
          className="mt-4 px-4 py-2 bg-red-600 dark:bg-red-500 text-white rounded-lg hover:bg-red-700 dark:hover:bg-red-600 transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!review) {
    return (
      <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-6">
        <p className="text-yellow-800 dark:text-yellow-200">Review not found for {dropNumber}</p>
      </div>
    );
  }

  const tabs = [
    { key: 'qa' as const, label: 'Manual QA', icon: '📋' },
    { key: 'ai' as const, label: 'AI Evaluation', icon: '🤖' },
    { key: 'photos' as const, label: `Photos (${review.photo_count})`, icon: '📸' },
    { key: 'feedback' as const, label: 'Feedback', icon: '💬' },
  ];

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg dark:shadow-gray-900/50">
      {/* Header */}
      <div className="border-b border-gray-200 dark:border-gray-700 px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white">{dropNumber}</h2>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
              Project: {review.project || 'N/A'}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {review.locked_by && (
              <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-200">
                🔒 Locked by {review.locked_by}
              </span>
            )}
            {review.feedback_sent && (
              <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-200">
                ✓ Feedback Sent
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 dark:border-gray-700">
        <nav className="flex -mb-px">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`
                px-6 py-4 text-sm font-medium border-b-2 transition-colors
                ${
                  activeTab === tab.key
                    ? 'border-blue-600 dark:border-blue-400 text-blue-600 dark:text-blue-400'
                    : 'border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 hover:border-gray-300 dark:hover:border-gray-600'
                }
              `}
            >
              <span className="mr-2">{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab Content */}
      <div className="p-6">
        {activeTab === 'qa' && <ManualQATab review={review} updateStep={updateStep} markIncorrect={markIncorrect} />}
        {activeTab === 'ai' && <AIEvaluationTab review={review} triggerAiEvaluation={triggerAiEvaluation} />}
        {activeTab === 'photos' && <PhotosTab review={review} onRefresh={refresh} />}
        {activeTab === 'feedback' && <FeedbackTab review={review} generateFeedback={generateFeedback} sendFeedback={sendFeedback} />}
      </div>
    </div>
  );
}

/**
 * Tab 1: Manual QA
 * 10-step checklist with incorrect marking
 */
interface ManualQATabProps {
  review: UnifiedReview;
  updateStep: (step: number, value: boolean) => Promise<void>;
  markIncorrect: (steps: number[], comments: Record<number, string>) => Promise<void>;
}

function ManualQATab({ review, updateStep, markIncorrect }: ManualQATabProps) {
  const [isUpdating, setIsUpdating] = useState(false);
  const [incorrectSteps, setIncorrectSteps] = useState<Set<number>>(
    new Set(review.incorrect_steps.map(s => parseInt(s)))
  );
  const [comments, setComments] = useState<Record<number, string>>(
    review.incorrect_comments || {}
  );

  const handleStepToggle = async (step: number, currentValue: boolean) => {
    setIsUpdating(true);
    try {
      await updateStep(step, !currentValue);
    } catch (error) {
      console.error('Failed to update step:', error);
    } finally {
      setIsUpdating(false);
    }
  };

  const handleIncorrectToggle = (step: number) => {
    const newIncorrectSteps = new Set(incorrectSteps);
    if (newIncorrectSteps.has(step)) {
      newIncorrectSteps.delete(step);
      const newComments = { ...comments };
      delete newComments[step];
      setComments(newComments);
    } else {
      newIncorrectSteps.add(step);
    }
    setIncorrectSteps(newIncorrectSteps);
  };

  const handleCommentChange = (step: number, comment: string) => {
    setComments({ ...comments, [step]: comment });
  };

  const handleSaveIncorrect = async () => {
    setIsUpdating(true);
    try {
      await markIncorrect(Array.from(incorrectSteps), comments);
    } catch (error) {
      console.error('Failed to mark incorrect:', error);
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">10-Step Quality Checklist</h3>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Completed: {Object.values(getStepValues(review)).filter(Boolean).length}/10
        </p>
      </div>

      {/* Step Checklist */}
      <div className="space-y-3">
        {Object.entries(STEP_LABELS).map(([stepNum, label]) => {
          const step = parseInt(stepNum);
          const stepValue = getStepValue(review, step);
          const isIncorrect = incorrectSteps.has(step);

          return (
            <div key={step} className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 bg-gray-50 dark:bg-gray-900/50">
              <div className="flex items-start gap-4">
                {/* Step Checkbox */}
                <div className="flex items-center">
                  <input
                    type="checkbox"
                    checked={stepValue}
                    onChange={() => handleStepToggle(step, stepValue)}
                    disabled={isUpdating}
                    className="h-5 w-5 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500 dark:bg-gray-700"
                  />
                </div>

                {/* Step Label */}
                <div className="flex-1">
                  <label className="text-sm font-medium text-gray-900 dark:text-white">
                    Step {step}: {label}
                  </label>

                  {/* Incorrect Marker */}
                  <div className="mt-2 flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={isIncorrect}
                      onChange={() => handleIncorrectToggle(step)}
                      className="h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-red-600 focus:ring-red-500 dark:bg-gray-700"
                    />
                    <span className="text-sm text-gray-600 dark:text-gray-400">Mark as incorrect</span>
                  </div>

                  {/* Comment Field */}
                  {isIncorrect && (
                    <div className="mt-3">
                      <textarea
                        value={comments[step] || ''}
                        onChange={(e) => handleCommentChange(step, e.target.value)}
                        placeholder="Enter reason for marking this step as incorrect..."
                        rows={2}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400"
                      />
                    </div>
                  )}
                </div>

                {/* Status Badge */}
                <div>
                  {stepValue ? (
                    <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-200">
                      ✓ Pass
                    </span>
                  ) : (
                    <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-300">
                      Pending
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Save Incorrect Button */}
      {incorrectSteps.size > 0 && (
        <div className="flex justify-end">
          <button
            onClick={handleSaveIncorrect}
            disabled={isUpdating}
            className="px-6 py-2 bg-red-600 dark:bg-red-500 text-white rounded-lg hover:bg-red-700 dark:hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isUpdating ? 'Saving...' : `Save ${incorrectSteps.size} Incorrect Step${incorrectSteps.size > 1 ? 's' : ''}`}
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Tab 2: AI Evaluation
 * Trigger evaluation, show results, comparison
 */
interface AIEvaluationTabProps {
  review: UnifiedReview;
  triggerAiEvaluation: () => Promise<void>;
}

function AIEvaluationTab({ review, triggerAiEvaluation }: AIEvaluationTabProps) {
  const [isEvaluating, setIsEvaluating] = useState(false);

  const handleTriggerEvaluation = async () => {
    setIsEvaluating(true);
    try {
      await triggerAiEvaluation();
    } catch (error) {
      console.error('Failed to trigger AI evaluation:', error);
    } finally {
      setIsEvaluating(false);
    }
  };

  if (!review.ai_overall_status) {
    return (
      <div className="text-center py-12">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-blue-100 dark:bg-blue-900/30 mb-4">
          <span className="text-3xl">🤖</span>
        </div>
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">AI Evaluation Not Run</h3>
        <p className="text-gray-600 dark:text-gray-400 mb-6">
          Trigger AI evaluation to get automated quality assessment
        </p>
        <button
          onClick={handleTriggerEvaluation}
          disabled={isEvaluating}
          className="px-6 py-3 bg-blue-600 dark:bg-blue-500 text-white rounded-lg hover:bg-blue-700 dark:hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isEvaluating ? 'Evaluating...' : 'Evaluate with AI'}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* AI Results Summary */}
      <div className="bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">AI Evaluation Results</h3>
          <span
            className={`px-4 py-2 rounded-lg text-sm font-bold ${
              review.ai_overall_status === 'PASS'
                ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-200'
                : 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-200'
            }`}
          >
            {review.ai_overall_status}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">Average Score</p>
            <p className="text-2xl font-bold text-gray-900 dark:text-white">
              {review.ai_average_score != null
                ? typeof review.ai_average_score === 'number'
                  ? review.ai_average_score.toFixed(1)
                  : parseFloat(String(review.ai_average_score)).toFixed(1)
                : '0.0'}/10
            </p>
          </div>
          <div>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">Evaluated At</p>
            <p className="text-sm text-gray-900 dark:text-gray-200">
              {review.ai_evaluated_at
                ? new Date(review.ai_evaluated_at).toLocaleString()
                : 'N/A'}
            </p>
          </div>
        </div>
      </div>

      {/* Comparison Table */}
      <ComparisonTable
        manualSteps={getManualSteps(review)}
        aiSteps={review.ai_step_results || []}
      />

      {/* AI Markdown Report */}
      {review.ai_markdown_report && (
        <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-6 bg-white dark:bg-gray-800">
          <h4 className="text-md font-semibold text-gray-900 dark:text-white mb-4">AI Detailed Report</h4>
          <div className="prose prose-sm dark:prose-invert max-w-none">
            <pre className="whitespace-pre-wrap text-sm text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-900/50 p-4 rounded-lg">
              {review.ai_markdown_report}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Tab 3: Photos
 * Photo gallery with step grouping and fetch capability
 */
interface PhotosTabProps {
  review: UnifiedReview;
  onRefresh?: () => void;
}

function PhotosTab({ review, onRefresh }: PhotosTabProps) {
  const [isFetching, setIsFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Convert photos_metadata to Photo[] format for PhotoGalleryUnified
  const photos = (review.photos_metadata || []).map((photo: any) => ({
    filename: photo.filename,
    step: photo.step || 0,
    url: photo.url,
    size: photo.size,
    modified: photo.modified,
  }));

  const handleFetchPhotos = async () => {
    setIsFetching(true);
    setFetchError(null);

    try {
      const response = await fetch('/api/dr-photo-unified/fetch-photos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dropNumber: review.drop_number, force: true }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error?.message || 'Failed to fetch photos');
      }

      // Refresh the review to get updated photos_metadata
      onRefresh?.();
    } catch (error) {
      setFetchError(error instanceof Error ? error.message : 'Failed to fetch photos');
    } finally {
      setIsFetching(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Serial Numbers from OneMap */}
      {(review.ont_serial_scanned || review.ups_serial_scanned) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 bg-gray-50 dark:bg-gray-900/50 rounded-lg border border-gray-200 dark:border-gray-700">
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">
              ONT Barcode
            </label>
            <p className="text-lg font-mono font-semibold text-gray-900 dark:text-white">
              {review.ont_serial_scanned || <span className="text-gray-400 dark:text-gray-500">—</span>}
            </p>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">
              UPS Serial
            </label>
            <p className="text-lg font-mono font-semibold text-gray-900 dark:text-white">
              {review.ups_serial_scanned || <span className="text-gray-400 dark:text-gray-500">—</span>}
            </p>
          </div>
        </div>
      )}

      {/* Fetch Photos Header */}
      <div className="flex items-center justify-between">
        <div className="text-sm text-gray-600 dark:text-gray-400">
          {photos.length > 0
            ? `${photos.length} photos loaded from ${review.photo_source || 'unknown source'}`
            : 'No photos loaded yet'}
        </div>
        <button
          onClick={handleFetchPhotos}
          disabled={isFetching}
          className="px-4 py-2 bg-blue-600 dark:bg-blue-500 text-white rounded-lg hover:bg-blue-700 dark:hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
        >
          {isFetching ? (
            <>
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
              <span>Fetching...</span>
            </>
          ) : (
            <>
              <span>🔄</span>
              <span>Fetch from OneMap</span>
            </>
          )}
        </button>
      </div>

      {/* Error Message */}
      {fetchError && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3">
          <p className="text-red-600 dark:text-red-400 text-sm">{fetchError}</p>
        </div>
      )}

      {/* Photo Gallery */}
      <PhotoGalleryUnified
        photos={photos}
        source={review.photo_source as any}
        groupByStep={true}
      />
    </div>
  );
}

/**
 * Tab 4: Feedback
 * Generate and send WhatsApp feedback
 */
interface FeedbackTabProps {
  review: UnifiedReview;
  generateFeedback: () => string;
  sendFeedback: (message: string) => Promise<void>;
}

function FeedbackTab({ review, generateFeedback, sendFeedback }: FeedbackTabProps) {
  const [message, setMessage] = useState(review.feedback_message || '');
  const [isSending, setIsSending] = useState(false);

  const handleGenerateFeedback = () => {
    const generated = generateFeedback();
    setMessage(generated);
  };

  const handleSendFeedback = async () => {
    if (!message.trim()) return;

    setIsSending(true);
    try {
      await sendFeedback(message);
    } catch (error) {
      console.error('Failed to send feedback:', error);
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Generate Button */}
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">WhatsApp Feedback</h3>
        <button
          onClick={handleGenerateFeedback}
          className="px-4 py-2 bg-purple-600 dark:bg-purple-500 text-white rounded-lg hover:bg-purple-700 dark:hover:bg-purple-600 transition-colors flex items-center gap-2"
        >
          <span>✨</span>
          Generate Auto-Feedback
        </button>
      </div>

      {/* Message Editor */}
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          Feedback Message
        </label>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={10}
          placeholder="Enter feedback message or click 'Generate Auto-Feedback' to create one automatically..."
          className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400"
        />
      </div>

      {/* Send Button */}
      <div className="flex justify-end gap-3">
        {review.feedback_sent && (
          <span className="inline-flex items-center px-4 py-2 rounded-lg text-sm font-medium bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-200">
            ✓ Feedback Sent
            {review.feedback_sent_at && (
              <span className="ml-2 text-xs">
                {new Date(review.feedback_sent_at).toLocaleString()}
              </span>
            )}
          </span>
        )}
        <button
          onClick={handleSendFeedback}
          disabled={isSending || !message.trim() || review.feedback_sent}
          className="px-6 py-2 bg-green-600 dark:bg-green-500 text-white rounded-lg hover:bg-green-700 dark:hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
        >
          <span>📤</span>
          {isSending ? 'Sending...' : 'Send to WhatsApp'}
        </button>
      </div>
    </div>
  );
}

/**
 * Helper: Get step value from review object
 * NOTE: Steps 8, 9, 10 are now Final Installation, Green Lights, Signature
 * (ONT Barcode and UPS Serial are NOT photo steps)
 */
function getStepValue(review: UnifiedReview, step: number): boolean {
  const stepFields: Record<number, keyof UnifiedReview> = {
    1: 'step_01_house_photo',
    2: 'step_02_cable_from_pole',
    3: 'step_03_entry_outside',
    4: 'step_04_entry_inside',
    5: 'step_05_wall',
    6: 'step_06_ont_back',
    7: 'step_07_power_meter',
    8: 'step_08_final_installation',
    9: 'step_09_green_lights',
    10: 'step_10_signature',
  };

  return review[stepFields[step]] as boolean || false;
}

/**
 * Helper: Get all step values from review object
 */
function getStepValues(review: UnifiedReview): Record<number, boolean> {
  const values: Record<number, boolean> = {};
  for (let i = 1; i <= 10; i++) {
    values[i] = getStepValue(review, i);
  }
  return values;
}

/**
 * Helper: Get manual steps for comparison table
 */
function getManualSteps(review: UnifiedReview): Array<{ step: number; passed: boolean; label: string }> {
  const steps: Array<{ step: number; passed: boolean; label: string }> = [];

  for (let i = 1; i <= 10; i++) {
    steps.push({
      step: i,
      passed: getStepValue(review, i),
      label: STEP_LABELS[i],
    });
  }

  return steps;
}
