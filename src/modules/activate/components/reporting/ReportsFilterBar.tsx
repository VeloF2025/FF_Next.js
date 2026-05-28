/**
 * ReportsFilterBar — sticky filter bar for the Activate Reports dashboard.
 *
 * Wraps the shared `DateChipFilter` (OLT Investigate look-and-feel) plus the
 * project select and Refresh/Export buttons. Internal chip state is derived
 * into the `ReportFilters` shape the parent passes to each report child.
 */

'use client';

import { useState } from 'react';
import { RefreshCw, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DateChipFilter } from '@/modules/data-sync/components/DateChipFilter';
import type { DateFilter } from '@/modules/data-sync/types';
import type { ReportFilters } from '../../types/reporting.types';
import { getTodaySAST } from '../../context';

interface ReportsFilterBarProps {
  filters: ReportFilters;
  onFiltersChange: (next: ReportFilters) => void;
  projects: string[];
  isLoading: boolean;
  onRefresh: () => void;
  isExporting: boolean;
  onExport: () => void;
}

const ALL_RANGE_START = '2020-01-01';

function ymd(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function resolveRange(
  filter: DateFilter,
  customDateFrom: string,
  customDateTo: string,
): { dateFrom: string; dateTo: string } {
  const todayStr = getTodaySAST();
  const today = new Date(todayStr);
  switch (filter) {
    case 'today':
      return { dateFrom: todayStr, dateTo: todayStr };
    case 'yesterday': {
      const y = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
      const yStr = ymd(y);
      return { dateFrom: yStr, dateTo: yStr };
    }
    case '7d': {
      const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 7);
      return { dateFrom: ymd(start), dateTo: todayStr };
    }
    case '30d': {
      const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 30);
      return { dateFrom: ymd(start), dateTo: todayStr };
    }
    case 'all':
      return { dateFrom: ALL_RANGE_START, dateTo: todayStr };
    case 'custom':
      return { dateFrom: customDateFrom, dateTo: customDateTo };
  }
}

export function ReportsFilterBar({
  filters,
  onFiltersChange,
  projects,
  isLoading,
  onRefresh,
  isExporting,
  onExport,
}: ReportsFilterBarProps) {
  const [dateFilter, setDateFilter] = useState<DateFilter>('all');
  const [customDateFrom, setCustomDateFrom] = useState<string>(filters.dateFrom);
  const [customDateTo, setCustomDateTo] = useState<string>(filters.dateTo);

  const applyDateFilter = (f: DateFilter, from: string, to: string) => {
    setDateFilter(f);
    const r = resolveRange(f, from, to);
    onFiltersChange({ ...filters, dateFrom: r.dateFrom, dateTo: r.dateTo });
  };

  const handleDateFilterChange = (f: DateFilter) => {
    applyDateFilter(f, customDateFrom, customDateTo);
  };

  const handleCustomFromChange = (d: string) => {
    setCustomDateFrom(d);
    if (dateFilter === 'custom') applyDateFilter('custom', d, customDateTo);
  };

  const handleCustomToChange = (d: string) => {
    setCustomDateTo(d);
    if (dateFilter === 'custom') applyDateFilter('custom', customDateFrom, d);
  };

  return (
    <div className="bg-card rounded-lg shadow-md dark:shadow-gray-900/50 p-4 sticky top-0 z-10">
      <div className="flex flex-wrap items-center gap-4">
        <DateChipFilter
          dateFilter={dateFilter}
          onDateFilterChange={handleDateFilterChange}
          customDateFrom={customDateFrom}
          customDateTo={customDateTo}
          onCustomDateFromChange={handleCustomFromChange}
          onCustomDateToChange={handleCustomToChange}
        />

        <select
          value={filters.project || ''}
          onChange={(e) =>
            onFiltersChange({
              ...filters,
              project: e.target.value || undefined,
            })
          }
          className="px-3 py-1.5 border border-border rounded text-sm bg-card text-foreground"
        >
          <option value="">All Projects</option>
          {projects.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>

        <div className="flex gap-2 ml-auto">
          <Button
            variant="secondary"
            size="sm"
            onClick={onRefresh}
            disabled={isLoading}
            loading={isLoading}
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={onExport}
            disabled={isExporting}
            loading={isExporting}
          >
            <Download className="h-4 w-4" />
            {isExporting ? 'Exporting...' : 'Export'}
          </Button>
        </div>
      </div>
    </div>
  );
}
