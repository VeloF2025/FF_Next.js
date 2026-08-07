/**
 * Nightly results, with the evidence behind each one.
 *
 * The five states stay visually distinct on purpose. Collapsing them would
 * hide which of three different people has something to do: `no_address` is
 * the driver's, `unknown` is whoever owns tracker health, `not_verifiable` is
 * commercial (spec §6.3).
 *
 * The evidence row matters the first time a driver disputes a violation —
 * "your vehicle was 1.4km away at 17:32" is answerable; "you were in
 * violation" is not.
 */
import { Fragment, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

import type { ComplianceRow, ParkingCheckResult } from '../types';

const RESULT_STYLE: Record<ParkingCheckResult, { label: string; className: string }> = {
  compliant: { label: 'Compliant', className: 'bg-emerald-500/15 text-emerald-400' },
  violation: { label: 'Violation', className: 'bg-red-500/15 text-red-400' },
  unknown: { label: 'Unknown', className: 'bg-amber-500/15 text-amber-400' },
  not_verifiable: { label: 'No tracker', className: 'bg-slate-500/15 text-slate-400' },
  no_address: { label: 'No address', className: 'bg-indigo-500/15 text-indigo-400' },
};

function ageLabel(seconds: number | null): string {
  if (seconds === null) return '—';
  const hours = seconds / 3600;
  if (hours < 1) return `${Math.round(seconds / 60)} min old`;
  return `${hours.toFixed(1)} h old`;
}

function Evidence({ row }: { row: ComplianceRow }) {
  return (
    <tr className="bg-[var(--ff-bg-secondary)]">
      <td colSpan={5} className="px-4 py-3">
        <dl className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
          <div>
            <dt className="text-[var(--ff-text-secondary)]">Last known fix</dt>
            <dd className="text-[var(--ff-text-primary)]">
              {row.lastFixAt
                ? new Intl.DateTimeFormat('en-ZA', {
                    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
                    hour12: false, timeZone: 'Africa/Johannesburg',
                  }).format(new Date(row.lastFixAt))
                : 'No fix on record'}
            </dd>
          </div>
          <div>
            <dt className="text-[var(--ff-text-secondary)]">Fix age at check</dt>
            <dd className="text-[var(--ff-text-primary)]">{ageLabel(row.lastFixAgeSeconds)}</dd>
          </div>
          <div>
            <dt className="text-[var(--ff-text-secondary)]">Position</dt>
            <dd className="text-[var(--ff-text-primary)]">
              {row.lastFixLat !== null && row.lastFixLon !== null
                ? `${row.lastFixLat.toFixed(5)}, ${row.lastFixLon.toFixed(5)}`
                : '—'}
            </dd>
          </div>
          <div>
            <dt className="text-[var(--ff-text-secondary)]">Distance from address</dt>
            <dd className="text-[var(--ff-text-primary)]">
              {row.distanceM === null ? '—' : `${row.distanceM}m`}
            </dd>
          </div>
        </dl>
      </td>
    </tr>
  );
}

export function ComplianceTable({ rows }: { rows: ComplianceRow[] }) {
  const [open, setOpen] = useState<string | null>(null);

  if (rows.length === 0) {
    return (
      <p className="text-sm text-[var(--ff-text-secondary)] px-4 py-6">
        No checks recorded for this period.
      </p>
    );
  }

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-xs uppercase tracking-wide text-[var(--ff-text-secondary)]">
          <th className="px-4 py-2 w-8" />
          <th className="px-4 py-2">Date</th>
          <th className="px-4 py-2">Vehicle</th>
          <th className="px-4 py-2">Result</th>
          <th className="px-4 py-2">Declared address</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const style = RESULT_STYLE[row.result];
          const expanded = open === row.id;
          return (
            <Fragment key={row.id}>
              <tr
                className="border-t border-[var(--ff-border)] hover:bg-[var(--ff-bg-tertiary)] cursor-pointer"
                onClick={() => setOpen(expanded ? null : row.id)}
              >
                <td className="px-4 py-2 text-[var(--ff-text-secondary)]">
                  {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                </td>
                <td className="px-4 py-2 text-[var(--ff-text-primary)]">{row.checkDate}</td>
                <td className="px-4 py-2 text-[var(--ff-text-primary)]">{row.registration}</td>
                <td className="px-4 py-2">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${style.className}`}>
                    {style.label}
                  </span>
                </td>
                <td className="px-4 py-2 text-[var(--ff-text-secondary)]">
                  {row.addressLabel ?? '—'}
                </td>
              </tr>
              {expanded && <Evidence row={row} />}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}
