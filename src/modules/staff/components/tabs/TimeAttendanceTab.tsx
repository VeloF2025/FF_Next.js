'use client';

/**
 * Attendance tab for the StaffDetail page.
 *
 * Read-only in Phase 1a — last 30 days of entries + any open exceptions.
 * Selfie URLs are deliberately NOT returned by the listing endpoint
 * (POPIA + IDOR protection); admins see a camera button per entry that
 * hits `/api/staff/attendance-selfie` which audits the access and enforces
 * `people.staff.attendance.manage`. Corrections / edits land in PR1c.
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
      // Differentiate the three realistic failure modes explicitly so the
      // admin isn't left guessing at "Could not load the selfie".
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
      <div role="alert" className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-800">
        {error}
      </div>
    );
  }
  if (!entries) return <LoadingSpinner />;
  if (entries.length === 0) {
    return (
      <div className="text-center py-10 text-sm text-gray-500">
        No attendance entries in the last 30 days.
      </div>
    );
  }

  const openExceptionCount = exceptions.filter((x) => !x.resolvedAt).length;

  return (
    <div className="space-y-4">
      {openExceptionCount > 0 && (
        <div className="rounded-lg bg-yellow-50 border border-yellow-200 px-3 py-2 text-sm text-yellow-900 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" />
          {openExceptionCount} open exception{openExceptionCount === 1 ? '' : 's'} need review.
        </div>
      )}

      {selfieError && (
        <div role="alert" className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-800 flex items-center justify-between">
          <span>{selfieError}</span>
          <button type="button" onClick={() => setSelfieError(null)} className="text-xs font-medium underline">Dismiss</button>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50">
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
          <tbody className="bg-white divide-y divide-gray-100">
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
    <tr className="hover:bg-gray-50">
      <Td>{formatDate(entry.workDate)}</Td>
      <Td>{formatTime(entry.clockInAt)}</Td>
      <Td>{entry.clockOutAt ? formatTime(entry.clockOutAt) : '—'}</Td>
      <Td>{duration}</Td>
      <Td><StatusBadge status={entry.status} /></Td>
      <Td>
        {exceptions.length > 0 ? (
          <span className="inline-flex items-center gap-1 text-yellow-800">
            <AlertTriangle className="w-3 h-3" />
            {exceptions.length}
          </span>
        ) : '—'}
      </Td>
      <Td>
        <div className="flex gap-1">
          {entry.hasSelfieIn && (
            <SelfieButton entryId={entry.entryId} kind="in" label="In" onError={onSelfieError} />
          )}
          {entry.hasSelfieOut && (
            <SelfieButton entryId={entry.entryId} kind="out" label="Out" onError={onSelfieError} />
          )}
          {!entry.hasSelfieIn && !entry.hasSelfieOut && '—'}
        </div>
      </Td>
      <Td className="max-w-xs truncate text-xs text-gray-500">
        {entry.notes ?? ''}
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
      className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-blue-50 text-blue-700 text-xs hover:bg-blue-100"
    >
      <Camera className="w-3 h-3" />
      {label}
      <ExternalLink className="w-2.5 h-2.5" />
    </button>
  );
}

function StatusBadge({ status }: { status: ApiEntry['status'] }) {
  const style: Record<ApiEntry['status'], string> = {
    open: 'bg-green-50 text-green-700 border-green-200',
    closed: 'bg-gray-50 text-gray-600 border-gray-200',
    auto_closed: 'bg-yellow-50 text-yellow-800 border-yellow-200',
    disputed: 'bg-red-50 text-red-700 border-red-200',
    manual: 'bg-purple-50 text-purple-700 border-purple-200',
  };
  return (
    <span className={`inline-block px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide border rounded-full ${style[status]}`}>
      {status.replace('_', ' ')}
    </span>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-600">
      {children}
    </th>
  );
}

function Td({ children, className }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2 align-top ${className ?? ''}`}>{children}</td>;
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
