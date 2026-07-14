import { useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { AlertTriangle, Camera, CheckCircle, Download, Loader2, SkipForward, Upload } from 'lucide-react';
import { log } from '@/lib/logger';
import type { StepState } from '../hooks/useSiteCamCapture';
import { SerialScanStep } from './SerialScanStep';
import { SiteCamSignatureStep } from './SiteCamSignatureStep';
import { savePhotoToDevice, stepPhotoFilename } from '../lib/savePhotoToDevice';

// ─── TEMPORARY: dev-only test affordances ────────────────────────────────────
// Gated to dev via the build-time flag; NEVER enabled in production. When true it:
//   1. shows a "Skip serial scan (test)" button so a tester can advance past the
//      step-6 serial scan with no physical ONT/UPS barcode on hand, and
//   2. shows the gallery "Upload Photo (test)" button on EVERY step (see
//      `showUpload` below) so other-site photos can be fed into steps that are
//      normally camera-only — for full end-to-end test coverage.
// The per-step `allowUpload` prop (steps 10–12) is a SEPARATE, PERMANENT
// production feature and is unaffected by this flag — see Props.allowUpload.
// To revert (2) later: drop the `|| ALLOW_TEST_UPLOAD` in `showUpload` below.
const ALLOW_TEST_UPLOAD = process.env.NEXT_PUBLIC_SITECAM_ALLOW_UPLOAD === 'true';
// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  step: StepState;
  drNumber: string;
  onCapture: (file: File) => void;
  onSerialSaved: (serial: string) => void;
  /** Dev/testing only — advance past the serial scan without a physical device. */
  onSkipSerial: () => void;
  onAppeal: () => void;
  /** True while this step's appeal is awaiting a supervisor decision. */
  appealPending?: boolean;
  /**
   * When true, offer a gallery "Upload Photo" button beside "Take Photo". Set
   * only for steps whose photo is legitimately captured outside the SiteCam
   * camera (signature, dome-joint shots); all other steps are camera-only.
   */
  allowUpload?: boolean;
  /**
   * When true, this step captures a customer sign-off (name + consent +
   * signature) instead of a photo. Renders SiteCamSignatureStep in place of the
   * camera; the composited image flows through the same onCapture pipeline.
   */
  isSignature?: boolean;
}

