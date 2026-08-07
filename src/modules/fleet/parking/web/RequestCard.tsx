/**
 * One pending parking-address request, with the two actions that close it.
 *
 * The approver's job is to judge a move, so the card leads with what changed:
 * where the vehicle parks today, where the driver wants it to park, and how
 * far apart those are. A first declaration has no "today", and says so rather
 * than showing a distance of zero — zero means "did not move", which is a
 * different claim entirely.
 */
import { useState } from 'react';
import { MapPin, ArrowRight, User } from 'lucide-react';

import type { PendingRequest } from '../types';
import type { DecisionOutcome } from '../types';

const noteCls =
  'w-full px-3 py-2 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border)] rounded-lg text-sm text-[var(--ff-text-primary)]';

function Place({ label, address, lat, lon }: {
  label: string | null;
  address: string | null;
  lat: number;
  lon: number;
}) {
  return (
    <div>
      <p className="text-sm font-medium text-[var(--ff-text-primary)]">
        {label ?? address ?? 'Unnamed location'}
      </p>
      {label && address && (
        <p className="text-xs text-[var(--ff-text-secondary)]">{address}</p>
      )}
      <p className="text-xs text-[var(--ff-text-secondary)]">
        {lat.toFixed(5)}, {lon.toFixed(5)}
      </p>
    </div>
  );
}

export function RequestCard({
  request,
  onDecide,
  deciding,
}: {
  request: PendingRequest;
  onDecide: (outcome: DecisionOutcome, note: string | null) => void;
  deciding: boolean;
}) {
  const [note, setNote] = useState('');

  const decide = (outcome: DecisionOutcome) => {
    onDecide(outcome, note.trim() || null);
  };

  return (
    <div className="border border-[var(--ff-border)] rounded-lg p-4 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-semibold text-[var(--ff-text-primary)]">{request.registration}</p>
          <p className="text-sm text-[var(--ff-text-secondary)] flex items-center gap-1.5">
            <User className="w-3.5 h-3.5" />
            {request.driverName ?? 'Unknown driver'}
          </p>
        </div>
        <p className="text-xs text-[var(--ff-text-secondary)]">
          {new Intl.DateTimeFormat('en-ZA', {
            day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
            hour12: false, timeZone: 'Africa/Johannesburg',
          }).format(new Date(request.createdAt))}
        </p>
      </div>

      <div className="flex items-start gap-3">
        <MapPin className="w-4 h-4 text-[var(--ff-text-secondary)] shrink-0 mt-0.5" />
        {request.current ? (
          <div className="flex items-start gap-3 flex-wrap">
            <Place
              label={request.current.label}
              address={request.current.addressText}
              lat={request.current.lat}
              lon={request.current.lon}
            />
            <ArrowRight className="w-4 h-4 text-[var(--ff-text-secondary)] mt-1" />
            <Place
              label={request.requested.label}
              address={request.requested.addressText}
              lat={request.requested.lat}
              lon={request.requested.lon}
            />
          </div>
        ) : (
          <div>
            <p className="text-xs uppercase tracking-wide text-[var(--ff-text-secondary)] mb-1">
              First address for this vehicle
            </p>
            <Place
              label={request.requested.label}
              address={request.requested.addressText}
              lat={request.requested.lat}
              lon={request.requested.lon}
            />
          </div>
        )}
      </div>

      <div className="flex gap-4 text-xs text-[var(--ff-text-secondary)]">
        {request.moveDistanceM !== null && <span>Moved {request.moveDistanceM}m</span>}
        {/* An approver judging a 90m capture should be able to see that it was 90m. */}
        {request.requested.accuracyM !== null && (
          <span>Captured to ±{Math.round(request.requested.accuracyM)}m</span>
        )}
      </div>

      {request.requestNote && (
        <p className="text-sm text-[var(--ff-text-secondary)]">
          Driver&apos;s note: {request.requestNote}
        </p>
      )}

      <textarea
        className={noteCls}
        rows={2}
        maxLength={1000}
        placeholder="Note for the driver (required when declining)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => decide('approved')}
          disabled={deciding}
          className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white text-sm font-medium rounded-lg"
        >
          {deciding ? 'Saving…' : 'Approve'}
        </button>
        <button
          type="button"
          onClick={() => decide('rejected')}
          disabled={deciding || note.trim().length === 0}
          title={note.trim().length === 0 ? 'Add a note explaining why' : undefined}
          className="px-4 py-2 border border-[var(--ff-border)] hover:bg-[var(--ff-bg-tertiary)] disabled:opacity-60 text-[var(--ff-text-primary)] text-sm rounded-lg"
        >
          Decline
        </button>
      </div>
    </div>
  );
}
