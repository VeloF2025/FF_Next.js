/**
 * SnagListTable — 11-column table of snags with inline row expansion.
 * Custom <table> (not StandardDataTable) to support expansion rows.
 */

'use client';

import type { Snag, SnagPhoto } from '../../types/snag.types';
import { SnagDetailPanel } from './SnagDetailPanel';

interface SnagListTableProps {
  snags: Snag[];
  projects: Array<{ id: string; name: string }>;
  isLoading: boolean;
  expandedSnagId: string | null;
  photosBySnag: Record<string, SnagPhoto[]>;
  onRowClick: (snag: Snag) => void;
  onSnagUpdated: (updated: Snag) => void;
  onPhotoAdded: (snagId: string, photo: SnagPhoto) => void;
  onPhotoDeleted: (snagId: string, photoId: string) => void;
}

const CATEGORY_BADGE: Record<string, string> = {
  quality:     'bg-blue-900/60 text-blue-300',
  safety:      'bg-red-900/60 text-red-300',
  health:      'bg-green-900/60 text-green-300',
  environment: 'bg-teal-900/60 text-teal-300',
  traffic:     'bg-orange-900/60 text-orange-300',
};

const SEVERITY_BADGE: Record<string, string> = {
  critical: 'bg-red-900/70 text-red-300',
  major:    'bg-orange-900/70 text-orange-300',
  minor:    'bg-yellow-900/70 text-yellow-300',
};

const STATUS_PILL: Record<string, string> = {
  open:        'bg-red-900/60 text-red-300',
  assigned:    'bg-orange-900/60 text-orange-300',
  in_progress: 'bg-yellow-900/60 text-yellow-300',
  fixed:       'bg-blue-900/60 text-blue-300',
  verified:    'bg-green-900/60 text-green-300',
  closed:      'bg-zinc-700 text-zinc-400',
  reopened:    'bg-red-900/80 text-red-200',
  wont_fix:    'bg-zinc-700 text-zinc-400',
  duplicate:   'bg-zinc-700 text-zinc-400',
};

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-ZA', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

/** Skeleton row for loading state */
function SkeletonRow({ cols }: { cols: number }) {
  return (
    <tr>
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} className="px-3 py-3">
          <div className="h-3 rounded bg-zinc-700 animate-pulse" style={{ width: `${60 + (i % 3) * 20}%` }} />
        </td>
      ))}
    </tr>
  );
}

const COL_COUNT = 13;

