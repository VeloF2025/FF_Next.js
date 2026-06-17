import { useState, useCallback, useEffect, useRef } from 'react';
import { log } from '@/lib/logger';
import type { SiteCamStep, SiteCamJobType } from '../lib/sitecamSteps';
import { readDeviceLocation, type GeofenceReading, type GeofencePayload } from '../lib/geofence';
import { prepareCapturePhotos } from '../lib/watermarkPhoto';
import { loadDraft, saveDraft, clearDraft, type SiteCamDraft } from '../lib/sitecamDraft';

const MODULE = 'useSiteCamCapture';

/** Poll cadence for an appeal awaiting a supervisor decision. */
const APPEAL_POLL_MS = 8000;

export type StepStatus =
  | 'pending'
  | 'validating'
  | 'pass'
  | 'fail'
  | 'escalated'
  | 'serial_scan'     // photo passed, waiting for barcode scan
  | 'serial_pending'; // barcode scanned + format valid, saved as pending (cross-ref async)

export interface StepState {
  stepNumber: number;
  label: string;
  hasVlm: boolean;
  hasSerialScan: boolean;
  serialLabel: string;
  serialDevice: 'ont' | 'ups' | null;
  serialAttempts: number;
  serialScanned: string | null;
  status: StepStatus;
  photoBase64: string | null;
  attemptNumber: number;
  failReasons: string[];
  corrections: string[];
  /**
   * True when the photo auto-passed only because the VLM was unavailable
   * (server or client fail-open). Such photos are uploaded but flagged for
   * manual QA review rather than treated as verified passes.
   */
  needsManualReview: boolean;
}

export interface SiteInfo {
  jobType: SiteCamJobType;
  siteId: string;
  customerName: string | null;
  address: string | null;
  projectName: string | null;
  plannedLat: number | null;
  plannedLon: number | null;
  pon: number | null;
  zone: number | null;
}

function initStepStates(
  steps: readonly SiteCamStep[],
): StepState[] {
  return steps.map((s) => ({
    stepNumber: s.number,
    label: s.label,
    hasVlm: s.hasVlm,
    hasSerialScan: s.hasSerialScan,
    serialLabel: s.serialLabel ?? '',
    serialDevice: s.serialDevice ?? null,
    serialAttempts: 0,
    serialScanned: null,
    status: 'pending',
    photoBase64: null,
    attemptNumber: 0,
    failReasons: [],
    corrections: [],
    needsManualReview: false,
  }));
}

