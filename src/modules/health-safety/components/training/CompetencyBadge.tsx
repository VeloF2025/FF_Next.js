/**
 * Competency status pill — shared across the training list, expiring dashboard
 * and per-project gap matrix so the vocabulary and colours stay consistent.
 */

import { CheckCircle2, AlertTriangle, XCircle, MinusCircle } from 'lucide-react';

export type CompetencyStatus = 'current' | 'expiring_soon' | 'expired' | 'missing';

const CONFIG: Record<CompetencyStatus, { label: string; className: string; Icon: typeof CheckCircle2 }> = {
  current: {
    label: 'Current',
    className: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
    Icon: CheckCircle2,
  },
  expiring_soon: {
    label: 'Expiring soon',
    className: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
    Icon: AlertTriangle,
  },
  expired: {
    label: 'Expired',
    className: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
    Icon: XCircle,
  },
  missing: {
    label: 'Missing',
    className: 'bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-tertiary)]',
    Icon: MinusCircle,
  },
};

export function CompetencyBadge({ status }: { status: CompetencyStatus }) {
  const cfg = CONFIG[status] ?? CONFIG.missing;
  const { Icon } = cfg;
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded whitespace-nowrap ${cfg.className}`}
    >
      <Icon className="w-3 h-3" />
      {cfg.label}
    </span>
  );
}
