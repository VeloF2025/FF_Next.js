/**
 * SerialRecheckPanel
 *
 * Displays the Re-analyse Serial button and result card in the UnifiedReviewCard
 * Feedback tab. Only visible when the drop has a serial mismatch.
 *
 * Status: WORKING
 */

'use client';

import { useState } from 'react';
import { RefreshCw, CheckCircle, AlertTriangle, XCircle, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { log } from '@/lib/logger';
import type { RecheckOutcome, RecheckSerialType } from '../services/serialRecheckService';

interface RecheckResult {
  outcome: RecheckOutcome;
  serialType: RecheckSerialType;
  secondPassSerial: string | null;
  confidence: number | null;
  waMessageSent: boolean;
  learningLogged: boolean;
}

interface SerialRecheckPanelProps {
  dropNumber: string;
  /** Whether a serial mismatch exists for this drop — controls visibility */
  hasMismatch: boolean;
  /** ISO timestamp of last recheck, if any */
  lastRecheckAt?: string | null;
  /** Outcome of last recheck, if any */
  lastRecheckOutcome?: RecheckOutcome | null;
}

const OUTCOME_CONFIG: Record<RecheckOutcome, {
  icon: typeof CheckCircle;
  bg: string;
  border: string;
  text: string;
  label: string;
}> = {
  correction: {
    icon: CheckCircle,
    bg: 'bg-green-50 dark:bg-green-900/20',
    border: 'border-green-200 dark:border-green-800',
    text: 'text-green-800 dark:text-green-200',
    label: '1Map serial confirmed. Correction sent to group.',
  },
  verify: {
    icon: AlertTriangle,
    bg: 'bg-amber-50 dark:bg-amber-900/20',
    border: 'border-amber-200 dark:border-amber-800',
    text: 'text-amber-800 dark:text-amber-200',
    label: "Couldn't confirm. Verify message sent to group.",
  },
  unclear: {
    icon: XCircle,
    bg: 'bg-red-50 dark:bg-red-900/20',
    border: 'border-red-200 dark:border-red-800',
    text: 'text-red-800 dark:text-red-200',
    label: 'Photo unclear. Verify message sent to group.',
  },
};

export function SerialRecheckPanel({
  dropNumber,
  hasMismatch,
  lastRecheckAt,
  lastRecheckOutcome,
}: SerialRecheckPanelProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<RecheckResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!hasMismatch) return null;

  const recentRecheckAt = result ? new Date().toISOString() : lastRecheckAt;
  const recentOutcome = result?.outcome ?? lastRecheckOutcome;

  const isRecentlyRechecked =
    recentRecheckAt &&
    Date.now() - new Date(recentRecheckAt).getTime() < 24 * 60 * 60 * 1000;

  const handleRecheck = async (force = false) => {
    if (isLoading) return;
    if (isRecentlyRechecked && !force) return;

    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/activate/recheck-serial-mismatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dropNumber, source: 'manual' }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: { message?: string } };
        throw new Error(data.error?.message ?? 'Recheck failed');
      }

      const { data } = await res.json() as { data: RecheckResult };
      setResult(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setError(msg);
      log.error('SerialRecheckPanel fetch failed', { dropNumber, error: err }, 'SerialRecheckPanel');
    } finally {
      setIsLoading(false);
    }
  };

  const displayOutcome = result?.outcome ?? (isRecentlyRechecked ? recentOutcome : null);
  const config = displayOutcome ? OUTCOME_CONFIG[displayOutcome] : null;
  const Icon = config?.icon ?? CheckCircle;

  return (
    <div className="border border-border rounded-lg p-4 space-y-3 bg-muted/30">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-foreground">Serial Re-analysis</h4>
        <span className="text-xs text-muted-foreground">⚠️ Mismatch detected</span>
      </div>

      {config && (
        <div className={`flex items-start gap-2 p-3 rounded-md border ${config.bg} ${config.border}`}>
          <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${config.text}`} />
          <div className="flex-1">
            <p className={`text-sm font-medium ${config.text}`}>{config.label}</p>
            {recentRecheckAt && (
              <p className="text-xs text-muted-foreground mt-0.5">
                {new Date(recentRecheckAt).toLocaleString()}
                {isRecentlyRechecked && !result && (
                  <button
                    onClick={() => { void handleRecheck(true); }}
                    className="ml-2 text-blue-600 dark:text-blue-400 hover:underline"
                    disabled={isLoading}
                  >
                    Re-run
                  </button>
                )}
              </p>
            )}
          </div>
        </div>
      )}

      {error && (
        <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md">
          <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
        </div>
      )}

      {!isRecentlyRechecked && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => { void handleRecheck(false); }}
          disabled={isLoading}
          className="w-full"
        >
          {isLoading ? (
            <>
              <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
              Re-analysing…
            </>
          ) : (
            <>
              <RotateCcw className="h-4 w-4 mr-2" />
              Re-analyse Serial
            </>
          )}
        </Button>
      )}
    </div>
  );
}
