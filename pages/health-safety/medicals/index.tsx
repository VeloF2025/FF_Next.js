/**
 * H&S Medical Fitness Register
 * /health-safety/medicals - Per-worker Certificate of Fitness records
 */

import type { NextPage } from 'next';
import { useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import useSWR from 'swr';
import { AppLayout } from '@/components/layout/AppLayout';
import { ModulePage } from '@/components/module-page';
import { healthSafetyConfig } from '@/modules/navigation';
import { HeartPulse, Plus, ChevronLeft, AlertTriangle } from 'lucide-react';
import { CompetencyBadge } from '@/modules/health-safety/components/training/CompetencyBadge';
import { MedicalOutcomeBadge } from '@/modules/health-safety/components/medical/MedicalOutcomeBadge';
import type { MedicalOutcome, MedicalStatus } from '@/modules/health-safety/types/medical.types';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface MedicalRow {
  id: string;
  worker_name: string;
  outcome: MedicalOutcome;
  restrictions: string | null;
  exam_date: string;
  expiry_date: string | null;
  days_to_expiry: number | null;
  medical_status: MedicalStatus;
  is_latest: boolean;
}

function MedicalsContent() {
  const [statusFilter, setStatusFilter] = useState<string>('all');
  // Superseded certificates are hidden by default — the register answers "is
  // this worker fit today", which is the latest examination, not the history.
  const [latestOnly, setLatestOnly] = useState(true);

  const params = new URLSearchParams();
  if (statusFilter !== 'all') params.set('status', statusFilter);
  if (latestOnly) params.set('latest_only', 'true');
  const qs = params.toString();

  const { data, error, isLoading } = useSWR(
    `/api/health-safety/medicals${qs ? `?${qs}` : ''}`,
    fetcher
  );
  const records: MedicalRow[] = Array.isArray(data?.data?.records) ? data.data.records : [];
  const stats = data?.data?.stats ?? { total: 0, expired: 0, expiring_soon: 0, unfit: 0 };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-4">
          <Link
            href="/health-safety"
            className="p-2 hover:bg-[var(--ff-bg-tertiary)] rounded-lg transition-colors"
          >
            <ChevronLeft className="w-5 h-5 text-[var(--ff-text-secondary)]" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">
              Medical Fitness Register
            </h1>
            <p className="text-sm text-[var(--ff-text-secondary)]">
              {stats.total} certificate{stats.total !== 1 ? 's' : ''} · {stats.expired} expired ·{' '}
              {stats.expiring_soon} expiring · {stats.unfit} unfit
            </p>
          </div>
        </div>
        <Link
          href="/health-safety/medicals/new"
          className="flex items-center gap-2 px-4 py-2 bg-[var(--ff-primary-500)] hover:bg-[var(--ff-primary-600)] text-white rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4" />
          Record Medical
        </Link>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {['all', 'current', 'expiring_soon', 'expired'].map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${
              statusFilter === s
                ? 'bg-[var(--ff-primary-500)] text-white border-[var(--ff-primary-500)]'
                : 'bg-[var(--ff-bg-secondary)] text-[var(--ff-text-secondary)] border-[var(--ff-border-light)] hover:border-[var(--ff-primary-500)]'
            }`}
          >
            {s === 'all' ? 'All' : s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
          </button>
        ))}
        <label className="flex items-center gap-2 ml-2 text-sm text-[var(--ff-text-secondary)]">
          <input
            type="checkbox"
            checked={latestOnly}
            onChange={(e) => setLatestOnly(e.target.checked)}
          />
          Latest per worker only
        </label>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 bg-[var(--ff-bg-tertiary)] rounded-lg animate-pulse" />
          ))}
        </div>
      ) : error ? (
        <div className="p-8 text-center bg-red-50 dark:bg-red-900/20 rounded-lg text-red-600 dark:text-red-400">
          Failed to load medical records
        </div>
      ) : records.length === 0 ? (
        <div className="text-center py-12 bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)]">
          <HeartPulse className="w-12 h-12 mx-auto mb-4 text-[var(--ff-text-tertiary)]" />
          <p className="text-[var(--ff-text-secondary)]">No medical records</p>
          <p className="text-sm text-[var(--ff-text-tertiary)] mt-1">
            Record a Certificate of Fitness to start the register
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[var(--ff-border-light)]">
          <table className="w-full text-sm">
            <thead className="bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)]">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Worker</th>
                <th className="text-left px-4 py-2 font-medium">Outcome</th>
                <th className="text-left px-4 py-2 font-medium">Examined</th>
                <th className="text-left px-4 py-2 font-medium">Expiry</th>
                <th className="text-left px-4 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {records.map((r) => (
                <tr
                  key={r.id}
                  className="border-t border-[var(--ff-border-light)] hover:bg-[var(--ff-bg-tertiary)]/40"
                >
                  <td className="px-4 py-2">
                    <Link
                      href={`/health-safety/medicals/${r.id}`}
                      className="text-[var(--ff-primary-500)] hover:underline font-medium"
                    >
                      {r.worker_name}
                    </Link>
                    {!r.is_latest && (
                      <span className="ml-2 text-xs text-[var(--ff-text-tertiary)]">superseded</span>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    <MedicalOutcomeBadge outcome={r.outcome} />
                    {r.restrictions && (
                      <span
                        className="ml-2 text-xs text-[var(--ff-text-tertiary)]"
                        title={r.restrictions}
                      >
                        {r.restrictions.slice(0, 40)}
                        {r.restrictions.length > 40 ? '…' : ''}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-[var(--ff-text-secondary)]">
                    {r.exam_date?.slice(0, 10)}
                  </td>
                  <td className="px-4 py-2 text-[var(--ff-text-secondary)]">
                    {r.expiry_date ? (
                      <span className="flex items-center gap-1">
                        {r.expiry_date.slice(0, 10)}
                        {r.days_to_expiry != null && r.days_to_expiry < 0 && (
                          <AlertTriangle className="w-3.5 h-3.5 text-red-500" />
                        )}
                      </span>
                    ) : (
                      <span className="text-[var(--ff-text-tertiary)]">No expiry</span>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    <CompetencyBadge status={r.medical_status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const MedicalsPage: NextPage = () => (
  <AppLayout>
    <Head>
      <title>Medical Fitness Register | FibreFlow</title>
    </Head>
    <ModulePage config={healthSafetyConfig}>
      <MedicalsContent />
    </ModulePage>
  </AppLayout>
);

export const getServerSideProps = async () => ({ props: {} });

export default MedicalsPage;
