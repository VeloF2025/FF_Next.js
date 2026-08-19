/**
 * ProximityBadge — where a single clock event happened relative to the
 * nearest project site.
 *
 * Renders nothing when no distance was recorded, rather than an "unknown"
 * chip: manual admin entries and auto-closed shifts have no fix by design,
 * and a row of grey placeholders would read as missing data.
 */

import { classifyProximity, proximityLabel, type Proximity } from '../aoiProximity';

const STYLES: Record<Exclude<Proximity, 'unknown'>, { dot: string; text: string; title: string }> = {
  on_site: {
    dot:  'bg-emerald-400',
    text: 'text-emerald-300',
    title: 'Inside the site boundary',
  },
  near: {
    dot:  'bg-amber-400',
    text: 'text-amber-300',
    title: 'Outside the site boundary, but within 500 m',
  },
  off_site: {
    dot:  'bg-rose-400',
    text: 'text-rose-300',
    title: 'Outside the site boundary by more than 500 m',
  },
};

interface ProximityBadgeProps {
  projectName: string | null | undefined;
  distanceM: number | null | undefined;
  /** Announced to screen readers so the dot colour is not the only signal. */
  event: 'Clock in' | 'Clock out';
}

export function ProximityBadge({ projectName, distanceM, event }: ProximityBadgeProps) {
  const kind = classifyProximity(distanceM);
  if (kind === 'unknown') return null;

  const style = STYLES[kind];
  const label = proximityLabel(projectName, distanceM);
  const nearest = kind === 'on_site' ? '' : `nearest ${projectName ?? 'site'}, `;

  return (
    <span
      className={`mt-0.5 flex items-center gap-1 text-xs ${style.text}`}
      title={`${event}: ${style.title}`}
    >
      <span className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${style.dot}`} aria-hidden />
      <span className="sr-only">{`${event} ${nearest}`}</span>
      <span className="truncate">{label}</span>
    </span>
  );
}
