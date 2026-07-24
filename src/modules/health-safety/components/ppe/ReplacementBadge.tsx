/**
 * PPE replacement-status pill — shared across the issuance list, detail and the
 * per-project outstanding view.
 */

import { CheckCircle2, AlertTriangle, XCircle, MinusCircle } from 'lucide-react';
import type { PPEReplacementStatus } from '@/modules/health-safety/types/ppe.types';

const CONFIG: Record<PPEReplacementStatus, { label: string; className: string; Icon: typeof CheckCircle2 }> = {
  ok: { label: 'OK', className: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400', Icon: CheckCircle2 },
  due_soon: { label: 'Due soon', className: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400', Icon: AlertTriangle },
  overdue: { label: 'Overdue', className: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400', Icon: XCircle },
  no_schedule: { label: 'No schedule', className: 'bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-tertiary)]', Icon: MinusCircle },
};

export function ReplacementBadge({ status }: { status: PPEReplacementStatus }) {
  const cfg = CONFIG[status] ?? CONFIG.no_schedule;
  const { Icon } = cfg;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded whitespace-nowrap ${cfg.className}`}>
      <Icon className="w-3 h-3" />
      {cfg.label}
    </span>
  );
}
