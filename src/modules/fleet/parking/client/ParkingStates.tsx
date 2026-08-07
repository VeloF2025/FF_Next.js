/**
 * The four states of a driver's parking address: none, pending, active,
 * rejected. Presentational only — the page owns loading and mutations.
 */
import { MapPin, Clock, CheckCircle2, XCircle } from 'lucide-react';

import type { ParkingDeclaration } from '../types';

const CARD = 'rounded-2xl border border-neutral-800 bg-neutral-900 p-4';

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-ZA', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'Africa/Johannesburg',
  }).format(new Date(iso));
}

function Where({ declaration }: { declaration: ParkingDeclaration }) {
  return (
    <div className="flex items-start gap-2">
      <MapPin className="w-4 h-4 text-neutral-400 shrink-0 mt-0.5" />
      <div>
        <div className="text-sm text-neutral-100">
          {declaration.label ?? declaration.addressText ?? 'Unnamed location'}
        </div>
        {declaration.label && declaration.addressText && (
          <div className="text-xs text-neutral-400 mt-0.5">{declaration.addressText}</div>
        )}
        <div className="text-xs text-neutral-500 mt-0.5">
          {declaration.lat.toFixed(5)}, {declaration.lon.toFixed(5)} · {declaration.radiusM}m radius
        </div>
      </div>
    </div>
  );
}

export function NoAddressState({
  registration,
  onStart,
}: {
  registration: string;
  onStart: () => void;
}) {
  return (
    <div className={CARD}>
      <h2 className="text-sm font-semibold text-neutral-100">
        Register where {registration} is parked overnight
      </h2>
      <p className="text-xs text-neutral-400 mt-1">
        Your vehicle is checked every night at 20:00 against the address you register here.
        Until you register one, those checks record that no address is on file.
      </p>
      <button
        type="button"
        onClick={onStart}
        className="w-full mt-4 px-4 py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-medium rounded-lg"
      >
        Register an address
      </button>
    </div>
  );
}

export function ActiveState({
  declaration,
  onChange,
}: {
  declaration: ParkingDeclaration;
  onChange: () => void;
}) {
  return (
    <div className={CARD}>
      <div className="flex items-center gap-2 mb-3">
        <CheckCircle2 className="w-4 h-4 text-emerald-300" />
        <span className="text-xs uppercase tracking-wide text-emerald-300 font-semibold">
          Approved
        </span>
      </div>
      <Where declaration={declaration} />
      <div className="text-xs text-neutral-500 mt-3">
        In effect since {formatDate(declaration.effectiveFrom ?? declaration.createdAt)}
      </div>
      <button
        type="button"
        onClick={onChange}
        className="w-full mt-4 px-4 py-2.5 border border-neutral-700 hover:bg-neutral-800 text-neutral-100 rounded-lg text-sm"
      >
        Request a change
      </button>
    </div>
  );
}

export function PendingState({
  declaration,
  onWithdraw,
  withdrawing,
}: {
  declaration: ParkingDeclaration;
  onWithdraw: () => void;
  withdrawing: boolean;
}) {
  return (
    <div className={CARD}>
      <div className="flex items-center gap-2 mb-3">
        <Clock className="w-4 h-4 text-amber-300" />
        <span className="text-xs uppercase tracking-wide text-amber-300 font-semibold">
          Waiting for approval
        </span>
      </div>
      <Where declaration={declaration} />
      {declaration.requestNote && (
        <p className="text-xs text-neutral-400 mt-3">Your note: {declaration.requestNote}</p>
      )}
      <div className="text-xs text-neutral-500 mt-3">Sent {formatDate(declaration.createdAt)}</div>
      <button
        type="button"
        onClick={onWithdraw}
        disabled={withdrawing}
        className="w-full mt-4 px-4 py-2.5 border border-neutral-700 hover:bg-neutral-800 disabled:opacity-60 text-neutral-100 rounded-lg text-sm"
      >
        {withdrawing ? 'Withdrawing…' : 'Withdraw this request'}
      </button>
    </div>
  );
}

export function RejectedNotice({ declaration }: { declaration: ParkingDeclaration }) {
  return (
    <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4">
      <div className="flex items-center gap-2 mb-2">
        <XCircle className="w-4 h-4 text-red-300" />
        <span className="text-xs uppercase tracking-wide text-red-300 font-semibold">
          Last request declined
        </span>
      </div>
      <p className="text-xs text-red-100">
        {declaration.decisionNote ?? 'No reason was given. Ask your manager before resubmitting.'}
      </p>
      <div className="text-xs text-red-200/70 mt-2">{formatDate(declaration.decidedAt)}</div>
    </div>
  );
}
