import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { isNewSinceWatermark } from '../utils/recent-rollup';
import type { RecentLane } from '../types/works-qa.types';

interface Props {
  title: string;
  lane: RecentLane;
  watermarkAt: string | null;
  onDrill: (projectId: string, zoneNo: number | null, ponNo: number) => void;
}

function relativeTime(iso: string | null): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  const mins = Math.round((Date.now() - then) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

export function RecentLaneSection({ title, lane, watermarkAt, onDrill }: Props) {
  const [open, setOpen] = useState(true);
  const hasWork = lane.readyPoles > 0 || lane.partialPoles > 0;

  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-900/40">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-zinc-800/40 transition-colors"
      >
        <span className="flex items-center gap-2 text-sm font-medium text-zinc-200">
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          {title}
        </span>
        <span className="flex items-center gap-3 text-xs">
          <span className="text-teal-400 font-medium">{lane.readyPoles} ready</span>
          {lane.partialPoles > 0 && (
            <span className="text-zinc-500">+{lane.partialPoles} partial</span>
          )}
        </span>
      </button>

      {open && (
        <div className="px-3 pb-2">
          {!hasWork ? (
            <p className="text-xs text-zinc-600 py-2">Nothing new in this window.</p>
          ) : (
            lane.sites.map(site => (
              <div key={site.projectId} className="mt-1.5">
                <p className="text-xs font-medium text-zinc-300">{site.projectName}</p>
                {site.zones.map(zone => (
                  <div key={String(zone.zoneNo)} className="ml-2 mt-0.5">
                    {zone.pons.map(pon => (
                      <button
                        type="button"
                        key={`${zone.zoneNo}-${pon.ponNo}`}
                        onClick={() => onDrill(site.projectId, zone.zoneNo, pon.ponNo)}
                        className="w-full flex items-center justify-between gap-2 py-0.5 text-left text-xs text-zinc-400 hover:text-zinc-100"
                      >
                        <span className="flex items-center gap-1.5">
                          <span className="text-zinc-500">
                            Zone {zone.zoneNo ?? '—'} · PON {pon.ponNo}
                          </span>
                          {isNewSinceWatermark(pon.latestAt, watermarkAt) && (
                            <span className="rounded bg-teal-900/70 px-1 text-[10px] font-medium text-teal-300">
                              NEW
                            </span>
                          )}
                        </span>
                        <span className="flex items-center gap-2 shrink-0">
                          <span className="text-teal-400">{pon.readyCount} ready</span>
                          {pon.partialCount > 0 && (
                            <span className="text-zinc-600">+{pon.partialCount}</span>
                          )}
                          <span className="text-zinc-600">{relativeTime(pon.latestAt)}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
