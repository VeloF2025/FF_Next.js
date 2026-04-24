/**
 * SnagListFilters — Filter bar for the all-projects snag list page.
 *
 * Project stays single-select (drives zone/PON cascade and the closeout report).
 * All secondary filters (Zone, PON, Status, Category, Severity) are multi-select:
 * an empty array means "no filter" (All).
 */

'use client';

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { MultiSelectFilter } from '@/components/ui/multi-select-filter';

/** Slice of the hook's filter state that the filter bar reads + edits. */
export interface SnagListFilterValues {
  projectId: string;
  status: string[];
  category: string[];
  severity: string[];
  zone_no: string[];
  pon_no: string[];
}

interface SnagListFiltersProps {
  /** Accepts a superset of SnagListFilterValues (the hook's full state). */
  filters: SnagListFilterValues;
  projects: Array<{ id: string; name: string }>;
  zones: number[];
  pons: Array<{ zone_no: number | null; pon_no: number | null }>;
  /** Typed callback — caller may widen to its own key set; we only use the ones above. */
  onChange: (key: keyof SnagListFilterValues, value: string | string[]) => void;
}

const ALL = '__all__';

const STATUS_OPTIONS = [
  { value: 'open', label: 'Open' },
  { value: 'assigned', label: 'Assigned' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'pending_qa', label: 'Pending QA' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'verified', label: 'Verified' },
  { value: 'closed', label: 'Closed' },
  { value: 'reopened', label: 'Reopened' },
];

const CATEGORY_OPTIONS = [
  { value: 'quality', label: 'Quality' },
  { value: 'safety', label: 'Safety' },
  { value: 'health', label: 'Health' },
  { value: 'environment', label: 'Environment' },
  { value: 'traffic', label: 'Traffic' },
];

const SEVERITY_OPTIONS = [
  { value: 'critical', label: 'Critical' },
  { value: 'major', label: 'Major' },
  { value: 'minor', label: 'Minor' },
];

/** Filter bar for the all-projects snag list view */
export function SnagListFilters({ filters, projects, zones, pons, onChange }: SnagListFiltersProps) {
  const hasProject = !!filters.projectId;

  // Zones active for "current" filter — if none selected, all zones in scope
  const selectedZones = filters.zone_no.map(Number);

  // PON options filtered by selected zones (if any)
  const ponOptions = selectedZones.length > 0
    ? [...new Set(
        pons
          .filter((p) => p.zone_no !== null && selectedZones.includes(p.zone_no) && p.pon_no !== null)
          .map((p) => p.pon_no!)
      )].sort((a, b) => a - b)
    : [...new Set(pons.filter((p) => p.pon_no !== null).map((p) => p.pon_no!))].sort((a, b) => a - b);

  const zoneOptions = zones.map((z) => ({ value: String(z), label: `Zone ${z}` }));
  const ponSelectOptions = ponOptions.map((p) => ({ value: String(p), label: `PON ${p}` }));

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Project filter — single-select (drives cascade + closeout report) */}
      <Select
        value={filters.projectId === '' ? ALL : filters.projectId}
        onValueChange={(v) => onChange('projectId', v === ALL ? '' : v)}
      >
        <SelectTrigger className="w-48 h-9 bg-zinc-800 border-zinc-700 text-zinc-100">
          <SelectValue placeholder="All Projects" />
        </SelectTrigger>
        <SelectContent className="bg-zinc-800 border-zinc-700">
          <SelectItem value={ALL} className="text-zinc-100">All Projects</SelectItem>
          {projects.map((p) => (
            <SelectItem key={p.id} value={p.id} className="text-zinc-100">
              {p.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <MultiSelectFilter
        label="Zones"
        options={zoneOptions}
        selected={filters.zone_no}
        onChange={(v) => onChange('zone_no', v)}
        disabled={!hasProject || zoneOptions.length === 0}
        triggerClassName="w-36"
      />

      <MultiSelectFilter
        label="PONs"
        options={ponSelectOptions}
        selected={filters.pon_no}
        onChange={(v) => onChange('pon_no', v)}
        disabled={!hasProject || ponSelectOptions.length === 0}
        triggerClassName="w-36"
      />

      <MultiSelectFilter
        label="Statuses"
        options={STATUS_OPTIONS}
        selected={filters.status}
        onChange={(v) => onChange('status', v)}
        triggerClassName="w-40"
      />

      <MultiSelectFilter
        label="Categories"
        options={CATEGORY_OPTIONS}
        selected={filters.category}
        onChange={(v) => onChange('category', v)}
        triggerClassName="w-40"
      />

      <MultiSelectFilter
        label="Severities"
        options={SEVERITY_OPTIONS}
        selected={filters.severity}
        onChange={(v) => onChange('severity', v)}
        triggerClassName="w-36"
      />
    </div>
  );
}
