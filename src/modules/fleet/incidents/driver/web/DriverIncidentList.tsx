/**
 * Driver-facing Fleet incident list (PR7 Task 7, design §§4, 15). Shows
 * the recent window by default; `View history` expands to the configured
 * maximum retention window the server already enforces (design §4/§18) —
 * this control never lets the driver request past it, since it only ever
 * toggles `history: true/false` rather than accepting an arbitrary date.
 */
import React from 'react';
import Link from 'next/link';
import type { DriverIncidentListItem } from '../types';
import { DriverIncidentApiError, listMyFleetIncidents } from './driverIncidentApi';
import { DRIVER_INPUT_STATE_LABELS, formatIncidentDateTime } from './driverPortalLabels';

type LoadState =
  | { status: 'loading' }
  | { status: 'offline'; message: string }
  | { status: 'error'; message: string }
  | { status: 'ready'; incidents: DriverIncidentListItem[] };

export interface DriverIncidentListProps {
  /** Session expired / never existed — the page (not this component) owns navigation, mirroring `corrections.tsx`'s own session-redirect responsibility. */
  onUnauthorized?: () => void;
}

export function DriverIncidentList({ onUnauthorized }: DriverIncidentListProps = {}): React.ReactElement {
  const [history, setHistory] = React.useState(false);
  const [state, setState] = React.useState<LoadState>({ status: 'loading' });

  React.useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    listMyFleetIncidents({ history })
      .then((response) => { if (!cancelled) setState({ status: 'ready', incidents: response.incidents }); })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (error instanceof DriverIncidentApiError && error.status === 401) {
          onUnauthorized?.();
          return;
        }
        if (error instanceof DriverIncidentApiError && error.code === 'NETWORK_ERROR') {
          setState({ status: 'offline', message: 'You appear to be offline. Check your connection and try again.' });
          return;
        }
        setState({ status: 'error', message: error instanceof Error ? error.message : 'Could not load your incidents.' });
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onUnauthorized is a stable page-level callback; including it would re-fetch on every parent render.
  }, [history]);

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-neutral-100">Fleet incidents</h1>
        <button
          type="button"
          onClick={() => setHistory((prev) => !prev)}
          className="touch-manipulation rounded-full border border-neutral-700 px-3 py-1.5 text-xs font-medium text-neutral-300 hover:border-neutral-600 hover:text-neutral-100"
        >
          {history ? 'View recent' : 'View history'}
        </button>
      </div>

      {state.status === 'loading' && (
        <div className="py-8 text-center text-sm text-neutral-400">Loading…</div>
      )}
      {(state.status === 'error' || state.status === 'offline') && (
        <div role="alert" className="rounded-lg border border-red-800 bg-red-950/50 px-3 py-2 text-sm text-red-200">
          {state.status === 'error' ? `Could not load your incidents. ${state.message}` : state.message}
        </div>
      )}
      {state.status === 'ready' && state.incidents.length === 0 && (
        <div className="rounded-2xl border border-neutral-800 bg-neutral-900 py-10 text-center text-sm text-neutral-400">
          No incidents {history ? 'in your history' : 'right now'}.
        </div>
      )}
      {state.status === 'ready' && state.incidents.length > 0 && (
        <ul className="divide-y divide-neutral-800 overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-900">
          {state.incidents.map((incident) => (
            <IncidentRow key={incident.id} incident={incident} />
          ))}
        </ul>
      )}
    </div>
  );
}

function IncidentRow({ incident }: { incident: DriverIncidentListItem }): React.ReactElement {
  const stateLabel = DRIVER_INPUT_STATE_LABELS[incident.driverInputState];
  return (
    <li className="p-3">
      <Link href={`/my/fleet/incidents/${incident.id}`} className="block">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-neutral-100">{incident.incidentReference}</span>
              {incident.driverInputState !== 'not_requested' && (
                <span className="rounded-full border border-blue-700 bg-blue-950/50 px-2 py-0.5 text-[11px] font-medium text-blue-200">
                  {stateLabel}
                </span>
              )}
            </div>
            <p className="mt-1 text-sm text-neutral-300">{incident.neutralLabel}</p>
            <p className="mt-1 text-xs text-neutral-500">
              {[incident.projectLabel, incident.siteLabel].filter(Boolean).join(' · ')}
              {incident.projectLabel || incident.siteLabel ? ' · ' : ''}
              {formatIncidentDateTime(incident.detectedAt)}
            </p>
          </div>
        </div>
      </Link>
    </li>
  );
}
