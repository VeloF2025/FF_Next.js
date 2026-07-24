/**
 * Project Competency Gap
 * /health-safety/project/[projectId]/competency - Statutory training gaps per worker
 */

import type { NextPage } from 'next';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import useSWR from 'swr';
import { AppLayout } from '@/components/layout/AppLayout';
import { ModulePage } from '@/components/module-page';
import { projectsConfig } from '@/modules/navigation';
import { ChevronLeft, GraduationCap } from 'lucide-react';
import { CompetencyBadge, type CompetencyStatus } from '@/modules/health-safety/components/training/CompetencyBadge';

const fetcher = (url: string) => fetch(url, { credentials: 'include' }).then((r) => r.json());

interface Cell {
  worker_name: string;
  training_type_id: string;
  training_name: string;
  competency_status: CompetencyStatus;
}

function CompetencyContent() {
  const router = useRouter();
  const { projectId } = router.query;
  const pid = typeof projectId === 'string' ? projectId : undefined;
  const { data, error, isLoading } = useSWR(
    pid ? `/api/health-safety/training/competency?project_id=${pid}` : null,
    fetcher
  );

  const cells: Cell[] = Array.isArray(data?.data?.cells) ? data.data.cells : [];
  const summary = data?.data?.summary ?? { workers: 0, missing: 0, expired: 0, expiring_soon: 0, current: 0 };

  // Pivot cells into a worker × training-type matrix.
  const typeNames = Array.from(new Map(cells.map((c) => [c.training_type_id, c.training_name])).entries());
  const workers = Array.from(new Set(cells.map((c) => c.worker_name)));
  const cellByKey = new Map(cells.map((c) => [`${c.worker_name}::${c.training_type_id}`, c.competency_status]));

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/projects/health-safety" className="p-2 hover:bg-[var(--ff-bg-tertiary)] rounded-lg transition-colors">
          <ChevronLeft className="w-5 h-5 text-[var(--ff-text-secondary)]" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">Competency Gaps</h1>
          <p className="text-sm text-[var(--ff-text-secondary)]">
            {summary.workers} worker{summary.workers !== 1 ? 's' : ''} · {summary.missing} missing · {summary.expired} expired
          </p>
        </div>
      </div>

      {isLoading ? (
        <div className="h-40 bg-[var(--ff-bg-tertiary)] rounded-lg animate-pulse" />
      ) : error ? (
        <div className="p-8 text-center bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-lg">Failed to load competency data</div>
      ) : workers.length === 0 ? (
        <div className="text-center py-12 bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)]">
          <GraduationCap className="w-12 h-12 mx-auto mb-4 text-[var(--ff-text-tertiary)]" />
          <p className="text-[var(--ff-text-secondary)]">No training recorded against this project yet</p>
          <p className="text-sm text-[var(--ff-text-tertiary)] mt-1">Record worker training tagged to this project to populate the matrix</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[var(--ff-border-light)]">
          <table className="text-sm">
            <thead className="bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)]">
              <tr>
                <th className="text-left px-4 py-2 font-medium sticky left-0 bg-[var(--ff-bg-tertiary)]">Worker</th>
                {typeNames.map(([id, name]) => (
                  <th key={id} className="text-left px-4 py-2 font-medium whitespace-nowrap">{name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {workers.map((w) => (
                <tr key={w} className="border-t border-[var(--ff-border-light)]">
                  <td className="px-4 py-2 font-medium text-[var(--ff-text-primary)] sticky left-0 bg-[var(--ff-bg-secondary)] whitespace-nowrap">{w}</td>
                  {typeNames.map(([id]) => (
                    <td key={id} className="px-4 py-2">
                      <CompetencyBadge status={cellByKey.get(`${w}::${id}`) ?? 'missing'} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const CompetencyPage: NextPage = () => (
  <AppLayout>
    <Head>
      <title>Competency Gaps | FibreFlow</title>
    </Head>
    <ModulePage config={projectsConfig}>
      <CompetencyContent />
    </ModulePage>
  </AppLayout>
);

export const getServerSideProps = async () => ({ props: {} });

export default CompetencyPage;
