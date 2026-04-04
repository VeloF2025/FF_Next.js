/**
 * EOD History Tab
 * Paginated list of uploaded EOD install sheets
 */

'use client';

import React, { useState, useEffect } from 'react';
import { Loader2, ChevronDown, ChevronRight, Trash2, Image } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { EodInstallSheet } from '../../../types';

export function EodHistoryTab() {
  const [sheets, setSheets] = useState<EodInstallSheet[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedSheet, setExpandedSheet] = useState<EodInstallSheet | null>(null);

  const fetchSheets = async (p: number) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/eod/sheets?page=${p}`);
      const json = await res.json();
      if (json.success) {
        setSheets(json.data.sheets);
        setTotal(json.data.total);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSheets(page);
  }, [page]);

  const toggleExpand = async (id: string) => {
    if (expandedId === id) {
      setExpandedId(null);
      setExpandedSheet(null);
      return;
    }
    setExpandedId(id);
    // Fetch full sheet with entries
    const res = await fetch(`/api/eod/sheets?page=1&date=`);
    // For now just expand the row — entries will come from a detail endpoint later
    setExpandedSheet(sheets.find((s) => s.id === id) || null);
  };

  const totalPages = Math.ceil(total / 20);

  if (loading && sheets.length === 0) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-[var(--ff-accent)]" />
      </div>
    );
  }

  if (sheets.length === 0) {
    return (
      <div className="text-center py-12 text-[var(--ff-text-secondary)]">
        No EOD sheets uploaded yet. Use the Upload tab to get started.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--ff-border-light)]">
              <th className="w-8" />
              <th className="text-left px-3 py-2 text-[var(--ff-text-secondary)] font-medium">Date</th>
              <th className="text-left px-3 py-2 text-[var(--ff-text-secondary)] font-medium">Technician</th>
              <th className="text-center px-3 py-2 text-[var(--ff-text-secondary)] font-medium">Entries</th>
              <th className="text-left px-3 py-2 text-[var(--ff-text-secondary)] font-medium">Uploaded By</th>
              <th className="text-left px-3 py-2 text-[var(--ff-text-secondary)] font-medium">Uploaded At</th>
              <th className="w-12" />
            </tr>
          </thead>
          <tbody>
            {sheets.map((sheet) => (
              <React.Fragment key={sheet.id}>
                <tr
                  className="border-b border-[var(--ff-border-light)] hover:bg-[var(--ff-bg-tertiary)] cursor-pointer transition-colors"
                  onClick={() => toggleExpand(sheet.id)}
                >
                  <td className="px-2 py-2">
                    {expandedId === sheet.id ? (
                      <ChevronDown className="w-4 h-4 text-[var(--ff-text-tertiary)]" />
                    ) : (
                      <ChevronRight className="w-4 h-4 text-[var(--ff-text-tertiary)]" />
                    )}
                  </td>
                  <td className="px-3 py-2 text-[var(--ff-text-primary)] font-medium">
                    {sheet.sheet_date}
                  </td>
                  <td className="px-3 py-2 text-[var(--ff-text-primary)]">
                    {sheet.technician_name || '—'}
                  </td>
                  <td className="px-3 py-2 text-center text-[var(--ff-text-primary)]">
                    {sheet.entry_count}
                  </td>
                  <td className="px-3 py-2 text-[var(--ff-text-secondary)] text-xs">
                    {sheet.uploaded_by || '—'}
                  </td>
                  <td className="px-3 py-2 text-[var(--ff-text-secondary)] text-xs">
                    {new Date(sheet.created_at).toLocaleString()}
                  </td>
                  <td className="px-2 py-2">
                    {sheet.photo_url && (
                      <a
                        href={sheet.photo_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="text-[var(--ff-accent)] hover:opacity-80"
                      >
                        <Image className="w-4 h-4" />
                      </a>
                    )}
                  </td>
                </tr>
                {expandedId === sheet.id && expandedSheet && (
                  <tr>
                    <td colSpan={7} className="bg-[var(--ff-bg-tertiary)] px-6 py-4">
                      <p className="text-xs text-[var(--ff-text-secondary)] mb-2">
                        Tech ID: {sheet.technician_id || 'N/A'} | Sheet ID: {sheet.id}
                      </p>
                      <p className="text-sm text-[var(--ff-text-tertiary)]">
                        Expand detail view coming soon — check Reconciliation tab for match results.
                      </p>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-xs text-[var(--ff-text-tertiary)]">
            {total} sheets total
          </span>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
            >
              Prev
            </Button>
            <span className="px-3 py-1 text-sm text-[var(--ff-text-secondary)]">
              {page} / {totalPages}
            </span>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
