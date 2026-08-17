import type { ParkingRunHealth } from '../runHealth';

export function ParkingRunHealthPanel({ health, loading, error }: { health: ParkingRunHealth | null; loading: boolean; error: string | null }) {
  const tone = health?.state === 'healthy' ? 'text-green-500' : health?.state === 'warning' ? 'text-amber-500' : 'text-red-500';
  return <section className="rounded-lg border border-[var(--ff-border)] p-4" aria-label="Nightly Check Health">
    <h2 className="font-semibold text-[var(--ff-text-primary)]">Nightly Check Health</h2>
    {loading ? <p>Loading health…</p> : error ? <p className="text-red-500">{error}</p> : health && <div className="mt-2 text-sm">
      <p className={tone}>{health.state === 'healthy' ? 'Healthy' : health.state === 'warning' ? 'Warning' : 'Failed'}</p>
      {health.reason && <p>{health.reason}</p>}
      {health.latestRun && <p>Last run: {new Intl.DateTimeFormat('en-ZA', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Johannesburg' }).format(new Date(health.latestRun.startedAt))}</p>}
      {health.latestRun && (health.latestRun.recordErrorCount > 0 || health.latestRun.notificationWarningCount > 0) && <p>{health.latestRun.recordErrorCount} record errors · {health.latestRun.notificationWarningCount} notification warnings</p>}
    </div>}
  </section>;
}
