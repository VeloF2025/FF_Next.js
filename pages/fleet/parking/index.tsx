/**
 * /fleet/parking — overnight parking compliance results.
 *
 * Defaults to the last 7 days. The per-state counts sit above the table
 * because the useful question is rarely "what happened to vehicle X" but
 * "how many are in each state, and which of the three different people does
 * that make it a job for" (spec §6.3).
 */
import { useCallback, useEffect, useState } from 'react';

import { AppLayout } from '@/components/layout/AppLayout';
import { ModulePage } from '@/components/module-page';
import { fleetConfig } from '@/modules/navigation';
import { ComplianceTable } from '@/modules/fleet/parking/web/ComplianceTable';
import { PARKING_CHECK_RESULTS } from '@/modules/fleet/parking/types';
import type { ComplianceRow, ParkingCheckResult } from '@/modules/fleet/parking/types';

const RESULTS: readonly ParkingCheckResult[] = PARKING_CHECK_RESULTS;

const RESULT_LABEL: Record<ParkingCheckResult, string> = {
  compliant: 'Compliant',
  violation: 'Violation',
  unknown: 'Unknown',
  not_verifiable: 'No tracker',
  no_address: 'No address',
};

const inputCls =
  'px-3 py-2 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border)] rounded-lg text-sm text-[var(--ff-text-primary)]';

function sastToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg' }).format(new Date());
}

function daysAgo(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

export default function ParkingCompliancePage() {
  const today = sastToday();
  const [from, setFrom] = useState(daysAgo(today, 7));
  const [to, setTo] = useState(today);
  const [result, setResult] = useState<ParkingCheckResult | ''>('');
  const [rows, setRows] = useState<ComplianceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ from, to });
      if (result) params.set('result', result);
      const res = await fetch(`/api/fleet/parking/compliance?${params.toString()}`, {
        credentials: 'same-origin',
      });
      const payload = await res.json();
      if (!res.ok || payload?.success !== true) {
        throw new Error(payload?.error?.message ?? 'Could not load results');
      }
      setRows(payload.data.rows as ComplianceRow[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load results');
    } finally {
      setLoading(false);
    }
  }, [from, to, result]);

  useEffect(() => {
    void load();
  }, [load]);

  const counts = RESULTS.map((r) => ({
    result: r,
    count: rows.filter((row) => row.result === r).length,
  }));

  return (
    <AppLayout>
      <ModulePage config={fleetConfig} hideTabs>
        <div className="p-6 space-y-4">
          <div>
            <h1 className="text-xl font-semibold text-[var(--ff-text-primary)]">
              Parking compliance
            </h1>
            <p className="text-sm text-[var(--ff-text-secondary)]">
              Every active vehicle is checked at 20:00 SAST against the address its driver declared.
            </p>
          </div>

          <div className="flex flex-wrap gap-3 items-end">
            <label className="text-xs text-[var(--ff-text-secondary)]">
              From
              <input
                type="date"
                className={`${inputCls} block mt-1`}
                value={from}
                max={to}
                onChange={(e) => setFrom(e.target.value)}
              />
            </label>
            <label className="text-xs text-[var(--ff-text-secondary)]">
              To
              <input
                type="date"
                className={`${inputCls} block mt-1`}
                value={to}
                min={from}
                onChange={(e) => setTo(e.target.value)}
              />
            </label>
            <label className="text-xs text-[var(--ff-text-secondary)]">
              Result
              <select
                className={`${inputCls} block mt-1`}
                value={result}
                onChange={(e) => setResult(e.target.value as ParkingCheckResult | '')}
              >
                <option value="">All</option>
                {RESULTS.map((r) => (
                  <option key={r} value={r}>
                    {RESULT_LABEL[r]}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {counts.map(({ result: r, count }) => (
              <div
                key={r}
                className="border border-[var(--ff-border)] rounded-lg px-4 py-3"
              >
                <p className="text-xs text-[var(--ff-text-secondary)]">{RESULT_LABEL[r]}</p>
                <p className="text-lg font-semibold text-[var(--ff-text-primary)]">{count}</p>
              </div>
            ))}
          </div>

          {error && (
            <div className="border border-red-500/30 bg-red-500/10 rounded-lg px-4 py-3 text-sm text-red-300">
              {error}
            </div>
          )}

          <div className="border border-[var(--ff-border)] rounded-lg overflow-x-auto">
            {loading ? (
              <p className="text-sm text-[var(--ff-text-secondary)] px-4 py-6">Loading…</p>
            ) : (
              <ComplianceTable rows={rows} />
            )}
          </div>
        </div>
      </ModulePage>
    </AppLayout>
  );
}
