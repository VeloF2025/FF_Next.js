/**
 * UnifiedReviewCard Component
 *
 * Main component for unified DR photo review with 5 tabs:
 * 1. QA Wizard - 5-phase guided workflow (Prerequisites → Photo Review → Data Validation → Final Decision → Feedback)
 * 2. Photos - Photo gallery with step grouping
 * 3. Feedback - Generate and send WhatsApp feedback
 * 4. Activity - Review history, comments, and activity timeline
 * 5. Manual QA - Legacy 10-step checklist (for reference)
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
import { PhotoGalleryUnified } from './PhotoGalleryUnified';
import { AICategorizationTab } from './AICategorizationTab';
import { ActivityTab } from './ActivityTab';
import { QaWizardContainer } from './wizard/QaWizardContainer';

interface UnifiedReviewCardProps {
  dropNumber: string;
}

type TabKey = 'wizard' | 'photos' | 'feedback' | 'activity' | 'qa' | 'categorization';

export function UnifiedReviewCard({ dropNumber }: UnifiedReviewCardProps) {
  const [activeTab, setActiveTab] = useState<TabKey>('wizard');
  const {
    review,
    isLoading,
    error,
    updateStep,
    markIncorrect,
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
    { key: 'wizard' as const, label: 'QA Wizard', icon: '🧙' },
    { key: 'photos' as const, label: `Photos (${review.photo_count})`, icon: '📸' },
    { key: 'categorization' as const, label: 'AI Categorization', icon: '🏷️' },
    { key: 'activity' as const, label: 'Activity', icon: '📜' },
    { key: 'feedback' as const, label: 'Feedback', icon: '💬' },
    { key: 'qa' as const, label: 'Manual QA', icon: '📋' },
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
        {activeTab === 'wizard' && (
          <QaWizardContainer
            dropNumber={dropNumber}
            onPhaseChange={(phase) => {
              // Could log phase changes or update parent state
            }}
            onComplete={refresh}
          />
        )}
        {activeTab === 'photos' && <PhotosTab review={review} onRefresh={refresh} />}
        {activeTab === 'feedback' && <FeedbackTab review={review} generateFeedback={generateFeedback} sendFeedback={sendFeedback} />}
        {activeTab === 'activity' && <ActivityTab dropNumber={dropNumber} feedbackSentAt={review.feedback_sent_at} />}
        {activeTab === 'qa' && <ManualQATab review={review} updateStep={updateStep} markIncorrect={markIncorrect} />}
        {activeTab === 'categorization' && (
          <AICategorizationTab
            dropNumber={dropNumber}
            photoCount={review.photo_count || 0}
            onCategorizationApproved={refresh}
          />
        )}
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
 * Tab 2: Photos
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

  // Check data completeness
  const hasPhotos = photos.length > 0;
  const hasOntSerial = !!review.ont_serial_scanned;
  const hasUpsSerial = !!review.ups_serial_scanned;
  const isDataIncomplete = !hasPhotos || (!hasOntSerial && !hasUpsSerial);

  const handleFetchPhotos = async () => {
    setIsFetching(true);
    setFetchError(null);

    try {
      // Use ensure-data endpoint for comprehensive refresh
      const response = await fetch('/api/activate/ensure-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dropNumber: review.drop_number, force: true }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error?.message || 'Failed to fetch data');
      }

      // Refresh the review to get updated data
      onRefresh?.();
    } catch (error) {
      setFetchError(error instanceof Error ? error.message : 'Failed to fetch data');
    } finally {
      setIsFetching(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Data Incomplete Warning Banner */}
      {isDataIncomplete && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-300 dark:border-amber-700 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <span className="text-2xl">⚠️</span>
            <div className="flex-1">
              <h4 className="font-semibold text-amber-800 dark:text-amber-200 mb-1">
                Data Incomplete
              </h4>
              <p className="text-sm text-amber-700 dark:text-amber-300 mb-3">
                {!hasPhotos && 'No photos loaded. '}
                {!hasOntSerial && !hasUpsSerial && 'No serial numbers synced. '}
                Data may still be syncing from OneMap.
              </p>
              <button
                onClick={handleFetchPhotos}
                disabled={isFetching}
                className="px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2 font-medium"
              >
                {isFetching ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                    <span>Refreshing from OneMap...</span>
                  </>
                ) : (
                  <>
                    <span>🔄</span>
                    <span>Refresh Data from OneMap</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Serial Numbers from OneMap */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 bg-gray-50 dark:bg-gray-900/50 rounded-lg border border-gray-200 dark:border-gray-700">
        <div>
          <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">
            ONT Barcode
          </label>
          <p className={`text-lg font-mono font-semibold ${hasOntSerial ? 'text-gray-900 dark:text-white' : 'text-gray-400 dark:text-gray-500'}`}>
            {review.ont_serial_scanned || '— not synced'}
          </p>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">
            UPS Serial
          </label>
          <p className={`text-lg font-mono font-semibold ${hasUpsSerial ? 'text-gray-900 dark:text-white' : 'text-gray-400 dark:text-gray-500'}`}>
            {review.ups_serial_scanned || '— not synced'}
          </p>
        </div>
      </div>

      {/* Fetch Photos Header */}
      <div className="flex items-center justify-between">
        <div className="text-sm text-gray-600 dark:text-gray-400">
          {photos.length > 0
            ? `${photos.length} photos loaded from ${review.photo_source || 'unknown source'}`
            : 'No photos loaded yet'}
        </div>
        {!isDataIncomplete && (
          <button
            onClick={handleFetchPhotos}
            disabled={isFetching}
            className="px-4 py-2 bg-blue-600 dark:bg-blue-500 text-white rounded-lg hover:bg-blue-700 dark:hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
          >
            {isFetching ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                <span>Refreshing...</span>
              </>
            ) : (
              <>
                <span>🔄</span>
                <span>Refresh from OneMap</span>
              </>
            )}
          </button>
        )}
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

