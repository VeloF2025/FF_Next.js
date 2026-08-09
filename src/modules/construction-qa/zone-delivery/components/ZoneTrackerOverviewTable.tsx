import type { TrackerZoneRow } from '../types/zoneDelivery.types';
import { ZoneTrackerDate } from './ZoneTrackerDate';

interface Props {
  rows: TrackerZoneRow[];
}

const cell = 'px-4 py-3';

/**
 * Johan's overview: one row per zone, five columns, no gates.
 *
 * Deliberately absent are the current-gate, blocker and Zone QA columns the
 * register at /field-ops carries. He asked for the PON-submitted date to stay
 * off this table too ("as soon as there's a site with 4 PONs, all 4 is live,
 * then people will have to pull every PON apart") — that detail lives one tab
 * across, in the PON table.
 */
export function ZoneTrackerOverviewTable({ rows }: Props) {
  return (
    <div className="overflow-x-auto rounded-lg border border-[var(--border-color)]">
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead className="bg-[var(--hover-bg)] text-xs uppercase text-[var(--ff-text-secondary)]">
          <tr>
            <th className={cell}>Site</th>
            <th className={cell}>Zone</th>
            <th className={cell}>Total PONs</th>
            <th className={cell}>PONs live</th>
            <th className={cell}>Homes active</th>
            <th className={cell}>Zone handover</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--border-color)] text-[var(--ff-text-primary)]">
          {rows.map(row => (
            <tr key={`${row.projectId}-${row.zoneNo}`}>
              <td className={`${cell} font-medium`}>{row.projectName}</td>
              <td className={cell}>{row.zoneNo}</td>
              <td className={cell}>{row.totalPons}</td>
              <td className={cell}>{row.livePons}</td>
              <td className={cell}>{row.homesActive.toLocaleString('en-ZA')}</td>
              <td className={cell}><ZoneTrackerDate value={row.handedOverAt} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
