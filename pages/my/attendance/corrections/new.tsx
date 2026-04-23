/**
 * /my/attendance/corrections/new?entry_id=<uuid>
 *
 * Submit form for a correction against one of the staff's attendance
 * entries. Reads the #1410 hint catalogue for per-kind label +
 * placeholder + minReasonChars, and POSTs to
 * /api/my/attendance-corrections (#1397 handler, hardened with
 * per-kind minimums in #1410).
 *
 * Scope:
 *   - Kind dropdown (labels from the catalogue)
 *   - Optional adjusted clock-in / clock-out as <input type="datetime-local">
 *   - Reason textarea with placeholder swap + live minReasonChars check
 *   - wrong_site site-geofence picker is NOT in this PR — staff still
 *     describes the correct site in the reason textarea. The API's
 *     adjusted_site_geofence_id is left null; supervisors pick up the
 *     text context in the review queue. A dedicated site picker lands
 *     when we have a geofences-by-recent-use endpoint.
 *
 * On success → redirect to /my/attendance/corrections?status=pending
 * (the list, which the staff just landed a new pending row on).
 * On error → inline banner with the server's message (includes the
 * per-kind minReasonChars guidance for anything below the threshold).
 */

import React from 'react';
import type { NextPage } from 'next';
import { useRouter } from 'next/router';
import { AlertCircle, ArrowLeft, Send } from 'lucide-react';

import {
  ApiError,
  getCorrectionHints,
  getHistory,
  getSession,
  submitMyCorrection,
  type ClockEntry,
  type CorrectionHints,
  type CorrectionKind,
  type SessionResponse,
} from '@/modules/attendance/portal/client/api';
import { MyPortalShell } from '@/modules/attendance/portal/client/MyPortalShell';

const KIND_ORDER: readonly CorrectionKind[] = [
  'forgot_clock_out',
  'wrong_clock_in_time',
  'wrong_clock_out_time',
  'wrong_site',
  'duplicate_entry',
  'other',
];

