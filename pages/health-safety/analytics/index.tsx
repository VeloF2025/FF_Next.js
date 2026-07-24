/**
 * H&S Injury-Rate Analytics
 * /health-safety/analytics - LTIFR / DIFR / TRIFR dashboard
 */

import type { NextPage } from 'next';
import Head from 'next/head';
import Link from 'next/link';
import useSWR from 'swr';
import { AppLayout } from '@/components/layout/AppLayout';
import { ModulePage } from '@/components/module-page';
import { projectsConfig } from '@/modules/navigation';
import { TrendingUp, ChevronLeft, Clock, Activity } from 'lucide-react';

const fetcher = (url: string) => fetch(url, { credentials: 'include' }).then((r) => r.json());
const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function rate(v: number | null | undefined) {
  return v == null ? '—' : Number(v).toFixed(2);
}

function AnalyticsContent() {
  const { data, error, isLoading } = useSWR('/api/health-safety/analytics/ltifr', fetcher);
  const totals = data?.data?.totals ?? {};
  const trend = Array.isArray(data?.data?.trend) ? data.data.trend : [];
  const byProject = Array.isArray(data?.data?.byProject) ? data.data.byProject : [];

  const tiles = [
    { l: 'LTIFR', v: rate(totals.ltifr), sub: `${totals.lost_time_injuries ?? 0} lost-time` },
    { l: 'DIFR', v: rate(totals.difr), sub: `${totals.disabling_injuries ?? 0} disabling` },
    { l: 'TRIFR', v: rate(totals.trifr), sub: `${totals.recordable_injuries ?? 0} recordable` },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-4">
          <Link href="/projects/health-safety" className="p-2 hover:bg-[var(--ff-bg-tertiary)] rounded-lg transition-colors">
            <ChevronLeft className="w-5 h-5 text-[var(--ff-text-secondary)]" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">Injury-Rate Analytics</h1>
            <p className="text-sm text-[var(--ff-text-secondary)]">Per 200,000 hours · {Number(totals.hours_worked ?? 0).toLocaleString()} hrs captured</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/health-safety/analytics/man-hours" className="flex items-center gap-2 px-3 py-2 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] hover:border-[var(--ff-primary-500)] text-[var(--ff-text-primary)] rounded-lg"><Clock className="w-4 h-4" /> Man-hours</Link>
          <Link href="/health-safety/analytics/injuries" className="flex items-center gap-2 px-3 py-2 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] hover:border-[var(--ff-primary-500)] text-[var(--ff-text-primary)] rounded-lg"><Activity className="w-4 h-4" /> Injuries</Link>
        </div>
      </div>

      {isLoading ? (
        <div className="h-24 bg-[var(--ff-bg-tertiary)] rounded-lg animate-pulse" />
      ) : error ? (
        <div className="p-8 text-center bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-lg">Failed to load analytics</div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-4">
            {tiles.map((t) => (
              <div key={t.l} className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-4 text-center">
                <div className="text-3xl font-bold text-[var(--ff-primary-500)]">{t.v}</div>
                <div className="text-sm font-medium text-[var(--ff-text-primary)] mt-1">{t.l}</div>
                <div className="text-xs text-[var(--ff-text-tertiary)]">{t.sub}</div>
              </div>
            ))}
          </div>

          <div>
            <h2 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-3 flex items-center gap-2"><TrendingUp className="w-5 h-5" /> Monthly trend</h2>
            {trend.length === 0 ? <p className="text-sm text-[var(--ff-text-tertiary)]">No man-hours or injuries recorded yet.</p> : (
              <div className="overflow-x-auto rounded-lg border border-[var(--ff-border-light)]">
                <table className="w-full text-sm">
                  <thead className="bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)]"><tr>
                    <th className="text-left px-4 py-2 font-medium">Period</th><th className="text-left px-4 py-2 font-medium">Hours</th>
                    <th className="text-left px-4 py-2 font-medium">LTI</th><th className="text-left px-4 py-2 font-medium">LTIFR</th><th className="text-left px-4 py-2 font-medium">TRIFR</th>
                  </tr></thead>
                  <tbody>
                    {trend.map((r: Record<string, number>, i: number) => (
                      <tr key={i} className="border-t border-[var(--ff-border-light)]">
                        <td className="px-4 py-2 text-[var(--ff-text-primary)]">{MONTHS[Number(r.month)]} {r.year}</td>
                        <td className="px-4 py-2 text-[var(--ff-text-secondary)]">{Number(r.hours_worked).toLocaleString()}</td>
                        <td className="px-4 py-2 text-[var(--ff-text-secondary)]">{r.lost_time_injuries}</td>
                        <td className="px-4 py-2 text-[var(--ff-text-primary)]">{rate(r.ltifr)}</td>
                        <td className="px-4 py-2 text-[var(--ff-text-primary)]">{rate(r.trifr)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div>
            <h2 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-3">By project</h2>
            {byProject.length === 0 ? <p className="text-sm text-[var(--ff-text-tertiary)]">No project data.</p> : (
              <div className="overflow-x-auto rounded-lg border border-[var(--ff-border-light)]">
                <table className="w-full text-sm">
                  <thead className="bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)]"><tr>
                    <th className="text-left px-4 py-2 font-medium">Project</th><th className="text-left px-4 py-2 font-medium">Hours</th>
                    <th className="text-left px-4 py-2 font-medium">LTIFR</th><th className="text-left px-4 py-2 font-medium">TRIFR</th>
                  </tr></thead>
                  <tbody>
                    {byProject.map((r: Record<string, number | string | null>, i: number) => (
                      <tr key={i} className="border-t border-[var(--ff-border-light)]">
                        <td className="px-4 py-2 text-[var(--ff-text-primary)]">{(r.project_name as string) ?? 'Unassigned'}</td>
                        <td className="px-4 py-2 text-[var(--ff-text-secondary)]">{Number(r.hours_worked).toLocaleString()}</td>
                        <td className="px-4 py-2 text-[var(--ff-text-primary)]">{rate(r.ltifr as number)}</td>
                        <td className="px-4 py-2 text-[var(--ff-text-primary)]">{rate(r.trifr as number)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

const AnalyticsPage: NextPage = () => (
  <AppLayout>
    <Head><title>Injury-Rate Analytics | FibreFlow</title></Head>
    <ModulePage config={projectsConfig}><AnalyticsContent /></ModulePage>
  </AppLayout>
);

export const getServerSideProps = async () => ({ props: {} });

export default AnalyticsPage;
