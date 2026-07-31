/**
 * H&S Permits to Work
 * /health-safety/permits
 */

import type { NextPage } from 'next';
import { useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import useSWR from 'swr';
import { AppLayout } from '@/components/layout/AppLayout';
import { ModulePage } from '@/components/module-page';
import { healthSafetyConfig } from '@/modules/navigation';
import { FileCheck, Plus, ChevronLeft, Calendar } from 'lucide-react';
import { PermitStatusBadge } from '@/modules/health-safety/components/permits/PermitStatusBadge';
import type { PermitStatus } from '@/modules/health-safety/types/permit.types';

const fetcher = (url: string) => fetch(url, { credentials: 'include' }).then((r) => r.json());

interface PermitRow {
  id: string; permit_number: string; title: string; type_name: string;
  project_name: string | null; effective_status: PermitStatus; valid_to: string | null;
}

function PermitsContent() {
  const [statusFilter, setStatusFilter] = useState('all');
  const { data, error, isLoading } = useSWR('/api/health-safety/permits', fetcher);
  const all: PermitRow[] = Array.isArray(data?.data?.permits) ? data.data.permits : [];
  const permits = statusFilter === 'all' ? all : all.filter((p) => p.effective_status === statusFilter);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-4">
          <Link href="/health-safety" className="p-2 hover:bg-[var(--ff-bg-tertiary)] rounded-lg transition-colors">
            <ChevronLeft className="w-5 h-5 text-[var(--ff-text-secondary)]" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">Permits to Work</h1>
            <p className="text-sm text-[var(--ff-text-secondary)]">{all.length} permit{all.length !== 1 ? 's' : ''}</p>
          </div>
        </div>
        <Link href="/health-safety/permits/new" className="flex items-center gap-2 px-4 py-2 bg-[var(--ff-primary-500)] hover:bg-[var(--ff-primary-600)] text-white rounded-lg transition-colors">
          <Plus className="w-4 h-4" /> Request Permit
        </Link>
      </div>

      <div className="flex flex-wrap gap-2">
        {['all', 'requested', 'approved', 'active', 'expired', 'closed'].map((s) => (
          <button key={s} onClick={() => setStatusFilter(s)}
            className={`px-3 py-1.5 text-sm rounded-lg border transition-colors capitalize ${statusFilter === s ? 'bg-[var(--ff-primary-500)] text-white border-[var(--ff-primary-500)]' : 'bg-[var(--ff-bg-secondary)] text-[var(--ff-text-secondary)] border-[var(--ff-border-light)] hover:border-[var(--ff-primary-500)]'}`}>
            {s}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="space-y-3">{[1, 2, 3].map((i) => <div key={i} className="h-14 bg-[var(--ff-bg-tertiary)] rounded-lg animate-pulse" />)}</div>
      ) : error ? (
        <div className="p-8 text-center bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-lg">Failed to load permits</div>
      ) : permits.length === 0 ? (
        <div className="text-center py-12 bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)]">
          <FileCheck className="w-12 h-12 mx-auto mb-4 text-[var(--ff-text-tertiary)]" />
          <p className="text-[var(--ff-text-secondary)]">No permits</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[var(--ff-border-light)]">
          <table className="w-full text-sm">
            <thead className="bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)]">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Permit</th>
                <th className="text-left px-4 py-2 font-medium">Type</th>
                <th className="text-left px-4 py-2 font-medium">Project</th>
                <th className="text-left px-4 py-2 font-medium">Valid to</th>
                <th className="text-left px-4 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {permits.map((p) => (
                <tr key={p.id} className="border-t border-[var(--ff-border-light)] hover:bg-[var(--ff-bg-tertiary)]/40">
                  <td className="px-4 py-2">
                    <Link href={`/health-safety/permits/${p.id}`} className="text-[var(--ff-primary-500)] hover:underline font-medium">{p.permit_number}</Link>
                    <div className="text-xs text-[var(--ff-text-tertiary)]">{p.title}</div>
                  </td>
                  <td className="px-4 py-2 text-[var(--ff-text-primary)]">{p.type_name}</td>
                  <td className="px-4 py-2 text-[var(--ff-text-secondary)]">{p.project_name ?? '—'}</td>
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

const PermitsPage: NextPage = () => (
  <AppLayout>
    <Head><title>Permits to Work | FibreFlow</title></Head>
    <ModulePage config={healthSafetyConfig}><PermitsContent /></ModulePage>
  </AppLayout>
);

export const getServerSideProps = async () => ({ props: {} });

export default PermitsPage;
