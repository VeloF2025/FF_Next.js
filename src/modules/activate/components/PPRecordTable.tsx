/**
 * PPRecordTable — table shell (thead + tbody loading/empty states + pagination)
 * wrapping PPDataRow. Styled to match OltRecordTable.
 */

'use client';

import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { PPDataRow } from './PPDataRow';
import { PPDataTableHead } from './PPDataTableHead';
import { type PPRecord } from './ppDataShared';

interface PPRecordTableProps {
  records: PPRecord[];
  isLoading: boolean;
  page: number;
  total: number;
  pageSize: number;
  onPageChange: (p: number) => void;
  selectedIds: number[];
  onToggleSelect: (id: number) => void;
  onToggleSelectAll: () => void;
  allSelectableChecked: boolean;
  selectableOnPage: PPRecord[];
}

export function PPRecordTable({
  records,
  isLoading,
  page,
  total,
  pageSize,
  onPageChange,
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
  allSelectableChecked,
  selectableOnPage,
}: PPRecordTableProps) {
  if (isLoading) {
    return <LoadingSpinner className="py-12" size="md" label="Loading records..." />;
  }

  if (records.length === 0) {
    return (
      <div className="text-center py-12 text-[var(--ff-text-tertiary)]">
        No records found
      </div>
    );
  }

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <PPDataTableHead
            showSelectAll={selectableOnPage.length > 0}
            allChecked={allSelectableChecked}
            onToggleAll={onToggleSelectAll}
          />
          <tbody>
            {records.map(record => (
              <PPDataRow
                key={record.id}
                record={record}
                isSelected={selectedIds.includes(record.id)}
                onToggleSelect={onToggleSelect}
              />
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {total > pageSize && (
        <div className="flex items-center justify-between p-4 border-t border-[var(--ff-border-light)]">
          <span className="text-sm text-[var(--ff-text-secondary)]">
            Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => onPageChange(Math.max(1, page - 1))}
              disabled={page === 1}
              className="px-3 py-1 text-sm bg-[var(--ff-bg-tertiary)] rounded disabled:opacity-50"
            >
              Previous
            </button>
            <button
              onClick={() => onPageChange(page + 1)}
              disabled={page * pageSize >= total}
              className="px-3 py-1 text-sm bg-[var(--ff-bg-tertiary)] rounded disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </>
  );
}
