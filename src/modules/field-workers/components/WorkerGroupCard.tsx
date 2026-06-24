/**
 * WorkerGroupCard — presentational card for a single worker's time entries.
 *
 * Renders the worker name/role header and a table of WorkerTimeRow entries.
 * Extracted from TimeTab to keep both components under 200 lines.
 */

import { type FieldAttendanceRow } from '../api';
import { WorkerTimeRow } from './WorkerTimeRow';

export interface WorkerGroup {
  staff_id:   string;
  staff_name: string;
  role:       string;
  rows:       FieldAttendanceRow[];
}

interface WorkerGroupCardProps {
  group: WorkerGroup;
  /** Propagated to each WorkerTimeRow to re-fetch after an adjustment. */
  onAdjusted: () => void;
}

export function WorkerGroupCard({ group, onAdjusted }: WorkerGroupCardProps) {
  return (
    <div className="border border-neutral-800 rounded overflow-x-auto">
      {/* Group header */}
      <div className="px-3 py-2 bg-neutral-900 border-b border-neutral-800 flex items-center gap-2">
        <span className="font-medium text-neutral-100 text-sm">{group.staff_name}</span>
        <span className="text-xs text-neutral-500 capitalize">{group.role}</span>
      </div>

      {/* Entries table */}
      <table className="min-w-full text-sm">
        <thead className="bg-neutral-900/60 text-neutral-400">
          <tr>
            <th className="text-left px-3 py-1.5 font-medium text-xs">Date</th>
            <th className="text-left px-3 py-1.5 font-medium text-xs">Clock in</th>
            <th className="text-left px-3 py-1.5 font-medium text-xs">Clock out</th>
            <th className="text-left px-3 py-1.5 font-medium text-xs">Hours</th>
            <th className="text-left px-3 py-1.5 font-medium text-xs">Status</th>
            <th className="px-3 py-1.5" />
          </tr>
        </thead>
        <tbody>
          {group.rows.map((row) => (
            <WorkerTimeRow
              key={row.entry_id}
              row={row}
              onAdjusted={onAdjusted}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
