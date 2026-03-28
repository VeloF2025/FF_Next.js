/**
 * TrackerRow
 * Single editable/read-only row for the PON tracker table
 */

import type { FC } from 'react';
import type { TrackerRowData, TrackerRowValue, NumericField, DateField, BoolField, TextField } from './TrackerTypes';

const TODAY = new Date().toISOString().split('T')[0];

const cellCls = 'px-2 py-1 border-r border-[var(--ff-border-light)] align-top';
const inputCls =
  'w-full min-w-[60px] bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] rounded px-1 py-0.5 text-xs focus:outline-none focus:border-blue-500';
const readCls = 'text-[var(--ff-text-primary)] text-xs whitespace-nowrap';

interface Props {
  row: TrackerRowData;
  editing: boolean;
  onChange: (field: keyof TrackerRowData, value: TrackerRowValue) => void;
  onDelete: () => void;
}

const TrackerRow: FC<Props> = ({ row, editing, onChange, onDelete }) => {
  const num = (field: NumericField, readOnly = false) => {
    const val = row[field] as number | null;
    if (!editing || readOnly) return <span className={readCls}>{val ?? ''}</span>;
    return (
      <input
        type="number"
        className={inputCls}
        value={val ?? ''}
        min={0}
        onChange={e => onChange(field, e.target.value === '' ? null : Number(e.target.value))}
      />
    );
  };

  const date = (field: DateField) => {
    const val = row[field] as string | null;
    if (!editing) return <span className={readCls}>{val ?? ''}</span>;
    return (
      <input
        type="date"
        className={inputCls}
        value={val ?? ''}
        max={TODAY}
        onChange={e => onChange(field, e.target.value || null)}
      />
    );
  };

  const bool = (field: BoolField) => {
    const val = row[field] as boolean;
    if (!editing) return <span className={readCls}>{val ? '✓' : ''}</span>;
    return (
      <input
        type="checkbox"
        checked={val}
        onChange={e => onChange(field, e.target.checked)}
        className="w-4 h-4 cursor-pointer accent-blue-500"
      />
    );
  };

  const txt = (field: TextField, multiline = false) => {
    const val = row[field] as string | null;
    if (!editing) return <span className={`${readCls} whitespace-pre-wrap`}>{val ?? ''}</span>;
    if (multiline) {
      return (
        <textarea
          className={`${inputCls} resize-none`}
          rows={2}
          value={val ?? ''}
          onChange={e => onChange(field, e.target.value || null)}
        />
      );
    }
    return (
      <input
        type="text"
        className={inputCls}
        value={val ?? ''}
        onChange={e => onChange(field, e.target.value || null)}
      />
    );
  };

  return (
    <tr className="border-b border-[var(--ff-border-light)] hover:bg-[var(--ff-bg-tertiary)] transition-colors">
      <td className={cellCls}>{num('zoneNo', !row.isNew)}</td>
      <td className={cellCls}>{num('hldPon')}</td>
      <td className={cellCls}>{num('zPon')}</td>
      <td className={cellCls}>{txt('oltPort')}</td>
      <td className={cellCls}>{num('scopePoles')}</td>
      <td className={cellCls}>{num('scopeDrops')}</td>
      <td className={cellCls}>{date('polePermission')}</td>
      <td className={cellCls}>{num('polesPlanted')}</td>
      <td className={cellCls}>{date('cwcPolesDate')}</td>
      <td className={cellCls}>{date('cwcStringingDate')}</td>
      <td className={cellCls}>{date('readyForOptical')}</td>
      <td className={`${cellCls} text-center`}>{bool('cwcQaApproved')}</td>
      <td className={cellCls}>{date('opticalSplicingDate')}</td>
      <td className={cellCls}>{date('opticalSubmittedDate')}</td>
      <td className={cellCls}>{date('opticalActivatedDate')}</td>
      <td className={`${cellCls} text-center`}>{bool('atpQaApproved')}</td>
      <td className={cellCls}>{num('signUps')}</td>
      <td className={cellCls}>{num('homesPo')}</td>
      <td className={cellCls}>{num('homesRecon')}</td>
      <td className={cellCls}>{num('activated')}</td>
      <td className={cellCls}>{num('available')}</td>
      <td className={`${cellCls} min-w-[120px]`}>{txt('blockage', true)}</td>
      {editing && (
        <td className="px-2 py-1 text-center">
          <button
            type="button"
            onClick={onDelete}
            aria-label="Delete row"
            className="text-red-400 hover:text-red-300 text-xs font-bold px-1"
          >
            ✕
          </button>
        </td>
      )}
    </tr>
  );
};

export default TrackerRow;
