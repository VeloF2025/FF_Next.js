/**
 * H&S Checklist Template Editor Page
 * /health-safety/checklists/[id] - Edit a template's fields and items
 */

import type { NextPage, GetServerSideProps } from 'next';
import { useState, useEffect } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import useSWR from 'swr';
import { AppLayout } from '@/components/layout/AppLayout';
import { ModulePage } from '@/components/module-page';
import { healthSafetyConfig } from '@/modules/navigation';
import { AlertTriangle, ChevronLeft, Save } from 'lucide-react';
import { log } from '@/lib/logger';
import { CHECKLIST_CATEGORIES } from '@/modules/health-safety/types/checklist.types';
import type { ChecklistCategory } from '@/modules/health-safety/types/checklist.types';
import {
  ChecklistItemsEditor,
  type EditableChecklistItem,
} from '@/modules/health-safety/components/checklists/ChecklistItemsEditor';

const fetcher = (url: string) => fetch(url, { credentials: 'include' }).then((r) => r.json());

const inputClass =
  'w-full px-4 py-2 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] placeholder:text-[var(--ff-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-primary-500)]';
const labelClass = 'block text-sm font-medium text-[var(--ff-text-primary)] mb-1';

interface TemplateData {
  id: string;
  name: string;
  category: ChecklistCategory;
  description: string | null;
  is_active: boolean;
  is_default?: boolean;
  // regulation_reference is nullable at the API boundary; normalized to '' on load
  items: Array<Omit<EditableChecklistItem, 'regulation_reference'> & { regulation_reference: string | null }>;
}

function ChecklistEditorContent() {
  const router = useRouter();
  const { id } = router.query;
  const templateId = typeof id === 'string' ? id : undefined;

  const { data, error, isLoading, mutate } = useSWR(
    templateId ? `/api/health-safety/checklists/${templateId}` : null,
    fetcher,
    { revalidateOnFocus: false }
  );

  const template = data?.success ? (data.data as TemplateData) : undefined;
  const apiError = data && data.success === false ? data.error : null;
  const isNotFound = apiError?.code === 'NOT_FOUND';

  const [loaded, setLoaded] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [items, setItems] = useState<EditableChecklistItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  // Copy server data into editable state once, on first successful load.
  useEffect(() => {
    if (template && !loaded) {
      setName(template.name);
      setDescription(template.description || '');
      // regulation_reference can be NULL from the DB — controlled inputs need ''
      setItems((template.items || []).map((it) => ({ ...it, regulation_reference: it.regulation_reference ?? '' })));
      setLoaded(true);
    }
  }, [template, loaded]);

  const handleSave = async () => {
    if (!templateId) return;
    setSaving(true);
    setSaveError(null);

    try {
      const res = await fetch(`/api/health-safety/checklists/${templateId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name, description: description || null, items }),
      });

      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        throw new Error(err?.error?.message || 'Failed to save checklist template');
      }
      setSavedAt(Date.now());
      await mutate();
    } catch (err) {
      log.error('Failed to save checklist template', { error: err, templateId });
      setSaveError(err instanceof Error ? err.message : 'Failed to save checklist template');
    } finally {
      setSaving(false);
    }
  };

  if (isLoading || !templateId) {
    return (
      <div className="space-y-4">
        <div className="h-24 bg-[var(--ff-bg-tertiary)] rounded-lg animate-pulse" />
        <div className="h-48 bg-[var(--ff-bg-tertiary)] rounded-lg animate-pulse" />
      </div>
    );
  }

  if (error || apiError) {
    return (
      <div className="space-y-4">
        <BackLink />
        <div className="p-8 text-center bg-red-50 dark:bg-red-900/20 rounded-lg">
          <AlertTriangle className="w-12 h-12 mx-auto mb-4 text-red-500" />
          <p className="text-red-600 dark:text-red-400 font-medium">
            {isNotFound ? 'Checklist template not found' : apiError?.message || 'Failed to load template'}
          </p>
        </div>
      </div>
    );
  }

  if (!template) return null;

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <BackLink />
        {template.is_default && (
          <span className="px-2 py-0.5 text-xs font-medium rounded bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400">
            Default Template
          </span>
        )}
      </div>

      {saveError && (
        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
          {saveError}
        </div>
      )}

      <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-6 space-y-4">
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
            className={inputClass}
          />
        </div>
        <div>
          <span className={labelClass}>Category</span>
          <p className="text-sm text-[var(--ff-text-secondary)]">
            {CHECKLIST_CATEGORIES[template.category]?.label || template.category}
          </p>
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
            className={`${inputClass} resize-y`}
          />
        </div>
      </div>

      <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-6">
        <ChecklistItemsEditor items={items} defaultCategory={template.category} onChange={setItems} />
      </div>

      <div className="flex items-center gap-4 pt-4 border-t border-[var(--ff-border-light)]">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || !name}
          className="flex items-center gap-2 px-6 py-2.5 bg-[var(--ff-primary-500)] hover:bg-[var(--ff-primary-600)] disabled:opacity-50 text-white font-medium rounded-lg transition-colors"
        >
          <Save className="w-4 h-4" />
          {saving ? 'Saving...' : 'Save Template'}
        </button>
        <Link
          href="/health-safety/checklists"
          className="px-6 py-2.5 text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] transition-colors"
        >
          Cancel
        </Link>
        {savedAt && !saving && !saveError && (
          <span className="text-sm text-green-500">✓ Saved</span>
        )}
      </div>
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/health-safety/checklists"
      className="inline-flex items-center gap-2 text-sm text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] transition-colors"
    >
      <ChevronLeft className="w-4 h-4" />
      Back to Checklists
    </Link>
  );
}

const ChecklistEditorPage: NextPage = () => (
  <AppLayout>
    <Head>
      <title>Edit Checklist Template | H&S | FibreFlow</title>
    </Head>
    <ModulePage config={healthSafetyConfig}>
      <ChecklistEditorContent />
    </ModulePage>
  </AppLayout>
);

export const getServerSideProps: GetServerSideProps = async () => ({ props: {} });

export default ChecklistEditorPage;
