/**
 * Presentational row list for /my/stores/today. Receives already-fetched
 * rows; pure render. Co-locates the per-technician row + the small Stat
 * tile so the page component stays under the 200-line limit.
 */

import type { StoresTodayRow } from '@/modules/field-stock-pwa/services/storesTodayService';

export const UNACCOUNTED_COUNT_ALERT = 3;
export const UNACCOUNTED_VALUE_ALERT_ZAR = 5000;

const formatZar = (n: number): string =>
  `R${n.toLocaleString('en-ZA', { maximumFractionDigits: 0 })}`;

interface StoresTodayListProps {
  rows: StoresTodayRow[];
}

export function StoresTodayList({ rows }: StoresTodayListProps) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-neutral-800 bg-neutral-900/50 p-6 text-center text-sm text-neutral-400">
        No stock issued today.
      </div>
    );
  }
  return (
    <ol className="space-y-2">
      {rows.map((row) => <TechnicianRow key={row.technician_id} row={row} />)}
    </ol>
  );
}

function TechnicianRow({ row }: { row: StoresTodayRow }) {
  // Pro-rate the unaccounted value off issued value to keep the calc honest
  // without re-doing per-serial valuation server-side.
  const accountedRatio = row.issued_count > 0
    ? (row.installed_count + row.returned_count) / row.issued_count
    : 0;
  const unaccountedValueZar = row.issued_value_rand * (1 - accountedRatio);
  const alerting =
    row.unaccounted_count > UNACCOUNTED_COUNT_ALERT ||
    unaccountedValueZar > UNACCOUNTED_VALUE_ALERT_ZAR;
  return (
    <li
      className={`rounded-lg border px-3 py-2 ${
        alerting
          ? 'border-red-800 bg-red-950/40'
          : 'border-neutral-800 bg-neutral-900'
      }`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium text-neutral-100">{row.technician_name || 'Unknown'}</span>
        <span className="text-xs text-neutral-500">{formatZar(row.issued_value_rand)}</span>
      </div>
      <div className="mt-1 grid grid-cols-4 gap-2 text-xs">
        <Stat label="Issued" value={row.issued_count} />
        <Stat label="Installed" value={row.installed_count} />
        <Stat label="Returned" value={row.returned_count} />
        <Stat
          label="Unaccounted"
          value={row.unaccounted_count}
          emphasise={row.unaccounted_count > 0}
        />
      </div>
    </li>
  );
}

function Stat({ label, value, emphasise }: { label: string; value: number; emphasise?: boolean }) {
  return (
    <div className="rounded bg-neutral-950/50 px-2 py-1 text-center">
      <div className={`text-base font-semibold ${emphasise ? 'text-red-400' : 'text-neutral-200'}`}>{value}</div>
      <div className="text-[10px] uppercase text-neutral-500">{label}</div>
    </div>
  );
}
