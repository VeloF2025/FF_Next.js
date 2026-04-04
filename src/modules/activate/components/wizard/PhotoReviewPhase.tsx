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

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { log } from '@/lib/logger';
import type {
  VlmCategorizationResult,
  VlmCategorizationStatus,
  Photo,
  AutoApprovalResult,
  AutoApprovalSummary,
  AutoApprovalTier,
} from '../../types/unified.types';
import { STEP_LABELS, PHOTO_REJECTION_REASONS } from '../../utils/stepMapper';
import { WizardProgressOverlay, type CategorizationPhase } from './WizardProgressOverlay';
import { PhotoLightbox, type LightboxPhoto } from '@/components/PhotoLightbox';
import { Button } from '@/components/ui/button';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

interface PhotoReviewPhaseProps {
  dropNumber: string;
  photoCount: number;
  onComplete: (categorizedPhotos: Photo[], stepsCovered: number[], stepsMissing: number[]) => void;
  onBack: () => void;
  onSkipToDecision?: () => void;
}

interface CategorizationState {
  status: VlmCategorizationStatus;
  results: VlmCategorizationResult[];
  categorizedAt: string | null;
  approvedAt: string | null;
  autoApprovalTiers: Map<string, AutoApprovalResult>;
  autoApprovalSummary: AutoApprovalSummary | null;
}