export function StepCapture({ step, drNumber, onCapture, onSerialSaved, onSkipSerial, onAppeal, appealPending = false, allowUpload = false, isSignature = false }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null); // gallery picker for allowUpload steps
  const [saved, setSaved] = useState(false);

  const handleSavePhoto = async () => {
    if (!step.photoBase64) return;
    try {
      await savePhotoToDevice(step.photoBase64, stepPhotoFilename(drNumber, step.stepNumber));
      setSaved(true);
    } catch (err) {
      log.warn('Save photo to device failed', { err: String(err) }, 'StepCapture');
    }
  };

  const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onCapture(file);
      e.target.value = '';
    }
  };

  const needsCapture = step.status === 'pending' || step.status === 'fail';
  // A signature step captures a customer sign-off in place of the camera.
  const showSignature = isSignature && needsCapture;
  const showCamera = needsCapture && !isSignature;
  const showSerialScan = step.status === 'serial_scan';
  const remaining = Math.max(0, 3 - step.attemptNumber);
  // Show the gallery upload when the step legitimately allows it (permanent —
  // steps 10–12) OR when the dev test flag is on (TEMPORARY — every step, so a
  // tester can feed other-site photos into camera-only steps). Remove the
  // `|| ALLOW_TEST_UPLOAD` to revert to production behaviour.
  const showUpload = allowUpload || ALLOW_TEST_UPLOAD;
  const isTestUpload = !allowUpload && ALLOW_TEST_UPLOAD;
  const showAppeal =
    !appealPending &&
    ((step.status === 'fail' && step.attemptNumber > 0) || step.status === 'escalated');

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-neutral-100">
        Step {step.stepNumber}: {step.label}
      </h2>

      {step.photoBase64 && (
        <div className="relative overflow-hidden rounded-xl border border-neutral-700 bg-black">
          <img
            src={`data:image/jpeg;base64,${step.photoBase64}`}
            alt={`Captured photo for step ${step.stepNumber}: ${step.label}`}
            className="mx-auto max-h-72 w-full object-contain"
          />
          {step.status === 'validating' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/60">
              <Loader2 className="h-8 w-8 animate-spin text-sky-400" />
              <p className="text-sm font-medium text-neutral-200">Checking photo…</p>
            </div>
          )}
        </div>
      )}

      {(step.status === 'pass' || step.status === 'serial_pending') && (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-green-800 bg-green-950/40 py-8">
          <CheckCircle className="h-8 w-8 text-green-400" />
          <p className="text-sm font-medium text-green-300">
            {step.status === 'serial_pending' ? 'Step complete' : 'Photo accepted!'}
          </p>
          {step.photoBase64 && (
            <button
              type="button"
              onClick={() => void handleSavePhoto()}
              className="flex items-center gap-2 rounded-lg border border-green-700 px-4 py-2 text-xs font-medium text-green-300 hover:bg-green-900/40 transition-colors"
            >
              <Download className="h-4 w-4" />
              {saved ? 'Saved — save again' : 'Save photo to device'}
            </button>
          )}
        </div>
      )}

      {step.status === 'escalated' && (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-amber-800 bg-amber-950/40 py-8">
          <AlertTriangle className="h-8 w-8 text-amber-400" />
          <p className="text-sm font-medium text-amber-300">Escalated — moving on</p>
          <p className="text-xs text-neutral-500">A supervisor will review this step.</p>
        </div>
      )}

      {step.status === 'fail' && step.failReasons.length > 0 && (
        <div className="rounded-xl border border-red-800 bg-red-950/40 px-4 py-4 space-y-3">
          <div className="space-y-1">
            {step.failReasons.map((reason, i) => (
              <p key={i} className="text-sm text-red-300">{reason}</p>
            ))}
          </div>
          {step.corrections.length > 0 && (
            <div className="space-y-1 border-t border-red-900 pt-3">
              {step.corrections.map((correction, i) => (
                <p key={i} className="text-xs italic text-neutral-400">{correction}</p>
              ))}
            </div>
          )}
          <p className="text-xs text-neutral-500">
            Attempt {step.attemptNumber} of 3 — {remaining} remaining
          </p>
        </div>
      )}

      {showSignature && <SiteCamSignatureStep onSigned={onCapture} />}

      {showSerialScan && step.serialDevice && (
        <>
          <SerialScanStep
            // Remount on each serial (6a → 6b) so the scan UI resets cleanly.
            key={step.serialIndex}
            stepNumber={step.stepNumber}
            serialLabel={step.serialLabel}
            serialDevice={step.serialDevice}
            serialAttempts={step.serialAttempts}
            drNumber={drNumber}
            onScanSaved={onSerialSaved}
            serialPosition={{ index: step.serialIndex, total: step.serials.length }}
          />

          {/* ─── TEMPORARY: test-only skip (remove with ALLOW_TEST_UPLOAD) ───
              Lets a tester advance past the serial scan when no physical
              ONT/UPS barcode is on hand, so the downstream steps can be
              exercised. Gated to dev by the same build-time flag as the test
              upload above — never compiled into production. */}
          {ALLOW_TEST_UPLOAD && (
            <button
              type="button"
              onClick={onSkipSerial}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-amber-600/70 bg-amber-950/20 py-3 text-sm font-medium text-amber-300 hover:bg-amber-950/40 transition-colors"
            >
              <SkipForward className="h-5 w-5" />
              Skip serial scan (test)
            </button>
          )}
        </>
      )}

      {showCamera && (
        <div>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="flex w-full flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-neutral-600 bg-neutral-900 py-12 hover:border-sky-500 hover:bg-neutral-800 active:bg-neutral-800/60 transition-colors"
          >
            <Camera className="h-10 w-10 text-neutral-400" />
            <span className="text-sm font-medium text-neutral-300">Take Photo</span>
          </button>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={handleInputChange}
          />

          {/* Gallery upload — offered only on steps whose photo is legitimately
              captured outside the SiteCam camera (signature, dome-joint shots).
              No `capture` attribute → on a phone this opens the gallery/file
              picker. The chosen file flows through the exact same onCapture →
              watermark → validate pipeline as a camera photo. */}
          {showUpload && (
            <>
              <button
                type="button"
                onClick={() => uploadInputRef.current?.click()}
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-neutral-600 bg-neutral-900 py-3 text-sm font-medium text-neutral-300 hover:border-sky-500 hover:bg-neutral-800 transition-colors"
              >
                <Upload className="h-5 w-5" />
                {isTestUpload ? 'Upload Photo (test)' : 'Upload Photo'}
              </button>
              <input
                ref={uploadInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleInputChange}
              />
            </>
          )}
        </div>
      )}

      {appealPending && (
        <div className="flex items-center justify-center gap-2 rounded-xl border border-amber-800 bg-amber-950/30 py-3 text-sm font-medium text-amber-300">
          <Loader2 className="h-4 w-4 animate-spin" />
          Appeal sent — waiting for supervisor review…
        </div>
      )}

      {showAppeal && (
        <button
          type="button"
          onClick={onAppeal}
          className="w-full rounded-xl border border-amber-700 bg-amber-950/30 py-3 text-sm font-medium text-amber-300 hover:bg-amber-950/50 transition-colors"
        >
          Appeal This Step
        </button>
      )}
    </div>
  );
}
