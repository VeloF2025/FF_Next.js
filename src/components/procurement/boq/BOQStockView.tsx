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
  const [hideZeros, setHideZeros] = useState(false);

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

  // Client-side filters
  const filtered = data.filter((r) => {
    if (hideZeros && r.plannedQty === 0) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return r.name.toLowerCase().includes(q) || (r.itemCode ?? '').toLowerCase().includes(q);
    }
    return true;
  });

  async function handleExcel() {
    if (filtered.length === 0) return;
    const XLSX = await import('xlsx');

    const headers = [
      '#', 'Code', 'Description', 'Category', 'UOM', 'BOQ Rate',
      'Planned QTY', 'Planned Value',
      'Ordered QTY', 'Ordered Value',
      'Delivered QTY', 'Delivered Value',
      'SOH QTY', 'SOH Value',
    ];

    const dataRows = filtered.map((r, i) => ({
      '#': i + 1,
      'Code': r.itemCode ?? '',
      'Description': r.name,
      'Category': r.category,
      'UOM': r.uom,
      'BOQ Rate': r.boqRate,
      'Planned QTY': r.plannedQty,
      'Planned Value': r.boqRate * r.plannedQty,
      'Ordered QTY': r.orderedQty,
      'Ordered Value': r.boqRate * r.orderedQty,
      'Delivered QTY': r.deliveredQty,
      'Delivered Value': r.boqRate * r.deliveredQty,
      'SOH QTY': r.soh,
      'SOH Value': r.boqRate * r.soh,
    }));

    // Totals row
    const totals = filtered.reduce(
      (acc, r) => ({
        plannedQty: acc.plannedQty + r.plannedQty,
        plannedValue: acc.plannedValue + r.boqRate * r.plannedQty,
        orderedQty: acc.orderedQty + r.orderedQty,
        orderedValue: acc.orderedValue + r.boqRate * r.orderedQty,
        deliveredQty: acc.deliveredQty + r.deliveredQty,
        deliveredValue: acc.deliveredValue + r.boqRate * r.deliveredQty,
        sohQty: acc.sohQty + r.soh,
        sohValue: acc.sohValue + r.boqRate * r.soh,
      }),
      { plannedQty: 0, plannedValue: 0, orderedQty: 0, orderedValue: 0, deliveredQty: 0, deliveredValue: 0, sohQty: 0, sohValue: 0 }
    );

    dataRows.push({
      '#': '' as unknown as number,
      'Code': '',
      'Description': `TOTALS (${filtered.length} items)`,
      'Category': '',
      'UOM': '',
      'BOQ Rate': 0,
      'Planned QTY': totals.plannedQty,
      'Planned Value': totals.plannedValue,
      'Ordered QTY': totals.orderedQty,
      'Ordered Value': totals.orderedValue,
      'Delivered QTY': totals.deliveredQty,
      'Delivered Value': totals.deliveredValue,
      'SOH QTY': totals.sohQty,
      'SOH Value': totals.sohValue,
    });

    const ws = XLSX.utils.json_to_sheet(dataRows, { header: headers });

    // Column widths
    ws['!cols'] = [
      { wch: 5 },  // #
      { wch: 16 }, // Code
      { wch: 42 }, // Description
      { wch: 20 }, // Category
      { wch: 8 },  // UOM
      { wch: 14 }, // BOQ Rate
      { wch: 13 }, // Planned QTY
      { wch: 16 }, // Planned Value
      { wch: 12 }, // Ordered QTY
      { wch: 15 }, // Ordered Value
      { wch: 14 }, // Delivered QTY
      { wch: 17 }, // Delivered Value
      { wch: 10 }, // SOH QTY
      { wch: 13 }, // SOH Value
    ];

    // Style header row — dark background (#1e2433), white bold text
    const headerStyle = {
      font: { bold: true, color: { rgb: 'FFFFFF' } },
      fill: { fgColor: { rgb: '1E2433' } },
      alignment: { horizontal: 'center' as const },
      border: {
        bottom: { style: 'medium', color: { rgb: '3B82F6' } },
      },
    };
    // Style totals row — slightly lighter bg, bold
    const totalsStyle = {
      font: { bold: true, color: { rgb: 'E2E8F0' } },
      fill: { fgColor: { rgb: '2D3748' } },
    };
    // Currency format
    const currencyFmt = 'R #,##0.00';
    const numberFmt = '#,##0';
    // Banded row fills
    const evenFill = { fgColor: { rgb: '111827' } };
    const oddFill  = { fgColor: { rgb: '1A2336' } };

    const totalRows = dataRows.length; // includes totals row
    const colCount = headers.length;
    const lastDataRow = totalRows; // 1-indexed, header is row 1

    // Apply header styles
    for (let c = 0; c < colCount; c++) {
      const cellAddr = XLSX.utils.encode_cell({ r: 0, c });
      if (!ws[cellAddr]) ws[cellAddr] = { t: 's', v: headers[c] };
      ws[cellAddr].s = headerStyle;
    }

    // Apply data row styles + number formats
    for (let r = 1; r <= totalRows; r++) {
      const isTotals = r === totalRows;
      const fill = isTotals ? { fgColor: { rgb: '2D3748' } } : (r % 2 === 0 ? evenFill : oddFill);

      for (let c = 0; c < colCount; c++) {
        const cellAddr = XLSX.utils.encode_cell({ r, c });
        if (!ws[cellAddr]) continue;
        const isValueCol = [7, 9, 11, 13].includes(c); // Planned/Ordered/Delivered/SOH Value cols
        const isQtyCol = [6, 8, 10, 12].includes(c);
        const isBOQRate = c === 5;

        ws[cellAddr].s = {
          font: isTotals ? totalsStyle.font : { color: { rgb: 'CBD5E0' } },
          fill,
          alignment: c >= 5 ? { horizontal: 'right' as const } : { horizontal: 'left' as const },
          ...(c === 2 && isTotals ? { font: { bold: true, color: { rgb: 'FFFFFF' } } } : {}),
        };
        if (isValueCol || isBOQRate) ws[cellAddr].z = currencyFmt;
        if (isQtyCol) ws[cellAddr].z = numberFmt;
      }
    }

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'BOQ Stock View');

    const filename = `boq-stock-view-${new Date().toISOString().slice(0, 10)}.xlsx`;
    XLSX.writeFile(wb, filename);
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
        hideZeros={hideZeros}
        onHideZerosChange={setHideZeros}
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
