/**
 * SnagFilters — Filter bar for snag grid.
 * Project, status, category, severity, sort, and text search.
 */

'use client';

import { Search } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { SnagFilters, SnagSortBy } from '../../types/snag.types';

interface Project {
  id: string;
  name: string;
}

interface SnagFiltersProps {
  filters: SnagFilters;
  projects: Project[];
  zones: number[];
  pons: Array<{ zone_no: number | null; pon_no: number | null }>;
  onChange: (updated: Partial<SnagFilters>) => void;
}

const ALL = '__all__';

const STATUS_OPTIONS = [
  { value: ALL, label: 'All Statuses' },
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

const SORT_OPTIONS: { value: SnagSortBy; label: string }[] = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'status', label: 'By status' },
  { value: 'severity', label: 'By severity' },
  { value: 'needs_attention', label: 'Needs attention' },
];

/** Convert ALL sentinel to empty string for API */
function toFilter(v: string): string { return v === ALL ? '' : v; }
/** Convert empty string to ALL sentinel for Select */
function fromFilter(v: string): string { return v === '' ? ALL : v; }

/** Filter bar for snag grid with sort */
export function SnagFiltersBar({ filters, projects: _projects, zones, pons, onChange }: SnagFiltersProps) {
  const hasProject = !!filters.projectId;
  const selectedZone = filters.zone_no ?? '';

  // PON options filtered by selected zone
  const ponOptions = selectedZone
    ? [...new Set(pons.filter((p) => p.zone_no === Number(selectedZone) && p.pon_no !== null).map((p) => p.pon_no!))].sort((a, b) => a - b)
    : [...new Set(pons.filter((p) => p.pon_no !== null).map((p) => p.pon_no!))].sort((a, b) => a - b);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Zone filter — enabled when project selected */}
      <Select
        value={fromFilter(selectedZone)}
        onValueChange={(v) => {
          const zoneVal = toFilter(v);
          onChange({ zone_no: zoneVal, pon_no: '', page: 1 });
        }}
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
        onValueChange={(v) => onChange({ pon_no: toFilter(v), page: 1 })}
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
        onValueChange={(v) => onChange({ status: toFilter(v), page: 1 })}
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
        onValueChange={(v) => onChange({ category: toFilter(v), page: 1 })}
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
        onValueChange={(v) => onChange({ severity: toFilter(v), page: 1 })}
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

      {/* Sort */}
      <Select
        value={filters.sortBy ?? 'newest'}
        onValueChange={(v) => onChange({ sortBy: v as SnagSortBy })}
      >
        <SelectTrigger className="w-44 bg-zinc-800 border-zinc-700 text-zinc-100">
          <SelectValue placeholder="Sort by" />
        </SelectTrigger>
        <SelectContent className="bg-zinc-800 border-zinc-700">
          {SORT_OPTIONS.map((o) => (
            <SelectItem key={o.value} value={o.value} className="text-zinc-100">
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Text search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
        <input
          type="text"
          value={filters.search}
          onChange={(e) => onChange({ search: e.target.value, page: 1 })}
          placeholder="Search descriptions..."
          className="pl-9 pr-3 py-2 bg-zinc-800 border border-zinc-700 rounded-md text-sm text-zinc-100 placeholder-zinc-400 focus:outline-none focus:border-zinc-500 w-52"
        />
      </div>
    </div>
  );
}
