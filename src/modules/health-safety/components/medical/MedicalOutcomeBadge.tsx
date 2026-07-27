/**
 * Medical fitness verdict pill — the outcome a training record could not carry.
 * Expiry status is rendered separately by CompetencyBadge; the two are
 * independent (a current certificate can still say "unfit").
 */

import { CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';
import {
  MEDICAL_OUTCOMES,
  type MedicalOutcome,
} from '@/modules/health-safety/types/medical.types';

const CONFIG: Record<MedicalOutcome, { className: string; Icon: typeof CheckCircle2 }> = {
  fit: {
    className: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
    Icon: CheckCircle2,
  },
  fit_with_restriction: {
    className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    Icon: AlertTriangle,
  },
  unfit: {
    className: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
    Icon: XCircle,
  },
};

export function MedicalOutcomeBadge({ outcome }: { outcome: MedicalOutcome }) {
  const cfg = CONFIG[outcome] ?? CONFIG.fit;
  const label = MEDICAL_OUTCOMES[outcome]?.label ?? outcome;
  const { Icon } = cfg;
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded whitespace-nowrap ${cfg.className}`}
    >
      <Icon className="w-3 h-3" />
      {label}
    </span>
  );
}
