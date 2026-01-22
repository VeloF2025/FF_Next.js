/**
 * Loading UI for Projects page
 * Shown during initial page load and navigation
 */

import { CheckCircle } from 'lucide-react';

export default function ProjectsLoading() {
  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">Projects</h1>
        <p className="text-sm text-[var(--ff-text-secondary)] mt-1">Manage your FibreFlow projects</p>
      </div>

      {/* WA Monitor Stats Card - Skeleton */}
      <div className="bg-[var(--ff-bg-secondary)] p-4 rounded-lg border border-[var(--ff-border-light)]">
        <div className="flex items-center justify-between">
          <div className="flex-1">
            <p className="text-sm text-[var(--ff-text-secondary)]">QA Drops Today</p>
            <div className="h-8 w-16 bg-[var(--ff-bg-tertiary)] rounded animate-pulse mt-1" />
          </div>
          <div className="h-12 w-12 bg-purple-500/20 rounded-full flex items-center justify-center flex-shrink-0 ml-4">
            <CheckCircle className="h-6 w-6 text-purple-400" />
          </div>
        </div>
      </div>

      {/* Filters - Skeleton */}
      <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-4">
        <div className="flex flex-wrap gap-4">
          <div className="flex-1 min-w-[200px]">
            <div className="h-10 bg-[var(--ff-bg-tertiary)] rounded-lg animate-pulse" />
          </div>
          <div className="h-10 w-32 bg-[var(--ff-bg-tertiary)] rounded-lg animate-pulse" />
          <div className="h-10 w-32 bg-[var(--ff-bg-tertiary)] rounded-lg animate-pulse" />
        </div>
      </div>

      {/* Projects Table - Skeleton */}
      <div className="bg-[var(--ff-bg-secondary)] rounded-lg overflow-hidden border border-[var(--ff-border-light)]">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-[var(--ff-border-light)]">
            <thead className="bg-[var(--ff-bg-tertiary)]">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] uppercase tracking-wider">Name</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] uppercase tracking-wider">Description</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] uppercase tracking-wider">Status</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] uppercase tracking-wider">Created</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-[var(--ff-text-secondary)] uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-[var(--ff-bg-secondary)] divide-y divide-[var(--ff-border-light)]">
              {[...Array(5)].map((_, i) => (
                <tr key={i}>
                  <td className="px-6 py-4"><div className="h-4 w-32 bg-[var(--ff-bg-tertiary)] rounded animate-pulse" /></td>
                  <td className="px-6 py-4"><div className="h-4 w-48 bg-[var(--ff-bg-tertiary)] rounded animate-pulse" /></td>
                  <td className="px-6 py-4"><div className="h-5 w-16 bg-[var(--ff-bg-tertiary)] rounded-full animate-pulse" /></td>
                  <td className="px-6 py-4"><div className="h-4 w-24 bg-[var(--ff-bg-tertiary)] rounded animate-pulse" /></td>
                  <td className="px-6 py-4 text-right"><div className="h-4 w-12 bg-[var(--ff-bg-tertiary)] rounded animate-pulse ml-auto" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
