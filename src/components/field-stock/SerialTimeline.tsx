import { useState } from 'react';
import type { TimelineEntry } from '@/types/field-stock';
import type { SerialTimelineProps } from './SerialTimeline.props';

const EVENT_TYPE_LABELS: Record<string, string> = {
  installed_at_drop: 'Installed at drop',
  activated: 'Activated',
  // Non-authoritative recon: the unit's serial was read off a WhatsApp photo.
  wa_photo_sighting: 'Seen in WhatsApp photo',
};

/** Human label for a stock_serial_events.event_type; humanizes unknown types. */
export function eventTypeLabel(eventType: string): string {
  return (
    EVENT_TYPE_LABELS[eventType] ??
    eventType.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())
  );
}

export function SerialTimeline({ entries, hasRealEvents }: SerialTimelineProps) {
  if (entries.length === 0) {
    return (
      <div className="rounded border border-neutral-700 bg-neutral-900 p-6 text-center text-sm text-neutral-400">
        No lifecycle data recorded for this serial yet.
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {!hasRealEvents && (
        <div className="rounded border border-amber-700 bg-amber-950/40 px-3 py-2 text-xs text-amber-200">
          No events recorded in the event log — showing inferred history from the serial record.
        </div>
      )}
      <ol className="space-y-2">
        {entries.map((entry) => <TimelineRow key={entry.id} entry={entry} />)}
      </ol>
    </div>
  );
}

function TimelineRow({ entry }: { entry: TimelineEntry }) {
  const [expanded, setExpanded] = useState(false);
  if (entry.kind === 'pseudo') {
    return (
      <li className="rounded border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm">
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-medium text-neutral-200">{entry.label}</span>
          <time className="text-xs text-neutral-500" dateTime={entry.occurredAt}>
            {new Date(entry.occurredAt).toISOString().slice(0, 19).replace('T', ' ')}
          </time>
        </div>
        <p className="mt-1 text-xs text-neutral-400">{entry.description}</p>
      </li>
    );
  }
  return (
    <li className="rounded border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-medium text-neutral-200">{eventTypeLabel(entry.eventType)}</span>
        <time className="text-xs text-neutral-500" dateTime={entry.occurredAt}>
          {new Date(entry.occurredAt).toISOString().slice(0, 19).replace('T', ' ')}
        </time>
      </div>
      {(entry.fromState || entry.toState) && (
        <p className="mt-1 text-xs text-neutral-400">
          {entry.fromState ?? '∅'} → {entry.toState ?? '∅'}
        </p>
      )}
      {entry.actorName && <p className="mt-0.5 text-xs text-neutral-500">by {entry.actorName}</p>}
      {Object.keys(entry.payload).length > 0 && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 text-xs text-blue-400 hover:underline"
          aria-expanded={expanded}
          aria-label={expanded ? 'Hide payload' : 'Show payload'}
        >
          {expanded ? '▾ Payload' : '▸ Payload'}
        </button>
      )}
      {expanded && (
        <pre className="mt-1 overflow-x-auto rounded bg-neutral-950 p-2 text-xs text-neutral-300">
          {JSON.stringify(entry.payload, null, 2)}
        </pre>
      )}
    </li>
  );
}
