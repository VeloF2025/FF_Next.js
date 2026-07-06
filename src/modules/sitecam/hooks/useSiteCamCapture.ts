import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { log } from '@/lib/logger';
import type { SiteCamStep, SiteCamJobType } from '../lib/sitecamSteps';
import type { GeofenceReading } from '../lib/geofence';
import { prepareCapturePhotos } from '../lib/watermarkPhoto';
import { loadDraft, saveDraft, clearDraft, type SiteCamDraft } from '../lib/sitecamDraft';
import { SiteCamPhotoStore } from '../offline/photoStore';
import {
  ensureSiteCamJobMeta,
  persistCapturedPhoto,
  decodeStoredPhotos,
  mergeHydratedPhotos,
} from '../offline/siteCamJobDurability';
import { attemptSiteCamSubmit, type SiteCamSubmitOutcome } from '../offline/submitAllSiteCam';
import { useSiteCamFlush } from '../offline/useSiteCamFlush';

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
    if (draftRef.current === undefined) {
      draftRef.current = loadDraft(siteInfo.jobType, siteInfo.siteId, steps);
    }
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
  // True only when a byte-quota rejection blocked the LAST capture from being
  // durably saved — the step must stay un-captured (never green) until a
  // retry succeeds (Task 5).
  const [photoNotSaved, setPhotoNotSaved] = useState(false);
  // True once a submission has been queued for offline/background flush
  // (Task 6) — drives the "Saved offline" UI instead of the green success
  // screen. Restored from durable meta on mount if a prior tap already queued it.
  const [queued, setQueued] = useState(false);

  // One durable IndexedDB job store per (jobType, siteId) — recreated only
  // when the job itself changes (a genuinely different job), never per render.
  const store = useMemo(
    () => new SiteCamPhotoStore(siteInfo.jobType, siteInfo.siteId),
    [siteInfo.jobType, siteInfo.siteId],
  );

  // Mirror progress into localStorage so a refresh / PWA reload restores it.
  useEffect(() => {
    saveDraft(siteInfo.jobType, siteInfo.siteId, stepStates, currentStepIndex, appealedIndex);
  }, [siteInfo.jobType, siteInfo.siteId, stepStates, currentStepIndex, appealedIndex]);

  // Once the job is submitted there is nothing left to resume — drop the draft.
  useEffect(() => {
    if (uploadResult) clearDraft(siteInfo.jobType, siteInfo.siteId);
  }, [uploadResult, siteInfo.jobType, siteInfo.siteId]);

  // Restore-on-mount (Task 5): mint/reuse the job's durable meta (stable
  // clientSubmissionId across every capture + resubmit), surface a
  // previously-queued submission, and hydrate any captured step whose photo
  // was stripped from the localStorage draft (its "lite" quota fallback —
  // now the intended path, since the durable copy lives in IDB). Uses a
  // functional `setStepStates` update so a live capture completing while
  // this async restore is in flight can never be stomped by stale data.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const meta = await ensureSiteCamJobMeta(store, siteInfo);
      if (cancelled) return;
      setQueued(meta.submitState === 'queued');

      const photos = await store.listStepPhotos();
      if (photos.length === 0 || cancelled) return;

      const decoded = await decodeStoredPhotos(photos);
      if (cancelled) return;
      setStepStates((prev) => mergeHydratedPhotos(prev, decoded));
    })().catch((err) => {
      log.warn('SiteCam job restore failed (continuing without durability)', { err: String(err) }, MODULE);
    });
    return () => {
      cancelled = true;
    };
    // One-time restore per job — keyed on `store` identity (which only
    // changes when jobType/siteId change, i.e. a genuinely different job),
    // not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store]);

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

  // Dev/testing only — gated in the UI by NEXT_PUBLIC_SITECAM_ALLOW_UPLOAD (off
  // in production). Lets a tester advance past a serial-scan step without a
  // physical ONT/UPS barcode in front of the lens, so the rest of the wizard can
  // be exercised end-to-end. Marks the step done (advances + still uploads the
  // photo) but records no serial and flags it for manual review.
  const skipSerialStep = useCallback(
    (idx: number) => {
      setStepStates((prev) =>
        prev.map((s, i) =>
          i === idx
            ? { ...s, status: 'serial_pending', serialScanned: null, needsManualReview: true }
            : s,
        ),
      );
      advanceStep(600);
    },
    [advanceStep],
  );

  const captureAndValidate = useCallback(
    async (file: File): Promise<void> => {
      const idx = currentStepIndex;
      const step = steps[idx];
      if (!step) return;

      setPhotoNotSaved(false);

      let clean: string;
      let watermarked: string;
      let watermarkedBlob: Blob;
      try {
        // Downscale once and produce three copies: a CLEAN image for the VLM (so
        // the banner is never burned into the pixels it grades for quality), a
        // WATERMARKED image — site id + capture time in the pixels — for
        // storage/upload so the photo cannot be reused on another DR, and the
        // same watermarked JPEG as a Blob for durable offline storage.
        ({ clean, watermarked, watermarkedBlob } = await prepareCapturePhotos(file, siteInfo.siteId));
      } catch (err) {
        log.error('Failed to read file as base64', { err: String(err) }, MODULE);
        return;
      }

      // Persist durably BEFORE any status transition (Task 5) — a byte-quota
      // rejection must block the step from ever going "green". Any OTHER store
      // failure fails OPEN (logged, non-fatal): durability is best-effort and
      // must never block a technician mid-install.
      const persisted = await persistCapturedPhoto(store, step.number, watermarkedBlob, false);
      if (persisted === 'quota_exceeded') {
        setPhotoNotSaved(true);
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
          // Best-effort patch of the already-persisted photo's flag — the
          // initial write above already succeeded, so a failure here is
          // logged and never blocks the tech.
          void persistCapturedPhoto(store, step.number, watermarkedBlob, true);
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
          // Server-side fail-open on an otherwise-genuine pass — patch the
          // already-persisted photo's flag (best-effort, non-blocking).
          if (flagged) void persistCapturedPhoto(store, step.number, watermarkedBlob, true);
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
        void persistCapturedPhoto(store, step.number, watermarkedBlob, true);
        setStepStates((prev) =>
          prev.map((s, i) => (i === idx ? { ...s, status: 'pass', needsManualReview: true } : s)),
        );
        advanceStep(1500);
      }
    },
    [currentStepIndex, steps, siteInfo, stepStates, advanceStep, escalateStep, store],
  );

  // Centralises what happens to every submit outcome — shared by the initial
  // Submit tap AND the page-context flush retry (Task 6) so there is exactly
  // one place that decides what "submitting this job" means. `queued` stays
  // untouched on 'error': a fresh online failure was never queued (matches
  // today's plain retry-on-this-screen behaviour); a flush-retry failure was
  // already queued and the photos remain safely stored either way — only the
  // message surfaces, never a silent drop (mirrors useOfflineQueue's
  // dropped-item contract).
  const handleSubmitOutcome = useCallback((result: SiteCamSubmitOutcome) => {
    switch (result.outcome) {
      case 'submitted':
        setUploadResult({ uploadedCount: result.uploadedCount });
        setQueued(false);
        setUploadError(null);
        log.info('Upload complete', { uploadedCount: result.uploadedCount }, MODULE);
        break;
      case 'queued':
        setQueued(true);
        setUploadError(null);
        break;
      case 'error':
        setUploadError(result.message);
        log.error('SiteCam submit failed', { message: result.message }, MODULE);
        break;
      case 'not_saved':
        setUploadError(result.message);
        break;
      case 'idle':
        setUploadError('Nothing to submit — please recapture your photos.');
        break;
    }
  }, []);

  // The one function that actually attempts a submit — offline-aware (builds
  // from the durable store, POSTs with clientSubmissionId, queues on
  // offline/network/5xx, clears the store on 2xx). Reused by both the Submit
  // tap (`submitAll`, below) and the background flush loop (`useSiteCamFlush`).
  const attemptFlush = useCallback(async (): Promise<void> => {
    const result = await attemptSiteCamSubmit(store, entryGeofence);
    handleSubmitOutcome(result);
  }, [store, entryGeofence, handleSubmitOutcome]);

  // Page-context retry cadence (online edge + mount + 60s poll + manual) for
  // a job already queued. Auto-retry pauses while `uploadError` is showing —
  // the technician must retry manually via `retrySubmit` (Task 6).
  const { flushing, syncNow: retrySubmit } = useSiteCamFlush(queued, uploadError !== null, attemptFlush);

  const submitAll = useCallback(async (): Promise<void> => {
    setUploading(true);
    setUploadError(null);
    setUploadResult(null);
    try {
      await attemptFlush();
    } finally {
      setUploading(false);
    }
  }, [attemptFlush]);

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
    skipSerialStep: () => skipSerialStep(currentStepIndex),
    submitAll,
    uploading,
    uploadError,
    uploadResult,
    photoNotSaved,
    queued,
    flushing,
    retrySubmit,
    escalateStep,
    onAppealSubmitted,
    appealPending,
  };
}
