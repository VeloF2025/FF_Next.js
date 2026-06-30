'use client';
import Link from 'next/link';
import { useMemo } from 'react';
import { useUrlFilters } from '@/hooks/useUrlFilters';
import { ProtectedPage, PermissionGate } from '@/components/PermissionGate';
import { KanbanBoard } from '@/modules/planning/components/KanbanBoard';
import { PlanningFilterBar } from '@/modules/planning/components/PlanningFilterBar';
import type { PipelineProjectOption } from '@/modules/planning/components/PipelineProjectPicker';
import type { PlanningFilters, PlanningStage } from '@/modules/planning/types/planning';

export default function PlanningPageClient() {
  const { filters, setFilter, setMultiple, clearAll } = useUrlFilters({
    pipeline_project: '',
    pipeline_project_name: '',
    stage: '',
    search: '',
  });

  const boardFilters: PlanningFilters = useMemo(() => ({
    pipeline_project_id: filters.pipeline_project || undefined,
    stage: (filters.stage || undefined) as PlanningStage | undefined,
    search: filters.search || undefined,
  }), [filters.pipeline_project, filters.stage, filters.search]);

  return (
    <ProtectedPage permission="planning.main" action="view">
      <div className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-semibold">Planning</h1>
          <PermissionGate permission="planning.main" action="create">
            <Link href="/planning/new" className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm">New Planning Item</Link>
          </PermissionGate>
        </div>
        <PlanningFilterBar
          value={filters}
          onChange={(k, v) => setFilter(k, v)}
          onSelectProject={(p: PipelineProjectOption | null) =>
            setMultiple({ pipeline_project: p?.id ?? '', pipeline_project_name: p?.project_name ?? '' })
          }
          onClear={clearAll}
        />
        <KanbanBoard filters={boardFilters} />
      </div>
    </ProtectedPage>
  );
}
