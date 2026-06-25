'use client';
import { useEffect, useState } from 'react';
import { ProjectQueryService } from '@/services/projects/core/projectQueryService';
import { BOARD_STAGES } from '../constants/stages';
import { log } from '@/lib/logger';
import type { Project } from '@/types/project/base.types';

export interface PlanningFilterValues { project: string; stage: string; search: string }

interface Props {
  value: PlanningFilterValues;
  onChange: (key: keyof PlanningFilterValues, val: string) => void;
  onClear: () => void;
}

export function PlanningFilterBar({ value, onChange, onClear }: Props) {
  const [projects, setProjects] = useState<Project[]>([]);
  useEffect(() => {
    ProjectQueryService.getActiveProjects()
      .then(setProjects)
      .catch((error) => log.error('Failed to load projects', { data: error }, 'PlanningFilterBar'));
  }, []);

  return (
    <div className="flex flex-wrap items-center gap-2 mb-4">
      <input
        type="text"
        placeholder="Search planning items…"
        value={value.search}
        onChange={(e) => onChange('search', e.target.value)}
        className="px-3 py-2 border rounded-md text-sm"
      />
      <select value={value.project} onChange={(e) => onChange('project', e.target.value)} className="px-3 py-2 border rounded-md text-sm">
        <option value="">All Projects</option>
        {projects.map((p) => (
          <option key={p.id} value={p.id}>{p.project_name ?? p.name} {p.project_code ?? (p.code ? `(${p.code})` : '')}</option>
        ))}
      </select>
      <select value={value.stage} onChange={(e) => onChange('stage', e.target.value)} className="px-3 py-2 border rounded-md text-sm">
        <option value="">All Stages</option>
        {BOARD_STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
      </select>
      <button onClick={onClear} className="px-3 py-2 text-sm text-gray-500 hover:text-gray-700">Clear</button>
    </div>
  );
}
