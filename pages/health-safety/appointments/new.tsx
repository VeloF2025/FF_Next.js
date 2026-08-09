/**
 * H&S New Appointment Letter
 * /health-safety/appointments/new
 */

import type { NextPage } from 'next';
import React, { useState, useEffect } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import useSWR from 'swr';
import { AppLayout } from '@/components/layout/AppLayout';
import { ModulePage } from '@/components/module-page';
import { healthSafetyConfig } from '@/modules/navigation';
import { ChevronLeft, Save } from 'lucide-react';
import { APPOINTMENT_LETTER_TYPES, letterTypeDef } from '@/modules/health-safety/types/appointment.types';

const fetcher = (url: string) => fetch(url, { credentials: 'include' }).then((r) => r.json());
const inputCls = 'w-full px-3 py-2 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-primary-500)]';

function NewLetterContent() {
  const router = useRouter();
  const { data: projData } = useSWR('/api/projects', fetcher);
  const projects = Array.isArray(projData?.data) ? projData.data : [];

  const [form, setForm] = useState({ letter_type: 's16_2', project_id: '', appointer_name: '', appointer_designation: '', appointee_name: '', appointee_designation: '', scope: '', appointment_date: '', effective_from: '' });
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  // Prefill scope with the statutory default when the type changes and scope is untouched.
  useEffect(() => {
    const def = letterTypeDef(form.letter_type);
    if (def) setForm((f) => ({ ...f, scope: def.defaultScope }));
  }, [form.letter_type]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!form.appointee_name.trim()) { setErr('Appointee name is required'); return; }
    setSaving(true);
    try {
      const res = await fetch('/api/health-safety/appointments', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          letter_type: form.letter_type, project_id: form.project_id || undefined,
          appointer_name: form.appointer_name || undefined, appointer_designation: form.appointer_designation || undefined,
          appointee_name: form.appointee_name, appointee_designation: form.appointee_designation || undefined,
          scope: form.scope || undefined, appointment_date: form.appointment_date || undefined, effective_from: form.effective_from || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok || json?.success === false) { setErr(json?.error?.message || json?.error || 'Failed'); setSaving(false); return; }
      router.push(`/health-safety/appointments/${json.data.id}`);
    } catch { setErr('Network error'); setSaving(false); }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/health-safety/appointments" className="p-2 hover:bg-[var(--ff-bg-tertiary)] rounded-lg transition-colors">
          <ChevronLeft className="w-5 h-5 text-[var(--ff-text-secondary)]" />
        </Link>
        <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">New Appointment Letter</h1>
      </div>

      {err && <div className="p-3 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-lg text-sm">{err}</div>}

      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">Letter type *</label>
          <select className={inputCls} value={form.letter_type} onChange={(e) => set('letter_type', e.target.value)}>
            {APPOINTMENT_LETTER_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label} — {t.statute}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">Project</label>
          <select className={inputCls} value={form.project_id} onChange={(e) => set('project_id', e.target.value)}>
            <option value="">Select project…</option>
            {projects.map((p: { id: string; name: string }) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">Appointee name *</label>
            <input className={inputCls} value={form.appointee_name} onChange={(e) => set('appointee_name', e.target.value)} />
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">Appointee designation</label>
            <input className={inputCls} value={form.appointee_designation} onChange={(e) => set('appointee_designation', e.target.value)} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">Appointer name</label>
            <input className={inputCls} value={form.appointer_name} onChange={(e) => set('appointer_name', e.target.value)} />
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">Appointer designation</label>
            <input className={inputCls} value={form.appointer_designation} onChange={(e) => set('appointer_designation', e.target.value)} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">Appointment date</label>
            <input type="date" className={inputCls} value={form.appointment_date} onChange={(e) => set('appointment_date', e.target.value)} />
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">Effective from</label>
            <input type="date" className={inputCls} value={form.effective_from} onChange={(e) => set('effective_from', e.target.value)} />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">Scope of appointment</label>
          <textarea className={inputCls} rows={4} value={form.scope} onChange={(e) => set('scope', e.target.value)} />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Link href="/health-safety/appointments" className="px-4 py-2 text-[var(--ff-text-secondary)] hover:bg-[var(--ff-bg-tertiary)] rounded-lg">Cancel</Link>
          <button type="submit" disabled={saving} className="flex items-center gap-2 px-4 py-2 bg-[var(--ff-primary-500)] hover:bg-[var(--ff-primary-600)] disabled:opacity-60 text-white rounded-lg">
            <Save className="w-4 h-4" /> {saving ? 'Saving…' : 'Create draft'}
          </button>
        </div>
      </form>
    </div>
  );
}

const NewLetterPage: NextPage = () => (
  <AppLayout>
    <Head><title>New Appointment Letter | FibreFlow</title></Head>
    <ModulePage config={healthSafetyConfig}><NewLetterContent /></ModulePage>
  </AppLayout>
);

export const getServerSideProps = async () => ({ props: {} });

export default NewLetterPage;
