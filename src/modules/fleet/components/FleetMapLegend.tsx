/**
 * Legend for the fleet map.
 *
 * Reads STATUS_STYLE rather than restating the colours: a legend that repeats
 * hex values is a legend that goes quietly wrong the first time a marker
 * colour changes.
 */
import { STATUS_STYLE, swatchBackground, type VehicleStatus } from '../utils/liveMapHelpers';

/**
 * The ring's one job is freshness (solid vs dashed), so it stays the same
 * colour for every status — exported so a test can assert that, rather than
 * settling for "some non-white hex", which any wrong colour would satisfy.
 * Tailwind gray-600: legible on the pale header where the marker's white is not.
 */
export const RING_COLOUR = '#4b5563';

/**
 * Ordered by how much it should pull the eye, not by how common it is: this is
 * a fleet-safety view, so the state that needs acting on comes first and the
 * merely informational ones trail it.
 */
export const ORDER: VehicleStatus[] = [
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
            {/*
             * An SVG circle rather than a CSS one, so the swatch can carry the
             * dash. It matters: parkedSilent is the EXACT violet of parked, so
             * on the map the broken ring is the only thing separating them, and
             * a legend that drops it cannot teach what the dash means.
             *
             * The split mirrors the marker's own grammar — the disc carries the
             * identity, the ring carries only freshness — so the ring is one
             * neutral colour for every status and only its dash varies. The
             * marker uses white for that role; the legend cannot, because white
             * has nothing to show against a pale header. Neutral grey keeps the
             * role separation without encoding the hue a second time.
             */}
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16">
              <circle cx="8" cy="8" r="3.5" fill={swatchBackground(status)} />
              <circle
                cx="8"
                cy="8"
                r="6"
                fill="none"
                stroke={RING_COLOUR}
                strokeWidth="1.5"
                strokeDasharray={style.dash}
              />
            </svg>
            {style.label}
            {count !== undefined && <span className="text-gray-400">({count})</span>}
          </li>
        );
      })}
    </ul>
  );
}
