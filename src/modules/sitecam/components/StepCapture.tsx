import { useRef } from 'react';
import type { ChangeEvent } from 'react';
import { AlertTriangle, Camera, CheckCircle, Loader2 } from 'lucide-react';
import type { StepState } from '../hooks/useSiteCamCapture';

interface Props {
  step: StepState;
  onCapture: (file: File) => void;
}

export function StepCapture({ step, onCapture }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onCapture(file);
      // Reset so the same file can be re-selected on retry
      e.target.value = '';
    }
  };

  const showCamera = step.status === 'pending' || step.status === 'fail';
  const remaining = Math.max(0, 3 - step.attemptNumber);

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-neutral-100">
        Step {step.stepNumber}: {step.label}
      </h2>

      {/* Captured photo preview — lets the technician see the shot they took
          while it is being checked and alongside the pass/fail result. */}
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

      {/* Status: pass */}
      {step.status === 'pass' && (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-green-800 bg-green-950/40 py-8">
          <CheckCircle className="h-8 w-8 text-green-400" />
          <p className="text-sm font-medium text-green-300">Photo accepted!</p>
        </div>
      )}

      {/* Status: escalated */}
      {step.status === 'escalated' && (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-amber-800 bg-amber-950/40 py-8">
          <AlertTriangle className="h-8 w-8 text-amber-400" />
          <p className="text-sm font-medium text-amber-300">Escalated — moving on</p>
          <p className="text-xs text-neutral-500">A supervisor will review this step.</p>
        </div>
      )}

      {/* Status: fail */}
      {step.status === 'fail' && step.failReasons.length > 0 && (
        <div className="rounded-xl border border-red-800 bg-red-950/40 px-4 py-4 space-y-3">
          <div className="space-y-1">
            {step.failReasons.map((reason, i) => (
              <p key={i} className="text-sm text-red-300">
                {reason}
              </p>
            ))}
          </div>
          {step.corrections.length > 0 && (
            <div className="space-y-1 border-t border-red-900 pt-3">
              {step.corrections.map((correction, i) => (
                <p key={i} className="text-xs italic text-neutral-400">
                  {correction}
                </p>
              ))}
            </div>
          )}
          <p className="text-xs text-neutral-500">
            Attempt {step.attemptNumber} of 3 — {remaining} remaining
          </p>
        </div>
      )}

      {/* Camera button (pending or fail) */}
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
        </div>
      )}
    </div>
  );
}
