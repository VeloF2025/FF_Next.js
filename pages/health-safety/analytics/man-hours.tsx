/**
 * H&S Man-Hours entry
 * /health-safety/analytics/man-hours
 */

import type { NextPage } from 'next';
import React, { useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import useSWR, { mutate } from 'swr';
import { AppLayout } from '@/components/layout/AppLayout';
import { ModulePage } from '@/components/module-page';
import { healthSafetyConfig } from '@/modules/navigation';
import { ChevronLeft, Save, Trash2 } from 'lucide-react';

const fetcher = (url: string) => fetch(url, { credentials: 'include' }).then((r) => r.json());
const KEY = '/api/health-safety/man-hours';
const inputCls = 'px-3 py-2 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-primary-500)]';
const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

interface Row { id: string; project_name: string | null; period_year: number; period_month: number; hours_worked: string; }

function ManHoursContent() {
  const { data: projData } = useSWR('/api/projects', fetcher);
  const { data } = useSWR(KEY, fetcher);
  const projects = Array.isArray(projData?.data) ? projData.data : [];
  const rows: Row[] = Array.isArray(data?.data?.man_hours) ? data.data.man_hours : [];

  const now = new Date();
  const [form, setForm] = useState({ project_id: '', period_year: String(now.getFullYear()), period_month: String(now.getMonth() + 1), hours_worked: '', headcount: '' });
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!form.hours_worked) { setErr('Hours are required'); return; }
    setSaving(true);
    try {
      const res = await fetch(KEY, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_id: form.project_id || undefined, period_year: parseInt(form.period_year, 10), period_month: parseInt(form.period_month, 10), hours_worked: parseFloat(form.hours_worked), headcount: form.headcount ? parseInt(form.headcount, 10) : undefined }) });
      const json = await res.json();
      if (!res.ok || json?.success === false) { setErr(json?.error?.message || json?.error || 'Failed'); return; }
      set('hours_worked', ''); set('headcount', ''); mutate(KEY);
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
        <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">Man-Hours</h1>
      </div>

      <form onSubmit={submit} className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-4 space-y-3">
        {err && <div className="p-2 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded text-sm">{err}</div>}
        <div className="grid gap-3 sm:grid-cols-2">
          <select className={inputCls} value={form.project_id} onChange={(e) => set('project_id', e.target.value)}>
            <option value="">Company-wide (no project)</option>
            {projects.map((p: { id: string; name: string }) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <div className="grid grid-cols-2 gap-2">
            <select className={inputCls} value={form.period_month} onChange={(e) => set('period_month', e.target.value)}>
              {MONTHS.slice(1).map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
            </select>
            <input className={inputCls} type="number" value={form.period_year} onChange={(e) => set('period_year', e.target.value)} />
          </div>
          <input className={inputCls} type="number" step="0.01" placeholder="Hours worked" value={form.hours_worked} onChange={(e) => set('hours_worked', e.target.value)} />
          <input className={inputCls} type="number" placeholder="Headcount (optional)" value={form.headcount} onChange={(e) => set('headcount', e.target.value)} />
        </div>
        <div className="flex justify-end">
          <button type="submit" disabled={saving} className="flex items-center gap-2 px-4 py-2 bg-[var(--ff-primary-500)] hover:bg-[var(--ff-primary-600)] disabled:opacity-60 text-white rounded-lg"><Save className="w-4 h-4" /> {saving ? 'Saving…' : 'Save hours'}</button>
        </div>
      </form>

      {rows.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-[var(--ff-border-light)]">
          <table className="w-full text-sm">
            <thead className="bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)]"><tr>
              <th className="text-left px-4 py-2 font-medium">Project</th><th className="text-left px-4 py-2 font-medium">Period</th><th className="text-left px-4 py-2 font-medium">Hours</th><th className="px-4 py-2"></th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-[var(--ff-border-light)]">
                  <td className="px-4 py-2 text-[var(--ff-text-primary)]">{r.project_name ?? 'Company-wide'}</td>
                  <td className="px-4 py-2 text-[var(--ff-text-secondary)]">{MONTHS[r.period_month]} {r.period_year}</td>
                  <td className="px-4 py-2 text-[var(--ff-text-secondary)]">{Number(r.hours_worked).toLocaleString()}</td>
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

const ManHoursPage: NextPage = () => (
  <AppLayout>
    <Head><title>Man-Hours | FibreFlow</title></Head>
    <ModulePage config={healthSafetyConfig}><ManHoursContent /></ModulePage>
  </AppLayout>
);

export const getServerSideProps = async () => ({ props: {} });

export default ManHoursPage;
