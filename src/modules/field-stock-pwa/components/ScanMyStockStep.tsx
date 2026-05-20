/**
 * ScanMyStockStep — step 2 of the /my/stores/return flow.
 *
 * Loads serials currently held by the calling tech (GET /api/procurement/field-stock/my-serials).
 * Renders them as a tappable checklist.
 *
 * Mixed-source guard: once one serial is selected its source warehouse becomes the
 * "locked" destination. Tapping a serial from a different source shows an inline
 * error and refuses the toggle.
 */

import React from 'react';
import { Loader2, AlertCircle, AlertTriangle } from 'lucide-react';
import type { PwaMyHeldSerial } from '../types';

// =============================================================================
// Props
// =============================================================================

export interface ScanMyStockStepProps {
  /** Serials currently selected (controlled). */
  scanned: PwaMyHeldSerial[];
  /** Source warehouse locked after the first serial is selected (null = unlocked). */
  lockedSourceWarehouseId: string | null;
  /** Human-readable name for the locked warehouse. */
  lockedSourceWarehouseName: string | null;
  /** Called whenever the scanned list or lock changes. */
  onChange: (
    next: PwaMyHeldSerial[],
    lockedId: string | null,
    lockedName: string | null,
  ) => void;
  /** Called when the user confirms their selection (Continue button). */
  onDone: () => void;
}

// =============================================================================
// Component
// =============================================================================

export function ScanMyStockStep({
  scanned,
  lockedSourceWarehouseId,
  lockedSourceWarehouseName,
  onChange,
  onDone,
}: ScanMyStockStepProps) {
  const [held, setHeld] = React.useState<PwaMyHeldSerial[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [fetchError, setFetchError] = React.useState<string | null>(null);
  const [mixedError, setMixedError] = React.useState<string | null>(null);

  // Load serials held by this tech on mount.
  React.useEffect(() => {
    let cancelled = false;
    fetch('/api/procurement/field-stock/my-serials')
      .then(async (res) => {
        if (!res.ok) {
          const text = await res.text().catch(() => res.statusText);
          throw new Error(text || `HTTP ${res.status}`);
        }
        return res.json() as Promise<PwaMyHeldSerial[]>;
      })
      .then((data) => {
        if (!cancelled) {
          setHeld(data);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setFetchError(err instanceof Error ? err.message : 'Failed to load serials');
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const scannedIds = React.useMemo(
    () => new Set(scanned.map((s) => s.serialId)),
    [scanned],
  );

  function handleToggle(serial: PwaMyHeldSerial) {
    const alreadySelected = scannedIds.has(serial.serialId);

    if (alreadySelected) {
      // Untoggle — remove from scanned
      const next = scanned.filter((s) => s.serialId !== serial.serialId);
      const newLockId = next.length > 0 ? lockedSourceWarehouseId : null;
      const newLockName = next.length > 0 ? lockedSourceWarehouseName : null;
      setMixedError(null);
      onChange(next, newLockId, newLockName);
      return;
    }

    // Adding a new serial — check mixed-source guard
    if (
      lockedSourceWarehouseId !== null &&
      serial.sourceLocationId !== lockedSourceWarehouseId
    ) {
      setMixedError(
        `This serial was issued from ${serial.sourceLocationName}. ` +
          `Finish your ${lockedSourceWarehouseName ?? 'current'} return first or start a new one.`,
      );
      return;
    }

    setMixedError(null);
    const next = [...scanned, serial];
    const newLockId = lockedSourceWarehouseId ?? serial.sourceLocationId;
    const newLockName = lockedSourceWarehouseName ?? serial.sourceLocationName;
    onChange(next, newLockId, newLockName);
  }

  // ── Loading state ──────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center pt-16 gap-2 text-sm text-neutral-400">
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading your stock…
      </div>
    );
  }

  // ── Fetch error ────────────────────────────────────────────────────────────
  if (fetchError) {
    return (
      <div className="flex items-start gap-2 rounded-lg bg-red-950/50 border border-red-800 px-3 py-3 text-sm text-red-200 mt-4">
        <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
        <span>{fetchError}</span>
      </div>
    );
  }

  // ── Empty state ────────────────────────────────────────────────────────────
  if (held.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 pt-16 text-center">
        <AlertCircle className="w-10 h-10 text-neutral-600" aria-hidden="true" />
        <p className="text-sm text-neutral-400 max-w-xs">
          No stock is currently issued to you. Nothing to return.
        </p>
      </div>
    );
  }

  return (
    <section aria-labelledby="scan-heading" className="space-y-4">
      <h2 id="scan-heading" className="text-base font-semibold text-neutral-100">
        Select items to return
      </h2>
      <p className="text-sm text-neutral-400">
        Tap the serials you want to return. All selected items must come from the same
        warehouse.
      </p>

      {/* Locked-warehouse banner */}
      {lockedSourceWarehouseName && (
        <div
          aria-live="polite"
          className="rounded-lg bg-emerald-950/50 border border-emerald-800 px-3 py-2 text-sm text-emerald-300"
        >
          Returning to <span className="font-semibold">{lockedSourceWarehouseName}</span>
        </div>
      )}

      {/* Mixed-source error */}
      {mixedError && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg bg-amber-950/60 border border-amber-800 px-3 py-2 text-sm text-amber-200"
        >
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{mixedError}</span>
        </div>
      )}

      {/* Serial checklist */}
      <ul className="space-y-2">
        {held.map((serial) => {
          const isSelected = scannedIds.has(serial.serialId);
          const isBlocked =
            !isSelected &&
            lockedSourceWarehouseId !== null &&
            serial.sourceLocationId !== lockedSourceWarehouseId;

          return (
            <li key={serial.serialId}>
              <button
                type="button"
                onClick={() => handleToggle(serial)}
                aria-pressed={isSelected}
                disabled={isBlocked}
                className={[
                  'w-full text-left rounded-xl border px-3 py-3 transition-colors',
                  isSelected
                    ? 'border-emerald-500 bg-emerald-500/10'
                    : isBlocked
                      ? 'border-neutral-800 bg-neutral-900 opacity-40 cursor-not-allowed'
                      : 'border-neutral-800 bg-neutral-900 hover:bg-neutral-800/60',
                ].join(' ')}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-neutral-100">
                      {serial.serialNumber}
                    </p>
                    <p className="text-xs text-neutral-400 mt-0.5">
                      {serial.stockItemName}
                    </p>
                  </div>
                  <span className="text-xs text-neutral-500">{serial.sourceLocationName}</span>
                </div>
              </button>
            </li>
          );
        })}
      </ul>

      {/* Continue button */}
      <button
        type="button"
        disabled={scanned.length === 0}
        onClick={onDone}
        className="w-full rounded-xl bg-emerald-600 disabled:bg-neutral-700 disabled:cursor-not-allowed text-white font-medium py-3 text-sm"
      >
        Continue ({scanned.length} serial{scanned.length !== 1 ? 's' : ''})
      </button>
    </section>
  );
}
