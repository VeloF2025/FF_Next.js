/**
 * AbandonedIssuesBanner — surface permanently-failed queued pickings.
 *
 * Rendered at the top of StoresHub when one or more issue submissions have
 * exhausted MAX_ATTEMPTS on a 4xx response and been moved to the
 * 'abandoned-issues' IndexedDB store. The stores person can:
 *   - Tap "Review" to expand the inline detail panel.
 *   - Tap "Dismiss" per item once they have handled it manually (re-issued
 *     or confirmed it is no longer needed).
 *
 * The banner only appears when `count > 0`. Dismissing all items causes the
 * parent to re-render with count=0 and the banner unmounts.
 *
 * ⚪ UNTESTED: integration tests in Task 2.9
 */

import React, { useEffect, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronUp, X } from 'lucide-react';

import type { AbandonedIssue } from '../offline/queueIssue';
import { listAbandoned } from '../offline/queueIssue';

// =============================================================================
// Props
// =============================================================================

export interface AbandonedIssuesBannerProps {
  count: number;
  onView: () => void;
  onDismiss: (id: string) => Promise<void>;
}

// =============================================================================
// Banner component
// =============================================================================

export function AbandonedIssuesBanner({
  count,
  onView,
  onDismiss,
}: AbandonedIssuesBannerProps) {
  const [expanded, setExpanded] = useState(false);
  const [items, setItems] = useState<AbandonedIssue[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Load detail rows when the panel is expanded.
  useEffect(() => {
    if (!expanded) return;
    setLoadError(null);
    listAbandoned()
      .then(setItems)
      .catch((err: unknown) => {
        setLoadError(err instanceof Error ? err.message : 'Failed to load details');
      });
  }, [expanded, count]);

  function handleToggle() {
    setExpanded((prev) => !prev);
    onView();
  }

  async function handleDismiss(id: string) {
    await onDismiss(id);
    setItems((prev) => prev.filter((i) => i.id !== id));
  }

  return (
    <div
      role="alert"
      className="mb-4 rounded-lg border border-rose-800 bg-rose-950/50"
    >
      {/* Header row */}
      <div className="flex items-center justify-between gap-2 px-3 py-3">
        <div className="flex items-center gap-2 min-w-0">
          <AlertTriangle
            className="w-4 h-4 text-rose-400 shrink-0"
            aria-hidden="true"
          />
          <span className="text-sm font-medium text-rose-200 truncate">
            {count} unsent picking{count !== 1 ? 's' : ''} need manual review
          </span>
        </div>
        <button
          type="button"
          onClick={handleToggle}
          className="flex items-center gap-1 text-xs text-rose-300 hover:text-rose-100 shrink-0"
          aria-expanded={expanded}
        >
          {expanded ? (
            <>
              Hide <ChevronUp className="w-3.5 h-3.5" aria-hidden="true" />
            </>
          ) : (
            <>
              Review <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />
            </>
          )}
        </button>
      </div>

      {/* Inline detail panel */}
      {expanded && (
        <div className="border-t border-rose-800 px-3 pb-3 pt-2 space-y-2">
          {loadError ? (
            <p className="text-xs text-rose-400">{loadError}</p>
          ) : items.length === 0 ? (
            <p className="text-xs text-rose-400">No details available.</p>
          ) : (
            items.map((item) => (
              <AbandonedIssueRow
                key={item.id}
                item={item}
                onDismiss={handleDismiss}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Per-item row
// =============================================================================

interface AbandonedIssueRowProps {
  item: AbandonedIssue;
  onDismiss: (id: string) => Promise<void>;
}

function AbandonedIssueRow({ item, onDismiss }: AbandonedIssueRowProps) {
  const [dismissing, setDismissing] = useState(false);

  const serialCount = item.draft.serials.length;
  const itemName = item.draft.serials[0]?.stockItemName ?? 'Unknown item';
  const abandonedDate = new Date(item.abandonedAt).toLocaleDateString('en-ZA', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });

  async function handleDismiss() {
    setDismissing(true);
    try {
      await onDismiss(item.id);
    } finally {
      setDismissing(false);
    }
  }

  return (
    <div className="flex items-start justify-between gap-2 rounded-md bg-rose-950/60 px-2 py-2">
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-rose-100 truncate">
          {itemName} &times; {serialCount} serial{serialCount !== 1 ? 's' : ''}
        </p>
        <p className="text-xs text-rose-400 mt-0.5">
          Failed {item.attempts}x &middot; {abandonedDate}
        </p>
        {item.lastError && (
          <p className="text-xs text-rose-500 mt-0.5 line-clamp-1" title={item.lastError}>
            {item.lastError}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={handleDismiss}
        disabled={dismissing}
        className="shrink-0 flex items-center justify-center w-6 h-6 rounded text-rose-400 hover:text-rose-100 hover:bg-rose-800/50 disabled:opacity-50 transition-colors"
        aria-label="Dismiss this abandoned picking"
      >
        <X className="w-3.5 h-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}
