/**
 * Action Centre — Overview tab
 *
 * RFC Phase 5 slice 1. Headline counts + per-note breakdown + anomalies +
 * last rule engine run. Extracted from the page file so the sub-tab router
 * can mount it next to other tabs.
 */

import { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle, Clock, FileText, Ticket as TicketIcon, TrendingUp } from 'lucide-react';
import { PulseSignals } from './PulseSignals';

interface Overview {
  generatedAt: string;
  deductions: {
    latestWeek: string | null;
    openByNote: Record<string, number>;
    ticketed: number;
    resolvedThisMonth: number;
    disputing: number;
  };
  preProv: { outstanding: number; withTicket: number; resolvedThisMonth: number };
  tickets: { open: number; autoClosedToday: number };
  anomalies: { fixedStillBilled: number; persistentNote: number };
  recentRuleRun: {
    startedAt: string;
    eventsProcessed: number;
    actionsTaken: number;
    dryRun: boolean;
  } | null;
}

const NOTE_LABELS: Record<string, { label: string; sublabel: string }> = {
  note1: { label: 'N1',  sublabel: 'Lower than -26 dB' },
  note2: { label: 'N2',  sublabel: 'No Field App entry' },
  note3: { label: 'N3',  sublabel: 'Degraded (monitor)' },
  note4: { label: 'N4',  sublabel: 'SN ≠ Drop on OLT' },
  note5: { label: 'N5',  sublabel: 'Fibre break / offline' },
};

