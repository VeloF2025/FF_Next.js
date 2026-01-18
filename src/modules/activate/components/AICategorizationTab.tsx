/**
 * AICategorizationTab Component
 *
 * Tab for VLM-based photo categorization with human approval workflow.
 * Phase 1: Human-in-the-loop - VLM suggests categories, human approves/overrides
 * Phase 2: Auto-approve high-confidence predictions (future)
 *
 * Features:
 * - Auto-detect new photos uploaded after initial categorization
 * - Shows banner when new photos are detected
 * - Automatic re-categorization for new photos
 */

'use client';

import { useState, useEffect } from 'react';
import {
  VlmCategorizationResult,
  STEP_LABELS,
  VlmCategorizationStatus,
} from '../types/unified.types';

interface AICategorizationTabProps {
  dropNumber: string;
  photoCount: number;
  onCategorizationApproved?: () => void;
}

type CategorizationState = {
  status: VlmCategorizationStatus;
  results: VlmCategorizationResult[];
  categorizedAt: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
};

export function AICategorizationTab({
  dropNumber,
  photoCount,
  onCategorizationApproved,
}: AICategorizationTabProps) {
  const [state, setState] = useState<CategorizationState>({
    status: 'pending',
    results: [],
    categorizedAt: null,
    approvedBy: null,
    approvedAt: null,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [approvals, setApprovals] = useState<Map<string, { approved: boolean; overrideStep?: number }>>(
    new Map()
  );

  // Track if new photos have been detected
  const [newPhotosDetected, setNewPhotosDetected] = useState(false);
  const [oneMapPhotoCount, setOneMapPhotoCount] = useState<number | null>(null);
  const [isCheckingForNewPhotos, setIsCheckingForNewPhotos] = useState(false);

  // Load current categorization state and check for new photos
  useEffect(() => {
    loadCategorizationState();
  }, [dropNumber]);

  // Check for new photos when categorization is loaded
  useEffect(() => {
    if (!isLoading && (state.status === 'categorized' || state.status === 'approved')) {
      checkForNewPhotos();
    }
  }, [isLoading, state.status, dropNumber]);

  async function checkForNewPhotos() {
    if (state.results.length === 0) return;

    setIsCheckingForNewPhotos(true);
    try {
      // Fetch current photo count from OneMap (via our fetch-photos endpoint with force=false)
      const response = await fetch('/api/activate/fetch-photos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dropNumber, force: false }),
      });

      const data = await response.json();
      if (data.success) {
        const currentCount = data.data.count || 0;
        setOneMapPhotoCount(currentCount);

        // Compare with categorized count
        if (currentCount > state.results.length) {
          setNewPhotosDetected(true);
        } else {
          setNewPhotosDetected(false);
        }
      }
    } catch (err) {
      // Silently fail - not critical
    } finally {
      setIsCheckingForNewPhotos(false);
    }
  }

  async function loadCategorizationState() {
    setIsLoading(true);
    setNewPhotosDetected(false);
    try {
      const response = await fetch(`/api/activate/categorize-photos?dropNumber=${dropNumber}`);
      const data = await response.json();

      if (data.success) {
        setState({
          status: data.data.status || 'pending',
          results: data.data.categorizations || [],
          categorizedAt: data.data.categorizedAt,
          approvedBy: data.data.approvedBy,
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
      }
    } catch (err) {
      setError('Failed to load categorization state');
    } finally {
      setIsLoading(false);
    }
  }

  async function runCategorization() {
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
          approvedBy: null,
          approvedAt: null,
        });
        setApprovals(new Map());
      } else {
        setError(data.message || 'Categorization failed');
      }
    } catch (err) {
      setError('Failed to run categorization');
    } finally {
      setIsProcessing(false);
    }
  }

  async function approveAll() {
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
          approvedBy: 'current_user',
          approvedAt: new Date().toISOString(),
        }));
        onCategorizationApproved?.();
      } else {
        setError(data.message || 'Approval failed');
      }
    } catch (err) {
      setError('Failed to approve categorization');
    } finally {
      setIsProcessing(false);
    }
  }

  async function submitApprovals() {
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
          approvedBy: 'current_user',
          approvedAt: new Date().toISOString(),
        }));
        onCategorizationApproved?.();
      } else {
        setError(data.message || 'Approval failed');
      }
    } catch (err) {
      setError('Failed to submit approvals');
    } finally {
      setIsProcessing(false);
    }
  }

  function setPhotoApproval(filename: string, approved: boolean, overrideStep?: number) {
    setApprovals((prev) => {
      const newMap = new Map(prev);
      newMap.set(filename, { approved, overrideStep });
      return newMap;
    });
  }

  function getConfidenceColor(confidence: number): string {
    if (confidence >= 0.9) return 'text-green-600 dark:text-green-400';
    if (confidence >= 0.7) return 'text-yellow-600 dark:text-yellow-400';
    return 'text-red-600 dark:text-red-400';
  }

  function getConfidenceBg(confidence: number): string {
    if (confidence >= 0.9) return 'bg-green-100 dark:bg-green-900/30';
    if (confidence >= 0.7) return 'bg-yellow-100 dark:bg-yellow-900/30';
    return 'bg-red-100 dark:bg-red-900/30';
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 dark:border-blue-400"></div>
        <span className="ml-3 text-gray-600 dark:text-gray-400">Loading categorization...</span>
      </div>
    );
  }

  // Not categorized yet
  if (state.status === 'pending') {
    return (
      <div className="text-center py-12">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-purple-100 dark:bg-purple-900/30 mb-4">
          <span className="text-3xl">🏷️</span>
        </div>
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
          AI Categorization Not Run
        </h3>
        <p className="text-gray-600 dark:text-gray-400 mb-2">
          Run AI categorization to have the VLM identify and classify {photoCount} photos.
        </p>
        <p className="text-sm text-gray-500 dark:text-gray-500 mb-6">
          This will analyze each photo and predict which installation step it belongs to.
        </p>
        {error && <p className="text-red-600 dark:text-red-400 mb-4">{error}</p>}
        <button
          onClick={runCategorization}
          disabled={isProcessing || photoCount === 0}
          className="px-6 py-3 bg-purple-600 dark:bg-purple-500 text-white rounded-lg hover:bg-purple-700 dark:hover:bg-purple-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isProcessing ? 'Categorizing...' : 'Run AI Categorization'}
        </button>
      </div>
    );
  }

  // Processing
  if (state.status === 'processing') {
    return (
      <div className="text-center py-12">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600 dark:border-purple-400 mx-auto mb-4"></div>
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
          Categorizing Photos...
        </h3>
        <p className="text-gray-600 dark:text-gray-400">
          The AI is analyzing {photoCount} photos. This may take a few minutes.
        </p>
      </div>
    );
  }

  // New photos detected banner (reusable)
  const NewPhotosBanner = () => {
    if (!newPhotosDetected || oneMapPhotoCount === null) return null;

    const newPhotoCount = oneMapPhotoCount - state.results.length;

    return (
      <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4 mb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-2xl">📸</span>
            <div>
              <h4 className="font-semibold text-blue-800 dark:text-blue-200">
                {newPhotoCount} New Photo{newPhotoCount > 1 ? 's' : ''} Detected
              </h4>
              <p className="text-blue-600 dark:text-blue-400 text-sm">
                {oneMapPhotoCount} photos in OneMap vs {state.results.length} categorized.
                Re-categorize to include new photos.
              </p>
            </div>
          </div>
          <button
            onClick={runCategorization}
            disabled={isProcessing}
            className="px-4 py-2 text-sm bg-blue-600 dark:bg-blue-500 text-white rounded-lg hover:bg-blue-700 dark:hover:bg-blue-600 disabled:opacity-50 transition-colors flex items-center gap-2"
          >
            {isProcessing ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                <span>Processing...</span>
              </>
            ) : (
              <>
                <span>🔄</span>
                <span>Re-categorize All</span>
              </>
            )}
          </button>
        </div>
      </div>
    );
  };

  // Approved
  if (state.status === 'approved') {
    return (
      <div className="space-y-6">
        {/* New photos detected banner */}
        <NewPhotosBanner />

        <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-green-800 dark:text-green-200">
                Categorization Approved
              </h3>
              <p className="text-green-600 dark:text-green-400 text-sm mt-1">
                {state.results.length} photos have been categorized and approved.
                {state.approvedAt && ` Approved at ${new Date(state.approvedAt).toLocaleString()}`}
              </p>
            </div>
            <button
              onClick={runCategorization}
              disabled={isProcessing}
              className="px-4 py-2 text-sm bg-green-600 dark:bg-green-500 text-white rounded-lg hover:bg-green-700 dark:hover:bg-green-600 disabled:opacity-50 transition-colors"
            >
              Re-categorize
            </button>
          </div>
        </div>

        {/* Show approved results summary */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {Array.from({ length: 10 }, (_, i) => i + 1).map((step) => {
            const photosForStep = state.results.filter((r) => {
              const finalStep = r.human_override_step ?? r.vlm_predicted_step;
              return finalStep === step;
            });
            return (
              <div
                key={step}
                className="bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-lg p-3 text-center"
              >
                <div className="text-2xl font-bold text-gray-900 dark:text-white">
                  {photosForStep.length}
                </div>
                <div className="text-xs text-gray-600 dark:text-gray-400 truncate">
                  {STEP_LABELS[step]}
                </div>
              </div>
            );
          })}
        </div>

        {/* Show discarded photos if any */}
        {(() => {
          const discardedPhotos = state.results.filter((r) => {
            const finalStep = r.human_override_step ?? r.vlm_predicted_step;
            return finalStep === 0;
          });
          if (discardedPhotos.length === 0) return null;
          return (
            <div className="mt-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-lg p-4">
              <div className="flex items-center gap-2 text-red-700 dark:text-red-300">
                <span className="text-lg">🗑️</span>
                <span className="font-medium">
                  {discardedPhotos.length} photo{discardedPhotos.length > 1 ? 's' : ''} discarded as rubbish
                </span>
              </div>
            </div>
          );
        })()}
      </div>
    );
  }

  // Categorized - awaiting approval
  return (
    <div className="space-y-6">
      {/* New photos detected banner */}
      <NewPhotosBanner />

      {/* Header */}
      <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-yellow-800 dark:text-yellow-200">
              Awaiting Approval
            </h3>
            <p className="text-yellow-600 dark:text-yellow-400 text-sm">
              Review the AI categorizations below and approve or override as needed.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={runCategorization}
              disabled={isProcessing}
              className="px-4 py-2 text-sm border border-yellow-600 dark:border-yellow-400 text-yellow-600 dark:text-yellow-400 rounded-lg hover:bg-yellow-100 dark:hover:bg-yellow-900/30 disabled:opacity-50 transition-colors"
            >
              Re-run
            </button>
            <button
              onClick={approveAll}
              disabled={isProcessing}
              className="px-4 py-2 text-sm bg-green-600 dark:bg-green-500 text-white rounded-lg hover:bg-green-700 dark:hover:bg-green-600 disabled:opacity-50 transition-colors"
            >
              Approve All
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <p className="text-red-600 dark:text-red-400">{error}</p>
        </div>
      )}

      {/* Results grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {state.results.map((result) => {
          const approval = approvals.get(result.photo_filename);
          const isApproved = approval?.approved !== false;
          const overrideStep = approval?.overrideStep;
          const matchesOriginal = result.vlm_predicted_step === result.original_step;

          return (
            <div
              key={result.photo_filename}
              className={`border rounded-lg p-4 ${
                result.vlm_confidence < 0.5
                  ? 'border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/10'
                  : !matchesOriginal
                  ? 'border-yellow-300 dark:border-yellow-700 bg-yellow-50 dark:bg-yellow-900/10'
                  : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800'
              }`}
            >
              {/* Photo thumbnail and info */}
              <div className="flex gap-4">
                <div className="flex-shrink-0">
                  <img
                    src={`/api/activate/photo/${dropNumber}/${result.photo_filename}`}
                    alt={result.photo_filename}
                    className="w-24 h-24 object-cover rounded-lg border border-gray-200 dark:border-gray-700"
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-gray-500 dark:text-gray-400 truncate mb-1">
                    {result.photo_filename}
                  </p>

                  {/* Original vs Predicted */}
                  <div className="space-y-1 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="text-gray-500 dark:text-gray-400 w-16">Original:</span>
                      <span className="text-gray-700 dark:text-gray-300">
                        {result.original_step
                          ? `Step ${result.original_step}: ${STEP_LABELS[result.original_step]}`
                          : 'Unknown'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-gray-500 dark:text-gray-400 w-16">VLM:</span>
                      <span className="font-medium text-gray-900 dark:text-white">
                        Step {result.vlm_predicted_step}: {STEP_LABELS[result.vlm_predicted_step]}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded text-xs font-medium ${getConfidenceBg(
                          result.vlm_confidence
                        )} ${getConfidenceColor(result.vlm_confidence)}`}
                      >
                        {Math.round(result.vlm_confidence * 100)}%
                      </span>
                    </div>
                  </div>

                  {/* VLM reasoning */}
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-2 line-clamp-2">
                    {result.vlm_identified_as}
                  </p>
                </div>
              </div>

              {/* Approval controls */}
              <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={isApproved}
                        onChange={(e) =>
                          setPhotoApproval(result.photo_filename, e.target.checked, undefined)
                        }
                        className="w-4 h-4 text-green-600 rounded focus:ring-green-500"
                      />
                      <span className="text-sm text-gray-700 dark:text-gray-300">Approve</span>
                    </label>
                  </div>

                  {!isApproved && (
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-gray-500 dark:text-gray-400">Override to:</span>
                      <select
                        value={overrideStep ?? ''}
                        onChange={(e) =>
                          setPhotoApproval(
                            result.photo_filename,
                            false,
                            e.target.value ? parseInt(e.target.value) : undefined
                          )
                        }
                        className="text-sm border border-gray-300 dark:border-gray-600 rounded px-2 py-1 bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                      >
                        <option value="">Select step...</option>
                        <option value="0" className="text-red-600">
                          ❌ {STEP_LABELS[0]}
                        </option>
                        {Array.from({ length: 10 }, (_, i) => i + 1).map((step) => (
                          <option key={step} value={step}>
                            {step}: {STEP_LABELS[step]}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Submit button */}
      <div className="flex justify-end">
        <button
          onClick={submitApprovals}
          disabled={isProcessing}
          className="px-6 py-3 bg-blue-600 dark:bg-blue-500 text-white rounded-lg hover:bg-blue-700 dark:hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isProcessing ? 'Saving...' : 'Save Approvals'}
        </button>
      </div>
    </div>
  );
}
