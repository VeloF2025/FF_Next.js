/**
 * H&S Request Permit to Work
 * /health-safety/permits/new
 */

import type { NextPage } from 'next';
import React, { useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import useSWR from 'swr';
import { AppLayout } from '@/components/layout/AppLayout';
import { ModulePage } from '@/components/module-page';
import { healthSafetyConfig } from '@/modules/navigation';
import { ChevronLeft, Save } from 'lucide-react';

const fetcher = (url: string) => fetch(url, { credentials: 'include' }).then((r) => r.json());
const inputCls = 'w-full px-3 py-2 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-primary-500)]';

interface PType { id: string; name: string; }

function RequestContent() {
  const router = useRouter();
  const { data: typesData } = useSWR('/api/health-safety/permits/types', fetcher);
  const { data: projData } = useSWR('/api/projects', fetcher);
  const types: PType[] = typesData?.data?.types ?? [];
  const projects = Array.isArray(projData?.data) ? projData.data : [];

  const [form, setForm] = useState({ permit_type_id: '', title: '', project_id: '', location: '', work_description: '', valid_from: '', valid_to: '' });
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!form.permit_type_id || !form.title) { setErr('Permit type and title are required'); return; }
    setSaving(true);
    try {
      const res = await fetch('/api/health-safety/permits', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          permit_type_id: form.permit_type_id, title: form.title, project_id: form.project_id || undefined,
          location: form.location || undefined, work_description: form.work_description || undefined,
          valid_from: form.valid_from || undefined, valid_to: form.valid_to || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok || json?.success === false) { setErr(json?.error?.message || json?.error || 'Failed'); setSaving(false); return; }
      router.push(`/health-safety/permits/${json.data.id}`);
    } catch { setErr('Network error'); setSaving(false); }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/health-safety/permits" className="p-2 hover:bg-[var(--ff-bg-tertiary)] rounded-lg transition-colors">
          <ChevronLeft className="w-5 h-5 text-[var(--ff-text-secondary)]" />
        </Link>
        <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">Request Permit</h1>
      </div>

      {err && <div className="p-3 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-lg text-sm">{err}</div>}

      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">Permit type *</label>
          <select className={inputCls} value={form.permit_type_id} onChange={(e) => set('permit_type_id', e.target.value)}>
            <option value="">Select type…</option>
            {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">Title *</label>
          <input className={inputCls} value={form.title} onChange={(e) => set('title', e.target.value)} />
        </div>
        <div>
          <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">Project</label>
          <select className={inputCls} value={form.project_id} onChange={(e) => set('project_id', e.target.value)}>
            <option value="">Select project…</option>
            {projects.map((p: { id: string; name: string }) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">Location</label>
          <input className={inputCls} value={form.location} onChange={(e) => set('location', e.target.value)} />
        </div>
        <div>
          <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">Work description</label>
          <textarea className={inputCls} rows={3} value={form.work_description} onChange={(e) => set('work_description', e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">Valid from</label>
            <input type="datetime-local" className={inputCls} value={form.valid_from} onChange={(e) => set('valid_from', e.target.value)} />
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">Valid to</label>
            <input type="datetime-local" className={inputCls} value={form.valid_to} onChange={(e) => set('valid_to', e.target.value)} />
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Link href="/health-safety/permits" className="px-4 py-2 text-[var(--ff-text-secondary)] hover:bg-[var(--ff-bg-tertiary)] rounded-lg">Cancel</Link>
          <button type="submit" disabled={saving} className="flex items-center gap-2 px-4 py-2 bg-[var(--ff-primary-500)] hover:bg-[var(--ff-primary-600)] disabled:opacity-60 text-white rounded-lg">
            <Save className="w-4 h-4" /> {saving ? 'Saving…' : 'Request'}
          </button>
        </div>
      </form>
    </div>
  );
}

const RequestPage: NextPage = () => (
  <AppLayout>
    <Head><title>Request Permit | FibreFlow</title></Head>
    <ModulePage config={healthSafetyConfig}><RequestContent /></ModulePage>
  </AppLayout>
);

export const getServerSideProps = async () => ({ props: {} });

export default RequestPage;
