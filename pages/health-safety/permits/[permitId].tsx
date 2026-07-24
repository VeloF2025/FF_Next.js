/**
 * H&S Permit detail — preconditions + lifecycle actions
 * /health-safety/permits/[permitId]
 */

import type { NextPage } from 'next';
import React, { useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import useSWR, { mutate } from 'swr';
import { AppLayout } from '@/components/layout/AppLayout';
import { ModulePage } from '@/components/module-page';
import { projectsConfig } from '@/modules/navigation';
import { ChevronLeft, Trash2 } from 'lucide-react';
import { PermitStatusBadge } from '@/modules/health-safety/components/permits/PermitStatusBadge';
import { PERMIT_STATUS_TRANSITIONS, PERMIT_STATUS_CONFIG, type PermitStatus, type PermitPrecondition } from '@/modules/health-safety/types/permit.types';
import { allMandatoryPreconditionsMet } from '@/modules/health-safety/services/permitService';

const fetcher = (url: string) => fetch(url, { credentials: 'include' }).then((r) => r.json());

function Detail({ id }: { id: string }) {
  const router = useRouter();
  const key = `/api/health-safety/permits/${id}`;
  const { data, error, isLoading } = useSWR(key, fetcher);
  const permit = data?.data?.permit;
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const preconditions: PermitPrecondition[] = Array.isArray(permit?.preconditions) ? permit.preconditions : [];
  const confirmed: string[] = Array.isArray(permit?.precondition_confirmed) ? permit.precondition_confirmed : [];
  const effective: PermitStatus = permit?.effective_status ?? 'requested';
  const allowed = PERMIT_STATUS_TRANSITIONS[effective] || [];
  const requiredMet = allMandatoryPreconditionsMet(preconditions, confirmed);

  async function patch(body: Record<string, unknown>) {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch(key, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const json = await res.json();
      if (!res.ok || json?.success === false) setMsg(json?.error?.message || json?.error || 'Action failed');
      else mutate(key);
    } catch { setMsg('Network error'); } finally { setBusy(false); }
  }

  function togglePrecondition(text: string, on: boolean) {
    const next = on ? [...confirmed, text] : confirmed.filter((t) => t !== text);
    patch({ precondition_confirmed: next });
  }

  async function remove() {
    if (!confirm('Delete this permit?')) return;
    const res = await fetch(key, { method: 'DELETE' });
    if (res.ok) router.push('/health-safety/permits');
  }

  if (isLoading) return <div className="h-40 bg-[var(--ff-bg-tertiary)] rounded-lg animate-pulse" />;
  if (error || !permit) return <div className="p-8 text-center bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-lg">Permit not found</div>;

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/health-safety/permits" className="p-2 hover:bg-[var(--ff-bg-tertiary)] rounded-lg transition-colors">
            <ChevronLeft className="w-5 h-5 text-[var(--ff-text-secondary)]" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">{permit.permit_number}</h1>
            <p className="text-sm text-[var(--ff-text-secondary)]">{permit.type_name} · {permit.title}{permit.project_name ? ` · ${permit.project_name}` : ''}</p>
          </div>
        </div>
        <PermitStatusBadge status={effective} />
      </div>

      {effective === 'expired' && (
        <div className="p-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 rounded-lg text-sm font-medium">
          This permit has expired — its validity window lapsed. It cannot be activated or used; request a new permit.
        </div>
      )}
      {msg && <div className="p-2 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded text-sm">{msg}</div>}

      <dl className="grid grid-cols-2 gap-4 text-sm bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-4">
        <div><dt className="text-[var(--ff-text-tertiary)]">Location</dt><dd className="text-[var(--ff-text-primary)]">{permit.location ?? '—'}</dd></div>
        <div><dt className="text-[var(--ff-text-tertiary)]">Validity</dt><dd className="text-[var(--ff-text-primary)]">{permit.valid_from ? permit.valid_from.slice(0, 16).replace('T', ' ') : '—'} → {permit.valid_to ? permit.valid_to.slice(0, 16).replace('T', ' ') : '—'}</dd></div>
        <div className="col-span-2"><dt className="text-[var(--ff-text-tertiary)]">Work</dt><dd className="text-[var(--ff-text-primary)]">{permit.work_description ?? '—'}</dd></div>
      </dl>

      <div>
        <h2 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-3">Preconditions</h2>
        <div className="space-y-2">
          {preconditions.length === 0 && <p className="text-sm text-[var(--ff-text-tertiary)]">No preconditions defined for this type.</p>}
          {preconditions.map((pc) => (
            <label key={pc.text} className="flex items-center gap-2 text-sm text-[var(--ff-text-primary)]">
              <input type="checkbox" disabled={busy || ['expired', 'closed', 'rejected'].includes(effective)} checked={confirmed.includes(pc.text)} onChange={(e) => togglePrecondition(pc.text, e.target.checked)} />
              {pc.text}{pc.required && <span className="text-red-500">*</span>}
            </label>
          ))}
        </div>
      </div>

      {allowed.length > 0 && (
        <div className="flex flex-wrap gap-2 pt-2">
          {allowed.map((target) => {
            const blockApprove = target === 'approved' && !requiredMet;
            return (
              <button key={target} disabled={busy || blockApprove} title={blockApprove ? 'Confirm all mandatory preconditions first' : ''}
                onClick={() => patch({ status: target })}
                className={`px-4 py-2 rounded-lg text-white disabled:opacity-50 transition-colors ${target === 'rejected' ? 'bg-red-600 hover:bg-red-700' : 'bg-[var(--ff-primary-500)] hover:bg-[var(--ff-primary-600)]'}`}>
                {target === 'approved' ? 'Approve' : target === 'rejected' ? 'Reject' : target === 'active' ? 'Activate' : target === 'closed' ? 'Close' : PERMIT_STATUS_CONFIG[target].label}
              </button>
            );
          })}
        </div>
      )}

      <div className="flex justify-end pt-2">
        <button onClick={remove} className="flex items-center gap-2 px-4 py-2 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg">
          <Trash2 className="w-4 h-4" /> Delete
        </button>
      </div>
    </div>
  );
}

const PermitDetailPage: NextPage = () => {
  const router = useRouter();
  const { permitId } = router.query;
  return (
    <AppLayout>
      <Head><title>Permit | FibreFlow</title></Head>
      <ModulePage config={projectsConfig}>{typeof permitId === 'string' ? <Detail id={permitId} /> : null}</ModulePage>
    </AppLayout>
  );
};

export const getServerSideProps = async () => ({ props: {} });

export default PermitDetailPage;
