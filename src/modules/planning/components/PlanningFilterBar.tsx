'use client';
import { BOARD_STAGES } from '../constants/stages';
import { PipelineProjectPicker, type PipelineProjectOption } from './PipelineProjectPicker';

export interface PlanningFilterValues {
  pipeline_project: string;
  pipeline_project_name: string;
  stage: string;
  search: string;
}

interface Props {
  value: PlanningFilterValues;
  onChange: (key: keyof PlanningFilterValues, val: string) => void;
  onSelectProject: (project: PipelineProjectOption | null) => void;
  onClear: () => void;
}

export function PlanningFilterBar({ value, onChange, onSelectProject, onClear }: Props) {
  return (
    <div className="flex flex-wrap items-center gap-2 mb-4">
      <PipelineProjectPicker
        className="min-w-[240px]"
        value={value.pipeline_project ? { id: value.pipeline_project, label: value.pipeline_project_name || 'Selected project' } : null}
        onSelect={onSelectProject}
        placeholder="Search all projects…"
      />
      <input
        type="text"
        placeholder="Search planning items…"
        value={value.search}
        onChange={(e) => onChange('search', e.target.value)}
        className="px-3 py-2 border rounded-md text-sm"
      />
      <select value={value.stage} onChange={(e) => onChange('stage', e.target.value)} className="px-3 py-2 border rounded-md text-sm">
        <option value="">All Stages</option>
        {BOARD_STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
      </select>
      <button onClick={onClear} className="px-3 py-2 text-sm text-gray-500 hover:text-gray-700">Clear</button>
    </div>
  );
}