export function OverviewTab() {
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch('/api/activate/action-centre/overview');
        const j = await res.json();
        if (cancelled) return;
        if (j.success) setData(j.data as Overview);
        else setError(j.error?.message ?? 'Failed to load overview');
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load overview');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-6">
      <p className="text-sm text-[var(--ff-text-tertiary)]">
        Unified view of non-invoiceables, pre-provisioned, tickets and anomalies.
        Data for the latest billing week{data?.deductions.latestWeek ? ` (ending ${data.deductions.latestWeek})` : ''}.
      </p>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Headline counts */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <HeadlineCard
          icon={<AlertCircle className="w-4 h-4 text-red-400" />}
          label="Open deductions"
          value={data ? Object.values(data.deductions.openByNote).reduce((a, b) => a + b, 0) : null}
          sublabel="this week across N1/N2/N4/N5"
          tone="red"
          loading={loading}
          href="/activate/action-centre?tab=items&source=deduction"
        />
        <HeadlineCard
          icon={<Clock className="w-4 h-4 text-amber-400" />}
          label="Pre-Prov outstanding"
          value={data?.preProv.outstanding ?? null}
          sublabel={data ? `${data.preProv.withTicket} have an open ticket` : 'Pre-provisioned, not yet resolved'}
          tone="amber"
          loading={loading}
          href="/activate/action-centre?tab=items&source=pre_prov"
        />
        <HeadlineCard
          icon={<TicketIcon className="w-4 h-4 text-blue-400" />}
          label="Open tickets"
          value={data?.tickets.open ?? null}
          sublabel={data ? `${data.tickets.autoClosedToday} auto-closed today` : 'across all categories'}
          tone="blue"
          loading={loading}
          href="/noc/tickets"
        />
        <HeadlineCard
          icon={<CheckCircle className="w-4 h-4 text-green-400" />}
          label="Resolved this month"
          value={data ? data.deductions.resolvedThisMonth + data.preProv.resolvedThisMonth : null}
          sublabel={data ? `${data.deductions.resolvedThisMonth} deductions · ${data.preProv.resolvedThisMonth} PPs` : ''}
          tone="green"
          loading={loading}
        />
      </div>

      {/* Deductions by note */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-medium text-[var(--ff-text-secondary)]">Open deductions by note</h3>
          <a
            href="/activate/data-sync?group=billing&tab=summary"
            className="text-xs text-blue-400 hover:underline inline-flex items-center gap-1"
          >
            Go to Billing <span aria-hidden="true">↗</span>
          </a>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
          {Object.entries(NOTE_LABELS).map(([key, meta]) => (
            <MiniCard
              key={key}
              label={meta.label}
              sublabel={meta.sublabel}
              value={data ? (data.deductions.openByNote[key] ?? 0) : null}
              loading={loading}
              href={`/activate/action-centre?tab=items&source=deduction&note=${key}`}
            />
          ))}
        </div>
      </section>

      {/* Anomalies + rule engine status */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <section className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="w-4 h-4 text-yellow-400" />
            <h3 className="text-sm font-medium text-[var(--ff-text-secondary)]">Anomalies (last 7 days)</h3>
          </div>
          <dl className="grid grid-cols-2 gap-3">
            <MiniCard
              label="Fixed but still billed"
              sublabel="dispute candidates"
              value={data?.anomalies.fixedStillBilled ?? null}
              loading={loading}
            />
            <MiniCard
              label="Persistent note"
              sublabel="≥3 consecutive weeks"
              value={data?.anomalies.persistentNote ?? null}
              loading={loading}
            />
          </dl>
        </section>

        <section className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <FileText className="w-4 h-4 text-blue-400" />
            <h3 className="text-sm font-medium text-[var(--ff-text-secondary)]">Last rule engine run</h3>
          </div>
          {loading ? (
            <p className="text-sm text-[var(--ff-text-tertiary)]">Loading…</p>
          ) : data?.recentRuleRun ? (
            <div className="text-sm space-y-1">
              <p className="text-[var(--ff-text-primary)]">
                {new Date(data.recentRuleRun.startedAt).toLocaleString('en-ZA', {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                })}
                {data.recentRuleRun.dryRun && (
                  <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-yellow-500/20 text-yellow-400 uppercase tracking-wide">
                    dry-run
                  </span>
                )}
              </p>
              <p className="text-xs text-[var(--ff-text-tertiary)]">
                {data.recentRuleRun.eventsProcessed} event(s) processed ·{' '}
                {data.recentRuleRun.actionsTaken} action(s) taken
              </p>
            </div>
          ) : (
            <p className="text-sm text-[var(--ff-text-tertiary)]">No runs yet.</p>
          )}
        </section>
      </div>

      <PulseSignals />
    </div>
  );
}

// ─── Card components ─────────────────────────────────────────────────────────

const TONE_CLASSES: Record<'red' | 'amber' | 'blue' | 'green', string> = {
  red: 'bg-red-500/10 border-red-500/20',
  amber: 'bg-amber-500/10 border-amber-500/20',
  blue: 'bg-blue-500/10 border-blue-500/20',
  green: 'bg-green-500/10 border-green-500/20',
};

function HeadlineCard({
  icon,
  label,
  value,
  sublabel,
  tone,
  loading,
  href,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | null;
  sublabel: string;
  tone: keyof typeof TONE_CLASSES;
  loading: boolean;
  href?: string;
}) {
  const body = (
    <>
      <div className="flex items-center gap-2 mb-1">
        {icon}
        <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
      </div>
      <p className="text-3xl font-bold text-[var(--ff-text-primary)] tabular-nums">
        {loading ? '—' : (value ?? 0).toLocaleString()}
      </p>
      <p className="text-xs text-[var(--ff-text-tertiary)] mt-1">{sublabel}</p>
    </>
  );

  const className = `${TONE_CLASSES[tone]} border rounded-lg p-4 block ${href ? 'hover:bg-opacity-80 transition-colors' : ''}`;
  if (href) {
    return <a href={href} className={className}>{body}</a>;
  }
  return <div className={className}>{body}</div>;
}

function MiniCard({
  label,
  sublabel,
  value,
  loading,
  href,
}: {
  label: string;
  sublabel: string;
  value: number | null;
  loading: boolean;
  href?: string;
}) {
  const body = (
    <>
      <p className="text-xs font-medium uppercase tracking-wide text-[var(--ff-text-tertiary)]">
        {label}
      </p>
      <p className="text-2xl font-bold text-[var(--ff-text-primary)] tabular-nums mt-0.5">
        {loading ? '—' : (value ?? 0).toLocaleString()}
      </p>
      <p className="text-[11px] text-[var(--ff-text-tertiary)] mt-0.5">{sublabel}</p>
    </>
  );
  const className = 'bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg p-3 block';
  if (href) {
    return (
      <a href={href} className={`${className} hover:bg-[var(--ff-bg-secondary)] transition-colors`}>
        {body}
      </a>
    );
  }
  return <div className={className}>{body}</div>;
}
