/**
 * ReviewTab Component
 *
 * Phase 3: Human Review - Card grid with keyboard shortcuts
 *
 * Features:
 * - Card grid showing photos grouped by step
 * - Keyboard shortcuts: A=approve, R=reject, Arrow keys=navigate
 * - VLM QA results overlay
 * - Human override capability
 *
 * Following PAI 3-Phase QA Workflow (wobbly-leaping-sparkle.md)
 */

'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { STEP_LABELS } from '../utils/stepMapper';
import { log } from '@/lib/logger';

// ============================================================================
// TYPES
// ============================================================================

interface StepQaResult {
  step: number;
  stepLabel: string;
  filename: string;
  passed: boolean;
  score: number;
  checks: Array<{
    checkId: string;
    description: string;
    passed: boolean;
    severity: 'critical' | 'major' | 'minor';
    details: string;
  }>;
  observations: string;
  feedback: string;
  error?: string;
}

interface HumanOverride {
  action: 'approve' | 'reject';
  reason: string | null;
  overrideVlm: boolean;
  reviewedBy: string;
  reviewedAt: string;
}

interface PhotoWithQa {
  filename: string;
  url: string;
  step: number;
  stepLabel: string;
  qaResult?: StepQaResult;
  humanOverride?: HumanOverride;
}

interface ReviewTabProps {
  dropNumber: string;
  photos: Array<{ filename: string; url: string; step: number | null }>;
  qaResults?: { stepResults?: StepQaResult[] };
  humanOverrides?: Record<number, HumanOverride>;
  userId: string;
  onStepReview: (step: number, action: 'approve' | 'reject', reason?: string) => Promise<void>;
  onReviewComplete?: () => void;
  isLocked?: boolean;
}

// ============================================================================
// COMPONENT
// ============================================================================

