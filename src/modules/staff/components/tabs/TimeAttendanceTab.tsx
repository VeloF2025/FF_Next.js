'use client';

/**
 * Attendance tab for the StaffDetail page.
 *
 * Read-only in Phase 1a — last 30 days of entries + any open exceptions.
 * Selfie URLs are deliberately NOT returned by the listing endpoint
 * (POPIA + IDOR protection); admins see a camera button per entry that
 * hits `/api/staff/attendance-selfie` which audits the access and enforces
 * `people.staff.attendance.manage`.
 *
 * Theme: matches the rest of the staff-detail tabs by using the
 * `--ff-bg-*` / `--ff-text-*` / `--ff-border-*` design-token CSS vars
 * so light + dark themes both render legibly.
 */

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Camera, ExternalLink } from 'lucide-react';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { log } from '@/lib/logger';

interface ApiEntry {
  entryId: string;
  workDate: string;
  clockInAt: string;
  clockOutAt: string | null;
  clockInLat: number | null;
  clockInLon: number | null;
  clockOutLat: number | null;
  clockOutLon: number | null;
  status: 'open' | 'closed' | 'auto_closed' | 'disputed' | 'manual';
  hasSelfieIn: boolean;
  hasSelfieOut: boolean;
  notes: string | null;
}

interface ApiException {
  exceptionId: string;
  entryId: string;
  kind: string;
  severity: string;
  detectedAt: string;
  resolvedAt: string | null;
  resolutionNote: string | null;
}

interface ApiBody {
  success: true;
  data: { days: number; entries: ApiEntry[]; exceptions: ApiException[] };
}

type ApiFailure = { success: false; error?: { message?: string; details?: { reason?: string } } };

function extractErrorMessage(body: unknown, fallback: string): string {
  const err = (body as ApiFailure | undefined)?.error;
  return (typeof err?.message === 'string' && err.message) || fallback;
}

