/**
 * H&S PPE Catalogue admin
 * /health-safety/ppe/catalogue
 */

import type { NextPage } from 'next';
import React, { useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import useSWR, { mutate } from 'swr';
import { AppLayout } from '@/components/layout/AppLayout';
import { ModulePage } from '@/components/module-page';
import { projectsConfig } from '@/modules/navigation';
import { ChevronLeft, Plus } from 'lucide-react';
import { PPE_CATEGORIES } from '@/modules/health-safety/types/ppe.types';

const fetcher = (url: string) => fetch(url, { credentials: 'include' }).then((r) => r.json());
const KEY = '/api/health-safety/ppe/catalogue?include_inactive=true';
const inputCls = 'px-3 py-2 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-primary-500)]';

interface Item { id: string; code: string; name: string; category: string; lifespan_months: number | null; is_active: boolean; }

function CatalogueContent() {
  const { data, isLoading } = useSWR(KEY, fetcher);
  const items: Item[] = Array.isArray(data?.data?.items) ? data.data.items : [];
  const [form, setForm] = useState({ code: '', name: '', category: 'head', lifespan_months: '', sizes: '' });
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!form.code || !form.name) { setErr('Code and name are required'); return; }
    setSaving(true);
    try {
      const res = await fetch('/api/health-safety/ppe/catalogue', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: form.code, name: form.name, category: form.category,
          lifespan_months: form.lifespan_months ? parseInt(form.lifespan_months, 10) : null,
          sizes: form.sizes ? form.sizes.split(',').map((s) => s.trim()).filter(Boolean) : [],
        }),
      });
      const json = await res.json();
      if (!res.ok || json?.success === false) { setErr(json?.error?.message || json?.error || 'Failed'); return; }
      setForm({ code: '', name: '', category: 'head', lifespan_months: '', sizes: '' });
      mutate(KEY);
    } catch {
      setErr('Network error adding item');
    } finally {
      setSaving(false);
    }
  }

  async function toggle(item: Item) {
    try {
      await fetch(`/api/health-safety/ppe/catalogue/${item.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ is_active: !item.is_active }),
      });
      mutate(KEY);
    } catch {
      setErr('Network error updating item');
    }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/health-safety/ppe" className="p-2 hover:bg-[var(--ff-bg-tertiary)] rounded-lg transition-colors">
          <ChevronLeft className="w-5 h-5 text-[var(--ff-text-secondary)]" />
        </Link>
        <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">PPE Catalogue</h1>
      </div>

      <form onSubmit={add} className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-4 space-y-3">
        {err && <div className="p-2 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded text-sm">{err}</div>}
        <div className="grid gap-3 sm:grid-cols-2">
          <input className={inputCls} placeholder="Code (e.g. knee_pads)" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
          <input className={inputCls} placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <select className={inputCls} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
            {PPE_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
          <input className={inputCls} type="number" min="1" placeholder="Lifespan (months, blank = n/a)" value={form.lifespan_months} onChange={(e) => setForm({ ...form, lifespan_months: e.target.value })} />
          <input className={`${inputCls} sm:col-span-2`} placeholder="Sizes, comma-separated (optional)" value={form.sizes} onChange={(e) => setForm({ ...form, sizes: e.target.value })} />
        </div>
        <div className="flex justify-end">
          <button type="submit" disabled={saving} className="flex items-center gap-2 px-4 py-2 bg-[var(--ff-primary-500)] hover:bg-[var(--ff-primary-600)] disabled:opacity-60 text-white rounded-lg">
            <Plus className="w-4 h-4" /> {saving ? 'Adding…' : 'Add item'}
          </button>
        </div>
      </form>

      {isLoading ? <div className="h-32 bg-[var(--ff-bg-tertiary)] rounded-lg animate-pulse" /> : (
        <div className="overflow-x-auto rounded-lg border border-[var(--ff-border-light)]">
          <table className="w-full text-sm">
            <thead className="bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)]">
              <tr><th className="text-left px-4 py-2 font-medium">Name</th><th className="text-left px-4 py-2 font-medium">Category</th><th className="text-left px-4 py-2 font-medium">Lifespan</th><th className="text-left px-4 py-2 font-medium">Active</th></tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id} className="border-t border-[var(--ff-border-light)]">
                  <td className="px-4 py-2 text-[var(--ff-text-primary)]">{it.name}</td>
                  <td className="px-4 py-2 text-[var(--ff-text-secondary)] capitalize">{it.category}</td>
                  <td className="px-4 py-2 text-[var(--ff-text-secondary)]">{it.lifespan_months ? `${it.lifespan_months} mo` : 'n/a'}</td>
                  <td className="px-4 py-2">
                    <button onClick={() => toggle(it)} className={`px-2 py-0.5 text-xs rounded ${it.is_active ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-tertiary)]'}`}>{it.is_active ? 'Active' : 'Inactive'}</button>
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

const CataloguePage: NextPage = () => (
  <AppLayout>
    <Head><title>PPE Catalogue | FibreFlow</title></Head>
    <ModulePage config={projectsConfig}><CatalogueContent /></ModulePage>
  </AppLayout>
);

export const getServerSideProps = async () => ({ props: {} });

export default CataloguePage;
