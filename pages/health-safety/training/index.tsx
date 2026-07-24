/**
 * H&S Training Matrix
 * /health-safety/training - Worker training records + competency status
 */

import type { NextPage } from 'next';
import { useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import useSWR from 'swr';
import { AppLayout } from '@/components/layout/AppLayout';
import { ModulePage } from '@/components/module-page';
import { projectsConfig } from '@/modules/navigation';
import { GraduationCap, Plus, ChevronLeft, Tag, Settings, AlertTriangle } from 'lucide-react';
import { CompetencyBadge, type CompetencyStatus } from '@/modules/health-safety/components/training/CompetencyBadge';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface TrainingRow {
  id: string;
  worker_name: string;
  training_name: string;
  training_code: string;
  is_statutory: boolean;
  contractor_id: string | null;
  expiry_date: string | null;
  days_to_expiry: number | null;
  competency_status: CompetencyStatus;
}

function TrainingContent() {
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const query = statusFilter === 'all' ? '' : `?status=${statusFilter}`;
  const { data, error, isLoading } = useSWR(`/api/health-safety/training/records${query}`, fetcher);
  const records: TrainingRow[] = Array.isArray(data?.data?.records) ? data.data.records : [];
  const stats = data?.data?.stats ?? { total: 0, current: 0, expiring_soon: 0, expired: 0 };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-4">
          <Link href="/projects/health-safety" className="p-2 hover:bg-[var(--ff-bg-tertiary)] rounded-lg transition-colors">
            <ChevronLeft className="w-5 h-5 text-[var(--ff-text-secondary)]" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">Training Matrix</h1>
            <p className="text-sm text-[var(--ff-text-secondary)]">
              {stats.total} record{stats.total !== 1 ? 's' : ''} · {stats.expired} expired · {stats.expiring_soon} expiring
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/health-safety/training/types" className="flex items-center gap-2 px-3 py-2 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] hover:border-[var(--ff-primary-500)] text-[var(--ff-text-primary)] rounded-lg transition-colors">
            <Settings className="w-4 h-4" />
            Training Types
          </Link>
          <Link href="/health-safety/training/new" className="flex items-center gap-2 px-4 py-2 bg-[var(--ff-primary-500)] hover:bg-[var(--ff-primary-600)] text-white rounded-lg transition-colors">
            <Plus className="w-4 h-4" />
            Record Training
          </Link>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
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
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 bg-[var(--ff-bg-tertiary)] rounded-lg animate-pulse" />
          ))}
        </div>
      ) : error ? (
        <div className="p-8 text-center bg-red-50 dark:bg-red-900/20 rounded-lg text-red-600 dark:text-red-400">
          Failed to load training records
        </div>
      ) : records.length === 0 ? (
        <div className="text-center py-12 bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)]">
          <GraduationCap className="w-12 h-12 mx-auto mb-4 text-[var(--ff-text-tertiary)]" />
          <p className="text-[var(--ff-text-secondary)]">No training records</p>
          <p className="text-sm text-[var(--ff-text-tertiary)] mt-1">Record a worker&apos;s training to start the matrix</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[var(--ff-border-light)]">
          <table className="w-full text-sm">
            <thead className="bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)]">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Worker</th>
                <th className="text-left px-4 py-2 font-medium">Training</th>
                <th className="text-left px-4 py-2 font-medium">Expiry</th>
                <th className="text-left px-4 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {records.map((r) => (
                <tr key={r.id} className="border-t border-[var(--ff-border-light)] hover:bg-[var(--ff-bg-tertiary)]/40">
                  <td className="px-4 py-2">
                    <Link href={`/health-safety/training/${r.id}`} className="text-[var(--ff-primary-500)] hover:underline font-medium">
                      {r.worker_name}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-[var(--ff-text-primary)]">
                    <span className="flex items-center gap-1.5">
                      {r.is_statutory && <Tag className="w-3.5 h-3.5 text-[var(--ff-text-tertiary)]" />}
                      {r.training_name}
                    </span>
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
                    <CompetencyBadge status={r.competency_status} />
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

const TrainingPage: NextPage = () => (
  <AppLayout>
    <Head>
      <title>Training Matrix | FibreFlow</title>
    </Head>
    <ModulePage config={projectsConfig}>
      <TrainingContent />
    </ModulePage>
  </AppLayout>
);

export const getServerSideProps = async () => ({ props: {} });

export default TrainingPage;