export function ReviewTab({
  dropNumber,
  photos,
  qaResults,
  humanOverrides = {},
  userId,
  onStepReview,
  onReviewComplete,
  isLocked = false,
}: ReviewTabProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [showRejectModal, setShowRejectModal] = useState(false);

  // Merge photos with QA results and human overrides
  const photosWithQa: PhotoWithQa[] = useMemo(() => {
    return photos
      .filter((p) => p.step !== null && p.step >= 1 && p.step <= 10)
      .map((photo) => {
        const step = photo.step as number;
        const qaResult = qaResults?.stepResults?.find((r) => r.step === step);
        const humanOverride = humanOverrides[step];

        return {
          filename: photo.filename,
          url: photo.url,
          step,
          stepLabel: STEP_LABELS[step] || `Step ${step}`,
          qaResult,
          humanOverride,
        };
      })
      .sort((a, b) => a.step - b.step);
  }, [photos, qaResults, humanOverrides]);

  const selectedPhoto = photosWithQa[selectedIndex];

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (showRejectModal || isProcessing || isLocked) return;

      switch (e.key.toLowerCase()) {
        case 'a':
          // Approve current step
          if (selectedPhoto) {
            handleApprove(selectedPhoto.step);
          }
          break;
        case 'r':
          // Show reject modal
          if (selectedPhoto) {
            setShowRejectModal(true);
          }
          break;
        case 'arrowleft':
        case 'arrowup':
          e.preventDefault();
          setSelectedIndex((prev) => Math.max(0, prev - 1));
          break;
        case 'arrowright':
        case 'arrowdown':
          e.preventDefault();
          setSelectedIndex((prev) => Math.min(photosWithQa.length - 1, prev + 1));
          break;
        case 'escape':
          setShowRejectModal(false);
          break;
      }
    },
    [selectedPhoto, showRejectModal, isProcessing, isLocked, photosWithQa.length]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // Handle approve action
  const handleApprove = async (step: number) => {
    if (isProcessing || isLocked) return;

    setIsProcessing(true);
    try {
      await onStepReview(step, 'approve');
      // Move to next step
      if (selectedIndex < photosWithQa.length - 1) {
        setSelectedIndex(selectedIndex + 1);
      }
    } catch (error) {
      log.error('Failed to approve step', error, 'ReviewTab');
    } finally {
      setIsProcessing(false);
    }
  };

  // Handle reject action
  const handleReject = async () => {
    if (!selectedPhoto || isProcessing || isLocked) return;

    setIsProcessing(true);
    try {
      await onStepReview(selectedPhoto.step, 'reject', rejectReason);
      setShowRejectModal(false);
      setRejectReason('');
      // Move to next step
      if (selectedIndex < photosWithQa.length - 1) {
        setSelectedIndex(selectedIndex + 1);
      }
    } catch (error) {
      log.error('Failed to reject step', error, 'ReviewTab');
    } finally {
      setIsProcessing(false);
    }
  };

  // Calculate progress
  const reviewedCount = Object.keys(humanOverrides).length;
  const totalSteps = photosWithQa.length;
  const progressPercent = totalSteps > 0 ? Math.round((reviewedCount / totalSteps) * 100) : 0;

  if (photosWithQa.length === 0) {
    return (
      <div className="text-center py-12">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gray-100 dark:bg-gray-800 mb-4">
          <span className="text-3xl">📷</span>
        </div>
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">No Photos to Review</h3>
        <p className="text-gray-600 dark:text-gray-400">
          Fetch photos and run categorization first
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Progress Bar */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex-1 mr-4">
          <div className="flex items-center justify-between text-sm mb-1">
            <span className="text-gray-600 dark:text-gray-400">Review Progress</span>
            <span className="font-medium text-gray-900 dark:text-white">
              {reviewedCount}/{totalSteps} steps ({progressPercent}%)
            </span>
          </div>
          <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
            <div
              className="bg-blue-600 dark:bg-blue-500 h-2 rounded-full transition-all duration-300"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>
        {reviewedCount === totalSteps && onReviewComplete && (
          <button
            onClick={onReviewComplete}
            className="px-4 py-2 bg-green-600 dark:bg-green-500 text-white rounded-lg hover:bg-green-700 dark:hover:bg-green-600 transition-colors"
          >
            Complete Review
          </button>
        )}
      </div>

      {/* Keyboard Shortcuts Legend */}
      <div className="flex items-center gap-6 text-sm text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-900/50 rounded-lg px-4 py-2">
        <span className="font-medium">Shortcuts:</span>
        <div className="flex items-center gap-1">
          <kbd className="px-2 py-1 bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-200 rounded text-xs font-mono">A</kbd>
          <span>Approve</span>
        </div>
        <div className="flex items-center gap-1">
          <kbd className="px-2 py-1 bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-200 rounded text-xs font-mono">R</kbd>
          <span>Reject</span>
        </div>
        <div className="flex items-center gap-1">
          <kbd className="px-2 py-1 bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded text-xs font-mono">←→</kbd>
          <span>Navigate</span>
        </div>
      </div>

      {/* Card Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
        {photosWithQa.map((photo, index) => (
          <PhotoCard
            key={`${photo.step}-${photo.filename}`}
            photo={photo}
            isSelected={index === selectedIndex}
            onClick={() => setSelectedIndex(index)}
            onApprove={() => handleApprove(photo.step)}
            onReject={() => {
              setSelectedIndex(index);
              setShowRejectModal(true);
            }}
            isProcessing={isProcessing}
            isLocked={isLocked}
          />
        ))}
      </div>

      {/* Selected Photo Detail */}
      {selectedPhoto && (
        <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
          <div className="bg-gray-50 dark:bg-gray-900/50 px-4 py-3 border-b border-gray-200 dark:border-gray-700">
            <div className="flex items-center justify-between">
              <h4 className="font-semibold text-gray-900 dark:text-white">
                Step {selectedPhoto.step}: {selectedPhoto.stepLabel}
              </h4>
              <div className="flex items-center gap-2">
                {selectedPhoto.humanOverride ? (
                  <span
                    className={`px-3 py-1 rounded-full text-sm font-medium ${
                      selectedPhoto.humanOverride.action === 'approve'
                        ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-200'
                        : 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-200'
                    }`}
                  >
                    {selectedPhoto.humanOverride.action === 'approve' ? '✓ Approved' : '✗ Rejected'}
                  </span>
                ) : selectedPhoto.qaResult ? (
                  <span
                    className={`px-3 py-1 rounded-full text-sm font-medium ${
                      selectedPhoto.qaResult.passed
                        ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-200'
                        : 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-200'
                    }`}
                  >
                    AI: {selectedPhoto.qaResult.passed ? 'Pass' : 'Fail'} ({selectedPhoto.qaResult.score}/100)
                  </span>
                ) : (
                  <span className="px-3 py-1 rounded-full text-sm font-medium bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
                    Pending Review
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 p-4">
            {/* Photo Preview */}
            <div className="aspect-[4/3] bg-gray-100 dark:bg-gray-800 rounded-lg overflow-hidden">
              <img
                src={selectedPhoto.url}
                alt={`Step ${selectedPhoto.step}: ${selectedPhoto.stepLabel}`}
                className="w-full h-full object-contain"
              />
            </div>

            {/* QA Details */}
            <div className="space-y-4">
              {selectedPhoto.qaResult && (
                <>
                  <div>
                    <h5 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">AI Observations</h5>
                    <p className="text-sm text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-900/50 rounded-lg p-3">
                      {selectedPhoto.qaResult.observations || 'No observations'}
                    </p>
                  </div>

                  {selectedPhoto.qaResult.checks.length > 0 && (
                    <div>
                      <h5 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">QA Checks</h5>
                      <div className="space-y-2">
                        {selectedPhoto.qaResult.checks.map((check) => (
                          <div
                            key={check.checkId}
                            className={`flex items-start gap-2 text-sm p-2 rounded-lg ${
                              check.passed
                                ? 'bg-green-50 dark:bg-green-900/20'
                                : check.severity === 'critical'
                                ? 'bg-red-50 dark:bg-red-900/20'
                                : 'bg-yellow-50 dark:bg-yellow-900/20'
                            }`}
                          >
                            <span className={check.passed ? 'text-green-600' : 'text-red-600'}>
                              {check.passed ? '✓' : '✗'}
                            </span>
                            <div>
                              <span className="font-medium text-gray-900 dark:text-white">
                                {check.description}
                              </span>
                              {!check.passed && check.details && (
                                <p className="text-gray-600 dark:text-gray-400 mt-1">{check.details}</p>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {selectedPhoto.qaResult.feedback && (
                    <div>
                      <h5 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">AI Feedback</h5>
                      <p className="text-sm text-gray-600 dark:text-gray-400 bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3">
                        {selectedPhoto.qaResult.feedback}
                      </p>
                    </div>
                  )}
                </>
              )}

              {/* Action Buttons */}
              {!isLocked && !selectedPhoto.humanOverride && (
                <div className="flex gap-3 pt-4 border-t border-gray-200 dark:border-gray-700">
                  <button
                    onClick={() => handleApprove(selectedPhoto.step)}
                    disabled={isProcessing}
                    className="flex-1 px-4 py-3 bg-green-600 dark:bg-green-500 text-white rounded-lg hover:bg-green-700 dark:hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium"
                  >
                    ✓ Approve (A)
                  </button>
                  <button
                    onClick={() => setShowRejectModal(true)}
                    disabled={isProcessing}
                    className="flex-1 px-4 py-3 bg-red-600 dark:bg-red-500 text-white rounded-lg hover:bg-red-700 dark:hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium"
                  >
                    ✗ Reject (R)
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Reject Modal */}
      {showRejectModal && selectedPhoto && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full mx-4 p-6">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
              Reject Step {selectedPhoto.step}: {selectedPhoto.stepLabel}
            </h3>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Enter reason for rejection..."
              rows={4}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400"
              autoFocus
            />
            <div className="flex gap-3 mt-4">
              <button
                onClick={() => {
                  setShowRejectModal(false);
                  setRejectReason('');
                }}
                className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                Cancel (Esc)
              </button>
              <button
                onClick={handleReject}
                disabled={isProcessing}
                className="flex-1 px-4 py-2 bg-red-600 dark:bg-red-500 text-white rounded-lg hover:bg-red-700 dark:hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isProcessing ? 'Rejecting...' : 'Reject'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// PHOTO CARD COMPONENT
// ============================================================================

interface PhotoCardProps {
  photo: PhotoWithQa;
  isSelected: boolean;
  onClick: () => void;
  onApprove: () => void;
  onReject: () => void;
  isProcessing: boolean;
  isLocked: boolean;
}

function PhotoCard({
  photo,
  isSelected,
  onClick,
  onApprove,
  onReject,
  isProcessing,
  isLocked,
}: PhotoCardProps) {
  // Determine card status
  let statusColor = 'border-gray-200 dark:border-gray-700';
  let statusBadge = null;

  if (photo.humanOverride) {
    if (photo.humanOverride.action === 'approve') {
      statusColor = 'border-green-500 dark:border-green-400';
      statusBadge = (
        <span className="absolute top-2 right-2 px-2 py-1 bg-green-500 text-white text-xs font-medium rounded">
          ✓
        </span>
      );
    } else {
      statusColor = 'border-red-500 dark:border-red-400';
      statusBadge = (
        <span className="absolute top-2 right-2 px-2 py-1 bg-red-500 text-white text-xs font-medium rounded">
          ✗
        </span>
      );
    }
  } else if (photo.qaResult) {
    if (photo.qaResult.passed) {
      statusColor = 'border-blue-300 dark:border-blue-600';
    } else {
      statusColor = 'border-yellow-400 dark:border-yellow-500';
    }
  }

  if (isSelected) {
    statusColor = 'border-blue-500 dark:border-blue-400 ring-2 ring-blue-500/50';
  }

  return (
    <div
      onClick={onClick}
      className={`relative group cursor-pointer rounded-lg overflow-hidden border-2 ${statusColor} transition-all hover:shadow-lg`}
    >
      {/* Photo Thumbnail */}
      <div className="aspect-square bg-gray-100 dark:bg-gray-800">
        <img
          src={photo.url}
          alt={`Step ${photo.step}: ${photo.stepLabel}`}
          className="w-full h-full object-cover"
        />
      </div>

      {/* Status Badge */}
      {statusBadge}

      {/* Step Label */}
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent px-2 py-2">
        <p className="text-white text-xs font-medium truncate">
          {photo.step}. {photo.stepLabel}
        </p>
      </div>

      {/* Hover Actions */}
      {!isLocked && !photo.humanOverride && (
        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onApprove();
            }}
            disabled={isProcessing}
            className="px-3 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50"
          >
            ✓
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onReject();
            }}
            disabled={isProcessing}
            className="px-3 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-50"
          >
            ✗
          </button>
        </div>
      )}
    </div>
  );
}

export default ReviewTab;
