import type { TrackerPonRow } from '../types/zoneDelivery.types';
import { ZoneTrackerDate } from './ZoneTrackerDate';

interface Props {
  rows: TrackerPonRow[];
  submittedOnly: boolean;
  onSubmittedOnlyChange: (next: boolean) => void;
}

const cell = 'px-4 py-3';

/**
 * Johan's PON dashboard: site, zone, PON, the date he submitted it, and how
 * many homes are active behind it.
 *
 * He described it as showing "every PON that has been submitted", but it starts
 * out listing every PON, because nothing has been submitted yet and an empty
 * table would teach him the screen is broken. The toggle gives him the narrower
 * view he asked for once the dates start landing.
 */
export function ZoneTrackerPonTable({ rows, submittedOnly, onSubmittedOnlyChange }: Props) {
  const visible = submittedOnly ? rows.filter(row => row.portSubmittedAt !== null) : rows;
  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-sm text-[var(--ff-text-secondary)]">
        <input
          type="checkbox"
          checked={submittedOnly}
          onChange={event => onSubmittedOnlyChange(event.target.checked)}
        />
        Submitted PONs only
      </label>
      {visible.length === 0 ? (
        <p className="py-16 text-center text-[var(--ff-text-secondary)]">
          {submittedOnly
            ? 'No PON has been submitted yet. Use Submit PON on the Works QA screen.'
            : 'No PONs match the current filters.'}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[var(--border-color)]">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="bg-[var(--hover-bg)] text-xs uppercase text-[var(--ff-text-secondary)]">
              <tr>
                <th className={cell}>Site</th>
                <th className={cell}>Zone</th>
                <th className={cell}>PON</th>
                <th className={cell}>PON submitted</th>
                <th className={cell}>Homes active</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-color)] text-[var(--ff-text-primary)]">
              {visible.map(row => (
                <tr key={`${row.projectId}-${row.zoneNo}-${row.ponNo}`}>
                  <td className={`${cell} font-medium`}>{row.projectName}</td>
                  <td className={cell}>{row.zoneNo}</td>
                  <td className={cell}>{row.ponNo}</td>
                  <td className={cell}><ZoneTrackerDate value={row.portSubmittedAt} /></td>
                  <td className={cell}>{row.homesActive.toLocaleString('en-ZA')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
