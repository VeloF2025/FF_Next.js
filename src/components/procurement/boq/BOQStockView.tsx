/**
 * BOQStockView — Main BOQ stock summary view
 * Excel-style table: Name, Category, BOQ Rate, Planned, Ordered, Delivered, SOH
 * Default: all BOQs summed together. Filterable by project and category.
 */
'use client';

import { useEffect, useState, useCallback } from 'react';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { log } from '@/lib/logger';
import { BOQStockFilters } from './BOQStockFilters';
import { BOQStockTable } from './BOQStockTable';
import type { BOQStockRow, BOQStockViewResponse } from '@/pages/api/procurement/boq-stock-view';
import type { Project } from '@/types/project.types';

interface BOQStockViewProps {
  selectedProject?: Project;
}

export function BOQStockView({ selectedProject }: BOQStockViewProps) {
  const [data, setData] = useState<BOQStockRow[]>([]);
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [allCategories, setAllCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>(
    selectedProject ? [selectedProject.id] : []
  );
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [search, setSearch] = useState('');

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (selectedProjectIds.length > 0) {
        params.set('projectIds', selectedProjectIds.join(','));
      }
      if (selectedCategories.length > 0) {
        params.set('categories', selectedCategories.join(','));
      }

      const res = await fetch(`/api/procurement/boq-stock-view?${params.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const result: BOQStockViewResponse = json.data ?? json;

      setData(result.data ?? []);
      setProjects(result.projects ?? []);
      setAllCategories(result.categories ?? []);
    } catch (err) {
      log.error('BOQ stock view fetch failed', { error: (err as Error).message }, 'BOQStockView');
      setError('Failed to load BOQ data. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [selectedProjectIds, selectedCategories]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  // Sync external project selection
  useEffect(() => {
    if (selectedProject) {
      setSelectedProjectIds([selectedProject.id]);
    } else {
      setSelectedProjectIds([]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProject?.id]);

  // Client-side search filter
  const filtered = search.trim()
    ? data.filter(
        (r) =>
          r.name.toLowerCase().includes(search.toLowerCase()) ||
          (r.itemCode ?? '').toLowerCase().includes(search.toLowerCase())
      )
    : data;

  function handleExcel() {
    if (filtered.length === 0) return;
    const headers = ['#', 'Code', 'Description', 'Category', 'UOM', 'BOQ Rate', 'Planned Qty', 'Ordered', 'Delivered', 'SOH', 'Total Value'];
    const rows = filtered.map((r, i) => [
      i + 1,
      r.itemCode ?? '',
      r.name,
      r.category,
      r.uom,
      r.boqRate,
      r.plannedQty,
      r.orderedQty,
      r.deliveredQty,
      r.soh,
      r.boqRate * r.plannedQty,
    ]);
    const csv = [headers, ...rows].map((r) => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'boq-stock-view.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-col h-full bg-zinc-950 rounded-lg border border-zinc-800 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
        <h2 className="text-sm font-semibold text-zinc-100">
          Items{!loading && ` (${filtered.length})`}
        </h2>
        <Button
          variant="outline"
          size="sm"
          onClick={handleExcel}
          disabled={filtered.length === 0}
          className="h-7 gap-1.5 text-xs border-zinc-700 bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:text-white"
        >
          <Download className="h-3.5 w-3.5" />
          Excel
        </Button>
      </div>

      {/* Filters */}
      <BOQStockFilters
        projects={projects}
        categories={allCategories}
        selectedProjectIds={selectedProjectIds}
        selectedCategories={selectedCategories}
        onProjectsChange={setSelectedProjectIds}
        onCategoriesChange={setSelectedCategories}
        totalCount={filtered.length}
        search={search}
        onSearchChange={setSearch}
      />

      {/* Error */}
      {error && (
        <div className="px-4 py-3 bg-red-900/20 border-b border-red-800/50">
          <p className="text-xs text-red-400">{error}</p>
        </div>
      )}

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <BOQStockTable rows={filtered} loading={loading} />
      </div>
    </div>
  );
}
