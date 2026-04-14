/**
 * H&S Checklists Page
 * /health-safety/checklists - View and manage H&S checklist templates
 */

import type { NextPage } from 'next';
import React, { useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import useSWR from 'swr';
import { AppLayout } from '@/components/layout/AppLayout';
import { ModulePage } from '@/components/module-page';
import { projectsConfig } from '@/modules/navigation';
import {
  ClipboardCheck,
  Plus,
  Search,
  ChevronLeft,
  FileText,
  Tag,
  CheckCircle2,
  Star,
} from 'lucide-react';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

function ChecklistsContent() {
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');

  const { data, error, isLoading } = useSWR('/api/health-safety/checklists', fetcher);
  const templates = Array.isArray(data?.data?.templates) ? data.data.templates : [];

  const filteredTemplates = templates.filter((tpl: any) => {
    const matchesSearch =
      !searchTerm ||
      tpl.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      tpl.description?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      tpl.category?.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesCategory = categoryFilter === 'all' || tpl.category === categoryFilter;

    return matchesSearch && matchesCategory;
  });

  // Extract unique categories for filter
  const categories = [...new Set(templates.map((t: any) => t.category as string).filter(Boolean))];

  if (isLoading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-24 bg-[var(--ff-bg-tertiary)] rounded-lg animate-pulse" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8 text-center bg-red-50 dark:bg-red-900/20 rounded-lg">
        <ClipboardCheck className="w-12 h-12 mx-auto mb-4 text-red-500" />
        <p className="text-red-600 dark:text-red-400 font-medium">Failed to load checklists</p>
        <p className="text-sm text-red-500 dark:text-red-300 mt-1">Please try refreshing the page</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link
            href="/projects/health-safety"
            className="p-2 hover:bg-[var(--ff-bg-tertiary)] rounded-lg transition-colors"
          >
            <ChevronLeft className="w-5 h-5 text-[var(--ff-text-secondary)]" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">H&S Checklists</h1>
            <p className="text-sm text-[var(--ff-text-secondary)]">
              {filteredTemplates.length} template{filteredTemplates.length !== 1 ? 's' : ''}
            </p>
          </div>
        </div>
        <Link
          href="/health-safety/checklists/new"
          className="flex items-center gap-2 px-4 py-2 bg-[var(--ff-primary-500)] hover:bg-[var(--ff-primary-600)] text-white rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4" />
          New Template
        </Link>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-4">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--ff-text-tertiary)]" />
          <input
            type="text"
            placeholder="Search checklists..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] placeholder:text-[var(--ff-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-primary-500)]"
          />
        </div>
        {categories.length > 0 && (
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="px-4 py-2 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-primary-500)]"
          >
            <option value="all">All Categories</option>
            {categories.map((cat: string) => (
              <option key={cat} value={cat}>
                {cat.charAt(0).toUpperCase() + cat.slice(1).replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Templates List */}
      {filteredTemplates.length === 0 ? (
        <div className="text-center py-12 bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)]">
          <ClipboardCheck className="w-12 h-12 mx-auto mb-4 text-[var(--ff-text-tertiary)]" />
          <p className="text-[var(--ff-text-secondary)]">No checklists found</p>
          <p className="text-sm text-[var(--ff-text-tertiary)] mt-1">
            {searchTerm || categoryFilter !== 'all'
              ? 'Try adjusting your filters'
              : 'No checklist templates have been created yet'}
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredTemplates.map((tpl: any) => (
            <ChecklistCard key={tpl.id} template={tpl} />
          ))}
        </div>
      )}
    </div>
  );
}

function ChecklistCard({ template }: { template: any }) {
  return (
    <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-4 hover:border-[var(--ff-primary-500)] transition-colors">
      <div className="flex items-start justify-between gap-3 mb-3">
        <h3 className="font-semibold text-[var(--ff-text-primary)] truncate">
          {template.name || 'Untitled Template'}
        </h3>
        {template.is_default && (
          <span className="flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400 whitespace-nowrap">
            <Star className="w-3 h-3" />
            Default
          </span>
        )}
      </div>
      {template.description && (
        <p className="text-sm text-[var(--ff-text-secondary)] line-clamp-2 mb-3">
          {template.description}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--ff-text-tertiary)]">
        {template.category && (
          <span className="flex items-center gap-1">
            <Tag className="w-3.5 h-3.5" />
            {template.category.replace(/_/g, ' ')}
          </span>
        )}
        <span className="flex items-center gap-1">
          <CheckCircle2 className="w-3.5 h-3.5" />
          {template.item_count || 0} item{(template.item_count || 0) !== 1 ? 's' : ''}
        </span>
      </div>
    </div>
  );
}

const ChecklistsPage: NextPage = () => {
  return (
    <AppLayout>
      <Head>
        <title>H&S Checklists | FibreFlow</title>
      </Head>
      <ModulePage config={projectsConfig}>
        <ChecklistsContent />
      </ModulePage>
    </AppLayout>
  );
};

export const getServerSideProps = async () => {
  return { props: {} };
};

export default ChecklistsPage;
