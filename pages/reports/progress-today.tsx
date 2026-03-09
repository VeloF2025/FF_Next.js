import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import {
  Activity,
  ArrowLeft,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  Minus,
  Zap,
  Cable,
  Radio,
  CheckCircle2,
  Home,
} from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';

interface ProgressMetrics {
  polesPlanted: number;
  stringingCompleted: number;
  rfosCompleted: number;
  atpsCompleted: number;
  totalInstalls: number;
  totalActivated: number;
}

interface ProgressData {
  asOfDate: string;
  metrics: ProgressMetrics;
  previousDay: ProgressMetrics;
}

const METRIC_CONFIG = [
  {
    key: 'polesPlanted' as keyof ProgressMetrics,
    label: 'Poles Planted',
    icon: Activity,
    color: 'blue',
    description: 'Poles installed on site today',
  },
  {
    key: 'stringingCompleted' as keyof ProgressMetrics,
    label: 'Stringing Completed',
    icon: Cable,
    color: 'emerald',
    description: 'Fiber stringing sections completed today',
  },
  {
    key: 'rfosCompleted' as keyof ProgressMetrics,
    label: "RFO's Completed",
    icon: Radio,
    color: 'purple',
    description: 'Ready for Optical milestones reached today',
  },
  {
    key: 'atpsCompleted' as keyof ProgressMetrics,
    label: "ATP's Completed",
    icon: CheckCircle2,
    color: 'amber',
    description: 'Acceptance Test Procedures passed today',
  },
  {
    key: 'totalInstalls' as keyof ProgressMetrics,
    label: 'Total Installs',
    icon: Home,
    color: 'rose',
    description: 'Customer installations via WhatsApp today',
  },
  {
    key: 'totalActivated' as keyof ProgressMetrics,
    label: 'Total Activated',
    icon: Zap,
    color: 'cyan',
    description: 'OES activations (day-lagged from FiberTime)',
  },
];

const COLOR_MAP: Record<string, { bg: string; text: string; border: string; iconBg: string }> = {
  blue: { bg: 'bg-blue-500/10', text: 'text-blue-400', border: 'border-blue-500/20', iconBg: 'bg-blue-500/20' },
  emerald: { bg: 'bg-emerald-500/10', text: 'text-emerald-400', border: 'border-emerald-500/20', iconBg: 'bg-emerald-500/20' },
  purple: { bg: 'bg-purple-500/10', text: 'text-purple-400', border: 'border-purple-500/20', iconBg: 'bg-purple-500/20' },
  amber: { bg: 'bg-amber-500/10', text: 'text-amber-400', border: 'border-amber-500/20', iconBg: 'bg-amber-500/20' },
  rose: { bg: 'bg-rose-500/10', text: 'text-rose-400', border: 'border-rose-500/20', iconBg: 'bg-rose-500/20' },
  cyan: { bg: 'bg-cyan-500/10', text: 'text-cyan-400', border: 'border-cyan-500/20', iconBg: 'bg-cyan-500/20' },
};

function TrendIndicator({ current, previous }: { current: number; previous: number }) {
  if (previous === 0 && current === 0) {
    return <span className="text-xs text-[var(--ff-text-tertiary)] flex items-center gap-1"><Minus className="w-3 h-3" /> No change</span>;
  }
  if (previous === 0) {
    return <span className="text-xs text-emerald-400 flex items-center gap-1"><TrendingUp className="w-3 h-3" /> New today</span>;
  }
  const diff = current - previous;
  const pct = Math.round((diff / previous) * 100);
  if (diff > 0) {
    return <span className="text-xs text-emerald-400 flex items-center gap-1"><TrendingUp className="w-3 h-3" /> +{pct}% vs yesterday</span>;
  }
  if (diff < 0) {
    return <span className="text-xs text-rose-400 flex items-center gap-1"><TrendingDown className="w-3 h-3" /> {pct}% vs yesterday</span>;
  }
  return <span className="text-xs text-[var(--ff-text-tertiary)] flex items-center gap-1"><Minus className="w-3 h-3" /> Same as yesterday</span>;
}

export default function ProgressTodayPage() {
  const router = useRouter();
  const [data, setData] = useState<ProgressData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/reports/progress-today');
      if (!res.ok) throw new Error(`API error: ${res.status}`);
      const json = await res.json();
      setData(json);
      setLastRefresh(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    // Auto-refresh every 5 minutes
    const interval = setInterval(fetchData, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-ZA', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  };

  const totalToday = data ? Object.values(data.metrics).reduce((a, b) => a + b, 0) : 0;
  const totalYesterday = data ? Object.values(data.previousDay).reduce((a, b) => a + b, 0) : 0;

  return (
    <AppLayout>
      <Head>
        <title>Progress Today | FibreFlow</title>
      </Head>

      <div className="ff-page-container">
        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.push('/dashboard')}
              className="p-2 rounded-lg hover:bg-[var(--ff-bg-tertiary)] transition-colors text-[var(--ff-text-secondary)]"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div>
              <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">Progress Today</h1>
              {data && (
                <p className="text-sm text-[var(--ff-text-secondary)]">{formatDate(data.asOfDate)}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3">
            {lastRefresh && (
              <span className="text-xs text-[var(--ff-text-tertiary)]">
                Updated {lastRefresh.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
            <button
              onClick={fetchData}
              disabled={loading}
              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] hover:bg-[var(--ff-bg-tertiary)] transition-colors text-sm text-[var(--ff-text-primary)] disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
        </div>

        {/* Error state */}
        {error && (
          <div className="mb-6 p-4 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 text-sm">
            {error}
          </div>
        )}

        {/* Summary bar */}
        <div className="mb-6 p-4 rounded-lg bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)]">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-500/20">
                <Zap className="w-5 h-5 text-blue-400" />
              </div>
              <div>
                <p className="text-sm text-[var(--ff-text-secondary)]">Total Activities Today</p>
                <p className="text-2xl font-bold text-[var(--ff-text-primary)]">
                  {loading ? '—' : totalToday.toLocaleString()}
                </p>
              </div>
            </div>
            <TrendIndicator current={totalToday} previous={totalYesterday} />
          </div>
        </div>

        {/* Metric cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {METRIC_CONFIG.map((metric) => {
            const colors = COLOR_MAP[metric.color];
            const Icon = metric.icon;
            const current = data?.metrics[metric.key] ?? 0;
            const previous = data?.previousDay[metric.key] ?? 0;

            return (
              <div
                key={metric.key}
                className={`p-5 rounded-lg border ${colors.border} ${colors.bg} transition-all hover:shadow-lg`}
              >
                <div className="flex items-start justify-between mb-3">
                  <div className={`p-2.5 rounded-lg ${colors.iconBg}`}>
                    <Icon className={`w-5 h-5 ${colors.text}`} />
                  </div>
                  <TrendIndicator current={current} previous={previous} />
                </div>
                <div className="mb-1">
                  <p className="text-3xl font-bold text-[var(--ff-text-primary)]">
                    {loading ? (
                      <span className="inline-block w-16 h-8 bg-[var(--ff-bg-tertiary)] rounded animate-pulse" />
                    ) : (
                      current.toLocaleString()
                    )}
                  </p>
                </div>
                <p className="text-sm font-medium text-[var(--ff-text-primary)]">{metric.label}</p>
                <p className="text-xs text-[var(--ff-text-tertiary)] mt-0.5">{metric.description}</p>
                {!loading && previous > 0 && (
                  <p className="text-xs text-[var(--ff-text-tertiary)] mt-2">
                    Yesterday: {previous.toLocaleString()}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </AppLayout>
  );
}
