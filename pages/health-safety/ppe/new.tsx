/**
 * H&S Issue PPE
 * /health-safety/ppe/new
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

const fetcher = (url: string) => fetch(url, { credentials: 'include' }).then((r) => r.json());
const inputCls = 'w-full px-3 py-2 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-primary-500)]';

interface CatItem { id: string; name: string; sizes: string[]; }

function IssueContent() {
  const router = useRouter();
  const { data: cat } = useSWR('/api/health-safety/ppe/catalogue', fetcher);
  const { data: projData } = useSWR('/api/projects', fetcher);
  const { data: pickers } = useSWR('/api/health-safety/training/pickers', fetcher);
  const items: CatItem[] = cat?.data?.items ?? [];
  const projects = Array.isArray(projData?.data) ? projData.data : [];
  const staff = pickers?.data?.staff ?? [];
  const teamMembers = pickers?.data?.team_members ?? [];

  const [workerKind, setWorkerKind] = useState<'team_member' | 'staff' | 'free'>('team_member');
  const [form, setForm] = useState({ ppe_item_id: '', worker_id: '', worker_name_free: '', project_id: '', size: '', quantity: '1', issued_date: '', signature_name: '' });
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const selectedItem = items.find((i) => i.id === form.ppe_item_id);
  const workers = workerKind === 'staff' ? staff : teamMembers;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    let worker_name = form.worker_name_free.trim();
    const payload: Record<string, unknown> = {
      ppe_item_id: form.ppe_item_id, project_id: form.project_id || undefined,
      size: form.size || undefined, quantity: parseInt(form.quantity, 10) || 1,
      issued_date: form.issued_date, signature_name: form.signature_name || undefined,
    };
    if (workerKind === 'staff' && form.worker_id) {
      payload.staff_id = form.worker_id;
      worker_name = staff.find((s: { id: string; name: string }) => s.id === form.worker_id)?.name ?? worker_name;
    } else if (workerKind === 'team_member' && form.worker_id) {
      payload.team_member_id = form.worker_id;
      worker_name = teamMembers.find((m: { id: string; name: string }) => m.id === form.worker_id)?.name ?? worker_name;
    }
    payload.worker_name = worker_name;

    if (!form.ppe_item_id || !form.issued_date || !worker_name) {
      setErr('PPE item, worker and issued date are required'); return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/health-safety/ppe/issuance', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok || json?.success === false) { setErr(json?.error?.message || json?.error || 'Failed'); setSaving(false); return; }
      router.push('/health-safety/ppe');
    } catch { setErr('Network error'); setSaving(false); }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/health-safety/ppe" className="p-2 hover:bg-[var(--ff-bg-tertiary)] rounded-lg transition-colors">
          <ChevronLeft className="w-5 h-5 text-[var(--ff-text-secondary)]" />
        </Link>
        <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">Issue PPE</h1>
      </div>

      {err && <div className="p-3 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-lg text-sm">{err}</div>}

      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">PPE item *</label>
          <select className={inputCls} value={form.ppe_item_id} onChange={(e) => { set('ppe_item_id', e.target.value); set('size', ''); }}>
            <option value="">Select item…</option>
            {items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">Worker type</label>
          <div className="flex gap-2 flex-wrap">
            {(['team_member', 'staff', 'free'] as const).map((k) => (
              <button type="button" key={k} onClick={() => { setWorkerKind(k); set('worker_id', ''); }}
                className={`px-3 py-2 text-sm rounded-lg border transition-colors ${workerKind === k ? 'bg-[var(--ff-primary-500)] text-white border-[var(--ff-primary-500)]' : 'bg-[var(--ff-bg-secondary)] text-[var(--ff-text-secondary)] border-[var(--ff-border-light)]'}`}>
                {k === 'team_member' ? 'Contractor worker' : k === 'staff' ? 'Internal staff' : 'Other (name only)'}
              </button>
            ))}
          </div>
        </div>

        {workerKind === 'free' ? (
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">Worker name *</label>
            <input className={inputCls} value={form.worker_name_free} onChange={(e) => set('worker_name_free', e.target.value)} />
          </div>
        ) : (
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">Worker *</label>
            <select className={inputCls} value={form.worker_id} onChange={(e) => set('worker_id', e.target.value)}>
              <option value="">Select worker…</option>
              {workers.map((w: { id: string; name: string }) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>
        )}

        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">Size</label>
            {selectedItem && selectedItem.sizes.length > 0 ? (
              <select className={inputCls} value={form.size} onChange={(e) => set('size', e.target.value)}>
                <option value="">—</option>
                {selectedItem.sizes.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            ) : (
              <input className={inputCls} value={form.size} onChange={(e) => set('size', e.target.value)} />
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">Qty</label>
            <input type="number" min="1" className={inputCls} value={form.quantity} onChange={(e) => set('quantity', e.target.value)} />
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">Issued *</label>
            <input type="date" className={inputCls} value={form.issued_date} onChange={(e) => set('issued_date', e.target.value)} />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">Project</label>
          <select className={inputCls} value={form.project_id} onChange={(e) => set('project_id', e.target.value)}>
            <option value="">Select project…</option>
            {projects.map((p: { id: string; name: string }) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">Acknowledgement — type name to sign (optional)</label>
          <input className={inputCls} value={form.signature_name} onChange={(e) => set('signature_name', e.target.value)} />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Link href="/health-safety/ppe" className="px-4 py-2 text-[var(--ff-text-secondary)] hover:bg-[var(--ff-bg-tertiary)] rounded-lg">Cancel</Link>
          <button type="submit" disabled={saving} className="flex items-center gap-2 px-4 py-2 bg-[var(--ff-primary-500)] hover:bg-[var(--ff-primary-600)] disabled:opacity-60 text-white rounded-lg">
            <Save className="w-4 h-4" /> {saving ? 'Saving…' : 'Issue PPE'}
          </button>
        </div>
      </form>
    </div>
  );
}

const IssuePage: NextPage = () => (
  <AppLayout>
    <Head><title>Issue PPE | FibreFlow</title></Head>
    <ModulePage config={projectsConfig}><IssueContent /></ModulePage>
  </AppLayout>
);

export const getServerSideProps = async () => ({ props: {} });

export default IssuePage;
