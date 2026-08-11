/**
 * H&S PPE issue detail — acknowledge / edit / delete
 * /health-safety/ppe/[issuanceId]
 */

import type { NextPage } from 'next';
import React, { useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import useSWR, { mutate } from 'swr';
import { AppLayout } from '@/components/layout/AppLayout';
import { ModulePage } from '@/components/module-page';
import { healthSafetyConfig } from '@/modules/navigation';
import { ChevronLeft, CheckCircle2, Trash2, PenLine } from 'lucide-react';
import { ReplacementBadge } from '@/modules/health-safety/components/ppe/ReplacementBadge';
import { PPEAcknowledgementPanel } from '@/modules/health-safety/components/ppe/PPEAcknowledgementPanel';
import type { PPEReplacementStatus } from '@/modules/health-safety/types/ppe.types';

const fetcher = (url: string) => fetch(url, { credentials: 'include' }).then((r) => r.json());
const inputCls = 'px-3 py-2 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-primary-500)]';

interface Row {
  id: string; worker_name: string; item_name: string; size: string | null; quantity: number;
  issued_date: string; replacement_due: string | null; replacement_status: PPEReplacementStatus;
  signature_name: string | null; signed_at: string | null; project_name: string | null;
  // Carried by `i.*` in the issuance list query; needed to find the worker's
  // acknowledgement sheet, which is per worker rather than per issue.
  staff_id: string | null; team_member_id: string | null;
  contractor_id: string | null; project_id: string | null;
}

function Detail({ id }: { id: string }) {
  const router = useRouter();
  // The list carries the joined + derived fields; find our row.
  const { data } = useSWR('/api/health-safety/ppe/issuance', fetcher);
  const row: Row | undefined = (data?.data?.issuance ?? []).find((r: Row) => r.id === id);
  const [sig, setSig] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function acknowledge(e: React.FormEvent) {
    e.preventDefault();
    if (!sig.trim()) return;
    setBusy(true); setMsg(null);
    try {
      const res = await fetch(`/api/health-safety/ppe/issuance/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ signature_name: sig.trim() }),
      });
      if (res.ok) { setSig(''); mutate('/api/health-safety/ppe/issuance'); }
      else setMsg('Failed to sign');
    } catch { setMsg('Network error'); } finally { setBusy(false); }
  }

  async function remove() {
    if (!confirm('Delete this PPE issue record?')) return;
    try {
      const res = await fetch(`/api/health-safety/ppe/issuance/${id}`, { method: 'DELETE' });
      if (res.ok) router.push('/health-safety/ppe'); else setMsg('Failed to delete');
    } catch { setMsg('Network error'); }
  }

  if (!row) return <div className="text-[var(--ff-text-secondary)]">Loading…</div>;

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/health-safety/ppe" className="p-2 hover:bg-[var(--ff-bg-tertiary)] rounded-lg transition-colors">
            <ChevronLeft className="w-5 h-5 text-[var(--ff-text-secondary)]" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">{row.item_name}</h1>
            <p className="text-sm text-[var(--ff-text-secondary)]">{row.worker_name}{row.project_name ? ` · ${row.project_name}` : ''}</p>
          </div>
        </div>
        <ReplacementBadge status={row.replacement_status} />
      </div>

      {msg && <div className="p-2 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded text-sm">{msg}</div>}

      <dl className="grid grid-cols-2 gap-4 text-sm bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-4">
        <div><dt className="text-[var(--ff-text-tertiary)]">Size / Qty</dt><dd className="text-[var(--ff-text-primary)]">{row.size ?? '—'} × {row.quantity}</dd></div>
        <div><dt className="text-[var(--ff-text-tertiary)]">Issued</dt><dd className="text-[var(--ff-text-primary)]">{row.issued_date?.slice(0, 10)}</dd></div>
        <div><dt className="text-[var(--ff-text-tertiary)]">Replacement due</dt><dd className="text-[var(--ff-text-primary)]">{row.replacement_due ? row.replacement_due.slice(0, 10) : 'No schedule'}</dd></div>
        <div><dt className="text-[var(--ff-text-tertiary)]">Acknowledged</dt><dd className="text-[var(--ff-text-primary)]">{row.signature_name ? `${row.signature_name} (${row.signed_at?.slice(0, 10)})` : 'Not signed'}</dd></div>
      </dl>

      {!row.signature_name && (
        <form onSubmit={acknowledge} className="flex flex-wrap gap-2">
          <input className={`${inputCls} flex-1 min-w-[200px]`} placeholder="Type worker name to acknowledge receipt" value={sig} onChange={(e) => setSig(e.target.value)} />
          <button type="submit" disabled={busy} className="flex items-center gap-2 px-4 py-2 bg-[var(--ff-primary-500)] hover:bg-[var(--ff-primary-600)] disabled:opacity-60 text-white rounded-lg">
            <PenLine className="w-4 h-4" /> Acknowledge
          </button>
        </form>
      )}
      {row.signature_name && (
        <p className="flex items-center gap-2 text-green-600 dark:text-green-400 text-sm"><CheckCircle2 className="w-4 h-4" /> Receipt acknowledged by {row.signature_name}</p>
      )}

      <PPEAcknowledgementPanel
        staffId={row.staff_id}
        teamMemberId={row.team_member_id}
        workerName={row.worker_name}
        contractorId={row.contractor_id}
        projectId={row.project_id}
      />

      <div className="flex justify-end pt-2">
        <button onClick={remove} className="flex items-center gap-2 px-4 py-2 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg">
          <Trash2 className="w-4 h-4" /> Delete
        </button>
      </div>
    </div>
  );
}

const DetailPage: NextPage = () => {
  const router = useRouter();
  const { issuanceId } = router.query;
  return (
    <AppLayout>
      <Head><title>PPE Issue | FibreFlow</title></Head>
      <ModulePage config={healthSafetyConfig}>{typeof issuanceId === 'string' ? <Detail id={issuanceId} /> : null}</ModulePage>
    </AppLayout>
  );
};

export const getServerSideProps = async () => ({ props: {} });

export default DetailPage;
