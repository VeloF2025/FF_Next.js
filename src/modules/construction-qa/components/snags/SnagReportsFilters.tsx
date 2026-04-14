/**
 * SnagReportsFilters — Full filter bar for the snag Reports tab.
 * All filters are sent to the server; exports reflect the filtered dataset.
 */

'use client';

import { useEffect, useState, useCallback } from 'react';
import { Search, RotateCcw } from 'lucide-react';
import { log } from '@/lib/logger';
import { MultiSelectPopover, type MultiOption } from './MultiSelectPopover';
import { emptyFilters, type ReportFilterState, type DateField, type HasPhotos } from './snagReportFilterState';

const STATUS_OPTIONS: MultiOption<string>[] = [
  { value: 'open',        label: 'Open' },
  { value: 'assigned',    label: 'Assigned' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'pending_qa',  label: 'Pending QA' },
  { value: 'resolved',    label: 'Resolved' },
  { value: 'verified',    label: 'Verified' },
  { value: 'closed',      label: 'Closed' },
  { value: 'reopened',    label: 'Reopened' },
  { value: 'wont_fix',    label: "Won't Fix" },
];

const CATEGORY_OPTIONS: MultiOption<string>[] = [
  { value: 'quality',     label: 'Quality' },
  { value: 'health',      label: 'Health' },
  { value: 'safety',      label: 'Safety' },
  { value: 'environment', label: 'Environment' },
  { value: 'traffic',     label: 'Traffic' },
];

const SEVERITY_OPTIONS: MultiOption<string>[] = [
  { value: 'critical', label: 'Critical' },
  { value: 'major',    label: 'Major' },
  { value: 'minor',    label: 'Minor' },
];

interface ProjectOption { id: string; name: string }
interface Assignee     { id: string; name: string }

interface Props {
  value: ReportFilterState;
  onChange: (next: ReportFilterState) => void;
  onRun: () => void;
  isLoading: boolean;
}

