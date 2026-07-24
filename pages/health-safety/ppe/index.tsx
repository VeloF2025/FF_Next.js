/**
 * H&S PPE Issuance Register
 * /health-safety/ppe - Issued PPE with replacement + acknowledgement status
 */

import type { NextPage } from 'next';
import { useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import useSWR from 'swr';
import { AppLayout } from '@/components/layout/AppLayout';
import { ModulePage } from '@/components/module-page';
import { projectsConfig } from '@/modules/navigation';
import { HardHat, Plus, ChevronLeft, Settings, CheckCircle2, Clock } from 'lucide-react';
import { ReplacementBadge } from '@/modules/health-safety/components/ppe/ReplacementBadge';
import type { PPEReplacementStatus } from '@/modules/health-safety/types/ppe.types';

const fetcher = (url: string) => fetch(url, { credentials: 'include' }).then((r) => r.json());

interface IssueRow {
  id: string; worker_name: string; item_name: string; size: string | null; quantity: number;
  issued_date: string; replacement_due: string | null; replacement_status: PPEReplacementStatus; acknowledged: boolean;
}

function PPEContent() {
  const [outstanding, setOutstanding] = useState(false);
  const { data, error, isLoading } = useSWR(`/api/health-safety/ppe/issuance${outstanding ? '?status=outstanding' : ''}`, fetcher);
  const rows: IssueRow[] = Array.isArray(data?.data?.issuance) ? data.data.issuance : [];
  const stats = data?.data?.stats ?? { total: 0, overdue: 0, due_soon: 0, unacknowledged: 0 };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-4">
          <Link href="/projects/health-safety" className="p-2 hover:bg-[var(--ff-bg-tertiary)] rounded-lg transition-colors">
            <ChevronLeft className="w-5 h-5 text-[var(--ff-text-secondary)]" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">PPE Register</h1>
            <p className="text-sm text-[var(--ff-text-secondary)]">{stats.total} issued · {stats.overdue} overdue · {stats.unacknowledged} unacknowledged</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/health-safety/ppe/catalogue" className="flex items-center gap-2 px-3 py-2 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] hover:border-[var(--ff-primary-500)] text-[var(--ff-text-primary)] rounded-lg transition-colors">
            <Settings className="w-4 h-4" /> Catalogue
          </Link>
          <Link href="/health-safety/ppe/new" className="flex items-center gap-2 px-4 py-2 bg-[var(--ff-primary-500)] hover:bg-[var(--ff-primary-600)] text-white rounded-lg transition-colors">
            <Plus className="w-4 h-4" /> Issue PPE
          </Link>
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm text-[var(--ff-text-secondary)]">
        <input type="checkbox" checked={outstanding} onChange={(e) => setOutstanding(e.target.checked)} />
        Outstanding only (overdue or unacknowledged)
      </label>

      {isLoading ? (
        <div className="space-y-3">{[1, 2, 3].map((i) => <div key={i} className="h-14 bg-[var(--ff-bg-tertiary)] rounded-lg animate-pulse" />)}</div>
      ) : error ? (
        <div className="p-8 text-center bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-lg">Failed to load PPE register</div>
      ) : rows.length === 0 ? (
        <div className="text-center py-12 bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)]">
          <HardHat className="w-12 h-12 mx-auto mb-4 text-[var(--ff-text-tertiary)]" />
          <p className="text-[var(--ff-text-secondary)]">No PPE issued</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[var(--ff-border-light)]">
          <table className="w-full text-sm">
            <thead className="bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)]">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Worker</th>
                <th className="text-left px-4 py-2 font-medium">Item</th>
                <th className="text-left px-4 py-2 font-medium">Size / Qty</th>
                <th className="text-left px-4 py-2 font-medium">Replacement</th>
                <th className="text-left px-4 py-2 font-medium">Ack</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-[var(--ff-border-light)] hover:bg-[var(--ff-bg-tertiary)]/40">
                  <td className="px-4 py-2">
                    <Link href={`/health-safety/ppe/${r.id}`} className="text-[var(--ff-primary-500)] hover:underline font-medium">{r.worker_name}</Link>
                  </td>
                  <td className="px-4 py-2 text-[var(--ff-text-primary)]">{r.item_name}</td>
                  <td className="px-4 py-2 text-[var(--ff-text-secondary)]">{r.size ?? '—'} × {r.quantity}</td>
                  <td className="px-4 py-2">
                    <span className="flex items-center gap-2">
                      <ReplacementBadge status={r.replacement_status} />
                      {r.replacement_due && <span className="text-xs text-[var(--ff-text-tertiary)]">{r.replacement_due.slice(0, 10)}</span>}
                    </span>
                  </td>
                  <td className="px-4 py-2">
                    {r.acknowledged
                      ? <span className="flex items-center gap-1 text-green-600 dark:text-green-400"><CheckCircle2 className="w-4 h-4" />Signed</span>
                      : <span className="flex items-center gap-1 text-[var(--ff-text-tertiary)]"><Clock className="w-4 h-4" />No</span>}
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

const PPEPage: NextPage = () => (
  <AppLayout>
    <Head><title>PPE Register | FibreFlow</title></Head>
    <ModulePage config={projectsConfig}><PPEContent /></ModulePage>
  </AppLayout>
);

export const getServerSideProps = async () => ({ props: {} });

export default PPEPage;
