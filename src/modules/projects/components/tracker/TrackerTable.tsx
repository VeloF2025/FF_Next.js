/**
 * TrackerTable
 * Scrollable table with header, editable rows, and summary totals
 */

import type { FC } from 'react';
import type { TrackerRowData, TrackerRowValue } from './TrackerTypes';
import TrackerRow from './TrackerRow';

interface Props {
  rows: TrackerRowData[];
  editing: boolean;
  onChange: (id: string, field: keyof TrackerRowData, value: TrackerRowValue) => void;
  onDeleteRow: (id: string) => void;
}

const HEADERS = [
  'Zone No', 'HLD PON', 'Z-PON', 'OLT Port', 'Scope Poles', 'Scope Drops',
  'Pole Permission', 'Poles Planted', 'CWC Poles Date', 'CWC Stringing Date',
  'Ready for Optical', 'CWC QA', 'Optical Splicing', 'Optical Submitted',
  'Optical Activated', 'ATP QA', 'Sign-ups', 'Homes PO', 'Homes Recon',
  'Activated', 'Available', 'Blockage',
];

// Columns where footer shows sum (null = empty cell). Matches HEADERS index positions.
const FOOTER_FIELDS: Array<keyof TrackerRowData | null> = [
  null, null, null, null,
  'scopePoles', 'scopeDrops',
  null, 'polesPlanted',
  null, null, null, null,
  null, null, null, null,
  'signUps', 'homesPo', 'homesRecon', 'activated', 'available',
  null,
];

const SUM_FIELDS = FOOTER_FIELDS.filter((f): f is keyof TrackerRowData => f !== null);

const thCls =
  'px-2 py-2 text-left text-xs font-semibold text-[var(--ff-text-secondary)] whitespace-nowrap border-r border-[var(--ff-border-light)] last:border-r-0';
const tdSumCls =
  'px-2 py-1.5 text-xs font-semibold text-[var(--ff-text-primary)] border-r border-[var(--ff-border-light)]';

const TrackerTable: FC<Props> = ({ rows, editing, onChange, onDeleteRow }) => {
  const totals = SUM_FIELDS.reduce<Record<string, number>>((acc, field) => {
    acc[field as string] = rows.reduce((s, r) => s + (Number(r[field]) || 0), 0);
    return acc;
  }, {});

  const colSpan = HEADERS.length + (editing ? 1 : 0);

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full border-collapse">
        <thead>
          <tr className="bg-[var(--ff-bg-secondary)] border-b border-[var(--ff-border-light)]">
            {HEADERS.map(h => (
              <th key={h} className={thCls}>{h}</th>
            ))}
            {editing && (
              <th className={thCls} aria-label="Actions" />
            )}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td
                colSpan={colSpan}
                className="px-4 py-10 text-center text-sm text-[var(--ff-text-secondary)]"
              >
                No PON rows yet. Click &quot;Edit&quot; then &quot;Add Row&quot; to begin.
              </td>
            </tr>
          ) : (
            rows.map(row => (
              <TrackerRow
                key={row.id}
                row={row}
                editing={editing}
                onChange={(field, value) => onChange(row.id, field, value)}
                onDelete={() => onDeleteRow(row.id)}
              />
            ))
          )}
        </tbody>
        {rows.length > 0 && (
          <tfoot>
            <tr className="bg-[var(--ff-bg-secondary)] border-t-2 border-[var(--ff-border-light)]">
              {FOOTER_FIELDS.map((field, i) => (
                <td key={i} className={tdSumCls}>
                  {i === 0
                    ? <span className="text-[var(--ff-text-secondary)]">Totals</span>
                    : field !== null
                      ? totals[field as string] ?? ''
                      : ''}
                </td>
              ))}
              {editing && <td className={tdSumCls} />}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
};

export default TrackerTable;
