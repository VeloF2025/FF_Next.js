import { useState, useCallback, useEffect } from 'react';
import Link from 'next/link';
import { SerialSearch } from '@/components/field-stock/SerialSearch';
import { SerialResultsTable } from '@/components/field-stock/SerialResultsTable';
import { useSerialSearch } from '@/modules/procurement/field-stock/hooks/useSerialSearch';
import type { SerialSearchFilters, SerialSearchRowView } from '@/types/field-stock';

interface SerialDrilldownViewProps {
  /** Small label above the heading, e.g. "Warehouse" / "Project". */
  kicker: string;
  /**
   * Which result-row field carries this entity's display name. The name is
   * derived from the (already-authenticated) search response rather than a
   * server-side DB read, so no entity data leaks pre-auth.
   */
  nameField: 'currentLocationName' | 'allocatedProjectName';
  /** Shown until a name is resolved from results (the entity id). */
  fallbackHeading: string;
  /** Fixed filter baked into every search — warehouseId or projectId. */
  fixedFilter: Pick<SerialSearchFilters, 'warehouseId' | 'projectId'>;
  /** Back-link target (the landing list page). */
  backHref: string;
  backLabel: string;
}

/** Reads the entity name off the first result row that carries it. */
function nameFromRows(
  rows: SerialSearchRowView[],
  field: SerialDrilldownViewProps['nameField']
): string | null {
  for (const r of rows) {
    if (r[field]) return r[field];
  }
  return null;
}

/**
 * Shared drill-down surface for the per-warehouse and per-project serial
 * pages (Wave 2 PR-12 / PR-13). Locks one filter (warehouseId or projectId)
 * and lets the user further filter by serial/MAC, status and category via the
 * same <SerialSearch> chrome as the master register.
 */
export function SerialDrilldownView({
  kicker,
  nameField,
  fallbackHeading,
  fixedFilter,
  backHref,
  backLabel,
}: SerialDrilldownViewProps) {
  const [userFilters, setUserFilters] = useState<SerialSearchFilters>({});
  const onFiltersChange = useCallback((f: SerialSearchFilters) => setUserFilters(f), []);

  // Fixed filter wins — the user cannot widen past this warehouse/project.
  const filters: SerialSearchFilters = { ...userFilters, ...fixedFilter };
  const { rows, total, loading, error } = useSerialSearch(filters);

  // Resolve the entity name from results and keep it once seen, so applying a
  // filter that returns zero rows doesn't blank the heading.
  const [resolvedName, setResolvedName] = useState<string | null>(null);
  useEffect(() => {
    const name = nameFromRows(rows, nameField);
    if (name) setResolvedName(name);
  }, [rows, nameField]);

  const heading = resolvedName ?? fallbackHeading;

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <div className="sticky top-0 z-10 -mx-4 mb-4 border-b border-neutral-800 bg-neutral-950/90 px-4 py-3 backdrop-blur">
        <Link href={backHref} className="text-xs text-blue-400 hover:underline">
          ← {backLabel}
        </Link>
        <div className="mt-1 text-xs uppercase tracking-wide text-neutral-500">{kicker}</div>
        <h1 className="text-xl font-semibold text-neutral-100">{heading}</h1>
      </div>
      <SerialSearch initialFilters={{}} onFiltersChange={onFiltersChange} />
      <SerialResultsTable rows={rows} total={total} loading={loading} error={error} />
    </div>
  );
}
