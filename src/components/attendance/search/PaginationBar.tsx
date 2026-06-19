/**
 * PaginationBar — page navigation for Pulse · Search.
 *
 * Renders a "Showing X–Y of N rows" summary, Previous/Next buttons, and a
 * "Page N of M" indicator. All state lives in the parent; this is a pure
 * presentational component.
 */

interface PaginationBarProps {
  page: number;
  pageSize: number;
  totalRows: number;
  loading: boolean;
  onPrev: () => void;
  onNext: () => void;
}

export function PaginationBar({
  page, pageSize, totalRows, loading, onPrev, onNext,
}: PaginationBarProps) {
  const lastPage = Math.max(1, Math.ceil(totalRows / pageSize));

  if (totalRows === 0) return null;

  return (
    <div className="mt-3 flex items-center justify-between text-sm text-neutral-400">
      <span>
        Showing {(page - 1) * pageSize + 1}
        &ndash;{Math.min(page * pageSize, totalRows)} of {totalRows.toLocaleString('en-ZA')} rows
      </span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={page <= 1 || loading}
          onClick={onPrev}
          className="px-3 py-1 rounded border border-neutral-700 disabled:opacity-50"
        >
          Previous
        </button>
        <span className="px-2">
          Page {page} of {lastPage}
        </span>
        <button
          type="button"
          disabled={page >= lastPage || loading}
          onClick={onNext}
          className="px-3 py-1 rounded border border-neutral-700 disabled:opacity-50"
        >
          Next
        </button>
      </div>
    </div>
  );
}
