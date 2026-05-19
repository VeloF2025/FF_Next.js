/**
 * PickWarehouseStep — step 1 of the stores issue flow.
 *
 * Stores person picks the source warehouse before the rest of the issue flow
 * proceeds. This fixes the bug where submitIssue was passing stockItemId /
 * technicianId as location FKs (which are FK to stock_locations, not stock_items
 * or staff).
 *
 * Theme: dark — same bg-neutral-900 / bg-neutral-950 / border-neutral-700/800
 * pattern as PickTechStep.
 *
 * ⚪ UNTESTED: integration tests in follow-on task.
 */

import { Warehouse } from 'lucide-react';
import {
  useStoresLocations,
  type PwaStockLocation,
} from '@/modules/field-stock-pwa/lib/locationDefaults';

// =============================================================================
// Props
// =============================================================================

export interface PickWarehouseStepProps {
  onPick: (location: { id: string; name: string }) => void;
}

// =============================================================================
// Sub-components
// =============================================================================

function WarehouseListSkeleton() {
  return (
    <ul className="divide-y divide-neutral-800 rounded-lg bg-neutral-950 border border-neutral-800">
      {[0, 1, 2].map((i) => (
        <li key={i} className="px-4 py-3 flex items-center gap-3">
          <div className="h-8 w-8 rounded bg-neutral-800 animate-pulse shrink-0" />
          <div className="space-y-1.5 flex-1">
            <div className="h-4 w-40 rounded bg-neutral-800 animate-pulse" />
            <div className="h-3 w-24 rounded bg-neutral-800 animate-pulse" />
          </div>
        </li>
      ))}
    </ul>
  );
}

function EmptyState() {
  return (
    <div className="py-10 text-center rounded-lg bg-neutral-950 border border-neutral-800">
      <Warehouse className="w-8 h-8 text-neutral-600 mx-auto mb-2" />
      <p className="text-sm text-neutral-400">No warehouses configured</p>
      <p className="text-xs text-neutral-600 mt-1">
        Ask your admin to add a warehouse location in Field Stock settings.
      </p>
    </div>
  );
}

function WarehouseRow({
  location,
  onPick,
}: {
  location: PwaStockLocation;
  onPick: (loc: { id: string; name: string }) => void;
}) {
  return (
    <li
      role="button"
      tabIndex={0}
      onClick={() => onPick({ id: location.id, name: location.name })}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onPick({ id: location.id, name: location.name });
        }
      }}
      className="px-4 py-3.5 hover:bg-neutral-900 active:bg-neutral-800 cursor-pointer flex items-center gap-3"
    >
      <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-neutral-800 flex items-center justify-center">
        <Warehouse className="w-4 h-4 text-neutral-400" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-white text-sm font-medium truncate">{location.name}</div>
        <div className="text-xs text-neutral-500 mt-0.5">{location.code}</div>
      </div>
    </li>
  );
}

// =============================================================================
// Component
// =============================================================================

export function PickWarehouseStep({ onPick }: PickWarehouseStepProps) {
  const { warehouses, loading, error, reload } = useStoresLocations();

  return (
    <div className="space-y-3">
      <div className="space-y-0.5">
        <h2 className="text-base font-semibold text-white">Select warehouse</h2>
        <p className="text-xs text-neutral-400">
          Choose the source warehouse for this issue.
        </p>
      </div>

      {error && (
        <div className="px-4 py-3 rounded-lg bg-rose-950 border border-rose-800 text-rose-300 text-sm flex items-center justify-between gap-2">
          <span>{error}</span>
          <button
            type="button"
            onClick={reload}
            className="text-xs underline underline-offset-2 text-rose-400 hover:text-rose-200 shrink-0"
          >
            Retry
          </button>
        </div>
      )}

      {loading ? (
        <WarehouseListSkeleton />
      ) : warehouses.length === 0 && !error ? (
        <EmptyState />
      ) : (
        <ul className="divide-y divide-neutral-800 rounded-lg bg-neutral-950 border border-neutral-800">
          {warehouses.map((loc) => (
            <WarehouseRow key={loc.id} location={loc} onPick={onPick} />
          ))}
        </ul>
      )}
    </div>
  );
}
