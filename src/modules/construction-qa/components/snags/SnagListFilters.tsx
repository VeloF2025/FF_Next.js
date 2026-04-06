/**
 * SnagListFilters — Filter bar for the all-projects snag list page.
 * Project, Status, Category, Severity dropdowns.
 */

'use client';

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface SnagListFiltersProps {
  filters: { projectId: string; status: string; category: string; severity: string; zone_no?: string; pon_no?: string };
  projects: Array<{ id: string; name: string }>;
  zones: number[];
  pons: Array<{ zone_no: number | null; pon_no: number | null }>;
  onChange: (key: string, value: string) => void;
}

const ALL = '__all__';

const STATUS_OPTIONS = [
  { value: ALL, label: 'All Statuses' },
  { value: 'open', label: 'Open' },
  { value: 'assigned', label: 'Assigned' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'fixed', label: 'Fixed' },
  { value: 'verified', label: 'Verified' },
  { value: 'closed', label: 'Closed' },
  { value: 'reopened', label: 'Reopened' },
];

const CATEGORY_OPTIONS = [
  { value: ALL, label: 'All Categories' },
  { value: 'quality', label: 'Quality' },
  { value: 'safety', label: 'Safety' },
  { value: 'health', label: 'Health' },
  { value: 'environment', label: 'Environment' },
  { value: 'traffic', label: 'Traffic' },
];

const SEVERITY_OPTIONS = [
  { value: ALL, label: 'All Severities' },
  { value: 'critical', label: 'Critical' },
  { value: 'major', label: 'Major' },
  { value: 'minor', label: 'Minor' },
];

/** Convert ALL sentinel to empty string for API */
function toFilter(v: string): string {
  return v === ALL ? '' : v;
}

/** Convert empty string to ALL sentinel for Select */
function fromFilter(v: string): string {
  return v === '' ? ALL : v;
}

/** Filter bar for the all-projects snag list view */
export function SnagListFilters({ filters, projects, zones, pons, onChange }: SnagListFiltersProps) {
  const hasProject = !!filters.projectId;
  const selectedZone = filters.zone_no ?? '';

  // PON options filtered by selected zone
  const ponOptions = selectedZone
    ? [...new Set(pons.filter((p) => p.zone_no === Number(selectedZone) && p.pon_no !== null).map((p) => p.pon_no!))].sort((a, b) => a - b)
    : [...new Set(pons.filter((p) => p.pon_no !== null).map((p) => p.pon_no!))].sort((a, b) => a - b);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Project filter */}
      <Select
        value={fromFilter(filters.projectId)}
        onValueChange={(v) => onChange('projectId', toFilter(v))}
      >
        <SelectTrigger className="w-48 bg-zinc-800 border-zinc-700 text-zinc-100">
          <SelectValue placeholder="All Projects" />
        </SelectTrigger>
        <SelectContent className="bg-zinc-800 border-zinc-700">
          <SelectItem value={ALL} className="text-zinc-100">
            All Projects
          </SelectItem>
          {projects.map((p) => (
            <SelectItem key={p.id} value={p.id} className="text-zinc-100">
              {p.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Zone filter — enabled when project selected */}
      <Select
        value={fromFilter(selectedZone)}
        onValueChange={(v) => onChange('zone_no', toFilter(v))}
        disabled={!hasProject || zones.length === 0}
      >
        <SelectTrigger className="w-36 bg-zinc-800 border-zinc-700 text-zinc-100 disabled:opacity-40">
          <SelectValue placeholder="All Zones" />
        </SelectTrigger>
        <SelectContent className="bg-zinc-800 border-zinc-700">
          <SelectItem value={ALL} className="text-zinc-100">All Zones</SelectItem>
          {zones.map((z) => (
            <SelectItem key={z} value={String(z)} className="text-zinc-100">
              Zone {z}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* PON filter — enabled when project selected */}
      <Select
        value={fromFilter(filters.pon_no ?? '')}
        onValueChange={(v) => onChange('pon_no', toFilter(v))}
        disabled={!hasProject || ponOptions.length === 0}
      >
        <SelectTrigger className="w-36 bg-zinc-800 border-zinc-700 text-zinc-100 disabled:opacity-40">
          <SelectValue placeholder="All PONs" />
        </SelectTrigger>
        <SelectContent className="bg-zinc-800 border-zinc-700">
          <SelectItem value={ALL} className="text-zinc-100">All PONs</SelectItem>
          {ponOptions.map((p) => (
            <SelectItem key={p} value={String(p)} className="text-zinc-100">
              PON {p}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Status filter */}
      <Select
        value={fromFilter(filters.status)}
        onValueChange={(v) => onChange('status', toFilter(v))}
      >
        <SelectTrigger className="w-40 bg-zinc-800 border-zinc-700 text-zinc-100">
          <SelectValue placeholder="Status" />
        </SelectTrigger>
        <SelectContent className="bg-zinc-800 border-zinc-700">
          {STATUS_OPTIONS.map((o) => (
            <SelectItem key={o.value} value={o.value} className="text-zinc-100">
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Category filter */}
      <Select
        value={fromFilter(filters.category)}
        onValueChange={(v) => onChange('category', toFilter(v))}
      >
        <SelectTrigger className="w-40 bg-zinc-800 border-zinc-700 text-zinc-100">
          <SelectValue placeholder="Category" />
        </SelectTrigger>
        <SelectContent className="bg-zinc-800 border-zinc-700">
          {CATEGORY_OPTIONS.map((o) => (
            <SelectItem key={o.value} value={o.value} className="text-zinc-100">
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Severity filter */}
      <Select
        value={fromFilter(filters.severity)}
        onValueChange={(v) => onChange('severity', toFilter(v))}
      >
        <SelectTrigger className="w-36 bg-zinc-800 border-zinc-700 text-zinc-100">
          <SelectValue placeholder="Severity" />
        </SelectTrigger>
        <SelectContent className="bg-zinc-800 border-zinc-700">
          {SEVERITY_OPTIONS.map((o) => (
            <SelectItem key={o.value} value={o.value} className="text-zinc-100">
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
