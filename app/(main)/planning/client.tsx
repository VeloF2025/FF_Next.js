'use client';
import Link from 'next/link';
import { useMemo } from 'react';
import { useUrlFilters } from '@/hooks/useUrlFilters';
import { KanbanBoard } from '@/modules/planning/components/KanbanBoard';
import { PlanningFilterBar } from '@/modules/planning/components/PlanningFilterBar';
import type { PlanningFilters, PlanningStage } from '@/modules/planning/types/planning';

export default function PlanningPageClient() {
  const { filters, setFilter, clearAll } = useUrlFilters({ project: '', stage: '', search: '' });

  const boardFilters: PlanningFilters = useMemo(() => ({
    project_id: filters.project || undefined,
    stage: (filters.stage || undefined) as PlanningStage | undefined,
    search: filters.search || undefined,
  }), [filters.project, filters.stage, filters.search]);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold">Planning</h1>
        <Link href="/planning/new" className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm">New Planning Item</Link>
      </div>
      <PlanningFilterBar
        value={filters}
        onChange={(k, v) => setFilter(k, v)}
        onClear={clearAll}
      />
      <KanbanBoard filters={boardFilters} />
    </div>
  );
}