export function useSiteCamCapture(
  steps: readonly SiteCamStep[],
  siteInfo: SiteInfo,
  entryGeofence: GeofenceReading | null = null,
) {
  // Read any saved draft ONCE (cached in a ref) so the three state initialisers
  // below don't each hit localStorage. The wizard mounts client-side only, so
  // restoring in the lazy initialiser causes no SSR hydration mismatch.
  const draftRef = useRef<SiteCamDraft | null | undefined>(undefined);
  const initialDraft = (): SiteCamDraft | null => {
    if (draftRef.current === undefined) draftRef.current = loadDraft(siteInfo.siteId, steps);
    return draftRef.current;
  };

  const [stepStates, setStepStates] = useState<StepState[]>(
    () => initialDraft()?.stepStates ?? initStepStates(steps),
  );
  const [currentStepIndex, setCurrentStepIndex] = useState(
    () => initialDraft()?.currentStepIndex ?? 0,
  );
  // Index of a step whose appeal is awaiting a supervisor decision, if any.
  const [appealedIndex, setAppealedIndex] = useState<number | null>(
    () => initialDraft()?.appealedIndex ?? null,
  );
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadResult, setUploadResult] = useState<{ uploadedCount: number } | null>(null);

  // Mirror progress into localStorage so a refresh / PWA reload restores it.
  useEffect(() => {
    saveDraft(siteInfo.siteId, stepStates, currentStepIndex, appealedIndex);
  }, [siteInfo.siteId, stepStates, currentStepIndex, appealedIndex]);

  // Once the job is submitted there is nothing left to resume — drop the draft.
  useEffect(() => {
    if (uploadResult) clearDraft(siteInfo.siteId);
  }, [uploadResult, siteInfo.siteId]);

  // Poll for a supervisor's appeal decision. An approved appeal marks the step
  // passed and advances (if it is still the current step); a denied appeal
  // returns the step to the failed state with the supervisor's reason. Without
  // this the wizard never learned the outcome and a refresh wiped progress.
  useEffect(() => {
    if (appealedIndex === null) return;
    const step = steps[appealedIndex];
    if (!step) return;

    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch(
          `/api/my/sitecam/appeal-status/${encodeURIComponent(siteInfo.siteId)}/${step.number}`,
          { credentials: 'include' },
        );
        if (!res.ok) return;
        const json = (await res.json()) as {
          data?: { status?: string; denialReason?: string | null };
        };
        if (cancelled) return;
        const status = json.data?.status;
        if (status === 'approved') {
          setStepStates((prev) =>
            prev.map((s, i) =>
              i === appealedIndex
                ? { ...s, status: 'pass', failReasons: [], corrections: [] }
                : s,
            ),
          );
          // Advance only if the technician is still sitting on the appealed step
          // (an escalated step has already auto-advanced past it).
          setCurrentStepIndex((i) =>
            i === appealedIndex ? Math.min(i + 1, steps.length - 1) : i,
          );
          setAppealedIndex(null);
        } else if (status === 'denied') {
          setStepStates((prev) =>
            prev.map((s, i) =>
              i === appealedIndex
                ? {
                    ...s,
                    status: 'fail',
                    failReasons: [json.data?.denialReason || 'Appeal denied by supervisor.'],
                  }
                : s,
            ),
          );
          setAppealedIndex(null);
        }
      } catch (err) {
        log.warn('Appeal status poll failed (will retry)', { err: String(err) }, MODULE);
      }
    };

    void poll();
    const id = setInterval(() => void poll(), APPEAL_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [appealedIndex, steps, siteInfo.siteId]);

  // Called when the technician submits an appeal for the current step — kicks
  // off the polling effect above.
  const onAppealSubmitted = useCallback(() => {
    setAppealedIndex(currentStepIndex);
  }, [currentStepIndex]);

  const advanceStep = useCallback(
    (delayMs: number) => {
      setTimeout(() => {
        setCurrentStepIndex((i) => Math.min(i + 1, steps.length - 1));
      }, delayMs);
    },
    [steps.length],
  );

  const escalateStep = useCallback(
    async (idx: number, photoBase64: string, failReasons: string[], attemptNumber?: number) => {
      const step = steps[idx];
      if (!step) return;

      try {
        await fetch('/api/sitecam/escalate', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jobType: siteInfo.jobType,
            siteId: siteInfo.siteId,
            stepNumber: step.number,
            failReasons,
            attemptPhotos: [],
            // Final failed photo — uploaded server-side to VF Storage so the
            // supervisor Failed tab shows exactly which photo failed.
            finalPhotoBase64: photoBase64,
            finalAttemptNumber: attemptNumber,
          }),
        });
      } catch (err) {
        log.warn('Escalate request failed (non-fatal)', { err: String(err) }, MODULE);
      }

      setStepStates((prev) =>
        prev.map((s, i) =>
          i === idx ? { ...s, status: 'escalated', photoBase64 } : s,
        ),
      );

      advanceStep(2000);
    },
    [steps, siteInfo, advanceStep],
  );

  const handleSerialSaved = useCallback(
    (idx: number, serial: string) => {
      setStepStates((prev) =>
        prev.map((s, i) => {
          if (i !== idx) return s;
          return {
            ...s,
            status: 'serial_pending',
            serialScanned: serial,
            serialAttempts: s.serialAttempts + 1,
          };
        }),
      );
      advanceStep(1500);
    },
    [advanceStep],
  );

  const captureAndValidate = useCallback(
    async (file: File): Promise<void> => {
      const idx = currentStepIndex;
      const step = steps[idx];
      if (!step) return;

      let clean: string;
      let watermarked: string;
      try {
        // Downscale once and produce two copies: a CLEAN image for the VLM (so
        // the banner is never burned into the pixels it grades for quality) and
        // a WATERMARKED image — site id + capture time in the pixels — for
        // storage/upload so the photo cannot be reused on another DR.
        ({ clean, watermarked } = await prepareCapturePhotos(file, siteInfo.siteId));
      } catch (err) {
        log.error('Failed to read file as base64', { err: String(err) }, MODULE);
        return;
      }

      // Capture the attempt number from the current snapshot before setState, then derive
      // the incremented value — avoids reading from a stale closure after the queued update.
      const prevAttempt = stepStates[idx]?.attemptNumber ?? 0;
      const currentAttempt = prevAttempt + 1;

      setStepStates((prev) =>
        prev.map((s, i) =>
          i === idx
            ? { ...s, photoBase64: watermarked, status: 'validating', attemptNumber: currentAttempt, failReasons: [], corrections: [] }
            : s,
        ),
      );

      if (!step.hasVlm) {
        if (step.hasSerialScan && siteInfo.jobType === 'activations') {
          setStepStates((prev) =>
            prev.map((s, i) =>
              i === idx ? { ...s, status: 'serial_scan', photoBase64: watermarked } : s,
            ),
          );
          return;
        }
        setStepStates((prev) =>
          prev.map((s, i) => (i === idx ? { ...s, status: 'pass' } : s)),
        );
        advanceStep(1500);
        return;
      }

      // VLM validation
      try {
        const res = await fetch('/api/sitecam/validate', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jobType: siteInfo.jobType,
            stepNumber: step.number,
            siteId: siteInfo.siteId,
            photoBase64: clean,
            attemptNumber: currentAttempt,
          }),
        });

        if (!res.ok) {
          // HTTP error — fail-open, but flag the photo for manual QA review.
          log.error('Validate returned non-OK status (fail-open)', { status: res.status }, MODULE);
          setStepStates((prev) =>
            prev.map((s, i) => (i === idx ? { ...s, status: 'pass', needsManualReview: true } : s)),
          );
          advanceStep(1500);
          return;
        }

        const json = (await res.json()) as {
          data: {
            pass: boolean;
            reasons: string[];
            corrections: string[];
            maxAttempts: number;
            needsManualReview?: boolean;
          };
        };

        const { pass, reasons, corrections, maxAttempts, needsManualReview } = json.data;

        if (pass) {
          const flagged = needsManualReview === true;
          if (step.hasSerialScan && siteInfo.jobType === 'activations') {
            setStepStates((prev) =>
              prev.map((s, i) =>
                i === idx
                  ? { ...s, status: 'serial_scan', needsManualReview: flagged }
                  : s,
              ),
            );
            return;
          }
          setStepStates((prev) =>
            prev.map((s, i) =>
              i === idx ? { ...s, status: 'pass', needsManualReview: flagged } : s,
            ),
          );
          advanceStep(1500);
          return;
        }

        // Fail path
        if (currentAttempt < maxAttempts) {
          setStepStates((prev) =>
            prev.map((s, i) =>
              i === idx
                ? { ...s, status: 'fail', failReasons: reasons, corrections }
                : s,
            ),
          );
        } else {
          // Exhausted attempts — escalate (store/upload the watermarked copy)
          await escalateStep(idx, watermarked, reasons, currentAttempt);
        }
      } catch (err) {
        // Network error — fail-open, but flag the photo for manual QA review.
        log.error('Validate network error (fail-open)', { err: String(err) }, MODULE);
        setStepStates((prev) =>
          prev.map((s, i) => (i === idx ? { ...s, status: 'pass', needsManualReview: true } : s)),
        );
        advanceStep(1500);
      }
    },
    [currentStepIndex, steps, siteInfo, stepStates, advanceStep, escalateStep],
  );

  const submitAll = useCallback(async (): Promise<void> => {
    const photos = stepStates
      .filter((s) => (s.status === 'pass' || s.status === 'escalated' || s.status === 'serial_pending') && s.photoBase64 !== null)
      .map((s) => ({
        stepNumber: s.stepNumber,
        stepLabel: s.label,
        filename: `step-${s.stepNumber}.jpg`,
        base64: s.photoBase64 as string,
        needsManualReview: s.needsManualReview,
      }));

    let geofence: GeofencePayload | null = null;
    if (entryGeofence) {
      const submitPos = await readDeviceLocation(10_000);
      geofence = {
        ...entryGeofence,
        submitLat: submitPos?.lat ?? null,
        submitLon: submitPos?.lon ?? null,
      };
    }

    setUploading(true);
    setUploadError(null);
    setUploadResult(null);

    try {
      const res = await fetch('/api/sitecam/upload', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobType: siteInfo.jobType,
          siteId: siteInfo.siteId,
          photos,
          geofence,
        }),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => `HTTP ${res.status}`);
        setUploadError(text || `HTTP ${res.status}`);
        log.error('Upload failed', { status: res.status }, MODULE);
        return;
      }

      const json = (await res.json()) as { data: { uploadedCount: number } };
      setUploadResult({ uploadedCount: json.data.uploadedCount });
      log.info('Upload complete', { uploadedCount: json.data.uploadedCount }, MODULE);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setUploadError(msg);
      log.error('Upload network error', { err: msg }, MODULE);
    } finally {
      setUploading(false);
    }
  }, [stepStates, siteInfo, entryGeofence]);

  const currentStep: StepState | null = stepStates[currentStepIndex] ?? null;

  const allDone = stepStates.every(
    (s) => s.status === 'pass' || s.status === 'escalated' || s.status === 'serial_pending',
  );

  // True while the CURRENT step has an appeal awaiting a supervisor decision.
  const appealPending = appealedIndex !== null && appealedIndex === currentStepIndex;

  return {
    stepStates,
    currentStep,
    currentStepIndex,
    allDone,
    captureAndValidate,
    handleSerialSaved: (serial: string) => handleSerialSaved(currentStepIndex, serial),
    submitAll,
    uploading,
    uploadError,
    uploadResult,
    escalateStep,
    onAppealSubmitted,
    appealPending,
  };
}
