import { useEffect, useState } from 'react';
import type { GetServerSideProps, NextPage } from 'next';
import Link from 'next/link';
import { AppLayout } from '@/components/layout';
import type { TimelineEntry } from '@/types/field-stock';

interface SerialDetail {
  id: string;
  serialNumber: string;
  macAddress: string | null;
  category: string | null;
  itemName: string | null;
  status: string;
  currentLocationName: string | null;
  allocatedProjectName: string | null;
  installedAtDropNumber: string | null;
  installedDate: string | null;
  receivedDate: string | null;
  activatedAtOltId: string | null;
}

interface TimelineResult {
  serial: SerialDetail;
  entries: TimelineEntry[];
  hasRealEvents: boolean;
}

interface PageProps {
  serialNumber: string;
}

type FetchState =
  | { kind: 'loading' }
  | { kind: 'not-found' }
  | { kind: 'error'; message: string }
  | { kind: 'ok'; data: TimelineResult };

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
}

function fieldOrDash(value: string | null | undefined): string {
  return value && value.length > 0 ? value : '—';
}

const SerialTimelinePage: NextPage<PageProps> = ({ serialNumber }) => {
  const [state, setState] = useState<FetchState>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    setState({ kind: 'loading' });
    const url = `/api/procurement/field-stock/serials/timeline?serialNumber=${encodeURIComponent(serialNumber)}`;
    fetch(url, { credentials: 'include' })
      .then(async (res) => {
        const env = (await res.json()) as
          | { success: true; data: TimelineResult }
          | { success: false; error?: { code?: string; message?: string } };
        if (cancelled) return;
        if (!env.success) {
          if (res.status === 404) {
            setState({ kind: 'not-found' });
            return;
          }
          setState({ kind: 'error', message: env.error?.message ?? 'Failed to load timeline' });
          return;
        }
        setState({ kind: 'ok', data: env.data });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setState({
          kind: 'error',
          message: err instanceof Error ? err.message : 'Network error',
        });
      });
    return () => {
      cancelled = true;
    };
  }, [serialNumber]);

  return (
    <AppLayout>
      <div className="mx-auto max-w-5xl px-4 py-6">
        <div className="mb-4 text-sm">
          <Link href="/procurement/field-stock/serials" className="text-blue-400 hover:underline">
            ← Back to serial register
          </Link>
        </div>
        <h1 className="mb-1 text-xl font-semibold">{serialNumber}</h1>

        {state.kind === 'loading' && (
          <div className="text-sm text-neutral-400">Loading…</div>
        )}

        {state.kind === 'not-found' && (
          <div className="rounded bg-neutral-900 p-4 text-sm text-neutral-300">
            No serial matches <span className="font-mono">{serialNumber}</span>.
          </div>
        )}

        {state.kind === 'error' && (
          <div className="rounded bg-red-950/40 p-3 text-sm text-red-200">{state.message}</div>
        )}

        {state.kind === 'ok' && (
          <>
            <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-2 text-sm md:grid-cols-2">
              <DetailRow label="Item" value={state.data.serial.itemName} />
              <DetailRow label="Category" value={state.data.serial.category} />
              <DetailRow label="Status" value={state.data.serial.status} />
              <DetailRow label="MAC address" value={state.data.serial.macAddress} mono />
              <DetailRow label="Current location" value={state.data.serial.currentLocationName} />
              <DetailRow label="Allocated project" value={state.data.serial.allocatedProjectName} />
              <DetailRow label="Installed at drop" value={state.data.serial.installedAtDropNumber} mono />
              <DetailRow label="Activated on OLT" value={state.data.serial.activatedAtOltId} mono />
            </dl>

            <h2 className="mt-6 mb-2 text-lg font-semibold">Lifecycle</h2>
            {state.data.entries.length === 0 ? (
              <div className="rounded bg-neutral-900 p-4 text-sm text-neutral-400">
                No lifecycle events recorded for this serial yet.
              </div>
            ) : (
              <ol className="space-y-2">
                {state.data.entries.map((entry) => (
                  <li
                    key={entry.id}
                    className={
                      'rounded border-l-2 px-3 py-2 text-sm ' +
                      (entry.kind === 'event'
                        ? 'border-blue-500 bg-neutral-900'
                        : 'border-amber-600 bg-neutral-900/60')
                    }
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="font-medium">
                        {entry.kind === 'event' ? eventLabel(entry.eventType) : entry.label}
                      </span>
                      <span className="font-mono text-xs text-neutral-500">
                        {formatDate(entry.occurredAt)}
                      </span>
                    </div>
                    {entry.kind === 'event' ? (
                      <div className="mt-1 text-xs text-neutral-400">
                        {entry.fromState ? `${entry.fromState} → ` : ''}
                        {fieldOrDash(entry.toState)}
                        {entry.actorName ? ` · ${entry.actorName}` : ''}
                      </div>
                    ) : (
                      <div className="mt-1 text-xs text-amber-300/80">{entry.description}</div>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </>
        )}
      </div>
    </AppLayout>
  );
};

function DetailRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string | null;
  mono?: boolean;
}) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-neutral-500">{label}</dt>
      <dd className={mono ? 'font-mono' : ''}>{fieldOrDash(value)}</dd>
    </div>
  );
}

function eventLabel(eventType: string): string {
  switch (eventType) {
    case 'installed_at_drop':
      return 'Installed at drop';
    case 'activated':
      return 'Activated';
    case 'returned':
      return 'Returned';
    case 'scrapped':
      return 'Scrapped';
    case 'picking_done':
      return 'Picked';
    default:
      return eventType;
  }
}

export const getServerSideProps: GetServerSideProps<PageProps> = async (ctx) => {
  const raw = ctx.params?.serialNumber;
  const serialNumber = Array.isArray(raw) ? (raw[0] ?? '') : (raw ?? '');
  return { props: { serialNumber } };
};

export default SerialTimelinePage;
