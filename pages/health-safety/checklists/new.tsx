/**
 * New H&S Checklist Template Page
 * /health-safety/checklists/new
 */

import type { NextPage, GetServerSideProps } from 'next';
import React, { useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { AppLayout } from '@/components/layout/AppLayout';
import { ModulePage } from '@/components/module-page';
import { healthSafetyConfig } from '@/modules/navigation';
import { ClipboardCheck, ChevronLeft } from 'lucide-react';
import { log } from '@/lib/logger';
import { CHECKLIST_CATEGORIES } from '@/modules/health-safety/types/checklist.types';
import type { ChecklistCategory } from '@/modules/health-safety/types/checklist.types';

const inputClass =
  'w-full px-4 py-2 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] placeholder:text-[var(--ff-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-primary-500)]';
const labelClass = 'block text-sm font-medium text-[var(--ff-text-primary)] mb-1';

function NewChecklistContent() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [category, setCategory] = useState<ChecklistCategory>('site_conditions');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch('/api/health-safety/checklists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name, category, description: description || undefined }),
      });

      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        throw new Error(err?.error?.message || 'Failed to create checklist template');
      }

      const body = await res.json();
      router.push(`/health-safety/checklists/${body.data.id}`);
    } catch (err) {
      log.error('Failed to create checklist template', { error: err });
      setError(err instanceof Error ? err.message : 'Failed to create checklist template');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center gap-4">
        <Link
          href="/health-safety/checklists"
          className="p-2 hover:bg-[var(--ff-bg-tertiary)] rounded-lg transition-colors"
        >
          <ChevronLeft className="w-5 h-5 text-[var(--ff-text-secondary)]" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">New Checklist Template</h1>
          <p className="text-sm text-[var(--ff-text-secondary)]">Create a new H&S checklist template</p>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="tpl_name" className={labelClass}>
            Name *
          </label>
          <input
            id="tpl_name"
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Working at Heights — Daily Checklist"
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor="tpl_category" className={labelClass}>
            Category *
          </label>
          <select
            id="tpl_category"
            value={category}
            onChange={(e) => setCategory(e.target.value as ChecklistCategory)}
            required
            className={inputClass}
          >
            {Object.values(CHECKLIST_CATEGORIES).map((cat) => (
              <option key={cat.value} value={cat.value}>
                {cat.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="tpl_description" className={labelClass}>
            Description
          </label>
          <textarea
            id="tpl_description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="What does this checklist cover?"
            className={`${inputClass} resize-y`}
          />
        </div>

        <div className="flex items-center gap-4 pt-4 border-t border-[var(--ff-border-light)]">
          <button
            type="submit"
            disabled={submitting || !name}
            className="flex items-center gap-2 px-6 py-2.5 bg-[var(--ff-primary-500)] hover:bg-[var(--ff-primary-600)] disabled:opacity-50 text-white font-medium rounded-lg transition-colors"
          >
            <ClipboardCheck className="w-4 h-4" />
            {submitting ? 'Creating...' : 'Create Template'}
          </button>
          <Link
            href="/health-safety/checklists"
            className="px-6 py-2.5 text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] transition-colors"
          >
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}

const NewChecklistPage: NextPage = () => (
  <AppLayout>
    <Head>
      <title>New Checklist Template | H&S | FibreFlow</title>
    </Head>
    <ModulePage config={healthSafetyConfig}>
      <NewChecklistContent />
    </ModulePage>
  </AppLayout>
);

export const getServerSideProps: GetServerSideProps = async () => ({ props: {} });

export default NewChecklistPage;
