/**
 * PON Features Panel
 *
 * Paginated feature table for a selected PON.
 * Filterable by discipline / workflow status.
 * Row click → navigate to review wizard.
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import { RefreshCw, ChevronLeft, ChevronRight } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { log } from '@/lib/logger';
import type { PonFeatureRow } from '../../types/dashboard.types';

interface PonFeaturesPanelProps {
  projectId: string;
  zoneNo: number;
  ponNo: number;
  highlightId?: string;
}

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-500/20 text-yellow-400',
  in_review: 'bg-blue-500/20 text-blue-400',
  approved: 'bg-green-500/20 text-green-400',
  rejected: 'bg-red-500/20 text-red-400',
  rework_needed: 'bg-orange-500/20 text-orange-400',
  escalated: 'bg-purple-500/20 text-purple-400',
  unidentified: 'bg-gray-500/20 text-gray-400',
};

export function PonFeaturesPanel({ projectId, zoneNo, ponNo, highlightId }: PonFeaturesPanelProps) {
  const router = useRouter();
  const [features, setFeatures] = useState<PonFeatureRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [total, setTotal] = useState(0);
  const [discipline, setDiscipline] = useState('');
  const [status, setStatus] = useState('');

  const fetchFeatures = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        projectId,
        zoneNo: String(zoneNo),
        ponNo: String(ponNo),
        page: String(page),
        pageSize: '50',
      });
      if (discipline) params.set('discipline', discipline);
      if (status) params.set('status', status);

      const res = await fetch(`/api/construction-qa/pon-features?${params}`, {
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        setFeatures(data.data?.features || []);
        setTotal(data.data?.pagination?.total || 0);
        setTotalPages(data.data?.pagination?.totalPages || 0);
      }
    } catch (err) {
      log.error('Failed to fetch PON features', { error: (err as Error).message }, 'construction-qa');
    } finally {
      setLoading(false);
    }
  }, [projectId, zoneNo, ponNo, page, discipline, status]);

  useEffect(() => {
    fetchFeatures();
  }, [fetchFeatures]);

  // Reset page when filters change
  useEffect(() => {
    setPage(1);
  }, [discipline, status]);

  return (
    <div className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-color)]">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-semibold text-white">
            Zone {zoneNo} / PON {ponNo}
          </h3>
          <span className="text-xs text-gray-500">{total} features</span>
        </div>
        <div className="flex items-center gap-2">
          <Select value={discipline || '__all__'} onValueChange={v => setDiscipline(v === '__all__' ? '' : v)}>
            <SelectTrigger className="w-[120px] h-8 text-xs">
              <SelectValue placeholder="All Types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All Types</SelectItem>
              <SelectItem value="civil">Civil</SelectItem>
              <SelectItem value="optical">Optical</SelectItem>
              <SelectItem value="splicing">Splicing</SelectItem>
            </SelectContent>
          </Select>
          <Select value={status || '__all__'} onValueChange={v => setStatus(v === '__all__' ? '' : v)}>
            <SelectTrigger className="w-[130px] h-8 text-xs">
              <SelectValue placeholder="All Statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All Statuses</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="approved">Approved</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
              <SelectItem value="rework_needed">Rework</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Table */}
      <table className="w-full">
        <thead>
          <tr className="border-b border-[var(--border-color)]">
            <th className="text-left px-4 py-2 text-xs font-medium text-gray-400 uppercase">Feature</th>
            <th className="text-left px-4 py-2 text-xs font-medium text-gray-400 uppercase">Type</th>
            <th className="text-center px-4 py-2 text-xs font-medium text-gray-400 uppercase">Photos</th>
            <th className="text-center px-4 py-2 text-xs font-medium text-gray-400 uppercase">AI</th>
            <th className="text-center px-4 py-2 text-xs font-medium text-gray-400 uppercase">Status</th>
            <th className="text-center px-4 py-2 text-xs font-medium text-gray-400 uppercase">Decision</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--border-color)]">
          {loading && features.length === 0 ? (
            <tr>
              <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2" />
                Loading...
              </td>
            </tr>
          ) : features.length === 0 ? (
            <tr>
              <td colSpan={6} className="px-4 py-8 text-center text-gray-500 text-sm">
                No features in this PON.
              </td>
            </tr>
          ) : (
            features.map(f => {
              const isHighlighted = f.id === highlightId;
              return (
                <tr
                  key={f.id}
                  onClick={() => router.push(`/field-ops/${f.id}`)}
                  className={`cursor-pointer transition-colors ${
                    isHighlighted
                      ? 'bg-blue-500/10 ring-1 ring-inset ring-blue-500/30'
                      : 'hover:bg-[var(--hover-bg)]'
                  }`}
                >
                  <td className="px-4 py-2.5 text-sm font-medium text-white">{f.feature_id}</td>
                  <td className="px-4 py-2.5 text-xs text-gray-400 capitalize">{f.discipline}</td>
                  <td className="px-4 py-2.5 text-center text-sm text-gray-300">{f.photo_count}</td>
                  <td className="px-4 py-2.5 text-center">
                    {f.vlm_confidence !== null ? (
                      <span className={`text-xs font-mono font-medium ${
                        Math.round(Number(f.vlm_confidence) * 100) >= 80 ? 'text-green-400' :
                        Math.round(Number(f.vlm_confidence) * 100) >= 60 ? 'text-yellow-400' : 'text-red-400'
                      }`}>
                        {Math.round(Number(f.vlm_confidence) * 100)}%
                      </span>
                    ) : (
                      <span className="text-gray-500 text-xs">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[f.workflow_status] || 'bg-gray-500/20 text-gray-400'}`}>
                      {f.workflow_status.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-center text-sm">
                    {f.qa_decision ? (
                      <span className={`font-medium ${
                        f.qa_decision === 'PASS' ? 'text-green-400' :
                        f.qa_decision === 'FAIL' ? 'text-red-400' : 'text-orange-400'
                      }`}>
                        {f.qa_decision}
                      </span>
                    ) : (
                      <span className="text-gray-500">—</span>
                    )}
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-4 py-2 border-t border-[var(--border-color)]">
          <button
            disabled={page <= 1}
            onClick={() => setPage(p => p - 1)}
            className="flex items-center gap-1 px-2 py-1 text-xs text-gray-400 hover:text-white disabled:opacity-40"
          >
            <ChevronLeft className="w-3.5 h-3.5" /> Prev
          </button>
          <span className="text-xs text-gray-500">
            Page {page} of {totalPages}
          </span>
          <button
            disabled={page >= totalPages}
            onClick={() => setPage(p => p + 1)}
            className="flex items-center gap-1 px-2 py-1 text-xs text-gray-400 hover:text-white disabled:opacity-40"
          >
            Next <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
