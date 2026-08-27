/**
 * "Load more" control for the review queue — the API caps each request
 * at PAGE_SIZE rows, so a backlog bigger than one page needs this to be
 * reachable at all (see pages/staff/receipts.tsx's loadMore()).
 */
export function LoadMoreButton({
  loadedCount,
  total,
  loading,
  onClick,
}: {
  loadedCount: number;
  total: number;
  loading: boolean;
  onClick: () => void;
}) {
  if (loadedCount >= total) return null;
  return (
    <div className="flex flex-col items-center gap-1 py-2">
      <button
        type="button"
        onClick={onClick}
        disabled={loading}
        className="ff-button ff-button--secondary disabled:opacity-50"
      >
        {loading ? 'Loading…' : `Load more (${loadedCount} of ${total})`}
      </button>
    </div>
  );
}
