import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { WorksQAZoneSummary } from '../types/works-qa.types';

const ALL = '__ALL__';

interface WorksQAFiltersBarProps {
  zones: WorksQAZoneSummary[];
  zoneNo: number | null;
  ponNo: number | null;
  onChange: (next: { zone_no?: number | null; pon_no?: number | null }) => void;
}

export function WorksQAFiltersBar({ zones, zoneNo, ponNo, onChange }: WorksQAFiltersBarProps) {
  // PONs filtered by selected zone (or all if no zone selected)
  const ponOptions = zoneNo === null
    ? zones.flatMap(z => z.pons.map(p => ({ ...p, zone_no: z.zone_no })))
    : zones.find(z => z.zone_no === zoneNo)?.pons ?? [];
  const sortedPons = [...ponOptions].sort((a, b) => a.pon_no - b.pon_no);
  const zoneNumbers = zones
    .map(z => z.zone_no)
    .filter((z): z is number => z !== null)
    .sort((a, b) => a - b);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        value={zoneNo === null ? ALL : String(zoneNo)}
        onValueChange={v => {
          const next = v === ALL ? null : Number(v);
          onChange({ zone_no: next, pon_no: null });
        }}
        disabled={zoneNumbers.length === 0}
      >
        <SelectTrigger className="w-36 bg-zinc-800 border-zinc-700 text-zinc-100 disabled:opacity-40">
          <SelectValue placeholder="All Zones" />
        </SelectTrigger>
        <SelectContent className="bg-zinc-800 border-zinc-700">
          <SelectItem value={ALL} className="text-zinc-100">All Zones</SelectItem>
          {zoneNumbers.map(z => (
            <SelectItem key={z} value={String(z)} className="text-zinc-100">
              Zone {z}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={ponNo === null ? ALL : String(ponNo)}
        onValueChange={v => onChange({ pon_no: v === ALL ? null : Number(v) })}
        disabled={sortedPons.length === 0}
      >
        <SelectTrigger className="w-44 bg-zinc-800 border-zinc-700 text-zinc-100 disabled:opacity-40">
          <SelectValue placeholder="All PONs" />
        </SelectTrigger>
        <SelectContent className="bg-zinc-800 border-zinc-700">
          <SelectItem value={ALL} className="text-zinc-100">All PONs</SelectItem>
          {sortedPons.map(p => (
            <SelectItem key={p.pon_no} value={String(p.pon_no)} className="text-zinc-100">
              PON {p.pon_no} — {p.pole_count} pole{p.pole_count === 1 ? '' : 's'}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
