/**
 * Auto-QA Feedback Phase
 *
 * HITL stopping point for auto-QA'd DRs. Shows AI decisions
 * with editable overrides before sending WhatsApp feedback.
 *
 * Features:
 * - Click-to-enlarge photo lightbox
 * - Step reassignment dropdown (HITL learning)
 * - Pass/Fail toggle per photo
 * - Editable comments
 * - Auto-regenerating WhatsApp feedback message
 */

import { useState, useCallback, useMemo } from 'react';
import { log } from '@/lib/logger';
import { STEP_LABELS } from '../../utils/stepMapper';
import type { AutoQaResults, AutoQaPhotoResult } from '../../services/autoQaCommentGenerator';
import { generateFeedbackMessage, generatePhotoComment } from '../../services/autoQaCommentGenerator';
import type { QaDecision } from '../../types/unified.types';
import { PhotoCard, type EditablePhoto } from './PhotoCard';
import { PhotoLightbox, type LightboxPhoto } from '@/components/PhotoLightbox';

interface AutoQaFeedbackPhaseProps {
  dropNumber: string;
  project?: string;
  autoQaResults: AutoQaResults;
  onComplete: () => void;
  onBack: () => void;
}

export function AutoQaFeedbackPhase({
  dropNumber,
  project,
  autoQaResults,
  onComplete,
  onBack,
}: AutoQaFeedbackPhaseProps) {
  const [photos, setPhotos] = useState<EditablePhoto[]>(() =>
    autoQaResults.photos
      .filter((p) => !p.filename.startsWith('missing_step_'))
      .map((p) => ({ ...p, edited: false, originalStep: p.step }))
  );
  const [missingSteps, setMissingSteps] = useState<AutoQaPhotoResult[]>(() =>
    autoQaResults.photos.filter((p) => p.filename.startsWith('missing_step_'))
  );
  // If feedbackMessage was cleared (HITL overrides applied on load), auto-generate
  const hasOverrides = autoQaResults.photos.some((p: AutoQaPhotoResult & { edited?: boolean }) => p.edited);
  const [feedbackMessage, setFeedbackMessage] = useState(() => {
    if (!autoQaResults.feedbackMessage || hasOverrides) {
      // Regenerate from current (possibly overridden) photo data
      const allPhotos = autoQaResults.photos;
      return generateFeedbackMessage(
        dropNumber,
        autoQaResults.summary.decision,
        allPhotos,
        autoQaResults.validations
      );
    }
    return autoQaResults.feedbackMessage;
  });
  const [decision, setDecision] = useState<QaDecision>(autoQaResults.summary.decision);
  const [sendDestination, setSendDestination] = useState<'private' | 'group' | 'both'>('both');
  const [isSending, setIsSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedbackStale, setFeedbackStale] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  const passedCount = photos.filter((p) => p.decision === 'PASS').length;
  const failedCount = photos.filter((p) => p.decision === 'FAIL').length + missingSteps.length;

  // Build lightbox photos array for the viewer
  const lightboxPhotos: LightboxPhoto[] = useMemo(() =>
    photos.map((p) => ({
      url: `/api/activate/photo/${dropNumber}/${p.filename}`,
      label: p.filename,
      metadata: `${STEP_LABELS[p.step] || `Step ${p.step}`} | ${p.decision} | ${Math.round(p.confidence * 100)}% confidence`,
    })),
    [photos, dropNumber]
  );

  const togglePhotoDecision = useCallback((index: number) => {
    setPhotos((prev) => prev.map((p, i) => {
      if (i !== index) return p;
      return {
        ...p,
        decision: p.decision === 'PASS' ? 'FAIL' : 'PASS',
        edited: true,
      };
    }));
    setFeedbackStale(true);
  }, []);

  const updatePhotoComment = useCallback((index: number, comment: string) => {
    setPhotos((prev) => prev.map((p, i) => {
      if (i !== index) return p;
      return { ...p, comment, edited: true };
    }));
    setFeedbackStale(true);
  }, []);

  /**
   * Handle step reassignment from the dropdown.
   * Updates step, label, comment, and recalculates missing steps.
   * Records correction for HITL learning (fire-and-forget).
   */
  const changePhotoStep = useCallback((index: number, newStep: number) => {
    // Capture current photo state before setState for the HITL correction call
    const currentPhoto = photos[index];

    setPhotos((prev) => {
      const updated = prev.map((p, i) => {
        if (i !== index) return p;
        const isDuplicate = newStep === -1;
        const newLabel = STEP_LABELS[newStep] || `Step ${newStep}`;
        const newComment = generatePhotoComment(
          newStep, p.tier, p.confidence,
          isDuplicate ? 'FAIL' : p.decision, // Duplicates are always FAIL
          '' // No VLM reasoning for human override
        );
        return {
          ...p,
          step: newStep,
          stepLabel: newLabel,
          comment: newComment,
          decision: isDuplicate ? 'FAIL' as const : p.decision, // Auto-FAIL duplicates
          edited: true,
        };
      });

      // Recalculate missing steps based on current photo assignments
      // Duplicates (step -1) and discards (step 0) don't count as coverage
      const coveredSteps = new Set(updated.map((p) => p.step).filter((s) => s > 0));
      const newMissing: AutoQaPhotoResult[] = [];
      for (let s = 1; s <= 10; s++) {
        if (!coveredSteps.has(s)) {
          newMissing.push({
            filename: `missing_step_${s}`,
            step: s,
            stepLabel: STEP_LABELS[s] || `Step ${s}`,
            tier: 'human_required',
            decision: 'FAIL',
            comment: `${STEP_LABELS[s] || `Step ${s}`}: Photo missing - please upload this step`,
            confidence: 0,
          });
        }
      }
      setMissingSteps(newMissing);

      return updated;
    });

    // Record HITL correction for VLM learning (fire-and-forget, outside setState)
    if (currentPhoto) {
      const originalStep = currentPhoto.originalStep ?? currentPhoto.step;
      if (originalStep !== newStep) {
        const isDuplicate = newStep === -1;
        fetch('/api/activate/record-correction', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            photoFilename: currentPhoto.filename,
            dropNumber,
            vlmPredictedStep: originalStep,
            vlmPredictedCategory: STEP_LABELS[originalStep] || `Step ${originalStep}`,
            vlmConfidence: currentPhoto.confidence,
            correctStep: isDuplicate ? 0 : newStep, // Store duplicates as step 0 in corrections table
            correctCategory: isDuplicate ? 'Duplicate Photo' : (STEP_LABELS[newStep] || `Step ${newStep}`),
            correctionReason: isDuplicate ? 'Photo is a duplicate of another photo in this DR' : undefined,
          }),
        }).catch((err) => {
          log.warn('Failed to record HITL correction', { error: err }, 'AutoQaFeedback');
        });

        // Persist step override to vlm_categorization_results + photos_metadata (fire-and-forget)
        fetch('/api/activate/update-photo-step', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            dropNumber,
            photoFilename: currentPhoto.filename,
            newStep: isDuplicate ? 0 : newStep,
            reason: isDuplicate ? 'Duplicate photo' : 'HITL step correction',
          }),
        }).catch((err) => {
          log.warn('Failed to persist photo step override', { error: err }, 'AutoQaFeedback');
        });
      }
    }

    setFeedbackStale(true);
  }, [dropNumber, photos]);

  const regenerateFeedback = useCallback(() => {
    const allPhotos: AutoQaPhotoResult[] = [
      ...photos.map((p) => ({
        filename: p.filename,
        step: p.step,
        stepLabel: p.stepLabel,
        tier: p.tier,
        decision: p.decision,
        comment: p.comment,
        confidence: p.confidence,
      })),
      ...missingSteps,
    ];
    const newMessage = generateFeedbackMessage(
      dropNumber,
      decision,
      allPhotos,
      autoQaResults.validations
    );
    setFeedbackMessage(newMessage);
    setFeedbackStale(false);
  }, [photos, missingSteps, dropNumber, decision, autoQaResults.validations]);

  const handleSendFeedback = async () => {
    // Auto-regenerate if stale to ensure message matches current state
    if (feedbackStale) {
      regenerateFeedback();
    }

    setIsSending(true);
    setError(null);
    try {
      // Collect edits to persist alongside feedback
      const editedPhotos = photos
        .filter((p) => p.edited)
        .map((p) => ({
          filename: p.filename,
          originalStep: p.originalStep ?? p.step,
          newStep: p.step,
          decision: p.decision,
          comment: p.comment,
        }));

      const response = await fetch('/api/activate/send-feedback', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dropNumber,
          project,
          decision,
          message: feedbackStale ? generateFeedbackMessage(
            dropNumber, decision,
            [...photos.map((p) => ({
              filename: p.filename, step: p.step, stepLabel: p.stepLabel,
              tier: p.tier, decision: p.decision, comment: p.comment, confidence: p.confidence,
            })), ...missingSteps],
            autoQaResults.validations
          ) : feedbackMessage,
          destination: sendDestination,
          qaFindings: {
            photoCoverage: {
              covered: 10 - missingSteps.length,
              total: 10,
              missing: missingSteps.map((s) => s.step),
            },
            powerMeter: autoQaResults.validations.powerMeter,
            serialValidation: autoQaResults.validations.serialValidation,
            reasons: autoQaResults.validations.autoFail.reasons,
          },
          humanEdits: editedPhotos.length > 0 ? editedPhotos : undefined,
        }),
      });

      const data = await response.json();
      if (data.success) {
        setSent(true);
      } else {
        const errMsg = typeof data.error === 'string' ? data.error : data.error?.message || 'Failed to send';
        throw new Error(errMsg);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to send feedback';
      setError(msg);
      log.error(`AutoQaFeedback: ${msg}`, undefined, 'AutoQaFeedback');
    } finally {
      setIsSending(false);
    }
  };

  const handleRejectAutoQa = async () => {
    try {
      await fetch(`/api/activate/auto-qa-reset?dropNumber=${encodeURIComponent(dropNumber)}`, {
        method: 'POST',
        credentials: 'include',
      });
      onBack();
    } catch (err) {
      log.error('Failed to reset auto-QA', { error: err }, 'AutoQaFeedback');
    }
  };

  if (sent) {
    return (
      <div className="text-center py-8 space-y-6">
        <div className="text-6xl mb-4">{decision === 'PASS' ? '✅' : decision === 'FAIL' ? '❌' : '⚠️'}</div>
        <h3 className="text-2xl font-bold text-foreground">Review Complete</h3>
        <p className="text-muted-foreground">{dropNumber} feedback sent to technicians.</p>
        <button onClick={onComplete} className="px-8 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium">
          Finish Review
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Photo Lightbox */}
      {lightboxIndex !== null && (
        <PhotoLightbox
          photos={lightboxPhotos}
          initialIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />
      )}

      {/* Auto-QA Banner */}
      <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🤖</span>
          <div>
            <h3 className="font-semibold text-blue-800 dark:text-blue-200">
              Auto-QA Review — Human Approval Required
            </h3>
            <p className="text-sm text-blue-600 dark:text-blue-400">
              AI processed {photos.length} photos: {passedCount} passed, {failedCount} failed.
              Review decisions below before sending feedback.
            </p>
          </div>
        </div>
      </div>

      {/* Decision Override */}
      <div className="bg-card rounded-lg border border-border p-4">
        <h4 className="font-semibold text-foreground mb-3">Overall Decision</h4>
        <div className="flex gap-3">
          {(['PASS', 'FAIL', 'REWORK_NEEDED'] as QaDecision[]).map((d) => (
            <button
              key={d}
              onClick={() => { setDecision(d); setFeedbackStale(true); }}
              className={`px-4 py-2 rounded-lg border text-sm font-medium transition-colors ${
                decision === d
                  ? d === 'PASS'
                    ? 'bg-green-600 text-white border-green-600'
                    : d === 'FAIL'
                    ? 'bg-red-600 text-white border-red-600'
                    : 'bg-yellow-600 text-white border-yellow-600'
                  : 'border-border text-muted-foreground hover:bg-accent'
              }`}
            >
              {d === 'PASS' ? '✅ PASS' : d === 'FAIL' ? '❌ FAIL' : '⚠️ REWORK'}
            </button>
          ))}
        </div>
      </div>

      {/* Validation Summary */}
      <div className="bg-card rounded-lg border border-border p-4">
        <h4 className="font-semibold text-foreground mb-3">Validation Summary</h4>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <SummaryCard
            label="Prerequisites"
            icon={autoQaResults.validations.prerequisites.passed ? '✅' : '❌'}
            detail={`${autoQaResults.validations.prerequisites.details.photoCount} photos`}
          />
          <SummaryCard
            label="Coverage"
            icon={missingSteps.length === 0 ? '✅' : '⚠️'}
            detail={`${10 - missingSteps.length}/10`}
          />
          <SummaryCard
            label="Power"
            icon={autoQaResults.validations.powerMeter.inRange ? '✅' : autoQaResults.validations.powerMeter.value === null ? '⏳' : '❌'}
            detail={autoQaResults.validations.powerMeter.value !== null ? `${autoQaResults.validations.powerMeter.value} dBm` : 'N/A'}
          />
          <SummaryCard
            label="Serials"
            icon={autoQaResults.validations.serialValidation.ontMatch ? '✅' : '❌'}
            detail={autoQaResults.validations.serialValidation.status}
          />
        </div>
      </div>

      {/* Missing Steps — dynamically recalculated */}
      {missingSteps.length > 0 && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <h4 className="font-semibold text-red-700 dark:text-red-300 mb-2">Missing Steps</h4>
          <div className="space-y-1">
            {missingSteps.map((s) => (
              <div key={s.step} className="text-sm text-red-600 dark:text-red-400">
                ❌ {STEP_LABELS[s.step] || `Step ${s.step}`} — photo not submitted
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Photo Cards */}
      <div className="space-y-4">
        <h4 className="font-semibold text-foreground">
          Photo Decisions ({photos.length})
          <span className="text-xs font-normal text-muted-foreground ml-2">
            Click photo to enlarge · Use dropdown to reassign step
          </span>
        </h4>
        {photos.map((photo, idx) => (
          <PhotoCard
            key={photo.filename}
            photo={photo}
            dropNumber={dropNumber}
            onToggleDecision={() => togglePhotoDecision(idx)}
            onUpdateComment={(c) => updatePhotoComment(idx, c)}
            onChangeStep={(newStep) => changePhotoStep(idx, newStep)}
            onClickPhoto={() => setLightboxIndex(idx)}
          />
        ))}
      </div>

      {/* Feedback Message */}
      <div className="bg-card rounded-lg border border-border p-4">
        <div className="flex items-center justify-between mb-3">
          <h4 className="font-semibold text-foreground flex items-center gap-2">
            <span className="text-green-500">💬</span> WhatsApp Feedback
          </h4>
          {feedbackStale && (
            <button
              onClick={regenerateFeedback}
              className="px-3 py-1 text-xs font-medium bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors"
            >
              Regenerate Message
            </button>
          )}
        </div>
        {feedbackStale && (
          <p className="text-xs text-amber-500 mb-2">
            Decisions changed — click Regenerate or edit manually below.
          </p>
        )}
        <textarea
          value={feedbackMessage}
          onChange={(e) => setFeedbackMessage(e.target.value)}
          rows={10}
          className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg dark:bg-gray-900 font-mono text-sm resize-none"
        />
      </div>

      {/* Send Destination */}
      <div className="bg-card rounded-lg border border-border p-4">
        <h4 className="font-semibold text-foreground mb-3">Send To</h4>
        <div className="flex gap-3">
          {([
            { value: 'private' as const, label: '👤 Private (Tech only)' },
            { value: 'group' as const, label: '👥 Group Chat' },
            { value: 'both' as const, label: '📤 Both' },
          ]).map(({ value, label }) => (
            <button
              key={value}
              onClick={() => setSendDestination(value)}
              className={`px-4 py-2 rounded-lg border text-sm font-medium transition-colors ${
                sendDestination === value
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'border-border text-muted-foreground hover:bg-accent'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <p className="text-red-600 dark:text-red-400">{error}</p>
        </div>
      )}

      {/* Actions */}
      <div className="flex justify-between pt-4 border-t border-border">
        <button
          onClick={handleRejectAutoQa}
          className="px-4 py-2 text-red-600 hover:text-red-700 border border-red-300 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20"
        >
          Reject Auto-QA (Manual Review)
        </button>
        <button
          onClick={handleSendFeedback}
          disabled={isSending || !feedbackMessage.trim()}
          className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
        >
          {isSending ? (
            <>
              <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
              Sending...
            </>
          ) : (
            <>Send Feedback</>
          )}
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

function SummaryCard({ label, icon, detail }: { label: string; icon: string; detail: string }) {
  return (
    <div className="p-3 bg-background/50 rounded-lg text-center">
      <div className="text-xl mb-1">{icon}</div>
      <div className="text-sm font-medium text-foreground">{label}</div>
      <div className="text-xs text-muted-foreground">{detail}</div>
    </div>
  );
}
