import { MapPin } from 'lucide-react';

interface Props {
  pon: number | null;
  zone: number | null;
  plannedLat: number | null;
  plannedLon: number | null;
}

/** Compact 2-column meta grid: PON | Zone, with planned coords spanning below. */
export function SiteMetaGrid({ pon, zone, plannedLat, plannedLon }: Props) {
  const hasPonZone = pon !== null || zone !== null;
  const hasCoords = plannedLat !== null && plannedLon !== null;
  if (!hasPonZone && !hasCoords) return null;

  return (
    <div className="rounded-lg border border-neutral-800 overflow-hidden text-sm">
      {hasPonZone && (
        <div className="grid grid-cols-2 divide-x divide-neutral-800">
          <div className="px-3 py-2">
            <span className="text-neutral-500">PON </span>
            <span className="text-neutral-200">{pon ?? '—'}</span>
          </div>
          <div className="px-3 py-2">
            <span className="text-neutral-500">Zone </span>
            <span className="text-neutral-200">{zone ?? '—'}</span>
          </div>
        </div>
      )}
      {hasCoords && (
        <div
          className={`flex items-center gap-2 px-3 py-2 text-neutral-400 ${
            hasPonZone ? 'border-t border-neutral-800' : ''
          }`}
        >
          <MapPin className="h-4 w-4 shrink-0 text-neutral-500" />
          <span>
            {plannedLat!.toFixed(5)}, {plannedLon!.toFixed(5)}
          </span>
        </div>
      )}
    </div>
  );
}
