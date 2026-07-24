/**
 * H&S Log Toolbox Talk
 * /health-safety/toolbox/new
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
import { TOOLBOX_TALK_TYPES } from '@/modules/health-safety/types/toolbox.types';

const fetcher = (url: string) => fetch(url, { credentials: 'include' }).then((r) => r.json());
const inputCls =
  'w-full px-3 py-2 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-primary-500)]';

function NewTalkContent() {
  const router = useRouter();
  const { data: projData } = useSWR('/api/projects', fetcher);
  const { data: pickers } = useSWR('/api/health-safety/training/pickers', fetcher);
  const projects = Array.isArray(projData?.data) ? projData.data : [];
  const staff = pickers?.data?.staff ?? [];

  const [form, setForm] = useState({
    topic: '', talk_type: 'daily_dsti', talk_date: '', project_id: '', presenter_staff_id: '', location: '', notes: '',
  });
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!form.topic || !form.talk_date) { setErr('Topic and date are required'); return; }
    setSaving(true);
    try {
      const res = await fetch('/api/health-safety/toolbox', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: form.topic, talk_type: form.talk_type, talk_date: form.talk_date,
          project_id: form.project_id || undefined,
          presenter_staff_id: form.presenter_staff_id || undefined,
          location: form.location || undefined, notes: form.notes || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok || json?.success === false) {
        setErr(json?.error?.message || json?.error || 'Failed to save'); setSaving(false); return;
      }
      router.push(`/health-safety/toolbox/${json.data.id}`);
    } catch {
      setErr('Network error'); setSaving(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/health-safety/toolbox" className="p-2 hover:bg-[var(--ff-bg-tertiary)] rounded-lg transition-colors">
          <ChevronLeft className="w-5 h-5 text-[var(--ff-text-secondary)]" />
        </Link>
        <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">Log Toolbox Talk</h1>
      </div>

      {err && <div className="p-3 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-lg text-sm">{err}</div>}

      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">Topic *</label>
          <input className={inputCls} value={form.topic} onChange={(e) => set('topic', e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">Type</label>
            <select className={inputCls} value={form.talk_type} onChange={(e) => set('talk_type', e.target.value)}>
              {TOOLBOX_TALK_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">Date *</label>
            <input type="date" className={inputCls} value={form.talk_date} onChange={(e) => set('talk_date', e.target.value)} />
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
          <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">Presenter</label>
          <select className={inputCls} value={form.presenter_staff_id} onChange={(e) => set('presenter_staff_id', e.target.value)}>
            <option value="">Select presenter…</option>
            {staff.map((s: { id: string; name: string }) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">Location</label>
          <input className={inputCls} value={form.location} onChange={(e) => set('location', e.target.value)} />
        </div>
        <div>
          <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">Notes</label>
          <textarea className={inputCls} rows={3} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Link href="/health-safety/toolbox" className="px-4 py-2 text-[var(--ff-text-secondary)] hover:bg-[var(--ff-bg-tertiary)] rounded-lg">Cancel</Link>
          <button type="submit" disabled={saving} className="flex items-center gap-2 px-4 py-2 bg-[var(--ff-primary-500)] hover:bg-[var(--ff-primary-600)] disabled:opacity-60 text-white rounded-lg">
            <Save className="w-4 h-4" /> {saving ? 'Saving…' : 'Create talk'}
          </button>
        </div>
      </form>
    </div>
  );
}

const NewTalkPage: NextPage = () => (
  <AppLayout>
    <Head><title>Log Toolbox Talk | FibreFlow</title></Head>
    <ModulePage config={projectsConfig}><NewTalkContent /></ModulePage>
  </AppLayout>
);

export const getServerSideProps = async () => ({ props: {} });

export default NewTalkPage;
