/**
 * PPDataTableHead — shared table header for PP Data tables.
 * Used by both PPRecordTable and PPDataCardModal.
 */

'use client';

import { CheckSquare, Square } from 'lucide-react';

const TABLE_HEADERS = [
  'Serial', 'Project', 'Status', 'DR', 'Zone', 'PON', 'OLT Port', 'PP',
  'Located', 'Activation', 'Install Team', 'WA Technician', 'Source', 'Ticket', 'Priority',
] as const;

export function PPDataTableHead({
  showSelectAll,
  allChecked,
  onToggleAll,
}: {
  showSelectAll: boolean;
  allChecked: boolean;
  onToggleAll: () => void;
}) {
  return (
    <thead className="bg-[var(--ff-bg-tertiary)]">
      <tr>
        <th className="w-12 py-3 px-4">
          {showSelectAll && (
            <button
              onClick={onToggleAll}
              className="text-[var(--ff-text-secondary)] hover:text-[var(--ff-accent)]"
              aria-label="Select all on page"
            >
              {allChecked ? (
                <CheckSquare className="w-5 h-5 text-[var(--ff-accent)]" />
              ) : (
                <Square className="w-5 h-5" />
              )}
            </button>
          )}
        </th>
        {TABLE_HEADERS.map(h => (
          <th key={h} className="text-left py-3 px-4 text-[var(--ff-text-secondary)] font-medium">{h}</th>
        ))}
        <th className="text-right py-3 px-4 text-[var(--ff-text-secondary)] font-medium">Actions</th>
      </tr>
    </thead>
  );
}
