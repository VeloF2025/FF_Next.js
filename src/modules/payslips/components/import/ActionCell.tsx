import React from 'react';

import { SearchableStaffSelect } from '@/components/forms/SearchableStaffSelect';

import type { PreviewRow, StaffOption } from '@/modules/payslips/types';

import { CasualForm, guessFirstName, guessLastName } from './CasualForm';
import type { CasualDraft, ManualMapping } from './types';

export function ActionCell({
  row,
  manual,
  casual,
  skipped,
  staffOptions,
  usedStaffIds,
  readOnly,
  onSetMapping,
  onSetCasual,
  onToggleSkip,
}: {
  row: PreviewRow;
  manual: ManualMapping | undefined;
  casual: CasualDraft | undefined;
  skipped: boolean;
  staffOptions: StaffOption[];
  usedStaffIds: Set<string>;
  readOnly: boolean;
  onSetMapping: (page: number, staffId: string | null, savePayrollCode: boolean) => void;
  onSetCasual: (page: number, draft: CasualDraft | null) => void;
  onToggleSkip: (page: number) => void;
}) {
  const autoMatched = row.match.staffId !== null && row.match.method !== 'unmatched';

  if (readOnly) {
    if (skipped) return <span className="text-xs text-neutral-400">Skipped</span>;
    if (casual)
      return (
        <span className="text-xs text-blue-200">
          Created {casual.firstName} {casual.lastName}
        </span>
      );
    if (manual)
      return (
        <span className="text-xs text-emerald-300">
          {staffOptions.find((s) => s.id === manual.staffId)?.fullName ?? '—'}
        </span>
      );
    return <span className="text-xs text-emerald-300">{row.match.staffName ?? '—'}</span>;
  }

  if (skipped) {
    return (
      <button
        type="button"
        onClick={() => onToggleSkip(row.page)}
        className="text-xs rounded-md border border-neutral-700 px-2 py-1 text-neutral-300 hover:border-neutral-500"
      >
        Undo skip
      </button>
    );
  }

  if (casual) {
    return (
      <CasualForm
        empCode={row.empCode}
        empName={row.empName}
        draft={casual}
        onChange={(draft) => onSetCasual(row.page, draft)}
        onCancel={() => onSetCasual(row.page, null)}
      />
    );
  }

  if (autoMatched && !manual) {
    return (
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <span className="text-xs text-emerald-300">{row.match.staffName}</span>
          <span className="text-[10px] text-neutral-500">
            {row.match.method.replace('_', ' ')}
            {row.match.method === 'name_fuzzy' &&
              ` · ${(row.match.confidence * 100).toFixed(0)}%`}
          </span>
        </div>
        <button
          type="button"
          onClick={() => onToggleSkip(row.page)}
          title="Skip this row"
          className="text-[10px] text-neutral-500 hover:text-neutral-300"
        >
          skip
        </button>
      </div>
    );
  }

  // Hide already-used staff but always keep the row's own selection visible.
  const hideIds = new Set(usedStaffIds);
  if (manual?.staffId) hideIds.delete(manual.staffId);
  return (
    <div className="flex flex-col gap-1.5">
      <SearchableStaffSelect
        value={manual?.staffId ?? null}
        options={staffOptions}
        excludeIds={hideIds}
        onChange={(staffId) =>
          onSetMapping(row.page, staffId, manual?.savePayrollCode ?? true)
        }
      />
      <div className="flex items-center gap-2 text-[10px]">
        {manual && row.empCode && (
          <label className="flex items-center gap-1 text-neutral-400">
            <input
              type="checkbox"
              checked={manual.savePayrollCode}
              onChange={(e) =>
                onSetMapping(row.page, manual.staffId, e.target.checked)
              }
              className="h-3 w-3"
            />
            Remember <code className="text-neutral-300">{row.empCode}</code>
          </label>
        )}
        {!manual && (
          <button
            type="button"
            onClick={() =>
              onSetCasual(row.page, {
                page: row.page,
                firstName: guessFirstName(row.empName) ?? '',
                lastName: guessLastName(row.empName) ?? '',
                email: '',
                phone: '',
                employmentType: 'casual',
              })
            }
            className="text-blue-400 hover:text-blue-300"
          >
            + create casual
          </button>
        )}
        <button
          type="button"
          onClick={() => onToggleSkip(row.page)}
          className="text-neutral-500 hover:text-neutral-300"
        >
          skip
        </button>
      </div>
    </div>
  );
}
