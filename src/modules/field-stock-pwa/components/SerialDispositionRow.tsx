'use client';

/**
 * SerialDispositionRow — single row for inspecting one return line.
 *
 * Renders:
 *   - serial number + stock item name
 *   - 3-button condition radio (good / damaged / non_functional)
 *   - 3-button disposition radio (restock / repair / scrap)
 *   - notes textarea, only when disposition is 'repair' or 'scrap'
 *
 * Fully controlled — caller owns all state, passes onChange for every field.
 */

import {
  CONDITION_OPTIONS,
  type ReturnCondition,
} from '@/modules/field-stock-pwa/lib/conditionOptions';
import {
  DISPOSITION_OPTIONS,
  type ReturnDisposition,
} from '@/modules/field-stock-pwa/lib/dispositionOptions';

// =============================================================================
// Props
// =============================================================================

export interface SerialDispositionRowProps {
  lineId: string;
  serialNumber: string;
  stockItemName: string;
  condition: ReturnCondition | null;
  disposition: ReturnDisposition | null;
  notes: string;
  onChange: (next: {
    condition: ReturnCondition | null;
    disposition: ReturnDisposition | null;
    notes: string;
  }) => void;
}

// =============================================================================
// Component
// =============================================================================

export function SerialDispositionRow({
  lineId,
  serialNumber,
  stockItemName,
  condition,
  disposition,
  notes,
  onChange,
}: SerialDispositionRowProps) {
  const notesId = `notes-${lineId}`;
  const showNotes = disposition === 'repair' || disposition === 'scrap';

  return (
    <div className="rounded-lg bg-neutral-900 border border-neutral-800 p-4 space-y-4">
      {/* Header: serial + item name */}
      <div>
        <p className="text-sm font-semibold text-white">{serialNumber}</p>
        <p className="text-xs text-neutral-400 mt-0.5">{stockItemName}</p>
      </div>

      {/* Condition radio group */}
      <div className="space-y-2">
        <p className="text-xs font-medium text-neutral-400 uppercase tracking-wide">Condition</p>
        <div className="flex gap-2 flex-wrap" role="radiogroup" aria-label="Condition">
          {CONDITION_OPTIONS.map((opt) => {
            const isSelected = condition === opt.code;
            return (
              <button
                key={opt.code}
                type="button"
                role="radio"
                aria-checked={isSelected}
                onClick={() =>
                  onChange({ condition: opt.code, disposition, notes })
                }
                className={[
                  'px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors',
                  isSelected
                    ? 'bg-emerald-700 border-emerald-600 text-white'
                    : 'bg-neutral-800 border-neutral-700 text-neutral-300 hover:bg-neutral-700',
                ].join(' ')}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Disposition radio group */}
      <div className="space-y-2">
        <p className="text-xs font-medium text-neutral-400 uppercase tracking-wide">Disposition</p>
        <div className="flex gap-2 flex-wrap" role="radiogroup" aria-label="Disposition">
          {DISPOSITION_OPTIONS.map((opt) => {
            const isSelected = disposition === opt.code;
            return (
              <button
                key={opt.code}
                type="button"
                role="radio"
                aria-checked={isSelected}
                onClick={() =>
                  onChange({ condition, disposition: opt.code, notes })
                }
                className={[
                  'px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors',
                  isSelected
                    ? 'bg-sky-700 border-sky-600 text-white'
                    : 'bg-neutral-800 border-neutral-700 text-neutral-300 hover:bg-neutral-700',
                ].join(' ')}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Notes textarea — shown only for repair / scrap */}
      {showNotes && (
        <div className="space-y-1.5">
          <label htmlFor={notesId} className="text-xs font-medium text-neutral-400 uppercase tracking-wide">
            Notes
            <span className="ml-1 text-neutral-600 font-normal normal-case">(required for {disposition})</span>
          </label>
          <textarea
            id={notesId}
            value={notes}
            onChange={(e) =>
              onChange({ condition, disposition, notes: e.target.value.slice(0, 500) })
            }
            maxLength={500}
            rows={2}
            placeholder={`Reason for ${disposition}…`}
            className="w-full rounded-lg bg-neutral-800 border border-neutral-700 text-white text-sm placeholder:text-neutral-600 px-3 py-2 focus:outline-none focus:border-neutral-500 resize-none"
          />
          <p className="text-right text-xs text-neutral-600">{notes.length}/500</p>
        </div>
      )}
    </div>
  );
}
