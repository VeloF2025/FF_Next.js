/**
 * H&S Record Worker Training
 * /health-safety/training/new - Create a worker training record
 */

import type { NextPage } from 'next';
import React, { useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import useSWR from 'swr';
import { AppLayout } from '@/components/layout/AppLayout';
import { ModulePage } from '@/components/module-page';
import { projectsConfig } from '@/modules/navigation';
import { ChevronLeft, Save } from 'lucide-react';

const fetcher = (url: string) => fetch(url).then((r) => r.json());
const inputCls =
  'w-full px-3 py-2 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-primary-500)]';

function RecordTrainingContent() {
  const router = useRouter();
  const { data: pickers } = useSWR('/api/health-safety/training/pickers', fetcher);
  const { data: typesData } = useSWR('/api/health-safety/training/types', fetcher);

  const contractors = pickers?.data?.contractors ?? [];
  const staff = pickers?.data?.staff ?? [];
  const teamMembers = pickers?.data?.team_members ?? [];
  const types = typesData?.data?.types ?? [];

  const [workerKind, setWorkerKind] = useState<'team_member' | 'staff'>('team_member');
  const [form, setForm] = useState({
    training_type_id: '',
    worker_id: '',
    contractor_id: '',
    completed_date: '',
    expiry_date: '',
    certificate_number: '',
    certificate_url: '',
    issued_by: '',
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!form.training_type_id || !form.worker_id || !form.completed_date) {
      setErr('Training type, worker and completed date are required');
      return;
    }
    // Mirrors the server rule: without a contractor, a contractor worker's
    // certificate never reaches the compliance gate.
    if (workerKind === 'team_member' && !form.contractor_id) {
      setErr('Select the contractor — it is what drives the compliance gate');
      return;
    }
    setSaving(true);
    const payload: Record<string, unknown> = {
      training_type_id: form.training_type_id,
      completed_date: form.completed_date,
      expiry_date: form.expiry_date || undefined,
      contractor_id: form.contractor_id || undefined,
      certificate_number: form.certificate_number || undefined,
      certificate_url: form.certificate_url || undefined,
      issued_by: form.issued_by || undefined,
    };
    if (workerKind === 'staff') payload.staff_id = form.worker_id;
    else payload.team_member_id = form.worker_id;

    try {
      const res = await fetch('/api/health-safety/training/records', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok || json?.success === false) {
        setErr(json?.error?.message || json?.error || 'Failed to save training record');
        setSaving(false);
        return;
      }
      router.push('/health-safety/training');
    } catch {
      setErr('Network error saving training record');
      setSaving(false);
    }
  }

  const workers = workerKind === 'staff' ? staff : teamMembers;

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/health-safety/training" className="p-2 hover:bg-[var(--ff-bg-tertiary)] rounded-lg transition-colors">
          <ChevronLeft className="w-5 h-5 text-[var(--ff-text-secondary)]" />
        </Link>
        <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">Record Training</h1>
      </div>

      {err && (
        <div className="p-3 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-lg text-sm">{err}</div>
      )}

      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">Worker type</label>
          <div className="flex gap-2">
            {(['team_member', 'staff'] as const).map((k) => (
              <button
                type="button"
                key={k}
                onClick={() => { setWorkerKind(k); set('worker_id', ''); }}
                className={`px-3 py-2 text-sm rounded-lg border transition-colors ${
                  workerKind === k
                    ? 'bg-[var(--ff-primary-500)] text-white border-[var(--ff-primary-500)]'
                    : 'bg-[var(--ff-bg-secondary)] text-[var(--ff-text-secondary)] border-[var(--ff-border-light)]'
                }`}
              >
                {k === 'team_member' ? 'Contractor worker' : 'Internal staff'}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">Worker *</label>
          <select className={inputCls} value={form.worker_id} onChange={(e) => set('worker_id', e.target.value)}>
            <option value="">Select worker…</option>
            {workers.map((w: { id: string; name: string }) => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </select>
        </div>

        {workerKind === 'team_member' && (
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
              Contractor (drives the compliance gate)
            </label>
            <select className={inputCls} value={form.contractor_id} onChange={(e) => set('contractor_id', e.target.value)}>
              <option value="">Select contractor…</option>
              {contractors.map((c: { id: string; company_name: string }) => (
                <option key={c.id} value={c.id}>{c.company_name}</option>
              ))}
            </select>
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">Training type *</label>
          <select className={inputCls} value={form.training_type_id} onChange={(e) => set('training_type_id', e.target.value)}>
            <option value="">Select training…</option>
            {types.map((t: { id: string; name: string; is_statutory: boolean }) => (
              <option key={t.id} value={t.id}>{t.name}{t.is_statutory ? ' (statutory)' : ''}</option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">Completed date *</label>
            <input type="date" className={inputCls} value={form.completed_date} onChange={(e) => set('completed_date', e.target.value)} />
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">Expiry (auto if blank)</label>
            <input type="date" className={inputCls} value={form.expiry_date} onChange={(e) => set('expiry_date', e.target.value)} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">Certificate number</label>
            <input type="text" className={inputCls} value={form.certificate_number} onChange={(e) => set('certificate_number', e.target.value)} />
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">Issued by</label>
            <input type="text" className={inputCls} value={form.issued_by} onChange={(e) => set('issued_by', e.target.value)} />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">Certificate URL</label>
          <input type="url" className={inputCls} placeholder="https://…" value={form.certificate_url} onChange={(e) => set('certificate_url', e.target.value)} />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Link href="/health-safety/training" className="px-4 py-2 text-[var(--ff-text-secondary)] hover:bg-[var(--ff-bg-tertiary)] rounded-lg">Cancel</Link>
          <button type="submit" disabled={saving} className="flex items-center gap-2 px-4 py-2 bg-[var(--ff-primary-500)] hover:bg-[var(--ff-primary-600)] disabled:opacity-60 text-white rounded-lg transition-colors">
            <Save className="w-4 h-4" />
            {saving ? 'Saving…' : 'Save record'}
          </button>
        </div>
      </form>
    </div>
  );
}

const RecordTrainingPage: NextPage = () => (
  <AppLayout>
    <Head>
      <title>Record Training | FibreFlow</title>
    </Head>
    <ModulePage config={projectsConfig}>
      <RecordTrainingContent />
    </ModulePage>
  </AppLayout>
);

export const getServerSideProps = async () => ({ props: {} });

export default RecordTrainingPage;
