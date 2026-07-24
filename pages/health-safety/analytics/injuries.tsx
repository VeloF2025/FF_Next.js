/**
 * H&S Injury classification entry
 * /health-safety/analytics/injuries
 */

import type { NextPage } from 'next';
import React, { useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import useSWR, { mutate } from 'swr';
import { AppLayout } from '@/components/layout/AppLayout';
import { ModulePage } from '@/components/module-page';
import { projectsConfig } from '@/modules/navigation';
import { ChevronLeft, Save, Trash2 } from 'lucide-react';
import { INJURY_CLASSIFICATIONS } from '@/modules/health-safety/types/ltifr.types';

const fetcher = (url: string) => fetch(url, { credentials: 'include' }).then((r) => r.json());
const KEY = '/api/health-safety/injuries';
const inputCls = 'px-3 py-2 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-primary-500)]';

function classLabel(v: string) { return INJURY_CLASSIFICATIONS.find((c) => c.value === v)?.label ?? v; }

interface Row { id: string; project_name: string | null; injury_date: string; classification: string; days_lost: number; }

function InjuriesContent() {
  const { data: projData } = useSWR('/api/projects', fetcher);
  const { data } = useSWR(KEY, fetcher);
  const projects = Array.isArray(projData?.data) ? projData.data : [];
  const rows: Row[] = Array.isArray(data?.data?.injuries) ? data.data.injuries : [];

  const [form, setForm] = useState({ project_id: '', injury_date: '', classification: 'lost_time', days_lost: '', description: '' });
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!form.injury_date) { setErr('Injury date is required'); return; }
    setSaving(true);
    try {
      const res = await fetch(KEY, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_id: form.project_id || undefined, injury_date: form.injury_date, classification: form.classification, days_lost: form.days_lost ? parseInt(form.days_lost, 10) : 0, description: form.description || undefined }) });
      const json = await res.json();
      if (!res.ok || json?.success === false) { setErr(json?.error?.message || json?.error || 'Failed'); return; }
      set('injury_date', ''); set('days_lost', ''); set('description', ''); mutate(KEY);
    } catch { setErr('Network error'); } finally { setSaving(false); }
  }

  async function remove(id: string) {
    await fetch(`${KEY}?id=${id}`, { method: 'DELETE' });
    mutate(KEY);
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/health-safety/analytics" className="p-2 hover:bg-[var(--ff-bg-tertiary)] rounded-lg transition-colors"><ChevronLeft className="w-5 h-5 text-[var(--ff-text-secondary)]" /></Link>
        <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">Injury Classification</h1>
      </div>

      <form onSubmit={submit} className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-4 space-y-3">
        {err && <div className="p-2 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded text-sm">{err}</div>}
        <div className="grid gap-3 sm:grid-cols-2">
          <select className={inputCls} value={form.project_id} onChange={(e) => set('project_id', e.target.value)}>
            <option value="">Company-wide (no project)</option>
            {projects.map((p: { id: string; name: string }) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <input className={inputCls} type="date" value={form.injury_date} onChange={(e) => set('injury_date', e.target.value)} />
          <select className={inputCls} value={form.classification} onChange={(e) => set('classification', e.target.value)}>
            {INJURY_CLASSIFICATIONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
          <input className={inputCls} type="number" min="0" placeholder="Days lost" value={form.days_lost} onChange={(e) => set('days_lost', e.target.value)} />
          <input className={`${inputCls} sm:col-span-2`} placeholder="Description (optional)" value={form.description} onChange={(e) => set('description', e.target.value)} />
        </div>
        <div className="flex justify-end">
          <button type="submit" disabled={saving} className="flex items-center gap-2 px-4 py-2 bg-[var(--ff-primary-500)] hover:bg-[var(--ff-primary-600)] disabled:opacity-60 text-white rounded-lg"><Save className="w-4 h-4" /> {saving ? 'Saving…' : 'Record injury'}</button>
        </div>
      </form>

      {rows.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-[var(--ff-border-light)]">
          <table className="w-full text-sm">
            <thead className="bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)]"><tr>
              <th className="text-left px-4 py-2 font-medium">Date</th><th className="text-left px-4 py-2 font-medium">Project</th><th className="text-left px-4 py-2 font-medium">Classification</th><th className="text-left px-4 py-2 font-medium">Days lost</th><th className="px-4 py-2"></th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-[var(--ff-border-light)]">
                  <td className="px-4 py-2 text-[var(--ff-text-secondary)]">{r.injury_date?.slice(0, 10)}</td>
                  <td className="px-4 py-2 text-[var(--ff-text-primary)]">{r.project_name ?? 'Company-wide'}</td>
                  <td className="px-4 py-2 text-[var(--ff-text-primary)]">{classLabel(r.classification)}</td>
                  <td className="px-4 py-2 text-[var(--ff-text-secondary)]">{r.days_lost}</td>
                  <td className="px-4 py-2 text-right"><button onClick={() => remove(r.id)} className="text-red-500 hover:text-red-600 p-1"><Trash2 className="w-4 h-4" /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const InjuriesPage: NextPage = () => (
  <AppLayout>
    <Head><title>Injury Classification | FibreFlow</title></Head>
    <ModulePage config={projectsConfig}><InjuriesContent /></ModulePage>
  </AppLayout>
);

export const getServerSideProps = async () => ({ props: {} });

export default InjuriesPage;