const NewCorrectionPage: NextPage & {
  getLayout?: (page: React.ReactElement) => React.ReactElement;
} = () => {
  const router = useRouter();
  const entryId =
    typeof router.query.entry_id === 'string' ? router.query.entry_id : '';

  const [session, setSession] = React.useState<SessionResponse | null>(null);
  const [hints, setHints] = React.useState<CorrectionHints | null>(null);
  const [entry, setEntry] = React.useState<ClockEntry | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);

  const [kind, setKind] = React.useState<CorrectionKind>('forgot_clock_out');
  const [adjustedIn, setAdjustedIn] = React.useState('');
  const [adjustedOut, setAdjustedOut] = React.useState('');
  const [reason, setReason] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [submitError, setSubmitError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const sess = await getSession();
        if (cancelled) return;
        if (!sess.session) {
          await router.replace('/my');
          return;
        }
        setSession(sess);
        const [hintsResp, history] = await Promise.all([
          getCorrectionHints(),
          getHistory(30),
        ]);
        if (cancelled) return;
        setHints(hintsResp.hints);
        if (entryId) {
          const found =
            history.entries.find((e) => e.entryId === entryId) ?? null;
          setEntry(found);
        }
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) {
          await router.replace('/my');
          return;
        }
        setLoadError(
          err instanceof Error
            ? err.message
            : 'Could not load the correction form.'
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router, entryId]);

  const activeHint = hints?.[kind] ?? null;
  const minChars = activeHint?.minReasonChars ?? 10;
  const reasonTrimmed = reason.trim();
  const reasonOk = reasonTrimmed.length >= minChars;
  const hasAdjustment = Boolean(adjustedIn) || Boolean(adjustedOut);
  const canSubmit = Boolean(entryId) && reasonOk && hasAdjustment && !submitting;

  const handleSubmit = React.useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!canSubmit || !entryId) return;
      setSubmitting(true);
      setSubmitError(null);
      try {
        await submitMyCorrection({
          entryId,
          adjustmentKind: kind,
          adjustedClockInAt: adjustedIn
            ? localInputToIso(adjustedIn)
            : null,
          adjustedClockOutAt: adjustedOut
            ? localInputToIso(adjustedOut)
            : null,
          adjustedSiteGeofenceId: null,
          reason: reasonTrimmed,
        });
        await router.replace('/my/attendance/corrections?from=submit');
      } catch (err) {
        setSubmitError(
          err instanceof ApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : 'Could not submit the correction.'
        );
      } finally {
        setSubmitting(false);
      }
    },
    [canSubmit, entryId, kind, adjustedIn, adjustedOut, reasonTrimmed, router]
  );

  return (
    <MyPortalShell
      title="New correction"
      staffName={session?.profile?.name ?? null}
    >
      <button
        type="button"
        onClick={() => router.back()}
        className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900 mb-3"
      >
        <ArrowLeft className="w-4 h-4" />
        Back
      </button>

      {loadError && (
        <div
          role="alert"
          className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-800 mb-4"
        >
          {loadError}
        </div>
      )}

      {!entryId && (
        <div
          role="alert"
          className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-900 mb-4"
        >
          Missing <code className="font-mono">entry_id</code>. Open the
          correction form from your history screen.
        </div>
      )}

      {!session && !loadError && (
        <div className="flex items-center justify-center py-16 text-sm text-gray-500">
          Loading…
        </div>
      )}

      {session && entryId && (
        <form onSubmit={handleSubmit} className="space-y-4">
          <EntryContextCard entry={entry} entryId={entryId} />

          <label className="block">
            <span className="block text-sm font-medium text-gray-700 mb-1">
              What needs correcting?
            </span>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as CorrectionKind)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            >
              {KIND_ORDER.map((k) => (
                <option key={k} value={k}>
                  {hints?.[k]?.label ?? prettyKind(k)}
                </option>
              ))}
            </select>
            {activeHint?.hint && (
              <p className="mt-1 text-xs text-gray-500">{activeHint.hint}</p>
            )}
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="block text-sm font-medium text-gray-700 mb-1">
                Correct clock-in
              </span>
              <input
                type="datetime-local"
                value={adjustedIn}
                onChange={(e) => setAdjustedIn(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
            </label>
            <label className="block">
              <span className="block text-sm font-medium text-gray-700 mb-1">
                Correct clock-out
              </span>
              <input
                type="datetime-local"
                value={adjustedOut}
                onChange={(e) => setAdjustedOut(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
            </label>
          </div>
          <p className="text-xs text-gray-500 -mt-2">
            Leave blank the side you don't need to change. You must change at
            least one.
          </p>

          <label className="block">
            <span className="block text-sm font-medium text-gray-700 mb-1">
              Why? (min {minChars} chars)
            </span>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={activeHint?.placeholder ?? ''}
              rows={4}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
            <div className="mt-1 flex items-center justify-between text-xs">
              <span
                className={
                  reasonOk
                    ? 'text-gray-500'
                    : 'text-amber-700 font-medium'
                }
              >
                {reasonOk
                  ? 'Looks good.'
                  : `${Math.max(0, minChars - reasonTrimmed.length)} more character${
                      minChars - reasonTrimmed.length === 1 ? '' : 's'
                    } needed.`}
              </span>
              <span className="text-gray-400 tabular-nums">
                {reasonTrimmed.length} / {minChars}
              </span>
            </div>
          </label>

          {submitError && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-800"
            >
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{submitError}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={!canSubmit}
            className="w-full inline-flex items-center justify-center gap-2 py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Send className="w-4 h-4" />
            {submitting ? 'Submitting…' : 'Submit for review'}
          </button>

          <p className="text-xs text-gray-500 text-center">
            Your supervisor will review this and either approve, reject, or
            you can cancel it from{' '}
            <span className="underline">My corrections</span> while it's
            pending.
          </p>
        </form>
      )}
    </MyPortalShell>
  );
};

function EntryContextCard({
  entry,
  entryId,
}: {
  entry: ClockEntry | null;
  entryId: string;
}) {
  if (!entry) {
    return (
      <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
        Entry <code className="font-mono">{entryId.slice(0, 8)}…</code> —
        not in your last 30 shifts; details will be fetched by the reviewer.
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-700">
      <div className="font-medium text-gray-900">
        Correcting shift on {formatWorkDate(entry.workDate)}
      </div>
      <div className="mt-0.5">
        Recorded: {formatTime(entry.clockInAt)}{' '}
        {entry.clockOutAt
          ? `→ ${formatTime(entry.clockOutAt)}`
          : '(no clock-out)'}
      </div>
    </div>
  );
}

function prettyKind(kind: CorrectionKind): string {
  return kind.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

/**
 * <input type="datetime-local"> gives a local-time string with no
 * timezone. Treat it as SAST (the staff's actual locale — the /my
 * portal is phone-based in-country). new Date(s) parses it as local
 * browser time; on a device configured to SAST that's the same thing,
 * and the server round-trips UTC from the ISO string.
 */
function localInputToIso(localValue: string): string {
  const d = new Date(localValue);
  return d.toISOString();
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('en-ZA', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Africa/Johannesburg',
    });
  } catch {
    return iso;
  }
}

function formatWorkDate(yyyyMmDd: string): string {
  try {
    const [y, m, d] = yyyyMmDd.split('-').map(Number);
    if (!y || !m || !d) return yyyyMmDd;
    const date = new Date(Date.UTC(y, m - 1, d));
    return date.toLocaleDateString('en-ZA', {
      weekday: 'short',
      day: '2-digit',
      month: 'short',
      timeZone: 'UTC',
    });
  } catch {
    return yyyyMmDd;
  }
}

NewCorrectionPage.getLayout = (page: React.ReactElement) => page;

export default NewCorrectionPage;
