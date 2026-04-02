/**
 * SnagFilters — Filter bar for snag grid.
 * Project, status, category, severity, and text search.
 */

'use client';

import { Search } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { SnagFilters } from '../../types/snag.types';

interface Project {
  id: number;
  name: string;
}

interface SnagFiltersProps {
  filters: SnagFilters;
  projects: Project[];
  onChange: (updated: Partial<SnagFilters>) => void;
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
function toFilter(v: string): string { return v === ALL ? '' : v; }
/** Convert empty string to ALL sentinel for Select */
function fromFilter(v: string): string { return v === '' ? ALL : v; }

/** 🟢 WORKING: Filter bar for snag grid */
export function SnagFiltersBar({ filters, projects, onChange }: SnagFiltersProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
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
