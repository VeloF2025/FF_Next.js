/**
 * IssueDirtyConfirmDialog — inline alertdialog for "Discard this issue?".
 *
 * Extracted from IssueOrchestrator to keep component files under 200 lines.
 * Avoids native confirm() which blocks the iOS Safari PWA main thread.
 *
 * Renders inline (not a modal overlay) — shown in the IssueOrchestrator
 * layout above the step content when the user tries to navigate away with
 * uncommitted work.
 */

// =============================================================================
// Props
// =============================================================================

export interface IssueDirtyConfirmDialogProps {
  /** Called when the user confirms discard. */
  onDiscard: () => void;
  /** Called when the user chooses to continue the flow. */
  onContinue: () => void;
}

// =============================================================================
// Component
// =============================================================================

export function IssueDirtyConfirmDialog({
  onDiscard,
  onContinue,
}: IssueDirtyConfirmDialogProps) {
  return (
    <div
      role="alertdialog"
      aria-label="Discard issue?"
      className="mb-4 rounded-lg border border-amber-800 bg-amber-950/60 px-4 py-3 space-y-3"
    >
      <p className="text-sm text-amber-200 font-medium">Discard this issue?</p>
      <p className="text-xs text-amber-300/80">
        Any scanned serials and entered data will be lost.
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onDiscard}
          className="flex-1 py-2.5 rounded-lg bg-amber-700 text-white text-sm font-medium hover:bg-amber-600"
        >
          Discard
        </button>
        <button
          type="button"
          onClick={onContinue}
          className="flex-1 py-2.5 rounded-lg border border-neutral-700 text-neutral-300 text-sm font-medium hover:bg-neutral-800"
        >
          Continue
        </button>
      </div>
    </div>
  );
}
