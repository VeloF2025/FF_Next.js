/**
 * Safety Library Page
 * /projects/health-safety/safety-library
 *
 * MSDS/chemical register and SWP/method-statement library in one view,
 * filtered by content type. Entries with no project apply company-wide.
 */

import type { NextPage } from 'next';
import React, { useState } from 'react';
import Head from 'next/head';
import useSWR from 'swr';
import { AppLayout } from '@/components/layout/AppLayout';
import { ModulePage } from '@/components/module-page';
import { projectsConfig } from '@/modules/navigation';
import { Plus, BookOpen, AlertTriangle, ExternalLink } from 'lucide-react';
import { log } from '@/lib/logger';
import { isSafeDocumentUrl } from '@/modules/health-safety/services/inputNormalize';
import { SafetyLibraryForm } from '@/modules/health-safety/components/library';
import {
  SAFETY_LIBRARY_TYPES,
  type HSSafetyLibraryEntryView,
} from '@/modules/health-safety/types/library.types';

const fetcher = (url: string) =>
  fetch(url, { credentials: 'include' }).then((r) => {
    if (!r.ok) throw new Error(String(r.status));
    return r.json();
  });

const REVIEW_LABEL: Record<string, { label: string; className: string }> = {
  review_overdue: { label: 'Review overdue', className: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' },
  review_due_soon: { label: 'Review due soon', className: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400' },
  current: { label: 'Current', className: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' },
  no_review: { label: 'No review date', className: 'bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-tertiary)]' },
};

function SafetyLibraryContent() {
  const [typeFilter, setTypeFilter] = useState('');
  const [editing, setEditing] = useState<HSSafetyLibraryEntryView | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const params = new URLSearchParams();
  if (typeFilter) params.set('content_type', typeFilter);

  const { data, mutate, error, isLoading } = useSWR(
    `/api/health-safety/library?${params}`,
    fetcher,
    { revalidateOnFocus: true }
  );
  const entries: HSSafetyLibraryEntryView[] = data?.data?.entries ?? [];
  const stats = data?.data?.stats ?? { total: 0, msds: 0, procedures: 0, review_overdue: 0 };

  const closeForm = () => {
    setCreating(false);
    setEditing(null);
  };
  const onSaved = () => {
    closeForm();
    mutate();
  };

  async function remove(entry: HSSafetyLibraryEntryView) {
    if (!confirm(`Delete "${entry.title}" from the safety library?`)) return;
    setDeleteError(null);
    try {
      const res = await fetch(`/api/health-safety/library/${entry.id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) {
        // Without this the row silently reappears on the next revalidation and
        // the user is never told the delete was refused.
        const json = await res.json().catch(() => null);
        setDeleteError(json?.error?.message || `Failed to delete "${entry.title}"`);
        return;
      }
    } catch (err) {
      log.error('Failed to delete safety library entry', { error: err });
      setDeleteError('Network error deleting entry');
      return;
    }
    mutate();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">Safety Library</h1>
          <p className="text-sm text-[var(--ff-text-secondary)]">
            {stats.total} entr{stats.total === 1 ? 'y' : 'ies'} · {stats.msds} safety data sheet
            {stats.msds !== 1 ? 's' : ''} · {stats.procedures} procedure
            {stats.procedures !== 1 ? 's' : ''} · {stats.review_overdue} review overdue
          </p>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="flex items-center gap-2 px-4 py-2 bg-[var(--ff-primary-500)] hover:bg-[var(--ff-primary-600)] text-white rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add Entry
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        {[{ value: '', label: 'All' }, ...Object.values(SAFETY_LIBRARY_TYPES)].map((t) => (
          <button
            key={t.value || 'all'}
            onClick={() => setTypeFilter(t.value)}
            className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${
              typeFilter === t.value
                ? 'bg-[var(--ff-primary-500)] text-white border-[var(--ff-primary-500)]'
                : 'bg-[var(--ff-bg-secondary)] text-[var(--ff-text-secondary)] border-[var(--ff-border-light)] hover:border-[var(--ff-primary-500)]'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {deleteError && (
        <div className="p-3 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-lg text-sm">
          {deleteError}
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 bg-[var(--ff-bg-tertiary)] rounded-lg animate-pulse" />
          ))}
        </div>
      ) : error ? (
        <div className="p-8 text-center bg-red-50 dark:bg-red-900/20 rounded-lg text-red-600 dark:text-red-400">
          Failed to load the safety library
        </div>
      ) : entries.length === 0 ? (
        <div className="text-center py-12 bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)]">
          <BookOpen className="w-12 h-12 mx-auto mb-4 text-[var(--ff-text-tertiary)]" />
          <p className="text-[var(--ff-text-secondary)]">No library entries</p>
          <p className="text-sm text-[var(--ff-text-tertiary)] mt-1">
            Add a safety data sheet or a safe work procedure to start the library
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[var(--ff-border-light)]">
          <table className="w-full text-sm">
            <thead className="bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)]">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Title</th>
                <th className="text-left px-4 py-2 font-medium">Type</th>
                <th className="text-left px-4 py-2 font-medium">Scope</th>
                <th className="text-left px-4 py-2 font-medium">Hazard / Storage</th>
                <th className="text-left px-4 py-2 font-medium">Next review</th>
                <th className="text-right px-4 py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => {
                const review = REVIEW_LABEL[e.review_status] ?? REVIEW_LABEL.no_review!;
                return (
                  <tr key={e.id} className="border-t border-[var(--ff-border-light)] hover:bg-[var(--ff-bg-tertiary)]/40">
                    <td className="px-4 py-2 text-[var(--ff-text-primary)] font-medium">
                      {/* Scheme re-checked at render as well as on write: a stored
                          `javascript:` URL would otherwise execute in the reader's
                          authenticated session on click. */}
                      {e.file_url && isSafeDocumentUrl(e.file_url) ? (
                        <a href={e.file_url} target="_blank" rel="noopener noreferrer" className="text-[var(--ff-primary-500)] hover:underline inline-flex items-center gap-1">
                          {e.title}
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      ) : (
                        e.title
                      )}
                      {e.version && <span className="ml-2 text-xs text-[var(--ff-text-tertiary)]">v{e.version}</span>}
                      {!e.is_active && <span className="ml-2 text-xs text-[var(--ff-text-tertiary)]">superseded</span>}
                    </td>
                    <td className="px-4 py-2 text-[var(--ff-text-secondary)]">
                      {SAFETY_LIBRARY_TYPES[e.content_type]?.label ?? e.content_type}
                    </td>
                    <td className="px-4 py-2 text-[var(--ff-text-secondary)]">
                      {e.project_name ?? <span className="text-[var(--ff-text-tertiary)]">Company-wide</span>}
                    </td>
                    <td className="px-4 py-2 text-[var(--ff-text-secondary)]">
                      {e.ghs_hazard_class || e.storage_location ? (
                        <span>
                          {e.ghs_hazard_class}
                          {e.ghs_hazard_class && e.storage_location ? ' · ' : ''}
                          {e.storage_location}
                        </span>
                      ) : (
                        <span className="text-[var(--ff-text-tertiary)]">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded whitespace-nowrap ${review.className}`}>
                        {e.review_status === 'review_overdue' && <AlertTriangle className="w-3 h-3" />}
                        {e.review_date ? e.review_date.slice(0, 10) : review.label}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right whitespace-nowrap">
                      <button onClick={() => setEditing(e)} className="text-[var(--ff-primary-500)] hover:underline mr-3">Edit</button>
                      <button onClick={() => remove(e)} className="text-red-600 dark:text-red-400 hover:underline">Delete</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {(creating || editing) && (
        <SafetyLibraryForm entry={editing ?? undefined} onSuccess={onSaved} onCancel={closeForm} />
      )}
    </div>
  );
}

const SafetyLibraryPage: NextPage = () => (
  <AppLayout>
    <Head>
      <title>Safety Library | FibreFlow</title>
    </Head>
    <ModulePage config={projectsConfig}>
      <SafetyLibraryContent />
    </ModulePage>
  </AppLayout>
);

export const getServerSideProps = async () => ({ props: {} });

export default SafetyLibraryPage;
