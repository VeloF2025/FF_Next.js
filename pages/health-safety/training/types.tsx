/**
 * H&S Training Types admin
 * /health-safety/training/types - Manage the training/competency catalogue
 */

import type { NextPage } from 'next';
import React, { useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import useSWR, { mutate } from 'swr';
import { AppLayout } from '@/components/layout/AppLayout';
import { ModulePage } from '@/components/module-page';
import { projectsConfig } from '@/modules/navigation';
import { ChevronLeft, Plus, Shield } from 'lucide-react';

const fetcher = (url: string) => fetch(url).then((r) => r.json());
const KEY = '/api/health-safety/training/types?include_inactive=true';
const inputCls =
  'px-3 py-2 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-primary-500)]';

interface TType {
  id: string;
  code: string;
  name: string;
  validity_months: number | null;
  is_statutory: boolean;
  is_active: boolean;
}

function TypesContent() {
  const { data, isLoading } = useSWR(KEY, fetcher);
  const types: TType[] = Array.isArray(data?.data?.types) ? data.data.types : [];
  const [form, setForm] = useState({ code: '', name: '', validity_months: '', is_statutory: true });
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!form.code || !form.name) { setErr('Code and name are required'); return; }
    setSaving(true);
    const res = await fetch('/api/health-safety/training/types', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: form.code,
        name: form.name,
        validity_months: form.validity_months ? parseInt(form.validity_months, 10) : null,
        is_statutory: form.is_statutory,
      }),
    });
    const json = await res.json();
    setSaving(false);
    if (!res.ok || json?.success === false) {
      setErr(json?.error?.message || json?.error || 'Failed to create type');
      return;
    }
    setForm({ code: '', name: '', validity_months: '', is_statutory: true });
    mutate(KEY);
  }

  async function toggleActive(t: TType) {
    await fetch(`/api/health-safety/training/types/${t.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: !t.is_active }),
    });
    mutate(KEY);
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/health-safety/training" className="p-2 hover:bg-[var(--ff-bg-tertiary)] rounded-lg transition-colors">
          <ChevronLeft className="w-5 h-5 text-[var(--ff-text-secondary)]" />
        </Link>
        <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">Training Types</h1>
      </div>

      <form onSubmit={add} className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-4 space-y-3">
        {err && <div className="p-2 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded text-sm">{err}</div>}
        <div className="grid gap-3 sm:grid-cols-2">
          <input className={inputCls} placeholder="Code (e.g. rigging)" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
          <input className={inputCls} placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <input className={inputCls} type="number" min="1" placeholder="Validity (months, blank = never)" value={form.validity_months} onChange={(e) => setForm({ ...form, validity_months: e.target.value })} />
          <label className="flex items-center gap-2 text-sm text-[var(--ff-text-secondary)]">
            <input type="checkbox" checked={form.is_statutory} onChange={(e) => setForm({ ...form, is_statutory: e.target.checked })} />
            Statutory (blocks the gate when expired)
          </label>
        </div>
        <div className="flex justify-end">
          <button type="submit" disabled={saving} className="flex items-center gap-2 px-4 py-2 bg-[var(--ff-primary-500)] hover:bg-[var(--ff-primary-600)] disabled:opacity-60 text-white rounded-lg">
            <Plus className="w-4 h-4" /> {saving ? 'Adding…' : 'Add type'}
          </button>
        </div>
      </form>

      {isLoading ? (
        <div className="h-32 bg-[var(--ff-bg-tertiary)] rounded-lg animate-pulse" />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[var(--ff-border-light)]">
          <table className="w-full text-sm">
            <thead className="bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)]">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Name</th>
                <th className="text-left px-4 py-2 font-medium">Code</th>
                <th className="text-left px-4 py-2 font-medium">Validity</th>
                <th className="text-left px-4 py-2 font-medium">Statutory</th>
                <th className="text-left px-4 py-2 font-medium">Active</th>
              </tr>
            </thead>
            <tbody>
              {types.map((t) => (
                <tr key={t.id} className="border-t border-[var(--ff-border-light)]">
                  <td className="px-4 py-2 text-[var(--ff-text-primary)]">{t.name}</td>
                  <td className="px-4 py-2 text-[var(--ff-text-tertiary)]">{t.code}</td>
                  <td className="px-4 py-2 text-[var(--ff-text-secondary)]">{t.validity_months ? `${t.validity_months} mo` : 'Never'}</td>
                  <td className="px-4 py-2">{t.is_statutory && <Shield className="w-4 h-4 text-[var(--ff-primary-500)]" />}</td>
                  <td className="px-4 py-2">
                    <button onClick={() => toggleActive(t)} className={`px-2 py-0.5 text-xs rounded ${t.is_active ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-tertiary)]'}`}>
                      {t.is_active ? 'Active' : 'Inactive'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const TypesPage: NextPage = () => (
  <AppLayout>
    <Head>
      <title>Training Types | FibreFlow</title>
    </Head>
    <ModulePage config={projectsConfig}>
      <TypesContent />
    </ModulePage>
  </AppLayout>
);

export const getServerSideProps = async () => ({ props: {} });

export default TypesPage;