export function PhotoReviewPhase({
  dropNumber,
  photoCount,
  onComplete,
  onBack,
  onSkipToDecision,
}: PhotoReviewPhaseProps) {
  const [state, setState] = useState<CategorizationState>({
    status: 'pending',
    results: [],
    categorizedAt: null,
    approvedAt: null,
    autoApprovalTiers: new Map(),
    autoApprovalSummary: null,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [approvals, setApprovals] = useState<Map<string, { approved: boolean; overrideStep?: number; rejectionReason?: string }>>(
    new Map()
  );

  // Lightbox state — index into lightboxPhotos
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  // Edit mode - allows editing approved categorizations without re-running VLM
  const [isEditing, setIsEditing] = useState(false);

  // Categorization progress phase
  const [categorizationPhase, setCategorizationPhase] = useState<CategorizationPhase | null>(null);

  // Helper: parse auto-approval tiers from API response into a Map
  const parseTiers = useCallback((tiersArray?: AutoApprovalResult[]): Map<string, AutoApprovalResult> => {
    const map = new Map<string, AutoApprovalResult>();
    if (tiersArray) {
      for (const t of tiersArray) {
        map.set(t.photo_filename, t);
      }
    }
    return map;
  }, []);

  // Helper: get tier for a photo (default to review_recommended if unknown)
  const getTier = useCallback((filename: string): AutoApprovalTier => {
    return state.autoApprovalTiers.get(filename)?.tier || 'review_recommended';
  }, [state.autoApprovalTiers]);

  // Helper: pre-approve auto_approved tier photos in the approvals map
  const initAutoApprovals = useCallback((
    results: VlmCategorizationResult[],
    tiersMap: Map<string, AutoApprovalResult>,
    existingApprovals: Map<string, { approved: boolean; overrideStep?: number }>
  ) => {
    const newApprovals = new Map(existingApprovals);
    for (const result of results) {
      const tier = tiersMap.get(result.photo_filename)?.tier;
      // Auto-approve high confidence photos that don't already have a human decision
      if (tier === 'auto_approved' && !newApprovals.has(result.photo_filename) && result.human_approved === null) {
        newApprovals.set(result.photo_filename, { approved: true });
      }
    }
    return newApprovals;
  }, []);

  // Build flat lightbox photo list from categorization results
  const lightboxPhotos: LightboxPhoto[] = useMemo(() =>
    state.results.map(r => ({
      url: `/api/activate/photo/${dropNumber}/${r.photo_filename}`,
      label: r.photo_filename,
      metadata: `Step ${r.vlm_predicted_step}: ${STEP_LABELS[r.vlm_predicted_step] || 'Unknown'} — Confidence: ${Math.round(r.vlm_confidence * 100)}%`,
    })),
    [state.results, dropNumber]
  );

  const openLightbox = (photoFilename: string) => {
    const idx = state.results.findIndex(r => r.photo_filename === photoFilename);
    setLightboxIndex(idx >= 0 ? idx : null);
  };

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
        const tiersMap = parseTiers(data.data.autoApprovalTiers);

        setState({
          status: data.data.status || 'pending',
          results: data.data.categorizations || [],
          categorizedAt: data.data.categorizedAt,
          approvedAt: data.data.approvedAt,
          autoApprovalTiers: tiersMap,
          autoApprovalSummary: data.data.autoApprovalSummary || null,
        });

        // Initialize approvals from existing results + auto-approve high-confidence
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
          const withAutoApprovals = initAutoApprovals(data.data.categorizations, tiersMap, existingApprovals);
          setApprovals(withAutoApprovals);
        }
      } else {
        setError(data.message || 'Failed to load categorization state');
      }
    } catch (err) {
      log.error(`Failed to load categorization state: ${err}`, undefined, 'PhotoReviewPhase');
      setError('Failed to load categorization state');
    } finally {
      setIsLoading(false);
    }
  }, [dropNumber]);

  const runCategorization = async () => {
    setIsProcessing(true);
    setCategorizationPhase('analyzing');
    setError(null);

    try {
      // Show processing phase after short delay
      setTimeout(() => setCategorizationPhase('processing'), 800);

      const response = await fetch('/api/activate/categorize-photos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dropNumber, force: true }),
      });

      setCategorizationPhase('saving');
      const data = await response.json();

      if (data.success) {
        // Brief complete animation
        setCategorizationPhase('complete');
        await new Promise(resolve => setTimeout(resolve, 600));

        const tiersMap = parseTiers(data.data.autoApprovalTiers);
        const results = data.data.categorizations || [];

        setState({
          status: 'categorized',
          results,
          categorizedAt: new Date().toISOString(),
          approvedAt: null,
          autoApprovalTiers: tiersMap,
          autoApprovalSummary: data.data.autoApprovalSummary || null,
        });
        // Pre-approve auto_approved tier photos
        setApprovals(initAutoApprovals(results, tiersMap, new Map()));
        log.info('PhotoReviewPhase', `Categorization complete for ${dropNumber}`);
      } else {
        setError(data.error?.message || data.message || 'Categorization failed');
      }
    } catch (err) {
      log.error(`Categorization failed: ${err}`, undefined, 'PhotoReviewPhase');
      setError('Failed to run categorization');
    } finally {
      setIsProcessing(false);
      setCategorizationPhase(null);
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
        log.info(`All categorizations approved for ${dropNumber}`, undefined, 'PhotoReviewPhase');
      } else {
        setError(data.message || 'Approval failed');
      }
    } catch (err) {
      log.error(`Approval failed: ${err}`, undefined, 'PhotoReviewPhase');
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
        override_reason: approval?.rejectionReason, // Pass rejection reason to API
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
        log.info(`Approvals submitted for ${dropNumber}`, undefined, 'PhotoReviewPhase');
      } else {
        setError(data.message || 'Approval failed');
      }
    } catch (err) {
      log.error(`Approval failed: ${err}`, undefined, 'PhotoReviewPhase');
      setError('Failed to submit approvals');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleProceed = () => {
    // Convert categorization results to Photo array with correct steps
    // Use approvals map for current session overrides, fall back to saved overrides
    // EXCLUDE rejected photos (approved === false)
    const categorizedPhotos: Photo[] = state.results
      .filter((result) => {
        const approval = approvals.get(result.photo_filename);
        return approval?.approved !== false; // Include if not explicitly rejected
      })
      .map((result) => {
        const approval = approvals.get(result.photo_filename);
        const step = approval?.overrideStep ?? result.human_override_step ?? result.vlm_predicted_step;
        return {
          filename: result.photo_filename,
          step,
          url: `/api/activate/photo/${dropNumber}/${result.photo_filename}`,
          original_type: null,
        };
      });

    // Calculate step coverage - EXCLUDE rejected photos
    const stepCounts = new Map<number, number>();
    state.results.forEach((result) => {
      const approval = approvals.get(result.photo_filename);
      // Skip explicitly rejected photos
      if (approval?.approved === false) return;
      const step = approval?.overrideStep ?? result.human_override_step ?? result.vlm_predicted_step;
      if (step >= 1 && step <= 12) {
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

  const setPhotoApproval = (filename: string, approved: boolean, overrideStep?: number, rejectionReason?: string) => {
    setApprovals((prev) => {
      const newMap = new Map(prev);
      newMap.set(filename, { approved, overrideStep, rejectionReason });
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
        <LoadingSpinner size="lg" label="Loading categorization..." />
      </div>
    );
  }

  // Pending state - need to run categorization
  if (state.status === 'pending') {
    return (
      <div className="text-center py-8">
        {/* Categorization Progress Overlay */}
        <WizardProgressOverlay
          isVisible={categorizationPhase !== null}
          operationType="categorization"
          phase={categorizationPhase || 'analyzing'}
          dropNumber={dropNumber}
          photoCount={photoCount}
        />

        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-purple-100 dark:bg-purple-900/30 mb-4">
          <span className="text-3xl">🏷️</span>
        </div>
        <h3 className="text-lg font-semibold text-foreground mb-2">
          AI Photo Categorization Required
        </h3>
        <p className="text-muted-foreground mb-2">
          Before proceeding, we need to categorize {photoCount} photos using AI.
        </p>
        <p className="text-sm text-muted-foreground dark:text-gray-400 mb-6">
          The AI will identify which installation step each photo belongs to.
          You&apos;ll then review and approve the results.
        </p>

        {error && (
          <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 rounded-lg">
            <p className="text-red-600 dark:text-red-400">{error}</p>
          </div>
        )}

        <div className="flex justify-center gap-3">
          <Button
            variant="secondary"
            onClick={onBack}
          >
            ← Back
          </Button>
          <Button
            variant="primary"
            onClick={() => { void runCategorization(); }}
            disabled={isProcessing || photoCount === 0}
            loading={isProcessing}
          >
            Run AI Categorization
          </Button>
        </div>
      </div>
    );
  }

  // Processing state
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

  // Approved state - can proceed (or edit individual assignments)
  if (state.status === 'approved') {
    // Count photos per step - use approvals map for current session overrides
    // EXCLUDE rejected photos (approved === false) from counts
    const stepCounts = new Map<number, number>();
    state.results.forEach((result) => {
      const approval = approvals.get(result.photo_filename);
      // Skip explicitly rejected photos
      if (approval?.approved === false) return;
      const step = approval?.overrideStep ?? result.human_override_step ?? result.vlm_predicted_step;
      if (step >= 1 && step <= 12) {
        stepCounts.set(step, (stepCounts.get(step) || 0) + 1);
      }
    });

    // Find missing steps (1-10)
    const missingSteps: number[] = [];
    for (let i = 1; i <= 10; i++) {
      if (!stepCounts.has(i) || stepCounts.get(i) === 0) {
        missingSteps.push(i);
      }
    }

    // If in edit mode, show the editing UI
    if (isEditing) {
      // Separate active photos (steps 1-10) from discarded photos (step 0)
      const getEffectiveStep = (result: VlmCategorizationResult) => {
        const approval = approvals.get(result.photo_filename);
        return approval?.overrideStep ?? result.human_override_step ?? result.vlm_predicted_step;
      };

      const activePhotos = state.results.filter((r) => getEffectiveStep(r) >= 1 && getEffectiveStep(r) <= 10);
      const discardedPhotos = state.results.filter((r) => getEffectiveStep(r) === 0 || getEffectiveStep(r) > 10);

      const renderPhotoCard = (result: VlmCategorizationResult, isDiscarded: boolean = false) => {
        const approval = approvals.get(result.photo_filename);
        const currentStep = approval?.overrideStep ?? result.human_override_step ?? result.vlm_predicted_step;
        const photoUrl = `/api/activate/photo/${dropNumber}/${result.photo_filename}`;

        return (
          <div
            key={result.photo_filename}
            className={`border rounded-lg p-3 ${
              isDiscarded
                ? 'border-border bg-background/50 opacity-75 hover:opacity-100'
                : 'border-border bg-card'
            }`}
          >
            <div className="flex gap-3">
              {/* Thumbnail */}
              <button
                type="button"
                onClick={() => openLightbox(result.photo_filename)}
                className="flex-shrink-0 relative group"
              >
                <img
                  src={photoUrl}
                  alt={result.photo_filename}
                  className={`w-20 h-20 object-cover rounded border ${
                    isDiscarded ? 'border-border grayscale-[30%]' : 'border-gray-200 dark:border-gray-600'
                  }`}
                />
                <span className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity rounded">
                  <span className="text-white text-xs">View</span>
                </span>
              </button>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`font-medium text-sm ${isDiscarded ? 'text-muted-foreground' : 'text-foreground'}`}>
                    {isDiscarded ? '❌ Discarded' : `Step ${currentStep}: ${STEP_LABELS[currentStep] || 'Unknown'}`}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground line-clamp-2 mb-2">
                  {result.vlm_identified_as}
                </p>

                {/* Step selector */}
                <select
                  value={currentStep}
                  onChange={(e) => {
                    const newStep = parseInt(e.target.value);
                    setPhotoApproval(result.photo_filename, true, newStep);
                  }}
                  className={`text-sm border rounded px-2 py-1 w-full ${
                    isDiscarded
                      ? 'border-orange-400 dark:border-orange-600 bg-orange-50 dark:bg-orange-900/20'
                      : 'border-border bg-card'
                  }`}
                >
                  <option value="0">❌ Discard (Step 0)</option>
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((step) => (
                    <option key={step} value={step}>
                      Step {step}: {STEP_LABELS[step]}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        );
      };

      return (
        <div className="space-y-4">
          {/* Photo lightbox with zoom/pan/navigation */}
          {lightboxIndex !== null && (
            <PhotoLightbox
              photos={lightboxPhotos}
              initialIndex={lightboxIndex}
              onClose={() => setLightboxIndex(null)}
            />
          )}

          {/* Edit mode header */}
          <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-lg p-4">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="font-semibold text-blue-800 dark:text-blue-200">
                  ✏️ Edit Step Assignments
                </h4>
                <p className="text-blue-600 dark:text-blue-400 text-sm">
                  Change individual photo step assignments below. Click Save when done.
                </p>
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setIsEditing(false)}
              >
                Cancel
              </Button>
            </div>
          </div>

          {error && (
            <div className="p-3 bg-red-50 dark:bg-red-900/20 rounded-lg">
              <p className="text-red-600 dark:text-red-400">{error}</p>
            </div>
          )}

          {/* Active photos grid */}
          <div>
            <h5 className="text-sm font-medium text-muted-foreground mb-2">
              📷 Active Photos ({activePhotos.length})
            </h5>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[300px] overflow-y-auto pr-2">
              {[...activePhotos]
                .sort((a, b) => getEffectiveStep(a) - getEffectiveStep(b))
                .map((result) => renderPhotoCard(result, false))}
            </div>
          </div>

          {/* Discarded photos section */}
          {discardedPhotos.length > 0 && (
            <div className="border-t border-border pt-4">
              <h5 className="text-sm font-medium text-muted-foreground mb-2 flex items-center gap-2">
                <span>🗑️ Discarded Photos ({discardedPhotos.length})</span>
                <span className="text-xs font-normal text-gray-400 dark:text-muted-foreground">
                  — reassign to a step to include in review
                </span>
              </h5>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[200px] overflow-y-auto pr-2">
                {discardedPhotos.map((result) => renderPhotoCard(result, true))}
              </div>
            </div>
          )}

          {/* Navigation */}
          <div className="flex justify-between pt-4 border-t border-border">
            <Button
              variant="ghost"
              onClick={() => setIsEditing(false)}
            >
              ← Cancel
            </Button>
            <Button
              variant="primary"
              onClick={async () => {
                await submitApprovals();
                setIsEditing(false);
              }}
              disabled={isProcessing}
              loading={isProcessing}
            >
              Save Changes
            </Button>
          </div>
        </div>
      );
    }

    // Normal approved view (not editing)
    return (
      <div className="space-y-6">
        {/* Categorization Progress Overlay */}
        <WizardProgressOverlay
          isVisible={categorizationPhase !== null}
          operationType="categorization"
          phase={categorizationPhase || 'analyzing'}
          dropNumber={dropNumber}
          photoCount={photoCount}
        />

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
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setIsEditing(true)}
              >
                ✏️ Edit
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => { void runCategorization(); }}
                disabled={isProcessing}
                loading={isProcessing}
              >
                Re-categorize
              </Button>
            </div>
          </div>
        </div>

        {/* Step coverage summary */}
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
          {Array.from({ length: 12 }, (_, i) => i + 1).map((step) => {
            const count = stepCounts.get(step) || 0;
            const isMissing = count === 0;

            return (
              <div
                key={step}
                className={`p-3 rounded-lg text-center border relative ${
                  isMissing
                    ? 'border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/20'
                    : 'border-border bg-background/50'
                }`}
              >
                {/* Warning icon for missing steps */}
                {isMissing && (
                  <span
                    className="absolute -top-1.5 -right-1.5 text-amber-500 text-sm"
                    title={`No photos for Step ${step}`}
                  >
                    ⚠️
                  </span>
                )}
                <div className={`text-xl font-bold ${isMissing ? 'text-red-600 dark:text-red-400' : 'text-foreground'}`}>
                  {count}
                </div>
                <div className="text-xs font-medium text-muted-foreground dark:text-gray-400">
                  Step {step}
                </div>
                <div className="text-xs text-muted-foreground truncate">
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
        <div className="flex justify-between pt-4 border-t border-border">
          <Button
            variant="ghost"
            onClick={onBack}
          >
            ← Back
          </Button>
          <div className="flex gap-2">
            {onSkipToDecision && (
              <Button
                variant="secondary"
                onClick={onSkipToDecision}
                title="Skip data validation and go directly to final decision"
              >
                Skip to Decision ⏭️
              </Button>
            )}
            <Button
              variant="primary"
              onClick={handleProceed}
            >
              Continue to Data Validation →
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Categorized state - awaiting review/approval
  return (
    <div className="space-y-4">
      {/* Categorization Progress Overlay */}
      <WizardProgressOverlay
        isVisible={categorizationPhase !== null}
        operationType="categorization"
        phase={categorizationPhase || 'analyzing'}
        dropNumber={dropNumber}
        photoCount={photoCount}
      />

      {/* Photo lightbox with zoom/pan/navigation */}
      {lightboxIndex !== null && (
        <PhotoLightbox
          photos={lightboxPhotos}
          initialIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />
      )}

      {/* Header with auto-approval summary */}
      <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h4 className="font-semibold text-blue-800 dark:text-blue-200">
              AI Categorization Review
            </h4>
            <p className="text-blue-600 dark:text-blue-400 text-sm">
              {state.autoApprovalSummary
                ? `${state.autoApprovalSummary.autoApproved} auto-approved, ${state.autoApprovalSummary.reviewRecommended + state.autoApprovalSummary.humanRequired} need review`
                : 'Review each photo\u2019s category. Approve or override as needed.'}
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => { void runCategorization(); }}
              disabled={isProcessing}
            >
              Re-run
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => { void approveAll(); }}
              disabled={isProcessing}
              loading={isProcessing}
            >
              Approve All
            </Button>
          </div>
        </div>

        {/* Tier breakdown badges */}
        {state.autoApprovalSummary && (
          <div className="flex gap-2 flex-wrap">
            {state.autoApprovalSummary.autoApproved > 0 && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300">
                {state.autoApprovalSummary.autoApproved} auto-approved
              </span>
            )}
            {state.autoApprovalSummary.reviewRecommended > 0 && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-300">
                {state.autoApprovalSummary.reviewRecommended} review recommended
              </span>
            )}
            {state.autoApprovalSummary.humanRequired > 0 && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300">
                {state.autoApprovalSummary.humanRequired} needs attention
              </span>
            )}
            {state.autoApprovalSummary.overallAccuracy !== null && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300">
                AI accuracy: {Math.round(state.autoApprovalSummary.overallAccuracy * 100)}%
              </span>
            )}
          </div>
        )}
      </div>

      {error && (
        <div className="p-3 bg-red-50 dark:bg-red-900/20 rounded-lg">
          <p className="text-red-600 dark:text-red-400">{error}</p>
        </div>
      )}

      {/* Photo grid - sorted by tier (human_required first, then review, then auto) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[400px] overflow-y-auto pr-2">
        {[...state.results]
          .sort((a, b) => {
            const tierOrder: Record<AutoApprovalTier, number> = { human_required: 0, review_recommended: 1, auto_approved: 2 };
            const tierA = tierOrder[getTier(a.photo_filename)] ?? 1;
            const tierB = tierOrder[getTier(b.photo_filename)] ?? 1;
            if (tierA !== tierB) return tierA - tierB;
            return a.vlm_predicted_step - b.vlm_predicted_step;
          })
          .map((result) => {
          const approval = approvals.get(result.photo_filename);
          const isApproved = approval?.approved !== false;
          const overrideStep = approval?.overrideStep;
          const rejectionReason = approval?.rejectionReason;
          const photoUrl = `/api/activate/photo/${dropNumber}/${result.photo_filename}`;
          const tier = getTier(result.photo_filename);

          // Tier-based border/background styles
          const tierStyles: Record<AutoApprovalTier, string> = {
            auto_approved: 'border-green-300 dark:border-green-700 bg-green-50/50 dark:bg-green-900/10',
            review_recommended: 'border-yellow-300 dark:border-yellow-700 bg-yellow-50/50 dark:bg-yellow-900/10',
            human_required: 'border-red-300 dark:border-red-700 bg-red-50/50 dark:bg-red-900/10',
          };

          return (
            <div
              key={result.photo_filename}
              className={`border rounded-lg p-3 ${
                !isApproved
                  ? 'border-red-400 dark:border-red-600 bg-red-50 dark:bg-red-900/20'
                  : tierStyles[tier] || 'border-border bg-card'
              }`}
            >
              <div className="flex gap-3">
                {/* Thumbnail */}
                <button
                  type="button"
                  onClick={() => openLightbox(result.photo_filename)}
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
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="font-medium text-foreground text-sm">
                      Step {result.vlm_predicted_step}: {STEP_LABELS[result.vlm_predicted_step]}
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded text-xs font-medium ${getConfidenceBg(result.vlm_confidence)} ${getConfidenceColor(result.vlm_confidence)}`}
                    >
                      {Math.round(result.vlm_confidence * 100)}%
                    </span>
                    {tier === 'auto_approved' && (
                      <span className="px-1.5 py-0.5 rounded text-xs font-medium bg-green-200 dark:bg-green-800 text-green-800 dark:text-green-200">
                        AI
                      </span>
                    )}
                    {tier === 'human_required' && (
                      <span className="px-1.5 py-0.5 rounded text-xs font-medium bg-red-200 dark:bg-red-800 text-red-800 dark:text-red-200">
                        Review
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground line-clamp-2">
                    {result.vlm_identified_as}
                  </p>

                  {/* Approval controls */}
                  <div className="mt-2 space-y-2">
                    <div className="flex items-center gap-3">
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={isApproved}
                          onChange={(e) => {
                            const newApproved = e.target.checked;
                            // Clear rejection reason when approving
                            setPhotoApproval(result.photo_filename, newApproved, overrideStep, newApproved ? undefined : rejectionReason);
                          }}
                          className="w-4 h-4 text-green-600 rounded focus:ring-green-500"
                        />
                        <span className="text-xs text-muted-foreground">Approve</span>
                      </label>

                      {/* Step override dropdown - only show when approved */}
                      {isApproved && (
                        <select
                          value={overrideStep ?? ''}
                          onChange={(e) => {
                            const newStep = e.target.value ? parseInt(e.target.value) : undefined;
                            setPhotoApproval(result.photo_filename, isApproved, newStep, rejectionReason);
                          }}
                          className="text-xs border border-border rounded px-1.5 py-0.5 bg-card"
                          title="Override step assignment"
                        >
                          <option value="">Step {result.vlm_predicted_step} (AI)</option>
                          <option value="0">❌ Discard</option>
                          {Array.from({ length: 12 }, (_, i) => i + 1)
                            .filter((step) => step !== result.vlm_predicted_step)
                            .map((step) => (
                              <option key={step} value={step}>
                                → {step}: {STEP_LABELS[step]}
                              </option>
                            ))}
                        </select>
                      )}
                    </div>

                    {/* Rejection reason dropdown - show when NOT approved */}
                    {!isApproved && (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-red-600 dark:text-red-400">❌ Rejected:</span>
                        <select
                          value={rejectionReason ?? ''}
                          onChange={(e) => {
                            setPhotoApproval(result.photo_filename, false, overrideStep, e.target.value || undefined);
                          }}
                          className="text-xs border border-red-300 dark:border-red-600 rounded px-1.5 py-0.5 bg-red-50 dark:bg-red-900/30 flex-1"
                          title="Select rejection reason"
                        >
                          <option value="">Select reason...</option>
                          {PHOTO_REJECTION_REASONS.map((reason) => (
                            <option key={reason.code} value={reason.code}>
                              {reason.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Navigation */}
      <div className="flex justify-between pt-4 border-t border-border">
        <Button
          variant="ghost"
          onClick={onBack}
        >
          ← Back
        </Button>
        <Button
          variant="primary"
          onClick={() => { void submitApprovals(); }}
          disabled={isProcessing}
          loading={isProcessing}
        >
          {state.autoApprovalSummary ? 'Confirm & Continue →' : 'Save & Continue →'}
        </Button>
      </div>
    </div>
  );
}
