/**
 * usePhotoGallerySave — persists gallery good/bad decisions to the VLM pipeline.
 *
 * Extracted from PhotoGalleryPage so the orchestrator stays under the 200-line
 * component limit. Owns the save request lifecycle and derives which decisions
 * are still unsaved from the current photos/decisions, keyed by the shared
 * `photoKey` so the "saved" set never drifts from the decision map.
 */

import { useCallback, useMemo, useState } from 'react';
import { log } from '@/lib/logger';
import { GalleryPhoto, PhotoDecision, STEP_LABELS, photoKey } from './types';

export interface SaveDecisionPayload {
  drNumber: string;
  filename: string;
  url: string;
  stepNumber: number;
  decision: 'good' | 'bad';
  confidence: number;
}

interface SaveResponse {
  success: boolean;
  data?: { saved: number; skipped: number; good: number; bad: number };
  error?: { message?: string };
}

interface UsePhotoGallerySaveArgs {
  photos: GalleryPhoto[];
  decisions: Record<string, PhotoDecision>;
  activeStep: number;
}

export function usePhotoGallerySave({ photos, decisions, activeStep }: UsePhotoGallerySaveArgs) {
  const [saving, setSaving] = useState(false);
  const [savedPhotoIds, setSavedPhotoIds] = useState<Set<string>>(new Set());
  const [saveResult, setSaveResult] = useState<{ saved: number; good: number; bad: number } | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Decisions that have been made for the current step but not yet persisted.
  // A photo is skipped when: no decision, already saved this session, or the
  // decision matches the pre-existing DB value (saved in a prior session).
  const pending = useMemo<SaveDecisionPayload[]>(
    () =>
      photos
        .filter((p) => {
          const key = photoKey(p);
          const decision = decisions[key];
          if (decision == null) return false;
          if (savedPhotoIds.has(key)) return false;
          // Already curated in a prior session and user hasn't changed the value.
          if (p.existingDecision === decision) return false;
          return true;
        })
        .map((p) => ({
          drNumber: p.drNumber,
          filename: p.filename,
          url: p.url,
          stepNumber: activeStep,
          decision: decisions[photoKey(p)] as 'good' | 'bad',
          confidence: p.confidence,
        })),
    [photos, decisions, savedPhotoIds, activeStep],
  );

  const save = useCallback(async () => {
    if (pending.length === 0) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch('/api/activate/photo-gallery/save-decisions', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decisions: pending }),
      });

      if (!res.ok) {
        log.error(
          'save-decisions returned non-ok status',
          { status: res.status },
          'PhotoGalleryPage',
        );
        setSaveError('Save failed — please try again.');
        return;
      }

      const data = (await res.json()) as SaveResponse;
      if (data.success && data.data) {
        const { saved, good, bad } = data.data;
        setSavedPhotoIds((prev) => {
          const next = new Set(prev);
          pending.forEach((d) => next.add(`${d.drNumber}__${d.filename}`));
          return next;
        });
        setSaveResult({ saved, good, bad });
        setTimeout(() => setSaveResult(null), 5000);
      } else {
        setSaveError(data.error?.message ?? 'Save failed — please try again.');
      }
    } catch (err) {
      log.error(
        'Failed to save gallery decisions',
        { error: err instanceof Error ? err.message : String(err) },
        'PhotoGalleryPage',
      );
      setSaveError('Could not save. Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  }, [pending]);

  return {
    saving,
    saveResult,
    saveError,
    unsavedCount: pending.length,
    stepLabel: STEP_LABELS[activeStep] ?? `Step ${activeStep}`,
    save,
  };
}
