/**
 * Pulse signals strip for the Action Centre Overview (PRD-061 Phase E).
 *
 * Three cards: Pending Corrections / Open Exceptions / No-show Alerts.
 * Each fetches a single count from /api/staff/attendance-pulse-signals
 * and deep-links into the matching Pulse view (FR-ACTION-02/03/04).
 *
 * Hidden entirely when the API returns 403 — the cards are gated on
 * `people.staff.attendance.search` so a viewer without Pulse access
 * never sees them.
 */

import { useEffect, useState } from 'react';
import { AlertCircle, Activity, EyeOff } from 'lucide-react';
import { log } from '@/lib/logger';

interface Signals {
  pendingCorrections: number;
  openExceptions7d: number;
  noShowAlerts3d: number;
  threshold: { noShowDays: number; openExceptionsDays: number };
}

/** Deep-link for FR-ACTION-03 — search filtered to all known unresolved
 * exception kinds in the 7-day window. The exception canonical enum
 * lives in migration 310; if Phase C2 lights up new kinds, add them
 * here so the count and the deep-link stay in sync.
 */
const EXCEPTION_KINDS_DEEP_LINK = [
  'missing_clock_out',
  'geofence_mismatch',
  'clock_skew',
  'out_of_hours',
  'manual_override',
  'duplicate_entry',
  'vehicle_gps_mismatch',
  'forgotten_clock_out_retro',
].join(',');

export function PulseSignals() {
  const [data, setData] = useState<Signals | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/staff/attendance-pulse-signals', { credentials: 'same-origin' });
        if (cancelled) return;
        if (res.status === 403) {
          setForbidden(true);
          return;
        }
        const body = (await res.json()) as
          | { success: true; data: Signals }
          | { success: false; error?: { message?: string } };
        // The user can navigate away during the json parse; guard before
        // any setState so React 18 doesn't log a no-op warning.
        if (cancelled) return;
        if (!res.ok || body.success === false) {
          const msg = body.success === false ? body.error?.message : null;
          setError(msg ?? 'Could not load Pulse signals.');
          return;
        }
        setData(body.data);
      } catch (err) {
        if (cancelled) return;
        log.warn('[pulse-signals] fetch failed', err instanceof Error ? { message: err.message } : { err });
        setError('Network error loading Pulse signals.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (forbidden) return null;

  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2">
        <Activity className="w-4 h-4 text-emerald-400" />
        <h3 className="text-sm font-medium">Pulse signals</h3>
        <span className="text-xs text-[var(--ff-text-tertiary)]">
          Attendance follow-ups in your scope
        </span>
      </div>
      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-red-400 text-sm">
          {error}
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <SignalCard
          icon={<AlertCircle className="w-4 h-4 text-amber-400" />}
          label="Pending corrections"
          value={data?.pendingCorrections ?? null}
          sublabel="awaiting your review"
          href="/staff/attendance/corrections?status=pending"
          tone="amber"
          loading={loading}
        />
        <SignalCard
          icon={<AlertCircle className="w-4 h-4 text-red-400" />}
          label="Open exceptions"
          value={data?.openExceptions7d ?? null}
          sublabel={
            data
              ? `unresolved in last ${data.threshold.openExceptionsDays} days`
              : 'unresolved this week'
          }
          href={`/staff/attendance/search?dateRange=last_7d&exceptionKinds=${EXCEPTION_KINDS_DEEP_LINK}`}
          tone="red"
          loading={loading}
        />
        <SignalCard
          icon={<EyeOff className="w-4 h-4 text-neutral-300" />}
          label="No-show alerts"
          value={data?.noShowAlerts3d ?? null}
          sublabel={
            data
              ? `active staff with zero clock-ins in ${data.threshold.noShowDays} days`
              : 'active staff with no clock-in'
          }
          href="/staff/attendance/search?dateRange=last_7d&onlyActive=1"
          tone="neutral"
          loading={loading}
        />
      </div>
    </section>
  );
}

const TONE_CLASSES: Record<'red' | 'amber' | 'neutral', string> = {
  red: 'bg-red-500/10 border-red-500/20',
  amber: 'bg-amber-500/10 border-amber-500/20',
  neutral: 'bg-neutral-500/10 border-neutral-500/20',
};

function SignalCard({
  icon, label, value, sublabel, href, tone, loading,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | null;
  sublabel: string;
  href: string;
  tone: 'red' | 'amber' | 'neutral';
  loading: boolean;
}) {
  const card = (
    <div className={`rounded-lg border ${TONE_CLASSES[tone]} px-3 py-2 hover:brightness-110 transition`}>
      <div className="flex items-center gap-2 text-xs text-[var(--ff-text-secondary)]">
        {icon}
        <span>{label}</span>
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">
        {loading ? <span className="text-[var(--ff-text-tertiary)]">…</span>
                 : value === null ? '—'
                 : value.toLocaleString('en-ZA')}
      </div>
      <div className="text-xs text-[var(--ff-text-tertiary)]">{sublabel}</div>
    </div>
  );
  // Anchor only when there's a real value > 0; a zero-count card has
  // nothing to show on click and the dead end is worse than the
  // colour change implying clickability.
  if (value !== null && value > 0) {
    return <a href={href} className="block">{card}</a>;
  }
  return card;
}