export function SnagReportsFilters({ value, onChange, onRun, isLoading }: Props) {
  const [projects, setProjects]   = useState<ProjectOption[]>([]);
  const [assignees, setAssignees] = useState<Assignee[]>([]);
  const [zones, setZones]         = useState<number[]>([]);
  const [pons, setPons]           = useState<Array<{ zone_no: number | null; pon_no: number | null }>>([]);

  // Load projects once
  useEffect(() => {
    let alive = true;
    fetch('/api/projects?limit=500')
      .then((r) => r.json())
      .then((json) => {
        if (!alive) return;
        // API returns { data: [...] } or direct array depending on wrapper
        const list = Array.isArray(json) ? json : (json.data ?? []);
        const sorted = list
          .map((p: { id: string; name?: string; project_name?: string }) => ({
            id: p.id,
            name: p.name ?? p.project_name ?? '(unnamed)',
          }))
          .sort((a: ProjectOption, b: ProjectOption) => a.name.localeCompare(b.name));
        setProjects(sorted);
      })
      .catch((err) => log.error('SnagReportsFilters: projects fetch failed', { err }));
    return () => { alive = false; };
  }, []);

  // Load assignees + zone/pon options whenever project changes
  useEffect(() => {
    let alive = true;
    const qs = value.projectId ? `?projectId=${value.projectId}` : '';
    fetch(`/api/snags/report-options${qs}`)
      .then((r) => r.json())
      .then((json) => {
        if (!alive) return;
        const list: Assignee[] = json.data?.assignees ?? [];
        setAssignees(list.slice().sort((a, b) => a.name.localeCompare(b.name)));
      })
      .catch((err) => log.error('SnagReportsFilters: assignees fetch failed', { err }));

    if (value.projectId) {
      fetch(`/api/snags/zone-pon-options?projectId=${value.projectId}`)
        .then((r) => r.json())
        .then((json) => {
          if (!alive) return;
          setZones(json.data?.zones ?? []);
          setPons(json.data?.pons ?? []);
        })
        .catch((err) => log.error('SnagReportsFilters: zone/pon fetch failed', { err }));
    } else {
      setZones([]); setPons([]);
    }
    return () => { alive = false; };
  }, [value.projectId]);

  const ponOptions: MultiOption<number>[] = (() => {
    const set = new Set<number>();
    for (const p of pons) {
      if (p.pon_no === null) continue;
      if (value.zoneNo.length === 0 || (p.zone_no !== null && value.zoneNo.includes(p.zone_no))) {
        set.add(p.pon_no);
      }
    }
    return Array.from(set).sort((a, b) => a - b).map((n) => ({ value: n, label: `PON ${n}` }));
  })();

  const zoneOptions: MultiOption<number>[] = zones.map((z) => ({ value: z, label: `Zone ${z}` }));
  const projectOptions: MultiOption<string>[] = projects.map((p) => ({ value: p.id, label: p.name }));
  const assigneeOptions: MultiOption<string>[] = assignees.map((a) => ({ value: a.id, label: a.name }));

  const update = useCallback(<K extends keyof ReportFilterState>(key: K, next: ReportFilterState[K]) => {
    onChange({ ...value, [key]: next });
  }, [value, onChange]);

  return (
    <div className="flex items-end gap-2 flex-wrap">
      <div className="flex flex-col gap-1">
        <label className="text-xs text-zinc-400">Date Field</label>
        <select
          value={value.dateField}
          onChange={(e) => update('dateField', e.target.value as DateField)}
          className="px-2.5 py-1.5 text-xs rounded-md bg-zinc-800 border border-zinc-700 text-zinc-100 focus:outline-none focus:border-zinc-500 w-32"
        >
          <option value="opened">Date Opened</option>
          <option value="resolved">Date Resolved</option>
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs text-zinc-400">From</label>
        <input
          type="date"
          value={value.dateFrom}
          onChange={(e) => update('dateFrom', e.target.value)}
          className="px-2.5 py-1.5 text-xs rounded-md bg-zinc-800 border border-zinc-700 text-zinc-100 focus:outline-none focus:border-zinc-500"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs text-zinc-400">To</label>
        <input
          type="date"
          value={value.dateTo}
          onChange={(e) => update('dateTo', e.target.value)}
          className="px-2.5 py-1.5 text-xs rounded-md bg-zinc-800 border border-zinc-700 text-zinc-100 focus:outline-none focus:border-zinc-500"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs text-zinc-400">Project</label>
        <select
          value={value.projectId}
          onChange={(e) => update('projectId', e.target.value)}
          className="px-2.5 py-1.5 text-xs rounded-md bg-zinc-800 border border-zinc-700 text-zinc-100 focus:outline-none focus:border-zinc-500 w-44"
        >
          <option value="">All projects</option>
          {projectOptions.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      <MultiSelectPopover<string>
        label="Status"    options={STATUS_OPTIONS}
        selected={value.status}   onChange={(v) => update('status', v)} />
      <MultiSelectPopover<string>
        label="Category"  options={CATEGORY_OPTIONS}
        selected={value.category} onChange={(v) => update('category', v)} />
      <MultiSelectPopover<string>
        label="Severity"  options={SEVERITY_OPTIONS}
        selected={value.severity} onChange={(v) => update('severity', v)} />
      <MultiSelectPopover<string>
        label="Assigned To" options={assigneeOptions}
        selected={value.assignedTo} onChange={(v) => update('assignedTo', v)} />
      <MultiSelectPopover<number>
        label="Zone" options={zoneOptions}
        selected={value.zoneNo}   onChange={(v) => update('zoneNo', v)} />
      <MultiSelectPopover<number>
        label="PON"  options={ponOptions}
        selected={value.ponNo}    onChange={(v) => update('ponNo', v)} />

      <div className="flex flex-col gap-1">
        <label className="text-xs text-zinc-400">Photos</label>
        <select
          value={value.hasPhotos}
          onChange={(e) => update('hasPhotos', e.target.value as HasPhotos)}
          className="px-2.5 py-1.5 text-xs rounded-md bg-zinc-800 border border-zinc-700 text-zinc-100 w-28"
        >
          <option value="">Any</option>
          <option value="yes">Has photos</option>
          <option value="no">No photos</option>
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs text-zinc-400">Min age (days)</label>
        <input
          type="number"
          min={0}
          value={value.minAgeDays}
          onChange={(e) => update('minAgeDays', e.target.value)}
          placeholder="e.g. 7"
          className="px-2.5 py-1.5 text-xs rounded-md bg-zinc-800 border border-zinc-700 text-zinc-100 focus:outline-none focus:border-zinc-500 w-24"
        />
      </div>

      <button
        type="button"
        onClick={onRun}
        disabled={isLoading}
        className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium rounded-md bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white transition-colors"
      >
        <Search className="w-3.5 h-3.5" />
        {isLoading ? 'Loading…' : 'Run Report'}
      </button>

      <button
        type="button"
        onClick={() => onChange(emptyFilters())}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-zinc-700 hover:bg-zinc-600 text-zinc-200 transition-colors"
      >
        <RotateCcw className="w-3.5 h-3.5" />
        Reset
      </button>
    </div>
  );
}