async function openSelfie(
  entryId: string,
  kind: 'in' | 'out',
  setRowError: (msg: string) => void
): Promise<void> {
  try {
    const res = await fetch(
      `/api/staff/attendance-selfie?entryId=${entryId}&kind=${kind}&context=staff_detail`,
      { credentials: 'include' }
    );
    const body = (await res.json().catch(() => null)) as ApiBody | ApiFailure | null;
    if (!res.ok || !body || body.success !== true) {
      const reason = (body as ApiFailure | null)?.error?.details?.reason;
      if (reason === 'audit_write_failed') {
        setRowError('Compliance audit failed — selfie access denied. Please try again.');
        return;
      }
      if (reason === 'unavailable') {
        setRowError('Selfie unavailable (never captured or deleted under retention policy).');
        return;
      }
      setRowError(extractErrorMessage(body, 'Could not load the selfie.'));
      return;
    }
    const url = (body as { data?: { url?: string } }).data?.url;
    if (!url) {
      setRowError('Server returned an empty selfie URL.');
      return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  } catch (err) {
    log.error('TimeAttendanceTab: selfie fetch failed', err instanceof Error ? { message: err.message } : { err });
    setRowError('Network error — could not load the selfie.');
  }
}

export function TimeAttendanceTab({ staffId }: { staffId: string }) {
  const [entries, setEntries] = useState<ApiEntry[] | null>(null);
  const [exceptions, setExceptions] = useState<ApiException[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selfieError, setSelfieError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/staff/attendance-entries?staffId=${staffId}&days=30`, {
          credentials: 'include',
        });
        const body = (await res.json().catch(() => null)) as ApiBody | ApiFailure | null;
        if (cancelled) return;
        if (!res.ok || !body || body.success !== true) {
          setError(extractErrorMessage(body, 'Could not load attendance.'));
          return;
        }
        setEntries(body.data.entries);
        setExceptions(body.data.exceptions);
      } catch {
        if (!cancelled) setError('Network error loading attendance.');
      }
    })();
    return () => { cancelled = true; };
  }, [staffId]);

  const exceptionsByEntry = useMemo(() => {
    const m = new Map<string, ApiException[]>();
    for (const x of exceptions) {
      const arr = m.get(x.entryId) ?? [];
      arr.push(x);
      m.set(x.entryId, arr);
    }
    return m;
  }, [exceptions]);

  if (error) {
    return (
      <div role="alert" className="rounded-lg bg-red-500/10 border border-red-500/30 px-4 py-3 text-sm text-red-300">
        {error}
      </div>
    );
  }
  if (!entries) return <LoadingSpinner />;
  if (entries.length === 0) {
    return (
      <div className="text-center py-10 text-sm text-[var(--ff-text-secondary)]">
        No attendance entries in the last 30 days.
      </div>
    );
  }

  const openExceptionCount = exceptions.filter((x) => !x.resolvedAt).length;

  return (
    <div className="space-y-4">
      {openExceptionCount > 0 && (
        <div className="rounded-lg bg-amber-500/10 border border-amber-500/30 px-3 py-2 text-sm text-amber-300 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" />
          {openExceptionCount} open exception{openExceptionCount === 1 ? '' : 's'} need review.
        </div>
      )}

      {selfieError && (
        <div role="alert" className="rounded-lg bg-red-500/10 border border-red-500/30 px-3 py-2 text-sm text-red-300 flex items-center justify-between">
          <span>{selfieError}</span>
          <button
            type="button"
            onClick={() => setSelfieError(null)}
            className="text-xs font-medium underline hover:text-red-200"
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="rounded-lg border border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-[var(--ff-bg-tertiary)]">
              <tr>
                <Th>Date</Th>
                <Th>Clock in</Th>
                <Th>Clock out</Th>
                <Th>Duration</Th>
                <Th>Status</Th>
                <Th>Exceptions</Th>
                <Th>Selfies</Th>
                <Th>Notes</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--ff-border-light)]">
              {entries.map((e) => (
                <EntryRow
                  key={e.entryId}
                  entry={e}
                  exceptions={exceptionsByEntry.get(e.entryId) ?? []}
                  onSelfieError={setSelfieError}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function EntryRow({
  entry,
  exceptions,
  onSelfieError,
}: {
  entry: ApiEntry;
  exceptions: ApiException[];
  onSelfieError: (msg: string) => void;
}) {
  const duration = computeDuration(entry.clockInAt, entry.clockOutAt);
  return (
    <tr className="hover:bg-[var(--ff-bg-hover)]">
      <Td>{formatDate(entry.workDate)}</Td>
      <Td className="tabular-nums">{formatTime(entry.clockInAt)}</Td>
      <Td className="tabular-nums">{entry.clockOutAt ? formatTime(entry.clockOutAt) : <span className="text-[var(--ff-text-muted)]">—</span>}</Td>
      <Td className="tabular-nums">{duration}</Td>
      <Td><StatusBadge status={entry.status} /></Td>
      <Td>
        {exceptions.length > 0 ? (
          <span className="inline-flex items-center gap-1 text-amber-300">
            <AlertTriangle className="w-3 h-3" />
            {exceptions.length}
          </span>
        ) : <span className="text-[var(--ff-text-muted)]">—</span>}
      </Td>
      <Td>
        <div className="flex gap-1">
          {entry.hasSelfieIn && (
            <SelfieButton entryId={entry.entryId} kind="in" label="In" onError={onSelfieError} />
          )}
          {entry.hasSelfieOut && (
            <SelfieButton entryId={entry.entryId} kind="out" label="Out" onError={onSelfieError} />
          )}
          {!entry.hasSelfieIn && !entry.hasSelfieOut && (
            <span className="text-[var(--ff-text-muted)]">—</span>
          )}
        </div>
      </Td>
      <Td className="max-w-xs truncate text-xs text-[var(--ff-text-secondary)]">
        {entry.notes ?? <span className="text-[var(--ff-text-muted)]">—</span>}
      </Td>
    </tr>
  );
}

function SelfieButton({
  entryId, kind, label, onError,
}: {
  entryId: string;
  kind: 'in' | 'out';
  label: string;
  onError: (msg: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => void openSelfie(entryId, kind, onError)}
      className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-blue-500/15 text-blue-300 text-xs hover:bg-blue-500/25 border border-blue-500/30"
    >
      <Camera className="w-3 h-3" />
      {label}
      <ExternalLink className="w-2.5 h-2.5" />
    </button>
  );
}

function StatusBadge({ status }: { status: ApiEntry['status'] }) {
  const style: Record<ApiEntry['status'], string> = {
    open: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    closed: 'bg-neutral-500/15 text-neutral-300 border-neutral-500/30',
    auto_closed: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    disputed: 'bg-red-500/15 text-red-300 border-red-500/30',
    manual: 'bg-purple-500/15 text-purple-300 border-purple-500/30',
  };
  return (
    <span className={`inline-block px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide border rounded-full ${style[status]}`}>
      {status.replace('_', ' ')}
    </span>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-[var(--ff-text-secondary)]">
      {children}
    </th>
  );
}

function Td({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <td className={`px-3 py-2 align-top text-[var(--ff-text-primary)] ${className ?? ''}`}>
      {children}
    </td>
  );
}

function formatDate(yyyyMmDd: string): string {
  const [y, m, d] = yyyyMmDd.split('-').map(Number);
  if (!y || !m || !d) return yyyyMmDd;
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.toLocaleDateString('en-ZA', { weekday: 'short', day: '2-digit', month: 'short', timeZone: 'UTC' });
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-ZA', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Africa/Johannesburg',
  });
}

function computeDuration(startIso: string, endIso: string | null): string {
  if (!endIso) return '—';
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const totalMinutes = Math.floor(ms / 60_000);
  const h = Math.floor(totalMinutes / 60);
  const mn = totalMinutes % 60;
  return h > 0 ? `${h}h ${mn.toString().padStart(2, '0')}m` : `${mn}m`;
}
