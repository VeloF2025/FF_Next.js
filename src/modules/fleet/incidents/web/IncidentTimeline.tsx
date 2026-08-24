/**
 * The incident's chronology (stage 8, task 6): one ordered view of what happened,
 * merged server-side from detection, review, driver, Attendance, notification,
 * and retention-hold sources.
 *
 * It sits beside the drawer's existing activity and attachment sections rather
 * than replacing them — those render the bodies (a manager's comment, a driver's
 * explanation, an evidence link), which the chronology deliberately never
 * carries. This component renders only what the server sent: a time, a source, a
 * fixed summary, and a name where there is one.
 *
 * Loaded on its own request so a long history never delays opening the drawer,
 * and paged, so an incident with hundreds of entries stays readable.
 */
import { useEffect, useRef, useState } from 'react';
import { log } from '@/lib/logger';
import { IncidentApiError } from './incidentApi';
import { incidentTimelineApi } from './incidentTimelineApi';
import type { IncidentTimelineEntry, TimelineSource } from '../analytics/types';

const SOURCE_LABELS: Record<TimelineSource, string> = {
  system: 'System', manager: 'Manager', driver: 'Driver',
  attendance: 'Attendance', notification: 'Notification', retention_hold: 'Retention hold',
};

function sast(value: string): string {
  return new Date(value).toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg' });
}

function TimelineRow({ item }: { item: IncidentTimelineEntry }) {
  // Only shown when the two genuinely differ — observations are the one source
  // that knows when it found out separately from when the thing happened, and
  // claiming a delay on every other row would be an invention.
  const recordedLater = item.recordedAt !== item.occurredAt;
  return (
    <li data-testid={`timeline-${item.stableId}`} className="border-l-2 border-[var(--ff-border-light)] py-1 pl-3">
      <p className="text-sm text-[var(--ff-text-primary)]">
        {item.summary}
        <span className="ml-2 text-xs uppercase text-[var(--ff-text-tertiary)]">{SOURCE_LABELS[item.source]}</span>
      </p>
      <p className="text-xs text-[var(--ff-text-secondary)]">
        {sast(item.occurredAt)}
        {recordedLater && <span> · recorded {sast(item.recordedAt)}</span>}
        {item.actorLabel && <span> · {item.actorLabel}</span>}
      </p>
    </li>
  );
}

export interface IncidentTimelineProps {
  incidentId: string;
  /**
   * Bumped by the drawer after an action or an upload. The chronology otherwise
   * refetches only when the incident changes, so an acknowledgement made in the
   * open drawer would leave the entry that records it invisible until reopen.
   */
  refreshKey?: number;
}

export function IncidentTimeline({ incidentId, refreshKey = 0 }: IncidentTimelineProps) {
  const [entries, setEntries] = useState<IncidentTimelineEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<IncidentApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const controller = useRef<AbortController | null>(null);
  // Incremented per request. A response is applied only while it is still the
  // newest one asked for: switching from incident A to incident B before A's
  // page arrives would otherwise overwrite B's chronology with A's entries.
  const generation = useRef(0);

  async function loadPage(from: string | null, append: boolean): Promise<void> {
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    generation.current += 1;
    const issued = generation.current;
    const isCurrent = (): boolean => generation.current === issued;
    setLoading(true);
    try {
      const page = await incidentTimelineApi.timeline(incidentId, from, request.signal);
      if (!isCurrent()) return;
      // Append rather than replace: a failed second page must never look like
      // the incident lost the history the manager was already reading.
      setEntries((current) => (append ? [...current, ...page.entries] : page.entries));
      setCursor(page.nextCursor);
      setError(null);
    } catch (caught) {
      // A superseded request is discarded silently — it was abandoned on
      // purpose, and reporting it would show the manager an error about an
      // incident they have already navigated away from.
      if (!isCurrent()) return;
      // Rendered *and* logged: the banner tells the manager the chronology is
      // incomplete, and the log is what makes a chronology that quietly stops
      // loading for one incident diagnosable later.
      log.error('Failed to load Fleet incident chronology', { error: caught, incidentId }, 'fleet');
      setError(caught instanceof IncidentApiError
        ? caught
        : new IncidentApiError('The chronology could not be loaded', 0, 'UNKNOWN_ERROR'));
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }

  useEffect(() => {
    setEntries([]); setCursor(null); setError(null);
    void loadPage(null, false);
    // Bumped as well as aborted: the abort rejects the in-flight promise, and
    // without moving the generation on, that rejection is still the newest
    // request as far as `loadPage` knows — so it would log an AbortError as a
    // failed chronology and set state on a component that has gone away.
    return () => { generation.current += 1; controller.current?.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incidentId, refreshKey]);

  return (
    <section aria-label="Incident chronology">
      <h4 className="font-medium text-[var(--ff-text-primary)]">Chronology</h4>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error.kind === 'permission' ? 'You cannot view this chronology.' : 'The chronology could not be loaded.'}
        </p>
      )}
      {loading && entries.length === 0 && !error && (
        <p className="text-sm text-[var(--ff-text-secondary)]">Loading chronology…</p>
      )}
      {!loading && !error && entries.length === 0 && (
        <p className="text-sm text-[var(--ff-text-secondary)]">No chronology recorded yet.</p>
      )}
      {entries.length > 0 && <ul className="mt-2 space-y-1">{entries.map((item) => (
        <TimelineRow key={item.stableId} item={item} />
      ))}</ul>}
      {cursor && (
        <button type="button" disabled={loading} onClick={() => { void loadPage(cursor, true); }}
          className="mt-2 rounded border border-[var(--ff-border-light)] px-3 py-1 text-sm text-[var(--ff-text-primary)]">
          Load more
        </button>
      )}
    </section>
  );
}