/** 11-column snag list table with inline row expansion */
export function SnagListTable({
  snags,
  projects,
  isLoading,
  expandedSnagId,
  photosBySnag,
  onRowClick,
  onSnagUpdated,
  onPhotoAdded,
  onPhotoDeleted,
}: SnagListTableProps) {
  const projectMap = new Map(projects.map((p) => [p.id, p.name]));

  return (
    <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg overflow-y-auto max-h-[calc(100vh-310px)]">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-[var(--ff-border-light)]">
          <thead className="sticky top-0 z-10 bg-[var(--ff-bg-tertiary)]">
            <tr>
              {[
                '#',
                'Project',
                'Report',
                'Zone',
                'PON',
                'Category',
                'Severity',
                'Description',
                'Poles',
                'Status',
                'NOC Ticket',
                'Assigned To',
                'Created',
              ].map((h) => (
                <th
                  key={h}
                  className="px-3 py-2 text-left text-xs font-medium text-[var(--ff-text-secondary)] tracking-wide whitespace-nowrap"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>

          <tbody className="bg-[var(--ff-bg-secondary)] divide-y divide-[var(--ff-border-light)]">
            {/* Loading state */}
            {isLoading &&
              Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} cols={COL_COUNT} />)}

            {/* Empty state */}
            {!isLoading && snags.length === 0 && (
              <tr>
                <td
                  colSpan={COL_COUNT}
                  className="px-4 py-12 text-center text-sm text-[var(--ff-text-secondary)]"
                >
                  No snags found
                </td>
              </tr>
            )}

            {/* Data rows + expansion rows */}
            {!isLoading &&
              snags.map((snag) => {
                const isExpanded = expandedSnagId === snag.id;
                const photos = photosBySnag[snag.id] ?? [];
                const categoryClass = CATEGORY_BADGE[snag.category] ?? 'bg-zinc-700 text-zinc-300';
                const severityClass = SEVERITY_BADGE[snag.severity] ?? 'bg-zinc-700 text-zinc-300';
                const statusClass = STATUS_PILL[snag.status] ?? 'bg-zinc-700 text-zinc-300';
                const poles = (snag.pole_references ?? []).join(', ') || '—';
                const projectName = projectMap.get(snag.project_id) ?? snag.project_id;

                return [
                  <tr
                    key={snag.id}
                    onClick={() => onRowClick(snag)}
                    className={`cursor-pointer transition-colors ${
                      isExpanded
                        ? 'bg-zinc-800/60'
                        : 'hover:bg-[var(--ff-bg-hover)]'
                    }`}
                  >
                    {/* # */}
                    <td className="px-3 py-3 text-xs text-zinc-300 whitespace-nowrap font-medium">
                      {snag.snag_number}
                    </td>
                    {/* Project */}
                    <td className="px-3 py-3 text-xs text-zinc-300 whitespace-nowrap max-w-[140px] truncate">
                      {projectName}
                    </td>
                    {/* Report */}
                    <td className="px-3 py-3 text-xs text-zinc-400 whitespace-nowrap">
                      {snag.report_number ?? '—'}
                    </td>
                    {/* Zone */}
                    <td className="px-3 py-3 text-xs text-zinc-400 whitespace-nowrap">
                      {snag.pole_zone_no != null ? snag.pole_zone_no : <span className="text-zinc-600">—</span>}
                    </td>
                    {/* PON */}
                    <td className="px-3 py-3 text-xs text-zinc-400 whitespace-nowrap">
                      {snag.pole_pon_no != null ? snag.pole_pon_no : <span className="text-zinc-600">—</span>}
                    </td>
                    {/* Category */}
                    <td className="px-3 py-3 whitespace-nowrap">
                      <span className={`text-xs px-1.5 py-0.5 rounded capitalize font-medium ${categoryClass}`}>
                        {snag.category}
                      </span>
                    </td>
                    {/* Severity */}
                    <td className="px-3 py-3 whitespace-nowrap">
                      <span className={`text-xs px-1.5 py-0.5 rounded capitalize font-medium ${severityClass}`}>
                        {snag.severity}
                      </span>
                    </td>
                    {/* Description */}
                    <td className="px-3 py-3 text-xs text-zinc-300 max-w-[220px]">
                      <p className="line-clamp-2 leading-snug">{snag.description}</p>
                    </td>
                    {/* Poles */}
                    <td className="px-3 py-3 text-xs text-zinc-400 whitespace-nowrap max-w-[120px] truncate">
                      {poles}
                    </td>
                    {/* Status */}
                    <td className="px-3 py-3 whitespace-nowrap">
                      <span className={`text-xs px-1.5 py-0.5 rounded capitalize ${statusClass}`}>
                        {snag.status.replace('_', ' ')}
                      </span>
                    </td>
                    {/* NOC Ticket */}
                    <td className="px-3 py-3 text-xs whitespace-nowrap">
                      {snag.noc_ticket_uid ? (
                        <a
                          href={`/noc/tickets/${snag.noc_ticket_id ?? ''}`}
                          className="text-blue-400 hover:text-blue-300 underline"
                          onClick={(e) => e.stopPropagation()}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {snag.noc_ticket_uid}
                        </a>
                      ) : (
                        <span className="text-zinc-600">—</span>
                      )}
                    </td>
                    {/* Assigned To */}
                    <td className="px-3 py-3 text-xs text-zinc-400 whitespace-nowrap">
                      {snag.assigned_to_name ?? <span className="text-zinc-600">—</span>}
                    </td>
                    {/* Created */}
                    <td className="px-3 py-3 text-xs text-zinc-500 whitespace-nowrap">
                      {formatDate(snag.created_at)}
                    </td>
                  </tr>,

                  /* Expansion row */
                  isExpanded ? (
                    <tr key={`${snag.id}-detail`}>
                      <td colSpan={COL_COUNT} className="p-0">
                        <SnagDetailPanel
                          snag={snag}
                          photos={photos}
                          onClose={() => onRowClick(snag)}
                          onUpdated={onSnagUpdated}
                          onPhotoAdded={(photo) => onPhotoAdded(snag.id, photo)}
                          onPhotoDeleted={(photoId) => onPhotoDeleted(snag.id, photoId)}
                        />
                      </td>
                    </tr>
                  ) : null,
                ];
              })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
