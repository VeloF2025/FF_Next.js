/**
 * Permit status pill — shared across the list, detail and per-project view.
 * Renders the EFFECTIVE status (expired permits show red).
 */

import { FileClock, CheckCircle2, Play, Archive, XCircle, Ban } from 'lucide-react';
import type { PermitStatus } from '@/modules/health-safety/types/permit.types';

const CONFIG: Record<PermitStatus, { label: string; className: string; Icon: typeof FileClock }> = {
  requested: { label: 'Requested', className: 'bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)]', Icon: FileClock },
  approved: { label: 'Approved', className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400', Icon: CheckCircle2 },
  active: { label: 'Active', className: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400', Icon: Play },
  closed: { label: 'Closed', className: 'bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-tertiary)]', Icon: Archive },
  expired: { label: 'Expired', className: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400', Icon: XCircle },
  rejected: { label: 'Rejected', className: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400', Icon: Ban },
};

export function PermitStatusBadge({ status }: { status: PermitStatus }) {
  const cfg = CONFIG[status] ?? CONFIG.requested;
  const { Icon } = cfg;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded whitespace-nowrap ${cfg.className}`}>
      <Icon className="w-3 h-3" />
      {cfg.label}
    </span>
  );
}
