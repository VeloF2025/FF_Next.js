/**
 * VerificationCheckRow - Single verification check result display
 */

'use client';

import React from 'react';
import { CheckCircle2, XCircle, AlertTriangle, Clock, AlertOctagon } from 'lucide-react';
import type { VerificationStatus } from '@/types/contractor-verification.types';
import { formatCostRands } from '@/lib/verificationCosts';

interface VerificationCheckRowProps {
  label: string;
  status: VerificationStatus;
  expected?: string | null;
  actual?: string | null;
  message: string;
  costCents?: number;
  onRun?: () => void;
}

const STATUS_CONFIG: Record<VerificationStatus, { icon: React.ReactNode; color: string }> = {
  passed: { icon: <CheckCircle2 className="h-4 w-4 text-green-400" />, color: 'text-green-400' },
  failed: { icon: <XCircle className="h-4 w-4 text-red-400" />, color: 'text-red-400' },
  warning: { icon: <AlertTriangle className="h-4 w-4 text-amber-400" />, color: 'text-amber-400' },
  pending: { icon: <Clock className="h-4 w-4 text-[var(--ff-text-tertiary)]" />, color: 'text-[var(--ff-text-tertiary)]' },
  error: { icon: <AlertOctagon className="h-4 w-4 text-red-400" />, color: 'text-red-400' },
};

export function VerificationCheckRow({ label, status, expected, actual, message, costCents, onRun }: VerificationCheckRowProps) {
  const config = STATUS_CONFIG[status];

  return (
    <div className="flex items-center justify-between py-2 px-2 rounded hover:bg-[var(--ff-bg-tertiary)]">
      <div className="flex items-center gap-2 flex-1 min-w-0">
        {config.icon}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-[var(--ff-text-primary)]">{label}</p>
          <p className={`text-xs ${config.color}`}>{message}</p>
          {expected && actual && expected !== actual && (
            <p className="text-xs text-[var(--ff-text-tertiary)] mt-0.5">
              Expected: <span className="font-mono">{expected}</span> | Got: <span className="font-mono">{actual}</span>
            </p>
          )}
        </div>
      </div>
      {status === 'pending' && onRun && (
        <button
          onClick={onRun}
          className="ml-2 inline-flex items-center gap-1 px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 whitespace-nowrap transition-colors"
        >
          Run Check {costCents ? `(${formatCostRands(costCents)})` : ''}
        </button>
      )}
    </div>
  );
}
