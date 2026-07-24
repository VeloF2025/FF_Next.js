/**
 * Project Permits register
 * /health-safety/project/[projectId]/permits - Permits for one project's safety file
 */

import type { NextPage } from 'next';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import useSWR from 'swr';
import { AppLayout } from '@/components/layout/AppLayout';
import { ModulePage } from '@/components/module-page';
import { projectsConfig } from '@/modules/navigation';
import { ChevronLeft, FileCheck, Calendar } from 'lucide-react';
import { PermitStatusBadge } from '@/modules/health-safety/components/permits/PermitStatusBadge';
import type { PermitStatus } from '@/modules/health-safety/types/permit.types';

const fetcher = (url: string) => fetch(url, { credentials: 'include' }).then((r) => r.json());

interface PermitRow {
  id: string; permit_number: string; title: string; type_name: string;
  effective_status: PermitStatus; valid_to: string | null;
}

function ProjectPermitsContent() {
  const router = useRouter();
  const { projectId } = router.query;
  const pid = typeof projectId === 'string' ? projectId : undefined;
  const { data, error, isLoading } = useSWR(pid ? `/api/health-safety/permits?project_id=${pid}` : null, fetcher);
  const permits: PermitRow[] = Array.isArray(data?.data?.permits) ? data.data.permits : [];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/projects/health-safety" className="p-2 hover:bg-[var(--ff-bg-tertiary)] rounded-lg transition-colors">
          <ChevronLeft className="w-5 h-5 text-[var(--ff-text-secondary)]" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">Permits Register</h1>
          <p className="text-sm text-[var(--ff-text-secondary)]">{permits.length} permit{permits.length !== 1 ? 's' : ''} for this project</p>
        </div>
      </div>

      {isLoading ? (
        <div className="h-32 bg-[var(--ff-bg-tertiary)] rounded-lg animate-pulse" />
      ) : error ? (
        <div className="p-8 text-center bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-lg">Failed to load</div>
      ) : permits.length === 0 ? (
        <div className="text-center py-12 bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)]">
          <FileCheck className="w-12 h-12 mx-auto mb-4 text-[var(--ff-text-tertiary)]" />
          <p className="text-[var(--ff-text-secondary)]">No permits for this project</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[var(--ff-border-light)]">
          <table className="w-full text-sm">
            <thead className="bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)]">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Permit</th>
                <th className="text-left px-4 py-2 font-medium">Type</th>
                <th className="text-left px-4 py-2 font-medium">Valid to</th>
                <th className="text-left px-4 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {permits.map((p) => (
                <tr key={p.id} className="border-t border-[var(--ff-border-light)]">
                  <td className="px-4 py-2">
                    <Link href={`/health-safety/permits/${p.id}`} className="text-[var(--ff-primary-500)] hover:underline font-medium">{p.permit_number}</Link>
                    <div className="text-xs text-[var(--ff-text-tertiary)]">{p.title}</div>
                  </td>
                  <td className="px-4 py-2 text-[var(--ff-text-primary)]">{p.type_name}</td>
                  <td className="px-4 py-2 text-[var(--ff-text-secondary)]">{p.valid_to ? <span className="flex items-center gap-1"><Calendar className="w-3.5 h-3.5" />{p.valid_to.slice(0, 16).replace('T', ' ')}</span> : '—'}</td>
                  <td className="px-4 py-2"><PermitStatusBadge status={p.effective_status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const ProjectPermitsPage: NextPage = () => (
  <AppLayout>
    <Head><title>Permits Register | FibreFlow</title></Head>
    <ModulePage config={projectsConfig}><ProjectPermitsContent /></ModulePage>
  </AppLayout>
);

export const getServerSideProps = async () => ({ props: {} });

export default ProjectPermitsPage;
