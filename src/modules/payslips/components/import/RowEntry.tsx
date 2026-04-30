import React from 'react';

import type { PreviewRow, StaffOption } from '@/modules/payslips/types';

import { ActionCell } from './ActionCell';
import { StatusBadge } from './Badge';
import { formatRand } from './formatters';
import type { CasualDraft, ManualMapping, Resolution } from './types';

export function RowEntry({
  row,
  manual,
  casual,
  skipped,
  resolution,
  forceReimport,
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
  resolution: Resolution;
  forceReimport: boolean;
  staffOptions: StaffOption[];
  usedStaffIds: Set<string>;
  readOnly: boolean;
  onSetMapping: (page: number, staffId: string | null, savePayrollCode: boolean) => void;
  onSetCasual: (page: number, draft: CasualDraft | null) => void;
  onToggleSkip: (page: number) => void;
}) {
  let rowClass = 'text-neutral-200';
  if (resolution?.kind === 'skip') rowClass += ' bg-neutral-900/40 opacity-60';
  else if (!resolution) rowClass += ' bg-red-950/30';
  else if (resolution.kind === 'casual') rowClass += ' bg-blue-950/30';

  return (
    <tr className={rowClass}>
      <td className="py-1.5 pr-3 text-xs text-neutral-500">{row.page}</td>
      <td className="py-1.5 pr-3 font-mono text-xs">{row.empCode ?? '—'}</td>
      <td className="py-1.5 pr-3 text-xs">{row.empName ?? '—'}</td>
      <td className="py-1.5 pr-3 text-right tabular-nums">
        {row.totalEarningsCents !== null ? formatRand(row.totalEarningsCents) : '—'}
      </td>
      <td className="py-1.5 pr-3 text-right tabular-nums">
        {row.totalDeductionsCents !== null ? formatRand(row.totalDeductionsCents) : '—'}
      </td>
      <td className="py-1.5 pr-3 text-right tabular-nums font-semibold">
        {row.nettPayCents !== null ? formatRand(row.nettPayCents) : '—'}
      </td>
      <td className="py-1.5 pr-3">
        <StatusBadge
          row={row}
          forceReimport={forceReimport}
          skipped={skipped}
          casual={Boolean(casual)}
        />
      </td>
      <td className="py-1.5 pr-3 align-top">
        <ActionCell
          row={row}
          manual={manual}
          casual={casual}
          skipped={skipped}
          staffOptions={staffOptions}
          usedStaffIds={usedStaffIds}
          readOnly={readOnly}
          onSetMapping={onSetMapping}
          onSetCasual={onSetCasual}
          onToggleSkip={onToggleSkip}
        />
      </td>
    </tr>
  );
}
