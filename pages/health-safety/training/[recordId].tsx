/**
 * H&S Worker Training Record detail / edit
 * /health-safety/training/[recordId]
 */

import type { NextPage } from 'next';
import React, { useState, useEffect, useRef } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import useSWR from 'swr';
import { AppLayout } from '@/components/layout/AppLayout';
import { ModulePage } from '@/components/module-page';
import { projectsConfig } from '@/modules/navigation';
import { ChevronLeft, Save, Trash2 } from 'lucide-react';
import { CompetencyBadge, type CompetencyStatus } from '@/modules/health-safety/components/training/CompetencyBadge';

const fetcher = (url: string) => fetch(url).then((r) => r.json());
const inputCls =
  'w-full px-3 py-2 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-primary-500)]';

interface TrainingRecordDetail {
  id: string;
  worker_name: string;
  training_name: string;
  is_statutory: boolean;
  completed_date: string;
  expiry_date: string | null;
  certificate_number: string | null;
  issued_by: string | null;
  certificate_url: string | null;
  competency_status: CompetencyStatus;
}

function RecordContent({ recordId }: { recordId: string }) {
  const router = useRouter();
  // The list endpoint carries the joined+derived fields; find our row in it.
  const { data } = useSWR('/api/health-safety/training/records', fetcher);
  const record: TrainingRecordDetail | undefined = (data?.data?.records ?? []).find(
    (r: TrainingRecordDetail) => r.id === recordId
  );

  const [form, setForm] = useState({ completed_date: '', expiry_date: '', certificate_number: '', issued_by: '', certificate_url: '' });
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Seed the edit form once, when the record first arrives. SWR revalidation
  // hands back a fresh object reference on every focus/refetch — re-seeding on
  // that would silently discard the user's in-progress edits.
  const seeded = useRef(false);

  useEffect(() => {
    if (record && !seeded.current) {
      seeded.current = true;
      setForm({
        completed_date: record.completed_date?.slice(0, 10) ?? '',
        expiry_date: record.expiry_date?.slice(0, 10) ?? '',
        certificate_number: record.certificate_number ?? '',
        issued_by: record.issued_by ?? '',
        certificate_url: record.certificate_url ?? '',
      });
    }
  }, [record]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/health-safety/training/records/${recordId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          completed_date: form.completed_date || undefined,
          expiry_date: form.expiry_date || null,
          certificate_number: form.certificate_number || undefined,
          issued_by: form.issued_by || undefined,
          certificate_url: form.certificate_url || undefined,
        }),
      });
      setMsg(res.ok ? 'Saved' : 'Failed to save');
      if (res.ok) router.replace(router.asPath);
    } catch {
      setMsg('Network error saving record');
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!confirm('Delete this training record?')) return;
    try {
      const res = await fetch(`/api/health-safety/training/records/${recordId}`, { method: 'DELETE' });
      if (res.ok) router.push('/health-safety/training');
      else setMsg('Failed to delete');
    } catch {
      setMsg('Network error deleting record');
    }
  }

  if (!record) {
    return <div className="text-[var(--ff-text-secondary)]">Loading record…</div>;
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/health-safety/training" className="p-2 hover:bg-[var(--ff-bg-tertiary)] rounded-lg transition-colors">
            <ChevronLeft className="w-5 h-5 text-[var(--ff-text-secondary)]" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">{record.worker_name}</h1>
            <p className="text-sm text-[var(--ff-text-secondary)]">{record.training_name}{record.is_statutory ? ' · statutory' : ''}</p>
          </div>
        </div>
        <CompetencyBadge status={record.competency_status} />
      </div>

      {msg && <div className="p-2 bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)] rounded text-sm">{msg}</div>}

      <form onSubmit={save} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">Completed date</label>
            <input type="date" className={inputCls} value={form.completed_date} onChange={(e) => setForm({ ...form, completed_date: e.target.value })} />
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">Expiry date</label>
            <input type="date" className={inputCls} value={form.expiry_date} onChange={(e) => setForm({ ...form, expiry_date: e.target.value })} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">Certificate number</label>
            <input type="text" className={inputCls} value={form.certificate_number} onChange={(e) => setForm({ ...form, certificate_number: e.target.value })} />
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">Issued by</label>
            <input type="text" className={inputCls} value={form.issued_by} onChange={(e) => setForm({ ...form, issued_by: e.target.value })} />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">Certificate URL</label>
          <input type="url" className={inputCls} value={form.certificate_url} onChange={(e) => setForm({ ...form, certificate_url: e.target.value })} />
        </div>
        <div className="flex justify-between pt-2">
          <button type="button" onClick={remove} className="flex items-center gap-2 px-4 py-2 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg">
            <Trash2 className="w-4 h-4" /> Delete
          </button>
          <button type="submit" disabled={saving} className="flex items-center gap-2 px-4 py-2 bg-[var(--ff-primary-500)] hover:bg-[var(--ff-primary-600)] disabled:opacity-60 text-white rounded-lg">
            <Save className="w-4 h-4" /> {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  );
}

const RecordPage: NextPage = () => {
  const router = useRouter();
  const { recordId } = router.query;
  return (
    <AppLayout>
      <Head>
        <title>Training Record | FibreFlow</title>
      </Head>
      <ModulePage config={projectsConfig}>
        {typeof recordId === 'string' ? <RecordContent recordId={recordId} /> : null}
      </ModulePage>
    </AppLayout>
  );
};

export const getServerSideProps = async () => ({ props: {} });

export default RecordPage;
