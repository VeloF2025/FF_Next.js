import React from 'react';

import type { PreviewRow } from '@/modules/payslips/types';

export type BadgeTone = 'green' | 'amber' | 'red' | 'neutral' | 'blue';

const TONE_CLASS: Record<BadgeTone, string> = {
  green: 'bg-emerald-900/50 text-emerald-200 border-emerald-700',
  amber: 'bg-amber-900/50 text-amber-100 border-amber-700',
  red: 'bg-red-900/50 text-red-100 border-red-700',
  neutral: 'bg-neutral-800 text-neutral-300 border-neutral-700',
  blue: 'bg-blue-900/50 text-blue-100 border-blue-700',
};

export function Badge({
  tone,
  children,
  title,
}: {
  tone: BadgeTone;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <span
      className={`inline-block rounded-md border px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${TONE_CLASS[tone]}`}
      title={title}
    >
      {children}
    </span>
  );
}

export function StatusBadge({
  row,
  forceReimport,
  skipped,
  casual,
}: {
  row: PreviewRow;
  forceReimport: boolean;
  skipped: boolean;
  casual: boolean;
}) {
  if (skipped) return <Badge tone="neutral">Skipped</Badge>;
  if (casual) return <Badge tone="blue">Will create casual</Badge>;
  if (
    forceReimport &&
    (row.rowState === 'already_imported' || row.rowState === 'matched_changed')
  ) {
    return <Badge tone="amber">Will overwrite</Badge>;
  }
  switch (row.rowState) {
    case 'new':
      return <Badge tone="green">New</Badge>;
    case 'already_imported':
      return (
        <Badge tone="neutral" title={row.existingPayslip?.importedAt}>
          Already imported
        </Badge>
      );
    case 'matched_changed':
      return <Badge tone="amber">Amounts changed</Badge>;
    case 'previously_skipped':
      return <Badge tone="amber">Previously skipped</Badge>;
    case 'unmatched':
    default:
      return <Badge tone="red">Unmatched</Badge>;
  }
}
