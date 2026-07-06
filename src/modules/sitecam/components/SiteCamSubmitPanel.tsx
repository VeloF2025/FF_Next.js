import { CheckCircle, Download } from 'lucide-react';

interface Props {
  passedCount: number;
  escalatedCount: number;
  uploadError: string | null;
  uploading: boolean;
  onSubmit: () => void;
  onSaveAll: () => void;
}

/**
 * "All steps complete" submit screen — extracted from `SiteCamWizard` (Task 7)
 * to make room for the offline-queue/not-saved additions without pushing the
 * wizard over the 200-line component guideline. Pure UI extraction of the
 * pre-existing markup; no behaviour change.
 */
export function SiteCamSubmitPanel({
  passedCount,
  escalatedCount,
  uploadError,
  uploading,
  onSubmit,
  onSaveAll,
}: Props) {
  return (
    <div className="rounded-xl border border-neutral-700 bg-neutral-900 px-4 py-6 space-y-4">
      <div className="flex flex-col items-center gap-3 text-center">
        <CheckCircle className="h-10 w-10 text-green-400" />
        <h2 className="text-lg font-semibold text-neutral-100">All steps complete</h2>
        <p className="text-sm text-neutral-400">
          {passedCount} passed · {escalatedCount} escalated
        </p>
      </div>

      {uploadError && (
        <div className="rounded-lg border border-red-800 bg-red-950/50 px-4 py-3 text-sm text-red-300">
          {uploadError}
        </div>
      )}

      <button
        type="button"
        onClick={onSubmit}
        disabled={uploading}
        className="w-full rounded-lg bg-sky-600 py-3 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-50 active:bg-sky-700"
      >
        {uploading ? 'Uploading…' : 'Submit All Photos'}
      </button>

      <button
        type="button"
        onClick={onSaveAll}
        className="flex w-full items-center justify-center gap-2 rounded-lg border border-neutral-600 py-3 text-sm font-medium text-neutral-300 hover:bg-neutral-800 transition-colors"
      >
        <Download className="h-4 w-4" />
        Save Photos to Device (for 1Map)
      </button>
    </div>
  );
}
