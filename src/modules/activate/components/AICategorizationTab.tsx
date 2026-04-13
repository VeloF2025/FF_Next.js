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
import { LoadingSpinner, InlineSpinner } from '@/components/ui/LoadingSpinner';

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
  const [, setIsCheckingForNewPhotos] = useState(false);

  // Track expanded state for approved view
  const [showAllPhotos, setShowAllPhotos] = useState(false);
  const [editingPhoto, setEditingPhoto] = useState<string | null>(null);
  const [isSavingEdit, setIsSavingEdit] = useState(false);

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

  async function updatePhotoStep(filename: string, newStep: number) {
    setIsSavingEdit(true);
    setError(null);
    try {
      const response = await fetch('/api/activate/update-photo-step', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dropNumber,
          photoFilename: filename,
          newStep,
          reason: 'Manual edit',
        }),
      });

      const data = await response.json();

      if (data.success) {
        // Update local state
        setState((prev) => ({
          ...prev,
          results: prev.results.map((r) => {
            if (r.photo_filename === filename) {
              return {
                ...r,
                human_override_step: newStep === r.vlm_predicted_step ? null : newStep,
                human_approved: newStep === r.vlm_predicted_step,
              };
            }
            return r;
          }),
        }));
        setEditingPhoto(null);
      } else {
        setError(data.message || 'Failed to update photo step');
      }
    } catch (err) {
      setError('Failed to update photo step');
    } finally {
      setIsSavingEdit(false);
    }
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
      <LoadingSpinner className="py-12" size="lg" label="Loading categorization..." />
    );
  }

  // Not categorized yet
  if (state.status === 'pending') {
    return (
      <div className="text-center py-12">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-purple-100 dark:bg-purple-900/30 mb-4">
          <span className="text-3xl">🏷️</span>
        </div>
        <h3 className="text-lg font-semibold text-foreground mb-2">
          AI Categorization Not Run
        </h3>
        <p className="text-muted-foreground mb-2">
          Run AI categorization to have the VLM identify and classify {photoCount} photos.
        </p>
        <p className="text-sm text-muted-foreground dark:text-gray-400 mb-6">
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
        <LoadingSpinner className="mb-4" size="xl" label="" />
        <h3 className="text-lg font-semibold text-foreground mb-2">
          Categorizing Photos...
        </h3>
        <p className="text-muted-foreground">
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
                <InlineSpinner size="sm" />
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
              {isProcessing ? 'Re-categorizing...' : 'Re-categorize'}
            </button>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
            <p className="text-red-600 dark:text-red-400">{error}</p>
          </div>
        )}

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
                className="bg-background/50 border border-border rounded-lg p-3 text-center"
              >
                <div className="text-2xl font-bold text-foreground">
                  {photosForStep.length}
                </div>
                <div className="text-xs text-muted-foreground truncate">
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
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-lg p-4">
              <div className="flex items-center gap-2 text-red-700 dark:text-red-300">
                <span className="text-lg">🗑️</span>
                <span className="font-medium">
                  {discardedPhotos.length} photo{discardedPhotos.length > 1 ? 's' : ''} discarded as rubbish
                </span>
              </div>
            </div>
          );
        })()}

        {/* Toggle to show/edit individual photos */}
        <div className="border border-border rounded-lg overflow-hidden">
          <button
            onClick={() => setShowAllPhotos(!showAllPhotos)}
            className="w-full px-4 py-3 bg-input flex items-center justify-between hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            <div className="flex items-center gap-2">
              <span className="text-lg">📷</span>
              <span className="font-medium text-muted-foreground">
                {showAllPhotos ? 'Hide' : 'Edit'} Individual Photos
              </span>
            </div>
            <span className="text-muted-foreground text-xl">
              {showAllPhotos ? '▲' : '▼'}
            </span>
          </button>

          {showAllPhotos && (
            <div className="p-4 space-y-3 max-h-[600px] overflow-y-auto">
              {state.results.map((result) => {
                const finalStep = result.human_override_step ?? result.vlm_predicted_step;
                const isEditing = editingPhoto === result.photo_filename;
                const wasOverridden = result.human_override_step !== null;

                return (
                  <div
                    key={result.photo_filename}
                    className={`border rounded-lg p-3 ${
                      wasOverridden
                        ? 'border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-900/10'
                        : 'border-border bg-card'
                    }`}
                  >
                    <div className="flex gap-3 items-center">
                      {/* Thumbnail */}
                      <img
                        src={`/api/activate/photo/${dropNumber}/${result.photo_filename}`}
                        alt={result.photo_filename}
                        className="w-16 h-16 object-cover rounded-lg border border-gray-200 dark:border-gray-600 flex-shrink-0"
                      />

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-muted-foreground truncate">
                          {result.photo_filename}
                        </p>
                        <div className="flex items-center gap-2 mt-1">
                          {isEditing ? (
                            <select
                              autoFocus
                              defaultValue={finalStep}
                              onChange={(e) => updatePhotoStep(result.photo_filename, parseInt(e.target.value))}
                              disabled={isSavingEdit}
                              className="text-sm border border-blue-300 dark:border-blue-600 rounded px-2 py-1 bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-blue-500"
                              onBlur={() => !isSavingEdit && setEditingPhoto(null)}
                            >
                              <option value="0" className="text-red-600">
                                0: {STEP_LABELS[0]}
                              </option>
                              {Array.from({ length: 10 }, (_, i) => i + 1).map((step) => (
                                <option key={step} value={step}>
                                  {step}: {STEP_LABELS[step]}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <>
                              <span className="font-medium text-foreground">
                                Step {finalStep}: {STEP_LABELS[finalStep]}
                              </span>
                              {wasOverridden && (
                                <span className="text-xs px-2 py-0.5 bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 rounded">
                                  Edited
                                </span>
                              )}
                            </>
                          )}
                        </div>
                        {!isEditing && result.vlm_predicted_step !== finalStep && (
                          <p className="text-xs text-muted-foreground mt-0.5">
                            VLM predicted: Step {result.vlm_predicted_step} ({Math.round(result.vlm_confidence * 100)}%)
                          </p>
                        )}
                      </div>

                      {/* Edit button */}
                      {!isEditing && (
                        <button
                          onClick={() => setEditingPhoto(result.photo_filename)}
                          className="px-3 py-1.5 text-sm border border-border text-muted-foreground rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors flex-shrink-0"
                        >
                          Edit
                        </button>
                      )}
                      {isEditing && isSavingEdit && (
                        <InlineSpinner size="sm" />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
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
                  : 'border-border bg-card'
              }`}
            >
              {/* Photo thumbnail and info */}
              <div className="flex gap-4">
                <div className="flex-shrink-0">
                  <img
                    src={`/api/activate/photo/${dropNumber}/${result.photo_filename}`}
                    alt={result.photo_filename}
                    className="w-24 h-24 object-cover rounded-lg border border-border"
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-muted-foreground truncate mb-1">
                    {result.photo_filename}
                  </p>

                  {/* Original vs Predicted */}
                  <div className="space-y-1 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground w-16">Original:</span>
                      <span className="text-muted-foreground">
                        {result.original_step
                          ? `Step ${result.original_step}: ${STEP_LABELS[result.original_step]}`
                          : 'Unknown'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground w-16">VLM:</span>
                      <span className="font-medium text-foreground">
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
                  <p className="text-xs text-muted-foreground mt-2 line-clamp-2">
                    {result.vlm_identified_as}
                  </p>
                </div>
              </div>

              {/* Approval controls */}
              <div className="mt-4 pt-4 border-t border-border">
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
                      <span className="text-sm text-muted-foreground">Approve</span>
                    </label>
                  </div>

                  {!isApproved && (
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-muted-foreground">Override to:</span>
                      <select
                        value={overrideStep ?? ''}
                        onChange={(e) =>
                          setPhotoApproval(
                            result.photo_filename,
                            false,
                            e.target.value ? parseInt(e.target.value) : undefined
                          )
                        }
                        className="text-sm border border-border rounded px-2 py-1 bg-card text-foreground"
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
