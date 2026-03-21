/**
 * ProjectRevenue — Cost Centre Revenue report.
 * Table tab: T1-only data grid (Cost Centre T1 | Revenue)
 * Charts tab: placeholder — awaiting spec from Lew
 */

'use client';

import { useProjectRevenueData } from './useProjectRevenueData';
import { AlertCircle, Loader2 } from 'lucide-react';
import { ReportTabLayout } from '../ReportTabLayout';
import { CostCentreRevenueTable } from '../tables/ProjectRevenueTable';

// 🟢 WORKING: Cost Centre Revenue — tiered table view
export default function ProjectRevenue() {
  const { data, isLoading, error } = useProjectRevenueData();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400">
        <Loader2 className="w-6 h-6 animate-spin mr-2" />
        Loading cost centre data&hellip;
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 text-red-400 p-4">
        <AlertCircle className="w-5 h-5 flex-shrink-0" />
        <span>{error.message}</span>
      </div>
    );
  }

  const rows = data?.data ?? [];

  return (
    <ReportTabLayout
      tableContent={<CostCentreRevenueTable rows={rows} />}
      chartsContent={
        <div className="flex items-center justify-center h-48 text-gray-500 text-sm italic">
          Charts coming soon — awaiting spec
        </div>
      }
    />
  );
}
