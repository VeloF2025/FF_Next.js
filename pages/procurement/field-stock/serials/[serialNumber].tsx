import { useCallback, useEffect, useState } from 'react';
import type { GetServerSideProps, NextPage } from 'next';
import Link from 'next/link';
import { AppLayout } from '@/components/layout';
import { ForceCorrectModal } from '@/components/field-stock/ForceCorrectModal';
import { usePermission } from '@/hooks/usePermission';
import type { TimelineEntry, TimelineResult } from '@/types/field-stock';

interface PageProps {
  serialNumber: string;
}

type FetchState =
  | { kind: 'loading' }
  | { kind: 'not-found' }
  | { kind: 'error'; message: string }
  | { kind: 'ok'; data: TimelineResult };

// ── Page ─────────────────────────────────────────────────────────────────────

const SerialTimelinePage: NextPage<PageProps> = ({ serialNumber }) => {
  const [state, setState] = useState<FetchState>({ kind: 'loading' });

  const loadData = useCallback((signal?: AbortSignal) => {
    setState({ kind: 'loading' });
    const url = `/api/procurement/field-stock/serials/timeline?serialNumber=${encodeURIComponent(serialNumber)}`;
    fetch(url, { credentials: 'include', signal })
      .then(async (res) => {
        const env = (await res.json()) as
          | { success: true; data: TimelineResult }
          | { success: false; error?: { code?: string; message?: string } };
        if (signal?.aborted) return;
        if (!env.success) {
          if (res.status === 404) return setState({ kind: 'not-found' });
          return setState({ kind: 'error', message: env.error?.message ?? 'Failed to load timeline' });
        }
        setState({ kind: 'ok', data: env.data });
      })
      .catch((err: unknown) => {
        if (signal?.aborted || (err instanceof DOMException && err.name === 'AbortError')) return;
        setState({ kind: 'error', message: err instanceof Error ? err.message : 'Network error' });
      });
  }, [serialNumber]);

  useEffect(() => {
    const controller = new AbortController();
    loadData(controller.signal);
    return () => controller.abort();
  }, [loadData]);

  return (
    <AppLayout>
      <div className="mx-auto max-w-5xl px-4 py-6">
        <div className="mb-4 text-sm">
          <Link href="/procurement/field-stock/serials" className="text-blue-400 hover:underline">
            ← Back to serial register
          </Link>
        </div>
        <h1 className="mb-1 text-xl font-semibold">{serialNumber}</h1>
        {state.kind === 'loading' && <div className="text-sm text-neutral-400">Loading…</div>}
        {state.kind === 'not-found' && (
          <div className="rounded bg-neutral-900 p-4 text-sm text-neutral-300">
            No serial matches <span className="font-mono">{serialNumber}</span>.
          </div>
        )}
        {state.kind === 'error' && (
          <div className="rounded bg-red-950/40 p-3 text-sm text-red-200">{state.message}</div>
        )}
        {state.kind === 'ok' && (
          <OkPane data={state.data} serialNumber={serialNumber} onRefresh={loadData} />
        )}
      </div>
    </AppLayout>
  );
};

// ── OkPane ────────────────────────────────────────────────────────────────────

function OkPane({
  data,
  serialNumber,
  onRefresh,
}: {
  data: TimelineResult;
  serialNumber: string;
  onRefresh: () => void;
}) {
  const s = data.serial;
  const [fcOpen, setFcOpen] = useState(false);
  const { can } = usePermission();
  const canForceCorrect = can('procurement.field-stock.force-correct', 'edit');

  return (
    <>
      {/* Field grid */}
      <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-2 text-sm md:grid-cols-2">
        <Row label="Item" value={s.itemName} />
        <Row label="Category" value={s.category} />
        <Row label="Status" value={s.status} />
        <Row label="MAC address" value={s.macAddress} mono />
        <Row label="Current location" value={s.currentLocationName} />
        <Row label="Allocated project" value={s.allocatedProjectName} />
        <Row label="Installed at drop" value={s.installedAtDropNumber} mono />
        <Row label="Activated on OLT" value={s.activatedAtOltId} mono />
      </dl>

      {/* Action area */}
      {canForceCorrect && (
        <div className="mt-5 flex justify-end">
          <button
            type="button"
            onClick={() => setFcOpen(true)}
            className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm font-medium text-amber-300 hover:bg-amber-500/20 focus:outline-none focus:ring-2 focus:ring-amber-500/50 transition-colors"
          >
            Force-correct state
          </button>
        </div>
      )}

      {/* Lifecycle */}
      <h2 className="mt-6 mb-2 text-lg font-semibold">Lifecycle</h2>
      {data.entries.length === 0 ? (
        <div className="rounded bg-neutral-900 p-4 text-sm text-neutral-400">
          No lifecycle events recorded for this serial yet.
        </div>
      ) : (
        <ol className="space-y-2">
          {data.entries.map((entry) => (
            <EntryRow key={entry.id} entry={entry} />
          ))}
        </ol>
      )}

      {/* Force-correct modal */}
      {fcOpen && (
        <ForceCorrectModal
          serialNumber={serialNumber}
          currentValues={{
            status: s.status,
            // Names exposed by SerialDetail; raw IDs aren't projected (timeline service doesn't SELECT them).
            // Operator sees the name as a sanity check; the actual write is by ID via the API.
            currentLocationId: s.currentLocationName ?? null,
            allocatedToProjectId: s.allocatedProjectName ?? null,
            installedAtDropNumber: s.installedAtDropNumber,
            activatedAtOltId: s.activatedAtOltId,
          }}
          onClose={() => setFcOpen(false)}
          onSuccess={() => {
            setFcOpen(false);
            onRefresh();
          }}
        />
      )}
    </>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function EntryRow({ entry }: { entry: TimelineEntry }) {
  const border =
    entry.kind === 'event' ? 'border-blue-500 bg-neutral-900' : 'border-amber-600 bg-neutral-900/60';
  return (
    <li className={`rounded border-l-2 px-3 py-2 text-sm ${border}`}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-medium">
          {entry.kind === 'event' ? eventLabel(entry.eventType) : entry.label}
        </span>
        <span className="font-mono text-xs text-neutral-500">{formatDate(entry.occurredAt)}</span>
      </div>
      {entry.kind === 'event' ? (
        <div className="mt-1 text-xs text-neutral-400">
          {entry.fromState ? `${entry.fromState} → ` : ''}
          {entry.toState ?? '—'}
          {entry.actorName ? ` · ${entry.actorName}` : ''}
        </div>
      ) : (
        <div className="mt-1 text-xs text-amber-300/80">{entry.description}</div>
      )}
    </li>
  );
}

function Row({ label, value, mono = false }: { label: string; value: string | null; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-neutral-500">{label}</dt>
      <dd className={mono ? 'font-mono' : ''}>{value && value.length > 0 ? value : '—'}</dd>
    </div>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
}

function eventLabel(eventType: string): string {
  switch (eventType) {
    case 'installed_at_drop': return 'Installed at drop';
    case 'activated':         return 'Activated';
    case 'returned':          return 'Returned';
    case 'scrapped':          return 'Scrapped';
    case 'picking_done':      return 'Picked';
    default:                  return eventType;
  }
}

// ── SSR ───────────────────────────────────────────────────────────────────────

export const getServerSideProps: GetServerSideProps<PageProps> = async (ctx) => {
  const raw = ctx.params?.serialNumber;
  const serialNumber = Array.isArray(raw) ? (raw[0] ?? '') : (raw ?? '');
  return { props: { serialNumber } };
};

export default SerialTimelinePage;
