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

const STATUS_OPTIONS = [
  { value: '', label: 'All Statuses' },
  { value: 'open', label: 'Open' },
  { value: 'assigned', label: 'Assigned' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'fixed', label: 'Fixed' },
  { value: 'verified', label: 'Verified' },
  { value: 'closed', label: 'Closed' },
  { value: 'reopened', label: 'Reopened' },
];

const CATEGORY_OPTIONS = [
  { value: '', label: 'All Categories' },
  { value: 'quality', label: 'Quality' },
  { value: 'safety', label: 'Safety' },
  { value: 'health', label: 'Health' },
  { value: 'environment', label: 'Environment' },
  { value: 'traffic', label: 'Traffic' },
];

const SEVERITY_OPTIONS = [
  { value: '', label: 'All Severities' },
  { value: 'critical', label: 'Critical' },
  { value: 'major', label: 'Major' },
  { value: 'minor', label: 'Minor' },
];

/** 🟢 WORKING: Filter bar for snag grid */
export function SnagFiltersBar({ filters, projects, onChange }: SnagFiltersProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Project filter */}
      <Select
        value={filters.projectId}
        onValueChange={(v) => onChange({ projectId: v, page: 1 })}
      >
        <SelectTrigger className="w-44 bg-zinc-800 border-zinc-700 text-zinc-100">
          <SelectValue placeholder="All Projects" />
        </SelectTrigger>
        <SelectContent className="bg-zinc-800 border-zinc-700">
          <SelectItem value="" className="text-zinc-100">All Projects</SelectItem>
          {projects.map((p) => (
            <SelectItem key={p.id} value={String(p.id)} className="text-zinc-100">
              {p.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Status filter */}
      <Select
        value={filters.status}
        onValueChange={(v) => onChange({ status: v, page: 1 })}
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
        value={filters.category}
        onValueChange={(v) => onChange({ category: v, page: 1 })}
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
        value={filters.severity}
        onValueChange={(v) => onChange({ severity: v, page: 1 })}
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
