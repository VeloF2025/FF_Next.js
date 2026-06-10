'use client';

/**
 * InspectListPage — warehouse inspection queue for /my/stores/inspect.
 *
 * Fetches pending (needs inspection) and inspected (accept-retry) returns.
 * Renders two sections; tapping a row navigates to /my/stores/inspect/[id].
 *
 * Empty state when both sections are empty.
 */

import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import {
  ClipboardCheck,
  RefreshCcw,
  Loader2,
  AlertCircle,
  ChevronRight,
  CheckCircle2,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import type { AttendanceProfile } from '@/modules/attendance/portal/client/api';
import { MyPortalShell } from '@/modules/attendance/portal/client/MyPortalShell';

// =============================================================================
// Types
// =============================================================================

interface ReturnRow {
  id: string;
  return_number: string;
  status: string;
  returned_by_name: string | null;
  created_at: string | null;
  lines: Array<{ id: string }>;
}

// =============================================================================
// Props
// =============================================================================

export interface InspectListPageProps {
  profile: AttendanceProfile;
}

// =============================================================================
// Helpers
// =============================================================================

function timeAgo(iso: string | null): string {
  if (!iso) return '';
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true });
  } catch {
    return '';
  }
}

// =============================================================================
// Fetch helper
// =============================================================================

async function fetchReturnsByStatus(status: 'pending' | 'inspected'): Promise<ReturnRow[]> {
  const res = await fetch(
    `/api/my/stores/returns?status=${status}`,
    { credentials: 'same-origin' },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(text || `HTTP ${res.status}`);
  }
  // API returns the apiResponse envelope { success, data, meta } — unwrap.
  const envelope = (await res.json()) as { success?: boolean; data?: unknown };
  const data = envelope?.data;
  if (!Array.isArray(data)) return [];
  return data as ReturnRow[];
}

// =============================================================================
// Return row card
// =============================================================================

interface ReturnCardProps {
  row: ReturnRow;
  variant: 'pending' | 'retry';
  onClick: () => void;
}

function ReturnCard({ row, variant, onClick }: ReturnCardProps) {
  const lineCount = row.lines?.length ?? 0;
  const ago = timeAgo(row.created_at);

  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left rounded-lg bg-neutral-900 border border-neutral-800 px-4 py-3 flex items-center justify-between gap-3 hover:bg-neutral-800 active:bg-neutral-700 transition-colors"
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-white truncate">{row.return_number}</p>
        <p className="text-xs text-neutral-400 mt-0.5">
          {row.returned_by_name ?? 'Unknown tech'} ·{' '}
          {lineCount} line{lineCount !== 1 ? 's' : ''}
          {ago ? ` · ${ago}` : ''}
        </p>
        {variant === 'retry' && (
          <span className="inline-flex items-center gap-1 mt-1 text-[10px] uppercase tracking-wide rounded bg-amber-950 text-amber-300 px-2 py-0.5">
            <RefreshCcw className="w-3 h-3" />
            Retry restock
          </span>
        )}
      </div>
      <ChevronRight className="w-4 h-4 text-neutral-500 shrink-0" />
    </button>
  );
}

// =============================================================================
// Component
// =============================================================================

export function InspectListPage({ profile }: InspectListPageProps) {
  const router = useRouter();
  const [pending, setPending] = useState<ReturnRow[]>([]);
  const [inspected, setInspected] = useState<ReturnRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [p, i] = await Promise.all([
          fetchReturnsByStatus('pending'),
          fetchReturnsByStatus('inspected'),
        ]);
        if (!cancelled) {
          setPending(p);
          setInspected(i);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load returns');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => { cancelled = true; };
  }, []);

  const navigateTo = (id: string) => void router.push(`/my/stores/inspect/${id}`);
  const isEmpty = !loading && !error && pending.length === 0 && inspected.length === 0;

  return (
    <MyPortalShell
      title="Inspect returns"
      staffName={profile.name}
      staffPhotoUrl={profile.profilePhotoUrl}
      showFooterNav={false}
    >
      <div className="space-y-6">
        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center pt-20 gap-2 text-sm text-neutral-400">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading…
          </div>
        )}

        {/* Error */}
        {!loading && error && (
          <div className="flex items-start gap-2 rounded-lg bg-red-950/50 border border-red-800 px-3 py-3 text-sm text-red-200 mt-4">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Empty state */}
        {isEmpty && (
          <div className="flex flex-col items-center gap-3 pt-20 text-center">
            <CheckCircle2 className="w-12 h-12 text-emerald-700" aria-hidden="true" />
            <p className="text-base font-semibold text-neutral-200">All returns processed</p>
            <p className="text-sm text-neutral-500 max-w-xs">
              There are no pending returns waiting for inspection.
            </p>
          </div>
        )}

        {/* Pending section */}
        {!loading && !error && pending.length > 0 && (
          <section aria-labelledby="pending-heading">
            <div className="flex items-center gap-2 mb-3">
              <ClipboardCheck className="w-4 h-4 text-neutral-400" aria-hidden="true" />
              <h2 id="pending-heading" className="text-xs font-semibold text-neutral-400 uppercase tracking-wide">
                Pending — needs inspection
              </h2>
            </div>
            <div className="space-y-2">
              {pending.map((row) => (
                <ReturnCard
                  key={row.id}
                  row={row}
                  variant="pending"
                  onClick={() => navigateTo(row.id)}
                />
              ))}
            </div>
          </section>
        )}

        {/* Accept-retry section */}
        {!loading && !error && inspected.length > 0 && (
          <section aria-labelledby="retry-heading">
            <div className="flex items-center gap-2 mb-3">
              <RefreshCcw className="w-4 h-4 text-amber-500" aria-hidden="true" />
              <h2 id="retry-heading" className="text-xs font-semibold text-amber-500 uppercase tracking-wide">
                Accept pending
              </h2>
            </div>
            <div className="space-y-2">
              {inspected.map((row) => (
                <ReturnCard
                  key={row.id}
                  row={row}
                  variant="retry"
                  onClick={() => navigateTo(row.id)}
                />
              ))}
            </div>
          </section>
        )}
      </div>
    </MyPortalShell>
  );
}
