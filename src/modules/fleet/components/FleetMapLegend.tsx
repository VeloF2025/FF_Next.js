/**
 * Legend for the fleet map.
 *
 * Reads STATUS_STYLE rather than restating the colours: a legend that repeats
 * hex values is a legend that goes quietly wrong the first time a marker
 * colour changes.
 */
import { STATUS_STYLE, swatchBackground, type VehicleStatus } from '../utils/liveMapHelpers';

/**
 * Ordered by how much it should pull the eye, not by how common it is: this is
 * a fleet-safety view, so the state that needs acting on comes first and the
 * merely informational ones trail it.
 */
const ORDER: VehicleStatus[] = [
  'speeding',
  'lostContact',
  'moving',
  'parked',
  'parkedSilent',
  'unknown',
];

export function FleetMapLegend({ counts }: { counts?: Partial<Record<VehicleStatus, number>> }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1" aria-label="Map legend">
      {ORDER.map((status) => {
        const style = STATUS_STYLE[status];
        const count = counts?.[status];
        return (
          <li key={status} className="flex items-center gap-1.5 text-xs text-gray-600">
            <span
              aria-hidden="true"
              className="inline-block h-3 w-3 rounded-full ring-2 ring-white"
              style={{ backgroundColor: swatchBackground(status) }}
            />
            {style.label}
            {count !== undefined && <span className="text-gray-400">({count})</span>}
          </li>
        );
      })}
    </ul>
  );
}
