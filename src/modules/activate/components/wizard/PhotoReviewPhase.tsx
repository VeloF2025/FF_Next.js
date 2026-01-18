/**
 * Photo Review Phase Component
 *
 * Phase 2 of QA Wizard - Integrated AI Categorization workflow.
 * Must complete categorization and approval before proceeding.
 *
 * Flow:
 * 1. Check categorization status on mount
 * 2. If pending → Show "Run Categorization" button
 * 3. If categorized → Show review grid with approve/override
 * 4. If approved → Show summary and enable "Continue"
 */

import React, { useState, useEffect, useCallback } from 'react';
import { log } from '@/lib/logger';
import type {
  VlmCategorizationResult,
  VlmCategorizationStatus,
  Photo,
} from '../../types/unified.types';
import { STEP_LABELS } from '../../utils/stepMapper';

interface PhotoReviewPhaseProps {
  dropNumber: string;
  photoCount: number;
  onComplete: (categorizedPhotos: Photo[], stepsCovered: number[], stepsMissing: number[]) => void;
  onBack: () => void;
}

interface CategorizationState {
  status: VlmCategorizationStatus;
  results: VlmCategorizationResult[];
  categorizedAt: string | null;
  approvedAt: string | null;
}

export function PhotoReviewPhase({
  dropNumber,
  photoCount,
  onComplete,
  onBack,
}: PhotoReviewPhaseProps) {
  const [state, setState] = useState<CategorizationState>({
    status: 'pending',
    results: [],
    categorizedAt: null,
    approvedAt: null,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [approvals, setApprovals] = useState<Map<string, { approved: boolean; overrideStep?: number }>>(
    new Map()
  );

  // Lightbox state
  const [lightboxPhoto, setLightboxPhoto] = useState<string | null>(null);

  // Load categorization state on mount
  useEffect(() => {
    loadCategorizationState();
  }, [dropNumber]);

  const loadCategorizationState = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/activate/categorize-photos?dropNumber=${encodeURIComponent(dropNumber)}`);
      const data = await response.json();

      if (data.success) {
        setState({
          status: data.data.status || 'pending',
          results: data.data.categorizations || [],
          categorizedAt: data.data.categorizedAt,
          approvedAt: data.data.approvedAt,
        });

        // Initialize approvals from existing results
        if (data.data.categorizations) {
          const existingApprovals = new Map<string, { approved: boolean; overrideStep?: number }>();
          data.data.categorizations.forEach((result: VlmCategorizationResult) => {
            if (result.human_approved !== null) {
              existingApprovals.set(result.photo_filename, {
                approved: result.human_approved,
                overrideStep: result.human_override_step ?? undefined,
              });
            }
          });
          setApprovals(existingApprovals);
        }
      } else {
        setError(data.message || 'Failed to load categorization state');
      }
    } catch (err) {
      log.error('PhotoReviewPhase', 'Failed to load categorization state', err);
      setError('Failed to load categorization state');
    } finally {
      setIsLoading(false);
    }
  }, [dropNumber]);

  const runCategorization = async () => {
    setIsProcessing(true);
    setError(null);

    try {
      const response = await fetch('/api/activate/categorize-photos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dropNumber, force: true }),
      });

      const data = await response.json();

      if (data.success) {
        setState({
          status: 'categorized',
          results: data.data.categorizations || [],
          categorizedAt: new Date().toISOString(),
          approvedAt: null,
        });
        setApprovals(new Map());
        log.info('PhotoReviewPhase', `Categorization complete for ${dropNumber}`);
      } else {
        setError(data.message || 'Categorization failed');
      }
    } catch (err) {
      log.error('PhotoReviewPhase', 'Categorization failed', err);
      setError('Failed to run categorization');
    } finally {
      setIsProcessing(false);
    }
  };

  const approveAll = async () => {
    setIsProcessing(true);
    setError(null);

    try {
      const response = await fetch('/api/activate/approve-categorization', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dropNumber, approve_all: true }),
      });

      const data = await response.json();

      if (data.success) {
        setState((prev) => ({
          ...prev,
          status: 'approved',
          approvedAt: new Date().toISOString(),
        }));
        log.info('PhotoReviewPhase', `All categorizations approved for ${dropNumber}`);
      } else {
        setError(data.message || 'Approval failed');
      }
    } catch (err) {
      log.error('PhotoReviewPhase', 'Approval failed', err);
      setError('Failed to approve categorization');
    } finally {
      setIsProcessing(false);
    }
  };

  const submitApprovals = async () => {
    setIsProcessing(true);
    setError(null);

    const approvalList = state.results.map((result) => {
      const approval = approvals.get(result.photo_filename);
      return {
        photo_filename: result.photo_filename,
        approved: approval?.approved ?? true,
        override_step: approval?.overrideStep,
      };
    });

    try {
      const response = await fetch('/api/activate/approve-categorization', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dropNumber, approvals: approvalList }),
      });

      const data = await response.json();

      if (data.success) {
        setState((prev) => ({
          ...prev,
          status: 'approved',
          approvedAt: new Date().toISOString(),
        }));
        log.info('PhotoReviewPhase', `Approvals submitted for ${dropNumber}`);
      } else {
        setError(data.message || 'Approval failed');
      }
    } catch (err) {
      log.error('PhotoReviewPhase', 'Approval failed', err);
      setError('Failed to submit approvals');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleProceed = () => {
    // Convert categorization results to Photo array with correct steps
    const categorizedPhotos: Photo[] = state.results.map((result) => ({
      filename: result.photo_filename,
      step: result.human_override_step ?? result.vlm_predicted_step,
      url: `/api/activate/photo/${dropNumber}/${result.photo_filename}`,
      original_type: null,
    }));

    // Calculate step coverage
    const stepCounts = new Map<number, number>();
    state.results.forEach((result) => {
      const step = result.human_override_step ?? result.vlm_predicted_step;
      if (step >= 1 && step <= 10) {
        stepCounts.set(step, (stepCounts.get(step) || 0) + 1);
      }
    });

    const stepsCovered: number[] = [];
    const stepsMissing: number[] = [];
    for (let i = 1; i <= 10; i++) {
      if (stepCounts.has(i) && (stepCounts.get(i) || 0) > 0) {
        stepsCovered.push(i);
      } else {
        stepsMissing.push(i);
      }
    }

    onComplete(categorizedPhotos, stepsCovered, stepsMissing);
  };

  const setPhotoApproval = (filename: string, approved: boolean, overrideStep?: number) => {
    setApprovals((prev) => {
      const newMap = new Map(prev);
      newMap.set(filename, { approved, overrideStep });
      return newMap;
    });
  };

  const getConfidenceColor = (confidence: number): string => {
    if (confidence >= 0.9) return 'text-green-600 dark:text-green-400';
    if (confidence >= 0.7) return 'text-yellow-600 dark:text-yellow-400';
    return 'text-red-600 dark:text-red-400';
  };

  const getConfidenceBg = (confidence: number): string => {
    if (confidence >= 0.9) return 'bg-green-100 dark:bg-green-900/30';
    if (confidence >= 0.7) return 'bg-yellow-100 dark:bg-yellow-900/30';
    return 'bg-red-100 dark:bg-red-900/30';
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
        <span className="ml-3 text-gray-600 dark:text-gray-400">Loading categorization...</span>
      </div>
    );
  }

  // Pending state - need to run categorization
  if (state.status === 'pending') {
    return (
      <div className="text-center py-8">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-purple-100 dark:bg-purple-900/30 mb-4">
          <span className="text-3xl">🏷️</span>
        </div>
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
          AI Photo Categorization Required
        </h3>
        <p className="text-gray-600 dark:text-gray-400 mb-2">
          Before proceeding, we need to categorize {photoCount} photos using AI.
        </p>
        <p className="text-sm text-gray-500 dark:text-gray-500 mb-6">
          The AI will identify which installation step each photo belongs to.
          You&apos;ll then review and approve the results.
        </p>

        {error && (
          <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 rounded-lg">
            <p className="text-red-600 dark:text-red-400">{error}</p>
          </div>
        )}

        <div className="flex justify-center gap-3">
          <button
            onClick={onBack}
            className="px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            ← Back
          </button>
          <button
            onClick={runCategorization}
            disabled={isProcessing || photoCount === 0}
            className="px-6 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isProcessing ? (
              <span className="flex items-center gap-2">
                <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                Categorizing...
              </span>
            ) : (
              'Run AI Categorization'
            )}
          </button>
        </div>
      </div>
    );
  }

  // Processing state
  if (state.status === 'processing') {
    return (
      <div className="text-center py-12">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600 mx-auto mb-4" />
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
          Categorizing Photos...
        </h3>
        <p className="text-gray-600 dark:text-gray-400">
          The AI is analyzing {photoCount} photos. This may take a few minutes.
        </p>
      </div>
    );
  }

  // Approved state - can proceed
  if (state.status === 'approved') {
    // Count photos per step
    const stepCounts = new Map<number, number>();
    state.results.forEach((result) => {
      const step = result.human_override_step ?? result.vlm_predicted_step;
      stepCounts.set(step, (stepCounts.get(step) || 0) + 1);
    });

    // Find missing steps (1-10)
    const missingSteps: number[] = [];
    for (let i = 1; i <= 10; i++) {
      if (!stepCounts.has(i) || stepCounts.get(i) === 0) {
        missingSteps.push(i);
      }
    }

    return (
      <div className="space-y-6">
        {/* Success banner */}
        <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700 rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-2xl">✅</span>
              <div>
                <h4 className="font-semibold text-green-800 dark:text-green-200">
                  Categorization Approved
                </h4>
                <p className="text-green-600 dark:text-green-400 text-sm">
                  {state.results.length} photos categorized and ready for validation.
                </p>
              </div>
            </div>
            <button
              onClick={runCategorization}
              disabled={isProcessing}
              className="px-3 py-1 text-sm border border-green-600 text-green-600 rounded hover:bg-green-100 dark:hover:bg-green-900/30"
            >
              Re-categorize
            </button>
          </div>
        </div>

        {/* Step coverage summary */}
        <div className="grid grid-cols-5 gap-2">
          {Array.from({ length: 10 }, (_, i) => i + 1).map((step) => {
            const count = stepCounts.get(step) || 0;
            const isMissing = count === 0;

            return (
              <div
                key={step}
                className={`p-3 rounded-lg text-center border ${
                  isMissing
                    ? 'border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/20'
                    : 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50'
                }`}
              >
                <div className={`text-xl font-bold ${isMissing ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-white'}`}>
                  {count}
                </div>
                <div className="text-xs text-gray-600 dark:text-gray-400 truncate">
                  {STEP_LABELS[step]}
                </div>
              </div>
            );
          })}
        </div>

        {/* Missing steps warning */}
        {missingSteps.length > 0 && (
          <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-700 rounded-lg p-4">
            <div className="flex items-center gap-2 text-yellow-700 dark:text-yellow-300">
              <span>⚠️</span>
              <span className="font-medium">
                Missing photos for: {missingSteps.map(s => STEP_LABELS[s]).join(', ')}
              </span>
            </div>
            <p className="text-yellow-600 dark:text-yellow-400 text-sm mt-1">
              This may result in an incomplete review. Consider if photos are missing or incorrectly categorized.
            </p>
          </div>
        )}

        {/* Navigation */}
        <div className="flex justify-between pt-4 border-t border-gray-200 dark:border-gray-700">
          <button
            onClick={onBack}
            className="px-4 py-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
          >
            ← Back
          </button>
          <button
            onClick={handleProceed}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Continue to Data Validation →
          </button>
        </div>
      </div>
    );
  }

  // Categorized state - awaiting review/approval
  return (
    <div className="space-y-4">
      {/* Photo lightbox */}
      {lightboxPhoto && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setLightboxPhoto(null)}
        >
          <div className="relative max-w-4xl max-h-[90vh]">
            <img
              src={lightboxPhoto}
              alt="Full size"
              className="max-w-full max-h-[90vh] object-contain rounded-lg"
            />
            <button
              onClick={() => setLightboxPhoto(null)}
              className="absolute top-2 right-2 w-8 h-8 bg-black/50 text-white rounded-full hover:bg-black/70"
            >
              ×
            </button>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-700 rounded-lg p-4">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="font-semibold text-yellow-800 dark:text-yellow-200">
              Review AI Categorizations
            </h4>
            <p className="text-yellow-600 dark:text-yellow-400 text-sm">
              Review each photo&apos;s category. Approve or override as needed.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={runCategorization}
              disabled={isProcessing}
              className="px-3 py-1 text-sm border border-yellow-600 text-yellow-600 rounded hover:bg-yellow-100 dark:hover:bg-yellow-900/30 disabled:opacity-50"
            >
              Re-run
            </button>
            <button
              onClick={approveAll}
              disabled={isProcessing}
              className="px-3 py-1 text-sm bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
            >
              Approve All
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="p-3 bg-red-50 dark:bg-red-900/20 rounded-lg">
          <p className="text-red-600 dark:text-red-400">{error}</p>
        </div>
      )}

      {/* Photo grid - sorted by step number */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[400px] overflow-y-auto pr-2">
        {[...state.results]
          .sort((a, b) => a.vlm_predicted_step - b.vlm_predicted_step)
          .map((result) => {
          const approval = approvals.get(result.photo_filename);
          const isApproved = approval?.approved !== false;
          const overrideStep = approval?.overrideStep;
          const photoUrl = `/api/activate/photo/${dropNumber}/${result.photo_filename}`;

          return (
            <div
              key={result.photo_filename}
              className={`border rounded-lg p-3 ${
                result.vlm_confidence < 0.5
                  ? 'border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/10'
                  : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800'
              }`}
            >
              <div className="flex gap-3">
                {/* Thumbnail */}
                <button
                  type="button"
                  onClick={() => setLightboxPhoto(photoUrl)}
                  className="flex-shrink-0 relative group"
                >
                  <img
                    src={photoUrl}
                    alt={result.photo_filename}
                    className="w-20 h-20 object-cover rounded border border-gray-200 dark:border-gray-600"
                  />
                  <span className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity rounded">
                    <span className="text-white text-xs">View</span>
                  </span>
                </button>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium text-gray-900 dark:text-white text-sm">
                      Step {result.vlm_predicted_step}: {STEP_LABELS[result.vlm_predicted_step]}
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded text-xs font-medium ${getConfidenceBg(result.vlm_confidence)} ${getConfidenceColor(result.vlm_confidence)}`}
                    >
                      {Math.round(result.vlm_confidence * 100)}%
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2">
                    {result.vlm_identified_as}
                  </p>

                  {/* Approval controls */}
                  <div className="mt-2 flex items-center gap-3">
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={isApproved}
                        onChange={(e) => setPhotoApproval(result.photo_filename, e.target.checked)}
                        className="w-4 h-4 text-green-600 rounded focus:ring-green-500"
                      />
                      <span className="text-xs text-gray-600 dark:text-gray-400">Approve</span>
                    </label>

                    {!isApproved && (
                      <select
                        value={overrideStep ?? ''}
                        onChange={(e) =>
                          setPhotoApproval(result.photo_filename, false, e.target.value ? parseInt(e.target.value) : undefined)
                        }
                        className="text-xs border border-gray-300 dark:border-gray-600 rounded px-1.5 py-0.5 bg-white dark:bg-gray-800"
                      >
                        <option value="">Override to...</option>
                        <option value="0">❌ Discard</option>
                        {Array.from({ length: 10 }, (_, i) => i + 1).map((step) => (
                          <option key={step} value={step}>
                            {step}: {STEP_LABELS[step]}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Navigation */}
      <div className="flex justify-between pt-4 border-t border-gray-200 dark:border-gray-700">
        <button
          onClick={onBack}
          className="px-4 py-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
        >
          ← Back
        </button>
        <button
          onClick={submitApprovals}
          disabled={isProcessing}
          className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          {isProcessing ? 'Saving...' : 'Save & Continue →'}
        </button>
      </div>
    </div>
  );
}
